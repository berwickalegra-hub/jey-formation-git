---
id: 06-01-tests-scripts-and-docker-uat
phase: "06"
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
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
autonomous: false
task_count: 5
requirements:
  - TEST-01
  - TEST-02
  - TEST-03
  - SCRIPT-01
  - DOCKER-01
  - ENV-01
must_haves:
  truths:
    - "All 7 named PROTECTED libs gain a direct companion *.test.ts file under frontend/src/lib/server/** that runs GREEN under `pnpm test` (TEST-02)"
    - "frontend/scripts/smoke-auth.ts exits 0 against a running pnpm dev (signup → DB peek → verify-email → me → logout) when DATABASE_URL + JWT_SECRET are present (TEST-03)"
    - "pnpm smoke:auth and root-proxy `pnpm smoke:auth` both invoke tsx --env-file=.env.local frontend/scripts/smoke-auth.ts"
    - "frontend/scripts/seed-dev.ts exports main(args, deps) AND retains a CLI guard mirroring make-superadmin.ts:85-92 (SCRIPT-01)"
    - "frontend/scripts/seed-dev.test.ts uses mockDeep<PrismaClient>() and asserts: NODE_ENV=production exit 1; upsert(idempotent); bcrypt password-hash prefix"
    - "claude-md-shape.test.ts and readme-shape.test.ts assert no errant Express/backend/src/express.json refs in the doc and that quickstart commands grep-match (DOC tripwires lock the audit as a CI guard)"
    - "Docker UAT recipe (manual; recorded in SUMMARY) verifies: `docker build -f frontend/Dockerfile -t amadou-monolith .` succeeds; `docker run` of the image responds 200 on /api/health (DOCKER-01)"
    - "TEST-01 cross-reference: vitest.config.ts:setupFiles + vitest.setup.ts JWT_SECRET/ENCRYPTION_KEY confirmed unmodified (already shipped Phase 1 D-27)"
    - "ENV-01 cross-reference: grep '^CRON_SECRET=' frontend/.env.example returns 1 (already shipped Phase 0 OPS-04)"
  artifacts:
    - path: "frontend/src/lib/server/crypto.test.ts"
      provides: "Round-trip encrypt/decrypt + reject malformed payload + reject wrong key"
      min_lines: 25
    - path: "frontend/src/lib/server/withdrawals/lock.test.ts"
      provides: "withUserAdvisoryLock issues pg_advisory_xact_lock(hashtext($1)) before fn"
      min_lines: 30
    - path: "frontend/src/lib/server/outbox/dispatcher.test.ts"
      provides: "Atomic claim PENDING→PROCESSING + exponential backoff + max-5 attempts → DEAD + stuck-PROCESSING reset >90s"
      min_lines: 50
    - path: "frontend/src/lib/server/oauth/google.test.ts"
      provides: "isConfigured() guard + decodeIdToken extracts email/email_verified/sub + refuses email_verified !== true"
      min_lines: 35
    - path: "frontend/src/lib/server/notifications/createNotification.test.ts"
      provides: "P2002 caught → returns null silently; valid input creates row"
      min_lines: 25
    - path: "frontend/src/lib/server/admin/audit.test.ts"
      provides: "logAdminAction writes AdminAction row with all required fields; accepts tx client shape"
      min_lines: 25
    - path: "frontend/src/lib/server/payments/circuit-breaker.test.ts"
      provides: "State machine: CLOSED → OPEN after N failures; OPEN refuses; HALF_OPEN after cooldown; success closes"
      min_lines: 45
    - path: "frontend/src/lib/server/observability/claude-md-shape.test.ts"
      provides: "Doc tripwire — reads CLAUDE.md, regex-asserts no errant Express/backend/src refs"
      min_lines: 25
    - path: "frontend/src/lib/server/observability/readme-shape.test.ts"
      provides: "Doc tripwire — reads README.md, regex-asserts quickstart command + route inventory section"
      min_lines: 25
    - path: "frontend/scripts/smoke-auth.ts"
      provides: "Pure-fetch smoke test against http://localhost:3000 — signup → DB-peek → verify-email → me → logout; exit 0/1"
      min_lines: 80
    - path: "frontend/scripts/seed-dev.ts"
      provides: "Refactored to export main(args, deps); CLI guard at bottom mirroring make-superadmin.ts:85-92"
      min_lines: 50
    - path: "frontend/scripts/seed-dev.test.ts"
      provides: "Vitest unit test mocking PrismaClient deep + bcrypt assertions"
      min_lines: 50
  key_links:
    - from: "frontend/scripts/smoke-auth.ts"
      to: "frontend/src/app/api/auth/{signup,verify-email,me,logout}/route.ts"
      via: "fetch sequence with cookie jar + DB peek of VerificationCode by (userId, type=EMAIL_VERIFY)"
      pattern: "VerificationCode"
    - from: "frontend/scripts/seed-dev.test.ts"
      to: "frontend/scripts/seed-dev.ts"
      via: "import { main } from './seed-dev' — REFACTOR REQUIRED to make seed-dev importable without DB connection at module load"
      pattern: "import \\{ main \\} from"
    - from: "frontend/package.json"
      to: "frontend/scripts/smoke-auth.ts"
      via: "scripts.smoke:auth = 'tsx --env-file=.env.local scripts/smoke-auth.ts'"
      pattern: "smoke:auth"
    - from: "package.json (repo root)"
      to: "frontend/package.json"
      via: "scripts.smoke:auth = 'pnpm --filter frontend run smoke:auth' — orchestrator proxy"
      pattern: "smoke:auth.*--filter frontend"
    - from: "frontend/src/lib/server/observability/claude-md-shape.test.ts"
      to: "CLAUDE.md (repo root)"
      via: "fs.readFileSync(path.resolve(__dirname, '../../../../../CLAUDE.md'), 'utf8') + regex assertions"
      pattern: "CLAUDE.md"
    - from: "frontend/src/lib/server/observability/readme-shape.test.ts"
      to: "README.md (repo root)"
      via: "fs.readFileSync(path.resolve(__dirname, '../../../../../README.md'), 'utf8') + regex assertions"
      pattern: "README.md"
---

<objective>
Wave 0 work for Phase 6 — ship the 7 TEST-02 gap-fill unit tests, the 2 doc-tripwire tests (DOC-01/DOC-02 lock-in), the smoke-auth.ts script (TEST-03), refactor seed-dev.ts so it is importable + add seed-dev.test.ts (SCRIPT-01), wire `pnpm smoke:auth` in both frontend and root package.json, and verify the Docker build end-to-end (DOCKER-01 manual UAT — recipe documented in SUMMARY).

