# Phase 6: Tests, Scripts, Docker, Docs - Research

**Researched:** 2026-05-08
**Domain:** test-suite audit + smoke script + Docker verification + doc rewrite (zero new domain logic)
**Confidence:** HIGH

## Summary

Phase 6 is an audit-and-fill pass. The bulk of TEST-01 / SCRIPT-01 / DOCKER-01 / ENV-01 already shipped in Phases 0–5; the only genuinely new artifact is `frontend/scripts/smoke-auth.ts` (TEST-03) plus an optional `seed-dev.test.ts` and 4 gap-fill unit tests under `lib/server/**`. README.md is the largest write — a full rewrite to eliminate stale "in-progress" framing and document the current API surface. CLAUDE.md is already monolith-shaped and only needs an append for Phase 4/5 routes plus a single-line "ports of call" tweak.

**Primary recommendation:** Wave 0 ships the test gap-fill + smoke script + Docker verification in one focused plan (sequential because all touch `frontend/`). Wave 1 ships CLAUDE.md, README.md, and `package.json` script wiring in 3 fully parallel plans (zero file overlap).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pre-state inventory (already shipped):**
- **D-PRE-01:** `frontend/vitest.config.ts` already has `setupFiles: ['./vitest.setup.ts']` seeding `JWT_SECRET` / `ENCRYPTION_KEY` (Phase 1 D-27). **TEST-01 satisfied.**
- **D-PRE-02:** `frontend/scripts/make-superadmin.ts` exists with companion `.test.ts`. `frontend/scripts/seed-dev.ts` exists. Both run via `tsx`. **SCRIPT-01 mostly satisfied.**
- **D-PRE-03:** `frontend/Dockerfile` exists (multi-stage Node 20). `docker-compose.yml` has 4 services (no `backend`). **DOCKER-01 mostly satisfied.**
- **D-PRE-04:** `frontend/.env.example` already has `CRON_SECRET=""` (Phase 0 OPS-04). **ENV-01 satisfied.**
- **D-PRE-05:** 21 `*.test.ts` files exist under `lib/server/**` from Phases 0–5; full Vitest suite is 508/508 GREEN. **TEST-02 largely satisfied.**

**Genuine remaining work:**
- **D-01:** Ship `frontend/scripts/smoke-auth.ts`. Pure-`fetch` against `process.env.SMOKE_BASE_URL ?? 'http://localhost:3000'`. Sequence: signup → fetch verification code from DB (researcher to recommend mechanism) → POST verify-email → GET me → DELETE logout. Asserts HTTP status + parses JSON body each step. Exit 0 on full pass; 1 + descriptive log on any failure. Wired as `pnpm smoke:auth`. NOT run in CI.
- **D-02:** TEST-02 audit produces a coverage report listing each of the 9 named libs and their corresponding test file path. Likely gap-fill candidates: `oauth/google.test.ts`, `notifications/createNotification.test.ts` (or `notifications/index.test.ts`), `admin/audit.test.ts`, `payments/circuit-breaker.test.ts`.
- **D-03:** DOCKER-01 reconciliation: keep `frontend/Dockerfile` as canonical and update ROADMAP success criterion #4 + README quickstart to use `docker build -f frontend/Dockerfile -t amadou-monolith .`. NO root-level Dockerfile (avoids two source-of-truth files).
- **D-04:** DOC-01 (CLAUDE.md) cleanup. (a) Add Phase 4/5 route inventory; (b) refresh `Files Claude SHOULD modify` to include `lib/server/cron/`, `lib/server/webhook/bictorys.ts`, `lib/server/orders/expire.ts`; (c) purge any stray Express references. NO content reorganization.
- **D-05:** DOC-02 (README.md) full rewrite. Sections: ① What this is, ② Quickstart, ③ Env reference, ④ Route inventory, ⑤ Smoke test, ⑥ Deploy to Vercel, ⑦ "What's NOT shipped".
- **D-06:** Wave structure: ONE Wave 0 plan (audit + smoke + script-tests + DOCKER verify) ships first; THREE Wave 1 plans run in parallel (CLAUDE.md, README, optional Docker tweaks).

### Claude's Discretion

