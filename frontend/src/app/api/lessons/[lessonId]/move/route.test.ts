import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};
const lessonRow = {
  id: 'lesson-2',
  order: 1,
  moduleId: 'mod-1',
  module: { course: { organizationId: 'org-1' } },
};
const siblings = [
  { id: 'lesson-1', order: 0 },
  { id: 'lesson-2', order: 1 },
];

function makePost(lessonId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/lessons/${lessonId}/move`, { method: 'POST', headers })
      : new NextRequest(`http://test/api/lessons/${lessonId}/move`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
  return POST(req, { params: Promise.resolve({ lessonId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('POST /api/lessons/[lessonId]/move', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('lesson-2', { direction: 'down' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 LESSON_NOT_FOUND', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await makePost('lesson-x', { direction: 'down' });
    expect(res.status).toBe(404);
  });

  it('gates on the org the lesson belongs to (ADMIN)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.lesson.findMany.mockResolvedValue(siblings as never);
    await makePost('lesson-2', { direction: 'up' });
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });

  it('moving the last lesson down → 400 CANNOT_MOVE', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.lesson.findMany.mockResolvedValue(siblings as never);
    const res = await makePost('lesson-2', { direction: 'down' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('CANNOT_MOVE');
  });

  it('swaps order with the next sibling when moving down', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      ...lessonRow,
      id: 'lesson-1',
      order: 0,
    } as never);
    prismaMock.lesson.findMany.mockResolvedValue(siblings as never);

    const res = await makePost('lesson-1', { direction: 'down' });
    expect(res.status).toBe(200);
    expect(prismaMock.lesson.update).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: { order: 1 },
    });
    expect(prismaMock.lesson.update).toHaveBeenCalledWith({
      where: { id: 'lesson-2' },
      data: { order: 0 },
    });
  });
});
