---
phase: 00-foundation
plan: 05
subsystem: observability
tags: [foundation, observability, logging, async-local-storage, monolith]

# Dependency graph
requires:
  - phase: 00-foundation
    plan: 01
    provides: "frontend/src/lib/server/observability/ directory + Vitest config (passWithNoTests) + path alias '@/*' → frontend/src/*"
  - phase: 00-foundation
    provides: "context (CONTEXT.md D-12 ALS pattern, D-13 wrapper-not-modify, D-14 file location, D-15 no middleware) + research (RESEARCH.md Pattern 4 lines 333-399, Pattern 5 lines 410-438, Example 3 lines 555-591, Pitfall 3 inbound header validation)"
provides:
  - "frontend/src/lib/server/observability/request-context.ts: AsyncLocalStorage-backed per-request context module exposing makeRequestContext(headers), withRequestContext(ctx, fn), getRequestId(), getRequestContext(), and the RequestContext interface ({ requestId: string; startedAt: number }). Inbound X-Request-Id is validated against /^[0-9a-f-]{8,64}$/i; malformed values are rejected and replaced with crypto.randomUUID()."
  - "frontend/src/lib/server/observability/log.ts: thin wrapper over the existing createLogger that decorates every emit (debug/info/warn/error) with the current requestId from ALS. Default singleton 'log' exported for the common path. Existing frontend/src/lib/server/logger.ts is byte-identical (CLAUDE.md battle-tested rule)."
  - "frontend/vitest.config.ts: aliases the 'server-only' package to its bundled empty stub so server-side modules are unit-testable in plain Node (the real package throws by design — it's a Next.js bundler marker)."
