// ADMIN-03 (Waves 1 & 2) — withdrawals LIST + admin cancel endpoint behaviour.
//
// Cancel suite (D-ADMIN-01: SUPERADMIN-only) added in Plan 03-06.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
  requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return {
    ...actual,
    verifyCsrf: vi.fn(),
  };
});
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/server/withdrawals/lock', () => ({
  lockUserTx: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin, requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { verifyCsrf } from '@/lib/server/auth';
import { logAdminAction } from '@/lib/server/admin/audit';
import { lockUserTx } from '@/lib/server/withdrawals/lock';
import { encodeCursor, decodeCursor } from '@/lib/server/notifications/cursor';
import { GET } from './route';
import { POST as POST_CANCEL } from './[id]/cancel/route';
import { seedAdmin, seedSuperadmin } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockVerifyCsrf = vi.mocked(verifyCsrf);
const mockLogAdminAction = vi.mocked(logAdminAction);
const mockLockUserTx = vi.mocked(lockUserTx);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};

const superadminUser = seedSuperadmin({ id: 'superadmin_1', email: 'superadmin@test.local' });
const superadminCtx = {
  user: { sub: superadminUser.id, email: superadminUser.email },
  admin: { id: superadminUser.id, email: superadminUser.email, role: 'SUPERADMIN' as const },
};

interface WRow {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
  destination: { method: string; phone: string } | unknown;
  provider: string;
  providerPayoutId: string | null;
  failureReason: string | null;
  requestedAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
}

function wrow(overrides: Partial<WRow> = {}): WRow {
  const id = overrides.id ?? 'w1';
  return {
    id,
    userId: overrides.userId ?? 'user_1',
    amount: overrides.amount ?? 5000,
    currency: overrides.currency ?? 'XOF',
    status: overrides.status ?? 'PENDING',
    destination: overrides.destination ?? { method: 'WAVE', phone: '+221770000000' },
    provider: overrides.provider ?? 'bictorys',
    providerPayoutId: overrides.providerPayoutId ?? null,
    failureReason: overrides.failureReason ?? null,
    requestedAt: overrides.requestedAt ?? new Date('2026-05-01T00:00:00Z'),
    processedAt: overrides.processedAt ?? null,
    completedAt: overrides.completedAt ?? null,
  };
}

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRequireSuperadmin.mockResolvedValue(superadminCtx);
  mockRateLimit.mockResolvedValue(null);
  mockVerifyCsrf.mockReturnValue(null);
  mockLogAdminAction.mockResolvedValue(undefined);
  mockLockUserTx.mockResolvedValue(undefined);
  // Default $transaction passthrough — runs the callback against the prismaMock.
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
});

