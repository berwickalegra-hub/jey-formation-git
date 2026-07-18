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

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/courses', { method: 'GET' });
}

function makePost(body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return body === undefined
    ? new NextRequest('http://test/api/courses', { method: 'POST', headers })
    : new NextRequest('http://test/api/courses', {
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

describe('GET /api/courses', () => {
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
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });

  it('computes progressPercent from completed vs total lessons', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findMany.mockResolvedValue([
      {
        id: 'course-1',
        title: 'Fondations',
        description: 'desc',
        coverImageUrl: null,
        modules: [{ lessons: [{ id: 'l1' }, { id: 'l2' }] }, { lessons: [{ id: 'l3' }] }],
      },
    ] as never);
    prismaMock.organizationMember.count.mockResolvedValue(12);
    prismaMock.lessonProgress.count.mockResolvedValue(1); // 1 of 3 lessons done

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      {
        id: 'course-1',
        title: 'Fondations',
        description: 'desc',
        coverImageUrl: null,
        moduleCount: 2,
        lessonCount: 3,
        memberCount: 12,
        progressPercent: 33,
        firstLessonId: 'l1',
      },
    ]);
  });

  it('a course with zero lessons reports 0% instead of dividing by zero', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findMany.mockResolvedValue([
      { id: 'course-empty', title: 'Vide', description: null, coverImageUrl: null, modules: [] },
    ] as never);
    prismaMock.organizationMember.count.mockResolvedValue(1);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.items[0].progressPercent).toBe(0);
    expect(prismaMock.lessonProgress.count).not.toHaveBeenCalled();
  });
});

describe('POST /api/courses', () => {
  it('missing CSRF → 403', async () => {
    const res = await POST(makePost({ title: 'Nouvelle formation' }, { csrf: 'missing' }));
    expect(res.status).toBe(403);
  });

  it('empty title → 400 VALIDATION_FAILED', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    const res = await POST(makePost({ title: '' }));
    expect(res.status).toBe(400);
  });

  it('gates on ADMIN, not just MEMBER', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.count.mockResolvedValue(0);
    prismaMock.course.create.mockResolvedValue({ id: 'course-1' } as never);
    await POST(makePost({ title: 'Nouvelle formation' }));
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });

  it('creates the course with the next append order', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.count.mockResolvedValue(2);
    prismaMock.course.create.mockResolvedValue({ id: 'course-3' } as never);

    const res = await POST(makePost({ title: 'Nouvelle formation' }));
    expect(res.status).toBe(201);
    const arg = prismaMock.course.create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({
      organizationId: 'org-1',
      title: 'Nouvelle formation',
      description: null,
      coverImageUrl: null,
      order: 2,
    });
  });
});