Purpose: Phases 0–5 already shipped TEST-01 (vitest config) and ENV-01 (CRON_SECRET in .env.example), and the smoke-test/auditing/Docker work is the remaining v1 gate before Phase 7's quality pass. This single multi-task plan absorbs all the test-shaped work in one coherent worktree because every task touches `frontend/` (sequential merge-back; no Wave 1 file conflicts).

Output: 14 files modified — 7 new lib unit tests, 2 new doc tripwires, smoke-auth.ts, seed-dev.test.ts, refactored seed-dev.ts, and 2 package.json edits. Plus a recorded Docker UAT result in the plan SUMMARY (no new Docker file).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/06-tests-scripts-docker-docs/06-CONTEXT.md
@.planning/phases/06-tests-scripts-docker-docs/06-RESEARCH.md
@.planning/phases/06-tests-scripts-docker-docs/06-VALIDATION.md
@CLAUDE.md

@frontend/vitest.config.ts
@frontend/vitest.setup.ts
@frontend/package.json
@package.json
@frontend/scripts/make-superadmin.ts
@frontend/scripts/make-superadmin.test.ts
@frontend/scripts/seed-dev.ts
@frontend/Dockerfile
@docker-compose.yml
@frontend/.env.example

@frontend/src/lib/server/crypto.ts
@frontend/src/lib/server/withdrawals/lock.ts
@frontend/src/lib/server/outbox/dispatcher.ts
@frontend/src/lib/server/oauth/google.ts
@frontend/src/lib/server/notifications/index.ts
@frontend/src/lib/server/admin/audit.ts
@frontend/src/lib/server/payments/circuit-breaker.ts

@frontend/src/lib/server/observability/runtime-enforcement.test.ts
@frontend/src/lib/server/observability/vercel-json-shape.test.ts
@frontend/src/lib/server/observability/env-shape.test.ts
@frontend/src/app/api/auth/verify-email/route.ts

<reference_patterns>
- **Vitest config + setup:** `frontend/vitest.config.ts` (already includes `scripts/**/*.test.ts`); `frontend/vitest.setup.ts` (seeds JWT_SECRET + ENCRYPTION_KEY) — DO NOT MODIFY. TEST-01 satisfied.
- **Mock-extended Prisma:** `frontend/scripts/make-superadmin.test.ts` — model audit/createNotification/dispatcher/seed-dev tests after this (`mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>` + `mockReset` in `beforeEach`).
- **Doc tripwire pattern:** `frontend/src/lib/server/observability/runtime-enforcement.test.ts` (fast-glob walk + regex-tolerant) and `vercel-json-shape.test.ts` (read JSON + assert shape) — both use `import.meta.url + fileURLToPath` for portable path resolution.
- **CLI guard for tsx scripts:** `frontend/scripts/make-superadmin.ts:85-92` (the `if (import.meta.url === \`file://${process.argv[1]}\`)` block + relative `../src/lib/server/admin/audit` import — Pitfall 1 in RESEARCH).
- **NextResponse vs Response in tests:** Phase 4/5 lesson — when mocking auth gates that return 401, return `NextResponse.json(...)`, NOT plain `new Response()` (subtle header differences break `req.cookies` propagation). NOT directly relevant here (these tests mock libs, not routes), but reference for the smoke script's `Response.headers.getSetCookie()` (Node 20+).
- **getSetCookie() requires Node 20+:** Pitfall 5 in RESEARCH — `engines.node >=20` already enforced in package.json. The smoke script's header comment must say "requires Node 20+".
- **No new Vitest test for smoke-auth.ts:** Pitfall 3 — `frontend/scripts/smoke-auth.test.ts` would be auto-discovered by Vitest and fail in CI (no live server). The script is the test. Document in script header.
</reference_patterns>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Ship 7 TEST-02 gap-fill unit tests for PROTECTED libs</name>
  <files>
    - frontend/src/lib/server/crypto.test.ts (NEW)
    - frontend/src/lib/server/withdrawals/lock.test.ts (NEW)
    - frontend/src/lib/server/outbox/dispatcher.test.ts (NEW)
    - frontend/src/lib/server/oauth/google.test.ts (NEW)
    - frontend/src/lib/server/notifications/createNotification.test.ts (NEW)
    - frontend/src/lib/server/admin/audit.test.ts (NEW)
    - frontend/src/lib/server/payments/circuit-breaker.test.ts (NEW)
  </files>
  <read_first>
    - frontend/src/lib/server/crypto.ts (full file — ~1683 bytes; understand exported `encrypt`/`decrypt` signatures)
    - frontend/src/lib/server/withdrawals/lock.ts (~1878 bytes; understand exported function name + tx parameter shape)
    - frontend/src/lib/server/outbox/dispatcher.ts (~6376 bytes; understand `drainOutbox` signature, `OutboxEvent` status transitions, the 90s stuck-PROCESSING reset)
    - frontend/src/lib/server/oauth/google.ts (~2841 bytes; understand `isConfigured()` + `decodeIdToken` exports + the email_verified refusal path)
    - frontend/src/lib/server/notifications/index.ts (~1778 bytes; understand `createNotification(prisma, input)` + the P2002 catch-and-return-null contract)
    - frontend/src/lib/server/admin/audit.ts (~1336 bytes; understand `logAdminAction(prisma | tx, payload)` signature)
    - frontend/src/lib/server/payments/circuit-breaker.ts (~4784 bytes; understand state machine: CLOSED → OPEN at threshold; HALF_OPEN cooldown; success-resets)
    - frontend/scripts/make-superadmin.test.ts (mockDeep<PrismaClient>() pattern reference)
    - .planning/phases/06-tests-scripts-docker-docs/06-RESEARCH.md §"TEST-02 Coverage Audit" + §"Code Examples" (test skeletons for lock + audit)
  </read_first>
  <behavior>
    **crypto.test.ts** (~30 LOC, 3 cases):
    - `it('round-trips encrypt/decrypt for a known plaintext')` — `decrypt(encrypt('hello'))` returns `'hello'`
    - `it('rejects malformed ciphertext (not base64 or wrong shape)')` — `decrypt('not-a-valid-payload')` throws
    - `it('rejects ciphertext when ENCRYPTION_KEY is wrong')` — re-stub `process.env.ENCRYPTION_KEY` to a different 32-byte value, decrypt should throw

    **withdrawals/lock.test.ts** (~40 LOC, 2 cases):
    - `it('issues pg_advisory_xact_lock with hashtext(userId) before running fn')` — spy on `tx.$executeRaw` (or `$executeRawUnsafe` per actual impl); first call must contain `pg_advisory_xact_lock` AND `hashtext`; fn runs after
    - `it('uses Serializable isolation level via tx config')` — verified by Wave 1 reader (RESEARCH says lock.ts wraps in `prisma.$transaction(fn, { isolationLevel: 'Serializable' })` — assert by inspecting the second `.transaction` arg if exposed; otherwise document as covered by route-level integration via withdrawals/route.test.ts)

    **outbox/dispatcher.test.ts** (~60 LOC, 4 cases):
    - `it('claims a PENDING row, marks it PROCESSING, runs handler, marks SENT')` — mockDeep<PrismaClient>; `prisma.outboxEvent.findFirst` returns one row; `prisma.outboxEvent.update` called with `{ status: 'PROCESSING' }` then `{ status: 'SENT' }`
    - `it('exponential backoff bumps nextAttemptAt on failure (attempts < 5)')` — handler throws; assert `update` called with `{ status: 'PENDING', attempts: prev+1, scheduledAt: <future> }`
    - `it('marks DEAD after attempts >= 5 instead of re-queueing')` — handler throws on attempts=5; update called with `{ status: 'DEAD' }`
    - `it('resets stale PROCESSING rows older than 90s back to PENDING with attempts++')` — RESEARCH says dispatcher increments attempts even on the reset-from-PROCESSING path (Pitfall 4)

    **oauth/google.test.ts** (~40 LOC, 3 cases):
    - `it('isConfigured() returns false without GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI')` — vi.stubEnv each var to undefined, expect false; stub all three to non-empty strings, expect true
    - `it('decodeIdToken extracts email/email_verified/sub from a well-formed JWT-shaped token')` — provide a manually-constructed `header.payload.sig` string (no real verification), assert returned shape
    - `it('refuses tokens with email_verified !== true')` — code path or wrapper that throws/returns sentinel — assert per actual export shape

    **notifications/createNotification.test.ts** (~30 LOC, 3 cases):
    - `it('creates a Notification row when input is valid')` — mockDeep<PrismaClient>; `prisma.notification.create` resolves; assert called with `expect.objectContaining({ data: input })`
    - `it('returns null when prisma.create throws PrismaClientKnownRequestError code=P2002 (dedupeKey collision)')` — make `create` reject with `{ code: 'P2002' }`-shaped error; assert return is null and no rethrow
    - `it('rethrows non-P2002 errors')` — make `create` reject with generic Error; assert the call rethrows

    **admin/audit.test.ts** (~30 LOC, 2 cases — verbatim from RESEARCH §"Pattern: Test for `admin/audit.ts`"):
    - `it('writes an AdminAction row with all required fields')` — mockDeep<PrismaClient>; assert `prisma.adminAction.create` called with `{ data: expect.objectContaining({ actorId, action, targetType, targetId, metadata }) }`
    - `it('accepts a tx argument (Prisma TransactionClient) — same shape as full client')` — pass a partial mock `{ adminAction: { create: vi.fn() } }`; assert called

    **payments/circuit-breaker.test.ts** (~50 LOC, 5 cases — use `vi.useFakeTimers()`):
    - `it('starts in CLOSED state and forwards calls')` — wrap a fn returning 'ok', assert returns 'ok'
    - `it('opens after N consecutive failures (per ctor threshold)')` — wrap a fn that always rejects; after threshold rejects, next call rejects with `CIRCUIT_OPEN` code without invoking fn
    - `it('refuses with CIRCUIT_OPEN while OPEN')` — same as above; assert `fn.mock.calls.length` does not increment
    - `it('transitions OPEN → HALF_OPEN after cooldown ms')` — `vi.advanceTimersByTime(cooldownMs + 1)`; next call invokes fn (HALF_OPEN trial)
    - `it('returns to CLOSED on a successful HALF_OPEN trial')` — trial resolves; subsequent failures must re-accumulate from zero before opening
  </behavior>
  <action>
