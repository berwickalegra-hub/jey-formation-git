---
phase: 3
slug: admin-organizations-orders
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 (already configured from Phase 0) |
| **Config file** | `frontend/vitest.config.ts` |
| **Quick run command** | `pnpm --filter frontend exec vitest run <file under change>` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~10–15 seconds (unit-only; no integration tests this phase) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter frontend exec vitest run <file under change>`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite green AND `pnpm typecheck && pnpm lint`
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Task IDs assume a wave structure of: Wave 0 = scaffolding/migration/fixtures, Wave 1 = read endpoints + non-protected mutations + POST /api/orders, Wave 2 = protected-file edits + admin mutations + make-superadmin script. Final task IDs come from gsd-planner — this map captures the verification commands per-requirement.

| Req ID | Behavior | Wave | Test Type | Automated Command | File Exists | Status |
|--------|----------|------|-----------|-------------------|-------------|--------|
| ADMIN-01 | `GET /api/admin/users?q=test` paginated; ADMIN can read | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/users/route.test.ts` | ❌ W0 | ⬜ pending |
| ADMIN-01 | `PATCH /api/admin/users/:id/role` by SUPERADMIN → 200 + AdminAction row | 1 | unit | `pnpm --filter frontend exec vitest run -t "role change SUPERADMIN"` | ❌ W0 | ⬜ pending |
| ADMIN-01 | `PATCH /api/admin/users/:id/role` by ADMIN → 403 `ADMIN_REQUIRED` | 1 | unit | `pnpm --filter frontend exec vitest run -t "role change requires SUPERADMIN"` | ❌ W0 | ⬜ pending |
| ADMIN-01 / CF-09 | Demote last SUPERADMIN → 409 `LAST_SUPERADMIN` (same-tx COUNT+UPDATE) | 1 | unit | `pnpm --filter frontend exec vitest run -t "last SUPERADMIN"` | ❌ W0 | ⬜ pending |
| ADMIN-02 | `GET /api/admin/orders` filterable + paginated | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/orders/route.test.ts` | ❌ W0 | ⬜ pending |
| ADMIN-03 | `GET /api/admin/withdrawals` list | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/withdrawals/route.test.ts` | ❌ W0 | ⬜ pending |
| ADMIN-03 | `POST /api/admin/withdrawals/:id/cancel` (SUPERADMIN) | 2 | unit | `pnpm --filter frontend exec vitest run -t "withdrawal cancel"` | ❌ W0 | ⬜ pending |
| ADMIN-04 | `GET /api/admin/audit-log` paginated, filterable | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/audit-log/route.test.ts` | ❌ W0 | ⬜ pending |
| ADMIN-05 | `GET /api/admin/me` returns role + capability list | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/me/route.test.ts` | ❌ W0 | ⬜ pending |
| ADMIN-05 | Admin endpoints rate-limited per-userId | 1 | unit | `pnpm --filter frontend exec vitest run -t "admin rate limit per-userId"` | ❌ W0 | ⬜ pending |
| ADMIN-06 | Every mutation writes AdminAction (transitively in 01/03/cancel) | 1–2 | unit assertion | `pnpm --filter frontend exec vitest run -t "logAdminAction"` | ❌ W0 | ⬜ pending |
| ADMIN-07 | `pnpm db:make-superadmin <email>` exit 0 on existing user | 2 | unit | `pnpm --filter frontend exec vitest run scripts/make-superadmin.test.ts` | ❌ W0 | ⬜ pending |
| ADMIN-07 | `pnpm db:make-superadmin <missing>` exits non-zero with clear message | 2 | unit | `pnpm --filter frontend exec vitest run -t "missing user exits 1"` | ❌ W0 | ⬜ pending |
| PAY-01 | `POST /api/orders` with valid integer amount → 201 + paymentUrl | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/orders/route.test.ts` | ❌ W0 | ⬜ pending |
| PAY-01 | Replay with same Idempotency-Key returns prior result (incl. failed circuit-open) | 1 | unit | `pnpm --filter frontend exec vitest run -t "replays returns prior order"` | ❌ W0 | ⬜ pending |
| PAY-01 | Circuit open → 503 `PAYMENT_PROVIDER_UNAVAILABLE` | 1 | unit | `pnpm --filter frontend exec vitest run -t "circuit open returns 503"` | ❌ W0 | ⬜ pending |
| PAY-01 | Missing env → 503 `PAYMENT_PROVIDER_UNCONFIGURED` (lazy-init guard) | 1 | unit | `pnpm --filter frontend exec vitest run -t "PAYMENT_PROVIDER_UNCONFIGURED"` | ❌ W0 | ⬜ pending |
| OBS-01 | `GET /api/admin/outbox` paginated, status + kind filters (note: schema uses `kind` not `type`) | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/outbox/route.test.ts` | ❌ W0 | ⬜ pending |
| OBS-02 | `GET /api/admin/email-queue` returns `bodyPreview` ≤200 chars (PII protection) | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/email-queue/route.test.ts` | ❌ W0 | ⬜ pending |
| OBS-03 | `GET /api/admin/rate-limits` returns bucket summary from Redis SCAN (mocked) | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/rate-limits/route.test.ts` | ❌ W0 | ⬜ pending |
| D-ADMIN-02 | Login refuses SUSPENDED user → 403 `ACCOUNT_SUSPENDED` | 2 | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/login/route.test.ts -t "SUSPENDED"` | ⚠️ extend existing | ⬜ pending |
| D-ADMIN-02 | Refresh refuses SUSPENDED user → 403 `ACCOUNT_SUSPENDED` | 2 | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/refresh/route.test.ts -t "SUSPENDED"` | ⚠️ extend existing | ⬜ pending |
| (runtime invariant) | Every new admin/orders route exports `runtime='nodejs'` | 0 | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test scaffolding to create or extend in Wave 0:

