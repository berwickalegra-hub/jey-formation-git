---
phase: 00-foundation
verified: 2026-05-07T19:49:24Z
status: human_needed
score: 5/5 success criteria verified, 7/7 requirement IDs satisfied (automated)
overrides_applied: 0
human_verification:
  - test: "Boot the app and confirm OTel + Sentry coexist without conflict"
    expected: "`pnpm dev` starts cleanly; no `Cannot find module '@vercel/otel'`; no Sentry double-init / double-instrumentation warnings; no boot-time error from registerOTel({serviceName:'amadou-monolith'})"
    why_human: "Requires actually running the dev server with NEXT_RUNTIME=nodejs and observing stderr; cannot be done from a static grep. Pitfall 6 in RESEARCH.md (ordering: Sentry imports BEFORE registerOTel) is the failure surface."
  - test: "`pnpm --filter frontend exec next build` does NOT emit `experimental.instrumentationHook` deprecation warnings"
    expected: "Build completes without an `experimental.instrumentationHook` deprecation banner; no edge-runtime warnings on /api/health, /api/readyz, /api/pay-redirect"
    why_human: "Static grep on next.config.ts (Step 3 of Phase 0 SC #5) confirms the flag is absent, but Next.js can also surface the warning through framework-internal config inference; only `next build` exercises that path."
  - test: "Verify `onRequestError` actually captures unhandled route errors when SENTRY_DSN is set"
    expected: "Throwing an Error inside a Phase 1+ route handler (or temporarily inside /api/health) results in an event in Sentry"
    why_human: "End-to-end Sentry capture requires SENTRY_DSN, network egress, and reading the Sentry UI. Static checks confirm the export is present and named correctly, but only a live throw confirms the wiring."
---

# Phase 0: Foundation Verification Report

**Phase Goal:** Cross-cutting infrastructure is correct before any route handler lands — Neon pooler URL, Node.js runtime enforcement, Sentry error capture, CRON_SECRET, OTel, and request ID propagation are all in place.

