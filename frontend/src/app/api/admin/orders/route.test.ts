// ADMIN-02 (Wave 1) — orders LIST endpoint behaviour.
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
import { GET } from './route';
import { seedAdmin, seedOrder } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('/api/admin/orders [Wave 1] — list', () => {
  it('GET returns paginated orders for ADMIN sorted by createdAt DESC', async () => {
    const o1 = seedOrder({ id: 'o1' });
    const o2 = seedOrder({ id: 'o2' });
    prismaMock.order.findMany.mockResolvedValueOnce([o1, o2] as never);

    const res = await GET(makeGet('http://test/api/admin/orders'));
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(body.items.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(body.nextCursor).toBeNull();

    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect(args?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args?.select).toMatchObject({ id: true, status: true, amount: true });
    // metadata excluded — confirms whitelist
    expect((args?.select as Record<string, unknown> | undefined)?.['metadata']).toBeUndefined();
  });

  it('GET returns empty 200 (never 404) on no rows', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([] as never);
    const res = await GET(makeGet('http://test/api/admin/orders'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('GET filters by status=PAID', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      seedOrder({ id: 'o1', status: 'PAID' }),
    ] as never);
    await GET(makeGet('http://test/api/admin/orders?status=PAID'));
    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    expect(where?.['status']).toBe('PAID');
  });

  it('GET filters by since/until window', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([] as never);
    await GET(
      makeGet('http://test/api/admin/orders?since=2026-01-01T00:00:00Z&until=2026-12-31T23:59:59Z'),
    );
    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    const where = args?.where as { createdAt?: { gte?: Date; lte?: Date } } | undefined;
    expect(where?.createdAt?.gte).toBeInstanceOf(Date);
    expect(where?.createdAt?.lte).toBeInstanceOf(Date);
    expect(where?.createdAt?.gte?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(where?.createdAt?.lte?.toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });

  it('GET silently ignores malformed since/until rather than 400', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet('http://test/api/admin/orders?since=not-a-date&until=also-bad'));
    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    expect(where?.['createdAt']).toBeUndefined();
  });

  it('GET cursor pagination emits nextCursor when hasMore', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => seedOrder({ id: `o${i}` }));
    // Force monotonic createdAt so buildPage's cursor is deterministic
    rows.forEach((r, i) => {
      (r as { createdAt: Date }).createdAt = new Date(Date.UTC(2026, 4, 21 - i));
    });
    prismaMock.order.findMany.mockResolvedValueOnce(rows as never);

    const res = await GET(makeGet('http://test/api/admin/orders'));
    const body = (await res.json()) as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).not.toBeNull();
    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect(args?.take).toBe(21);
  });

  it('rate limits admin per-userId after 100/min — propagates 429', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/orders'));
    expect(res.status).toBe(429);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
  });

  it('GET propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/orders'));
    expect(res.status).toBe(403);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});
