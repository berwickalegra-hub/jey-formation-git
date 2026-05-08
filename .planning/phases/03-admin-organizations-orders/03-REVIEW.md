---
phase: 03-admin-organizations-orders
reviewed: 2026-05-08T00:00:00Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - frontend/prisma/schema.prisma
  - frontend/scripts/make-superadmin.ts
  - frontend/scripts/make-superadmin.test.ts
  - frontend/src/app/api/admin/audit-log/route.ts
  - frontend/src/app/api/admin/audit-log/route.test.ts
  - frontend/src/app/api/admin/email-queue/route.ts
  - frontend/src/app/api/admin/email-queue/route.test.ts
  - frontend/src/app/api/admin/me/route.ts
  - frontend/src/app/api/admin/me/route.test.ts
  - frontend/src/app/api/admin/orders/route.ts
  - frontend/src/app/api/admin/orders/route.test.ts
  - frontend/src/app/api/admin/outbox/route.ts
  - frontend/src/app/api/admin/outbox/route.test.ts
  - frontend/src/app/api/admin/rate-limits/route.ts
  - frontend/src/app/api/admin/rate-limits/route.test.ts
  - frontend/src/app/api/admin/users/route.ts
  - frontend/src/app/api/admin/users/route.test.ts
  - frontend/src/app/api/admin/users/[id]/route.ts
  - frontend/src/app/api/admin/users/[id]/route.test.ts
  - frontend/src/app/api/admin/users/[id]/role/route.ts
  - frontend/src/app/api/admin/users/[id]/status/route.ts
  - frontend/src/app/api/admin/withdrawals/route.ts
  - frontend/src/app/api/admin/withdrawals/route.test.ts
  - frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts
  - frontend/src/app/api/orders/route.ts
  - frontend/src/app/api/orders/route.test.ts
  - frontend/src/app/api/auth/login/route.ts
  - frontend/src/app/api/auth/refresh/route.ts
  - frontend/src/lib/server/middleware/rate-limit-by-userid.ts
  - frontend/src/lib/server/pagination/paginate.ts
  - frontend/src/lib/server/payments/provider-singleton.ts
  - frontend/src/test-utils/admin-fixtures.ts
  - frontend/vitest.config.ts
findings:
  critical: 2
  warning: 6
  info: 5
  total: 13
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-08
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Phase 3 lands the admin back-office (13 read/mutation routes), the user-facing
`POST /api/orders` payment-creation route, schema additions (`User.status`,
`Order.idempotencyKey`), and supporting helpers (paginate, rate-limit-by-userid,
provider-singleton, admin-fixtures, make-superadmin CLI).

CLAUDE.md invariants are mostly honored: every Route Handler exports
`runtime = 'nodejs'`; every mutating route calls `verifyCsrf(req)` BEFORE auth;
admin mutations call `logAdminAction` inside the same `prisma.$transaction` as
the UPDATE; the last-SUPERADMIN guard is COUNT+UPDATE-in-same-tx (Pitfall 1);
the withdrawal-cancel route uses `lockUserTx` as the first statement of a
`Serializable` `prisma.$transaction` keyed on the **withdrawal owner** (not the
admin actor); payment amounts stay `Int`; `getProvider()` lazy-init returns 503
`PAYMENT_PROVIDER_UNCONFIGURED` instead of crashing on import.

Two Critical issues stand out:

1. **ADMIN can suspend a SUPERADMIN** through the status route (no role-rank
   check on the target), giving an ADMIN a one-step lockout of every higher-
   privilege account. The Phase-3 plan didn't call this out, so the gap is
   genuine code missing rather than a plan deviation.
2. **Order idempotency key trusts the request body** — replays return the prior
   row keyed only on the `Idempotency-Key` header, with no body-hash binding.
   A leaked or guessed key (or a client bug that reuses one) lets an attacker
   submit a different `amount` and get back the original `paymentUrl`. Stripe-
   grade idempotency hashes the body and 422s on mismatch.

