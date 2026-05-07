---
phase: 00-foundation
plan: 02
subsystem: infra
tags: [neon, prisma, env, database, cron, foundation, monolith]

# Dependency graph
requires:
  - phase: 00-foundation
    plan: 01
    provides: "frontend/src/lib/server/observability/ directory + Vitest config"
  - phase: 00-foundation
    provides: "context (CONTEXT.md D-01, D-02, D-03, D-09, D-10, D-19, D-20, D-21) + research (RESEARCH.md Pattern 1 lines 217-242, Example 2 lines 543-549)"
provides:
  - ".env.example documents Neon dual-URL contract (DATABASE_URL pooler + DIRECT_URL direct) + CRON_SECRET"
  - "frontend/prisma/schema.prisma datasource declares directUrl = env(\"DIRECT_URL\")"
  - "@prisma/client regenerated against the directUrl-aware datasource"
  - "Two assertion tests pinning both contracts (CI fails if a future contributor deletes either)"
affects: [00-03 (instrumentation can assume DIRECT_URL convention), 00-04 (CRON_SECRET present as Vercel cron auth lands), 01+ (every Phase 1+ plan can assume DATABASE_URL/DIRECT_URL shape without re-deciding)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-URL Neon datasource: pooler URL for runtime queries (connection_limit=1 caps per-instance pool to 1), direct URL for migrations (prevents pool exhaustion on long DDL)"
    - "Comment-driven rationale in .env.example next to each var so future contributors don't delete DIRECT_URL or weaken connection_limit without seeing why it exists"
    - "Single shared CRON_SECRET across all Phase 5 cron routes (D-10) — one secret, one rotation point"
    - "import.meta.url + fileURLToPath for path resolution in Vitest tests so they work under ESM and CJS configs identically"

key-files:
  created:
    - "frontend/src/lib/server/observability/env-shape.test.ts"
    - "frontend/src/lib/server/observability/schema-direct-url.test.ts"
  modified:
    - ".env.example (DATABASE_URL replaced with Neon -pooler shape; DIRECT_URL added; CRON_SECRET added; Express-era vars preserved for Phase 6 DOC-02 to rewrite)"
    - "frontend/prisma/schema.prisma (datasource block gained directUrl = env(\"DIRECT_URL\"))"

key-decisions:
  - "Fixed regex bug in plan-supplied env-shape.test.ts (Rule 1 deviation): the Neon -pooler hostname has ONE region segment (us-east-2), not two. Updated regex from `-pooler\\.[a-z0-9-]+\\.[a-z0-9-]+\\.aws\\.neon\\.tech` to `-pooler\\.[a-z0-9-]+\\.aws\\.neon\\.tech` to match plan key_links pattern + the actual URL shape in .env.example."
  - "Used import.meta.url + fileURLToPath instead of bare __dirname in test files: Vitest's loader can run TS as ESM where __dirname is undefined; this defensive shape works in both module systems."
  - "Did NOT commit anything for Task 3: prisma generate writes to node_modules/ (gitignored); per plan instructions Task 3 has no <files> to commit. Verification confirmed exit 0 + client resolves + tsc passes."

patterns-established:
  - "Plan-supplied tests with regex assertions MUST be sanity-checked against the source-of-truth file before claiming green: a plan can carry a typo in a regex and the executor catches it on first run."
  - "When a test asserts file contents from a sibling subdirectory, prefer fileURLToPath(import.meta.url) over bare __dirname — Vitest config alone doesn't guarantee a Node-CJS context."

requirements-completed:
  - OPS-01
  - OPS-04

# Metrics
duration: 4min
completed: 2026-05-07
---

# Phase 0 Plan 02: Neon Connection Contract + CRON_SECRET Summary

**Locked the Neon-on-Vercel database-connection contract: `.env.example` now documents the dual `DATABASE_URL` (pooler) + `DIRECT_URL` (direct) shape with `connection_limit=1` and the rationale for both, `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")` so migrations bypass PgBouncer, the Prisma client is regenerated, and two Vitest assertions pin both contracts so a future contributor cannot silently delete `DIRECT_URL` or weaken pool sizing without CI failing.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-07T19:24:25Z
- **Completed:** 2026-05-07T19:27:32Z
- **Tasks:** 4
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `.env.example` carries the verbatim 3-block from RESEARCH.md Pattern 1 (lines 226–242): `DATABASE_URL` with the `-pooler.us-east-2.aws.neon.tech` host + `pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`, `DIRECT_URL` with the non-pooler host, `CRON_SECRET=""` with the `openssl rand -base64 32` hint and `(Phase 5)` cross-reference. Express-era vars (`BACKEND_URL`, `NEXT_PUBLIC_API_URL`, `GOOGLE_REDIRECT_URI`) preserved untouched per D-21 / canonical_refs — Phase 6 DOC-02 owns their removal.
- `frontend/prisma/schema.prisma` `datasource db {}` block now declares `directUrl = env("DIRECT_URL")` next to the existing `url = env("DATABASE_URL")` — exact RESEARCH.md Example 2 shape.
- `pnpm --filter frontend exec prisma generate` exits 0 against the new schema; `node -e "require('@prisma/client')"` resolves cleanly; `pnpm --filter frontend exec tsc --noEmit` exits 0 (no Prisma client type-shape regression).
- Two new Vitest tests under `frontend/src/lib/server/observability/`:
  - `env-shape.test.ts` — 5 expectations covering the `-pooler` hostname, all four pool params, `DIRECT_URL` presence, `CRON_SECRET=""`, openssl hint, and the `migrate deploy` rationale comment (D-03 anti-deletion guard).
  - `schema-direct-url.test.ts` — 3 expectations covering provider, `url`, and `directUrl` (the last asserted to be INSIDE the `datasource db {}` block, not just somewhere in the file).
- Combined test runtime: 5ms across 8 expectations; full `pnpm --filter frontend test` exits 0.
- All four tasks committed atomically with `(monolith)` scope.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Update .env.example with Neon dual-URL + CRON_SECRET | `1c48afa` | feat |
| 2 | Add directUrl to frontend/prisma/schema.prisma | `0ffc900` | feat |
| 3 | [BLOCKING] Run prisma generate | (no commit — node_modules) | — |
| 4 | Write env-shape.test.ts + schema-direct-url.test.ts | `3bffea1` | test |

## Verification Results

| Step | Command | Result |
|------|---------|--------|
| 1 | `pnpm --filter frontend exec vitest run …observability/{env-shape,schema-direct-url}.test.ts` | 8/8 pass in 5ms |
| 2 | `grep -c '\-pooler\.' .env.example` | 1 |
| 3 | `grep -c 'directUrl' frontend/prisma/schema.prisma` | 1 |
| 4 | `pnpm --filter frontend exec prisma generate` (idempotent re-run) | exit 0, client regenerated |
| 5 | `pnpm --filter frontend exec tsc --noEmit` | exit 0 |
| 6 | Express-era vars (`BACKEND_URL`, `NEXT_PUBLIC_API_URL`, `GOOGLE_REDIRECT_URI`) preserved | 4 grep hits — present |
| 7 | `pnpm --filter frontend test` (full suite) | 8/8 pass, exit 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Fixed broken hostname regex in plan-supplied env-shape.test.ts**

- **Found during:** Task 4 (TDD-style first run after writing both test files)
- **Issue:** The plan-supplied regex was `/-pooler\.[a-z0-9-]+\.[a-z0-9-]+\.aws\.neon\.tech/` (two `[a-z0-9-]+` segments before `.aws.neon.tech`). The Neon `-pooler` hostname has ONE region segment (e.g. `us-east-2`), not two — so the regex never matched. The plan's own `key_links` frontmatter even spells out the correct pattern: `-pooler\.[a-z0-9-]+\.aws\.neon\.tech` (single segment).
- **Fix:** Replaced the regex with the single-segment form and added an inline comment naming the expected hostname shape so a future reader doesn't re-introduce the bug.
- **Files modified:** `frontend/src/lib/server/observability/env-shape.test.ts` (one regex line)
- **Commit:** Folded into the Task 4 commit `3bffea1` (the test never landed in CI with the broken regex)
- **Why no Rule 4 (architectural) escalation:** This was a 30-second test-regex correction, not a structural change. The intent (assert the `-pooler` hostname is present) is unchanged; only the shape of the assertion needed alignment with the actual file content.

### Architectural Adjustments

None.

### Authentication Gates

None — this plan only touches local files, no external service auth needed.

## Threat Model Application

Phase 0 plan 02 threat register (from PLAN.md `<threat_model>`):

| Threat | Disposition | Implementation evidence |
|--------|-------------|-------------------------|
| T-0-04 (Postgres connection exhaustion) | mitigate | `DATABASE_URL` template carries `connection_limit=1` + `-pooler` host; env-shape.test.ts asserts both. CI breaks if either is removed. |
| T-0-03 (`CRON_SECRET` leak) | accept | `.env.example` ships `CRON_SECRET=""` (empty default); rationale comment present; Phase 5 wires actual cron auth. No leak vector introduced at Phase 0. |
| T-0-04b (`DIRECT_URL` accidental deletion) | mitigate | Multi-line rationale comment above DIRECT_URL ("REQUIRED for `prisma migrate deploy`. The pooler exhausts on long-lived migrations…"). schema-direct-url.test.ts asserts the schema-side declaration. env-shape.test.ts asserts the env-side declaration AND the `migrate deploy` rationale comment. Three independent failure points = accidental removal is CI-failing. |

## Known Stubs

None. Both `.env.example` template URLs are explicit placeholder shapes (`postgresql://user:pass@ep-xxx-pooler...`) which is the intended documented contract, not a stub awaiting a real value at runtime — operators fill these from their Neon dashboard.

## Threat Flags

None — this plan introduces no new network endpoints, auth paths, file access, or schema changes at trust boundaries. Pure documentation + datasource-config + assertion tests.

## Self-Check: PASSED

**Created files exist:**
- FOUND: `frontend/src/lib/server/observability/env-shape.test.ts`
- FOUND: `frontend/src/lib/server/observability/schema-direct-url.test.ts`

**Modified files carry the changes:**
- FOUND: `.env.example` contains `DATABASE_URL=...-pooler...pgbouncer=true...connection_limit=1`
- FOUND: `.env.example` contains `DIRECT_URL=...`
- FOUND: `.env.example` contains `CRON_SECRET=""` + `openssl rand -base64 32`
- FOUND: `frontend/prisma/schema.prisma` contains `directUrl = env("DIRECT_URL")` inside `datasource db {}`

**Commits exist on master:**
- FOUND: `1c48afa` (Task 1 — feat: Neon dual-URL + CRON_SECRET)
- FOUND: `0ffc900` (Task 2 — feat: directUrl in datasource)
- FOUND: `3bffea1` (Task 4 — test: pin both contracts)

**Verification:**
- Vitest: 8/8 passing
- typecheck: clean
- prisma generate: idempotent, exit 0
- Express-era vars preserved (4 grep hits) per D-21