describe('/api/admin/withdrawals [Wave 1] — list', () => {
  it('GET returns paginated withdrawals for ADMIN ordered by requestedAt DESC', async () => {
    const w1 = wrow({ id: 'w1', requestedAt: new Date('2026-05-03T00:00:00Z') });
    const w2 = wrow({ id: 'w2', requestedAt: new Date('2026-05-02T00:00:00Z') });
    prismaMock.withdrawal.findMany.mockResolvedValueOnce([w1, w2] as never);

    const res = await GET(makeGet('http://test/api/admin/withdrawals'));
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(body.items.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(body.nextCursor).toBeNull();

    const args = prismaMock.withdrawal.findMany.mock.calls[0]?.[0];
    expect(args?.orderBy).toEqual([{ requestedAt: 'desc' }, { id: 'desc' }]);
    expect(args?.select).toMatchObject({
      id: true,
      destination: true,
      requestedAt: true,
    });
  });

  it('GET returns empty 200 (never 404) on no rows', async () => {
    prismaMock.withdrawal.findMany.mockResolvedValueOnce([] as never);
    const res = await GET(makeGet('http://test/api/admin/withdrawals'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('GET filters by status=PENDING', async () => {
    prismaMock.withdrawal.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet('http://test/api/admin/withdrawals?status=PENDING'));
    const args = prismaMock.withdrawal.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    expect(where?.['status']).toBe('PENDING');
  });

  it('GET filters by since/until on requestedAt (not createdAt)', async () => {
    prismaMock.withdrawal.findMany.mockResolvedValueOnce([] as never);
    await GET(
      makeGet(
        'http://test/api/admin/withdrawals?since=2026-01-01T00:00:00Z&until=2026-12-31T23:59:59Z',
      ),
    );
    const args = prismaMock.withdrawal.findMany.mock.calls[0]?.[0];
    const where = args?.where as
      | { requestedAt?: { gte?: Date; lte?: Date }; createdAt?: unknown }
      | undefined;
    // Must bind to requestedAt — not createdAt (model has no createdAt)
    expect(where?.requestedAt?.gte).toBeInstanceOf(Date);
    expect(where?.requestedAt?.lte).toBeInstanceOf(Date);
    expect(where?.createdAt).toBeUndefined();
  });

  it('GET cursor where-fragment binds to requestedAt and emits cursor with requestedAt', async () => {
    // 21 rows so hasMore=true; monotonic requestedAt for deterministic cursor
    const rows = Array.from({ length: 21 }, (_, i) =>
      wrow({
        id: `w${i}`,
        requestedAt: new Date(Date.UTC(2026, 4, 21 - i)),
      }),
    );
    prismaMock.withdrawal.findMany.mockResolvedValueOnce(rows as never);

    const res = await GET(makeGet('http://test/api/admin/withdrawals'));
    const body = (await res.json()) as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).not.toBeNull();

    // Cursor decode-back should carry requestedAt of the 20th row
    const decoded = decodeCursor(body.nextCursor);
    expect(decoded?.id).toBe('w19');
    // 20th element index=19 → requestedAt = Date.UTC(2026, 4, 21 - 19) = May 2
    expect(decoded?.createdAt.toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });

  it('GET applied cursor filters use requestedAt OR-fragment', async () => {
    const cursorVal = encodeCursor({
      createdAt: new Date('2026-05-02T00:00:00Z'),
      id: 'w_prev',
    });
    prismaMock.withdrawal.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet(`http://test/api/admin/withdrawals?cursor=${encodeURIComponent(cursorVal)}`));
    const args = prismaMock.withdrawal.findMany.mock.calls[0]?.[0];
    const where = args?.where as { OR?: Array<Record<string, unknown>> } | undefined;
    expect(where?.OR).toBeDefined();
    expect(where?.OR?.[0]).toHaveProperty('requestedAt');
    // Must not have a createdAt branch
    expect(JSON.stringify(where?.OR)).not.toContain('createdAt');
  });

  it('rate limits admin per-userId after 100/min — propagates 429', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/withdrawals'));
    expect(res.status).toBe(429);
    expect(prismaMock.withdrawal.findMany).not.toHaveBeenCalled();
  });

  it('GET propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/withdrawals'));
    expect(res.status).toBe(403);
    expect(prismaMock.withdrawal.findMany).not.toHaveBeenCalled();
  });
});

// ─── Wave 2 surfaces — Plan 03-06: POST cancel (SUPERADMIN-only) ───

