// NOTIF-03 — GET /api/notifications/count tests.
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
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/notifications/count', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAuth.mockResolvedValue(authedCtx);
});

describe('GET /api/notifications/count', () => {
  it('Test 1: returns 401 when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(prismaMock.notification.count).not.toHaveBeenCalled();
  });

  it('Test 2: calls prisma.notification.count with { userId, readAt:null }; returns { count }', async () => {
    prismaMock.notification.count.mockResolvedValue(7 as never);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ count: 7 });
    const args = prismaMock.notification.count.mock.calls[0]?.[0];
    expect(args?.where?.userId).toBe('user-1');
    expect(args?.where?.readAt).toBe(null);
  });

  it('Test 3: response includes x-request-id header', async () => {
    prismaMock.notification.count.mockResolvedValue(0 as never);
    const res = await GET(makeGet());
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('Test 4: count query uses ctx.user.sub (id), not the email', async () => {
    prismaMock.notification.count.mockResolvedValue(3 as never);
    await GET(makeGet());
    const args = prismaMock.notification.count.mock.calls[0]?.[0];
    expect(args?.where?.userId).toBe('user-1');
    expect(args?.where?.userId).not.toBe('me@example.com');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