- [ ] `frontend/src/app/api/admin/users/route.test.ts` — covers ADMIN-01 read paths + role/status/last-superadmin/suspended-restore paths
- [ ] `frontend/src/app/api/admin/orders/route.test.ts` — covers ADMIN-02 filters + pagination
- [ ] `frontend/src/app/api/admin/withdrawals/route.test.ts` — covers ADMIN-03 list + cancel
- [ ] `frontend/src/app/api/admin/audit-log/route.test.ts` — covers ADMIN-04
- [ ] `frontend/src/app/api/admin/me/route.test.ts` — covers ADMIN-05 + capability list
- [ ] `frontend/src/app/api/admin/outbox/route.test.ts` — covers OBS-01 (note: filter is `?kind=`, not `?type=`)
- [ ] `frontend/src/app/api/admin/email-queue/route.test.ts` — covers OBS-02 (truncation to ≤200)
- [ ] `frontend/src/app/api/admin/rate-limits/route.test.ts` — covers OBS-03 (Upstash redis mocked)
- [ ] `frontend/src/app/api/orders/route.test.ts` — covers PAY-01 (CircuitBreaker + idempotency + UNCONFIGURED guard)
- [ ] `frontend/scripts/make-superadmin.test.ts` — covers ADMIN-07 (exit codes + missing-user message)
- [ ] `frontend/src/test-utils/admin-fixtures.ts` — shared factories: `seedAdmin()`, `seedSuperadmin()`, `seedDemotableSuperadmin()` (creates 2 SUPERADMINs so one is demotable), `seedSuspendedUser()`, `seedOrder()`, `seedOutbox()`, `seedEmailJob()`, `mockRedis()`, `mockBictorysProvider({ openCircuit?: boolean })`

Framework install: **none** — Vitest already configured from Phase 0.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Bictorys charge end-to-end | PAY-01 | Live API call requires network + sandbox creds; not part of unit suite | (1) set `BICTORYS_API_KEY` + `BICTORYS_PRIVATE_KEY` + `BICTORYS_BASE_URL` to sandbox; (2) `curl -X POST http://localhost:3000/api/orders -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" --cookie "$COOKIES" -d '{"amount":1000,"currency":"XOF","successUrl":"…","failureUrl":"…"}'`; (3) confirm 201 + `paymentUrl` opens Bictorys checkout |
| `pnpm db:make-superadmin <email>` against real Neon | ADMIN-07 | Exercises real Prisma client against a real DB | (1) `docker compose up -d`; (2) seed a User row; (3) `pnpm db:make-superadmin <email>` → assert exit 0 + role=SUPERADMIN in DB; (4) repeat with non-existent email → assert exit non-zero + clear stderr message |
| Redis SCAN against a populated rate-limit store | OBS-03 | Unit test mocks redis; live SCAN behavior validated against Upstash | (1) generate traffic to populate `rl:auth:login:*`; (2) `curl /api/admin/rate-limits` as ADMIN; (3) confirm bucket counts ≥0 and top-10 keys present |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (10 new test files + 1 fixture file)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
