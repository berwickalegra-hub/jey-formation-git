# SIMPLIFY-AUDIT — radical simplification of `izi kit` for vibe coders

> **Audience.** A beginner clones the repo, plugs in a Neon `DATABASE_URL`, opens Claude Code, says "build me X in French," and ships. Anything that demands prior knowledge (GSD, Banani, R2/Cloudflare, slash-command memorization) is friction.
>
> **Mandate.** Identify exactly what to cut / make optional / refactor to deliver that pitch. Each section is concrete: paths + line numbers + risk.

---

## 1. Inventory of GSD coupling

### 1a. Docs that mention GSD as required/canonical

| File | Lines | Status | What it says |
|---|---|---|---|
| `README.md` | 18 | **canonical** | "Auto-install … GSD via `npx` …" |
| `README.md` | 22 | **canonical** | hand-off to "`/gsd-execute-phase` ship le code" |
| `README.md` | 24 | **canonical** | "Pré-requis … **Get Shit Done (GSD)** installable via `npx`" |
| `README.md` | 199 | mention | import-banani produces "ROADMAP.md prêt pour `/gsd-execute-phase`" |
| `README.md` | 220 | mention | tree comment says ".planning/ … (workflow GSD)" |
| `WORKFLOW.md` | 19 | **canonical** | audit lists "skills Claude Code (GSD, …)" |
| `WORKFLOW.md` | 20 | **canonical** | auto-install GSD via `npx` |
| `WORKFLOW.md` | 33–41 | **canonical** | ASCII diagram steps 3→4 = `/import-banani` → `/gsd-execute-phase` |
| `WORKFLOW.md` | 90–103 | **canonical** | "Étape 4 — Implémenter" is *defined* as `/gsd-execute-phase N` |
| `WORKFLOW.md` | 149 | mention | "/import-banani est un skill du starter — pas une commande GSD-native" |
| `WORKFLOW.md` | 151 | mention | "saute Banani, lance `/gsd-discuss-phase 1` directement" |
| `PRUNING.md` | n/a | none | (no GSD coupling) |
| `CLAUDE.md` | 22 | mention | "GSD updates `.planning/PROJECT.md` after each phase" |
| `CLAUDE.md` | 27 | mention | beginner workflow points at WORKFLOW.md |
| `.claude/skills/setup-kit/SKILL.md` | 14 | **canonical** | "WORKFLOW.md lists ~8 pre-requisites … 4 Claude Code skills" — incl. GSD |
| `.claude/skills/setup-kit/SKILL.md` | 56 | **canonical** | audit step: `gsd-*` family must appear in active skills |
| `.claude/skills/setup-kit/SKILL.md` | 105–113 | **canonical** | Phase 2 auto-runs `npx get-shit-done-cc@latest` |
| `.claude/skills/setup-kit/SKILL.md` | 200–207 | **canonical** | hand-off says "tape `/gsd-execute-phase 1`" |
| `.claude/skills/import-banani/SKILL.md` | 16 | **canonical** | "user reads … then runs `/gsd-execute-phase 1`" |
| `.claude/skills/import-banani/SKILL.md` | 27 | **canonical** | pre-req: "GSD installed user-side" — stop if missing |
| `.claude/skills/import-banani/SKILL.md` | 142–153 | **canonical** | output is "ROADMAP.md in the format `gsd-execute-phase` consumes" |
| `.claude/skills/import-banani/SKILL.md` | 163 | **canonical** | next-command line: `/gsd-execute-phase 1` |

### 1b. `.planning/` content that exists only because of GSD conventions

| Path | Purpose | Beginner needs it? |
|---|---|---|
| `.planning/PROJECT.md` | GSD project state | NO |
| `.planning/STATE.md` | GSD workflow state | NO |
| `.planning/ROADMAP.md` | GSD phase roadmap | NO |
| `.planning/REQUIREMENTS.md` | GSD requirements doc | NO |
| `.planning/config.json` | GSD CLI config | NO |
| `.planning/codebase/{STACK,ARCHITECTURE,STRUCTURE,CONVENTIONS,INTEGRATIONS,TESTING,CONCERNS}.md` | GSD codebase intel | NO |
| `.planning/research/{STACK,ARCHITECTURE,PITFALLS,SUMMARY,FEATURES}.md` | GSD research outputs | NO |
| `.planning/phases/00-foundation/…/.planning/phases/07-final-pass/…` | per-phase plan/research/verification artifacts | NO — historical |
| `.planning/features.json` | machine manifest of optional surfaces | **YES** — used by pruning protocol, independent of GSD |

