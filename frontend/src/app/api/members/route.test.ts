import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const org = { id: 'org-1', slug: 'jey-club' };
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

const memberRow = {
  id: 'member-1',
  role: 'OWNER',
  createdAt: new Date('2026-01-01'),
  user: { id: 'user-1', name: 'Ada', avatarUrl: null, level: 3, xp: 220, streakCount: 5 },
};

function makeGet(qs = ''): NextRequest {
  return new NextRequest(`http://test/api/members${qs}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('GET /api/members', () => {
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
    expect(prismaMock.organizationMember.findMany).not.toHaveBeenCalled();
  });

  it('lists members newest-first, flattening the user relation', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.organizationMember.findMany.mockResolvedValue([memberRow] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      {
        id: 'user-1',
        name: 'Ada',
        avatarUrl: null,
        level: 3,
        xp: 220,
        streakCount: 5,
        role: 'OWNER',
        joinedAt: memberRow.createdAt.toISOString(),
      },
    ]);
    const arg = prismaMock.organizationMember.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ organizationId: 'org-1' });
    expect(arg?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('filters by name search (case-insensitive contains)', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.organizationMember.findMany.mockResolvedValue([] as never);

    await GET(makeGet('?q=ada'));
    const arg = prismaMock.organizationMember.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({
      organizationId: 'org-1',
      user: { name: { contains: 'ada', mode: 'insensitive' } },
    });
  });
});