For each of the 7 test files: import the function under test directly (no test of internals); use `vitest-mock-extended.mockDeep<PrismaClient>()` for prisma-using libs (audit, dispatcher, createNotification); use `vi.spyOn(process.env, '...')` or `vi.stubEnv(name, value)` for env-dependent libs (crypto, oauth/google).

**CRITICAL — DO NOT MODIFY ANY OF THE 7 SOURCE FILES.** They are PROTECTED per CLAUDE.md "Files Claude must NOT modify". This task only writes the companion `.test.ts` files. If a test seems to require an export that doesn't exist, FLAG IT IN THE SUMMARY (do not add the export — the lib stays frozen).

**Skeleton for `crypto.test.ts`:**

```typescript
// frontend/src/lib/server/crypto.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt } from './crypto';

describe('crypto round-trip', () => {
  beforeEach(() => {
    // ENCRYPTION_KEY is seeded by vitest.setup.ts (32 bytes base64).
  });

  it('round-trips a known plaintext', () => {
    const ciphertext = encrypt('hello world');
    expect(decrypt(ciphertext)).toBe('hello world');
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decrypt('not-a-valid-payload')).toThrow();
  });

  it('rejects ciphertext when ENCRYPTION_KEY is rotated', () => {
    const ciphertext = encrypt('secret');
    const orig = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    try {
      expect(() => decrypt(ciphertext)).toThrow();
    } finally {
      process.env.ENCRYPTION_KEY = orig;
    }
  });
});
```

**Skeleton for `admin/audit.test.ts` (verbatim from RESEARCH §"Pattern: Test for `admin/audit.ts`"):**