`.claude/worktrees/agent-*` directories are GSD-spawned subagent sandboxes (visible in `grep` output). They are working scratch and should not be shipped in a template repo.

### 1c. import-banani's coupling to `/gsd-execute-phase`

`import-banani` cannot run standalone — by its own pre-req list (line 27) it **refuses to proceed** if GSD is not installed. Its single output (`ROADMAP.md`) is "format `gsd-execute-phase` consumes" (line 144). Removing GSD from the beginner path therefore **breaks `import-banani`** as currently designed — it would need to either:

- Be rewritten to emit a plain text plan (Markdown to-do list) the user pastes back to Claude, OR
- Be deleted alongside GSD and the Banani path simplified to "select screens → `/import-banani` produces a coverage report only → ask Claude to build screen-by-screen."

### 1d. What changes if GSD becomes "level up later"

| Touchpoint | Action |
|---|---|
| `README.md` lines 18, 22, 24, 199, 220 | rewrite — GSD removed from pre-reqs and hand-off |
| `WORKFLOW.md` entire file | rewrite — "Étape 4" no longer = `/gsd-execute-phase`; becomes "describe what you want to Claude" |
| `setup-kit` Phase 2 (lines 105–113) | drop the `npx get-shit-done-cc@latest` auto-install |
| `setup-kit` Phase 0 audit (line 56) | drop the `gsd-*` skill check |
| `setup-kit` final hand-off (line 207) | replace `/gsd-execute-phase 1` with "describe ton premier écran" |
| `import-banani` skill | delete OR rewrite to a non-GSD output |
| `.planning/PROJECT.md`, `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `config.json`, `codebase/`, `research/`, `phases/` | delete (keep only `features.json` + new `SIMPLIFY-AUDIT.md`) |
| `CLAUDE.md` lines 22, 27 | reword from "GSD updates PROJECT.md" → "level-up later" mention |

**No code in `frontend/` references GSD.** It's 100% docs + `.planning/`.

---

## 2. Inventory of R2 coupling (Cloudinary swap target)

### 2a. Files that import `@aws-sdk/client-s3` or use `R2_*`

| File | Lines | Role | Touched by swap |
|---|---|---|---|
| `frontend/src/lib/server/storage.ts` | 130 | S3Client wrapper (`PutObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`, `NoSuchKey`) | **rewrite** — new Cloudinary client (likely `cloudinary` SDK or REST POST to `/api/upload`) |
| `frontend/src/lib/server/upload/r2-client.ts` | 107 | thin lazy-init around `storage.ts` | **rewrite or delete** |
| `frontend/src/lib/server/upload/sniff.ts` | 94 | magic-byte MIME validation (`verifyMagicBytes`) | **keep** — Cloudinary doesn't substitute for server-side validation |
| `frontend/src/lib/server/upload/sanitize-filename.ts` | 14 | path-traversal guard | **keep** |
| `frontend/src/app/api/upload/route.ts` | 173 | pipeline: CSRF → auth → R2-init → MIME → sniff → R2 PUT → DB row | **rewrite** — either signed-upload URL (preferred: client uploads direct to Cloudinary) or proxy POST through here |
| `frontend/src/app/api/upload/route.test.ts` | 195 | tests the full pipeline with `r2-mock` | **rewrite** |
| `frontend/src/app/api/files/[...key]/route.ts` | 142 | owner-gated R2 stream proxy + cache-control | **delete or rewrite** — Cloudinary URLs are public/signed; proxy is redundant unless private uploads are required |
| `frontend/src/app/api/files/[...key]/route.test.ts` | 167 | proxy tests | **delete or rewrite** |
| `frontend/src/test-utils/r2-mock.ts` | 63 | vitest mock for S3Client | **rewrite** as `cloudinary-mock.ts` |
| `frontend/next.config.ts` | n/a | references R2 in image domain allowlist | **edit** — add `res.cloudinary.com` |
| `frontend/package.json` line 25 | n/a | `"@aws-sdk/client-s3": "^3.1045.0"` | **swap** to `cloudinary` (or `next-cloudinary`) |
| `frontend/prisma/schema.prisma` lines 167–180 (`model FileUpload`) | n/a | `key String @unique // R2 object key` | **rename field** `key` → `publicId` (Cloudinary terminology); or add `provider String` for forward-compat |
| `frontend/prisma/schema.prisma` line 38 | n/a | `uploads FileUpload[]` on `User` | **keep** (model survives) |

