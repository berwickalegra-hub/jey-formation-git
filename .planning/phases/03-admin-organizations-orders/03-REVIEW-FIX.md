---
phase: 03-admin-organizations-orders
fixed_at: 2026-05-08T19:30:00Z
review_path: .planning/phases/03-admin-organizations-orders/03-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-05-08
**Source review:** [03-REVIEW.md](./03-REVIEW.md)
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (2 Critical + 6 Warnings)
- Fixed: 8
- Skipped: 0
- Test suite after fixes: **410 passed (43 files)**

Info findings (IN-01 ... IN-05) are out of scope for this iteration per
`fix_scope: critical_warning`. IN-01 ("docstring example uses wrong
field name") was fixed opportunistically in the WR-03 commit since both
touch the same file.

## Fixed Issues

### CR-01: ADMIN can suspend a SUPERADMIN (privilege-escalation lockout)

**Files modified:** `frontend/src/app/api/admin/users/[id]/status/route.ts`,
`frontend/src/app/api/admin/users/route.test.ts`
**Commit:** `86e3b7e`
**Applied fix:** Added an in-tx role-rank guard that refuses ACTIVE -> SUSPENDED
on a SUPERADMIN target unless the actor is also SUPERADMIN. New
discriminator `SUSPEND_REQUIRES_SUPERADMIN` returns 403. Two regression
tests assert ADMIN cannot suspend a SUPERADMIN and SUPERADMIN can.

### CR-02: Order idempotency-key replay does not validate body match

**Files modified:** `frontend/src/app/api/orders/route.ts`,
`frontend/src/app/api/orders/route.test.ts`
**Commit:** `4ea78ff`
**Applied fix:** Reordered the route so Zod parse runs before the replay
branch. Computes sha256 of `{amount, currency}` and stores it on
`Order.metadata.idempotencyBodyHash` at insert time; replay compares the
stored hash against the current body's hash and returns 422
`IDEMPOTENCY_KEY_BODY_MISMATCH` on divergence. Adds a defensive
`amount + currency` fallback for rows that pre-date the deploy. Caps
`Idempotency-Key` length at 200 chars (Stripe parity). 6 regression
tests cover same-key/different-amount, same-key/different-currency,
hash-match replay, hash-mismatch replay, length cap, and metadata
fingerprint persistence.

**Schema delta queued (follow-up migration):**
The fingerprint currently lives on the existing `Order.metadata` Json
column under the reserved key `idempotencyBodyHash` to keep the live fix
migration-free per the user constraint (no `pnpm db:push` /
`db:migrate:dev`). A follow-up plan should promote this to a typed
column:

```prisma
model Order {
  // ...
  idempotencyBodyHash String? // sha256 of canonical {amount, currency}
}
```

The route already handles the pre-deploy fallback (no-stored-hash rows
fall back to direct field comparison), so the migration can run after
deploy without breaking existing rows.

### WR-01: Order replay returns `paymentUrl: null` when prior request crashed

**Files modified:** `frontend/src/app/api/orders/route.ts`,
`frontend/src/app/api/orders/route.test.ts`
**Commit:** `3150a8d`
**Applied fix:** The replay branch now distinguishes the recoverable
in-flight state (`PENDING + paymentUrl === null`) and returns 503
`PAYMENT_IN_FLIGHT` with `Retry-After: 5`. Adds 1 regression test.

### WR-02: Admin email-queue leaks PII through `to` and `subject`

**Files modified:** `frontend/src/app/api/admin/email-queue/route.ts`
**Commit:** `43baccb`
**Applied fix:** Documentation-only change per the review's
recommendation (option a — accept admin PII visibility). The route
docstring now explicitly lists which fields are returned verbatim
(`to`, `subject`, `lastError`) and which are redacted (`html` truncated
to 200-char `bodyPreview`; `text` dropped entirely). Per CONTEXT.md
D-OBS-02 admins are trusted with PII; the new comment block documents
the policy so it isn't a future regression target.

### WR-03: `enforceAdminRateLimit` fails open when Redis is null

**Files modified:** `frontend/src/lib/server/middleware/rate-limit-by-userid.ts`
**Commit:** `f274321`
**Applied fix:** The limiter now branches on `NODE_ENV`. Production
without Upstash returns 503 `RATE_LIMIT_BACKEND_UNAVAILABLE` (fail
closed); dev/test/CI keeps the previous null-return (fail open) so
local development still works. Also opportunistically updates the
docstring example to use `auth.admin.id` (closes IN-01).

### WR-04: `login` SUSPENDED branch enables enumeration of suspended emails

**Files modified:** `frontend/src/app/api/auth/login/route.ts`,
`frontend/src/app/api/auth/login/route.test.ts`
**Commit:** `dd881fd`
**Applied fix:** The SUSPENDED branch now calls `recordSuccess(email)`
before returning 403 `ACCOUNT_SUSPENDED`. Credentials already passed
verifyPassword so the user is legitimate; clearing the lockout counter
prevents the "N-1 fails before suspension + 1 fail after restore =
locked out" trap. Existing regression test updated to assert the new
behavior; comment block explains the policy.

### WR-05: Withdrawal cancel — first `findUnique` outside the lock can leak existence

**Files modified:** `frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts`
**Commit:** `4554351`
**Applied fix:** Documentation-only per the review's recommendation
(no code change required for v1). Adds a comment block above the Phase
1 `findUnique` declaring why it's safe today (Withdrawal.userId
immutable, no DELETE/transfer route in v1) and what to do if a future
migration relaxes either invariant.

### WR-06: `process.env.PUBLIC_URL` falls back to `http://localhost:3000` in prod

**Files modified:** `frontend/src/app/api/orders/route.ts`,
`frontend/src/app/api/orders/route.test.ts`
**Commit:** `0539bf1`
**Applied fix:** The route now branches on `NODE_ENV`. Production with
`PUBLIC_URL` unset returns 503 `PAYMENT_PROVIDER_UNCONFIGURED` BEFORE
order.create (boot-time misconfig disposition). Dev/test continues to
honor the localhost fallback. Adds 2 regression tests.

## Skipped Issues

None. All 8 in-scope findings were fixed.

## Out-of-scope (Info findings — deferred)

Per `fix_scope: critical_warning`, these were not addressed in this
iteration:

- IN-01: docstring example uses wrong field name — **opportunistically
  addressed** in WR-03 commit `f274321`.
- IN-02: `make-superadmin.ts` actor logging — comment-only, defer.
- IN-03: Admin orders list `customerName/Phone` exclusion — stylistic,
  defer.
- IN-04: `mockBictorysProvider.openCircuit` rename — test-utility
  rename, defer.
- IN-05: `audit-log/route.ts` `?actor=` accepts cuid only — Phase-4
  enhancement per the review's note.

## Follow-ups

1. **Schema migration** — promote
   `Order.metadata.idempotencyBodyHash` to a typed
   `Order.idempotencyBodyHash String?` column. Live fix already handles
   the pre-deploy fallback so the migration is non-breaking. Track in
   the next phase's RESEARCH.md.

2. **Boot-time PUBLIC_URL/UPSTASH assertions** — both WR-03 and WR-06
   add per-request fail-closed checks. A more proactive pattern would
   assert these envs in `frontend/instrumentation.ts` so the deploy
   fails fast instead of returning 503 on first user traffic.

---

_Fixed: 2026-05-08_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