```typescript
// frontend/src/lib/server/admin/audit.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { logAdminAction } from './audit';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;
beforeEach(() => mockReset(prismaMock));

describe('logAdminAction', () => {
  it('writes an AdminAction row with all required fields', async () => {
    prismaMock.adminAction.create.mockResolvedValue({} as never);
    await logAdminAction(prismaMock, {
      actorId: 'admin_1',
      action: 'withdrawal.cancel',
      targetType: 'Withdrawal',
      targetId: 'wd_1',
      metadata: { reason: 'fraud' },
    });
    expect(prismaMock.adminAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin_1',
        action: 'withdrawal.cancel',
        targetType: 'Withdrawal',
        targetId: 'wd_1',
        metadata: { reason: 'fraud' },
      }),
    });
  });

  it('accepts a tx argument shaped like a Prisma TransactionClient', async () => {
    const txMock = { adminAction: { create: vi.fn().mockResolvedValue({}) } } as never;
    await logAdminAction(txMock, { actorId: 'a', action: 'x' });
    expect(txMock.adminAction.create).toHaveBeenCalledOnce();
  });
});
```

**Skeleton for `withdrawals/lock.test.ts` (verbatim from RESEARCH §"Code Examples"):**

```typescript
// frontend/src/lib/server/withdrawals/lock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withUserAdvisoryLock } from './lock'; // adjust to actual export name

describe('withUserAdvisoryLock', () => {
  it('issues pg_advisory_xact_lock with hashtext(userId) before running fn', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) } as never;
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withUserAdvisoryLock(tx, 'user_abc', fn);

    expect(result).toBe('ok');
    const firstCall = (tx as { $executeRaw: { mock: { calls: unknown[][] } } }).$executeRaw.mock.calls[0];
    expect(firstCall?.[0]?.toString()).toMatch(/pg_advisory_xact_lock/);
    expect(firstCall?.[0]?.toString()).toMatch(/hashtext/);
    expect(fn).toHaveBeenCalledOnce();
  });
});
```

For the remaining 4 (`outbox/dispatcher`, `oauth/google`, `notifications/createNotification`, `payments/circuit-breaker`): Read the source file first, identify the actual export shape, then write tests that match the **behavior** clauses above (not the SOURCE — never modify SOURCE).

If the actual `withUserAdvisoryLock` export is named differently (e.g. `withUserLock`, `withAdvisoryLock`), update the import in the test to match — DO NOT rename the source.

If `notifications/index.ts` exports `createNotification` but `vitest-mock-extended` cannot reach the prisma error class, construct the rejection manually:

```typescript
const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002', name: 'PrismaClientKnownRequestError' });
prismaMock.notification.create.mockRejectedValueOnce(p2002);
```

After all 7 are written, run `pnpm --filter frontend exec vitest run src/lib/server/{crypto,withdrawals/lock,outbox/dispatcher,oauth/google,notifications/createNotification,admin/audit,payments/circuit-breaker}.test.ts` — every file must be GREEN before moving on.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/lib/server/crypto.test.ts src/lib/server/withdrawals/lock.test.ts src/lib/server/outbox/dispatcher.test.ts src/lib/server/oauth/google.test.ts src/lib/server/notifications/createNotification.test.ts src/lib/server/admin/audit.test.ts src/lib/server/payments/circuit-breaker.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - All 7 *.test.ts files exist at the paths in `<files>`
    - `pnpm --filter frontend exec vitest run src/lib/server/crypto.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/withdrawals/lock.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/outbox/dispatcher.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/oauth/google.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/notifications/createNotification.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/admin/audit.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/payments/circuit-breaker.test.ts` exits 0
    - `git diff --stat frontend/src/lib/server/{crypto.ts,withdrawals/lock.ts,outbox/dispatcher.ts,oauth/google.ts,notifications/index.ts,admin/audit.ts,payments/circuit-breaker.ts}` returns empty (NO source modification — invariant for PROTECTED libs)
    - `pnpm --filter frontend test` total count increases by exactly 7 files (`grep -c "Test Files" + N pass` in vitest output)
  </acceptance_criteria>
  <done>7 PROTECTED libs gain direct companion unit tests; full Vitest suite stays GREEN; zero source edits to the 7 libs.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship smoke-auth.ts script + companion seed-dev.test.ts test + wire pnpm smoke:auth</name>
  <files>
    - frontend/scripts/smoke-auth.ts (NEW)
    - frontend/scripts/seed-dev.test.ts (NEW)
    - frontend/package.json (EDIT — add `smoke:auth` script)
    - package.json (EDIT — add root proxy `smoke:auth` script)
  </files>
  <read_first>
    - frontend/scripts/make-superadmin.ts (CLI guard pattern at lines 85-92; relative-path import precedent)
    - frontend/scripts/make-superadmin.test.ts (mockDeep PrismaClient pattern)
    - frontend/scripts/seed-dev.ts (BEFORE refactor — confirm top-level `await main()` at module load, no exports)
    - frontend/src/app/api/auth/verify-email/route.ts (verify body shape `{ email, code }` and the VerificationCode lookup keys)
    - frontend/src/app/api/auth/signup/route.ts (verify status code: 201 expected per RESEARCH A2; if 200, adjust assertion)
    - frontend/prisma/schema.prisma (VerificationCode model: userId + type='EMAIL_VERIFY' + usedAt? — confirm exact field names)
    - .planning/phases/06-tests-scripts-docker-docs/06-RESEARCH.md §"Smoke-auth Script Pattern" + §"seed-dev.test.ts skeleton"
  </read_first>
  <behavior>
    **smoke-auth.ts behaviors (manual UAT — NOT a Vitest target):**
    - When `DATABASE_URL` or `JWT_SECRET` env unset: prints operator-friendly "→ Run: cp .env.example .env.local && pnpm dev" and returns exit-code 1 WITHOUT touching the network
    - When env present + server not running: fetch throws ECONNREFUSED → catch prints `[step]=signup status=n/a body=undefined` and returns 1
    - Happy path against running `pnpm dev`: signup returns 201 (or 200 — adjust per actual route); peek VerificationCode row by `(userId, type='EMAIL_VERIFY', usedAt: null)`; verify-email returns 200 + sets cookies; me returns 200 + `body.user.email === TEST_EMAIL`; logout returns 200; cleanup deletes test user
    - Cookie name uses `app-csrf` prefix (the default `COOKIE_PREFIX=app`); script header documents that forks overriding `COOKIE_PREFIX` must adjust

    **seed-dev.test.ts behaviors (Vitest unit test):**
    - `it('refuses NODE_ENV=production and exits 1')` — main() with stubbed env throws via process.exit spy
    - `it('upserts each seed user (idempotent — runs upsert, not create)')` — mockDeep PrismaClient; `prisma.user.upsert` called once per seed user
    - `it('hashes passwords with bcrypt before upsert')` — first call `passwordHash` matches `/^\$2[ab]\$/` and does NOT contain plaintext

    **seed-dev.ts refactor (REQUIRED):**
    - Export `main(args: string[], deps: { prisma: PrismaClient }): Promise<void>` — args optional (default `[]`); deps.prisma optional (default new PrismaClient())
    - Replace top-level `await main()` with the same CLI guard used by `make-superadmin.ts:85-92`:
      ```typescript
      if (import.meta.url === `file://${process.argv[1]}`) {
        main(process.argv.slice(2)).then(() => process.exit(0)).catch((err) => {
          console.error(err);
          process.exit(1);
        });
      }
      ```
    - Move `new PrismaClient()` instantiation INTO main()'s default arg so importing the module does NOT open a DB connection
  </behavior>
  <action>
**1. Create `frontend/scripts/smoke-auth.ts`** — paste the ~80 LOC skeleton verbatim from RESEARCH §"Smoke-auth Script Pattern" (the file contents starting at `// frontend/scripts/smoke-auth.ts` line and ending at `export { main };`).

