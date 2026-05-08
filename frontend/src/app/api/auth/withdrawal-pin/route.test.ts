// PIN-01 — POST (set/change) + DELETE on /api/auth/withdrawal-pin tests.
//
// Covers VALIDATION.md tasks 02-03-01..06 plus CSRF + auth gates and the
// Pitfall-7 lockout-namespace assertion (every isLockedOut/recordFailure/
// recordSuccess call uses the literal `pin:` prefix, never the email).
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Cookies mock MUST be installed at module level so vi.mock auto-hoists.
mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/auth/pin', () => ({
  hashPin: vi.fn(),
  verifyPin: vi.fn(),
  alwaysCompareDummy: vi.fn(),
  PIN_BCRYPT_COST: 12,
}));
vi.mock('@/lib/server/auth/lockout', () => ({
  isLockedOut: vi.fn(),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { hashPin, verifyPin, alwaysCompareDummy } from '@/lib/server/auth/pin';
import { isLockedOut, recordFailure, recordSuccess } from '@/lib/server/auth/lockout';
import { POST, DELETE } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockHashPin = vi.mocked(hashPin);
const mockVerifyPin = vi.mocked(verifyPin);
const mockAlwaysCompareDummy = vi.mocked(alwaysCompareDummy);
const mockIsLockedOut = vi.mocked(isLockedOut);
const mockRecordFailure = vi.mocked(recordFailure);
const mockRecordSuccess = vi.mocked(recordSuccess);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAuth.mockResolvedValue(authedCtx);
  // Default lockout primitives — never locked, never breach threshold.
  mockIsLockedOut.mockResolvedValue(false);
  mockRecordFailure.mockResolvedValue({ count: 1, locked: false });
  mockRecordSuccess.mockResolvedValue(undefined);
  // Default pin helpers
  mockHashPin.mockResolvedValue('hashed-pin');
  mockVerifyPin.mockResolvedValue(true);
  mockAlwaysCompareDummy.mockResolvedValue(false);
});

interface ReqOpts {
  csrf?: boolean;
}

function jsonRequest(
  method: 'POST' | 'DELETE',
  body: unknown,
  opts: ReqOpts = { csrf: true },
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.csrf !== false) {
    headers.set('x-csrf-token', 'csrf-token');
    headers.set('cookie', 'app-csrf=csrf-token');
  }
  const init: { method: string; headers: Headers; body?: string } = {
    method,
    headers,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('https://app.example.test/api/auth/withdrawal-pin', init);
}

describe('POST /api/auth/withdrawal-pin', () => {
  it('02-03-01 SET: stores hash when withdrawalPinHash is null', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ withdrawalPinHash: null } as never);
    prismaMock.user.update.mockResolvedValue({} as never);

    const res = await POST(jsonRequest('POST', { newPin: '1234' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(mockHashPin).toHaveBeenCalledTimes(1);
    expect(mockHashPin).toHaveBeenCalledWith('1234');

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.user.update.mock.calls[0]?.[0];
    expect(updateArg?.where?.id).toBe('user-1');
    expect(updateArg?.data?.withdrawalPinHash).toBe('hashed-pin');

    // No-current-hash + no-currentPin in body → alwaysCompareDummy not called.
    expect(mockAlwaysCompareDummy).not.toHaveBeenCalled();
    expect(mockIsLockedOut).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockRecordSuccess).not.toHaveBeenCalled();
  });

  it('02-03-02 CHANGE happy path: verifyPin true → recordSuccess + update', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      withdrawalPinHash: 'existing-hash',
    } as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    mockVerifyPin.mockResolvedValue(true);

    const res = await POST(jsonRequest('POST', { currentPin: '1234', newPin: '5678' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockIsLockedOut).toHaveBeenCalledWith('pin:user-1');
    expect(mockVerifyPin).toHaveBeenCalledWith('1234', 'existing-hash');
    expect(mockRecordSuccess).toHaveBeenCalledWith('pin:user-1');
    expect(mockHashPin).toHaveBeenCalledWith('5678');
    const updateArg = prismaMock.user.update.mock.calls[0]?.[0];
    expect(updateArg?.where?.id).toBe('user-1');
    expect(updateArg?.data?.withdrawalPinHash).toBe('hashed-pin');
  });

  it('02-03-03 CHANGE wrong currentPin: verifyPin false → recordFailure → 400 PIN_INVALID', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      withdrawalPinHash: 'existing-hash',
    } as never);
    mockVerifyPin.mockResolvedValue(false);
    mockRecordFailure.mockResolvedValue({ count: 1, locked: false });

    const res = await POST(jsonRequest('POST', { currentPin: '0000', newPin: '5678' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PIN_INVALID');

    expect(mockRecordFailure).toHaveBeenCalledWith('pin:user-1');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockHashPin).not.toHaveBeenCalled();
  });

  it('02-03-04 LOCKED OUT: isLockedOut true → 423 LOCKED_OUT, no bcrypt', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      withdrawalPinHash: 'existing-hash',
    } as never);
    mockIsLockedOut.mockResolvedValue(true);

    const res = await POST(jsonRequest('POST', { currentPin: '1234', newPin: '5678' }));

    expect(res.status).toBe(423);
    expect((await res.json()).error).toBe('LOCKED_OUT');

    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(mockAlwaysCompareDummy).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('CHANGE wrong shape (missing currentPin) → alwaysCompareDummy + 400 PIN_REQUIRED', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      withdrawalPinHash: 'existing-hash',
    } as never);

    const res = await POST(jsonRequest('POST', { newPin: '5678' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PIN_REQUIRED');

    expect(mockAlwaysCompareDummy).toHaveBeenCalledTimes(1);
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('CHANGE locks out on threshold: recordFailure { locked: true } → 423 LOCKED_OUT', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      withdrawalPinHash: 'existing-hash',
    } as never);
    mockVerifyPin.mockResolvedValue(false);
    mockRecordFailure.mockResolvedValue({ count: 5, locked: true });

    const res = await POST(jsonRequest('POST', { currentPin: '0000', newPin: '5678' }));

    expect(res.status).toBe(423);
    expect((await res.json()).error).toBe('LOCKED_OUT');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('POST without CSRF header → 403; user.update NOT called', async () => {
    const res = await POST(jsonRequest('POST', { newPin: '1234' }, { csrf: false }));

    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it('auth gate: requireAuth bails → 401; user.update NOT called', async () => {
    mockRequireAuth.mockResolvedValue(
      // Simulate the middleware short-circuit return — requireAuth returns
      // NextResponse on failure.
      new (await import('next/server')).NextResponse(JSON.stringify({ error: 'Missing token' }), {
        status: 401,
      }) as never,
    );

    const res = await POST(jsonRequest('POST', { newPin: '1234' }));

    expect(res.status).toBe(401);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('Zod gate (set path, too short): { newPin: "12" } when no hash → 400 VALIDATION_FAILED', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ withdrawalPinHash: null } as never);

    const res = await POST(jsonRequest('POST', { newPin: '12' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockHashPin).not.toHaveBeenCalled();
  });

  it('Zod gate (set path, non-digits): { newPin: "abcd" } when no hash → 400 VALIDATION_FAILED', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ withdrawalPinHash: null } as never);

    const res = await POST(jsonRequest('POST', { newPin: 'abcd' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/auth/withdrawal-pin', () => {
  it('02-03-05 DELETE: clears withdrawalPinHash to null', async () => {
    prismaMock.user.update.mockResolvedValue({} as never);

    const res = await DELETE(jsonRequest('DELETE', undefined));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.user.update.mock.calls[0]?.[0];
    expect(updateArg?.where?.id).toBe('user-1');
    expect(updateArg?.data?.withdrawalPinHash).toBeNull();
  });

  it('02-03-06b DELETE without CSRF header → 403', async () => {
    const res = await DELETE(jsonRequest('DELETE', undefined, { csrf: false }));

    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('lockout key namespace (Pitfall 7)', () => {
  it('every lockout primitive is keyed with literal `pin:` prefix — never the email', async () => {
    // Drive a sequence of POSTs that exercise all three primitives.
    // 1. CHANGE happy path (isLockedOut + verifyPin + recordSuccess)
    prismaMock.user.findUnique.mockResolvedValue({
      withdrawalPinHash: 'existing-hash',
    } as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    mockVerifyPin.mockResolvedValue(true);
    await POST(jsonRequest('POST', { currentPin: '1234', newPin: '5678' }));

    // 2. CHANGE wrong PIN (isLockedOut + recordFailure)
    mockVerifyPin.mockResolvedValue(false);
    mockRecordFailure.mockResolvedValue({ count: 1, locked: false });
    await POST(jsonRequest('POST', { currentPin: '0000', newPin: '5678' }));

    // 3. CHANGE locked out (isLockedOut only)
    mockIsLockedOut.mockResolvedValue(true);
    await POST(jsonRequest('POST', { currentPin: '1234', newPin: '5678' }));

    // Collect every key passed to any lockout primitive across the run.
    const allKeys: unknown[] = [
      ...mockIsLockedOut.mock.calls.map((c) => c[0]),
      ...mockRecordFailure.mock.calls.map((c) => c[0]),
      ...mockRecordSuccess.mock.calls.map((c) => c[0]),
    ];

    expect(allKeys.length).toBeGreaterThan(0);
    for (const key of allKeys) {
      expect(typeof key).toBe('string');
      expect(key as string).toMatch(/^pin:/);
      // Defense-in-depth: must NOT be the user's email.
      expect(key as string).not.toContain('@');
    }
  });
});