### 2b. Env-vars touched

| File | Var | Action |
|---|---|---|
| `frontend/.env.example` | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_PUBLIC_URL` | replace with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_PRESET` |
| `frontend/.env.example` | `UPLOAD_ALLOWED_MIME`, `UPLOAD_MAX_BYTES` | **keep** — still apply at MIME/size guard |

### 2c. Docs to update

| File | Lines | Action |
|---|---|---|
| `README.md` | 48 | "Cloudflare R2 / S3 (storage)" → "Cloudinary (storage/media)" |
| `README.md` | 68 | env table row for `R2_*` → `CLOUDINARY_*` |
| `README.md` | 118–119 | "Uploads + Files" section — drop `/api/files/[...key]` if proxy removed |
| `WORKFLOW.md` | 137 | "Uploads R2 → … 503 STORAGE_NOT_CONFIGURED" → swap to Cloudinary |
| `WORKFLOW.md` | 125 | env-vars deploy list (R2_*) → Cloudinary |
| `CLAUDE.md` | search for `R2_*` references | rewrite to Cloudinary |
| `PRUNING.md` | refers to `features.json` only | no direct change |
| `.planning/features.json` lines 107–131 (`uploads-r2`) | feature key + envVars | rename to `uploads-cloudinary`, update envVars list |
| `.claude/skills/setup-kit/SKILL.md` line 175 | "Upload de fichiers Cloudflare R2 …" | "Cloudinary …" |

### 2d. Effort estimate

- **Storage swap**: ~3–4 h. The `StorageClient` interface (lines 1–10 of `storage.ts`) is "narrow on purpose" by author intent — drop-in Cloudinary impl is feasible. Real cost is rewriting the 173-line `route.ts` pipeline + 195-line test file + 167-line proxy test file.
- **Schema migration**: ~30 min. Rename `FileUpload.key → publicId`, run `pnpm db:migrate:dev --name swap_r2_to_cloudinary`.
- **Docs**: ~1 h.
- **Tripwire updates**: ~30 min — `env-shape.test.ts` has verbatim `R2_*` assertions (see §6).

**Total: ~5–6 h** including tests passing and `pnpm build` green.

### 2e. Subtle invariants that don't trivially map

| Invariant | Issue | Recommendation |
|---|---|---|
| Magic-byte sniff happens **server-side BEFORE PutObject** (`upload/route.ts` D-UP-04 ordering) | If Cloudinary uses **direct-from-browser signed-upload URLs**, the magic-byte check is bypassed — Cloudinary becomes the only validator | Keep proxy upload model (browser → `/api/upload` → Cloudinary) initially. Adopt signed direct-upload only if perf demands. |
| `/api/files/[...key]` is **owner-gated**: only the row owner can fetch (`FileUpload.userId` check) | Cloudinary URLs are by default public; private requires "Authenticated delivery" tier + signed URLs | If beginner project doesn't need private files → drop the proxy. If yes → use Cloudinary signed-URL minting in a new route. |
| `Cache-Control` semantics on proxy | not replicated by Cloudinary directly | low-stakes — Cloudinary CDN handles it. |
| The `StorageClient` interface (line ~15 of `storage.ts`) is a "narrow on purpose" abstraction | this is the swap point — `storage.ts` is the only file that needs to know "R2 vs Cloudinary" | **good news** — clean cut. |
| `r2-mock.ts` test fixtures | Vitest tests assume `S3Client.send(...)` semantics | rewrite as `cloudinary-mock.ts` returning `{ public_id, secure_url, bytes }` |

