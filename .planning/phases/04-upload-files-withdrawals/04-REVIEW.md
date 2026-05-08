---
phase: 04-upload-files-withdrawals
reviewed: 2026-05-08T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - frontend/src/app/api/upload/route.ts
  - frontend/src/app/api/files/[...key]/route.ts
  - frontend/src/app/api/withdrawals/route.ts
  - frontend/src/lib/server/upload/r2-client.ts
  - frontend/src/test-utils/r2-mock.ts
  - frontend/src/test-utils/admin-fixtures.ts
  - frontend/src/app/api/upload/route.test.ts
  - frontend/src/app/api/files/[...key]/route.test.ts
  - frontend/src/app/api/withdrawals/route.test.ts
  - frontend/src/lib/server/observability/env-shape.test.ts
  - .env.example
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-08
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 4 ships the upload, file-stream, and withdrawal routes plus an R2
lazy-init client and shared test fixtures. Overall quality is high:

- All three Route Handlers correctly export `runtime = 'nodejs'`.
- Mutating routes (`POST /api/upload`, `POST /api/withdrawals`) call
  `verifyCsrf(req)` BEFORE any auth/db work, then `requireAuth()`.
- `POST /api/withdrawals` follows the CF-12 pattern verbatim:
  Serializable isolation, `lockUserTx` is the FIRST awaited statement
  inside the tx, balance check + guard validation + PENDING reservation
  all under the same lock. P2034 surfaces as `409 TRANSIENT_CONFLICT`.
- Magic-byte gating in `/api/upload` runs AFTER size + MIME gates but
  BEFORE storage write (UP-01 ordering D-UP-04 honored).
- File proxy collapses owner-mismatch and missing-row to identical 404
  payloads (D-FILE-03 enumeration defense).
- Stable error codes match the CLAUDE.md contract — frontend `api()`
  switches on `ApiError.code`, not message.
- Note on review scope: `.env.example` lives at repo root, not under
  `frontend/`; the workflow's `files:` listing of `frontend/.env.example`
  is a path mismatch but the actual reviewed file is the correct one
  asserted by `env-shape.test.ts`.

No critical issues. Three warnings worth addressing before phase signoff,
plus five info items.

## Warnings

### WR-01: `(file as never)` cast in withdrawals route — request type laundering through tests

**File:** `frontend/src/app/api/withdrawals/route.test.ts:170, 198, 252, 264, 277, 293, 337, 367, 376` (and similar in upload/files tests)
**Issue:** Tests construct `new Request(...)` (the global Fetch `Request`)
and then call `await POST(req as never)`. The route signature declares
`NextRequest`, not `Request`. The `as never` cast silences TypeScript
entirely — if the route ever starts using a `NextRequest`-only API
(e.g., `req.nextUrl`, `req.cookies`, `ip`), the unit tests will pass
while production crashes.

The GET-side tests already had to switch to `new NextRequest(...)`
exactly because the route reads `req.nextUrl.searchParams`
(see `makeGetReq` on line 142). The POST path is one `req.cookies` call
away from the same trap.

**Fix:** Replace `as never` with a real `NextRequest` constructor —
already imported at the top of `withdrawals/route.test.ts`:

```ts
function makePostReq(body: Partial<PostBody>) {
  return new NextRequest('http://localhost/api/withdrawals', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': 'test-csrf',
    },
    body: JSON.stringify(body),
  });
}
// ...
await POST(makePostReq(validBody)); // no `as never` needed
```

Apply the same change to `upload/route.test.ts` and `files/[...key]/route.test.ts`
where `Request` + `as never` is used. This restores compile-time coverage of the
`NextRequest` contract.

### WR-02: `.env.example` defines `WITHDRAWAL_*` twice — last-wins is fragile

**File:** `.env.example:83-88` (Phase 3 block) vs `.env.example:203-217` (Phase 4 block)
**Issue:** Both blocks declare `WITHDRAWAL_MIN_AMOUNT`,
`WITHDRAWAL_REQUIRE_PIN`, and `WITHDRAWAL_BALANCE_CHECK` with **different**
values:

```
Phase 3 block (line 83): WITHDRAWAL_MIN_AMOUNT="1"
Phase 3 block (line 87): WITHDRAWAL_REQUIRE_PIN="0"
Phase 3 block (line 88): WITHDRAWAL_BALANCE_CHECK="1"
Phase 4 block (line 203): WITHDRAWAL_MIN_AMOUNT="1000"
Phase 4 block (line 207): WITHDRAWAL_REQUIRE_PIN="1"
Phase 4 block (line 217): WITHDRAWAL_BALANCE_CHECK="1"
```

The comment at line 199–202 acknowledges this and relies on
"whichever block appears LATER … wins on `dotenv` load." That assumption
is correct for **dotenv** but **NOT** for every loader — Vite/Next.js
read `.env` files via `process.env` overrides where ordering depends
on which file (`.env.local` vs `.env`) is loaded, not which line wins.
Anyone copying `.env.example` to `.env` and then `grep`'ing it to set
values will see the **first** match (line 83 = "1") and be silently
mis-configured to a 1-XOF minimum on a real-money project.

A copy-paste error in either block is invisible to the test in
`env-shape.test.ts` because the test only checks for **substring
presence** of the Phase 4 lines — it does not check for the absence
of conflicting Phase 3 lines.

**Fix:** Remove the duplicate keys from the Phase 3 block (lines 83, 87, 88)
since Phase 4 supersedes them, OR add an explicit
`# DO NOT EDIT — superseded by Phase 4 block below` comment AND a
test assertion in `env-shape.test.ts` that the string
`WITHDRAWAL_MIN_AMOUNT="1"` (the conflicting Phase 3 value) does not
appear:

