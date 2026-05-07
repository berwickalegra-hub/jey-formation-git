---
phase: 00-foundation
plan: 04
subsystem: infra
tags: [foundation, runtime, guards, vitest, ci, monolith]

# Dependency graph
requires:
  - phase: 00-foundation
    plan: 01
    provides: "frontend/src/lib/server/observability/ directory + Vitest config + fast-glob devDependency"
  - phase: 00-foundation
    provides: "context (CONTEXT.md D-04, D-05, D-06; specifics line 163) + research (RESEARCH.md Pattern 3 lines 287-319, audit table lines 196-207)"
provides:
  - "frontend/src/app/api/pay-redirect/route.ts now declares export const runtime = 'nodejs' (one-line addition; handler body untouched)"
  - "frontend/src/lib/server/observability/runtime-enforcement.test.ts: parametric Vitest guard that walks src/app/api/**/route.ts via fast-glob.sync and asserts each file declares runtime='nodejs' AND does NOT declare runtime='edge', with file-path-named failure messages (4 expectations today: 1 discovery + 3 per-file; auto-grows on new routes)"
affects: [00-05 (CI gate consumes this test as the OPS-02 canary), 01+ (every Phase 1+ route handler that lands as app/api/**/route.ts is forced through this guard at PR time — missing runtime export OR runtime='edge' fails CI with the exact offending path)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CI grep guard via Vitest: read source files with node:fs + assert with regex; parametrically generate sub-tests at module load via for-loop over fg.sync results — adding routes auto-grows the test surface, no per-route registration needed"
    - "Path-deterministic ROOT resolution: resolve(__dirname, '../../../..') from frontend/src/lib/server/observability/ lands at frontend/, independent of test cwd — robust whether vitest runs from package root or repo root"
    - "Failure-message-as-documentation: every expect() carries a literal string naming the offending file path so a future contributor reading CI output sees the fix immediately (no log archaeology)"

key-files:
  created:
    - "frontend/src/lib/server/observability/runtime-enforcement.test.ts"
  modified:
    - "frontend/src/app/api/pay-redirect/route.ts (+1 line: 'export const runtime = nodejs;' inserted directly above 'export const dynamic = force-dynamic;'; handler body, ALLOWED_DOMAINS, isAllowedHost, GET handler all byte-identical)"

key-decisions:
  - "Adopted RESEARCH.md Pattern 3 verbatim (lines 287-319). The shape is the contract — any 'improvement' (stricter regex requiring semicolons, named-export deduping, snapshot of file count) widens the assertion surface and creates brittleness for future Phase 1+ contributors."
  - "Kept the regex tolerant — accepts both 'nodejs' and \"nodejs\" quoting and trailing semicolons optional. CONVENTIONS.md does not pin a quote style; forcing one in the guard would fail PRs on cosmetic differences instead of the actual runtime contract."
  - "Placed the test under lib/server/observability/ alongside the other Phase 0 shape-guard tests (env-shape, schema-direct-url, instrumentation-shape, next-config-clean). This is the project's convention for system-level guards that don't belong to any single feature."
  - "pay-redirect's runtime export sits ABOVE 'export const dynamic' (matching health/readyz layout). Per D-04 the runtime export should be the first non-import config export. dynamic is also a config export but not a runtime declaration — placement is correct."

patterns-established:
  - "Project convention for runtime-enforcement: every new route file under app/api/**/ MUST include 'export const runtime = nodejs;' as a config export; the Vitest guard rejects both missing-export and runtime='edge' accidents at PR time. Phase 1+ executors copy this line into every new route handler."
  - "Plan-supplied verbatim implementations (RESEARCH.md Pattern N) are applied byte-for-byte. The lean form encoded in research IS the contract."

requirements-completed:
  - OPS-02

# Metrics
duration: 4min
completed: 2026-05-07
---

# Phase 0 Plan 04: runtime='nodejs' Enforcement Summary

**Audited every existing API route under `frontend/src/app/api/**/route.ts`, added the missing `export const runtime = 'nodejs'` to `pay-redirect/route.ts` (health/readyz already had it), and committed a parametric Vitest guard test that walks the API tree via `fast-glob.sync` and rejects both missing-export and `runtime='edge'` accidents with file-path-named failure messages — so any future Phase 1+ route handler that boots on edge (silently breaking Prisma/bcrypt/Buffer) cannot land without CI catching it.**

## Performance

| Metric | Value |
|---|---|
| Duration (start → final commit) | ~4 minutes |
| Tasks executed | 2 / 2 |
| Files modified | 1 (pay-redirect/route.ts) |
| Files created | 1 (runtime-enforcement.test.ts) |
| Commits | 2 (per-task) + 1 docs |
| Vitest tests added | 4 (1 discovery + 3 per-file) |
| Full frontend test suite after this plan | 19 tests across 5 files, all green |

## Tasks Executed

### Task 1 — Audit existing API routes; add `runtime='nodejs'` to `pay-redirect/route.ts`

- Read all three audited route files. Confirmed:
  - `frontend/src/app/api/health/route.ts` line 7 — already declares `export const runtime = 'nodejs';` — UNCHANGED
  - `frontend/src/app/api/readyz/route.ts` line 10 — already declares it — UNCHANGED
  - `frontend/src/app/api/pay-redirect/route.ts` line 19 (pre-edit) — only had `export const dynamic = 'force-dynamic';`
- Added one line above `export const dynamic`:
  ```typescript
  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';
  ```
- Handler body untouched: `ALLOWED_DOMAINS`, `isAllowedHost`, the `GET` handler, defensive headers — all byte-identical.
- Verification: ran the inline node script asserting the regex `/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/` on all 3 files → `ok`.
- Typecheck: `pnpm --filter frontend exec tsc --noEmit` exits 0.
- **Commit:** `7023221` — `fix(monolith): declare runtime='nodejs' on pay-redirect route`

### Task 2 — Write `runtime-enforcement.test.ts` (CI grep guard via fast-glob)

- Created `frontend/src/lib/server/observability/runtime-enforcement.test.ts` with the verbatim shape from RESEARCH.md Pattern 3 (lines 287–319):
  - `import fg from 'fast-glob'` + `readFileSync` from `node:fs` + `resolve` from `node:path`
  - `ROOT = resolve(__dirname, '../../../..')` — resolves to `frontend/` regardless of where Vitest is invoked from
  - Module-level `fg.sync('src/app/api/**/route.ts', { cwd: ROOT, absolute: true })` to enumerate route files
  - Discovery test: `expect(routeFiles.length).toBeGreaterThan(0)`
  - Per-file `it()` block (parametric loop over discovered files):
    - Negative assertion: `expect(hasEdge).toBe(false)` with message `${rel} declares runtime='edge' — Prisma/bcrypt/Buffer break on edge`
    - Positive assertion: `expect(ok).toBe(true)` with message `${rel} is missing \`export const runtime = 'nodejs'\``
- Verification: `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` → 4 tests passing in ~2ms test time, ~348ms total wall clock (well under the 2s budget). Discovered route count: 3 (health, readyz, pay-redirect).
- Full-suite verification: `pnpm --filter frontend exec vitest run` → 5 test files, 19 tests, all green.
- Threat-register flag `T-0-02` (Tampering / Correctness on route runtime selection) and `T-runtime-01` (future contributor forgets the export) — both now mitigated by this parametric guard.
- **Commit:** `7b2f13a` — `test(monolith): add CI grep guard for runtime='nodejs' on every API route`

## Verification

- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0 with 4 tests passing.
- `grep -r "runtime = 'edge'" frontend/src/app/api/` returns no matches (Phase 7 final-pass criterion already satisfied).
- `grep -rE "export\s+const\s+runtime\s*=\s*['\"]nodejs['\"]" frontend/src/app/api/` returns 3 lines (one per audited route).
- `pnpm typecheck` exits 0.
- Full frontend suite (5 files, 19 tests) green after both commits.

## Deviations from Plan

None — plan executed exactly as written. RESEARCH.md Pattern 3 applied verbatim; pay-redirect edit limited to the single line specified by the plan. No Rule 1/2/3 auto-fixes triggered.

## Threat Flags

None — this plan only adds source-file-level assertions and a one-line config export. No new network surface, no auth path change, no schema change at trust boundaries.

## Self-Check

- File `frontend/src/app/api/pay-redirect/route.ts`: FOUND, line 19 = `export const runtime = 'nodejs';`
- File `frontend/src/lib/server/observability/runtime-enforcement.test.ts`: FOUND, 32 lines (≥25 minimum per frontmatter `min_lines`).
- Commit `7023221` (Task 1): FOUND in `git log`.
- Commit `7b2f13a` (Task 2): FOUND in `git log`.

## Self-Check: PASSED