---

## 3. Inventory of Banani-as-mandatory

### 3a. Where Banani is canonical vs optional

| File | Lines | Tone |
|---|---|---|
| `WORKFLOW.md` | 21, 33–41 | **canonical** — diagram makes Banani steps 2–3 of 4 |
| `WORKFLOW.md` | 53–88 | **canonical** — full "Étape 2 — Designer sur Banani" + "Étape 3 — Réconcilier" sections |
| `WORKFLOW.md` | 151 | escape hatch — "si tu n'utilises pas Banani, saute les étapes 2-3" (one line, easy to miss) |
| `README.md` | 19 | **canonical** — "puis Banani si tu utilises le design import" |
| `README.md` | 22 | **canonical** — hand-off mentions Banani steps |
| `README.md` | 192–203 | mention — 3 of 4 bundled skills are Banani-related |
| `CLAUDE.md` | 24, 25 | **canonical** — `.mcp.json` declared as Banani server; `/import-banani` listed as starter skill |
| `CLAUDE.md` | 26 | **canonical** — describes import-banani output going through GSD |
| `.mcp.json` | 1–13 | **canonical** — only MCP server declared is Banani; setup-kit step 5 walks user through this |
| `.claude/skills/setup-kit/SKILL.md` | 51, 78–79, 154–165 | **canonical** — Phase 5 = "Banani MCP setup" (config write + restart) |
| `.claude/skills/setup-kit/SKILL.md` | 80–84 | mention — "Comptes (action humaine requise) Banani" in audit checklist |
| `.claude/skills/import-banani/SKILL.md` | full file (180 lines) | **canonical** — entire skill assumes Banani is in the path |
| `.claude/skills/banani-design-implementation/SKILL.md` | 279 lines | optional — fires only when user types "build this from Banani" |

### 3b. Skill files

| Skill | Beginner needs it? |
|---|---|
| `setup-kit` | YES — but Phase 5 (Banani) should be optional/skippable |
| `import-banani` | NO — Banani is one path among many; this skill assumes Banani is the only path |
| `banani-design-implementation` | NO — but harmless, fires only on explicit user trigger ("build from Banani") |
| `ui-ux-pro-max` | YES — generic design intelligence, no Banani coupling |

### 3c. If Banani becomes "do you have a design? if no, just describe"

- `WORKFLOW.md` collapses from 4 steps to **2 steps** (PRD optional + describe-to-Claude).
- `README.md` lines 19, 22, 192–203 collapse.
- `.mcp.json` should ship empty (`{"mcpServers": {}}`) with a comment "add Banani here if you use it."
- `import-banani` skill is deleted (or quarantined under `.claude/skills/optional/`).
- `setup-kit` Phase 5 becomes optional question: "Tu as un design Banani ? oui/non" — if no, skip.
- `banani-design-implementation` skill stays — zero cost, fires only on explicit trigger.

---

## 4. The irreducible "vibe coding" core

### 4a. MUST stay (load-bearing for `pnpm dev` to function)

| Surface | Why |
|---|---|
| `frontend/` Next.js app | the product |
| `frontend/src/app/api/auth/*` (10 routes) | signup/login/verify/refresh — `features.json` core |
| `frontend/src/lib/server/{auth,crypto,redis,rate-limit-store,prisma,env,zod-helpers}.ts` | infrastructure primitives |
| `frontend/src/lib/server/middleware/*` | requireAuth + CSRF |
| `frontend/src/lib/server/observability/*` | runtime-enforcement tripwire + request-context |
| `frontend/src/lib/server/outbox/*` + `frontend/src/app/api/cron/outbox-drain/route.ts` | core infra (also required by email queue) |
| `frontend/prisma/schema.prisma` + migrations | DB |
| `frontend/.env.example` (minimal vars) | onboarding doc |
| `frontend/vercel.json` (5 cron entries — pruned per features.json) | deploy contract |
| `CLAUDE.md` (slimmed) | session context for Claude |
| `.planning/features.json` | pruning manifest |
| `PRUNING.md` | pruning protocol |

