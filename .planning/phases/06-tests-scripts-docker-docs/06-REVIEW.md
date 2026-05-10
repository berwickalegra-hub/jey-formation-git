---
phase: 06-tests-scripts-docker-docs
reviewed: 2026-05-10T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - frontend/src/lib/server/crypto.test.ts
  - frontend/src/lib/server/withdrawals/lock.test.ts
  - frontend/src/lib/server/outbox/dispatcher.test.ts
  - frontend/src/lib/server/oauth/google.test.ts
  - frontend/src/lib/server/notifications/createNotification.test.ts
  - frontend/src/lib/server/admin/audit.test.ts
  - frontend/src/lib/server/payments/circuit-breaker.test.ts
  - frontend/src/lib/server/observability/claude-md-shape.test.ts
  - frontend/src/lib/server/observability/readme-shape.test.ts
  - frontend/scripts/smoke-auth.ts
  - frontend/scripts/seed-dev.ts
  - frontend/scripts/seed-dev.test.ts
  - frontend/package.json
  - package.json
  - CLAUDE.md
  - README.md
  - STATUS.md
  - .planning/ROADMAP.md
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: needs_fix
---

# Phase 6: Code Review Report

**Reviewed:** 2026-05-10
**Depth:** standard
**Files Reviewed:** 18
**Status:** needs_fix (2 warnings, 5 info — no blockers)

## Summary

Phase 6 deliverables are well-scoped and the seven TEST-02 lib tests, two doc tripwires, smoke script, and seed-dev refactor all hit their stated objectives. Each test correctly mocks its dependency surface (no shared mutable state, `mockReset` in `beforeEach`), assertions are intent-bearing rather than smoke, and naming reflects the contract being asserted. No protected files were modified. Doc tripwires currently pass against CLAUDE.md and README.md (negation regexes correctly allow the historical "no separate Express backend" phrasing). The smoke script handles env-guard before fetch, hardcodes no secrets, supports `SMOKE_BASE_URL`, and uses `getSetCookie()` per Node 20.

Two correctness gaps deserve fixing before merge:

1. **`smoke-auth.ts` cleanup leaks the test user when the verification step fails** — the `finally` block deletes by email, but if `prisma.user.findUnique` succeeds and a later step throws, the cleanup proceeds correctly; however, if the very first signup throws BEFORE the user is committed (e.g. server error), no row exists and cleanup is a no-op (correct). The actual leak: `process.env.NODE_ENV` is mutated globally in `seed-dev.test.ts` via `afterEach` restore, which is fine — but `seed-dev.ts` reads `process.env.NODE_ENV` at runtime not at import, so this is actually safe. **Real warning:** the smoke script's `csrfFromCookies` regex `(?:^|;\s*)app-csrf=` will incorrectly match `Set-Cookie: foo-app-csrf=...` because `\s*` allows zero whitespace and the regex anchors only on `;` or string start — but each Set-Cookie header is its own string from `getSetCookie()`, so this is fine. Net: smoke script is correct.

2. **`circuit-breaker.test.ts` test for fresh-cooldown re-open after HALF_OPEN failure** does not advance time before checking state — the implementation may transition synchronously, but the test asserts `state()` immediately after the rejected `execute()`. Confirmed safe given the source's `state()` reads `openedAt` which is reset on probe failure.

The two warnings below are about test-suite robustness and a missing root-level script proxy.

## Warnings

### WR-01: `seed:dev` is not exposed at the root `package.json`

**File:** `package.json:24-26`
**Issue:** Root `package.json` proxies `db:make-superadmin` and `smoke:auth` to the frontend workspace, but does NOT proxy `seed:dev`. CLAUDE.md and README.md both reference `pnpm seed:dev` (and the seed-dev test was added under SCRIPT-01 specifically to make the script callable from CI/dev), but a fresh clone running from repo root will hit `Unknown command: seed:dev`.
**Fix:** Add to root `package.json` scripts:
```json
"seed:dev": "pnpm --filter frontend run seed:dev",
```
This mirrors the existing `db:make-superadmin` and `smoke:auth` proxies and matches the "thin orchestrator" pattern documented in CLAUDE.md.

### WR-02: `seed-dev.ts` `process.exit(1)` inside `main()` defeats the testable-`main` refactor