```ts
it('does not redeclare WITHDRAWAL_MIN_AMOUNT with the permissive Phase 3 value', () => {
  expect(src).not.toMatch(/^WITHDRAWAL_MIN_AMOUNT="1"$/m);
});
```

### WR-03: Withdrawals POST notification swallows ALL errors silently — no `log.error`

**File:** `frontend/src/app/api/withdrawals/route.ts:188-205`
**Issue:** The post-commit `createNotification` call is correctly
wrapped in try/catch so a notification failure cannot poison a
committed withdrawal. However, the catch block is empty:

```ts
} catch {
  // Swallow — `createNotification` already returns null on P2002 dedup
  // hits; a thrown error here is some other DB hiccup. The withdrawal
  // commit is preserved.
}
```

A real DB hiccup (network blip, Neon failover, schema drift) here means
the user gets a 201 but never a notification — and there's no signal in
the logs to tell ops why. Per CLAUDE.md the request-context logger
attaches `requestId` automatically, so a single `log.warn` line is
cheap and gives operators a thread to pull on:

**Fix:**

```ts
import { log } from '@/lib/server/observability/request-context';
// ...
} catch (err) {
  log.warn('withdrawal-notification-dispatch-failed', {
    withdrawalId: result.withdrawal.id,
    error: err instanceof Error ? err.message : String(err),
  });
}
```

This preserves the "do not poison the response" invariant while making
the failure observable. (Same pattern is documented as the standard in
the upload route's storage-write fallback above.)

## Info

### IN-01: `.env.example` example values still use `change-me`-style placeholders

**File:** `.env.example:9, 14`
**Issue:** `DATABASE_URL` and `DIRECT_URL` placeholders use
`postgresql://user:pass@…`. CLAUDE.md mentions JWT_SECRET rejects
`change-me`, `secret`, `test` — there's no equivalent for connection
strings, but `user:pass` placeholders are the kind of thing a tired
dev on a Friday will accidentally leave in a real `.env`.
**Fix:** Optional — replace with `<USER>:<PASSWORD>` (angle brackets are
unambiguous as "must be replaced"). Low priority — current value is
clearly a placeholder.

### IN-02: `r2-client.ts` lazy init has a subtle race on first concurrent request

**File:** `frontend/src/lib/server/upload/r2-client.ts:61-85`
**Issue:** `getR2Client()` does a check-then-build sequence on
`_client` without any locking. Under Next.js, two concurrent requests
can both see `_client === null` and both run `new S3Client(...)`. The
last writer wins; the loser's client is GC'd. The S3 SDK doesn't hold
external resources at construction time (no socket pool open), so this
is harmless in practice — but worth a note for future maintainers.
**Fix:** No code change required. If a future provider's client opens
sockets at `new`-time, switch to a Promise cache:
`let _clientP: Promise<S3Client> | null = null;`. Document the current
"benign double-init" property in the file header.

### IN-03: `verifyMagicBytes` returns `{ match: true, sniffed: false }` for unsniffed MIMEs — silent trust

**File:** `frontend/src/lib/server/upload/sniff.ts:69-71` (called from `route.ts:100-108`)
**Issue:** When an operator adds a MIME to `UPLOAD_ALLOWED_MIME` that
sniff.ts doesn't know how to verify (e.g., `image/svg+xml`,
`application/pdf` is sniffed but `text/csv` isn't), the route accepts
the bytes without any byte-level check. The route comment correctly
acknowledges this ("sniffed=false → operator allowed a MIME we don't
sniff"), and sniff.ts logs a boot warning — but the warning lives in a
location the upload-route reader doesn't see.
**Fix:** No security regression (operator opted in by configuring the
MIME). Optional: add a one-line comment in `route.ts` near the
`!match` branch pointing to `sniff.ts`'s SNIFFERS table so a future
maintainer adding a new allowed MIME knows where to add the sniffer.

### IN-04: Withdrawals POST narrow on `err.code === 'P2034'` uses dynamic-property guard, not Prisma type

**File:** `frontend/src/app/api/withdrawals/route.ts:217-227`
**Issue:** The catch narrows `err` via
`'code' in err && (err as { code: unknown }).code === 'P2034'`. This
works but bypasses Prisma's typed
`Prisma.PrismaClientKnownRequestError` class. Using `instanceof` would
be safer (catches the class identity) and unlocks `err.meta` for
diagnostic logging:

```ts
import { Prisma } from '@prisma/client';
// ...
if (
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2034'
) { ... }
```

`Prisma` is already imported on line 43. Low priority — the current
form is functionally correct.
**Fix:** Refactor to `instanceof Prisma.PrismaClientKnownRequestError`
when next touching this code.

### IN-05: `admin-fixtures.ts` `seedActiveUserWithPin` cost-4 hash — comment overstates the safety boundary

**File:** `frontend/src/test-utils/admin-fixtures.ts:303-321`
**Issue:** Comment says "this helper is adjacent to
`import 'server-only'` modules and never imported by production
routes — the risk of a cheap-cost hash escaping is bounded." There is
no actual `import 'server-only'` in this file, and `test-utils/` is
not under `server-only` enforcement. The boundary is "tests don't ship
to production" via `vitest.config` includes — which is the correct
guarantee, just not the one the comment cites.
**Fix:** Replace comment with: "test-utils/ is excluded from the
production build via tsconfig + vitest config — this helper never
ships to production, so cost-4 hashing is bounded to the test
process."

---

_Reviewed: 2026-05-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
