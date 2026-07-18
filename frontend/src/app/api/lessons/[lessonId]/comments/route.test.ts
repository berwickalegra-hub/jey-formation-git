import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));
vi.mock('@/lib/server/gamification/xp', () => ({
  awardXp: vi.fn(),
  touchStreak: vi.fn(),
  XP_AWARD: { POST: 10, COMMENT: 5, LESSON_COMPLETE: 15 },
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { awardXp, touchStreak } from '@/lib/server/gamification/xp';
import { GET, POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockAwardXp = vi.mocked(awardXp);
const mockTouchStreak = vi.mocked(touchStreak);
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};
const lessonRow = { id: 'lesson-1', module: { course: { organizationId: 'org-1' } } };

function makeGet(lessonId: string) {
  const req = new NextRequest(`http://test/api/lessons/${lessonId}/comments`, { method: 'GET' });
  return GET(req, { params: Promise.resolve({ lessonId }) });
}

function makePost(lessonId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/lessons/${lessonId}/comments`, { method: 'POST', headers })
      : new NextRequest(`http://test/api/lessons/${lessonId}/comments`, {
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

describe('GET /api/lessons/[lessonId]/comments', () => {
  it('404 LESSON_NOT_FOUND', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await makeGet('missing');
    expect(res.status).toBe(404);
  });

  it('lists comments oldest-first', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.comment.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }] as never);
    const res = await makeGet('lesson-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    const arg = prismaMock.comment.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ lessonId: 'lesson-1' });
    expect(arg?.orderBy).toEqual({ createdAt: 'asc' });
  });
});

describe('POST /api/lessons/[lessonId]/comments', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('lesson-1', { content: 'hello' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('empty content → 400 VALIDATION_FAILED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    const res = await makePost('lesson-1', { content: '' });
    expect(res.status).toBe(400);
  });

  it('creates the comment and awards XP + touches the streak', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.comment.create.mockResolvedValue({ id: 'c1', content: 'Super leçon' } as never);

    const res = await makePost('lesson-1', { content: 'Super leçon' });
    expect(res.status).toBe(201);
    expect(mockAwardXp).toHaveBeenCalledWith(expect.anything(), 'user-1', 5);
    expect(mockTouchStreak).toHaveBeenCalledWith(expect.anything(), 'user-1');

    const arg = prismaMock.comment.create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({ lessonId: 'lesson-1', authorId: 'user-1', content: 'Super leçon' });
  });
});
