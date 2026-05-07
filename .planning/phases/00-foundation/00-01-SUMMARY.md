---
phase: 00-foundation
plan: 01
subsystem: infra
tags: [vitest, otel, fast-glob, observability, tooling, foundation, monolith]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: "context (CONTEXT.md D-05, D-14, D-16) + research (RESEARCH.md Example 4)"
provides:
  - "@vercel/otel ^2.1.2 dep installed (unblocks Plan 03 registerOTel call)"
  - "fast-glob ^3.3.3 devDep installed (unblocks Plan 02 runtime-enforcement guard test)"
  - "frontend/vitest.config.ts with @/* alias resolving to ./src"
  - "frontend/src/lib/server/observability/ directory tracked via .gitkeep"
affects: [00-02 (env+runtime guard), 00-03 (instrumentation+next.config), 00-04 (CRON_SECRET), 00-05 (request-context+log wrapper)]

# Tech tracking
tech-stack:
  added:
    - "@vercel/otel@^2.1.2 (Vercel OpenTelemetry SDK wrapper)"
    - "fast-glob@^3.3.3 (filesystem walking for the runtime-enforcement Vitest guard)"
  patterns:
    - "Conventional Commits with (monolith) scope per CONTEXT.md line 144"
    - "@/* path alias mirrored from tsconfig.json into Vitest resolve.alias so tests share import shape with runtime code"
    - ".gitkeep placeholder for directories Wave 1 plans will write into in parallel"

key-files:
  created:
    - "frontend/vitest.config.ts"
    - "frontend/src/lib/server/observability/.gitkeep"
  modified:
    - "frontend/package.json (added @vercel/otel dep, fast-glob devDep)"
    - "pnpm-lock.yaml (lockfile regen for new deps)"

key-decisions:
  - "Added passWithNoTests:true to vitest.config.ts so Wave 0 ships a runnable config before Wave 1 plans write the first test files"
  - "Did NOT install @opentelemetry/api/sdk-trace-base/resources explicitly: pnpm install reported zero peer-dep blockers and @vercel/otel resolves at runtime via require()"
  - "Used pnpm install --force once to repair a stale caniuse-lite data dir (browsers.js missing) on the dev machine; no source files affected, lockfile unchanged"

patterns-established:
  - "Vitest config shape: { test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true }, resolve: { alias: { '@': path.resolve(__dirname, './src') } } } — Wave 1 plans MUST not change this shape unless adding (not replacing) options."
  - "frontend/src/lib/server/observability/ is the canonical home for cross-cutting observability primitives (request-context.ts, log.ts in Plan 05)."

requirements-completed:
  - OPS-02

# Metrics
duration: 3min
completed: 2026-05-07
---

# Phase 0 Plan 01: Tooling Bootstrap Summary

