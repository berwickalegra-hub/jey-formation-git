// AUTH-03 — POST /api/auth/verify-email tests.
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

// Cookies mock MUST be installed at module level so vi.mock auto-hoists.
mockNextCookies();

import { POST } from './route';

function makeReq(body: unknown): NextRequest {
  return body === undefined
    ? new NextRequest('http://test/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    : new NextRequest('http://test/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
}

const VALID_CODE = 'ABCD2345'; // 8-char Crockford alphabet

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
});

describe('POST /api/auth/verify-email', () => {
  it('happy path: marks code usedAt, sets emailVerifiedAt, issues 3 cookies', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);
    prismaMock.verificationCode.findFirst.mockResolvedValue({
      id: 'vc1',
      code: VALID_CODE,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    // WR-05 — updateMany now consumes the code; it must report count >= 1
    // for the happy path.
    prismaMock.verificationCode.updateMany.mockResolvedValue({ count: 1 } as never);

    const res = await POST(makeReq({ email: 'a@b.com', code: VALID_CODE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user).toEqual({ sub: 'u1', email: 'a@b.com' });

    expect(prismaMock.verificationCode.updateMany).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.verificationCode.updateMany.mock.calls[0]?.[0];
    expect(updateArg?.where?.usedAt).toBeNull();
    expect(updateArg?.data?.usedAt).toBeInstanceOf(Date);

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const userUpdateArg = prismaMock.user.update.mock.calls[0]?.[0];
    expect(userUpdateArg?.data?.emailVerifiedAt).toBeInstanceOf(Date);

    // 3 cookies: app-token (path /), app-refresh (path /api/auth), app-csrf (path /).
    expect(__cookieStore.has('app-token')).toBe(true);
    expect(__cookieStore.has('app-refresh')).toBe(true);
    expect(__cookieStore.has('app-csrf')).toBe(true);
    expect(__cookieStore.get('app-refresh')?.options?.path).toBe('/api/auth');
  });

  it('WR-05 — race: when updateMany returns count=0, surfaces VERIFICATION_CODE_INVALID and skips user.update', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);
    prismaMock.verificationCode.findFirst.mockResolvedValue({
      id: 'vc1',
      code: VALID_CODE,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    // Simulate the race: another concurrent request consumed the code first.
    prismaMock.verificationCode.updateMany.mockResolvedValue({ count: 0 } as never);

    const res = await POST(makeReq({ email: 'a@b.com', code: VALID_CODE }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VERIFICATION_CODE_INVALID');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(__cookieStore.size()).toBe(0);
  });

  it('returns VERIFICATION_CODE_INVALID when no matching code exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);
    prismaMock.verificationCode.findFirst.mockResolvedValue(null);

    const res = await POST(makeReq({ email: 'a@b.com', code: VALID_CODE }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VERIFICATION_CODE_INVALID');
    expect(__cookieStore.size()).toBe(0);
  });

  it('returns VERIFICATION_CODE_EXPIRED when expiresAt < now', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);
    prismaMock.verificationCode.findFirst.mockResolvedValue({
      id: 'vc1',
      code: VALID_CODE,
      expiresAt: new Date(Date.now() - 1_000),
    } as never);

    const res = await POST(makeReq({ email: 'a@b.com', code: VALID_CODE }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VERIFICATION_CODE_EXPIRED');
    expect(__cookieStore.size()).toBe(0);
  });

  it('treats already-used codes as VERIFICATION_CODE_INVALID (filter by usedAt:null)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);
    // Used codes are filtered out by the `where: { usedAt: null }` clause —
    // findFirst returns null, mirroring the "no code" case.
    prismaMock.verificationCode.findFirst.mockResolvedValue(null);

    const res = await POST(makeReq({ email: 'a@b.com', code: VALID_CODE }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VERIFICATION_CODE_INVALID');
  });

  it('returns VALIDATION_FAILED on malformed code', async () => {
    const res = await POST(makeReq({ email: 'a@b.com', code: 'lowercase' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 429 TOO_MANY_VERIFY_ATTEMPTS after exceeding the per-email limit', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const calls = await Promise.all(
      Array.from({ length: 6 }, () => POST(makeReq({ email: 'rl@example.com', code: VALID_CODE }))),
    );
    const limited = calls.find((r) => r.status === 429)!;
    expect(limited).toBeTruthy();
    const body = await limited.json();
    expect(body.error).toBe('TOO_MANY_VERIFY_ATTEMPTS');
  });

  it("source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