Six Warnings cover correctness gaps (`paymentUrl: null` replay, email-queue PII
beyond `bodyPreview`, fail-open admin rate limiter when Redis is null, login
SUSPENDED-branch leaks enumeration, OAuth-only user code-path, no admin-rate-
limit on the cancel route's `prisma.withdrawal.findUnique` outside the tx) and
five Info items cover documentation drift, test brittleness, and minor type
hygiene.

---

## Critical Issues

### CR-01: ADMIN can suspend a SUPERADMIN (privilege-escalation lockout)

**File:** `frontend/src/app/api/admin/users/[id]/status/route.ts:47,80-82`
**Issue:** The route gates on `requireAdmin('ADMIN')` so any ADMIN passes.
The only role check inside the tx is `isRestore && auth.admin.role !==
'SUPERADMIN'` (blocks SUSPENDED→ACTIVE). There is no symmetric guard
preventing an ADMIN from suspending a target whose role is SUPERADMIN. Combined
with the new `ACCOUNT_SUSPENDED` 403 on `POST /api/auth/login` and `POST
/api/auth/refresh` (login/route.ts:147-152, refresh/route.ts:85-90), an ADMIN
can lock every SUPERADMIN out of the system in a single PATCH, then enjoy
unchecked write access to roles, users, and withdrawals (modulo the
`requireSuperadmin()` gate, which only matters if at least one SUPERADMIN can
log back in — once all are SUSPENDED, only the `pnpm db:make-superadmin` CLI
can recover, requiring shell access). The `last-SUPERADMIN` guard on
`/role/route.ts` is bypassed because suspending the SUPERADMIN never touches
the `User.role` column.

This violates CLAUDE.md's "Admin role precedence: USER < ADMIN < SUPERADMIN.
Only SUPERADMIN can change roles" — suspending a SUPERADMIN is functionally a
role change (it strips authentication). The same precedence rule must apply.

**Fix:** Inside the `prisma.$transaction` callback, after the
`tx.user.findUnique` that fetches `target` (which already selects `role`), add:

```ts
// Role-rank guard: ADMIN cannot suspend a SUPERADMIN. Mirrors
// requireSuperadmin() — without this, an ADMIN can lock all SUPERADMINs out
// via SUSPENDED status without ever touching the role column.
const isSuspend =
  target.status === 'ACTIVE' && parsed.data.status === 'SUSPENDED';
if (isSuspend && target.role === 'SUPERADMIN' && auth.admin.role !== 'SUPERADMIN') {
  return { kind: 'SUSPEND_REQUIRES_SUPERADMIN' as const };
}
```

Add the matching discriminator and 403 with stable code
`SUSPEND_REQUIRES_SUPERADMIN`. Add a regression test:

```ts
it('PATCH ACTIVE → SUSPENDED on a SUPERADMIN by ADMIN → 403 SUSPEND_REQUIRES_SUPERADMIN', async () => {
  prismaMock.user.findUnique.mockResolvedValueOnce({
    id: 'super_target', status: 'ACTIVE', role: 'SUPERADMIN', email: 's@x',
  } as never);
  const res = await PATCH_STATUS(
    makePatch('http://test/api/admin/users/super_target/status', { status: 'SUSPENDED' }),
    paramsOf('super_target'),
  );
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe('SUSPEND_REQUIRES_SUPERADMIN');
  expect(prismaMock.user.update).not.toHaveBeenCalled();
});
```

Optional defense-in-depth: also block `target.id === auth.admin.id` self-
suspend by an ADMIN (less severe; a self-locked-out ADMIN is not a privilege
gain, just an ops headache).

---

### CR-02: Order idempotency-key replay does not validate body match

**File:** `frontend/src/app/api/orders/route.ts:80-106`
**Issue:** The replay branch returns the prior order row keyed solely on the
`Idempotency-Key` header. There is no body comparison (no body hash stored,
no field comparison against `existing.amount` / `existing.currency`). Stripe-
grade idempotency requires the request body to match the original — a different
body with the same key returns `422` (`idempotency_key_in_use`). Without that
binding:

- A first-party client bug that reuses a key across distinct payments returns
  the prior `paymentUrl` regardless of the new amount. The user is charged
  the old amount and redirected to the old checkout.
- A leaked / guessed key (the value is client-supplied; no entropy contract is
  enforced) lets an attacker submit `{ amount: 1 }` and receive back the
  victim's prior `paymentUrl` for the original amount.

CLAUDE.md "Stripe-grade idempotency. Required header on POST /api/orders;
replay with same value returns the original Order row instead of double-
charging" — the docstring on the schema column says the same thing. The
implementation echoes the prior outcome but doesn't enforce that the
"original Order row" was created under the same body.

**Fix:** Either:

(a) **Hash-bind the body to the key.** Store a SHA-256 of the canonicalized
body (`amount|currency|customerEmail|customerPhone|customerName|metadata`) in
a new `Order.idempotencyBodyHash String?` column; on replay compare hashes
and return `422 IDEMPOTENCY_KEY_BODY_MISMATCH` if they differ. This is the
Stripe semantics. Required schema change + migration.

(b) **Field-check the existing row** for at minimum `amount` and `currency`
(the load-bearing fields):

```ts
if (existing) {
  if (existing.amount !== parsed.data.amount || existing.currency !== parsed.data.currency) {
    return NextResponse.json(
      {
        error: 'IDEMPOTENCY_KEY_BODY_MISMATCH',
        message: 'Idempotency-Key already used for a different request body.',
      },
      { status: 422, headers: { 'x-request-id': ctx.requestId } },
    );
  }
  // ... existing replay branch
}
```

This requires moving the Zod parse before the replay branch (currently parse
is at step 5, replay at step 4 per the docstring). Adjust the sequence:
`csrf → auth → idem-key header check → Zod parse → replay branch (with body
match) → provider lookup → create → charge`. Add tests: same-key + same-body
returns 200 prior row; same-key + different `amount` returns 422.

Note: also add a max-length check on the `Idempotency-Key` header (e.g. ≤200
chars) to prevent unbounded keyspace abuse via huge keys.

---

## Warnings

### WR-01: Order replay returns `paymentUrl: null` when prior request crashed

**File:** `frontend/src/app/api/orders/route.ts:84-94`
**Issue:** The replay branch returns `existing.paymentUrl` for `PENDING` orders
unconditionally. But `paymentUrl` is set by the second `prisma.order.update`
(line 177) — if the first request crashed between `prisma.order.create` (line
140) and the post-charge `update`, the row is `PENDING` with `paymentUrl =
null`. A client retrying with the same idempotency key receives:

```json
{ "id": "order_xxx", "paymentUrl": null, "status": "PENDING" }
```

The frontend cannot redirect, the user is stuck. Worse, the breaker.execute
side never runs again because the row already exists.

**Fix:** Treat `PENDING + paymentUrl === null` as a recoverable in-flight state.
Either re-call `provider.charge()` to obtain a fresh `paymentUrl`, or return a
distinct 503 with code `PAYMENT_IN_FLIGHT` instructing the client to retry
shortly:

```ts
if (existing.status === 'PENDING' && !existing.paymentUrl) {
  return NextResponse.json(
    { error: 'PAYMENT_IN_FLIGHT', message: 'Prior attempt did not complete; retry shortly.' },
    { status: 503, headers: { 'x-request-id': ctx.requestId, 'Retry-After': '5' } },
  );
}
if (existing.status === 'PENDING' || existing.status === 'PAID') {
  return NextResponse.json(
    { id: existing.id, paymentUrl: existing.paymentUrl, status: existing.status },
    { status: 200, headers: { 'x-request-id': ctx.requestId } },
  );
}
```

Re-charging is cleaner but raises the question of whether to mint a fresh
provider charge id (yes — the original is dead; persist the new one and overwrite
`providerChargeId`).

---

### WR-02: Admin email-queue leaks PII through `to` and `subject`

**File:** `frontend/src/app/api/admin/email-queue/route.ts:65-104`
**Issue:** The route truncates `html` to a 200-char `bodyPreview` to mitigate
T-03-04-01 (verification codes, password-reset URLs, magic links in body).
But:

1. `to` is returned verbatim — that's the recipient email, which is itself PII.
2. `subject` is returned verbatim — many transactional templates encode the
   verification code or one-time secret in the subject line (e.g.
   "Verify your email — Code XXXXXXXX"). The mitigation comment claims
   "verification codes" stay in `html`, but Phase 2 templates reviewed earlier
   commonly put the code in the subject as well.

The threat-model claim "the admin response truncates html to ≤200 chars... and
never returns the full html or text fields" is correct but incomplete — `html`
is not the only PII vector.

**Fix:** Decide explicitly:

(a) Accept that admins can see recipient addresses and subject lines (the
common policy — back-office staff already see emails in user-detail routes).
Document this in the route comment so it isn't a future regression target.

(b) Mask: `to` → `u****@example.com` via a helper; `subject` → either truncate
to 80 chars OR strip alphanumeric runs ≥ 6 chars (rough heuristic for codes).

Recommend (a) with explicit documentation. Add a comment block listing
fields-not-redacted and link to the threat model decision.

Also rename `bodyPreview` → `htmlPreview` since `text` is silently dropped and
the field name suggests it covers both bodies.

---

### WR-03: `enforceAdminRateLimit` fails open when Redis is null

**File:** `frontend/src/lib/server/middleware/rate-limit-by-userid.ts:36-37`
**Issue:** When `redis === null` (no Upstash configured), the limiter returns
`null` (proceed). The docstring documents this as "dev parity," but in production
this is silent disablement of the back-office rate limit — exactly the opposite
of the threat T-03-01-03 mitigation it claims to implement. A misconfigured
production deploy (typo in `UPSTASH_REDIS_REST_URL`, plan downgrade) makes
every admin route unbounded, while everything else (orders, withdrawals)
keeps working — there's no startup-time fail-fast.

**Fix:** Either (a) fail closed in production by reading `NODE_ENV`:

```ts
export async function enforceAdminRateLimit(userId: string): Promise<NextResponse | null> {
  if (!redis) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'INTERNAL_ERROR', message: 'Rate-limit backend unavailable.' },
        { status: 503 },
      );
    }
    return null; // dev / CI fail-open
  }
  // ... rest unchanged
}
```

Or (b) add a CI/boot-time check to `frontend/instrumentation.ts` or a Phase-0
runtime test that asserts Redis is configured when `NODE_ENV === 'production'`,
documented as a deploy-time gate.

Pick (a) — instrumentation already runs `log.warn` for inert providers, but
silent admin-rate-limit absence is too risky to leave to log review.

---

### WR-04: `login` SUSPENDED branch enables enumeration of suspended emails

**File:** `frontend/src/app/api/auth/login/route.ts:147-152`
**Issue:** The flow returns `ACCOUNT_SUSPENDED` only for users who passed
`verifyPassword`. That means an attacker with valid credentials can distinguish
"suspended" from "active" — fine, that's a deliberate disclosure to the legitimate
account holder. But the credential-failure path (line 119-130) and the no-user
path (line 109-115) both return `INVALID_CREDENTIALS` — so for SUSPENDED
accounts, knowing the password reveals "this email exists AND is suspended."
This is acceptable per CLAUDE.md "Signup is enumeration-resistant" (signup, not
login), and login enumeration via correct-password is well-known and accepted.

The real concern is **timing**: `recordSuccess` is skipped for SUSPENDED users
(per the comment "do NOT call recordSuccess for SUSPENDED users — leave the
lockout counter as-is"). But the path still avoids `recordFailure` either, so
the lockout counter for a SUSPENDED account never decays — every legitimate
login attempt by a suspended user pushes them closer to a separate lockout.
Worse: when a SUPERADMIN restores the account, the counter still sits at N
failures from before suspension, so the user gets locked out on first
post-restore attempt.

**Fix:** On the SUSPENDED branch, choose one of:

(a) Call `recordSuccess(email)` to clear the counter (the credential check
already passed; nothing more to deter).

(b) Explicitly call a `clearLockoutCounter(email)` helper.

Add a test that a restored SUSPENDED user with N-1 failed attempts before
suspension can log in cleanly. Update the comment block to explain the
post-restore counter state explicitly.

---

### WR-05: Withdrawal cancel — first `findUnique` outside the lock can leak existence

**File:** `frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts:72-81`
**Issue:** The pattern (read `userId` outside the lock, then `lockUserTx(tx,
userId)` as first tx statement) is correct for serialization, but the outer
`findUnique` runs unauthenticated-against-rate-limit-of-the-resource. Two
practical issues:

1. The 404 `WITHDRAWAL_NOT_FOUND` is emitted before any tx, so an attacker (a
   compromised SUPERADMIN account) can probe withdrawal IDs at the back-office
   rate limit (100/min/userId). Acceptable for SUPERADMIN-only routes per
   D-ADMIN-01, but worth noting.

2. Race: between the outer `findUnique` and the locked re-fetch, the
   withdrawal could be deleted (no DELETE route exists, so this is theoretical
   in v1) or its `userId` could change (impossible — the column is
   non-nullable + immutable in practice). Net: not a real correctness bug
   today, but the pattern is fragile if a future change adds withdrawal
   transfer between users.

**Fix:** Add an inline comment that reads:

```ts
// Phase 1 read (outside lock) is safe today because Withdrawal.userId is
// immutable; if a future migration adds withdrawal transfer between users,
// move the userId fetch inside the lock and lock on the *latest* owner.
```

No code change required for v1. File this as a documented assumption.

---

### WR-06: `process.env.PUBLIC_URL` falls back to `http://localhost:3000` in prod

**File:** `frontend/src/app/api/orders/route.ts:159`
**Issue:** `const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';`
This is the URL used for `successUrl` / `failureUrl` passed to the payment
provider. In production with a forgotten `PUBLIC_URL` env var, the provider
will redirect successful payments to `http://localhost:3000/orders/.../success`
— the user lands on a dead URL after paying. Bictorys (and most providers)
will register the URL in their hosted checkout regardless of validity.

**Fix:** Fail closed in production:

```ts
const publicUrl = process.env.PUBLIC_URL;
if (!publicUrl) {
  // Same disposition as PAYMENT_PROVIDER_UNCONFIGURED — boot-time misconfig
  // surfaced as 503 rather than a silent localhost redirect after a real charge.
  return NextResponse.json(
    { error: 'PAYMENT_PROVIDER_UNCONFIGURED', message: 'PUBLIC_URL not set' },
    { status: 503, headers: { 'x-request-id': ctx.requestId } },
  );
}
```

Or assert `PUBLIC_URL` at boot in `instrumentation.ts` alongside other required
env. The env-fallback is a dev convenience; in prod it's a footgun.

---

## Info

### IN-01: rate-limit-by-userid docstring example uses wrong field name

**File:** `frontend/src/lib/server/middleware/rate-limit-by-userid.ts:13`
**Issue:** Docstring example says `enforceAdminRateLimit(auth.user.sub)` but
every consumer route uses `enforceAdminRateLimit(auth.admin.id)`. Both
resolve to the same string in current code (the ADMIN context shape
duplicates `user.sub === admin.id`), but readers copying the example will
write code that breaks if the AdminContext shape ever splits these fields.
**Fix:** Update the docstring to `auth.admin.id` to match the canonical usage.

---

### IN-02: `make-superadmin.ts` actor logging — bootstrap signs own promotion

**File:** `frontend/scripts/make-superadmin.ts:62-69`
**Issue:** The script uses `actorId: user.id` (the promotee) for the
AdminAction row. The header comment acknowledges this as an accepted threat
("the bootstrap SUPERADMIN signs their own promotion — appropriate for the
bootstrap case (T-03-07-07 — accepted threat: shell access required)").
This is correct for the genuine bootstrap case (no SUPERADMIN exists yet) but
the script also runs against an existing ADMIN (line 92-98 of the test file
covers metadata.previousRole='ADMIN'). In that case there might be an
existing SUPERADMIN whose ID would be a more truthful actor.

**Fix:** No code change. The accepted-threat disposition is reasonable. Add a
shorter inline note: `// actor=self even when promoting an existing ADMIN; CLI
has no auth context, see T-03-07-07.`

---

### IN-03: Admin orders list — `metadata` excluded but `customerName/Phone` not

**File:** `frontend/src/app/api/admin/orders/route.ts:21-35`
**Issue:** The route comment says "Field whitelist excludes `metadata` (often
large; can be added later if admin needs it) but includes the essentials."
The whitelist actually includes `customerEmail` but excludes
`customerName` and `customerPhone`, which back-office staff often need for
contacting customers. `metadata` exclusion is sound (size). The other two are
stylistic — they're consistently nullable, small strings.

**Fix:** No required change. Either document why `customerName/Phone` are
excluded (e.g. "PII-narrow: only email is essential for triage") or add them.
A `// PII-narrow per D-ADMIN-03` comment would close the loop.

---

### IN-04: `admin-fixtures.ts` `mockBictorysProvider.openCircuit` naming is misleading

**File:** `frontend/src/test-utils/admin-fixtures.ts:259-282`
**Issue:** The `openCircuit: true` option makes `charge()` reject — but the
breaker's circuit only opens after N consecutive failures. A test that wants
to exercise the actual `CircuitOpenError` path needs to invoke the failing
charge enough times to trip the breaker, OR mock `breaker.execute` directly to
throw `CircuitOpenError` (as `route.test.ts:252` does). The option name
suggests the latter behavior; it actually does the former.

**Fix:** Rename to `failingCharge: true` and add a comment that the breaker
must be tripped separately if the test needs `CircuitOpenError`. No
behavioral change required.

---

### IN-05: `audit-log/route.ts` — `actor` filter is exact-match on cuid; consider email lookup helper

**File:** `frontend/src/app/api/admin/audit-log/route.ts:51,67`
**Issue:** The filter takes `?actor=admin-7` (the actorId, a cuid). For
incident response, admins typically know the actor's email, not their cuid —
they'll need a separate `GET /api/admin/users?q=…` round-trip to find the
actor before they can filter. The route comment ("`?actor — exact match on
actorId`") matches the implementation, so this is a documented limitation.

**Fix:** Add `?actorEmail=` as an alternate filter that does a single
`prisma.user.findUnique({ where: { email } })` to resolve to actorId, then
applies the same `actorId` filter. Or document this as a Phase-4 enhancement
in 03-VALIDATION.md follow-ups. Not a v1 blocker.

---

_Reviewed: 2026-05-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