**Wave 0 foundation landed: @vercel/otel + fast-glob installed, Vitest config wired with @/* alias, and the observability/ directory exists so Wave 1 plans (02-05) can run in parallel without colliding on missing prerequisites.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-07T19:18:11Z
- **Completed:** 2026-05-07T19:21:18Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `@vercel/otel ^2.1.2` added to `frontend/package.json` `dependencies` (unblocks Plan 03's `registerOTel({ serviceName: 'amadou-monolith' })` call in `instrumentation.ts`)
- `fast-glob ^3.3.3` added to `frontend/package.json` `devDependencies` (unblocks Plan 02's runtime-enforcement Vitest guard which walks `app/api/**/route.ts`)
- `frontend/vitest.config.ts` created with the exact RESEARCH.md Example 4 shape + `passWithNoTests: true`; `pnpm --filter frontend test` exits 0
- `frontend/src/lib/server/observability/` directory exists in the working tree, tracked via `.gitkeep`, ready for Plan 05 to populate with `request-context.ts` and `log.ts` (per D-13/D-14)
- All three tasks committed atomically with `(monolith)` Conventional Commit scope

## Task Commits

Each task was committed atomically:

1. **Task 1: Add @vercel/otel and fast-glob dependencies** - `0ba4b30` (chore)
2. **Task 2: Create frontend/vitest.config.ts** - `3cd35d9` (chore)
3. **Task 3: Create observability/ directory placeholder** - `88b6986` (chore)

**Plan metadata commit:** to follow (this SUMMARY.md + STATE.md + ROADMAP.md update)

## Files Created/Modified

- `frontend/package.json` - Added `@vercel/otel ^2.1.2` (deps) + `fast-glob ^3.3.3` (devDeps)
- `pnpm-lock.yaml` - Regenerated for the new dependency graph
- `frontend/vitest.config.ts` (NEW) - Minimal Vitest config with `@/*` → `./src` alias, `node` environment, `src/**/*.test.ts` include glob, `passWithNoTests: true`
- `frontend/src/lib/server/observability/.gitkeep` (NEW) - Zero-byte placeholder so the directory is tracked before Wave 1 plans write into it

## Decisions Made

- **Added `passWithNoTests: true` to vitest.config.ts.** The plan specified the EXACT RESEARCH.md Example 4 shape with no other options, but its own acceptance criterion required `pnpm --filter frontend test` to exit 0. Vitest 2.x exits 1 on zero tests by default, and Wave 0 ships before any test files exist (Wave 1 plans add them). Adding `passWithNoTests: true` is the minimal correct addition to satisfy both the acceptance criterion and Wave 1's operational needs. Documented inline in vitest.config.ts so future readers understand why it's there.
- **Did NOT explicitly install `@opentelemetry/api`/`@opentelemetry/sdk-trace-base`/`@opentelemetry/resources`.** RESEARCH.md Pitfall 5 (line 504) suggested installing these only if `pnpm dev` fails on import. `pnpm install` reported no peer-dep blockers and a Node smoke check (`node -e "require('@vercel/otel')"`) confirmed runtime resolution. Avoiding redundant deps keeps the lockfile lean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `passWithNoTests: true` to vitest.config.ts**
- **Found during:** Task 2 verification (`pnpm --filter frontend test` exited 1 with "No test files found")
- **Issue:** Plan 00-01-PLAN.md said "Do not add coverage, setupFiles, globals, or any other option" but its acceptance criterion (line 172) required `pnpm --filter frontend test` to exit 0. Vitest 2.x defaults to exit code 1 on zero tests, blocking the plan's own verify step.
- **Fix:** Added `passWithNoTests: true` to the `test:` block with an inline comment explaining the rationale (Wave 0 ships before Wave 1 writes tests).
- **Files modified:** `frontend/vitest.config.ts`
- **Verification:** Re-ran `pnpm --filter frontend test` → "No test files found, exiting with code 0". Acceptance criterion now satisfied.
- **Committed in:** `3cd35d9` (Task 2 commit)

**2. [Rule 3 - Blocking] Repaired stale caniuse-lite install via `pnpm install --force`**
- **Found during:** Task 2 verification (first `pnpm --filter frontend test` invocation)
- **Issue:** Vitest auto-loaded `frontend/postcss.config.mjs` via Vite's PostCSS auto-discovery; autoprefixer transitively required `caniuse-lite/data/browsers.js` which was missing from a stale install on the dev machine. Pre-existing condition unrelated to this plan's changes (the file existed but not its `data/browsers.js` and `data/agents.js` siblings).
- **Fix:** Ran `pnpm install --force` once at repo root. caniuse-lite data dir restored; no tracked source files changed, lockfile unchanged.
- **Files modified:** none (only node_modules)
- **Verification:** `ls node_modules/.pnpm/caniuse-lite@*/node_modules/caniuse-lite/data/` now lists `browsers.js` and `agents.js`; `pnpm --filter frontend test` no longer throws PostCSS error.
- **Committed in:** N/A (working-tree-only fix; no source change to commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking)
**Impact on plan:** Both auto-fixes were necessary to make the plan's own acceptance criterion (`pnpm --filter frontend test` exits 0) achievable. No scope creep — both fixes are minimal and directly serve the plan's goal of wiring up Vitest for Wave 1.

## Issues Encountered

- See "Deviations from Plan" above. The PostCSS/caniuse-lite issue and the zero-tests exit-1 issue were both surfaced during Task 2 verification and resolved before commit.

## User Setup Required

None — no external service configuration required for this tooling-only plan.

## Next Phase Readiness

**Wave 1 unblocked.** Plans 00-02 through 00-05 can now run in parallel:
- Plan 00-02 (env + runtime guard) can use `fast-glob` and place its test in `frontend/src/lib/server/__tests__/runtime-enforcement.test.ts` (or co-located) and have it discovered by Vitest.
- Plan 00-03 (instrumentation + next.config cleanup) can `import { registerOTel } from '@vercel/otel'`.
- Plan 00-04 (CRON_SECRET) doesn't depend on tooling changes here but is ordered as Wave 1.
- Plan 00-05 (request-context + log wrapper) writes into `frontend/src/lib/server/observability/`.

**Verification done at end of plan:**
- `pnpm install` exits 0 — lockfile in sync, no peer-dep blockers
- `pnpm --filter frontend test` exits 0 — Vitest config parseable
- `pnpm --filter frontend typecheck` exits 0 — no TS regressions
- `node -e "require('@vercel/otel')"` from `frontend/` resolves cleanly
- `git status` clean for source files (only `.planning/STATE.md` + `.planning/config.json` left for the metadata commit)

## Self-Check: PASSED

Verified:
- File `frontend/vitest.config.ts` exists (FOUND)
- File `frontend/src/lib/server/observability/.gitkeep` exists (FOUND)
- Commit `0ba4b30` exists in git log (FOUND - Task 1)
- Commit `3cd35d9` exists in git log (FOUND - Task 2)
- Commit `88b6986` exists in git log (FOUND - Task 3)
- `frontend/package.json` `dependencies` contains `@vercel/otel: ^2.1.2` (FOUND)
- `frontend/package.json` `devDependencies` contains `fast-glob: ^3.3.3` (FOUND)

---
*Phase: 00-foundation*
*Completed: 2026-05-07*
