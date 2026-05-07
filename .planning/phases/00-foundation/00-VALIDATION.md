---
phase: 0
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 |
| **Config file** | `frontend/vitest.config.ts` (does NOT exist — Wave 0 creates it) |
| **Quick run command** | `pnpm --filter frontend exec vitest run <path>` |
| **Full suite command** | `pnpm test` (runs `vitest run` in frontend) |
| **Estimated runtime** | ~5 seconds (pure file-string and ALS unit tests) |

---

## Sampling Rate

- **After every task commit:** Run the test file changed (e.g. `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts`)
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green; `pnpm typecheck` and `pnpm lint` must also be green
- **Max feedback latency:** ≤ 5 seconds

---

## Per-Task Verification Map

> Filled by the planner once tasks are numbered. Each task ID must map to at least one test or grep-verifiable acceptance criterion.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | OPS-01 | — | `.env.example` declares `DATABASE_URL` (pooler shape), `DIRECT_URL`, `CRON_SECRET` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | OPS-01 | — | `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/schema-direct-url.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | OPS-02 | T-V14 | Every `app/api/**/route.ts` exports `runtime = 'nodejs'`; none exports `runtime = 'edge'` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | OPS-03 | — | `instrumentation.ts` re-exports `onRequestError` from `@sentry/nextjs` | unit (string-assert) | `pnpm --filter frontend exec vitest run src/lib/server/observability/instrumentation-shape.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | OPS-04 | — | `.env.example` documents `CRON_SECRET` with `openssl rand -base64 32` hint (covered by OPS-01 env-shape test) | unit | (covered above) | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | OPS-05 | T-V14 | `next.config.ts` does NOT contain `experimental.instrumentationHook` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/next-config-clean.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | OBS-04 | T-V5 | `request-context` module mints UUID, preserves across awaits, rejects malformed inbound IDs | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/request-context.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | OBS-04 | — | Logger wrapper injects `requestId` from ALS into log context | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/log.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | OBS-05 | — | `instrumentation.ts` calls `registerOTel({ serviceName: 'amadou-monolith' })` (covered by OPS-03 instrumentation-shape test) | unit | (covered above) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Threat refs:** T-V5 = ASVS V5 Input Validation (X-Request-Id poisoning); T-V14 = ASVS V14 Configuration (runtime/config drift). Full threat model in PLAN.md `<threat_model>` block.

---

## Wave 0 Requirements

- [ ] `frontend/vitest.config.ts` — minimal config with `@/*` alias, `include: ['src/**/*.test.ts']`, `environment: 'node'`
- [ ] `frontend/src/lib/server/observability/` — directory + `index.ts` if barrel needed
- [ ] `frontend/src/lib/server/observability/runtime-enforcement.test.ts` — runtime guard
- [ ] `frontend/src/lib/server/observability/env-shape.test.ts` — covers OPS-01 + OPS-04
- [ ] `frontend/src/lib/server/observability/schema-direct-url.test.ts` — OPS-01 schema check
- [ ] `frontend/src/lib/server/observability/instrumentation-shape.test.ts` — OPS-03 + OBS-05
- [ ] `frontend/src/lib/server/observability/next-config-clean.test.ts` — OPS-05
- [ ] `frontend/src/lib/server/observability/request-context.test.ts` — OBS-04 ALS unit test
- [ ] `frontend/src/lib/server/observability/log.test.ts` — OBS-04 logger-wrapper unit test
- [ ] Add deps via pnpm: `@vercel/otel@^2.1.2` (prod), `fast-glob@^3.3.3` (dev)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `pnpm dev` boots cleanly with new instrumentation.ts (OTel + Sentry coexistence) | OBS-05 / OPS-03 | A3 of RESEARCH.md — Sentry + OTel co-loading is empirically conflict-free but not unit-testable. Boot order is what matters. | Run `pnpm dev`; visit `/api/health` and `/api/readyz`; confirm no `Cannot find module` errors, no double-instrumentation warnings, Sentry test event still arrives if `SENTRY_DSN` set. |
| `pnpm install` reports no peer-dep blockers after adding `@vercel/otel` | OBS-05 / Pitfall 5 | Peer-dep resolution is environment-specific; cannot be unit-tested. | Run `pnpm install`; check stdout for `WARN  Issues with peer dependencies`. If any OTel SDK peers flagged, install explicitly per RESEARCH §Installation. |
| `prisma generate` regenerates client cleanly after `directUrl` addition | OPS-01 | Idempotency claim (A5) is corroborated but execution-dependent. | Run `pnpm --filter frontend exec prisma generate`; confirm exit code 0; confirm no TypeScript errors in any file importing `@prisma/client`. |

---

## Validation Architecture compliance

This file maps every Phase 0 REQ-ID to at least one automated assertion. Manual verifications are limited to the three operational checks above (boot order, peer deps, codegen) — all unsuitable for unit testing. No requirement is left without coverage.

When the planner numbers tasks, replace `TBD` in the Per-Task Verification Map with the actual task IDs and update Wave/Plan columns. Set `nyquist_compliant: true` once all tests are written and `wave_0_complete: true` once Wave 0 deps + scaffolding land.
