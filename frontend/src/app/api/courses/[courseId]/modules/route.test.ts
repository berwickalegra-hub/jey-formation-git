import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const org = { id: 'org-1', slug: 'jey-club' };
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

function makePost(courseId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/courses/${courseId}/modules`, {
          method: 'POST',
          headers,
        })
      : new NextRequest(`http://test/api/courses/${courseId}/modules`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
  return POST(req, { params: Promise.resolve({ courseId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('POST /api/courses/[courseId]/modules', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('course-1', { title: 'Module 1' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 COURSE_NOT_FOUND', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue(null);
    const res = await makePost('course-x', { title: 'Module 1' });
    expect(res.status).toBe(404);
  });

  it('org-role gate failure is returned as-is', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue({ id: 'course-1' } as never);
    mockRequireOrgRole.mockResolvedValueOnce(
      NextResponse.json({ error: 'Organization not found' }, { status: 404 }),
    );
    const res = await makePost('course-1', { title: 'Module 1' });
    expect(res.status).toBe(404);
    expect(prismaMock.module.create).not.toHaveBeenCalled();
  });

  it('empty title → 400 VALIDATION_FAILED', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue({ id: 'course-1' } as never);
    const res = await makePost('course-1', { title: '' });
    expect(res.status).toBe(400);
  });

  it('creates the module with the next append order', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue({ id: 'course-1' } as never);
    prismaMock.module.count.mockResolvedValue(2);
    prismaMock.module.create.mockResolvedValue({ id: 'mod-3' } as never);

    const res = await makePost('course-1', { title: 'Module 3' });
    expect(res.status).toBe(201);
    const arg = prismaMock.module.create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({ courseId: 'course-1', title: 'Module 3', order: 2 });
  });
});