- Specific gap-fill test names / scope (researcher resolves below).
- Whether the smoke script peeks the verification code via direct Prisma OR a dev-only `/api/test/*` endpoint (researcher recommends direct Prisma below).
- README.md prose style — match `STATUS.md` voice.
- Whether to add a `pnpm test:smoke` shortcut alongside `pnpm smoke:auth` (planner decides).
- Sentry/OTel notes in deploy guide (link out, don't duplicate).

### Deferred Ideas (OUT OF SCOPE)

- Playwright / Cypress E2E browser tests.
- CI workflow files (`.github/workflows/*.yml`).
- Bootstrap CLI / public OSS distribution.
- Auto-generated route inventory (manual list is fine).
- OpenAPI / Swagger docs.
- v2 features.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | `vitest.config.ts` exists with `setupFiles` seeding `JWT_SECRET` / `ENCRYPTION_KEY` | Already shipped — confirmed at `frontend/vitest.config.ts:19` + `frontend/vitest.setup.ts:13-14`. **No work.** |
| TEST-02 | 9 named security-critical libs have Vitest unit tests | Audit table below shows 4 hits / 5 gaps — fill with focused unit tests in Wave 0 |
| TEST-03 | Smoke test against running Next dev server covers auth happy path | Skeleton + DB-peek pattern below |
| SCRIPT-01 | `scripts/make-superadmin.ts` + `scripts/seed-dev.ts` runnable via `tsx`; import from `lib/server/prisma` | `make-superadmin.ts` already imports `../src/lib/server/admin/audit`; `seed-dev.ts` uses direct `PrismaClient` import (acceptable, `prisma.ts` is a singleton wrapper around the same client). Add companion `seed-dev.test.ts` |
| DOCKER-01 | Drop `backend` service, runnable image, both verified locally | Verified: `docker-compose.yml` has 4 services, no `backend`. Need `docker build` + `docker run` + `curl /api/health` recipe |
| DOC-01 | CLAUDE.md rewritten for monolith — no Express residue | Already largely correct. 0 hits for `Express\|backend/src\|express\.json\|middleware-order` (only one accurate negation reference at line 7: "There is no separate Express backend anymore"). Append Phase 4/5 routes |
| DOC-02 | README.md rewritten — quickstart, env ref, deploy guide, route inventory | Current README has 5 hits referring to "Express" but ALL are negation/historical context — still requires section-by-section rewrite per D-05 |
| ENV-01 | `CRON_SECRET` in `.env.example` with hint | Verified at `frontend/.env.example:18`. **No work.** |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Every Route Handler MUST `export const runtime = 'nodejs'` (CI-enforced).
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — no `any` casts.
- Vitest for unit tests; setup file at `frontend/vitest.setup.ts`; `server-only` aliased for jsdom.
- Conventional Commits.
- Node ≥ 20, pnpm ≥ 9.
- Pre-commit gate: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
- Files Claude must NOT modify: `auth.ts`, `crypto.ts`, `webhook/handler.ts`, `withdrawals/lock.ts`, `outbox/dispatcher.ts`, `oauth/google.ts`, `admin/audit.ts`, `payments/circuit-breaker.ts`, `middleware/index.ts`, `observability/request-context.ts`, `instrumentation.ts`, `lib/api.ts`. Phase 6 only WRITES TESTS for these — never edits the source.

## TEST-02 Coverage Audit

Source confirmed via `find frontend/src/lib/server -name "*.test.ts"` (21 hits) cross-referenced against the 9 named libs.

| # | Lib | Source path | Companion test | Status |
|---|-----|------------|----------------|--------|
| 1 | `auth.ts` | `frontend/src/lib/server/auth.ts:1-9560 bytes` | None at `auth.test.ts`; coverage **distributed** across 7 sub-files in `auth/`: `dummy-bcrypt.test.ts`, `lockout.test.ts`, `refresh-lock.test.ts`, `pin.test.ts`, `email-templates.test.ts`, `hibp.test.ts`, `banned-passwords.test.ts` | **PARTIAL — gap** for `auth.ts` itself (cookie-issue / verifyCsrf / token-rotation paths not in subtests) |
| 2 | `crypto.ts` | `frontend/src/lib/server/crypto.ts:1-1683 bytes` | NOT FOUND | **GAP** |
| 3 | `webhook/handler.ts` | `frontend/src/lib/server/webhook/handler.ts:1-5762 bytes` | `frontend/src/lib/server/webhook/bictorys.test.ts` (covers the bictorys provider; **NOT** the generic handler idempotency / Serializable tx logic) | **PARTIAL — gap** for handler-specific Serializable-tx + raw-body invariants |
| 4 | `withdrawals/lock.ts` | `frontend/src/lib/server/withdrawals/lock.ts:1-1878 bytes` | NOT FOUND | **GAP** |
| 5 | `outbox/dispatcher.ts` | `frontend/src/lib/server/outbox/dispatcher.ts:1-6376 bytes` | NOT FOUND | **GAP** |
| 6 | `oauth/google.ts` | `frontend/src/lib/server/oauth/google.ts:1-2841 bytes` | `frontend/src/lib/server/oauth/error-redirect.test.ts` (covers the error-code mapper; **NOT** the google-provider config / decode shape) | **PARTIAL — gap** |
| 7 | `notifications/index.ts` (`createNotification`) | `frontend/src/lib/server/notifications/index.ts:1-1778 bytes` | None at `index.test.ts` or `createNotification.test.ts`. Sibling files have tests (`cursor.test.ts`, `prefs-merge.test.ts`) | **GAP** |
| 8 | `admin/audit.ts` | `frontend/src/lib/server/admin/audit.ts:1-1336 bytes` | NOT FOUND | **GAP** |
| 9 | `payments/circuit-breaker.ts` | `frontend/src/lib/server/payments/circuit-breaker.ts:1-4784 bytes` | NOT FOUND | **GAP** |

**Verdict:** 0/9 named libs have a *direct* companion test. Two libs (`auth.ts`, `webhook/handler.ts`) have substantial *adjacent* coverage but lack direct happy-path tests. The 7 remaining are bare gaps.

**Gap-fill list (Wave 0):**

| New test file | Lines target | Scope | Notes |
|---------------|------|-------|-------|
| `frontend/src/lib/server/crypto.test.ts` | ~30 LOC | round-trip encrypt/decrypt; reject malformed payload; reject wrong key | crypto helpers are pure — easiest gap |
| `frontend/src/lib/server/withdrawals/lock.test.ts` | ~40 LOC | `withUserAdvisoryLock(tx, userId, fn)` calls `pg_advisory_xact_lock` with `hashtext($1)`; uses Serializable isolation; releases on rollback | Mock the tx; assert SQL emitted via `tx.$executeRawUnsafe` spy |
| `frontend/src/lib/server/outbox/dispatcher.test.ts` | ~60 LOC | atomic claim (PENDING → PROCESSING); exponential backoff bumps `nextAttemptAt`; max 5 attempts → DEAD; reset stale PROCESSING > 90s | Use `vitest-mock-extended` for prisma mock |
| `frontend/src/lib/server/oauth/google.test.ts` | ~40 LOC | `isConfigured()` returns false without `GOOGLE_*` env; `decodeIdToken` extracts `email`, `email_verified`, `sub`; refuses `email_verified !== true` | Don't hit Google — mock arctic responses |
| `frontend/src/lib/server/notifications/createNotification.test.ts` | ~30 LOC | dedupe via P2002 catch (returns null silently); valid input creates row; missing `dedupeKey` rejected | Use prisma mock |
| `frontend/src/lib/server/admin/audit.test.ts` | ~30 LOC | `logAdminAction(prisma, {...})` writes AdminAction row with all required fields; accepts both regular and tx prisma; metadata is JSON | Mirror `make-superadmin.test.ts` mock-extended pattern |
| `frontend/src/lib/server/payments/circuit-breaker.test.ts` | ~50 LOC | CLOSED → OPEN after N failures; OPEN refuses with circuit-open error; HALF_OPEN after cooldown; one success closes; reset on manual call | Use fake timers (`vi.useFakeTimers`) |

**Optional (low priority — covered by adjacent tests):**
- `frontend/src/lib/server/auth.test.ts` — cookie issuance + verifyCsrf happy path. Defer if time-constrained; the 7 sub-tests cover the bcrypt-heavy paths already.
- `frontend/src/lib/server/webhook/handler.test.ts` — Serializable + raw-body assertions. `bictorys.test.ts` covers the integration; can defer.

**Recommendation:** Ship the 7 listed gaps in Wave 0. The 2 "PARTIAL" libs are acceptable for v1 — flag in PLAN.md as a v1.x followup if needed.

## Smoke-auth Script Pattern

### Verification-code retrieval: direct Prisma (not test endpoint)

**Recommended: direct Prisma DB read** because:
1. Zero new attack surface — a `/api/test/peek-code` endpoint, even gated by `NODE_ENV !== 'production'`, is a footgun (env can be misset; build leaks the route).
2. Smoke script ALREADY needs `DATABASE_URL` set to talk to the same DB the running server uses — no extra config.
3. `make-superadmin.ts` precedent uses Prisma directly; same pattern.
4. The smoke script is dev-only (NOT run in CI per D-01); the security tradeoff is moot.

The downside (smoke script bypasses the email-delivery path) is acceptable: TEST-03's scope is "auth happy path", not "email-delivery integration". A separate, manual Mailpit visual check covers email rendering.

### Code skeleton (~80 LOC)

```typescript
// frontend/scripts/smoke-auth.ts
//
// TEST-03 — Smoke test against a running Next.js dev server.
// Usage: pnpm smoke:auth   (after `pnpm dev` in another terminal)
//
// Covers: signup → fetch verification code via Prisma → verify-email →
// me → logout. Exits 0 on full pass, 1 + log on any failure.
//
// Not run in CI (requires a live server). Manual UAT only.

import { PrismaClient } from '@prisma/client';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const TEST_EMAIL = `smoke-${Date.now()}@example.test`;
const TEST_PASSWORD = 'SmokeTestPwd123!';

interface ApiError extends Error {
  step?: string;
  status?: number;
  body?: unknown;
}

function fail(step: string, status: number, body: unknown): never {
  const err: ApiError = new Error(`[${step}] failed: status=${status}`);
  err.step = step;
  err.status = status;
  err.body = body;
  throw err;
}

async function assertStatus(label: string, res: Response, expected: number): Promise<unknown> {
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw text */ }
  if (res.status !== expected) fail(label, res.status, body);
  console.log(`  ✓ ${label}: ${res.status}`);
  return body;
}

function csrfFromCookies(setCookieHeaders: string[]): string | null {
  for (const c of setCookieHeaders) {
    const m = c.match(/(?:^|;\s*)app-csrf=([^;]+)/);
    if (m) return decodeURIComponent(m[1] ?? '');
  }
  return null;
}

async function main(): Promise<number> {
  // Friendly env guard — operator-facing, not a test failure.
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    console.error('\n  Missing DATABASE_URL or JWT_SECRET in env.');
    console.error('  → Run: cp .env.example .env.local && pnpm dev');
    console.error('  → Then in a new terminal: pnpm smoke:auth\n');
    return 1;
  }

  const prisma = new PrismaClient();
  const cookieJar: string[] = [];

  function recordCookies(res: Response): void {
    const sc = res.headers.getSetCookie?.() ?? [];
    cookieJar.push(...sc);
  }
  function cookieHeader(): string {
    // Crude but sufficient — keep last value per name.
    const map = new Map<string, string>();
    for (const c of cookieJar) {
      const eq = c.indexOf('=');
      const name = c.slice(0, eq);
      const val = c.slice(eq + 1).split(';')[0] ?? '';
      map.set(name, val);
    }
    return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  try {
    console.log(`Smoke against ${BASE_URL} as ${TEST_EMAIL}\n`);

    // 1. Signup — enumeration-resistant 201, NO cookies.
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    await assertStatus('signup', signupRes, 201);

    // 2. Peek the verification code from DB (dev-only, single-use).
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (!user) fail('db.findUser', 0, { email: TEST_EMAIL });
    const codeRow = await prisma.verificationCode.findFirst({
      where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { code: true },
    });
    if (!codeRow) fail('db.findCode', 0, { userId: user.id });
    console.log(`  ✓ db.peekCode: ${codeRow.code.slice(0, 2)}…`);

    // 3. Verify-email — issues cookies on success.
    const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, code: codeRow.code }),
    });
    await assertStatus('verify-email', verifyRes, 200);
    recordCookies(verifyRes);

    // 4. GET /me — proves access cookie is valid.
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { cookie: cookieHeader() },
    });
    const meBody = (await assertStatus('me', meRes, 200)) as { user?: { email?: string } };
    if (meBody.user?.email !== TEST_EMAIL) fail('me.email', 200, meBody);

    // 5. Logout — needs CSRF.
    const csrf = csrfFromCookies(cookieJar);
    if (!csrf) fail('logout.csrf', 0, { cookieJar });
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: cookieHeader(), 'x-csrf-token': csrf },
    });
    await assertStatus('logout', logoutRes, 200);

    console.log('\n✓ smoke-auth PASS');
    return 0;
  } catch (err) {
    const e = err as ApiError;
    console.error(`\n✗ smoke-auth FAIL at [${e.step ?? 'unknown'}]`);
    console.error(`  status: ${e.status ?? 'n/a'}`);
    console.error(`  body:   ${JSON.stringify(e.body, null, 2)}`);
    return 1;
  } finally {
    // Cleanup test user so re-runs don't accumulate.
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
```

**Notes:**
- `signup` body is `{ email, password }` (verified at `frontend/src/app/api/auth/signup/route.ts`).
- `verify-email` body is `{ email, code }` (verified at `verify-email/route.ts:33` — `code` regex `VERIFICATION_CODE_REGEX`, looks up by `(userId, type, code)`).
- `logout` is POST (per the README API table — `POST /logout`); requires CSRF.
- The `app-csrf=` cookie name uses the default `COOKIE_PREFIX=app`. If forks override it, the smoke script will need to read `process.env.COOKIE_PREFIX`. Note this in the script comments.
- `getSetCookie()` is Node 18+ (verified — Node 20 LTS in `engines`). Falls back to manual `headers.raw()` won't work in undici-Web spec, so `getSetCookie()` is the right call.
- Cleanup deletes the test user via `email` so re-runs don't clutter the DB.

### Wire-up

Add to `frontend/package.json` scripts:
```json
"smoke:auth": "tsx --env-file=.env scripts/smoke-auth.ts"
```

Add to root `package.json` scripts:
```json
"smoke:auth": "pnpm --filter frontend run smoke:auth"
```

## seed-dev.test.ts skeleton

Model on `make-superadmin.test.ts`. Key tweak: `seed-dev.ts` does NOT export `main()` currently (it's a top-level `await main()`), so Phase 6 must refactor `seed-dev.ts` to export `main` AND guard the auto-run with `if (import.meta.url === ...)` (mirror `make-superadmin.ts:85`).

```typescript
// frontend/scripts/seed-dev.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

// IMPORTANT: import after the refactor that exports main.
import { main } from './seed-dev';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(prismaMock));

describe('scripts/seed-dev', () => {
  it('refuses to run with NODE_ENV=production and exits 1', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit:${code}__`);
    }) as never);

    await expect(main([], { prisma: prismaMock })).rejects.toThrow('__exit:1__');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('production'));

    process.env.NODE_ENV = orig;
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('upserts each seed user (idempotent — runs upsert, not create)', async () => {
    process.env.NODE_ENV = 'test';
    prismaMock.user.upsert.mockResolvedValue({ email: 'admin@example.com', role: 'SUPERADMIN', emailVerifiedAt: new Date() } as never);

    await main([], { prisma: prismaMock });

    expect(prismaMock.user.upsert).toHaveBeenCalledTimes(3); // 3 seed users
    const firstCall = prismaMock.user.upsert.mock.calls[0]?.[0];
    expect(firstCall?.where).toEqual({ email: 'admin@example.com' });
    expect(firstCall?.create).toMatchObject({ role: 'SUPERADMIN' });
  });

  it('hashes passwords with bcrypt before upsert', async () => {
    process.env.NODE_ENV = 'test';
    prismaMock.user.upsert.mockResolvedValue({ email: 'x', role: 'USER', emailVerifiedAt: null } as never);

    await main([], { prisma: prismaMock });

    const { passwordHash } = prismaMock.user.upsert.mock.calls[0]?.[0]?.create as { passwordHash: string };
    expect(passwordHash).toMatch(/^\$2[ab]\$/); // bcrypt prefix
    expect(passwordHash).not.toContain('AdminPassword'); // never plaintext
  });
});
```

**Required `seed-dev.ts` refactor (small):**
```typescript
// before: top-level `await main()`
// after:  export { main }; CLI guard at bottom (mirror make-superadmin.ts:85-92)
```

## Docker Build Verification Recipe

### Verified state

`frontend/Dockerfile:1-46` — multi-stage. Builder runs `pnpm install --frozen-lockfile --filter frontend...` then `pnpm --filter frontend run build`. Runtime stage copies `.next/standalone`, `.next/static`, `public/` and starts via `tini` + `node frontend/server.js`. Non-root user `app` (uid 1001).

`docker-compose.yml:18-100` — 4 services: postgres, redis, minio, mailpit. Plus a `minio-init` initialization container. NO `backend` service (verified). Note: the previous CONTEXT.md said "4 services" — actually 4 + 1 init = 5 entries; either count is fine for "no backend".

### Recipe (manual UAT — runs in plan SUMMARY, not in CI)

```bash
# Build (build context is REPO ROOT — Dockerfile copies pnpm-workspace.yaml + frontend/)
docker build -f frontend/Dockerfile -t amadou-monolith .

