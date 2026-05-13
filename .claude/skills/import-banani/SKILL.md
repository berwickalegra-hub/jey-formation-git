---
name: import-banani
description: Use when the user wants to import selected Banani designs into the starter and reconcile what the design needs against the routes/models the starter already ships. Triggers — "/import-banani", "import my Banani design", "build from my selected Banani screens", "reconcile Banani with the starter". Reads the user's currently-selected screens via the Banani MCP, matches them against the 40 existing API routes + 14 Prisma models, and produces .planning/DESIGN-COVERAGE.md (the per-screen reconciliation report) plus a generated .planning/ROADMAP.md ready for /gsd-execute-phase.
---

# Skill — import-banani

## Purpose

Bridge the gap between Banani designs (a collection of selected screens in the user's Banani editor) and the starter's existing backend surface (40 API routes, 14 Prisma models, 10 optional features). The output answers, **per screen**:

- Which existing routes can be reused as-is
- Which new routes / models / migrations the design demands
- Which optional features can be pruned (forks not needing payments / orgs / uploads / etc.)

The user reads the report, validates, then runs `/gsd-execute-phase 1` (real GSD command, installed user-side) and the work proceeds wave-by-wave.

> **This is NOT a GSD-native skill.** It lives in this starter and orchestrates the GSD framework that the user has installed separately. The slash command is `/import-banani` (no `gsd-` prefix on purpose).

## When to invoke

- User typed `/import-banani`
- User said "import my Banani design", "reconcile this design with the starter", "build from my selected screens", "use the Banani MCP to plan the work"

## Pre-requisites (verify before fetching anything)

1. **GSD installed** user-side (`/gsd-execute-phase`, `/gsd-plan-phase`, `/gsd-discuss-phase` available). If not, stop and ask the user to install it — without GSD the generated ROADMAP.md cannot be executed.
2. **`.mcp.json`** at repo root declares the `banani` MCP server. The starter ships a templated entry — the fork-author must replace `command`/`args` with the canonical Banani launcher (whatever Banani publishes).
3. **`BANANI_API_KEY`** set in `.env.local` (referenced by `.mcp.json` via `${BANANI_API_KEY}`).
4. **Claude Code session restarted** after the MCP config / env changes (MCPs are loaded at session start, not hot-reloaded).
5. **User has selected the screens to import in their Banani editor** — the MCP tool reads the selection.

If any pre-req is missing, **stop and report which one** — do not guess or fall back silently.

## Procedure

### Step 1 — Load starter context

Read in this order (parallel reads OK):

1. [.planning/features.json](../../../.planning/features.json) — manifest of the 10 optional surfaces with the routes / libs / models / env vars each one owns
2. [CLAUDE.md](../../../CLAUDE.md) — architecture overview + protected/editable file lists
3. [frontend/prisma/schema.prisma](../../../frontend/prisma/schema.prisma) — existing models (User, Order, Withdrawal, OAuthAccount, …)
4. List of `frontend/src/app/api/**/route.ts` (the 40 existing routes)
5. The user's PRD if present at `.planning/PRD.md`

### Step 2 — Fetch designs from Banani MCP

The canonical Banani MCP tool (per the bundled `banani-design-implementation` skill) is:

```
mcp__banani__banani_get_selected_designs
```

- **Zero-argument call** — reads whatever screens the user has selected in the Banani editor, returns `{ html, css, tokens }` per screen
- **Optional `screenIds` param** (comma-separated) — for explicit fetches when the user names specific screens

There is **no `project_id` argument** — the MCP scopes to the user's current Banani session via the API key. If the user asks "from project X", that's a Banani-side selection task; tell the user to select the right screens in their Banani editor and re-invoke.

If the MCP returns empty / no screens: **stop and tell the user** "Sélectionne les écrans à importer dans Banani, puis relance-moi `/import-banani`."

For each screen returned, extract:

- **CTAs** (button text + intended action — login, submit form, navigate, delete, …)
- **Forms** (field names, types, submit endpoint hint)
- **Data-fetches** (lists, detail views, counts — what data does the screen render)
- **Auth gating** (logged-in only? admin only? public?)

If the HTML/CSS doesn't make the intent obvious, **ask the user**. Do not invent a backend contract from a button label.

### Step 3 — Reconcile design ↔ backend

Build a per-screen reconciliation table:

| Screen | CTAs / Forms / Data needed | Existing route match | Action |
|---|---|---|---|
| Login | email+password form → POST /signin | `POST /api/auth/login` | reuse |
| Dashboard | list user orders | none — needs `GET /api/orders/mine` | NEW |
| Settings → Delete account | DELETE button | none — needs `DELETE /api/auth/me` | NEW |

**Cross-reference [features.json](../../../.planning/features.json)** to identify prunable surfaces:

- Zero screen mentions payments → mark `payments-bictorys` + `withdrawals` + `webhooks-bictorys` as **PRUNABLE**
- Zero screen mentions OAuth → mark `oauth-google` as **PRUNABLE**
- Zero screen has admin views → mark `admin-backoffice` as **PRUNABLE**
- Zero screen has file uploads → mark `uploads-r2` as **PRUNABLE**

A surface marked PRUNABLE is a **suggestion** for the user — the actual deletion happens later via a future `gsd-prune-feature` (not shipped in v1; for now the user simply leaves the corresponding env vars empty, which makes the surface inert).

### Step 4 — Write `.planning/DESIGN-COVERAGE.md`

Use this exact structure (so the user scans in <5 min):

```markdown
# Design Coverage — <Project Name from PRD or Banani>

Generated by /import-banani on YYYY-MM-DD against starter v1.0.

## Summary

- N screens analyzed
- M existing routes reused (out of 40 shipped)
- K new routes to build
- J optional features prunable (env vars to leave empty)

## Per-screen reconciliation

[full table — one row per screen]

## Backend changes

### New routes (K)

- `POST /api/posts` — Body `{ title: string, body: string }`; auth: `requireAuth`; CSRF: required
- `GET /api/posts/:slug` — public; returns post + author
- ...

### New Prisma models (P)

- `Post { id, userId, slug @unique, title, body, createdAt, updatedAt }`
- ...

### New migrations

- `5_<feature_slug>.sql` — adds Post table

## Prunable surfaces (suggestions)

- `payments-bictorys` → leave `BICTORYS_API_KEY` empty in `.env.local` → `/api/orders` 404
- `oauth-google` → leave `GOOGLE_*` empty → `/api/auth/oauth/google/*` 404
- ...

## Recommended phases (auto-generated into ROADMAP.md)

- **Phase 1** — schema migration + new Prisma models
- **Phase 2** — new route handlers + Vitest tests
- **Phase 3** — UI reproduction via `banani-design-implementation` skill
- **Phase 4** — wire UI ↔ API
- **Phase 5** — final pass (`pnpm format && pnpm lint && pnpm typecheck && pnpm test`)
```

### Step 5 — Generate `.planning/ROADMAP.md` (GSD format)

The user has GSD installed — generate a ROADMAP.md in the format `gsd-execute-phase` consumes. Each phase has:

- `Goal:` (one sentence)
- `Success criteria:` (executable bash — `pnpm test && pnpm typecheck && curl -fsS …`)
- `Requirements:` (REQ-XX-NN identifiers used in the per-phase plans)
- `Depends on:` (previous phase numbers)

Match the existing style of the repo's [.planning/ROADMAP.md](../../../.planning/ROADMAP.md) (read it first to see the conventions the fork is using).

Hand off to the user with: "DESIGN-COVERAGE.md and ROADMAP.md ready. Read DESIGN-COVERAGE.md (5 min), then run `/gsd-execute-phase 1` when you're satisfied."

## Output contract

After invocation, the chat message must include:

1. **Screens fetched** — names + IDs returned by the MCP
2. **Routes reused / new / prunable** — one-line counts
3. **Files written** — `.planning/DESIGN-COVERAGE.md`, `.planning/ROADMAP.md`
4. **Open design questions** — anything you couldn't resolve from the design alone
5. **Next command** — `/gsd-execute-phase 1`

Keep it under 200 words. The detail lives in the two .md files.

## Anti-patterns to avoid

- ❌ Don't auto-execute the roadmap. Always wait for the user to read DESIGN-COVERAGE.md and confirm.
- ❌ Don't suggest pruning a feature unless ZERO screens reference it. False positives waste fork time.
- ❌ Don't add new routes when an existing one matches. The starter's 40 routes are battle-tested — reuse > rebuild.
- ❌ Don't break the protected-file list (CLAUDE.md "Files Claude must NOT modify"). New requirements always extend, never modify the protected libs.
- ❌ Don't invent a `project_id` argument for the Banani MCP. The MCP reads the user's current selection or accepts `screenIds` — that's it.
- ❌ Don't implement UI in this skill. The UI reproduction is the `banani-design-implementation` skill's job (Phase 3 of the generated roadmap).

## Limitations (v1)

- The CTA / form / data-fetch extractor is heuristic — relies on Banani's HTML/CSS output. Low-confidence matches must be flagged with `CONFIDENCE: LOW` in the per-screen row and escalated to the user.
- No auto-rollback if the user pivots mid-execution. Re-run `/import-banani` to regenerate `DESIGN-COVERAGE.md` + `ROADMAP.md` from scratch.
- Banani MCP package name in `.mcp.json` is a placeholder (`@banani/mcp-server`). The fork-author must swap it to whatever Banani actually publishes.
