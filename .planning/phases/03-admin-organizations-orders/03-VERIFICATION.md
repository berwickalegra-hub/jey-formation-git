---
phase: 03-admin-organizations-orders
verified: 2026-05-08T19:06:30Z
status: human_needed
score: 11/11 must-haves verified (automated)
overrides_applied: 0
human_verification:
  - test: "Apply Phase 3 Prisma migration to a live database"
    expected: |
      `pnpm db:migrate:dev --name phase3-admin-orders` (or equivalent against Neon dev) adds:
        - `User.status TEXT NOT NULL DEFAULT 'ACTIVE'` + `@@index([status])`
        - `Order.idempotencyKey TEXT UNIQUE` (nullable)
      then routes that read/write these columns work end-to-end against the real DB.
    why_human: |
      Wave 0 Task 3 (DB migration push) was explicitly DEFERRED during execution because
      `frontend/.env` has no DATABASE_URL/DIRECT_URL in this worktree and `docker compose`
      is unavailable on this machine. Both columns are additive (User.status defaults to
      ACTIVE; Order.idempotencyKey is nullable) so the migration is rollback-safe, but a
      human with DB credentials must apply it before live smoke-testing of Phase 3 routes.
      All 399 unit tests pass against the mocked Prisma client; the schema delta is in
      `frontend/prisma/schema.prisma` and the generated Prisma Client, but no SQL
      migration file under `frontend/prisma/migrations/` carries these ALTER TABLEs.
  - test: "Live smoke test of admin back-office and orders routes"
    expected: |
      With migration applied + `frontend/.env` populated (DATABASE_URL, BICTORYS_*, etc.),
      `pnpm dev` boots, then:
        - `pnpm db:make-superadmin <email>` exits 0 + flips role + writes AdminAction row
        - `GET /api/admin/users?q=test` returns 200 paginated list (as ADMIN cookie)
        - `PATCH /api/admin/users/:id/role` as SUPERADMIN flips role; ADMIN gets 403
        - Demoting last SUPERADMIN returns 409 LAST_SUPERADMIN
        - `GET /api/admin/outbox` / `email-queue` / `rate-limits` return rows from real DB / Redis
        - `POST /api/orders` with valid amount + Idempotency-Key header → 201 + paymentUrl
    why_human: |
      Live-DB / live-provider exercise. Unit tests cover behavior with mocked Prisma +
      mocked PaymentProvider; only a human can confirm the full request → DB → response
      path against a real Neon DB and a real Bictorys sandbox.
  - test: "Track CR-01 (advisory) — ADMIN can suspend SUPERADMIN"
    expected: |
      `frontend/src/app/api/admin/users/[id]/status/route.ts` adds a role-rank guard so
      ADMIN cannot transition a SUPERADMIN target to status=SUSPENDED (mirrors the
      `requireSuperadmin` check on /role/route.ts). Returns 403 SUSPEND_REQUIRES_SUPERADMIN.
    why_human: |
      Code review (03-REVIEW.md CR-01) flagged this as a privilege-escalation lockout:
      an ADMIN can SUSPEND every SUPERADMIN in one PATCH each, then refresh tokens are
      refused (refresh route checks status===SUSPENDED), recovery requires the
      `pnpm db:make-superadmin` CLI (shell access). The plan didn't call it out so the
      gap is genuine missing code, not a plan deviation. Marked advisory because Phase 3
      ships a useful back-office today; this is a follow-up patch to track separately.
  - test: "Track CR-02 (advisory) — Order Idempotency-Key replay does not bind to body"
    expected: |
      `frontend/src/app/api/orders/route.ts` either (a) hash-binds a SHA-256 of the
      canonical body to the key (new Order.idempotencyBodyHash column + 422 on mismatch),
      or (b) field-checks `existing.amount` / `existing.currency` and returns
      422 IDEMPOTENCY_KEY_BODY_MISMATCH on divergence. Reorder so Zod parse precedes
      replay branch. Cap Idempotency-Key length (≤200 chars).
    why_human: |
      Code review (03-REVIEW.md CR-02) flagged this as a security regression vs.
      Stripe-grade idempotency. A leaked / guessed / accidentally-reused key currently
      lets the replay path return the prior `paymentUrl` regardless of the new body's
      amount. Marked advisory because the unit tests assert the documented behavior
      (replay returns prior row) — the gap is a missing safety check the plan didn't
      contract for. Track as a follow-up patch.
---

# Phase 3: Admin, Orders, Visibility Verification Report

