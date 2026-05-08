---
phase: 02-oauth-notifications-withdrawal-pin
reviewed: 2026-05-08T02:29:52Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - frontend/src/app/api/auth/oauth/google/callback/route.test.ts
  - frontend/src/app/api/auth/oauth/google/callback/route.ts
  - frontend/src/app/api/auth/oauth/google/start/route.test.ts
  - frontend/src/app/api/auth/oauth/google/start/route.ts
  - frontend/src/app/api/auth/withdrawal-pin/route.test.ts
  - frontend/src/app/api/auth/withdrawal-pin/route.ts
  - frontend/src/app/api/notifications/count/route.test.ts
  - frontend/src/app/api/notifications/count/route.ts
  - frontend/src/app/api/notifications/prefs/route.test.ts
  - frontend/src/app/api/notifications/prefs/route.ts
  - frontend/src/app/api/notifications/route.test.ts
  - frontend/src/app/api/notifications/route.ts
  - frontend/src/lib/server/auth/pin.test.ts
  - frontend/src/lib/server/auth/pin.ts
  - frontend/src/lib/server/notifications/cursor.test.ts
  - frontend/src/lib/server/notifications/cursor.ts
  - frontend/src/lib/server/notifications/prefs-merge.test.ts
  - frontend/src/lib/server/notifications/prefs-merge.ts
  - frontend/src/lib/server/oauth/error-redirect.test.ts
  - frontend/src/lib/server/oauth/error-redirect.ts
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-08T02:29:52Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Phase 2 ships three feature areas (Google OAuth start/callback, notifications list/count/prefs/mark-read, and withdrawal-PIN set/change/delete) plus four shared helpers (`pin.ts`, `cursor.ts`, `prefs-merge.ts`, `error-redirect.ts`). Overall quality is high: every route exports `runtime = 'nodejs'`, mutating routes call `verifyCsrf(req)`, authenticated routes use the `requireAuth` short-circuit pattern, the OAuth callback refuses `email_verified !== true`, the PIN lockout key is correctly namespaced (`pin:${userId}`), and `createNotification` is used for the welcome notification (NOTIF-05 invariant honored).

Two non-trivial concerns surfaced:

1. A **race-condition correctness bug** in the OAuth callback's link path: the `findUnique({ email })` and `oAuthAccount.create(...)` are not in a transaction, so two concurrent first-time logins by the same Google account on a pre-existing email will issue session cookies for both but only one `OAuthAccount` row will succeed (the other crashes inside the request handler with a P2002 unique violation, surfacing as `OAUTH_GENERIC` to the user — although by then `OAuthAccount.create` has already started). More importantly, the find-or-create as a whole is not atomic: a concurrent request that lands between `findUnique` and `create` can create the user twice (race in the create-by-email branch when no user exists yet).
2. The PIN route does not call `recordFailure` when the change-path body fails Zod validation (i.e. wrong-shape body with no `currentPin`). A cooperative attacker that can pass any value for `newPin` but omits `currentPin` can trigger `alwaysCompareDummy` indefinitely without ever incrementing the lockout counter — denying the lockout's deterrence effect for that particular probing pattern. This is partially mitigated by the global IP/email rate limiter, but the in-route lockout is the second line of defense and currently does not engage.

The remainder are minor (logging completeness, `JSON.stringify` exposure of secrets in `String(err)`, redundant cast, etc.).

## Critical Issues

### CR-01: OAuth callback find-or-create has a TOCTOU race outside any transaction

**File:** `frontend/src/app/api/auth/oauth/google/callback/route.ts:117-169`
**Issue:** The find-or-create sequence runs three separate Prisma calls without an enclosing transaction:

1. `prisma.oAuthAccount.findUnique({ provider_providerAccountId })` (line 119)
2. `prisma.user.findUnique({ email })` (line 129)
3. either `prisma.oAuthAccount.create(...)` (line 136) or `prisma.$transaction(... user.create + oAuthAccount.create ...)` (line 146)

Two failure modes follow from this:

