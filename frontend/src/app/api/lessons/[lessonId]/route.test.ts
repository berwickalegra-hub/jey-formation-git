import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};
const lessonRow = { id: 'lesson-1', module: { course: { organizationId: 'org-1' } } };

function makePatch(lessonId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/lessons/${lessonId}`, { method: 'PATCH', headers })
      : new NextRequest(`http://test/api/lessons/${lessonId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body),
        });
  return PATCH(req, { params: Promise.resolve({ lessonId }) });
}

function makeDelete(lessonId: string, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = {};
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req = new NextRequest(`http://test/api/lessons/${lessonId}`, {
    method: 'DELETE',
    headers,
  });
  return DELETE(req, { params: Promise.resolve({ lessonId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('PATCH /api/lessons/[lessonId]', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePatch('lesson-1', { title: 'x' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 LESSON_NOT_FOUND', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await makePatch('lesson-x', { title: 'x' });
    expect(res.status).toBe(404);
  });

  it('gates on the org the lesson belongs to (ADMIN)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.lesson.update.mockResolvedValue({ id: 'lesson-1' } as never);
    await makePatch('lesson-1', { title: 'Nouveau titre' });
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });

  it('updates only the provided fields', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.lesson.update.mockResolvedValue({ id: 'lesson-1', title: 'Nouveau titre' } as never);

    const res = await makePatch('lesson-1', { title: 'Nouveau titre' });
    expect(res.status).toBe(200);
    expect(prismaMock.lesson.update).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: { title: 'Nouveau titre' },
    });
  });
});

describe('DELETE /api/lessons/[lessonId]', () => {
  it('missing CSRF → 403', async () => {
    const res = await makeDelete('lesson-1', { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 LESSON_NOT_FOUND', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await makeDelete('lesson-x');
    expect(res.status).toBe(404);
    expect(prismaMock.lesson.delete).not.toHaveBeenCalled();
  });

  it('deletes the lesson', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    const res = await makeDelete('lesson-1');
    expect(res.status).toBe(200);
    expect(prismaMock.lesson.delete).toHaveBeenCalledWith({ where: { id: 'lesson-1' } });
  });
});