**File:** `frontend/scripts/seed-dev.ts:36-38`
**Issue:** The SCRIPT-01 refactor goal (per the file's own header comment) is to make `main(args, deps)` testable so tests can inject a mocked Prisma without spawning a subprocess. But the production-refusal branch calls `process.exit(1)` directly, which the companion test only covers by mocking `process.exit` to throw. The CLI guard at the bottom (`if (import.meta.url === \`file://${process.argv[1]}\`)`) already maps a thrown error / non-zero return to `process.exit(1)`. Mixing both paths means:
  (a) callers that import `main` (e.g. a future "seed in test setup" hook) get a side-effecting `process.exit` that they cannot suppress except by spying.
  (b) `make-superadmin.ts` follows the documented pattern correctly: it returns `1` rather than calling `process.exit` from inside `main()` (see `frontend/scripts/make-superadmin.ts:40-44`, which `console.error`s and `return 1`s).

**Fix:** Mirror `make-superadmin.ts` — return `1` from `main()` and let the CLI guard handle `process.exit`. Adjust the test to assert on the resolved return value rather than on the thrown `__exit:1__` sentinel.
```ts
// seed-dev.ts
export async function main(_args: string[] = [], deps: SeedDeps = {}): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run seed-dev in production.');
    return 1;
  }
  // ... existing body ...
  return 0;
}

// CLI guard
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => { console.error(err); process.exit(1); });
}
```
Test update:
```ts
const code = await main([], { prisma: prismaMock });
expect(code).toBe(1);
expect(prismaMock.user.upsert).not.toHaveBeenCalled();
```
This eliminates the `vi.spyOn(process, 'exit').mockImplementation(... throw ...)` workaround and makes the helper safe to call from arbitrary contexts.

## Info

### IN-01: `decodeIdToken` test does not assert defense against `[\.]{2,}` (empty middle segment)

**File:** `frontend/src/lib/server/oauth/google.test.ts:114-118`
**Issue:** The "wrong segment count" assertions cover 1, 2, and 4 segments, but a 3-segment token with an empty middle segment (`a..c`) currently passes `parts.length === 3` and would attempt `JSON.parse('')` → throws `SyntaxError`. The test passes today by accident (the error message is different from `/Malformed ID token/`), so an attacker-supplied empty payload would surface as a generic JSON parse error rather than the lib's intended `Malformed ID token` framing.
**Fix:** Optionally add a coverage row:
```ts
it('rejects a 3-segment token with empty payload', () => {
  expect(() => decodeIdToken('a..c')).toThrow();
});
```
This is informational because the OAuth callback wraps `decodeIdToken` in a try/catch and returns the user to `/auth/error` regardless of error subtype. Not a security gap.

### IN-02: Outbox dispatcher test uses `oe_1` as both the candidate id and the row id without verifying the `findUnique` query

**File:** `frontend/src/lib/server/outbox/dispatcher.test.ts:42, 59, 80, 105`
**Issue:** Each test mocks `findUnique` to resolve `row` regardless of the `where` clause — there is no assertion that `findUnique` is called with `{ where: { id: 'oe_1' } }`. If the source ever drifts to e.g. `findFirst({ where: { id, status: 'PROCESSING' } })`, the mock would still resolve and tests would pass on a now-broken contract.
**Fix:** Add one positive assertion per the success path:
```ts
expect(prismaMock.outboxEvent.findUnique).toHaveBeenCalledWith({ where: { id: 'oe_1' } });
```
Low priority — this is a test-strengthening nit, not a correctness bug.

### IN-03: `circuit-breaker.test.ts` does not cover the `windowMs` rolling-failure expiry

**File:** `frontend/src/lib/server/payments/circuit-breaker.test.ts`
**Issue:** The test suite covers all CLOSED/OPEN/HALF_OPEN transitions and `reset()` / `retryAt()`, but never advances the fake clock past `windowMs` between failures to verify that stale failures fall out of the window (preventing premature trips). Source claims `windowMs` defaults to 30s — a test like "2 failures, 31s pass, 1 more failure → still CLOSED" would lock the contract. Not blocking; the source is on the protected list and currently behaves correctly per inspection.

### IN-04: `smoke-auth.ts` env guard checks `JWT_SECRET` but the script never uses it directly

**File:** `frontend/scripts/smoke-auth.ts:63-68`
**Issue:** The friendly env guard requires `DATABASE_URL` and `JWT_SECRET`, but the script itself only directly uses `DATABASE_URL` (Prisma) and `SMOKE_BASE_URL`. `JWT_SECRET` is required by the *server* the script is hitting, not by the script process. The check is a useful proxy for "did you `cp .env.example .env.local`?", but the framing in the error message implies the script needs it. Either the framing should change or the check should be relaxed. Low priority.
**Fix (optional):** Update the error message to clarify:
```ts
console.error('  Missing DATABASE_URL or JWT_SECRET — these must be set so the dev server you are smoke-testing can boot.');
```

### IN-05: `readme-shape.test.ts` describes its second `describe` block as "post-Wave-2 target shape" but README already satisfies it

**File:** `frontend/src/lib/server/observability/readme-shape.test.ts:69-82`
**Issue:** The block-level comment says these assertions "may FAIL in this worktree before plan 06-03 (README rewrite) merges back" — but the current README (line 19, line 141, line 147) already contains `pnpm smoke:auth` references, so the assertion is GREEN today. The "RED-by-design tripwire" framing is no longer accurate. Not a bug, just a stale comment.
**Fix:** Tighten the comment to reflect that the assertion is now permanent:
```ts
// Post-Wave-2 permanent assertions — `pnpm smoke:auth` must remain in README.
```

---

## Acceptance against the prompt's focus areas

| Focus | Result |
|---|---|
| Test quality (TEST-02 gap-fills) — proper mocking, no shared state, intent-bearing assertions, intent-reflecting names | PASS |
| Smoke script (TEST-03) — safe failure modes, env-guard before fetch, no hardcoded secrets, `SMOKE_BASE_URL` honored, `getSetCookie()` for Node 20 | PASS |
| seed-dev refactor (SCRIPT-01) — `main(args, deps)` signature, CLI guard mirrors make-superadmin, NODE_ENV=production refusal preserved | PARTIAL — see WR-02 (process.exit inside main does not match make-superadmin pattern) |
| Doc tripwires — tolerant assertions, both pass on current docs | PASS (verified: `grep -nE "express\|backend/src\|express\.json\|middleware-order" CLAUDE.md README.md` returns no errant matches) |
| Doc quality (DOC-01, DOC-02) — invariants retained, quickstart runnable, no broken cross-references | PASS |
| No protected files modified | PASS — all changes land in test files, scripts, and docs |

---

_Reviewed: 2026-05-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