- **Duplicate user creation race (D-02 path):** Two near-simultaneous OAuth callbacks for the same brand-new Google account both observe `existingByProvider === null` and `existingByEmail === null`. Both enter the `$transaction` and call `tx.user.create({ email })`. One commits; the other throws a P2002 unique constraint violation on the `User.email` unique index, bubbling up as an unhandled `Error` and producing a 500 (no `try/catch` in the callback wraps the find-or-create). This is observable in the `route.test.ts` suite — the test mocks all three calls in sequence but never asserts behavior under concurrent invocation.
- **Link path P2002 (D-01 path):** When `existingByEmail` returns a row but a concurrent request has already created the same `OAuthAccount`, `prisma.oAuthAccount.create(...)` throws P2002 on `(provider, providerAccountId)`. Same uncaught-error 500 path.

The login bcrypt path in `auth.ts` (out of this PR's scope) uses bcrypt failures as an oracle and is therefore protected by the existing constraint behaviour, but here the callback redirects to `/auth/error?code=OAUTH_GENERIC` only when the *exchange* fails — Prisma errors after `decodeIdToken` will surface as a 500 to the browser, which is a worse UX than the documented OAUTH_GENERIC contract.

This is also a **silent account-merge correctness regression**: if user A and user B somehow share an email-address claim from Google (impossible in practice but the contract doesn't enforce uniqueness on `claims.email` outside of `email_verified`), the second request would link a different Google `sub` to the first `User.email`. Defence in depth requires that the link insert and the find both run inside a single transaction with the write as the source of truth.

**Fix:** Wrap the entire find-or-create in a single `$transaction` and treat the `oAuthAccount.create` as the authoritative write. Catch P2002 and re-read on the conflict path:

```ts
const { userId, isNewUser } = await prisma.$transaction(async (tx) => {
  const byProvider = await tx.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: 'google', providerAccountId: claims.sub } },
    select: { userId: true },
  });
  if (byProvider) return { userId: byProvider.userId, isNewUser: false };

  const normalizedEmail = claims.email.toLowerCase();
  const byEmail = await tx.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (byEmail) {
    try {
      await tx.oAuthAccount.create({
        data: { userId: byEmail.id, provider: 'google', providerAccountId: claims.sub },
      });
    } catch (e) {
      // P2002 — concurrent request linked first; that's fine.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
    }
    return { userId: byEmail.id, isNewUser: false };
  }

  // Create-path. Catch P2002 on User.email (concurrent create) and re-read.
  try {
    const u = await tx.user.create({
      data: {
        email: normalizedEmail,
        emailVerifiedAt: new Date(),
        name: claims.name ?? null,
        avatarUrl: claims.picture ?? null,
        passwordHash: null,
      },
      select: { id: true },
    });
    await tx.oAuthAccount.create({
      data: { userId: u.id, provider: 'google', providerAccountId: claims.sub },
    });
    return { userId: u.id, isNewUser: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const lost = await tx.user.findUniqueOrThrow({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      try {
        await tx.oAuthAccount.create({
          data: { userId: lost.id, provider: 'google', providerAccountId: claims.sub },
        });
      } catch (inner) {
        if (
          !(inner instanceof Prisma.PrismaClientKnownRequestError) ||
          inner.code !== 'P2002'
        ) {
          throw inner;
        }
      }
      return { userId: lost.id, isNewUser: false };
    }
    throw e;
  }
}, { isolationLevel: 'Serializable' });
```

Add an outer `try/catch` so unexpected errors fall back to `redirectToAuthError('OAUTH_GENERIC', redirectOpts)` instead of bubbling into a 500.

## Warnings

### WR-01: Failed Zod validation on the change-PIN path skips `recordFailure`

**File:** `frontend/src/app/api/auth/withdrawal-pin/route.ts:79-94`
**Issue:** When the change-PIN path is reached (existing `withdrawalPinHash` present) but `ChangeBody.safeParse(body)` fails (e.g. caller omitted `currentPin`), the code calls `alwaysCompareDummy(probe)` for timing parity and returns `400 PIN_REQUIRED`. It does **not** call `recordFailure(key)`. An attacker scripting `{ newPin: '1234' }` (omitting `currentPin`) repeatedly will hit the timing-equalised 400 response indefinitely without ever tripping the `pin:${userId}` lockout. The global per-IP / per-email rate limiters still apply, but the lockout's purpose is to add an authenticated-context counter the attacker can't trivially evade by rotating IPs.

The flow's tests at lines 163-178 explicitly assert `recordFailure` is NOT called on this path, which suggests it was a conscious choice — but the security tradeoff is wrong. PIN_REQUIRED is functionally a wrong-attempt for the change-PIN intent, and an attacker can consume timing oracles + bcrypt CPU at full speed.

**Fix:** Call `recordFailure(key)` on the wrong-shape branch and respect the `locked` return:

```ts
const parsed = ChangeBody.safeParse(body);
if (!parsed.success) {
  const probe = /* …existing probe selection… */;
  await alwaysCompareDummy(probe);
  const r = await recordFailure(key);
  if (r.locked) {
    return NextResponse.json(
      { error: 'LOCKED_OUT', message: 'Account temporarily locked.' },
      { status: 423, headers: { 'x-request-id': ctx.requestId } },
    );
  }
  return NextResponse.json(
    { error: 'PIN_REQUIRED', message: 'currentPin is required to change PIN.' },
    { status: 400, headers: { 'x-request-id': ctx.requestId } },
  );
}
```

Update `route.test.ts:163-178` to assert `recordFailure` IS called on this path, and add a test for the lockout-on-shape-failure case.

### WR-02: `log.error('oauth.callback: unexpected error', { err: String(err) })` may leak secrets in stringified errors

**File:** `frontend/src/app/api/auth/oauth/google/callback/route.ts:102`
**Issue:** `String(err)` on an arbitrary thrown value can serialise objects whose `toString()` includes the full request body, headers, or token material — particularly common with `fetch`-derived errors that embed the entire `Response` body or stringified HTTP request. If `arctic.validateAuthorizationCode` ever throws an error that wraps Google's response containing the authorization code, refresh token, or ID token, that secret would land in the log stream.

The codebase has the convention of logging `err.code` / `err.description` for `OAuth2RequestError` (lines 96-99), which is the right pattern. The fall-through generic case should use the same redacted style.

**Fix:** Restrict the logged shape to `name` and a short `message` (or use the project's existing `log.error(msg, err)` pattern if the logger does its own redaction):

```ts
log.error('oauth.callback: unexpected error', {
  errName: err instanceof Error ? err.name : 'Unknown',
  errMessage: err instanceof Error ? err.message.slice(0, 200) : 'non-Error throw',
});
```

Verify against the project's `logger.ts` redaction allow-list before merging.

### WR-03: PATCH /notifications/prefs reads-then-writes without optimistic locking — silent write-loss

**File:** `frontend/src/app/api/notifications/prefs/route.ts:68-85`
**Issue:** The handler does a `findUnique` then an `upsert` against the same row without any version field or transactional fence. Two concurrent PATCHes that toggle disjoint keys (e.g. `{ ORDER_PAID: { email: false } }` and `{ WELCOME: { inApp: false } }`) will both load the same `existing`, both compute `merged`, and the second commit overwrites the first — losing one user's edit. The route's leading comment acknowledges this ("last-write-wins is the documented semantic, Pitfall 9 — not worth Serializable cost"), but a single-key patch silently dropping is a UX bug, not a documented tradeoff.

This is a tradeoff call rather than a defect; the comment should explicitly say "patches are not concurrency-safe; if two devices edit different events at the same time, one will win" instead of citing the abstract Pitfall 9.

**Fix (recommended):** Push the merge into a single SQL statement so the read-modify-write is atomic:

```ts
await prisma.$transaction(async (tx) => {
  const row = await tx.notificationPreferences.findUnique({
    where: { userId: auth.user.sub },
    select: { prefs: true },
  });
  const existing = readPrefs(row?.prefs);
  const merged = mergePrefs(existing, parsed.data.prefs as NotificationPrefs);
  await tx.notificationPreferences.upsert({
    where: { userId: auth.user.sub },
    create: { userId: auth.user.sub, prefs: merged as unknown as Prisma.InputJsonValue },
    update: { prefs: merged as unknown as Prisma.InputJsonValue },
  });
  return merged;
}, { isolationLevel: 'Serializable' });
```

Or accept the existing semantics but expand the comment so the next reader doesn't have to chase `Pitfall 9` to understand the failure mode.

### WR-04: `decodeIdToken` is called without a try/catch — malformed ID token crashes the handler

**File:** `frontend/src/app/api/auth/oauth/google/callback/route.ts:107-108`
**Issue:** `tokens.idToken()` and `decodeIdToken(idToken)` both run unguarded after `validateAuthorizationCode` succeeds. If Google returns a malformed JWT (vendor-side outage / response truncation / malicious upstream), `decodeIdToken` will throw and the error propagates as a 500 instead of redirecting to `OAUTH_GENERIC`. The earlier `try/catch` block (lines 89-104) only wraps the code-exchange call.

**Fix:** Extend the existing try/catch (or add a new one) to cover the decode step:

```ts
let claims: GoogleIdTokenClaims;
try {
  const idToken = tokens.idToken();
  claims = decodeIdToken(idToken);
} catch (err) {
  await clearEphemeralCookies();
  log.error('oauth.callback: id-token decode failed', {
    errName: err instanceof Error ? err.name : 'Unknown',
  });
  return redirectToAuthError('OAUTH_GENERIC', redirectOpts);
}
```

## Info

### IN-01: `serialize()` types `data: unknown` — Prisma's `JsonValue` is more precise

**File:** `frontend/src/app/api/notifications/route.ts:36, 42`
**Issue:** `SerializedNotification.data: unknown` and the `serialize()` body return `n.data` as `unknown`. Since `Notification.data` is `Prisma.JsonValue` already, using the precise type would carry through to the client TS definitions if the project ever auto-generates them.

**Fix:** Replace `data: unknown` with `data: Prisma.JsonValue`. Non-blocking.

### IN-02: `redirectToAuthError` falls back to `'http://localhost'` when APP_URL is unset

**File:** `frontend/src/lib/server/oauth/error-redirect.ts:53`
**Issue:** The fallback `'http://localhost'` is fine in test/dev but means a misconfigured prod env would silently 302 the user to `http://localhost/auth/error?code=...` and look broken without an obvious server-side error. The leading comment claims env validation enforces `APP_URL` in prod — confirm that with the project's env validator.

**Fix:** Either throw / `log.error` when APP_URL is unset in production, or assert this is a no-op because env validation already fails the boot. No change needed if validation already covers it.

### IN-03: PIN route's `body` casts via `as Record<string, unknown>` rather than narrowing

**File:** `frontend/src/app/api/auth/withdrawal-pin/route.ts:60`
**Issue:** `(await req.json().catch(() => null)) as Record<string, unknown> | null` is a wide cast. Subsequent `body?.['currentPin']` accesses are typed as `unknown` and require `typeof === 'string'` checks (which the code does correctly). This works but a small Zod helper would centralise the parsing.

**Fix:** Optional cleanup — parse `body` once with a permissive schema (`z.object({ currentPin: z.string().optional(), newPin: z.string().optional() }).passthrough()`) before branching, then re-parse the strict shape on the active branch. Non-blocking.

### IN-04: `prefs-merge.ts` `mergePrefs` shallow-copies inner ChannelPrefs — fine, but worth noting

**File:** `frontend/src/lib/server/notifications/prefs-merge.ts:42-48`
**Issue:** `out[k] = { ...v };` shallow-copies channel prefs (correct because `ChannelPrefs` only has primitive fields). If `ChannelPrefs` is ever extended with a nested object (e.g. `quiet_hours: { from, to }`), the merge will silently share reference. Add a comment or, defensively, a structural-clone pass.

**Fix:** Add a comment block above `mergePrefs`:

```ts
// Shallow per-channel merge is sufficient because ChannelPrefs is currently
// primitive-only. Adding nested object fields requires updating this helper
// to deep-clone the inner channels — see test "input arguments are NOT mutated".
```

---

_Reviewed: 2026-05-08T02:29:52Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
