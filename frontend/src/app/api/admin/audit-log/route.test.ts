// ADMIN-04 (audit-log list + filters) tests — D-AUDIT-01 filters on actor,
// action, targetType, since, until + cursor pagination from Wave 0 helpers.
//
// Pattern mirrors src/app/api/notifications/route.test.ts:
//   - prismaMock first (auto-hoists vi.mock for '@/lib/server/prisma')
//   - mockNextCookies() for the next/headers async cookies() store
//   - vi.mock('@/lib/server/middleware') so requireAdmin is controlled per test
//   - vi.mock('@/lib/server/middleware/rate-limit-by-userid') so the rate
//     limiter is a no-op by default (per-test override surfaces 429 path)
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

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

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockEnforceRateLimit = vi.mocked(enforceAdminRateLimit);

const adminCtx = {
  user: { sub: 'admin-1', email: 'admin@test.local' },
  admin: { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function row(overrides: Partial<{ id: string; createdAt: Date; actorId: string; action: string; targetType: string | null; targetId: string | null }> = {}) {
  const createdAt = overrides.createdAt ?? new Date('2026-05-01T00:00:00Z');
  return {
    id: overrides.id ?? 'a-1',
    actorId: overrides.actorId ?? 'admin-1',
    action: overrides.action ?? 'user.role_change',
    targetType: overrides.targetType === undefined ? 'User' : overrides.targetType,
    targetId: overrides.targetId === undefined ? 'user-target-1' : overrides.targetId,
    metadata: { from: 'USER', to: 'ADMIN' },
    ip: '127.0.0.1',
    userAgent: 'jest',
    createdAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockEnforceRateLimit.mockResolvedValue(null);
});

describe('GET /api/admin/audit-log [Wave 1]', () => {
  it('returns 401 / 403 when requireAdmin bails (forwards the response)', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED', message: 'Admin access required' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/audit-log'));
    expect(res.status).toBe(403);
    expect(prismaMock.adminAction.findMany).not.toHaveBeenCalled();
  });

  it('returns 429 when rate-limit gate fires before any DB call', async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/audit-log'));
    expect(res.status).toBe(429);
    expect(prismaMock.adminAction.findMany).not.toHaveBeenCalled();
  });

  it('GET returns paginated AdminAction items (empty → items:[], nextCursor:null)', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    const res = await GET(makeGet('http://test/api/admin/audit-log'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], nextCursor: null });
  });

  it('GET pagination: 11 rows + ?limit=10 → items.length=10, nextCursor decodes to 10th item', async () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      row({
        id: `a-${i}`,
        createdAt: new Date(`2026-05-${String(11 - i).padStart(2, '0')}T00:00:00Z`),
      }),
    );
    prismaMock.adminAction.findMany.mockResolvedValue(rows as never);
    const res = await GET(makeGet('http://test/api/admin/audit-log?limit=10'));
    const body = await res.json();
    expect(body.items.length).toBe(10);
    expect(body.nextCursor).not.toBeNull();
    const decoded = decodeCursor(body.nextCursor);
    expect(decoded?.id).toBe('a-9');
    expect(decoded?.createdAt.toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });

  it('GET filters by ?actor (exact actorId match)', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/admin/audit-log?actor=admin-7'));
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    expect(args?.where?.actorId).toBe('admin-7');
  });

  it('GET filters by ?action (exact dotted-string match)', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/admin/audit-log?action=user.role_change'));
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    expect(args?.where?.action).toBe('user.role_change');
  });

  it('GET filters by ?targetType (exact match on targetType column)', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/admin/audit-log?targetType=User'));
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    expect(args?.where?.targetType).toBe('User');
  });

  it('GET filters by ?since/?until (createdAt gte/lte)', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(
      makeGet(
        'http://test/api/admin/audit-log?since=2026-05-01T00:00:00Z&until=2026-05-08T00:00:00Z',
      ),
    );
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    const createdAt = args?.where?.createdAt as { gte?: Date; lte?: Date } | undefined;
    expect(createdAt?.gte).toBeInstanceOf(Date);
    expect(createdAt?.gte?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(createdAt?.lte).toBeInstanceOf(Date);
    expect(createdAt?.lte?.toISOString()).toBe('2026-05-08T00:00:00.000Z');
  });

  it('GET ignores invalid since/until dates (no createdAt filter applied)', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/admin/audit-log?since=not-a-date&until=also-bad'));
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    expect(args?.where?.createdAt).toBeUndefined();
  });

  it('GET combines all filters into a single where clause', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(
      makeGet(
        'http://test/api/admin/audit-log?actor=admin-1&action=user.suspend&targetType=User&since=2026-05-01T00:00:00Z',
      ),
    );
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    expect(args?.where?.actorId).toBe('admin-1');
    expect(args?.where?.action).toBe('user.suspend');
    expect(args?.where?.targetType).toBe('User');
    const createdAt = args?.where?.createdAt as { gte?: Date } | undefined;
    expect(createdAt?.gte?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('GET cursor → next page where (createdAt < cursor.createdAt) OR (=, id < cursor.id)', async () => {
    const cursor = encodeCursor({
      createdAt: new Date('2026-05-02T00:00:00Z'),
      id: 'a-9',
    });
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(
      makeGet(`http://test/api/admin/audit-log?limit=10&cursor=${encodeURIComponent(cursor)}`),
    );
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    const or = args?.where?.OR as Array<Record<string, unknown>> | undefined;
    expect(or).toBeDefined();
    const firstCreatedAt = (or?.[0]?.createdAt ?? {}) as { lt?: Date };
    expect(firstCreatedAt.lt).toBeInstanceOf(Date);
    expect(firstCreatedAt.lt?.toISOString()).toBe('2026-05-02T00:00:00.000Z');
    const secondId = (or?.[1]?.id ?? {}) as { lt?: string };
    expect(secondId.lt).toBe('a-9');
  });

  it('GET orderBy [createdAt desc, id desc] + take limit+1', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/admin/audit-log?limit=20'));
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    expect(args?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args?.take).toBe(21);
  });

  it('GET selects full incident-triage shape (id, actorId, action, targetType, targetId, metadata, ip, userAgent, createdAt)', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/admin/audit-log'));
    const args = prismaMock.adminAction.findMany.mock.calls[0]?.[0];
    expect(args?.select).toEqual({
      id: true,
      actorId: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      ip: true,
      userAgent: true,
      createdAt: true,
    });
  });

  it('GET response includes x-request-id header', async () => {
    prismaMock.adminAction.findMany.mockResolvedValue([] as never);
    const res = await GET(makeGet('http://test/api/admin/audit-log'));
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs', requireAdmin('ADMIN'), enforceAdminRateLimit, prisma.adminAction.findMany, withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain("requireAdmin('ADMIN')");
    expect(src).toContain('enforceAdminRateLimit');
    expect(src).toContain('prisma.adminAction.findMany');
    expect(src).toContain('withRequestContext');
  });
});