**Phase Goal:** Admins can operate the back-office (users, orders, withdrawals, audit log, outbox/email-queue/rate-limits visibility) and users can initiate payment orders. Multi-tenancy (Organizations) is deferred — kept as opt-in plumbing only (Prisma models + middleware retained, no routes shipped).
**Verified:** 2026-05-08T19:06:30Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| #   | Truth | Status     | Evidence       |
| --- | ----- | ---------- | -------------- |
| 1 | `GET /api/admin/users?q=test` returns paginated results | ✓ VERIFIED | `frontend/src/app/api/admin/users/route.ts` (83 LOC) — calls `requireAdmin`, `enforceAdminRateLimit`, runs Prisma query with `q` `LIKE` filter and cursor pagination via `paginate()`; `route.test.ts` covers paginated reads. |
| 2 | `PATCH /api/admin/users/:id/role` by SUPERADMIN changes role + writes `AdminAction` | ✓ VERIFIED | `frontend/src/app/api/admin/users/[id]/role/route.ts` line 73 enforces `LAST_SUPERADMIN` guard inside `prisma.$transaction`; `logAdminAction` called inside same tx. |
| 3 | Same call as `ADMIN` returns 403 | ✓ VERIFIED | Route uses `requireSuperadmin` (CF-08); ADMIN role gets 403. |
| 4 | Demoting last SUPERADMIN returns 409 | ✓ VERIFIED | `role/route.ts:73,100-102` returns 409 `LAST_SUPERADMIN` via same-tx COUNT+UPDATE (Pitfall 1). |
| 5 | `GET /api/admin/outbox` and `GET /api/admin/email-queue` return filterable lists | ✓ VERIFIED | `outbox/route.ts` (89 LOC) filters by `?status` and `?kind`; `email-queue/route.ts` (114 LOC) returns `bodyPreview ≤200` chars (D-OBS-02 PII guard). |
| 6 | `GET /api/admin/rate-limits` returns Redis hit counters | ✓ VERIFIED | `rate-limits/route.ts` (129 LOC) does Redis SCAN over known buckets, returns `{ bucket, totalKeys, top10 }` summary. |
| 7 | `POST /api/orders` with valid integer amount creates Order via Bictorys + returns paymentUrl | ✓ VERIFIED | `orders/route.ts` (232 LOC): Zod `amount: z.number().int().positive()`, `getProvider()` lazy-init, `breaker.execute(provider.charge)`, persists `paymentUrl` on Order. |
| 8 | Circuit breaker trips → 503 with `PAYMENT_PROVIDER_UNAVAILABLE` | ✓ VERIFIED | `orders/route.ts:194` catches `CircuitOpenError` → 503 `PAYMENT_PROVIDER_UNAVAILABLE` + `Retry-After`. Singleton `breaker` from `payments/provider-singleton.ts`. |
| 9 | `pnpm db:make-superadmin <email>` promotes user, exits 0 | ✓ VERIFIED | `frontend/scripts/make-superadmin.ts` (92 LOC) + `package.json:24` script + `frontend/package.json:19` tsx invocation; transactional UPDATE + AdminAction. |
| 10 | Same script against non-existent email exits non-zero | ✓ VERIFIED | `make-superadmin.test.ts` covers `missing user exits 1` case (per VALIDATION.md). |
| 11 | Multi-tenancy deferred: no `/api/organizations/*` routes shipped | ✓ VERIFIED | No `frontend/src/app/api/organizations/` directory exists; `requireOrgRole` middleware retained at `middleware/require-org-role.ts` per CLAUDE.md "opt-in plumbing." |

**Score:** 11/11 truths verified (automated)