function makePostCancel(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://test/api/admin/withdrawals/${id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function paramsOf(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('/api/admin/withdrawals/[id]/cancel [Wave 2] — manual cancel', () => {
  it('POST [id]/cancel by ADMIN returns 403 ADMIN_REQUIRED (requireSuperadmin gate)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: 'ADMIN_REQUIRED', message: 'Admin access required' },
        { status: 403 },
      ),
    );

    const res = await POST_CANCEL(
      makePostCancel('w_pending', { reason: 'fraud' }),
      paramsOf('w_pending'),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ADMIN_REQUIRED');
    expect(prismaMock.withdrawal.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
    expect(mockLockUserTx).not.toHaveBeenCalled();
  });

  it('POST [id]/cancel by SUPERADMIN on PENDING succeeds + writes AdminAction action="withdrawal.cancel"', async () => {
    const w = wrow({
      id: 'w_pending',
      userId: 'user_42',
      status: 'PENDING',
      amount: 8000,
      currency: 'XOF',
    });
    // Phase-1 owner lookup — outside the lock
    prismaMock.withdrawal.findUnique
      .mockResolvedValueOnce({ userId: w.userId } as never)
      // Phase-2 re-fetch under the lock — returns the full row
      .mockResolvedValueOnce(w as never);
    prismaMock.withdrawal.update.mockResolvedValueOnce({
      ...w,
      status: 'CANCELLED',
      failureReason: 'fraud',
    } as never);

    const res = await POST_CANCEL(makePostCancel(w.id, { reason: 'fraud' }), paramsOf(w.id));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { withdrawal: { id: string; status: string } };
    expect(body.withdrawal.status).toBe('CANCELLED');

    expect(prismaMock.withdrawal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: w.id },
        data: expect.objectContaining({
          status: 'CANCELLED',
          failureReason: 'fraud',
        }),
      }),
    );

    expect(mockLogAdminAction).toHaveBeenCalledTimes(1);
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: superadminUser.id,
        action: 'withdrawal.cancel',
        targetType: 'Withdrawal',
        targetId: w.id,
        metadata: expect.objectContaining({
          withdrawalId: w.id,
          amount: 8000,
          currency: 'XOF',
          reason: 'fraud',
          previousStatus: 'PENDING',
        }),
      }),
    );
  });

  it('withdrawal cancel uses pg_advisory_xact_lock(hashtext(userId)) inside the same Serializable tx', async () => {
    const w = wrow({ id: 'w_proc', userId: 'user_lock_target', status: 'PROCESSING' });
    prismaMock.withdrawal.findUnique
      .mockResolvedValueOnce({ userId: w.userId } as never)
      .mockResolvedValueOnce(w as never);
    prismaMock.withdrawal.update.mockResolvedValueOnce({
      ...w,
      status: 'CANCELLED',
      failureReason: 'manual',
    } as never);

    await POST_CANCEL(makePostCancel(w.id, { reason: 'manual' }), paramsOf(w.id));

    // 1. lockUserTx was called with the WITHDRAWAL'S OWNER (not the admin actor)
    expect(mockLockUserTx).toHaveBeenCalledTimes(1);
    expect(mockLockUserTx).toHaveBeenCalledWith(expect.anything(), 'user_lock_target');
    expect(mockLockUserTx).not.toHaveBeenCalledWith(expect.anything(), superadminUser.id);

    // 2. $transaction was called with isolationLevel: 'Serializable'
    const txCall = prismaMock.$transaction.mock.calls[0];
    expect(txCall).toBeDefined();
    const txOpts = txCall?.[1] as { isolationLevel?: string } | undefined;
    expect(txOpts?.isolationLevel).toBe('Serializable');
  });

  it('POST [id]/cancel on COMPLETED → 409 WITHDRAWAL_NOT_CANCELLABLE + no DB change + no AdminAction', async () => {
    const w = wrow({ id: 'w_done', userId: 'user_x', status: 'COMPLETED' });
    prismaMock.withdrawal.findUnique
      .mockResolvedValueOnce({ userId: w.userId } as never)
      .mockResolvedValueOnce(w as never);

    const res = await POST_CANCEL(makePostCancel(w.id, { reason: 'late' }), paramsOf(w.id));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('WITHDRAWAL_NOT_CANCELLABLE');
    expect(prismaMock.withdrawal.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('POST [id]/cancel on missing id → 404 WITHDRAWAL_NOT_FOUND (no tx, no lock)', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValueOnce(null);

    const res = await POST_CANCEL(
      makePostCancel('w_missing', { reason: 'manual' }),
      paramsOf('w_missing'),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('WITHDRAWAL_NOT_FOUND');
    expect(mockLockUserTx).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('POST [id]/cancel rejects when CSRF fails — short-circuits before auth', async () => {
    mockVerifyCsrf.mockReturnValueOnce(
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 }),
    );

    const res = await POST_CANCEL(
      makePostCancel('w_pending', { reason: 'fraud' }),
      paramsOf('w_pending'),
    );

    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
    expect(mockLockUserTx).not.toHaveBeenCalled();
  });

  it('POST [id]/cancel with empty/missing reason → 400 VALIDATION_FAILED (Zod min(1))', async () => {
    const res1 = await POST_CANCEL(makePostCancel('w_pending', {}), paramsOf('w_pending'));
    expect(res1.status).toBe(400);

    const res2 = await POST_CANCEL(
      makePostCancel('w_pending', { reason: '' }),
      paramsOf('w_pending'),
    );
    expect(res2.status).toBe(400);

    expect(mockLockUserTx).not.toHaveBeenCalled();
    expect(prismaMock.withdrawal.update).not.toHaveBeenCalled();
  });
});
