---
phase: 00-foundation
plan: 03
subsystem: infra
tags: [foundation, sentry, opentelemetry, instrumentation, observability, monolith]

# Dependency graph
requires:
  - phase: 00-foundation
    plan: 01
    provides: "frontend/src/lib/server/observability/ directory + Vitest config"
  - phase: 00-foundation
    provides: "context (CONTEXT.md D-07, D-11, D-16, D-17, D-18) + research (RESEARCH.md Pattern 2 lines 246-278, Example 1 lines 521-539, Pitfall 6 line 509)"
provides:
  - "frontend/instrumentation.ts re-exports onRequestError from @sentry/nextjs (Next.js 15+ unhandled route-error capture)"
  - "frontend/instrumentation.ts calls registerOTel({ serviceName: 'amadou-monolith' }) AFTER Sentry dynamic imports"
  - "instrumentation-shape.test.ts pins both exports + boot order (5 expectations, OPS-03 + OBS-05)"
  - "next-config-clean.test.ts pins absence of deprecated experimental.instrumentationHook (2 expectations, OPS-05)"
affects: [00-04 (admin tooling lands on top of an instrumented baseline), 00-05 (CI gates can rely on these tests as the OPS-03 + OPS-05 + OBS-05 canary), 01+ (every Phase 1+ route handler can throw uncaught and Sentry captures it; OTel HTTP spans flow without per-route instrumentation)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Instrumentation file shape: top-level @vercel/otel import + register() async fn containing runtime-conditional Sentry dynamic imports + registerOTel() AS LAST CALL inside register() (Pitfall 6 — Sentry HTTP auto-instrumentation must patch http/fetch first; OTel patches afterwards)"
    - "Next.js 15+ requires onRequestError as a literal NAMED top-level export — re-exporting from @sentry/nextjs is the canonical way to wire unhandled route errors into Sentry without hand-rolling try/catch in every handler"
    - "Static-source assertion tests: read instrumentation.ts and next.config.ts via node:fs and assert with regex/substring — no Next.js runtime context needed, sub-3ms test runtime, zero flakiness"

key-files:
  created:
    - "frontend/src/lib/server/observability/instrumentation-shape.test.ts"
    - "frontend/src/lib/server/observability/next-config-clean.test.ts"
  modified:
    - "frontend/instrumentation.ts (top-level @vercel/otel import + registerOTel call inside register() + onRequestError re-export from @sentry/nextjs; previous 8-line comment header replaced with the 3-line lean variant from RESEARCH.md Example 1)"

key-decisions:
  - "Kept instrumentation.ts at exactly 17 lines (target ≤25) by adopting RESEARCH.md Example 1 verbatim — no extra try/catch around registerOTel, no env-var-driven serviceName, no defensive comments beyond the 3-line header. Rationale: any deviation from Example 1 widens the assertion surface in the shape test and dilutes the shape contract."
  - "registerOTel is the LAST statement inside register() (Pitfall 6 ordering): Sentry's auto-instrumentation patches http/fetch as a side-effect of the dynamic import; if OTel patched first, Sentry's patching could no-op silently."
  - "Both new tests use bare __dirname (CommonJS-style) instead of import.meta.url + fileURLToPath like 00-02 did. Justification: the plan provided this exact shape and Vitest 2.x in this project resolves __dirname correctly via its own loader. Verified by green test run before commit. (If a future Vitest upgrade breaks this, the fix is a one-line swap to import.meta.url — tracked here for context.)"

patterns-established:
  - "When pinning a code-shape contract via test, prefer reading the source file as a string and asserting with regex/substring over importing and inspecting at runtime. Faster (no transpile), zero side-effects (no module init), and the assertion text reads as documentation of the contract."
  - "Plan-supplied verbatim implementations (RESEARCH.md Example N referenced as 'use this exact shape') should be applied byte-for-byte: any 'improvement' the executor adds widens the test contract and creates brittleness. The lean form IS the contract."

requirements-completed:
  - OPS-03
  - OPS-05
  - OBS-05

# Metrics
duration: 2min
completed: 2026-05-07
---

# Phase 0 Plan 03: Sentry onRequestError + OpenTelemetry Wiring Summary

**Wired Next.js 15+ unhandled-route-error capture into Sentry via `onRequestError` re-export and registered `@vercel/otel` (`serviceName: 'amadou-monolith'`) inside `instrumentation.ts` register() — both under the same Pitfall-6-ordered async function — and pinned the contract with two static-source Vitest suites (7 expectations) so a future contributor cannot rename the export, drop the OTel call, or re-introduce the deprecated `experimental.instrumentationHook` flag without CI failing.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-07T19:30:20Z
- **Completed:** 2026-05-07T19:32:08Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `frontend/instrumentation.ts` now matches RESEARCH.md Example 1 (lines 521–539) verbatim:
  - Top-level `import { registerOTel } from '@vercel/otel';`
  - `register()` async function preserves the existing runtime-conditional Sentry dynamic imports for `nodejs` and `edge` runtimes
  - `registerOTel({ serviceName: 'amadou-monolith' })` is the LAST call inside `register()` (Pitfall 6 — Sentry must patch HTTP first)
  - Top-level `export { onRequestError } from '@sentry/nextjs';` so Next.js 15+ wires unhandled route errors into Sentry without per-handler try/catch
- File length: 17 lines (target ≤25; lean per Example 1)
- `frontend/src/lib/server/observability/instrumentation-shape.test.ts` — 5 expectations covering: registerOTel import shape, registerOTel call shape with literal `'amadou-monolith'`, onRequestError named re-export, NOT-default-exported, Sentry dynamic imports preserved inside register() (Pitfall 6 lock).
- `frontend/src/lib/server/observability/next-config-clean.test.ts` — 2 expectations covering: substring `instrumentationHook` absent, regex `experimental[^}]*instrumentation` absent (defensive against multi-line refactors).
- Combined new-test runtime: 3ms across 7 expectations.
- Full `pnpm --filter frontend exec vitest run` exits 0 (15/15 tests across 4 files — no regression in 00-01 or 00-02 tests).
- Repo-wide `pnpm typecheck` exits 0.
- `next.config.ts` was NOT modified — plan instructed `experimental.instrumentationHook` was already absent (verified by the new test on first green run).
- All three tasks committed atomically with `feat(monolith)` / `test(monolith)` scope per Conventional Commits.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Extend frontend/instrumentation.ts with onRequestError + registerOTel | `ee1f0e6` | feat |
| 2 | Write instrumentation-shape.test.ts (OPS-03 + OBS-05) | `06fb5ba` | test |
| 3 | Write next-config-clean.test.ts (OPS-05) | `699a4dd` | test |

_Note: Plan declared `tdd="true"` on all three tasks; for static-source assertion tests against an already-present file, the standard RED→GREEN cycle collapses to a single GREEN run since the production code (Task 1) was written before the tests (Tasks 2–3) per the plan's stated task order. Each task committed independently — no refactor commits needed._

## Files Created/Modified

- `frontend/instrumentation.ts` — Modified. Replaced the 8-line comment header + 8-line register() body (no OTel, no onRequestError) with the lean RESEARCH.md Example 1 shape: 3-line header + top-level OTel import + register() containing the existing Sentry dynamic imports plus a final `registerOTel({ serviceName: 'amadou-monolith' })` + top-level `onRequestError` re-export from `@sentry/nextjs`.
- `frontend/src/lib/server/observability/instrumentation-shape.test.ts` — Created. 5-expectation Vitest suite reading instrumentation.ts via `node:fs` and asserting OPS-03 (onRequestError named re-export), OBS-05 (registerOTel call shape), and Pitfall 6 (Sentry dynamic imports preserved inside register()).
- `frontend/src/lib/server/observability/next-config-clean.test.ts` — Created. 2-expectation Vitest suite reading next.config.ts via `node:fs` and asserting OPS-05 (deprecated `instrumentationHook` flag absent, both as substring and as a multi-line `experimental` block).

## Decisions Made

- **Verbatim Example 1 application.** RESEARCH.md Example 1 (lines 521–539) was applied byte-for-byte. The 3-line comment header on top of the file replaces the original 8-line educational comment because any deviation would widen the assertion surface in the shape test and dilute the contract.
- **registerOTel as the last call inside register().** Pitfall 6 (RESEARCH.md line 509) explains: Sentry's auto-instrumentation patches `http`/`fetch` as a module side-effect of `await import('./sentry.server.config')`. If `registerOTel` ran first, OTel would patch `http` and Sentry's patching might no-op. Tests would pass either way (they assert presence, not order beyond "inside register()"), but the runtime correctness is order-dependent — so this is locked at the file level, not the test level.
- **Used `__dirname` in tests despite 00-02 using `import.meta.url + fileURLToPath`.** The plan provided the bare `__dirname` shape; Vitest 2.x in this project resolves it correctly. Verified by green run before commit. If a future Vitest config swaps the loader to strict ESM, the fix is a one-line per file. Tracking this here so the next contributor knows the rationale.

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed on first green run; no Rule 1 (bug), Rule 2 (missing critical), Rule 3 (blocking), or Rule 4 (architectural) deviations were triggered.

---

**Total deviations:** 0
**Impact on plan:** None. The plan was self-consistent and matched the codebase state precisely.

## Issues Encountered

None.

## Threat Model Application

Phase 0 plan 03 threat register (from PLAN.md `<threat_model>`):

| Threat | Disposition | Implementation evidence |
|--------|-------------|-------------------------|
| T-0-05 (`experimental.instrumentationHook` re-introduction) | mitigate | `next-config-clean.test.ts` asserts the substring `instrumentationHook` is absent (Test 1) AND that no `experimental` block declares anything matching `/instrumentation/i` (Test 2 — defensive against multi-line refactors). CI fails before the build-time deprecation warning would surface. |
| T-instr-01 (`onRequestError` accidentally renamed) | mitigate | `instrumentation-shape.test.ts` Test 3 asserts the literal `onRequestError` token in a named re-export from `'@sentry/nextjs'`; Test 4 asserts NO `export default` form. Both must hold — silent failure mode (errors stop reaching Sentry) is locked. |
| T-instr-02 (Sentry capturing PII via unredacted error context) | accept | Out of Phase 0 scope; handled in `frontend/sentry.server.config.ts` `beforeSend` hook (existing). No change introduced here. |
| T-instr-03 (Boot-order race / OTel before Sentry → double-instrumentation) | mitigate | Task 1 implementation places `registerOTel(...)` AFTER both Sentry dynamic imports inside `register()`. Test 5 (`instrumentation-shape.test.ts`) asserts both `await import('./sentry.{server,edge}.config')` calls remain inside `register()`. Pitfall 6 documented inline as a comment in the file. |

## Known Stubs

None. The instrumentation file is a runtime entry point; the `serviceName` literal `'amadou-monolith'` is the intended final value (matches PROJECT.md / ROADMAP.md), not a placeholder. The test files assert on real source files, not mocks.

## Threat Flags

None — this plan introduces no new network endpoints, no new auth paths, no new file-access surfaces, and no schema changes at trust boundaries. Pure observability wiring + assertion tests.

## Deferred Items

- **`pnpm dev` boot smoke test (manual).** RESEARCH.md A3 notes Sentry + `@vercel/otel` coexistence is empirically conflict-free but was not re-verified live in this plan's execution context. The verifier (or the next executor doing local dev) should confirm `pnpm dev` boots cleanly with no `Cannot find module '@vercel/otel'` and no Sentry double-init warning. Both deps are present in `frontend/package.json` (`@vercel/otel ^2.1.2`, `@sentry/nextjs ^10.51.0`). If a runtime issue surfaces, document it as a Phase 0 verification finding.

## Next Phase Readiness

- Plans 00-04 (admin tooling) and 00-05 (CI/repo hygiene) can proceed. Both can rely on the instrumented baseline:
  - 00-04 admin scripts: any uncaught exception in `pnpm db:make-superadmin` or sibling tools running through Next.js runtime will reach Sentry once `SENTRY_DSN` is set.
  - 00-05 CI: the two new tests are part of `pnpm --filter frontend test` and gate on the CI lane that 00-05 will configure.
- Phase 1+ route handlers can throw uncaught and rely on Sentry capture; no per-route try/catch boilerplate needed for error visibility.

## Self-Check: PASSED

**Created files exist:**
- FOUND: `frontend/src/lib/server/observability/instrumentation-shape.test.ts`
- FOUND: `frontend/src/lib/server/observability/next-config-clean.test.ts`

**Modified files carry the changes:**
- FOUND: `frontend/instrumentation.ts` contains `import { registerOTel } from '@vercel/otel'`
- FOUND: `frontend/instrumentation.ts` contains `registerOTel({ serviceName: 'amadou-monolith' })`
- FOUND: `frontend/instrumentation.ts` contains `export { onRequestError } from '@sentry/nextjs'`
- FOUND: `frontend/next.config.ts` does NOT contain `instrumentationHook` (verified absent — no edit needed)

**Commits exist on master:**
- FOUND: `ee1f0e6` (Task 1 — feat: extend instrumentation.ts)
- FOUND: `06fb5ba` (Task 2 — test: pin instrumentation shape)
- FOUND: `699a4dd` (Task 3 — test: pin next.config clean)

**Verification:**
- Vitest (new tests only): 7/7 passing in 3ms
- Vitest (full frontend suite): 15/15 passing in 6ms
- typecheck: clean (`pnpm typecheck` exit 0)
- File length: instrumentation.ts = 17 lines (≤25 budget)
- File-shape regex sweep: 6/6 OK (otel import, register fn, sentry server import, sentry edge import, registerOTel call, onRequestError re-export)

---
*Phase: 00-foundation*
*Plan: 03*
*Completed: 2026-05-07*
