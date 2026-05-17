// AUTH-09 — change-password route tests.
// Covers: happy path (token + cookies bumped), CSRF reject, requireAuth reject,
// wrong currentPassword, password policy gates (banned/short/HIBP), Zod
// validation failure, runtime export shape.
//
// Mocking strategy (D-25 + Pitfall 11): vi.mock calls live at module level so
// they auto-hoist above the route import. prismaMock + mockNextCookies arrive
// from the shared test-utils so future route tests stay consistent.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { prismaMock } from '@/test-utils/prisma-mock';

// next/headers cookies() must be mocked BEFORE the route module loads.
// vi.mock is auto-hoisted to the top of the file ONLY when the call sits at
// module level (Pitfall 11). The mock-cookies test-util wraps the call in a
// function body, which would not hoist; inline here for the auth-cookie path.
// __cookieStore is a Map<string, MockCookieEntry> shared by getter/setter so
// tests can assert what the route set.
interface MockEntry {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}
const __cookieStore = new Map<string, MockEntry>();
const cookieMockStore = {
  get(name: string) {
    const e = __cookieStore.get(name);
    return e ? { name: e.name, value: e.value } : undefined;
  },
  set(name: string, value: string, options?: Record<string, unknown>) {
    __cookieStore.set(name, { name, value, ...(options ? { options } : {}) });
  },
  delete(name: string) {
    __cookieStore.delete(name);
  },
  has(name: string) {
    return __cookieStore.has(name);
  },
  getAll() {
    return [...__cookieStore.values()].map((e) => ({ name: e.name, value: e.value }));
  },
};
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieMockStore),
}));

// Mock banned/HIBP modules — toggled per test.
vi.mock('@/lib/server/auth/banned-passwords', () => ({
  isBanned: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/server/auth/hibp', () => ({
  isPwned: vi.fn().mockResolvedValue(false),
}));

// Mock lockout primitives so tests can drive isLockedOut / recordFailure
// directly instead of relying on the in-memory-Map fallback side-effects
// across tests (M1 audit fix — direct coverage for the new lockout branch).
vi.mock('@/lib/server/auth/lockout', () => ({
  isLockedOut: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue({ count: 1, locked: false }),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

// Now safe to import what we need.
import { isBanned } from '@/lib/server/auth/banned-passwords';
import { isPwned } from '@/lib/server/auth/hibp';
import { isLockedOut, recordFailure } from '@/lib/server/auth/lockout';
import {
  COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  createAccessToken,
  hashPassword,
} from '@/lib/server/auth';
import { PUT } from './route';

// ---------- helpers ----------

const CSRF_TOKEN = 'csrf-token-fixture-deadbeef';

interface BuildOpts {
  body: unknown;
  /** Sets the `x-csrf-token` header. Pass null/undefined to omit. */
  csrf?: string | null;
  /**
   * Sets the CSRF cookie on the request `cookie` header (verifyCsrf reads
   * via NextRequest.cookies, populated from the HTTP cookie header).
   */
  csrfCookieValue?: string | null;
}

function buildRequest(opts: BuildOpts): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.csrf !== null && opts.csrf !== undefined) {
    headers.set('x-csrf-token', opts.csrf);
  }
  if (opts.csrfCookieValue !== null && opts.csrfCookieValue !== undefined) {
    headers.set('cookie', `${CSRF_COOKIE_NAME}=${opts.csrfCookieValue}`);
  }
  return new NextRequest('http://localhost/api/auth/change-password', {
    method: 'PUT',
    headers,
    body: JSON.stringify(opts.body),
  });
}

/**
 * Seed the mocked next/headers cookie store with the access token so
 * requireAuth() finds it. The route reads cookies via next/headers cookies(),
 * not via NextRequest.cookies, so the HTTP cookie header is irrelevant here.
 */
function seedAccessCookie(token: string): void {
  cookieMockStore.set(COOKIE_NAME, token);
}

let validToken: string;
let dbHash: string;

const isBannedMock = vi.mocked(isBanned);
const isPwnedMock = vi.mocked(isPwned);
const isLockedOutMock = vi.mocked(isLockedOut);
const recordFailureMock = vi.mocked(recordFailure);

beforeEach(async () => {
  __cookieStore.clear();
  isLockedOutMock.mockReset().mockResolvedValue(false);
  recordFailureMock.mockReset().mockResolvedValue({ count: 1, locked: false });
  validToken = await createAccessToken({
    sub: 'user_1',
    email: 'user@example.com',
    tokenVersion: 0,
  });
  dbHash = await hashPassword('Current-Pass-Old-2026');
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user_1',
    email: 'user@example.com',
    passwordHash: dbHash,
    tokenVersion: 0,
  } as unknown as never);
  prismaMock.user.update.mockResolvedValue({
    id: 'user_1',
    email: 'user@example.com',
    tokenVersion: 1,
  } as unknown as never);

  isBannedMock.mockReturnValue(false);
  isPwnedMock.mockResolvedValue(false);
  delete process.env.PASSWORD_HIBP_CHECK;
  delete process.env.AUTH_PASSWORD_MIN_LENGTH;
});

