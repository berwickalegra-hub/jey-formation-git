// ADMIN-03 (Wave 1) — withdrawals LIST endpoint behaviour.
//
// Cancel suite (D-ADMIN-01: SUPERADMIN-only) stays `it.todo` — Plan 03-06.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { encodeCursor, decodeCursor } from '@/lib/server/notifications/cursor';
import { GET } from './route';
import { seedAdmin } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
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
  mockRateLimit.mockResolvedValue(null);
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

// ─── Wave 2 surfaces — Plan 03-06 implements PATCH cancel (SUPERADMIN-only) ───
describe('/api/admin/withdrawals/[id]/cancel [Wave 2] — manual cancel', () => {
  it.todo('POST [id]/cancel by ADMIN returns 403 ADMIN_REQUIRED');
  it.todo(
    'POST [id]/cancel by SUPERADMIN succeeds + writes AdminAction with action="withdrawal.cancel"',
  );
  it.todo(
    'withdrawal cancel uses pg_advisory_xact_lock(hashtext(userId)) inside the same Serializable tx',
  );
});