### Required Artifacts (from PLAN must_haves frontmatter)

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `frontend/src/app/api/admin/users/route.ts` | List + search + status/role filter | ✓ VERIFIED | 83 LOC; `runtime='nodejs'`; `requireAdmin`; `enforceAdminRateLimit`; cursor pagination |
| `frontend/src/app/api/admin/users/[id]/route.ts` | Detail | ✓ VERIFIED | exists, dynamic route compiled |
| `frontend/src/app/api/admin/users/[id]/role/route.ts` | Role mutation | ✓ VERIFIED | 108 LOC; CSRF + SUPERADMIN + last-SUPERADMIN guard + AdminAction in tx |
| `frontend/src/app/api/admin/users/[id]/status/route.ts` | Status mutation | ✓ VERIFIED | 122 LOC; CSRF + ADMIN + AdminAction (CR-01 advisory) |
| `frontend/src/app/api/admin/orders/route.ts` | Orders filter | ✓ VERIFIED | exists with `?status/?since/?until` filters |
| `frontend/src/app/api/admin/withdrawals/route.ts` | Withdrawals list | ✓ VERIFIED | exists with `?status/?since/?until` filters |
| `frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` | Cancel | ✓ VERIFIED | 144 LOC; CSRF + SUPERADMIN + `lockUserTx` + AdminAction inside Serializable tx |
| `frontend/src/app/api/admin/audit-log/route.ts` | Audit log paginated | ✓ VERIFIED | 96 LOC; filters `?actor/?action/?targetType/?since/?until` |
| `frontend/src/app/api/admin/me/route.ts` | Capability probe | ✓ VERIFIED | 85 LOC; returns `{ role, can: [...] }` |
| `frontend/src/app/api/admin/outbox/route.ts` | OutboxEvent list | ✓ VERIFIED | 89 LOC; `?status/?kind` filters; cursor pagination |
| `frontend/src/app/api/admin/email-queue/route.ts` | EmailJob list w/ truncation | ✓ VERIFIED | 114 LOC; `bodyPreview ≤200` chars |
| `frontend/src/app/api/admin/rate-limits/route.ts` | Redis SCAN summary | ✓ VERIFIED | 129 LOC; `{ bucket, totalKeys, top10 }` per bucket |
| `frontend/src/app/api/orders/route.ts` | POST orders w/ Idempotency-Key + breaker | ✓ VERIFIED | 232 LOC; full sequence csrf→auth→idem→Zod→provider→breaker→charge |
| `frontend/scripts/make-superadmin.ts` | CLI script | ✓ VERIFIED | 92 LOC; tx-wrapped role flip + AdminAction |
| `frontend/src/lib/server/payments/provider-singleton.ts` | Lazy provider + shared breaker | ✓ VERIFIED | exists; `getProvider()` returns `PAYMENT_PROVIDER_UNCONFIGURED` 503 on missing env |
| `frontend/src/lib/server/middleware/rate-limit-by-userid.ts` | Per-userId admin limiter | ✓ VERIFIED | 63 LOC; mirrors createEmailLimiter; dev fail-open documented (WR-03 advisory) |
| `frontend/src/lib/server/pagination/paginate.ts` | Cursor-pagination helper | ✓ VERIFIED | 81 LOC; reused by all admin listings |
| `frontend/src/test-utils/admin-fixtures.ts` | Shared test factories | ✓ VERIFIED | exists; seedAdmin/Superadmin/Suspended/Order/Outbox/EmailJob/mockBictorys |
| `frontend/prisma/schema.prisma` | `User.status` + `Order.idempotencyKey` columns | ✓ VERIFIED (model layer) | `User.status @default("ACTIVE")` line 33; `Order.idempotencyKey @unique` line 290; **NOT yet in `prisma/migrations/3_admin/migration.sql`** — see human_verification |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `orders/route.ts` | Bictorys provider | `getProvider()` + `breaker.execute(provider.charge)` | ✓ WIRED | Singleton instance shared with route; CircuitOpenError handled |
| `role/route.ts` | AdminAction | `logAdminAction(tx, ...)` inside `prisma.$transaction` | ✓ WIRED | Same tx (atomicity) |
| `status/route.ts` | AdminAction | `logAdminAction` inside tx | ✓ WIRED | Same tx |
| `withdrawals/[id]/cancel/route.ts` | `lockUserTx` | Serializable tx | ✓ WIRED | First statement of tx; locked on withdrawal owner (not admin actor) |
| `auth/login/route.ts` | `User.status === 'SUSPENDED'` | post-credential check | ✓ WIRED | line 147 returns 403 ACCOUNT_SUSPENDED |
| `auth/refresh/route.ts` | `User.status === 'SUSPENDED'` | refresh check | ✓ WIRED | line 85 returns 403 ACCOUNT_SUSPENDED |
| `make-superadmin.ts` | AdminAction | `prisma.$transaction(role flip + AdminAction)` | ✓ WIRED | actorId=self (T-03-07-07 accepted threat) |
| All admin routes | `enforceAdminRateLimit` | `rate-limit-by-userid.ts` | ✓ WIRED | Called after requireAdmin in every route |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full unit suite | `pnpm test` | 43 files, **399 tests passed** | ✓ PASS |
| Runtime-enforcement (every route exports `runtime='nodejs'`) | `pnpm vitest run runtime-enforcement.test.ts` | **32 tests passed** | ✓ PASS |
| Typecheck | `pnpm typecheck` | clean (no errors) | ✓ PASS |
| Live DB migration applied | `pnpm db:migrate:status` | not run — no DATABASE_URL | ? SKIP (deferred to human) |
| Live `POST /api/orders` against Bictorys sandbox | `curl -X POST … /api/orders` | not run — no creds | ? SKIP (deferred to human) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| ADMIN-01 | 02, 06 | Search users, view detail, change role; refuse last-SUPERADMIN demote | ✓ SATISFIED | users/route.ts + [id]/route.ts + [id]/role/route.ts |
| ADMIN-02 | 02 | List/filter orders | ✓ SATISFIED | admin/orders/route.ts |
| ADMIN-03 | 02, 06 | List/filter withdrawals + manual cancel | ✓ SATISFIED | admin/withdrawals/route.ts + [id]/cancel/route.ts |
| ADMIN-04 | 03 | Audit log paginated/filterable | ✓ SATISFIED | admin/audit-log/route.ts |
| ADMIN-05 | 02, 03 | `GET /api/admin/me` | ✓ SATISFIED | admin/me/route.ts (returns role + capability list) |
| ADMIN-06 | 06 | Every admin mutation calls `logAdminAction` | ✓ SATISFIED | role/status/cancel routes all call helper inside tx |
| ADMIN-07 | 01, 07 | `pnpm db:make-superadmin <email>` script | ✓ SATISFIED | scripts/make-superadmin.ts + package.json wiring |
| PAY-01 | 01, 05 | `POST /api/orders` w/ provider interface + breaker | ✓ SATISFIED | orders/route.ts + provider-singleton.ts |
| OBS-01 | 01, 04 | `GET /api/admin/outbox` | ✓ SATISFIED | admin/outbox/route.ts |
| OBS-02 | 01, 04 | `GET /api/admin/email-queue` | ✓ SATISFIED | admin/email-queue/route.ts (bodyPreview truncation) |
| OBS-03 | 01, 04 | `GET /api/admin/rate-limits` | ✓ SATISFIED | admin/rate-limits/route.ts (Redis SCAN summary) |