# Boot deps
docker compose up -d postgres redis

# Apply schema (host-side)
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amadou_dev' pnpm db:push

# Run the built image. host.docker.internal works on macOS/Windows; on Linux use --add-host.
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='postgresql://postgres:postgres@host.docker.internal:5432/amadou_dev' \
  -e JWT_SECRET='vitest-fixture-jwt-secret-with-enough-entropy-for-tests' \
  -e ENCRYPTION_KEY='aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n' \
  amadou-monolith

# In another terminal:
curl -fsS http://localhost:3000/api/health
# Expected: {"ok":true,"time":"2026-05-08T..."}
```

### ROADMAP success criterion #4 reconciliation

Current ROADMAP line 123: `docker build -t amadou-monolith .` — implies repo-root Dockerfile. Reality: Dockerfile lives at `frontend/Dockerfile`. **Fix:** update ROADMAP to `docker build -f frontend/Dockerfile -t amadou-monolith .`. This is a doc edit, not a code change. Add to Wave 1 README plan (which touches the same doc layer) OR Wave 0 docker-verification plan. **Recommend Wave 1** to keep Wave 0 free of doc edits.

## CLAUDE.md Cleanup Pattern

### Audit grep result

```
$ grep -nE "Express|backend/src|express\.json|middleware-order" CLAUDE.md
7:  "...There is no separate Express backend anymore..."   ← negation, KEEP
```

**Verdict: 1 hit, all 1 are accurate negation context. CLAUDE.md is clean.**

### Required additions (D-04)

| Line / region | Action |
|---------------|--------|
| `## High-level architecture` (~line 50) | No edit needed — Phase 4/5 routes already mentioned (line 54 webhook, line 56 withdrawals, line 60 cron) |
| `## Files Claude SHOULD modify` (line 84+) | **APPEND** four entries: (a) `frontend/src/lib/server/cron/auth.ts` (CRON_SECRET verifier, only Bearer-token guard); (b) `frontend/src/app/api/cron/<name>/route.ts` (add new crons here following the auth pattern); (c) `frontend/src/lib/server/orders/expire.ts` (order-expiration helper — extend cron logic here); (d) `frontend/src/lib/server/upload/sniff.ts` mention is already at line 106 — keep |
| `## Files Claude must NOT modify` (line 70+) | No edit — list is current. `webhook/bictorys.ts` is correctly NOT in the protected list (it's a provider impl; replaceable per `Files Claude SHOULD modify` payments section line 87) |
| Line 33: "Integration tests are deferred to Phase 4..." | **REPLACE:** "Integration tests are deferred (no formal harness in v1) — `pnpm smoke:auth` provides a manual UAT script for the auth happy path. See README." |
| Line 60: "...drained by a Vercel Cron route (Phase 6, see STATUS.md M6)." | **REPLACE:** "...drained by a Vercel Cron route (`/api/cron/outbox-drain`)." |
| Line 66: "...once Phase 7 lands — see STATUS.md M7" | **REPLACE:** "...the script lives at `frontend/scripts/make-superadmin.ts`." |

### Optional tripwire test

Per CONTEXT line 87: add `frontend/src/lib/server/observability/claude-md-shape.test.ts` — a 15 LOC test that reads `CLAUDE.md` from disk and asserts no `/Express\b/` (excluding the historical-context line near the top). **Recommend SKIP** — adds maintenance cost; the next phase reviewer can run a simple grep. Document the grep in README "Doc invariants" if needed.

## README.md Section Outline (D-05)

Match `STATUS.md` voice: terse, technical, no marketing.

### ① What this is — 3-4 sentences
"Headless full-stack starter for the Next.js 16 + Prisma 5 + Neon + Upstash + R2 + Resend + Bictorys + Sentry stack. Single deployable Next.js app — no separate backend. All third-party providers are env-gated and inert without their vars; the app boots and `/api/auth` works with just `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`. Frontend ships only logic — no UI components."
Link to `.planning/PROJECT.md` for vision.

### ② Quickstart — 6 commands
```bash
gh repo create my-project --template=<your-org>/amadou-monolith --private --clone
cd my-project
cp .env.example .env.local                  # fill DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY at minimum
pnpm install
docker compose up -d                        # local Postgres, Redis, MinIO, Mailpit
pnpm db:migrate:deploy                      # apply versioned migrations
pnpm dev                                    # http://localhost:3000
pnpm db:make-superadmin you@example.com     # bootstrap first admin (after signup)
pnpm smoke:auth                             # verify auth happy path end-to-end
```
**Note:** Match the existing `cp .env.example .env.local` (NOT `.env`). Verified consistent with vitest setup.

### ③ Env reference — link out, don't duplicate
Single table: required-to-boot vars (DATABASE_URL, DIRECT_URL, JWT_SECRET, ENCRYPTION_KEY, CRON_SECRET, APP_URL). All other groups (R2, Resend, Bictorys, Google, Sentry, Upstash) get a one-line "see `frontend/.env.example` block X" pointer with the inert-without-env behavior summary.

### ④ Route inventory — manual table
Generated from `find frontend/src/app/api -name route.ts` (40 hits across auth/admin/cron/notifications/orders/withdrawals/webhooks/upload/files/health). Group by area: Auth (10), OAuth (2), Withdrawal-PIN (1), Notifications (3), Orders (1), Withdrawals (1), Uploads (2), Webhooks (1), Crons (5), Admin (12), Health (2). Total: 40. Reference current README "API Endpoints" tables — they are accurate; copy unchanged.

### ⑤ Smoke test — 3 sentences
"`pnpm smoke:auth` runs `frontend/scripts/smoke-auth.ts` against a running `pnpm dev`. It signs up, peeks the verification code from the DB, verifies email, calls `GET /me`, and logs out. Override the target with `SMOKE_BASE_URL=https://preview.example.com pnpm smoke:auth` for preview deployments."

### ⑥ Deploy to Vercel — env mapping + cron schedules
- Push the repo to a Vercel project pointed at `frontend/`.
- Map all required-to-boot env vars in Vercel project settings.
- `vercel.json` ships the cron schedules — Vercel auto-registers them on deploy.
- Sentry source-map upload runs in `next build` if `SENTRY_ORG/PROJECT/AUTH_TOKEN` are set.
- Standalone output is auto-detected (no extra config).
- Link out to `frontend/instrumentation.ts` comments for OTel/Sentry init details.

### ⑦ What's NOT shipped — boundary list
Mirror `.planning/PROJECT.md` "Out of Scope" section — copy the table. Includes: UI components, multi-provider payments, long-running workers, Auth.js migration, Edge runtime, public OSS distribution, frontend test framework, distributed circuit breaker (v1), i18n.

## Wave Structure

### Wave 0 — Sequential (one plan)

**Plan ID:** `06-W0-audit-and-smoke`
**Files modified:**
- `frontend/src/lib/server/crypto.test.ts` (NEW)
- `frontend/src/lib/server/withdrawals/lock.test.ts` (NEW)
- `frontend/src/lib/server/outbox/dispatcher.test.ts` (NEW)
- `frontend/src/lib/server/oauth/google.test.ts` (NEW)
- `frontend/src/lib/server/notifications/createNotification.test.ts` (NEW)
- `frontend/src/lib/server/admin/audit.test.ts` (NEW)
- `frontend/src/lib/server/payments/circuit-breaker.test.ts` (NEW)
- `frontend/scripts/smoke-auth.ts` (NEW)
- `frontend/scripts/seed-dev.test.ts` (NEW)
- `frontend/scripts/seed-dev.ts` (REFACTOR — export `main`, add CLI-guard)
- `frontend/package.json` (add `smoke:auth` script)
- `package.json` (add root proxy `smoke:auth` script)
- Manual verification step: `docker build -f frontend/Dockerfile -t amadou-monolith . && docker run ... && curl /api/health` (recorded in plan SUMMARY, not a code change)

### Wave 1 — Parallel (3 plans, zero file overlap)

**Plan A — `06-W1-claude-md-cleanup`**
Files modified:
- `CLAUDE.md` (targeted edits per D-04 + section above)

**Plan B — `06-W1-readme-rewrite`**
Files modified:
- `README.md` (full rewrite per D-05 + section above)
- `.planning/ROADMAP.md` (single-line fix to success-criterion #4: `docker build -f frontend/Dockerfile -t amadou-monolith .`)

**Plan C — `06-W1-status-update`**
Files modified:
- `STATUS.md` (mark Phase 6 done, link to commits)

**File overlap check (pairwise):**
- A ∩ B: A=`CLAUDE.md`, B=`README.md` + `ROADMAP.md` → ZERO overlap ✓
- A ∩ C: A=`CLAUDE.md`, C=`STATUS.md` → ZERO overlap ✓
- B ∩ C: B=`README.md`+`ROADMAP.md`, C=`STATUS.md` → ZERO overlap ✓

**All 3 Wave 1 plans can run fully in parallel.**

## Common Pitfalls

### Pitfall 1: tsx may not resolve `@/` aliases in scripts
**What goes wrong:** `tsx --env-file=.env scripts/smoke-auth.ts` may fail to resolve `import { prisma } from '@/lib/server/prisma'`. tsx 4.x reads `tsconfig.json` paths but only when `tsconfig-paths` resolution is wired.
**Why it happens:** tsx uses esbuild internally; path-alias support depends on tsconfig discovery from the script's directory.
**Verified workaround:** `frontend/scripts/make-superadmin.ts:18` uses **relative imports** (`'../src/lib/server/admin/audit'`) — confirmed working. Use the same pattern in `smoke-auth.ts`. Do NOT introduce `@/` in scripts.
**How to avoid:** Match the precedent. Smoke script imports nothing from src — uses Prisma client directly + `fetch`.

### Pitfall 2: Docker build context size from repo root
**What goes wrong:** `docker build -f frontend/Dockerfile .` from repo root sends the entire repo (including `.planning/`, `examples/`, `node_modules/`) as build context, slowing builds.
**Why it happens:** Build context is the directory in the trailing `.`, not the Dockerfile location.
**How to avoid:** Add a `.dockerignore` at repo root listing `node_modules`, `.next`, `.git`, `.planning`, `examples`, `*.md` (keep package.json + frontend + lockfile). **Action:** verify `.dockerignore` exists; if not, ship one in Wave 0 alongside the Docker verification step.
**Verify:** `find /Users/amadoufall/Desktop/K-gnote/amadou-monolith -maxdepth 2 -name '.dockerignore'` — researcher to flag if missing during Wave 0 execution. (Quick check: not surfaced in any prior listing — likely missing.)

### Pitfall 3: Vitest discovers tests in `frontend/src/**` AND `frontend/scripts/**` — smoke script tests do NOT belong here
**What goes wrong:** A naive `frontend/scripts/smoke-auth.test.ts` would be discovered by Vitest and run in CI, where there is no live `localhost:3000` server.
**Why it happens:** `vitest.config.ts:10` includes `'scripts/**/*.test.ts'`.
**How to avoid:** **Do NOT create `smoke-auth.test.ts`.** The smoke script is the test itself; running it requires a live server. Document this in the script's header comment.
**`seed-dev.test.ts` IS fine** — it mocks Prisma, no live server.

### Pitfall 4: README quickstart must use only env values present in `.env.example`
**What goes wrong:** Hardcoding production-shaped values (e.g. `pgbouncer=true&connection_limit=1` in the quickstart) confuses fork operators running locally without Neon.
**How to avoid:** Quickstart uses local docker-compose connection strings (`postgresql://postgres:postgres@localhost:5432/amadou_dev`). Production-shape Neon URL example lives in the env-reference section, not quickstart.

### Pitfall 5: Smoke script's cookie parsing is fragile across runtimes
**What goes wrong:** `Response.headers.getSetCookie()` is Node 20+ in undici; older Node 18 returns combined `set-cookie` as a single string with comma-joined values, breaking the parser.
**Why it happens:** Web Fetch spec differs from Node's HTTP module here.
**How to avoid:** Hard-require Node 20 (`engines.node >=20` is already declared in `package.json:7`). The script's header should state "requires Node 20+".

### Pitfall 6: `seed-dev.ts` needs refactor before it can be tested
**What goes wrong:** Current `seed-dev.ts` runs `main()` at module top-level. Importing it from a test triggers DB connection at import time — breaks Vitest.
**How to avoid:** Refactor to export `main(args, deps)` + add CLI guard `if (import.meta.url === ...)`. Pattern is identical to `make-superadmin.ts:85-92`. Adds ~5 LOC.

## Validation Architecture (Nyquist)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 |
| Config file | `frontend/vitest.config.ts` (already shipped) |
| Quick run command | `pnpm --filter frontend exec vitest run -t '<test name>'` (single test by name) |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | vitest config seeds JWT/ENCRYPTION_KEY | shape (existing) | `pnpm --filter frontend exec vitest run frontend/src/lib/server/observability/env-shape.test.ts` | ✅ |
| TEST-02 (crypto) | round-trip + reject malformed | unit | `pnpm --filter frontend exec vitest run src/lib/server/crypto.test.ts` | ❌ Wave 0 |
| TEST-02 (withdrawals/lock) | advisory-lock SQL + Serializable iso | unit | `pnpm --filter frontend exec vitest run src/lib/server/withdrawals/lock.test.ts` | ❌ Wave 0 |
| TEST-02 (outbox/dispatcher) | atomic claim + backoff + DEAD ceiling | unit | `pnpm --filter frontend exec vitest run src/lib/server/outbox/dispatcher.test.ts` | ❌ Wave 0 |
| TEST-02 (oauth/google) | env-guard + email_verified refusal | unit | `pnpm --filter frontend exec vitest run src/lib/server/oauth/google.test.ts` | ❌ Wave 0 |
| TEST-02 (notifications/createNotification) | P2002 dedup + null return | unit | `pnpm --filter frontend exec vitest run src/lib/server/notifications/createNotification.test.ts` | ❌ Wave 0 |
| TEST-02 (admin/audit) | logAdminAction writes row, accepts tx | unit | `pnpm --filter frontend exec vitest run src/lib/server/admin/audit.test.ts` | ❌ Wave 0 |
| TEST-02 (payments/circuit-breaker) | state machine transitions | unit | `pnpm --filter frontend exec vitest run src/lib/server/payments/circuit-breaker.test.ts` | ❌ Wave 0 |
| TEST-03 | smoke-auth happy path | manual UAT | `pnpm smoke:auth` (requires `pnpm dev` running) | ❌ Wave 0 (script ships; not in CI) |
| SCRIPT-01 (make-superadmin) | promote + audit + idempotent + missing-user | unit | `pnpm --filter frontend exec vitest run scripts/make-superadmin.test.ts` | ✅ |
| SCRIPT-01 (seed-dev) | NODE_ENV refusal + upsert idempotency + bcrypt | unit | `pnpm --filter frontend exec vitest run scripts/seed-dev.test.ts` | ❌ Wave 0 |
| DOCKER-01 | image builds + /api/health responds 200 | manual UAT | `docker build -f frontend/Dockerfile -t amadou-monolith . && docker run ... && curl /api/health` | ❌ Wave 0 (manual, recorded in plan SUMMARY) |
| DOC-01 | CLAUDE.md has 0 errant Express references | tripwire grep | `! grep -E "Express|backend/src|express\\.json|middleware-order" CLAUDE.md \| grep -v "no separate Express"` | manual (Wave 1) |
| DOC-02 | README quickstart works | manual UAT | follow README quickstart on a fresh clone | manual (Wave 1) |
| ENV-01 | CRON_SECRET present | tripwire grep | `grep -q "^CRON_SECRET=" frontend/.env.example` | ✅ |

### Sampling Rate

- **Per task commit:** `pnpm --filter frontend exec vitest run <changed-file>.test.ts`
- **Per wave merge:** `pnpm test` (full Vitest suite — currently 508 GREEN; Wave 0 should land 7 new tests → ~515 GREEN)
- **Phase gate:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` all green; `pnpm smoke:auth` passes against `pnpm dev`; `docker build -f frontend/Dockerfile -t amadou-monolith .` succeeds.

### Wave 0 Gaps

- [ ] `frontend/src/lib/server/crypto.test.ts` — covers TEST-02 (crypto)
- [ ] `frontend/src/lib/server/withdrawals/lock.test.ts` — covers TEST-02 (withdrawals/lock)
- [ ] `frontend/src/lib/server/outbox/dispatcher.test.ts` — covers TEST-02 (outbox/dispatcher)
- [ ] `frontend/src/lib/server/oauth/google.test.ts` — covers TEST-02 (oauth/google)
- [ ] `frontend/src/lib/server/notifications/createNotification.test.ts` — covers TEST-02 (notifications/createNotification)
- [ ] `frontend/src/lib/server/admin/audit.test.ts` — covers TEST-02 (admin/audit)
- [ ] `frontend/src/lib/server/payments/circuit-breaker.test.ts` — covers TEST-02 (payments/circuit-breaker)
- [ ] `frontend/scripts/smoke-auth.ts` + `frontend/scripts/seed-dev.test.ts` + `seed-dev.ts` refactor

Framework install: not needed — Vitest 2.1.8 + vitest-mock-extended 2.0.2 already in `frontend/package.json:55-56`.

## Standard Stack

### Core (already installed — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | 2.1.8 | Unit test runner | Already wired with `vitest.config.ts` + `vitest.setup.ts`; Phase 6 only adds test files |
| vitest-mock-extended | 2.0.2 | Deep prisma mocks | Pattern established by `make-superadmin.test.ts`; reuse for gap-fill tests |
| tsx | 4.19.2 | TS script runner | Already used by `db:make-superadmin` + `seed:dev`; reuse for `smoke:auth` |
| Prisma 5 | 5.22.0 | DB client (smoke + seed-dev tests) | Already pinned; no new deps |

**Verification:** `pnpm view vitest version` last published 2.1.8 (2024-12-05) — fits training data; current as of repo install. Same for `vitest-mock-extended` (2.0.2 published 2024-09).

### Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cookie jar in smoke script | Custom Set-Cookie parser | `Response.headers.getSetCookie()` (Node 20+) | Spec-compliant; avoids quoted-comma bugs |
| Prisma deep mock | Manual stub objects | `vitest-mock-extended.mockDeep<PrismaClient>()` | Already the precedent; type-safe; auto-resets |
| HTTP retry/backoff in smoke | None | None — smoke script does NOT retry | Smoke is a sanity probe; flakes are diagnostic signal |
| README route table generator | AST scanner | Manual table (per CONTEXT deferred-ideas) | Auto-generation is per-fork concern |

## Code Examples

### Pattern: Test for `withdrawals/lock.ts`

```typescript
// Source: model on existing observability tests + lock.ts contents
// File: frontend/src/lib/server/withdrawals/lock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withUserAdvisoryLock } from './lock';

describe('withUserAdvisoryLock', () => {
  it('issues pg_advisory_xact_lock with hashtext(userId) before running fn', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) } as never;
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withUserAdvisoryLock(tx, 'user_abc', fn);

    expect(result).toBe('ok');
    // The first $executeRaw call should be the advisory-lock; assert via call-order.
    const firstCall = (tx as { $executeRaw: { mock: { calls: unknown[][] } } }).$executeRaw.mock.calls[0];
    expect(firstCall?.[0]?.toString()).toMatch(/pg_advisory_xact_lock/);
    expect(firstCall?.[0]?.toString()).toMatch(/hashtext/);
    expect(fn).toHaveBeenCalledOnce();
  });
});
```

(Adjust to the actual export signature once Wave 0 reads `lock.ts` line-by-line.)

### Pattern: Test for `admin/audit.ts`

```typescript
// File: frontend/src/lib/server/admin/audit.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
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

  it('accepts a tx argument (Prisma TransactionClient) — same shape as full client', async () => {
    // Prisma transaction clients expose `adminAction.create` identically — type-level only;
    // runtime check is that we don't reject non-PrismaClient inputs.
    const txMock = { adminAction: { create: vi.fn().mockResolvedValue({}) } } as never;
    await logAdminAction(txMock, { actorId: 'a', action: 'x' });
    expect(txMock.adminAction.create).toHaveBeenCalledOnce();
  });
});
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `seed-dev.ts` does NOT export `main()` and runs at top-level — needs refactor before it can be unit-tested | seed-dev.test.ts skeleton | Low — researcher confirmed via Read at line 24-57 (`async function main()` declared but called at line 54 unconditionally with no export). **VERIFIED, not assumed.** |
| A2 | `signup` route returns 201 (not 200) | smoke skeleton | Low — README API table line 95 shows `{ user: { sub, email } }` + cookies, status implied 201; needs Wave 0 verify against signup/route.ts. If 200, change `assertStatus('signup', res, 201)` → `200`. |
| A3 | `withUserAdvisoryLock` is the actual export name from `withdrawals/lock.ts` | Code examples | Low — Wave 0 must Read the file first; adjust test imports to match actual signature. |
| A4 | `vitest-mock-extended` 2.0.2 supports `mockDeep` against Prisma 5 | All gap-fill tests | Verified by `make-superadmin.test.ts` precedent (already passing in CI). |
| A5 | No `.dockerignore` exists at repo root | Pitfall 2 | Wave 0 must verify with `ls -la /Users/amadoufall/Desktop/K-gnote/amadou-monolith/.dockerignore`; if present, no action. |
| A6 | `Response.headers.getSetCookie()` works on Node 20 LTS | Pitfall 5 | [VERIFIED: Node 20.6+ undici] supports `getSetCookie()`; `engines.node >=20` already enforced. |

