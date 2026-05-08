// NOTIF-01 (GET list, cursor pagination) + NOTIF-02 (PATCH mark-read) tests.
//
// Pattern: bootstrap mirrors verify-email/route.test.ts:
//   - prismaMock first (auto-hoists vi.mock for '@/lib/server/prisma')
//   - mockNextCookies() for the next/headers async cookies() store
//   - vi.mock('@/lib/server/middleware') so requireAuth is controlled per test
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { encodeCursor, decodeCursor } from '@/lib/server/notifications/cursor';
import { GET, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function makePatch(body: unknown, opts: { csrf?: 'match' | 'missing' | 'header-only' } = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match' || csrf === 'header-only') {
    headers['x-csrf-token'] = 'csrf-tok';
  }
  // Build cookie header for verifyCsrf which uses req.cookies.get(CSRF_COOKIE_NAME)
  if (csrf === 'match') {
    headers['cookie'] = 'app-csrf=csrf-tok';
  } else if (csrf === 'header-only') {
    // header set, cookie absent — still valid because verifyCsrf only fails if header missing or token mismatches an existing cookie
    headers['cookie'] = '';
  }
  return new NextRequest('http://test/api/notifications', {
    method: 'PATCH',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function notif(overrides: Partial<{ id: string; createdAt: Date; readAt: Date | null }> = {}) {
  const createdAt = overrides.createdAt ?? new Date('2026-05-01T00:00:00Z');
  return {
    id: overrides.id ?? 'n-1',
    userId: 'user-1',
    type: 'WELCOME',
    title: 'Hi',
    body: 'Welcome',
    data: null,
    dedupeKey: 'd-' + (overrides.id ?? 'n-1'),
    readAt: overrides.readAt === undefined ? null : overrides.readAt,
    createdAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAuth.mockResolvedValue(authedCtx);
});

describe('GET /api/notifications', () => {
  it('Test 1: returns 401 when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Missing token' }, { status: 401 }));
    const res = await GET(makeGet('http://test/api/notifications'));
    expect(res.status).toBe(401);
  });

  it('Test 2: empty result → { items: [], nextCursor: null }', async () => {
    prismaMock.notification.findMany.mockResolvedValue([] as never);
    const res = await GET(makeGet('http://test/api/notifications'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], nextCursor: null });
  });

  it('Test 3: 25 rows + ?limit=10 → items.length=10, nextCursor decodes to 10th item', async () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      notif({
        id: `n-${i}`,
        createdAt: new Date(`2026-05-${String(11 - i).padStart(2, '0')}T00:00:00Z`),
      }),
    );
    prismaMock.notification.findMany.mockResolvedValue(rows as never);
    const res = await GET(makeGet('http://test/api/notifications?limit=10'));
    const body = await res.json();
    expect(body.items.length).toBe(10);
    expect(body.nextCursor).not.toBeNull();
    const decoded = decodeCursor(body.nextCursor);
    expect(decoded?.id).toBe('n-9');
    expect(decoded?.createdAt.toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });

  it('Test 4: cursor → next page where createdAt < first page last item', async () => {
    const cursor = encodeCursor({
      createdAt: new Date('2026-05-02T00:00:00Z'),
      id: 'n-9',
    });
    prismaMock.notification.findMany.mockResolvedValue([] as never);
    await GET(makeGet(`http://test/api/notifications?limit=10&cursor=${encodeURIComponent(cursor)}`));
    const args = prismaMock.notification.findMany.mock.calls[0]?.[0];
    expect(args?.where?.OR).toBeDefined();
    expect(args?.where?.OR?.[0]?.createdAt?.lt).toBeInstanceOf(Date);
    expect((args?.where?.OR?.[0]?.createdAt?.lt as Date).toISOString()).toBe(
      '2026-05-02T00:00:00.000Z',
    );
    expect(args?.where?.OR?.[1]?.id?.lt).toBe('n-9');
  });

  it('Test 5: ?unread=true adds readAt:null to where', async () => {
    prismaMock.notification.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/notifications?unread=true'));
    const args = prismaMock.notification.findMany.mock.calls[0]?.[0];
    expect(args?.where?.readAt).toBe(null);
    expect(args?.where?.userId).toBe('user-1');
  });

  it('Test 6: ?limit clamps — 999→50, 0→20, foo→20, -5→20', async () => {
    prismaMock.notification.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/notifications?limit=999'));
    expect(prismaMock.notification.findMany.mock.calls[0]?.[0]?.take).toBe(51);

    await GET(makeGet('http://test/api/notifications?limit=0'));
    expect(prismaMock.notification.findMany.mock.calls[1]?.[0]?.take).toBe(21);

    await GET(makeGet('http://test/api/notifications?limit=foo'));
    expect(prismaMock.notification.findMany.mock.calls[2]?.[0]?.take).toBe(21);

    await GET(makeGet('http://test/api/notifications?limit=-5'));
    expect(prismaMock.notification.findMany.mock.calls[3]?.[0]?.take).toBe(21);
  });

  it('Test 7: serializes createdAt and readAt as ISO 8601 strings', async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      notif({
        id: 'n-iso',
        createdAt: new Date('2026-05-03T12:34:56Z'),
        readAt: new Date('2026-05-03T13:00:00Z'),
      }),
    ] as never);
    const res = await GET(makeGet('http://test/api/notifications'));
    const body = await res.json();
    expect(typeof body.items[0].createdAt).toBe('string');
    expect(body.items[0].createdAt).toBe('2026-05-03T12:34:56.000Z');
    expect(body.items[0].readAt).toBe('2026-05-03T13:00:00.000Z');
    // Round-trip preservation
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it('Test 7b: where clause is scoped by userId: ctx.user.sub', async () => {
    prismaMock.notification.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/notifications'));
    const args = prismaMock.notification.findMany.mock.calls[0]?.[0];
    expect(args?.where?.userId).toBe('user-1');
  });

  it('Test 7c: response includes x-request-id header', async () => {
    prismaMock.notification.findMany.mockResolvedValue([] as never);
    const res = await GET(makeGet('http://test/api/notifications'));
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('PATCH /api/notifications', () => {
  it('Test 8: missing x-csrf-token header → 403; no Prisma calls', async () => {
    const res = await PATCH(makePatch({ ids: ['id1'] }, { csrf: 'missing' }));
    expect(res.status).toBe(403);
    expect(prismaMock.notification.updateMany).not.toHaveBeenCalled();
  });

  it('Test 9: { ids: [..] } → updateMany scoped by userId, returns updated + unreadCount', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 2 } as never);
    prismaMock.notification.count.mockResolvedValue(5 as never);
    const res = await PATCH(makePatch({ ids: ['id1', 'id2'] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ updated: 2, unreadCount: 5 });
    const updateArg = prismaMock.notification.updateMany.mock.calls[0]?.[0];
    expect(updateArg?.where?.userId).toBe('user-1');
    expect(updateArg?.where?.readAt).toBe(null);
    expect(updateArg?.where?.id).toEqual({ in: ['id1', 'id2'] });
    expect(updateArg?.data?.readAt).toBeInstanceOf(Date);
    const countArg = prismaMock.notification.count.mock.calls[0]?.[0];
    expect(countArg?.where?.userId).toBe('user-1');
    expect(countArg?.where?.readAt).toBe(null);
  });

  it('Test 10: { ids: "all" } → updateMany without id filter', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 4 } as never);
    prismaMock.notification.count.mockResolvedValue(0 as never);
    await PATCH(makePatch({ ids: 'all' }));
    const updateArg = prismaMock.notification.updateMany.mock.calls[0]?.[0];
    expect(updateArg?.where?.userId).toBe('user-1');
    expect(updateArg?.where?.readAt).toBe(null);
    expect(updateArg?.where?.id).toBeUndefined();
  });

  it('Test 11: cross-tenant ids match 0 rows; status 200, not 403/404', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.notification.count.mockResolvedValue(7 as never);
    const res = await PATCH(makePatch({ ids: ['someone-elses-id'] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ updated: 0, unreadCount: 7 });
  });

  it('Test 12: { ids: [] } → 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatch({ ids: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.notification.updateMany).not.toHaveBeenCalled();
  });

  it('Test 13: malformed body → 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatch({ ids: 'not-all-not-array' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.notification.updateMany).not.toHaveBeenCalled();
  });

  it('Test 13b: requireAuth bail → 401, no Prisma calls', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Missing token' }, { status: 401 }));
    const res = await PATCH(makePatch({ ids: 'all' }));
    expect(res.status).toBe(401);
    expect(prismaMock.notification.updateMany).not.toHaveBeenCalled();
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