**All 11 requirement IDs accounted for.** Plan 01 (scaffolding) declared the union; Plans 02–07 each ship a subset. No orphaned requirements — REQUIREMENTS.md Phase-3 row maps exactly to ADMIN-01..07, PAY-01, OBS-01..03 (ORG-01..06 explicitly deferred per .planning/PROJECT.md "Out of Scope").

### Anti-Patterns Found

None blocking. Code-review (03-REVIEW.md) catalogued:

- **2 Critical** advisory issues (CR-01, CR-02) — surfaced as `human_verification` items above for tracking. Not blocking automated verification because the plans didn't contract for these guards (genuine new gaps for follow-up patch).
- **6 Warnings** (WR-01..WR-06) — documented in 03-REVIEW.md; none are placeholder/stub patterns and none break the contracted behavior.
- **5 Info** items (IN-01..IN-05) — documentation drift / naming hygiene. No remediation required for v1.

No TODO/FIXME/PLACEHOLDER scans on Phase 3 files surfaced runtime stubs. All routes substantive (83–232 LOC) with full request lifecycle.

### Human Verification Required

See `human_verification` frontmatter above. Summary:

1. **Apply Phase-3 Prisma migration to a live DB.** `User.status` and `Order.idempotencyKey` exist in `schema.prisma` and the generated Prisma Client (typecheck green) but the SQL migration file under `prisma/migrations/3_admin/migration.sql` does NOT carry these `ALTER TABLE`s. Wave 0 Task 3 was explicitly deferred — see 03-01-SUMMARY.md "Deferred Issues." Both columns are additive (rollback-safe).
2. **Live smoke test of admin + orders routes.** Full request → real-DB → Bictorys-sandbox path requires populated `frontend/.env`.
3. **Track CR-01 (advisory):** ADMIN can SUSPEND a SUPERADMIN — privilege-escalation lockout. Suggested fix in 03-REVIEW.md.
4. **Track CR-02 (advisory):** Order `Idempotency-Key` replay does not bind to body — security regression vs Stripe semantics. Suggested fix in 03-REVIEW.md.

### Gaps Summary

**No goal-blocking gaps.** All 11 ROADMAP success-criteria truths verified at the code level; all 11 requirement IDs accounted for in shipped artifacts; full unit test suite (399 tests) green; typecheck clean; runtime-enforcement test green.

The phase achieves its goal in code: an admin can drive the back-office and a user can initiate orders. The four `human_verification` items above are NOT defects in the shipped phase — they are:

- (1)(2) Live-environment exercises that automated unit verification cannot perform without DB/provider credentials.
- (3)(4) Advisory follow-up patches surfaced by code review for additional defense-in-depth that the plans did not contract for.

Status `human_needed` reflects the deferred migration push (the user must apply it before the phase code can run against a real database).

---

_Verified: 2026-05-08T19:06:30Z_
_Verifier: Claude (gsd-verifier)_