Key adjustments after Read-first verification:
- If `signup/route.ts` returns 200 (not 201), change `assertStatus('signup', signupRes, 201)` → `200`
- The cookie prefix is hardcoded `app-csrf=` per `COOKIE_PREFIX` default; add `// NOTE: forks overriding COOKIE_PREFIX must update the regex` above the `csrfFromCookies` function
- Use **relative imports only** for any internal lib reference (RESEARCH Pitfall 1) — currently the script imports only `@prisma/client` (an installed dep, alias-safe)
- Header comment must say "Requires Node 20+ for Response.headers.getSetCookie() — engines.node enforces this" (Pitfall 5)
- DO NOT create `frontend/scripts/smoke-auth.test.ts` — Pitfall 3: Vitest auto-discovers `scripts/**/*.test.ts` and would run it in CI without a live server

**2. Refactor `frontend/scripts/seed-dev.ts`** — minimal export + CLI-guard refactor:

Read the current file (which has top-level `await main()` per RESEARCH A1). Then change to:

```typescript
// frontend/scripts/seed-dev.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

interface SeedDeps { prisma: PrismaClient; }
const SEED_USERS = [
  { email: 'admin@example.com', role: 'SUPERADMIN' as const, password: 'AdminPassword123!' },
  { email: 'user1@example.com', role: 'USER' as const, password: 'UserPassword123!' },
  { email: 'user2@example.com', role: 'USER' as const, password: 'UserPassword123!' },
];

export async function main(_args: string[] = [], deps?: SeedDeps): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('seed-dev refuses to run with NODE_ENV=production');
    process.exit(1);
  }
  const prisma = deps?.prisma ?? new PrismaClient();
  for (const u of SEED_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, passwordHash, role: u.role, emailVerifiedAt: new Date() },
      update: { role: u.role },
    });
  }
  if (!deps?.prisma) await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Adjust `SEED_USERS` array to match the exact data the current `seed-dev.ts` upserts (from the Read-first step). The shape (export `main(args, deps)` + CLI guard) is the contract — preserve the actual seed data verbatim.

**3. Create `frontend/scripts/seed-dev.test.ts`** — paste the skeleton verbatim from RESEARCH §"seed-dev.test.ts skeleton" (the contents starting at `// frontend/scripts/seed-dev.test.ts`). Adjust the `SEED_USERS.length` assertion (`toHaveBeenCalledTimes(N)`) to match the actual count after Step 2.

**4. Edit `frontend/package.json` scripts:** add the line:

```json
"smoke:auth": "tsx --env-file=.env.local scripts/smoke-auth.ts"
```

(Keep existing scripts. Order: alphabetical OR after `seed:dev`, mirroring repo style.)

**5. Edit root `package.json` scripts:** add the line:

```json
"smoke:auth": "pnpm --filter frontend run smoke:auth"
```

(Mirror the existing `pnpm dev`/`pnpm test` proxy pattern.)
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run scripts/seed-dev.test.ts && grep -q '"smoke:auth"' frontend/package.json && grep -q '"smoke:auth"' package.json</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/scripts/smoke-auth.ts` exists; first 3 lines are a comment block declaring "TEST-03 — Smoke test against a running Next.js dev server. Requires Node 20+."
    - `wc -l frontend/scripts/smoke-auth.ts` >= 80
    - `grep -c "import.meta.url" frontend/scripts/smoke-auth.ts` >= 1 (CLI guard present)
    - `grep -c "PrismaClient" frontend/scripts/smoke-auth.ts` >= 1 (DB peek)
    - `grep -q "DELETE\\|deleteMany" frontend/scripts/smoke-auth.ts` (cleanup runs in `finally`)
    - `frontend/scripts/seed-dev.ts` exports `main` (`grep -q "^export async function main" frontend/scripts/seed-dev.ts`)
    - `grep -q "if (import.meta.url" frontend/scripts/seed-dev.ts` (CLI guard at bottom)
    - `frontend/scripts/seed-dev.test.ts` exists and `pnpm --filter frontend exec vitest run scripts/seed-dev.test.ts` exits 0
    - `grep -c '"smoke:auth"' frontend/package.json` returns 1
    - `grep -c '"smoke:auth"' package.json` returns 1 (root)
    - NO file `frontend/scripts/smoke-auth.test.ts` exists (`! ls frontend/scripts/smoke-auth.test.ts 2>/dev/null` per Pitfall 3)
    - Full suite green: `pnpm --filter frontend test` exits 0 (smoke script is NOT picked up; only seed-dev.test.ts adds 3 cases)
  </acceptance_criteria>
  <done>smoke-auth.ts ships and is wired via `pnpm smoke:auth`; seed-dev.ts is importable; seed-dev.test.ts is GREEN; root + frontend package.json both expose `smoke:auth`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Ship 2 doc-tripwire tests under observability/ (DOC-01 + DOC-02 lock-in)</name>
  <files>
    - frontend/src/lib/server/observability/claude-md-shape.test.ts (NEW)
    - frontend/src/lib/server/observability/readme-shape.test.ts (NEW)
  </files>
  <read_first>
    - frontend/src/lib/server/observability/runtime-enforcement.test.ts (path resolution pattern via `import.meta.url + fileURLToPath`)
    - frontend/src/lib/server/observability/vercel-json-shape.test.ts (read-file + assert pattern)
    - frontend/src/lib/server/observability/env-shape.test.ts (regex assertion style; the path-resolution depth — 5 levels up from `frontend/src/lib/server/observability/` to repo root)
    - .planning/phases/06-tests-scripts-docker-docs/06-VALIDATION.md §"Doc tripwire pattern"
    - CLAUDE.md (current state — confirm 1 negation hit for "Express" near top, that's it)
    - README.md (current state — full rewrite incoming via plan 06-03; this test asserts the post-rewrite shape)
  </read_first>
  <behavior>
    **claude-md-shape.test.ts** (~25 LOC, 3 cases):
    - `it('exists at repo root')` — `fs.existsSync(claudeMdPath)` returns true
    - `it('contains zero errant Express|backend/src|express.json|middleware-order references (negation context allowed)')` — the only line matching `/Express/` MUST be the negation phrase (`There is no separate Express backend anymore`). All other matches must be 0.
    - `it('mentions canonical Phase 4-5 routes (cron, webhook, withdrawals, upload)')` — regex `/api\/cron|webhook|withdrawals|upload/` matches > 0

    **readme-shape.test.ts** (~25 LOC, 4 cases):
    - `it('exists at repo root')`
    - `it('contains the quickstart command sequence')` — regex matches `/cp \.env\.example \.env\.local|cp \.env\.example \.env/` AND `/pnpm install/` AND `/pnpm dev/`
    - `it('points at frontend/src/app/api/ for route inventory')` — `grep "frontend/src/app/api"` returns at least 1 match
    - `it('contains zero errant Express references (negation context allowed)')` — same shape as CLAUDE.md tripwire
  </behavior>
  <action>
**Path resolution:** test files live at `frontend/src/lib/server/observability/<name>.test.ts`. Repo root is **5 levels up** (`../../../../../`). Use `import.meta.url + fileURLToPath` for portability (Phase 0 D-13 pattern):

```typescript
// frontend/src/lib/server/observability/claude-md-shape.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLAUDE_MD_PATH = resolve(__dirname, '../../../../../CLAUDE.md');