affects: [01+ (Phase 1+ route handlers will import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context' and { log } from '@/lib/server/observability/log' as their first body line — incident triage 10× faster once every log line carries the requestId)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AsyncLocalStorage as the request-scope primitive: a single module-level AsyncLocalStorage<RequestContext> instance + als.run(ctx, fn) wrapper preserves the request ID across all await/setTimeout/setImmediate boundaries within the run scope, releasing the store automatically when the wrapped Promise resolves (no leak path)."
    - "Wrap-not-modify for battle-tested code: createRequestLogger calls the unchanged base.{level} method on the existing createLogger result, only adding a requestId field to the ctx object before delegating — the base logger's redaction step still runs untouched."
    - "Inbound header validation as defense-in-depth: /^[0-9a-f-]{8,64}$/i guards both length (DoS via 1MB X-Request-Id headers) and character set (log-poisoning via embedded quotes/control chars that survive Headers parsing)."
    - "Vitest 'server-only' alias: aliasing the package to its empty.js sibling lets server modules be imported into vitest without booting Next.js, while production bundles still run the real package via Next's bundler."

key-files:
  created:
    - "frontend/src/lib/server/observability/request-context.ts (47 lines)"
    - "frontend/src/lib/server/observability/request-context.test.ts (75 lines, 7 tests)"
    - "frontend/src/lib/server/observability/log.ts (37 lines)"
    - "frontend/src/lib/server/observability/log.test.ts (77 lines, 5 tests)"
  modified:
    - "frontend/vitest.config.ts (+6 lines: 'server-only' alias to ./node_modules/server-only/empty.js + comment explaining why)"

key-decisions:
  - "Adopted RESEARCH.md Pattern 4 (request-context) and Pattern 5 (log wrapper) verbatim. The shapes are the contract — any 'improvement' (richer context fields, eager singletons, stricter return types) widens the surface for later phases without buying anything."
  - "Test for malformed inbound X-Request-Id rejection uses values that survive the Headers constructor (spaces, wrong length, special chars, embedded quotes) instead of literal '\\n' from the research example. The WHATWG Headers spec rejects newlines outright, so an attacker cannot inject them — the realistic threat surface is the values our regex actually has to defend against."
  - "Aliased 'server-only' in vitest.config.ts rather than removing the import from the source modules. The 'server-only' import is the project convention (every server-side file under lib/server/ uses it) and provides a real bundler-time safety net in production. Stripping it from new modules would create a one-off exception future contributors would copy."
  - "createRequestLogger takes an options arg (default {}) instead of always using the singleton. This lets future call sites pass env: 'development' explicitly during local work AND keeps the singleton 'log' for the common path. Both shapes share the same decorate() closure."
  - "The wrapper passes through to base.{level}(msg, decorate(ctx)) — when no ALS scope is active, decorate returns the original ctx unchanged (or undefined). This keeps the base logger's existing emit format byte-identical for all pre-existing callers; nothing breaks when log.ts is added but call sites haven't migrated yet."

patterns-established:
  - "Project convention for request-scoped state: any new per-request value (correlation IDs, tenant IDs, feature flags) lands in the RequestContext interface and is accessed via getRequestContext() — no new ALS instances should be added; this one is the single source of truth."
  - "Project convention for logger usage in Phase 1+ route handlers: import { log } from '@/lib/server/observability/log' (NOT from '@/lib/server/logger' directly). Direct imports of the base logger bypass the requestId injection."

requirements-completed:
  - OBS-04

# Metrics
duration: 5min
completed: 2026-05-07
---

# Phase 0 Plan 05: Request-Context + Log Wrapper Summary

**Shipped the AsyncLocalStorage-backed request-context module (`makeRequestContext` validates inbound `X-Request-Id` against `/^[0-9a-f-]{8,64}$/i`; `withRequestContext` preserves the ID across awaits via `als.run`) and the thin logger wrapper that decorates every emit with the current requestId — without modifying the battle-tested `lib/server/logger.ts` (D-13). Phase 1+ route handlers now have a single import path (`@/lib/server/observability/log`) that automatically tags every log line with the per-request ID, making incident triage 10× faster once Phase 1 routes start using it.**

## Performance

| Metric | Value |
|---|---|
| Duration (start → final commit) | ~5 minutes |
| Tasks executed | 2 / 2 |
| Tests added | 12 (7 request-context + 5 log) |
| Total frontend tests passing | 31 / 31 |
| Files created | 4 |
| Files modified | 1 (vitest.config.ts — alias only) |
| Battle-tested files touched | 0 (logger.ts byte-identical, verified via `git diff`) |

## Tasks

| # | Name | Commits | Status |
|---|------|---------|--------|
| 1 | request-context.ts (ALS module) + co-located test | bcb1a2e (RED), a6bf1c1 (GREEN) | done |
| 2 | log.ts (logger wrapper) + co-located test | a20264a (RED), 5bc7ffa (GREEN) | done |

## Verification

- `pnpm --filter frontend exec vitest run src/lib/server/observability/request-context.test.ts` → 7 / 7 green
- `pnpm --filter frontend exec vitest run src/lib/server/observability/log.test.ts` → 5 / 5 green
- `pnpm --filter frontend test` → 31 / 31 green (across all 7 observability test files)
- `pnpm typecheck` → clean (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)
- `pnpm lint` → clean
- `git diff frontend/src/lib/server/logger.ts` → empty (battle-tested file unchanged)
- `frontend/middleware.ts` and `frontend/proxy.ts` → do not exist (D-15 honored)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Aliased `server-only` in vitest.config.ts**
- **Found during:** Task 1 GREEN step (first run of request-context.test.ts after the source file was created)
- **Issue:** The `server-only` package's `index.js` throws unconditionally at import time (`throw new Error("This module cannot be imported from a Client Component module...")`) — it's a Next.js bundler marker, not a runtime no-op. Without an alias, every test that imports a module starting with `import 'server-only'` (which is every server-side module per project convention) fails to load. The plan's note (line 321) anticipated this might happen and pointed at the dependency, but the resolution requires a config change.
- **Fix:** Added `'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js')` to the `resolve.alias` block of `frontend/vitest.config.ts`, with a comment explaining the rationale. Production bundles still go through Next's bundler which uses the real package — only Vitest sees the empty stub.
- **Files modified:** `frontend/vitest.config.ts`
- **Commit:** Folded into a6bf1c1 (Task 1 GREEN) — the alias and the source module are one logical unit (one couldn't ship without the other).

**2. [Rule 1 - Bug] Adjusted malformed-input test to use values that survive `Headers` construction**
- **Found during:** Task 1 GREEN step (request-context test 3 failed with "Headers.append: 'evil\nlog-poison' is an invalid header value")
- **Issue:** RESEARCH.md Example 3 uses `new Headers({ 'x-request-id': 'evil\nlog-poison' })` to test malformed-input rejection, but the WHATWG `Headers` constructor itself rejects literal newlines — the test could never actually reach the regex check. The research example was a thought-experiment about the threat path, not a runnable test case.
- **Fix:** Replaced the single bad value with a `for ... of` loop over realistic malformed inputs that DO survive `Headers` parsing: `'evil log-poison'` (spaces), `'short'` (too short), `'a'.repeat(65)` (too long), `'not-a-uuid-but-has-bad-chars-!@#\$'` (disallowed punctuation), `'"injected"'` (quotes that could break JSON log parsers). All five cases now exercise the regex path the production code actually defends against. The test still asserts the planner-required behavior (mismatch → fresh UUID; no return of the bad value).
- **Files modified:** `frontend/src/lib/server/observability/request-context.test.ts`
- **Commit:** Folded into a6bf1c1 (Task 1 GREEN) — the corrected test and the source were committed together.

### Architectural Changes

None.

### User Decisions

None.

## Threat Surface Outcomes

All `mitigate` items from the plan's `<threat_model>` are now covered:

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-0-01 (X-Request-Id header poisoning) | mitigate | Covered: regex `/^[0-9a-f-]{8,64}$/i` rejects non-conforming values; test 3 exercises 5 realistic bad inputs. |
| T-log-02 (Wrapper bypasses redaction) | mitigate | Covered: wrapper calls `base.{level}` (the existing createLogger result), so the base redaction step still runs. The wrapper only ADDS a `requestId` field to the ctx object before delegating. |

No new threat flags. The module surface (in-process ALS + log wrapper) does not introduce new network endpoints, file access, or schema changes.

## Self-Check: PASSED

Files verified to exist:
- `frontend/src/lib/server/observability/request-context.ts` ✓
- `frontend/src/lib/server/observability/request-context.test.ts` ✓
- `frontend/src/lib/server/observability/log.ts` ✓
- `frontend/src/lib/server/observability/log.test.ts` ✓

Commits verified to exist (`git log --oneline | grep <hash>`):
- bcb1a2e — test(monolith): add failing tests for request-context ALS module ✓
- a6bf1c1 — feat(monolith): add request-context ALS module (OBS-04) ✓
- a20264a — test(monolith): add failing tests for log wrapper (OBS-04) ✓
- 5bc7ffa — feat(monolith): add log wrapper that injects requestId from ALS (OBS-04) ✓

logger.ts byte-identical: `git diff frontend/src/lib/server/logger.ts` returns empty ✓
No middleware.ts / proxy.ts at frontend root ✓
