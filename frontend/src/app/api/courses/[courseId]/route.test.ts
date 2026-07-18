import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET, PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const org = { id: 'org-1', slug: 'jey-club' };
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

function makeGet(courseId: string) {
  const req = new NextRequest(`http://test/api/courses/${courseId}`, { method: 'GET' });
  return GET(req, { params: Promise.resolve({ courseId }) });
}

function makePatch(courseId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/courses/${courseId}`, { method: 'PATCH', headers })
      : new NextRequest(`http://test/api/courses/${courseId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body),
        });
  return PATCH(req, { params: Promise.resolve({ courseId }) });
}

function makeDelete(courseId: string, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = {};
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req = new NextRequest(`http://test/api/courses/${courseId}`, {
    method: 'DELETE',
    headers,
  });
  return DELETE(req, { params: Promise.resolve({ courseId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('GET /api/courses/[courseId]', () => {
  it('404 COURSE_NOT_FOUND when the course does not belong to the community', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue(null);
    const res = await makeGet('course-x');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('COURSE_NOT_FOUND');
  });

  it('scopes the lookup by organizationId (not just id)', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue(null);
    await makeGet('course-x');
    const arg = prismaMock.course.findFirst.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ id: 'course-x', organizationId: 'org-1' });
  });

  it('flags each lesson completed/hasQuiz and attaches the latest quiz result', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue({
      id: 'course-1',
      title: 'Fondations',
      description: 'desc',
      modules: [
        {
          id: 'mod-1',
          title: 'Module 1',
          lessons: [
            {
              id: 'lesson-1',
              title: 'Leçon 1',
              videoUrl: 'https://cdn/v1.mp4',
              descriptionHtml: '<p>hi</p>',
              durationSeconds: 120,
              quiz: { id: 'quiz-1' },
              progress: [{ completed: true }],
            },
            {
              id: 'lesson-2',
              title: 'Leçon 2',
              videoUrl: null,
              descriptionHtml: null,
              durationSeconds: null,
              quiz: null,
              progress: [],
            },
          ],
        },
      ],
    } as never);
    prismaMock.quizResult.findMany.mockResolvedValue([
      { quizId: 'quiz-1', scorePercent: 90, passed: true, createdAt: new Date('2026-01-02') },
      { quizId: 'quiz-1', scorePercent: 40, passed: false, createdAt: new Date('2026-01-01') },
    ] as never);

    const res = await makeGet('course-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    const [l1, l2] = body.modules[0].lessons;
    expect(l1).toMatchObject({
      id: 'lesson-1',
      completed: true,
      hasQuiz: true,
      quizResult: { scorePercent: 90, passed: true }, // most recent, not the first row
    });
    expect(l2).toMatchObject({
      id: 'lesson-2',
      completed: false,
      hasQuiz: false,
      quizResult: null,
    });
  });
});

describe('PATCH /api/courses/[courseId]', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePatch('course-1', { title: 'x' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 COURSE_NOT_FOUND when the course does not belong to the community', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue(null);
    const res = await makePatch('course-x', { title: 'x' });
    expect(res.status).toBe(404);
  });

  it('gates on ADMIN, not just MEMBER', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue({ id: 'course-1' } as never);
    prismaMock.course.update.mockResolvedValue({ id: 'course-1' } as never);
    await makePatch('course-1', { title: 'Nouveau titre' });
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });

  it('updates only the provided fields', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue({ id: 'course-1' } as never);
    prismaMock.course.update.mockResolvedValue({ id: 'course-1', title: 'Nouveau titre' } as never);

    const res = await makePatch('course-1', { title: 'Nouveau titre' });
    expect(res.status).toBe(200);
    const arg = prismaMock.course.update.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ id: 'course-1' });
    expect(arg?.data).toEqual({ title: 'Nouveau titre' });
  });
});

describe('DELETE /api/courses/[courseId]', () => {
  it('missing CSRF → 403', async () => {
    const res = await makeDelete('course-1', { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 COURSE_NOT_FOUND when the course does not belong to the community', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue(null);
    const res = await makeDelete('course-x');
    expect(res.status).toBe(404);
    expect(prismaMock.course.delete).not.toHaveBeenCalled();
  });

  it('deletes the course', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.course.findFirst.mockResolvedValue({ id: 'course-1' } as never);

    const res = await makeDelete('course-1');
    expect(res.status).toBe(200);
    expect(prismaMock.course.delete).toHaveBeenCalledWith({ where: { id: 'course-1' } });
  });
});
