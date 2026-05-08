# Phase 5: Validation Strategy

**Status:** authored 2026-05-08; mirrors `05-RESEARCH.md` § "Validation Architecture" (lines 1013–1068)

The complete validation strategy lives in [05-RESEARCH.md](05-RESEARCH.md) under the "Validation Architecture" heading. This file is a structured pointer so the Nyquist artifact check has a canonical home, and so future phases can find it without grep.

## Test framework

| Property | Value |
|----------|-------|
| Framework | Vitest (configured Phase 0 Plan 00-01) |
| Config | `frontend/vitest.config.ts` |
| Setup | `frontend/vitest.setup.ts` |
| Quick run | `pnpm --filter frontend exec vitest run <test-file>` |
| Full suite | `pnpm test` |
| Phase gate | `pnpm format && pnpm lint && pnpm typecheck && pnpm test` |

## Phase requirements → test map

Every phase requirement ID has at least one automated test. New routes share a single `runtime-enforcement.test.ts` tripwire (existing) which fails CI if any new `route.ts` forgets `export const runtime = 'nodejs'`.

| Req ID | Behavior verified | Test file (Wave 0 RED) |
|--------|-------------------|------------------------|
| WH-01 | runtime + raw-body via `req.arrayBuffer()` + 60s replay window | `src/app/api/webhooks/bictorys/route.test.ts` |
| WH-02 | Idempotent replay; outbox enqueue inside same tx | same file as WH-01 |
| CRON-01 | outbox-drain: 100 rows; 90s stuck-row reset | `src/app/api/cron/outbox-drain/route.test.ts` |
| CRON-02 | email-queue-drain: 100 rows | `src/app/api/cron/email-queue-drain/route.test.ts` |
| CRON-03 | verification-cleanup deleteMany | `src/app/api/cron/verification-cleanup/route.test.ts` |
| CRON-04 | order-expiration: PENDING → EXPIRED | `src/app/api/cron/order-expiration/route.test.ts` |
| CRON-05 | webhook-log-purge: retention deleteMany | `src/app/api/cron/webhook-log-purge/route.test.ts` |
| CRON-06 | All 5 crons return 401 without correct Bearer | `src/lib/server/cron/auth.test.ts` + 5× per-route `verifyCronSecret` cases |
| CRON-07 | `vercel.json` schema + path/route cross-check | `src/lib/server/observability/vercel-json-shape.test.ts` |
| ENV | New env keys present in `.env.example` | `src/lib/server/observability/env-shape.test.ts` (Phase 5 assertions appended) |

## Sampling rate

- **Per task commit:** quick run on the affected route's test file (< 5s)
- **Per wave merge:** full Vitest suite (`pnpm test`, currently < 30s)
- **Phase gate:** format + lint + typecheck + test, all green

## Wave 0 RED test inventory

The full list of RED-test files Wave 0 must ship is enumerated in `05-RESEARCH.md` § "Wave 0 Gaps" (lines 1051–1068). Eleven test files, three new helpers, one fixture, two `.env.example` blocks.

## Coverage assertion

Every requirement ID in `phase_req_ids` (`WH-01, WH-02, CRON-01..07`) has at least one row in the table above. The plan-checker enforces this by cross-referencing PLAN frontmatter `requirements` fields against `REQUIREMENTS.md`.

## Security domain (referenced)

Threat model and ASVS categories live in `05-RESEARCH.md` § "Security Domain" (line 1070+). The webhook-handler factory's HMAC-verify branch + the cron-auth helper's constant-time compare are the load-bearing security boundaries; both have dedicated tests in the table above.

---

*Phase: 05-webhooks-and-vercel-cron*
*Validation strategy authored: 2026-05-08*