// ---------- tests ----------

describe('PUT /api/auth/change-password (AUTH-09)', () => {
  it('Test 1 — happy path: hashes new password, bumps tokenVersion, sets new cookies', async () => {
    await seedAccessCookie(validToken);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });

    // user.update called with passwordHash + tokenVersion increment
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.user.update.mock.calls[0]![0];
    expect(updateArg).toMatchObject({
      where: { id: 'user_1' },
      data: {
        passwordHash: expect.any(String),
        tokenVersion: { increment: 1 },
      },
    });

    // 3 fresh cookies set after success (access + refresh + csrf)
    expect(__cookieStore.has(COOKIE_NAME)).toBe(true);
    expect(__cookieStore.has(REFRESH_COOKIE_NAME)).toBe(true);
    expect(__cookieStore.has(CSRF_COOKIE_NAME)).toBe(true);

    // The new access cookie is non-empty AND distinct from the seeded one
    // (proves the route minted a new token with the bumped tokenVersion).
    const newAccess = __cookieStore.get(COOKIE_NAME);
    expect(newAccess?.value).toBeTruthy();
    expect(newAccess?.value).not.toBe('');
    expect(newAccess?.value).not.toBe(validToken);
  });

  it('Test 2 — missing CSRF header returns 403', async () => {
    await seedAccessCookie(validToken);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: null,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 3 — missing access cookie returns 401', async () => {
    // intentionally do NOT call seedAccessCookie
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(401);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 4 — wrong currentPassword returns INVALID_CREDENTIALS (no update)', async () => {
    await seedAccessCookie(validToken);
    const req = buildRequest({
      body: {
        currentPassword: 'totally-wrong-password',
        newPassword: 'Brand-New-Pass-2026',
      },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'INVALID_CREDENTIALS' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    // M1 audit fix — recordFailure must increment the shared lockout counter
    // so a captured session can't brute-force currentPassword indefinitely.
    expect(recordFailureMock).toHaveBeenCalledWith('user@example.com');
  });

  it('Test 4a — isLockedOut=true at entry returns 423 LOCKED_OUT without bcrypt (M1)', async () => {
    isLockedOutMock.mockResolvedValueOnce(true);
    await seedAccessCookie(validToken);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'LOCKED_OUT' });
    // The lockout short-circuits BEFORE bcrypt + DB write. requireAuth's own
    // tokenVersion lookup still runs (1 findUnique) — that's by design.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  it('Test 4b — recordFailure returns locked=true → 423 LOCKED_OUT (threshold-breach attempt, M1)', async () => {
    // This is the attempt that flips the lockout flag: bcrypt runs (returns
    // false), recordFailure increments to count===threshold and returns
    // { locked: true }. Mirrors login's Pattern 9 step 6 lockout flip.
    recordFailureMock.mockResolvedValueOnce({ count: 5, locked: true });
    await seedAccessCookie(validToken);
    const req = buildRequest({
      body: {
        currentPassword: 'totally-wrong-password',
        newPassword: 'Brand-New-Pass-2026',
      },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'LOCKED_OUT' });
    expect(recordFailureMock).toHaveBeenCalledWith('user@example.com');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 5 — banned newPassword returns PASSWORD_BANNED', async () => {
    await seedAccessCookie(validToken);
    isBannedMock.mockReturnValue(true);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'password123' },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'PASSWORD_BANNED' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 6 — short newPassword returns PASSWORD_TOO_SHORT', async () => {
    await seedAccessCookie(validToken);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'short1' },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'PASSWORD_TOO_SHORT' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 7 — HIBP-pwned newPassword returns PASSWORD_PWNED when env enabled', async () => {
    await seedAccessCookie(validToken);
    process.env.PASSWORD_HIBP_CHECK = '1';
    isPwnedMock.mockResolvedValue(true);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'PASSWORD_PWNED' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 8 — missing newPassword returns VALIDATION_FAILED', async () => {
    await seedAccessCookie(validToken);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026' },
      csrf: CSRF_TOKEN,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'VALIDATION_FAILED' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("Test 9 — route file exports runtime='nodejs' and PUT handler", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'route.ts'), 'utf8');
    expect(src).toMatch(/runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toMatch(/export\s+async\s+function\s+PUT/);
  });
});