describe('CLAUDE.md doc tripwire (DOC-01)', () => {
  it('exists at repo root', () => {
    expect(existsSync(CLAUDE_MD_PATH)).toBe(true);
  });

  it('contains zero errant Express|backend/src|express.json|middleware-order references', () => {
    const content = readFileSync(CLAUDE_MD_PATH, 'utf8');
    // Negation context is allowed: a single line saying "There is no separate Express backend anymore" is HISTORICAL
    // and intentional. Every other "Express" hit is a regression.
    const lines = content.split('\n');
    const expressHits = lines
      .map((l, i) => ({ line: l, idx: i + 1 }))
      .filter(({ line }) => /\bExpress\b/.test(line))
      .filter(({ line }) => !/no separate Express backend|There is no.*Express/i.test(line));
    expect(expressHits, `Unexpected Express references:\n${expressHits.map(h => `  L${h.idx}: ${h.line}`).join('\n')}`).toEqual([]);

    // backend/src — should NEVER appear (the monolith has no backend/ directory)
    expect(content).not.toMatch(/backend\/src/);

    // express.json() — old Express middleware reference; should NEVER appear
    expect(content).not.toMatch(/express\.json\(/);

    // middleware-order — old Express ordering concept; should NEVER appear
    expect(content).not.toMatch(/middleware-order/);
  });

  it('mentions canonical Phase 4-5 surface (cron + webhook + withdrawals + upload)', () => {
    const content = readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(content).toMatch(/\/api\/cron|app\/api\/cron/);
    expect(content).toMatch(/webhook/i);
    expect(content).toMatch(/withdrawal/i);
    expect(content).toMatch(/upload/i);
  });
});
```

**Skeleton for `readme-shape.test.ts`:**

```typescript
// frontend/src/lib/server/observability/readme-shape.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const README_PATH = resolve(__dirname, '../../../../../README.md');

describe('README.md doc tripwire (DOC-02)', () => {
  it('exists at repo root', () => {
    expect(existsSync(README_PATH)).toBe(true);
  });

  it('contains the quickstart command sequence', () => {
    const content = readFileSync(README_PATH, 'utf8');
    expect(content).toMatch(/cp \.env\.example \.env(\.local)?/);
    expect(content).toMatch(/pnpm install/);
    expect(content).toMatch(/pnpm dev/);
    expect(content).toMatch(/docker compose up/);
  });

  it('points at frontend/src/app/api/ for route inventory', () => {
    const content = readFileSync(README_PATH, 'utf8');
    expect(content).toMatch(/frontend\/src\/app\/api/);
  });

  it('contains zero errant Express references (negation context allowed)', () => {
    const content = readFileSync(README_PATH, 'utf8');
    const lines = content.split('\n');
    const expressHits = lines
      .map((l, i) => ({ line: l, idx: i + 1 }))
      .filter(({ line }) => /\bExpress\b/.test(line))
      .filter(({ line }) => !/no separate Express|amadou-template.*Express|previous Express|former Express/i.test(line));
    expect(expressHits, `Unexpected Express references:\n${expressHits.map(h => `  L${h.idx}: ${h.line}`).join('\n')}`).toEqual([]);
  });

  it('mentions pnpm smoke:auth and CRON_SECRET', () => {
    const content = readFileSync(README_PATH, 'utf8');
    expect(content).toMatch(/pnpm smoke:auth|smoke-auth/);
    expect(content).toMatch(/CRON_SECRET/);
  });
});
```

**Note for sibling Wave 1 plans:** these tests are RED-by-design until plans 06-02 (CLAUDE.md cleanup) and 06-03 (README rewrite) merge back. After merge-back of all 3 Wave 1 plans + this Wave 0 plan, the suite goes fully GREEN. Document this in the SUMMARY: "claude-md-shape.test.ts may fail in this worktree before plan 06-02 merge-back; readme-shape.test.ts may fail before plan 06-03 merge-back. Final suite GREEN expected post-merge."
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/lib/server/observability/claude-md-shape.test.ts src/lib/server/observability/readme-shape.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - Both files exist at the paths in `<files>`
    - `wc -l frontend/src/lib/server/observability/claude-md-shape.test.ts` >= 25
    - `wc -l frontend/src/lib/server/observability/readme-shape.test.ts` >= 25
    - `grep -c "import.meta.url" frontend/src/lib/server/observability/claude-md-shape.test.ts` >= 1 (portable path resolution)
    - `grep -c "import.meta.url" frontend/src/lib/server/observability/readme-shape.test.ts` >= 1
    - `grep -c "../../../../../CLAUDE.md" frontend/src/lib/server/observability/claude-md-shape.test.ts` returns 1 (5-level path)
    - `grep -c "../../../../../README.md" frontend/src/lib/server/observability/readme-shape.test.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/claude-md-shape.test.ts` MAY fail in worktree before 06-02 merge-back — record explicit pass/fail in SUMMARY
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/readme-shape.test.ts` MAY fail in worktree before 06-03 merge-back — record explicit pass/fail in SUMMARY
    - `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0 (no TS errors)
  </acceptance_criteria>
  <done>2 doc-tripwire tests shipped under observability/; final-state assertions match the post-rewrite shape Plans 06-02 and 06-03 deliver.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Cross-reference verification — TEST-01 + ENV-01 already shipped (no source changes)</name>
  <files>
    (no files modified — pure verification step recorded in SUMMARY)
  </files>
  <read_first>
    - frontend/vitest.config.ts (confirm `setupFiles: ['./vitest.setup.ts']` present at line ~19)
    - frontend/vitest.setup.ts (confirm JWT_SECRET + ENCRYPTION_KEY seeded)
    - frontend/.env.example (confirm `CRON_SECRET=""` present at line ~18 with `openssl rand -base64 32` hint nearby)
    - frontend/src/lib/server/observability/env-shape.test.ts (confirm CRON_SECRET assertion already present from Phase 0 OPS-04)
  </read_first>
  <behavior>
    - TEST-01 and ENV-01 are satisfied by Phase 0/Phase 1 deliverables; this task records the cross-reference in the SUMMARY without modifying source.
    - The plan SUMMARY MUST contain a "TEST-01 + ENV-01 cross-reference" section listing the specific file paths + line numbers proving these are shipped.
  </behavior>
  <action>
This is a no-modification verification step. Run the following commands and capture the output for the SUMMARY:

```bash
# TEST-01 evidence
grep -n "setupFiles" frontend/vitest.config.ts
grep -n "JWT_SECRET\|ENCRYPTION_KEY" frontend/vitest.setup.ts

# ENV-01 evidence
grep -n "^CRON_SECRET" frontend/.env.example
grep -n "openssl rand" frontend/.env.example
grep -n "CRON_SECRET" frontend/src/lib/server/observability/env-shape.test.ts
```

Document the line-number-anchored output in the SUMMARY's "Cross-references (no work)" section. Do not modify any of these files.

If any grep returns 0 hits (a regression since Phase 0/1), STOP and surface in the SUMMARY as a BLOCKER for the plan-checker pass — don't paper over it.
  </action>
  <verify>
    <automated>grep -q "setupFiles" frontend/vitest.config.ts && grep -q "JWT_SECRET" frontend/vitest.setup.ts && grep -q "^CRON_SECRET=" frontend/.env.example</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "setupFiles" frontend/vitest.config.ts` exits 0
    - `grep -q "JWT_SECRET" frontend/vitest.setup.ts` exits 0
    - `grep -q "ENCRYPTION_KEY" frontend/vitest.setup.ts` exits 0
    - `grep -q "^CRON_SECRET=" frontend/.env.example` exits 0
    - `grep -q "openssl rand" frontend/.env.example` exits 0
    - `git diff --stat frontend/vitest.config.ts frontend/vitest.setup.ts frontend/.env.example` returns empty (NO modifications)
    - SUMMARY contains a "Cross-references (no work)" section listing the 5 grep results with file paths + line numbers
  </acceptance_criteria>
  <done>TEST-01 and ENV-01 cross-references are documented in the SUMMARY; zero source files modified.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Manual UAT — Docker build + run + /api/health probe (DOCKER-01)</name>
  <what-built>
    Phase 6 has not modified `frontend/Dockerfile` or `docker-compose.yml` (per Phase 5 D-PRE-03, both are already correct). This checkpoint verifies that the existing files actually build a runnable image AND that the running container responds 200 on `/api/health`. The result of this manual UAT is recorded in the plan SUMMARY but does not modify any code.

    The recipe also confirms the ROADMAP success criterion #4 needs the `-f frontend/Dockerfile` flag (Plan 06-03 fixes the ROADMAP wording).
  </what-built>
  <how-to-verify>
    Run these commands at the repo root. Each must succeed before the next:

    1. **Build the image** (build context is repo root; Dockerfile is in `frontend/`):
       ```bash
       docker build -f frontend/Dockerfile -t amadou-monolith .
       ```
       Expected: `Successfully tagged amadou-monolith:latest` exit 0. Record build duration + image size from `docker images amadou-monolith`.

    2. **Boot infra** (Postgres + Redis):
       ```bash
       docker compose up -d postgres redis
       ```
       Wait until `docker compose ps` shows both healthy.

    3. **Apply schema host-side** (`db:push` is faster than running migrations from inside the container):
       ```bash
       DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amadou_dev' pnpm db:push
       ```
       Expected: Prisma reports schema in sync; exit 0.

    4. **Run the built image:**
       ```bash
       docker run --rm -d --name amadou-smoke -p 3000:3000 \
         -e DATABASE_URL='postgresql://postgres:postgres@host.docker.internal:5432/amadou_dev' \
         -e JWT_SECRET='vitest-fixture-jwt-secret-with-enough-entropy-for-tests' \
         -e ENCRYPTION_KEY='aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n' \
         amadou-monolith
       ```
       (On Linux, replace `host.docker.internal` with `--add-host=host.docker.internal:host-gateway` or use the docker-compose network's `postgres` hostname.)

    5. **Probe /api/health:**
       ```bash
       curl -fsS http://localhost:3000/api/health
       ```
       Expected: `{"ok":true,"time":"2026-..."}` 200 status.

    6. **Cleanup:**
       ```bash
       docker stop amadou-smoke
       docker compose down
       ```

    Record in the SUMMARY:
    - Did `docker build` succeed? (exit code, duration, image size)
    - Did `docker run` succeed? (exit code, container ID)
    - Did `/api/health` return 200 with JSON body? (response body verbatim)
    - Any errors or warnings in `docker logs amadou-smoke`?
    - Confirm `docker-compose.yml` has 4 services (postgres, redis, minio, mailpit) + 1 init (minio-init) — NO `backend` service: `docker compose config --services` returns the 4 names

    If `docker build` fails: capture the error and include it in the SUMMARY. The build break would be a Phase 5 regression (the Dockerfile worked there); Plan 06-01 itself does NOT modify the Dockerfile.
  </how-to-verify>
  <action>
This is a checkpoint task — the actions are HUMAN-driven (operator runs `docker build` + `docker run` + `curl /api/health` per the recipe in `<how-to-verify>`). Claude does NOT run these commands automatically because Docker requires desktop-app context the autonomous executor does not have. The verify automation is `false` (manual). After the operator approves, Claude records the captured output (build duration, image size, /api/health response body, docker compose service list) into the plan SUMMARY.
  </action>
  <verify>
    <automated>echo "MANUAL UAT — see how-to-verify section; verification recorded in 06-01-SUMMARY.md"</automated>
  </verify>
  <done>Operator confirmed `docker build -f frontend/Dockerfile -t amadou-monolith .` succeeded, `docker run` started the container, and `/api/health` returned 200 with JSON body. SUMMARY records all captured outputs.</done>
  <resume-signal>Type "approved" with the captured outputs (build status, run status, /api/health body) OR "issues" with the captured error log. If "issues", planner-checker will spawn a follow-up Wave 1 plan to address the regression.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer→repo | Test files + scripts are checked into git; no secrets — declarative |
| operator→running container | Docker UAT runs against a local container with test fixtures (vitest-shaped JWT_SECRET); no production data |
| smoke script→running server | smoke-auth.ts uses a timestamped `.test`-TLD email; never touches production data |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-01-01 | I (Information disclosure) | smoke-auth.ts test credentials | accept | `TEST_EMAIL = smoke-${Date.now()}@example.test` (timestamped, deleted in `finally`); `.test` TLD never resolves; password is non-secret literal |
| T-06-01-02 | T (Tampering) | seed-dev.ts running in production accidentally | mitigate | seed-dev.ts main() refuses NODE_ENV=production with exit 1 BEFORE any prisma call; seed-dev.test.ts asserts this |
| T-06-01-03 | E (Elevation of privilege) | adding source modification to PROTECTED libs while writing tests | mitigate | Acceptance criteria includes `git diff --stat` returning empty for the 7 PROTECTED libs; planner-checker enforces this |
| T-06-01-04 | I (Information disclosure) | smoke script peeks raw VerificationCode from DB | accept | Dev-only script; never run in CI; not deployed in image; the alternative (`/api/test/peek-code` endpoint) is a worse footgun (env-misset can leak it in prod) |
| T-06-01-05 | D (DoS) | docker-compose.yml regression introducing backend service | mitigate | claude-md-shape.test.ts asserts no `backend/src` references; `docker compose config --services` records the 4-service set in SUMMARY |
| T-06-01-06 | T (Tampering) | smoke script's cookie parser fragile across Node versions | mitigate | Pitfall 5: hard-require Node 20+; engines.node already enforces; script header documents |
</threat_model>

<verification>
- All 7 PROTECTED-lib companion tests GREEN: `pnpm --filter frontend exec vitest run src/lib/server/{crypto,withdrawals/lock,outbox/dispatcher,oauth/google,notifications/createNotification,admin/audit,payments/circuit-breaker}.test.ts`
- seed-dev.test.ts GREEN: `pnpm --filter frontend exec vitest run scripts/seed-dev.test.ts`
- 2 doc-tripwire tests exist (may be RED in this worktree before sibling Wave 1 merge-back — explicitly recorded)
- `pnpm smoke:auth` script wired in both root + frontend package.json
- Manual UAT recipe ran successfully (Task 5 checkpoint approved)
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0 (no TS errors introduced)
- `pnpm --filter frontend exec eslint src/lib/server/{crypto,withdrawals/lock,outbox/dispatcher,oauth/google,notifications/createNotification,admin/audit,payments/circuit-breaker}.test.ts scripts/seed-dev.test.ts scripts/seed-dev.ts scripts/smoke-auth.ts src/lib/server/observability/{claude-md-shape,readme-shape}.test.ts` exits 0
- No PROTECTED file modified: `git diff --stat frontend/src/lib/server/{auth.ts,crypto.ts,webhook/handler.ts,withdrawals/lock.ts,outbox/dispatcher.ts,oauth/google.ts,admin/audit.ts,payments/circuit-breaker.ts,middleware/index.ts,observability/request-context.ts}` returns empty
</verification>

<success_criteria>
- 7 new TEST-02 gap-fill tests under `frontend/src/lib/server/**` GREEN
- 2 new doc-tripwire tests under `frontend/src/lib/server/observability/` shipped (final-state GREEN post-merge-back of plans 06-02 + 06-03)
- `frontend/scripts/smoke-auth.ts` shipped (~80 LOC); requires Node 20+; exits 0/1 cleanly
- `frontend/scripts/seed-dev.ts` refactored to export `main(args, deps)` with CLI guard
- `frontend/scripts/seed-dev.test.ts` shipped + GREEN
- `pnpm smoke:auth` works at both repo root and frontend workspace
- TEST-01 + ENV-01 cross-references documented in SUMMARY (no source modification)
- Docker UAT recipe ran successfully (Task 5 checkpoint approved); SUMMARY records build/run/health-probe outputs
- No PROTECTED file modified
- `pnpm test` total file count increases by exactly 10 (7 lib gap-fills + 2 doc tripwires + 1 seed-dev test)
</success_criteria>

<output>
After completion, create `.planning/phases/06-tests-scripts-docker-docs/06-01-SUMMARY.md`:
- Files created (10 new + 4 modified)
- All 7 PROTECTED-lib gap-fill tests: file paths + GREEN status
- smoke-auth.ts behavior summary (signup → DB-peek → verify-email → me → logout sequence; cleanup in `finally`)
- seed-dev.ts refactor delta (export shape; CLI-guard pattern preserved)
- seed-dev.test.ts case list + GREEN status
- 2 doc tripwires: file paths + per-test pass/fail status (note expected RED-until-merge-back for plans 06-02 + 06-03)
- TEST-01 + ENV-01 cross-references with line-number-anchored grep outputs
- Docker UAT outputs (build duration, image size, /api/health response body, docker compose services list)
- Note: any deviations from research-recommended patterns (e.g. if signup returns 200 instead of 201)
- v1.x followups: `auth.test.ts` (cookie-issue happy path) + `webhook/handler.test.ts` (Serializable + raw-body) deferred per RESEARCH §"TEST-02 Coverage Audit" — flagged for Phase 7 or later
</output>
</content>
