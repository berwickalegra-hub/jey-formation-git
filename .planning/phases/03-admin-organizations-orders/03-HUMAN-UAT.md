---
status: partial
phase: 03-admin-organizations-orders
source: [03-VERIFICATION.md]
started: 2026-05-08T19:06:30Z
updated: 2026-05-08T19:06:30Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Apply Phase 3 Prisma migration to a live database
expected: |
  `pnpm db:migrate:dev --name phase3-admin-orders` (or equivalent against Neon dev) adds:
    - `User.status TEXT NOT NULL DEFAULT 'ACTIVE'` + `@@index([status])`
    - `Order.idempotencyKey TEXT UNIQUE` (nullable)
  then routes that read/write these columns work end-to-end against the real DB.
why_human: |
  Wave 0 Task 3 was DEFERRED during execution: no `frontend/.env` with DATABASE_URL/DIRECT_URL
  in this environment and `docker compose` is unavailable. Both columns are additive (User.status
  defaults to ACTIVE; Order.idempotencyKey is nullable) so the migration is rollback-safe.
  All 399 unit tests pass against mocked Prisma; the schema delta is committed but no SQL
  migration file carries the ALTER TABLEs.
result: [pending]

### 2. Live smoke test of admin back-office and orders routes
expected: |
  With migration applied + `frontend/.env` populated (DATABASE_URL, BICTORYS_*, etc.),
  `pnpm dev` boots, then:
    - `pnpm db:make-superadmin <email>` exits 0 + flips role + writes AdminAction row
    - `GET /api/admin/users?q=test` returns 200 paginated list (as ADMIN cookie)
    - `PATCH /api/admin/users/:id/role` as SUPERADMIN flips role; ADMIN gets 403
    - Demoting last SUPERADMIN returns 409 LAST_SUPERADMIN
    - `POST /api/orders` with valid amount + Idempotency-Key returns 201 + paymentUrl
    - Same key replay returns prior result; FAILED prior returns 503
    - SUSPENDED user (status=SUSPENDED in DB) cannot login or refresh (403 ACCOUNT_SUSPENDED)
why_human: |
  Live HTTP integration testing requires the migration applied and Bictorys sandbox creds.
  Unit tests cover the logic; this validates the wire shape end-to-end before shipping.
result: [pending]

### 3. Track CR-01 (advisory) — ADMIN can suspend SUPERADMIN
expected: |
  Decide whether to ship a follow-up patch that adds a SUSPEND_REQUIRES_SUPERADMIN guard
  in `frontend/src/app/api/admin/users/[id]/status/route.ts` so an ADMIN cannot lock all
  SUPERADMINs out via PATCH .../status. Currently only `pnpm db:make-superadmin` recovers.
why_human: |
  Code review (03-REVIEW.md CR-01) flagged this as a Critical privilege/availability issue.
  Not blocking phase 3 verification (the test suite + plan-checker did not require this guard
  in the original CONTEXT decisions), but should be addressed before shipping multi-admin in
  production.
result: [pending]

### 4. Track CR-02 (advisory) — Order Idempotency-Key replay does not bind to body
expected: |
  Decide whether to ship a follow-up patch that hashes the request body and stores the hash
  alongside the Idempotency-Key, then returns 422 IDEMPOTENCY_KEY_BODY_MISMATCH when the
  same key is reused with different `amount` or `currency`. Stripe's documented behavior.
why_human: |
  Code review (03-REVIEW.md CR-02) flagged this as a Critical security/correctness issue —
  a leaked or reused key paired with a different body returns the original paymentUrl,
  which is incorrect contract behavior even if not exploitable in our current threat model.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