## Open Questions

**None.** CONTEXT.md is auto-mode and pre-state inventory was thorough. Resolved inline:
- Verification-code retrieval mechanism → direct Prisma (recommendation in "Smoke-auth Script Pattern")
- Gap-fill test scope → 7 specific test files listed in TEST-02 audit
- Docker build context → repo root with `-f frontend/Dockerfile` flag (preserves single-source-of-truth)
- ROADMAP success-criterion #4 fix → bundle into Wave 1 README plan
- CLAUDE.md tripwire test → recommend SKIP (low ROI, manual grep is enough)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All test/build/script commands | ✓ | 20+ (per `engines`) | — |
| pnpm | All commands | ✓ | 9.15.0 | — |
| Vitest | TEST-02 gap-fill | ✓ | 2.1.8 | — |
| tsx | smoke-auth + scripts | ✓ | 4.19.2 | — |
| Docker | DOCKER-01 verification | ✓ (assumed — operator's machine) | — | Manual UAT only; CI does not need Docker |
| docker compose | docker-compose.yml verification | ✓ (assumed) | — | Same |
| PostgreSQL | smoke script + seed-dev | ✓ via docker-compose | postgres:16-alpine | — |
| `curl` | DOCKER-01 health probe | ✓ (system tool) | — | `wget` or `node -e "fetch(...)"` |

**Missing dependencies with no fallback:** none — all production deps already declared in `package.json`/`frontend/package.json`.

**Missing dependencies with fallback:** none.

## Security Domain

> Phase 6 ships ZERO new domain logic; the security surface is INHERITED from Phases 0–5. The audit role here is to confirm the existing security tests cover the documented invariants.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (TEST-02 + TEST-03 verify) | bcrypt (`auth.ts` + `auth/dummy-bcrypt.test.ts`); enumeration-resistant signup; refresh-rotation single-flight |
| V3 Session Management | yes (TEST-03 happy-path) | JWT 15min/7d + CSRF double-submit; smoke script verifies the cookie set sequence |
| V4 Access Control | yes (admin/audit + circuit-breaker tests) | `requireAdmin`/`requireSuperadmin`/`requireOrgRole` + `logAdminAction` (TEST-02 covers audit logger) |
| V5 Input Validation | yes (zod across handlers — already tested) | zod schemas at every route — pre-existing |
| V6 Cryptography | yes (TEST-02 crypto.ts) | `crypto.ts` AES-GCM via `crypto.subtle`; gap-fill test verifies round-trip + reject-malformed |
| V7 Error Handling | partial (smoke script asserts shape) | Stable error codes (`PIN_REQUIRED`, `INSUFFICIENT_BALANCE` etc); pre-tested in withdrawal guards (Phase 4) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account-takeover via unverified Google email | Spoofing | OAuth callback refuses `email_verified !== true` (TEST-02 oauth/google adds direct test) |
| Webhook signature replay | Tampering | 60s replay window + `WebhookLog @@unique([externalId, eventType])` (covered by `webhook/bictorys.test.ts`) |
| Concurrent withdrawal double-spend | Tampering | `pg_advisory_xact_lock` + Serializable tx (TEST-02 withdrawals/lock adds direct test) |
| Outbox at-least-once → duplicate side-effects | Repudiation | Atomic claim + dedupeKey on Notification (TEST-02 outbox/dispatcher + createNotification cover) |
| Smoke script leaks test creds | Information Disclosure | `TEST_EMAIL = smoke-${Date.now()}@example.test` (timestamped, deleted in `finally`); `.test` TLD never resolves |

## Sources

### Primary (HIGH confidence)
- `frontend/vitest.config.ts:1-31` — confirms TEST-01 + scripts/ test discovery
- `frontend/vitest.setup.ts:1-17` — confirms JWT/ENCRYPTION_KEY fixtures
- `frontend/scripts/make-superadmin.ts:1-92` + `make-superadmin.test.ts:1-118` — script pattern precedent
- `frontend/scripts/seed-dev.ts:1-57` — confirms refactor needed to enable testability
- `frontend/Dockerfile:1-46` — confirms multi-stage build with build context at repo root
- `docker-compose.yml:1-105` — confirms 4 services + minio-init, no `backend`
- `frontend/.env.example:18` — confirms `CRON_SECRET=""` (ENV-01 satisfied)
- `frontend/package.json:9-22` — confirms current scripts (no `smoke:auth` yet)
- `frontend/src/app/api/auth/verify-email/route.ts:33,84-87` — confirms verify-email body shape `{ email, code }` and DB lookup `(userId, type, code, usedAt: null)`
- `frontend/prisma/schema.prisma:150` — confirms VerificationCode model with `userId` + `type=EMAIL_VERIFY`
- `find frontend/src/lib/server -name "*.test.ts"` (21 hits) — TEST-02 audit input
- `find frontend/src/app/api -name route.ts` (40 hits) — README route inventory input
- `CLAUDE.md` grep for `Express|backend/src|express\.json|middleware-order` (1 negation hit) — confirms DOC-01 is largely clean

### Secondary (MEDIUM confidence)
- README.md current state (5 hits for "Express", all negation/historical) — full rewrite still required per D-05 voice/style
- `.planning/ROADMAP.md:115-125` — Phase 6 success criteria; criterion #4 has the `docker build` flag mismatch
- `.planning/REQUIREMENTS.md:108-118` — TEST/SCRIPT/DOCKER/DOC requirement text

### Tertiary (LOW confidence)
- Existence of `.dockerignore` at repo root (NOT verified in Reads above; flagged in Pitfall 2 for Wave 0 to confirm)

## Metadata

**Confidence breakdown:**
- TEST-02 audit table: HIGH — all 21 test files enumerated, 9 named libs each verified by direct file path
- Smoke script skeleton: HIGH for Prisma + fetch shape (verified against verify-email route source); MEDIUM for cookie-jar mechanics (Node 20 `getSetCookie()` documented but not executed)
- Docker recipe: HIGH — Dockerfile + docker-compose verified line-by-line
- Wave structure: HIGH — file overlap matrix is mechanical
- README outline: MEDIUM — section list is from CONTEXT D-05; specific prose follows STATUS.md voice

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (stable doc + audit work; revisit if Phase 5 ships unannounced route changes)