### 4b. CAN go without breaking anything functional

| Surface | Status | Why |
|---|---|---|
| `.planning/PROJECT.md`, `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `config.json`, `phases/`, `codebase/`, `research/` | GSD artifacts | beginner doesn't open these |
| `.claude/worktrees/agent-*` | GSD subagent scratch | working state — should never ship |
| `WORKFLOW.md` | docs | rewriteable to 1 page; current 152 lines is overkill |
| `STATUS.md` | docs | historical port log — keep or move to `docs/` |
| `.claude/skills/import-banani/` | optional skill | not used without GSD + Banani |
| `examples/frontend-pages/` | reference UI snippets | keep — useful for vibe coding |

### 4c. Already env-gated (no work needed — beginner just leaves them empty)

| Surface | Behavior when empty |
|---|---|
| Sentry | silent no-op |
| Bictorys (payments) | `/api/orders` returns 404 |
| Google OAuth | `/api/auth/oauth/google/*` returns 404 |
| Resend | email rows accumulate in queue (drain when key arrives) |
| Upstash Redis | in-memory fallback with `log.warn` (dev OK, not prod) |
| R2 | `/api/upload` returns 503 `STORAGE_NOT_CONFIGURED` |
| Admin | requires `pnpm db:make-superadmin` invocation to activate |

**Beginner needs to know:** *only* `DATABASE_URL` is truly required to run `pnpm dev`. `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` are also non-empty requirements but `setup-kit` auto-generates them.

---

## 5. Proposed cut list — prioritized

### Legend

- **Action**: `delete` | `optional` | `rewrite` | `leave`
- **Effort**: `5m` | `30m` | `1h` | `2h` | `1d`
- **Risk**: `none` | `tripwire-edit` | `test-rewrite` | `build` | `user-visible`
- **Order**: `do-first` | `do-second` | `do-later`

### 5a. Cut list

| # | What | Action | Effort | Risk | Order | Notes |
|---|---|---|---|---|---|---|
| 1 | `.planning/{PROJECT,STATE,ROADMAP,REQUIREMENTS}.md`, `config.json`, `phases/`, `codebase/`, `research/` | delete | 5m | none | do-first | Pure docs. Keeps `features.json`. |
| 2 | `.claude/worktrees/agent-*/` (6 directories) | delete | 5m | none | do-first | GSD scratch — must not ship. |
| 3 | `WORKFLOW.md` | rewrite | 1h | tripwire-edit | do-first | Cut to ~30 lines: "Décris à Claude ce que tu veux." Removes GSD/Banani as mandatory. |
| 4 | `README.md` lines 9–24, 192–203, 220 (setup-kit + skills + tree comment) | rewrite | 1h | tripwire-edit (`readme-shape`) | do-first | Drop GSD pre-req mention. Drop Banani from canonical path. **Caution**: tripwire requires `pnpm install`/`pnpm dev`/`neon.tech`/`CRON_SECRET`/`pnpm smoke:auth`/`frontend/src/app/api/` mentions to STAY (see §6). |
| 5 | `.claude/skills/setup-kit/SKILL.md` — drop Phase 2 GSD auto-install + Phase 5 Banani as required | rewrite | 1h | none | do-first | Phase 2 keeps `superpowers` + `context-mode` paste commands; drops `npx get-shit-done-cc`. Phase 5 asks "Banani ou pas ?" — skip if no. |
| 6 | `.claude/skills/import-banani/` (entire skill) | delete | 5m | none | do-second | Cannot run without GSD; coupled to a path we're dropping. If `banani-design-implementation` stays, users can still build from Banani by typing "use Banani MCP". |
| 7 | `CLAUDE.md` lines 22, 27 (GSD mention) + lines 24, 25 (Banani mention) | rewrite | 30m | tripwire-edit (`claude-md-shape`) | do-first | The tripwire enforces presence of `cron`/`webhook`/`withdrawal`/`upload` — none of GSD/Banani are tripwire-protected. |
| 8 | `.mcp.json` | rewrite to empty / commented | 5m | none | do-second | Ship `{"mcpServers": {}}` with comment "Add MCPs (e.g. Banani) here". |
| 9 | **R2 → Cloudinary swap** | rewrite | 5–6h | test-rewrite + tripwire-edit (`env-shape`) + build | do-second | The big one. See §2. `env-shape.test.ts` has hard-coded `R2_*` regex (lines ~67–73) — must update. `features.json` `uploads-r2` entry renames. `next.config.ts` image domains. `package.json` swap `@aws-sdk/client-s3` → `cloudinary`. |
| 10 | `STATUS.md` | move to `docs/STATUS.md` or delete | 5m | none | do-later | Historical port log; not in beginner path. |
| 11 | `.planning/features.json` | edit | 30m | none | do-second | Rename `uploads-r2` → `uploads-cloudinary`; remove GSD-related fields (none currently). |
| 12 | `.claude/skills/banani-design-implementation/` | leave | 0 | none | n/a | Optional, zero-cost when not triggered. Good UX when user *does* have Banani. |
| 13 | `examples/frontend-pages/` | leave | 0 | none | n/a | Helpful reference for vibe coding. |
| 14 | `PRUNING.md` | edit minor | 15m | none | do-later | Replace "/import-banani flags PRUNABLE" with "your AI agent flags PRUNABLE." |

### 5b. Suggested commit shape

1. **Commit 1**: `chore: remove GSD/Banani as mandatory pre-reqs` — items 1, 2, 3, 4, 5, 7, 8, 14.
2. **Commit 2**: `chore: remove import-banani skill (GSD-coupled)` — item 6.
3. **Commit 3**: `feat: swap Cloudflare R2 storage for Cloudinary` — items 9, 11 (+ tripwire updates).
4. **Commit 4**: `chore: archive STATUS.md` — item 10.

---

## 6. Tripwire warnings

Doc-shape tests under `frontend/src/lib/server/observability/*-shape.test.ts` will **fail CI** if certain content disappears from docs. Each cut above that touches a tripwired file must update the test alongside.

### 6a. Tripwire inventory

| Test file | Locked file | Assertions in scope |
|---|---|---|
| `claude-md-shape.test.ts` | repo-root `CLAUDE.md` | (1) file exists; (2) no errant `Express` references (negation allowed); (3) no `backend/src` references; (4) no `express.json(` calls; (5) no `middleware-order` references; (6) **must contain mentions of `cron`/`webhook`/`withdrawal`/`upload`** |
| `readme-shape.test.ts` | repo-root `README.md` | (1) file exists; (2) **must match** `cp .env.example .env.local`, `pnpm install`, `pnpm dev`; (3) **must mention** `neon.tech`; (4) **zero Docker references**; (5) **must point** at `frontend/src/app/api`; (6) **must mention** `CRON_SECRET`; (7) no errant Express refs; (8) **must mention** `pnpm smoke:auth` / `smoke-auth` |
| `vercel-json-shape.test.ts` | `frontend/vercel.json` | (1) file exists; (2) exactly 5 cron schedules; (3) every path matches `/^\/api\/cron\/[a-z][a-z0-9-]*$/`; (4) every path has a matching `route.ts` file; (5) declares the 5 canonical Phase-5 crons |
| `env-shape.test.ts` | `frontend/.env.example` | (1) `DATABASE_URL="postgresql://…-pooler.<region>.aws.neon.tech…`; (2) `DIRECT_URL` documented; (3) `CRON_SECRET=""` with `openssl rand -base64 32` hint; (4) explains `migrate deploy`; (5) **verbatim** `⚠️ FINANCIAL-SAFETY WARNING — DO NOT CASUALLY DISABLE ⚠️` block; (6) **verbatim** `WITHDRAWAL_BALANCE_CHECK="1"`; (7) **verbatim** `UPLOAD_ALLOWED_MIME="image/jpeg,image/png,image/webp"` + `UPLOAD_MAX_BYTES="10485760"`; (8) **verbatim** `R2_ACCOUNT_ID=""`, `R2_BUCKET=""`, `R2_ACCESS_KEY_ID=""`, `R2_SECRET_ACCESS_KEY=""`, `R2_ENDPOINT=""` |
| `instrumentation-shape.test.ts` | `frontend/instrumentation.ts` | (1) imports `registerOTel` from `@vercel/otel`; (2) calls `registerOTel({ serviceName: 'izikit' })`; (3) re-exports `onRequestError` from `@sentry/nextjs`; (4) no `export default`; (5) Sentry imports inside `register()` |
| `next-config-clean.test.ts` | `frontend/next.config.ts` | (1) does NOT contain deprecated `experimental.instrumentationHook` |
| `schema-direct-url.test.ts` | `frontend/prisma/schema.prisma` | (1) datasource declares `directUrl = env("DIRECT_URL")` |
| `runtime-enforcement.test.ts` | every `frontend/src/app/api/**/route.ts` | (1) at least one route file discovered; (2) for each route — **must** `export const runtime = 'nodejs'`; (3) **must NOT** export runtime='edge' |

### 6b. Tripwire impact map per cut

| Cut # | Tripwire affected | Action |
|---|---|---|
| 1 (`.planning/` deletion) | none | safe |
| 2 (worktrees) | none | safe |
| 3 (rewrite WORKFLOW.md) | none | safe — no shape test |
| 4 (rewrite README.md) | `readme-shape.test.ts` — assertions 2–7 | **keep** mentions of `pnpm install` + `pnpm dev` + `neon.tech` + `CRON_SECRET` + `frontend/src/app/api` + `pnpm smoke:auth`. Drop Docker (already absent). |
| 5 (setup-kit skill) | none | safe |
| 6 (delete import-banani) | none | safe |
| 7 (CLAUDE.md edits) | `claude-md-shape.test.ts` — assertion 6 | **keep** mentions of `cron`/`webhook`/`withdrawal`/`upload`. Removing GSD lines doesn't touch these. |
| 8 (`.mcp.json`) | none | safe |
| 9 (R2 → Cloudinary) | `env-shape.test.ts` — assertion 8 | **MUST UPDATE** the test: replace `R2_*=""` assertions with `CLOUDINARY_*=""` assertions. Also update `vercel-json-shape.test.ts` if any cron is renamed (none in scope — upload has no cron). |
| 10 (STATUS.md) | none | safe |
| 11 (features.json) | none | safe |

### 6c. Tripwires to DELETE (none recommended)

All 8 tripwires protect load-bearing invariants and should stay. The R2 swap is the only cut that requires a tripwire **edit** (not delete).

---

## 7. TL;DR — recommended first sprint (3–5 highest-leverage, lowest-risk cuts)

These can ship in **one commit, ~2h work**, before any code refactor:

1. **Delete `.planning/{PROJECT,STATE,ROADMAP,REQUIREMENTS}.md` + `config.json` + `phases/` + `codebase/` + `research/`** — GSD artifacts beginners never open. `features.json` + `SIMPLIFY-AUDIT.md` (this file) stay. 5min, zero risk.

2. **Delete `.claude/worktrees/agent-*/` (6 directories)** — GSD subagent scratch; should never have been committed. 5min, zero risk.

3. **Rewrite `WORKFLOW.md` to ~30 lines**: "describe-to-Claude" is Étape 1, deployment is Étape 2. Banani and GSD become a short "Level up later" section. ~1h, no tripwire impact.

4. **Rewrite `README.md` lines 9–24** to drop GSD as a pre-req and Banani from the canonical path. Keep all tripwire-locked mentions (`pnpm install`, `pnpm dev`, `neon.tech`, `CRON_SECRET`, `frontend/src/app/api`, `pnpm smoke:auth`, no Docker). ~30min. Run `pnpm test` after.

5. **Edit `.claude/skills/setup-kit/SKILL.md`** to (a) drop the GSD auto-install in Phase 2 (line 105–113), (b) make Banani Phase 5 optional ("oui/non/plus tard"), (c) drop the `gsd-*` skill from the audit checklist (line 56). ~30min, no tripwire impact.

After this first sprint, the beginner experience is: clone → `/setup-kit` → paste Neon URL → done → "Claude, build me a SaaS for X." The R2 → Cloudinary swap (5–6h) can be a **second sprint** since it touches a tripwire and rewrites 4 test files.

---

*Audit author: Claude, 2026-05-14. Read-only audit — no code modified.*