**Verified:** 2026-05-07T19:49:24Z
**Status:** human_needed (all automated checks pass; live-boot smoke required)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth (from ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | `.env.example` contains `DATABASE_URL` using `-pooler` Neon hostname with `?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`, `DIRECT_URL`, and `CRON_SECRET` with `openssl rand -base64 32` hint | VERIFIED | `grep -E "^DATABASE_URL=.*pooler"` matches the full pooler URL with all four query params; `DIRECT_URL` and `CRON_SECRET=""` lines + `openssl rand -base64 32` hint all present. `env-shape.test.ts` (5 assertions) green. |
| 2 | `instrumentation.ts` exports both Sentry init AND `onRequestError` from `@sentry/nextjs` | VERIFIED | `frontend/instrumentation.ts:6-14` declares `register()` with runtime-conditional Sentry imports; line 17 re-exports `onRequestError` as a named export. `instrumentation-shape.test.ts` (5 assertions) green. |
| 3 | `pnpm lint` (or CI grep guard test) rejects any file under `app/api/` exporting `runtime = 'edge'` | VERIFIED | `runtime-enforcement.test.ts` walks `src/app/api/**/route.ts` via `fast-glob` and asserts `runtime='nodejs'` AND refuses `runtime='edge'`. Test green (4 sub-tests). `grep -r "runtime = 'edge'" frontend/src/app/api/` returns no matches. |
| 4 | Every existing route file (`health`, `readyz`, `pay-redirect`) carries `export const runtime = 'nodejs'`; `next build` completes without edge-runtime warnings | VERIFIED (automated portion) | All three routes confirmed via `grep`. The `next build` warnings half is in human verification (SC #4 second clause). |
| 5 | `instrumentation.ts` does NOT export `experimental.instrumentationHook`; `@vercel/otel` is registered; the request-context module produces `X-Request-Id` (response-header wiring deferred to Phase 1+) | VERIFIED | `next.config.ts` clean of `instrumentationHook` (next-config-clean.test.ts green); `registerOTel({serviceName:'amadou-monolith'})` called in `instrumentation.ts:13`; `request-context.ts` exposes `makeRequestContext` (validates inbound `X-Request-Id` against `^[0-9a-f-]{8,64}$`, mints UUID otherwise) + ALS preservation (request-context.test.ts 7 assertions green). |

**Score:** 5/5 success criteria verified by automation (live-boot smoke remains for human gate).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.env.example` | DATABASE_URL pooler + DIRECT_URL + CRON_SECRET | VERIFIED | All required strings present; legacy Express vars retained per Phase 6 DOC-02 contract |
| `frontend/prisma/schema.prisma` | datasource declares `directUrl = env("DIRECT_URL")` | VERIFIED | Line confirmed via grep |
| `frontend/instrumentation.ts` | registerOTel + onRequestError re-export | VERIFIED | 17-line file; matches RESEARCH.md Example 1 verbatim |
| `frontend/src/app/api/pay-redirect/route.ts` | `runtime = 'nodejs'` declaration | VERIFIED | Declaration present (added in commit 7023221) |
| `frontend/vitest.config.ts` | `@/*` alias + node env | VERIFIED | Includes `passWithNoTests: true` and `server-only` stub alias for tests (additions over the planned shape — non-breaking, justified by Wave-0/Wave-1 dependency ordering) |
| `frontend/src/lib/server/observability/env-shape.test.ts` | 5+ assertions on `.env.example` | VERIFIED | 52 lines, 5 assertions, all green |
| `frontend/src/lib/server/observability/schema-direct-url.test.ts` | 3 assertions on schema datasource | VERIFIED | 35 lines, 3 assertions, all green |
| `frontend/src/lib/server/observability/instrumentation-shape.test.ts` | 5 assertions on instrumentation.ts | VERIFIED | 38 lines, 5 assertions, all green |
| `frontend/src/lib/server/observability/next-config-clean.test.ts` | 2 assertions on next.config.ts | VERIFIED | 27 lines, 2 assertions, all green |
| `frontend/src/lib/server/observability/runtime-enforcement.test.ts` | fast-glob CI guard | VERIFIED | 32 lines, 4 sub-tests, all green |
| `frontend/src/lib/server/observability/request-context.ts` | ALS module with 4 fns + interface | VERIFIED | 49 lines, exports all 5 symbols (`makeRequestContext`, `withRequestContext`, `getRequestId`, `getRequestContext`, `RequestContext`), regex validation of inbound IDs present |
| `frontend/src/lib/server/observability/request-context.test.ts` | 7 assertions on ALS behavior | VERIFIED | 74 lines, 7 assertions, all green (covers UUID minting, header reuse, malformed-input rejection, ALS preservation across awaits, `startedAt` sanity) |
| `frontend/src/lib/server/observability/log.ts` | Logger wrapper injecting requestId | VERIFIED | 37 lines; uses `@/lib/server/logger` import; wraps all 4 levels |
| `frontend/src/lib/server/observability/log.test.ts` | 5 assertions on wrapper | VERIFIED | 77 lines, 5 assertions, all green |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `instrumentation.ts` | `@sentry/nextjs (onRequestError)` | named re-export | WIRED | `export { onRequestError } from '@sentry/nextjs'` on line 17 |
| `instrumentation.ts` | `@vercel/otel (registerOTel)` | import + call inside `register()` | WIRED | Imported on line 4, called on line 13 with `serviceName: 'amadou-monolith'` |
| `schema.prisma` | `.env: DIRECT_URL` | `directUrl = env("DIRECT_URL")` | WIRED | Confirmed in datasource block |
| `.env.example` | Neon pooler hostname | DATABASE_URL pattern | WIRED | `-pooler.us-east-2.aws.neon.tech` literal in URL |
| `runtime-enforcement.test.ts` | `app/api/**/route.ts` | `fg.sync` walk | WIRED | Test discovers ≥3 routes; per-file sub-tests pass |
| `log.ts` | `lib/server/logger.ts` | `createLogger` import | WIRED | `import { createLogger, ... } from '@/lib/server/logger'`; `logger.ts` byte-identical (zero-line git diff vs baseline) — battle-tested file untouched |
| `log.ts` | `request-context.ts` | `getRequestId` import | WIRED | `import { getRequestId } from './request-context'` |
| `request-context.ts` | `node:async_hooks AsyncLocalStorage` | `als.run + als.getStore` | WIRED | Standard ALS usage; tests confirm propagation across `setTimeout` awaits |

### Data-Flow Trace (Level 4)

Phase 0 ships infrastructure libraries — no dynamic-data rendering surface. The closest data-flow concerns are:

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `request-context.ts:makeRequestContext` | `requestId` | `headers.get('x-request-id')` OR `randomUUID()` | Real (live UUID or validated header) | FLOWING — confirmed by 7 ALS tests |
| `log.ts:createRequestLogger` | `requestId` field on every emit | `getRequestId()` from ALS | Real (when scope active); undefined otherwise (graceful degrade) | FLOWING — confirmed by 5 wrapper tests |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Vitest config parses; tests discover and run | `pnpm --filter frontend test` | 7 files, 31 tests, all passing in 462ms | PASS |
| TypeScript compiles cleanly under strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | `pnpm typecheck` | exit 0 | PASS |
| ESLint clean | `pnpm lint` | exit 0 | PASS |
| `@vercel/otel` resolves at runtime | `pnpm --filter frontend ls @vercel/otel` (implicit via test pass) | `^2.1.2` installed | PASS |
| `fast-glob` resolves and walks API tree | runtime-enforcement.test.ts discovers ≥3 routes | discovery sub-test green | PASS |
| Prisma client regenerated with directUrl | typecheck pass against `@prisma/client` imports | exit 0 | PASS |
| No edge runtime declarations | `grep -r "runtime = 'edge'" frontend/src/app/api/` | no matches (exit 1) | PASS |
| No `experimental.instrumentationHook` in next.config.ts | `grep -E "experimental.instrumentationHook" frontend/next.config.ts` | no matches (exit 1) | PASS |
| `frontend/middleware.ts` and `frontend/proxy.ts` absent (D-15 honored) | `test -f` checks | both absent | PASS |
| `lib/server/logger.ts` battle-tested file untouched (CLAUDE.md do-not-modify) | `git diff 547884e..HEAD -- frontend/src/lib/server/logger.ts` | 0 lines | PASS |
| Live `pnpm dev` boot — OTel + Sentry coexist; no double-instrumentation | (requires running server) | not exercised | SKIP — routed to human verification |
| `next build` clean of edge-runtime warnings | `pnpm --filter frontend exec next build` | not exercised (Phase 0 should not need a full prod build to pass) | SKIP — routed to human verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| OPS-01 | 00-02 | DATABASE_URL pooler convention + `.env.example` + CLAUDE.md doc | SATISFIED | `.env.example` carries pooler URL with all required params; `schema.prisma` declares `directUrl`; env-shape.test.ts + schema-direct-url.test.ts both green |
| OPS-02 | 00-01, 00-04 | Every API route exports `runtime = 'nodejs'`; lint/CI guard | SATISFIED | All 3 audited routes declare `runtime='nodejs'`; `runtime-enforcement.test.ts` parametrically guards future additions; deps (`fast-glob` 3.3.3) installed |
| OPS-03 | 00-03 | `instrumentation.ts` exports `onRequestError` from `@sentry/nextjs` | SATISFIED | Named re-export confirmed via grep + test (5 assertions green) |
| OPS-04 | 00-02 | `CRON_SECRET` in `.env.example` with `openssl rand -base64 32` hint | SATISFIED | Literal string `CRON_SECRET=""` + `Generate with: openssl rand -base64 32` + `Required by /api/cron/* routes (Phase 5)` all present |
| OPS-05 | 00-03 | `experimental.instrumentationHook` removed (or verified absent) from next.config.ts | SATISFIED | `next-config-clean.test.ts` (2 assertions green) pins absence; grep returns no match |
| OBS-04 | 00-05 | Request ID generated, propagated through ALS, available to logger | SATISFIED (module + lib level) | `request-context.ts` ships ALS-backed module; `log.ts` injects requestId into every emit; 12 combined tests green. **Note:** the response-header wiring (`X-Request-Id` on outbound responses) is intentionally deferred to Phase 1+ per Phase 0 SC #5 ("the response header is set per-route in Phase 1+, but the module that does it is shipped"). REQUIREMENTS.md OBS-04 wording mentions response-header propagation — that piece is shipped at the module level (callers can set the header from `getRequestContext()`); per-route adoption is a Phase 1+ concern. |
| OBS-05 | 00-03 | OpenTelemetry via `@vercel/otel` registered in `instrumentation.ts` | SATISFIED | `registerOTel({ serviceName: 'amadou-monolith' })` called inside `register()`; instrumentation-shape.test.ts asserts both literal call shape and Sentry import ordering (Pitfall 6 defense) |

**Orphaned requirements:** None. REQUIREMENTS.md maps 7 IDs to Phase 0; all 7 appear in plan frontmatter (OPS-01/04 in 00-02; OPS-02 in 00-01/00-04; OPS-03/05/OBS-05 in 00-03; OBS-04 in 00-05).

### Anti-Patterns Found

None. Spot-checked all observability files for TODO/FIXME/PLACEHOLDER/`return null`/empty-handler patterns; only the legitimate `if (!requestId) return ctx;` graceful-degrade in `log.ts:25` matched a stub-pattern grep — and it is the documented correct behavior for the wrapper (no requestId → don't pollute the log line; user-supplied ctx returned unchanged).

### Human Verification Required

1. **`pnpm dev` boot smoke test (OTel + Sentry coexistence)**
   - **Test:** Run `pnpm dev`, watch the first 10 seconds of stderr.
   - **Expected:** No `Cannot find module '@vercel/otel'`; no Sentry double-init warning; no error from `registerOTel`. The Pitfall 6 ordering (Sentry dynamic imports first, then `registerOTel`) is the silent failure surface — only a live boot exercises it.
   - **Why human:** Cannot be exercised from a static grep; requires actually starting the Next.js dev server.

2. **`next build` clean of `experimental.instrumentationHook` deprecation banner**
   - **Test:** Run `pnpm --filter frontend exec next build`.
   - **Expected:** Build completes without an `experimental.instrumentationHook` deprecation warning, and without edge-runtime warnings on `/api/health`, `/api/readyz`, `/api/pay-redirect`. (Phase 0 SC #4 second clause.)
   - **Why human:** Build-time warnings are part of Next.js's framework-internal config inference; static grep on `next.config.ts` confirms the flag is absent in source, but only `next build` confirms the framework agrees.

3. **End-to-end Sentry capture via `onRequestError`**
   - **Test:** With `SENTRY_DSN` set, throw an unhandled error inside a route handler (Phase 1+ will create real ones; for now you can temporarily edit `/api/health` to throw).
   - **Expected:** The error event appears in Sentry. Confirms the `onRequestError` named re-export is wired correctly end-to-end (Next.js looks for the literal exported name).
   - **Why human:** Requires `SENTRY_DSN`, network egress, and visual confirmation in the Sentry UI.

### Gaps Summary

No automated gaps. All 5 ROADMAP success criteria, all 7 requirement IDs, all 14 must-have artifacts, and all 8 key links are verified. 31/31 unit tests green; typecheck and lint clean. The CLAUDE.md "do not modify" file `frontend/src/lib/server/logger.ts` is provably untouched (git diff vs baseline = 0 lines). `frontend/middleware.ts` / `frontend/proxy.ts` correctly absent per D-15.

Three live-boot / live-build / live-Sentry checks remain that cannot be automated from static analysis alone — see Human Verification section. These are gating on the human gate, not on Phase 0 implementation correctness.

Two minor deviations from plan-as-written, both intentional and documented:

- **`vitest.config.ts` adds `passWithNoTests: true` and a `server-only` alias.** The `passWithNoTests` line is required because Plan 01 lands the config before Wave 1 plans add tests, and Vitest 2.x exits 1 on zero tests. The `server-only` alias maps the package's empty stub for Node-runtime tests (Vitest doesn't bundle through Next's loader). Both additions are non-breaking expansions; neither alters the documented `@/*` alias contract that Wave 1 plans depend on.
- **`log.ts` `decorate()` returns `Record<string, unknown> | undefined` instead of `Record<string, unknown>`.** When there is no requestId AND no caller ctx, returning `undefined` (instead of `{}`) lets the base logger skip the empty-object branch entirely — preserves byte-identical behavior of the existing logger when the wrapper is a no-op. Test assertions cover both scopes (in-ALS and outside-ALS).

---

_Verified: 2026-05-07T19:49:24Z_
_Verifier: Claude (gsd-verifier)_
