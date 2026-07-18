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

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/post-categories', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('GET /api/post-categories', () => {
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
    expect(prismaMock.postCategory.findMany).not.toHaveBeenCalled();
  });

  it('lists categories ordered by `order`', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.postCategory.findMany.mockResolvedValue([
      { id: 'cat-1', name: 'Général', emoji: '💬' },
    ] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([{ id: 'cat-1', name: 'Général', emoji: '💬' }]);
    const arg = prismaMock.postCategory.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ organizationId: 'org-1' });
    expect(arg?.orderBy).toEqual({ order: 'asc' });
  });
});
