import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET, POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const org = { id: 'org-1', slug: 'jey-club' };
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

function makeGet(qs = ''): NextRequest {
  return new NextRequest(`http://test/api/events${qs}`, { method: 'GET' });
}

function makePost(body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return body === undefined
    ? new NextRequest('http://test/api/events', { method: 'POST', headers })
    : new NextRequest('http://test/api/events', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('GET /api/events', () => {
  it('404 when no community is seeded', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
  });

  it('org-role gate failure is returned as-is', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    mockRequireOrgRole.mockResolvedValueOnce(
      NextResponse.json({ error: 'Organization not found' }, { status: 404 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
    expect(prismaMock.event.findMany).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED on a malformed month', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    const res = await GET(makeGet('?month=nope'));
    expect(res.status).toBe(400);
  });

  it('scopes the query to the requested month range', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.event.findMany.mockResolvedValue([] as never);
    const res = await GET(makeGet('?month=2026-07'));
    expect(res.status).toBe(200);
    const arg = prismaMock.event.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({
      organizationId: 'org-1',
      startAt: { gte: new Date(Date.UTC(2026, 6, 1)), lt: new Date(Date.UTC(2026, 7, 1)) },
    });
  });
});

describe('POST /api/events', () => {
  it('missing CSRF → 403', async () => {
    const res = POST(makePost({ title: 'Live' }, { csrf: 'missing' }));
    expect((await res).status).toBe(403);
  });

  it('malformed body → 400 VALIDATION_FAILED', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    const res = await POST(makePost({ title: '' }));
    expect(res.status).toBe(400);
  });

  it('creates the event with defaults applied', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.event.create.mockResolvedValue({ id: 'event-1' } as never);

    const res = await POST(
      makePost({
        title: 'Live mensuel',
        startAt: '2026-07-20T18:00:00.000Z',
        durationMinutes: 60,
      }),
    );
    expect(res.status).toBe(201);

    const arg = prismaMock.event.create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({
      organizationId: 'org-1',
      createdById: 'user-1',
      title: 'Live mensuel',
      description: null,
      startAt: new Date('2026-07-20T18:00:00.000Z'),
      durationMinutes: 60,
      isOnline: true,
      meetingUrl: null,
    });
  });

  it('gates on ADMIN, not just MEMBER', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.event.create.mockResolvedValue({ id: 'event-1' } as never);
    await POST(
      makePost({ title: 'Live', startAt: '2026-07-20T18:00:00.000Z', durationMinutes: 30 }),
    );
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });
});
