// OBS-01 — Admin outbox visibility tests.
//
// Pitfall 4: schema column is `kind` (not `type`); the route MUST query
// `prisma.outboxEvent.findMany({ where: { kind } })` when the URL passes
// `?kind=…`. Frontend + response shape both use `kind`.
//
// Wave 1 conversion of the it.todo scaffold from Plan 03-01 (Wave 0).
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { seedAdmin, seedOutbox } from '@/test-utils/admin-fixtures';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { GET } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockEnforceAdminRateLimit = vi.mocked(enforceAdminRateLimit);

const admin = seedAdmin({ id: 'admin-1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: admin.id, email: admin.email },
  admin: { id: admin.id, email: admin.email, role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockEnforceAdminRateLimit.mockResolvedValue(null);
});

describe('/api/admin/outbox [Wave 1]', () => {
  it('GET returns paginated OutboxEvent rows', async () => {
    const rows = [
      seedOutbox({
        id: 'ob-1',
        kind: 'email.payment_confirmation',
        status: 'PENDING',
      }),
      seedOutbox({
        id: 'ob-2',
        kind: 'notification.payment_received',
        status: 'SENT',
      }),
      seedOutbox({
        id: 'ob-3',
        kind: 'notification.payment_received',
        status: 'FAILED',
      }),
      seedOutbox({
        id: 'ob-4',
        kind: 'email.welcome',
        status: 'DEAD',
      }),
      seedOutbox({
        id: 'ob-5',
        kind: 'email.payment_confirmation',
        status: 'PENDING',
      }),
    ];
    prismaMock.outboxEvent.findMany.mockResolvedValue(rows as never);

    const res = await GET(makeGet('http://test/api/admin/outbox'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(5);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([
      'ob-1',
      'ob-2',
      'ob-3',
      'ob-4',
      'ob-5',
    ]);
    expect(body.nextCursor).toBeNull();
    // Sort: createdAt DESC, id DESC
    const args = prismaMock.outboxEvent.findMany.mock.calls[0]?.[0];
    expect(args?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    // Response uses `kind`, not `type`
    expect(body.items[0]).toHaveProperty('kind');
    expect(body.items[0]).not.toHaveProperty('type');
  });

  it('GET filters by status (PENDING|SENT|FAILED|DEAD)', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([
      seedOutbox({ id: 'ob-pending', status: 'PENDING' }),
    ] as never);

    await GET(makeGet('http://test/api/admin/outbox?status=PENDING'));
    let args = prismaMock.outboxEvent.findMany.mock.calls[0]?.[0];
    expect(args?.where?.status).toBe('PENDING');

    await GET(makeGet('http://test/api/admin/outbox?status=SENT'));
    args = prismaMock.outboxEvent.findMany.mock.calls[1]?.[0];
    expect(args?.where?.status).toBe('SENT');

    await GET(makeGet('http://test/api/admin/outbox?status=FAILED'));
    args = prismaMock.outboxEvent.findMany.mock.calls[2]?.[0];
    expect(args?.where?.status).toBe('FAILED');

    await GET(makeGet('http://test/api/admin/outbox?status=DEAD'));
    args = prismaMock.outboxEvent.findMany.mock.calls[3]?.[0];
    expect(args?.where?.status).toBe('DEAD');

    // Invalid status is ignored (no where.status filter)
    await GET(makeGet('http://test/api/admin/outbox?status=PROCESSING'));
    args = prismaMock.outboxEvent.findMany.mock.calls[4]?.[0];
    expect(args?.where?.status).toBeUndefined();
  });

  it('GET filters by status and kind (not type)', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([
      seedOutbox({ id: 'ob-1', kind: 'email.payment_confirmation' }),
    ] as never);

    await GET(
      makeGet('http://test/api/admin/outbox?status=PENDING&kind=email.payment_confirmation'),
    );
    const args = prismaMock.outboxEvent.findMany.mock.calls[0]?.[0];
    expect(args?.where?.kind).toBe('email.payment_confirmation');
    expect(args?.where?.status).toBe('PENDING');
    // Pitfall 4: must NOT use `type` as the field name
    expect((args?.where as Record<string, unknown> | undefined)?.['type']).toBeUndefined();
  });

  it('GET applies pagination with limit and cursor', async () => {
    // Seed 11 rows so limit=10 surfaces a nextCursor
    const rows = Array.from({ length: 11 }, (_, i) =>
      seedOutbox({
        id: `ob-${i}`,
      }),
    );
    prismaMock.outboxEvent.findMany.mockResolvedValue(rows as never);

    const res = await GET(makeGet('http://test/api/admin/outbox?limit=10'));
    const body = await res.json();
    expect(body.items).toHaveLength(10);
    expect(body.nextCursor).not.toBeNull();
    const args = prismaMock.outboxEvent.findMany.mock.calls[0]?.[0];
    expect(args?.take).toBe(11);
  });

  it('GET returns 401/403 when requireAdmin bails', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: 'ADMIN_REQUIRED', message: 'Admin access required' },
        { status: 403 },
      ),
    );
    const res = await GET(makeGet('http://test/api/admin/outbox'));
    expect(res.status).toBe(403);
    expect(prismaMock.outboxEvent.findMany).not.toHaveBeenCalled();
  });

  it('GET short-circuits when admin rate limit is exceeded', async () => {
    mockEnforceAdminRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/outbox'));
    expect(res.status).toBe(429);
    expect(prismaMock.outboxEvent.findMany).not.toHaveBeenCalled();
  });

  it('GET response includes x-request-id header', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([] as never);
    const res = await GET(makeGet('http://test/api/admin/outbox'));
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
