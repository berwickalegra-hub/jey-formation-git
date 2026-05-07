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
import type { NextRequest } from 'next/server';

import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';

// Mock cookies BEFORE importing the route or anything that depends on
// next/headers. Hoisted by Vitest.
mockNextCookies();

// Mock banned/HIBP modules — toggled per test.
vi.mock('@/lib/server/auth/banned-passwords', () => ({
  isBanned: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/server/auth/hibp', () => ({
  isPwned: vi.fn().mockResolvedValue(false),
}));

// Now safe to import what we need.
import { isBanned } from '@/lib/server/auth/banned-passwords';
import { isPwned } from '@/lib/server/auth/hibp';
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
const COOKIE_HEADER = `${COOKIE_NAME}=__set_in_beforeEach__; ${CSRF_COOKIE_NAME}=${CSRF_TOKEN}`;

interface BuildOpts {
  body: unknown;
  csrf?: string | null;
  cookieToken?: string | null;
  csrfCookieValue?: string | null;
}

function buildRequest(opts: BuildOpts): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.csrf !== null && opts.csrf !== undefined) {
    headers.set('x-csrf-token', opts.csrf);
  }
  // Build cookie header from explicit pieces (allows omitting either piece).
  const cookieParts: string[] = [];
  if (opts.cookieToken !== null && opts.cookieToken !== undefined) {
    cookieParts.push(`${COOKIE_NAME}=${opts.cookieToken}`);
  }
  if (opts.csrfCookieValue !== null && opts.csrfCookieValue !== undefined) {
    cookieParts.push(`${CSRF_COOKIE_NAME}=${opts.csrfCookieValue}`);
  }
  if (cookieParts.length > 0) headers.set('cookie', cookieParts.join('; '));

  // NextRequest accepts a standard Request; constructing via global Request
  // ensures both NextRequest and the underlying req.cookies parser work.
  const req = new Request('http://localhost/api/auth/change-password', {
    method: 'PUT',
    headers,
    body: JSON.stringify(opts.body),
  });
  // Cast to NextRequest. The route only relies on `headers`, `cookies`, `json()`,
  // `method` — all surfaced by the standard Request that NextRequest extends.
  return req as unknown as NextRequest;
}

let validToken: string;
let dbHash: string;

// Read configured banned/HIBP mocks for per-test override.
const isBannedMock = vi.mocked(isBanned);
const isPwnedMock = vi.mocked(isPwned);

beforeEach(async () => {
  __cookieStore.clear();
  // Token reflects DB tokenVersion=0 so requireAuth's DB-check passes.
  validToken = await createAccessToken({
    sub: 'user_1',
    email: 'user@example.com',
    tokenVersion: 0,
  });
  dbHash = await hashPassword('Current-Pass-Old-2026');
  // Default user lookup returns a verified user with passwordHash.
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user_1',
    email: 'user@example.com',
    passwordHash: dbHash,
    tokenVersion: 0,
  } as unknown as never);
  // Default update returns same id with bumped tokenVersion.
  prismaMock.user.update.mockResolvedValue({
    id: 'user_1',
    email: 'user@example.com',
    tokenVersion: 1,
  } as unknown as never);

  isBannedMock.mockReturnValue(false);
  isPwnedMock.mockResolvedValue(false);
  // Reset env that affects HIBP gate.
  delete process.env.PASSWORD_HIBP_CHECK;
  delete process.env.AUTH_PASSWORD_MIN_LENGTH;
});

// ---------- tests ----------

describe('PUT /api/auth/change-password (AUTH-09)', () => {
  it('Test 1 — happy path: hashes new password, bumps tokenVersion, sets new cookies', async () => {
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: CSRF_TOKEN,
      cookieToken: validToken,
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

    // 3 new cookies set after success
    expect(__cookieStore.has(COOKIE_NAME)).toBe(true);
    expect(__cookieStore.has(REFRESH_COOKIE_NAME)).toBe(true);
    expect(__cookieStore.has(CSRF_COOKIE_NAME)).toBe(true);

    // The new access cookie is NOT empty (current browser stays logged in).
    const newAccess = __cookieStore.get(COOKIE_NAME);
    expect(newAccess?.value).toBeTruthy();
    expect(newAccess?.value).not.toBe('');
  });

  it('Test 2 — missing CSRF header returns 403', async () => {
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: null,
      cookieToken: validToken,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 3 — missing access cookie returns 401', async () => {
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: CSRF_TOKEN,
      cookieToken: null,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(401);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 4 — wrong currentPassword returns INVALID_CREDENTIALS (no update)', async () => {
    const req = buildRequest({
      body: {
        currentPassword: 'totally-wrong-password',
        newPassword: 'Brand-New-Pass-2026',
      },
      csrf: CSRF_TOKEN,
      cookieToken: validToken,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'INVALID_CREDENTIALS' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 5 — banned newPassword returns PASSWORD_BANNED', async () => {
    isBannedMock.mockReturnValue(true);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'password123' },
      csrf: CSRF_TOKEN,
      cookieToken: validToken,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'PASSWORD_BANNED' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 6 — short newPassword returns PASSWORD_TOO_SHORT', async () => {
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'short1' },
      csrf: CSRF_TOKEN,
      cookieToken: validToken,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'PASSWORD_TOO_SHORT' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 7 — HIBP-pwned newPassword returns PASSWORD_PWNED when env enabled', async () => {
    process.env.PASSWORD_HIBP_CHECK = '1';
    isPwnedMock.mockResolvedValue(true);
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026', newPassword: 'Brand-New-Pass-2026' },
      csrf: CSRF_TOKEN,
      cookieToken: validToken,
      csrfCookieValue: CSRF_TOKEN,
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'PASSWORD_PWNED' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Test 8 — missing newPassword returns VALIDATION_FAILED', async () => {
    const req = buildRequest({
      body: { currentPassword: 'Current-Pass-Old-2026' },
      csrf: CSRF_TOKEN,
      cookieToken: validToken,
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
