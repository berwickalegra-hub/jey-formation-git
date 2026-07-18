import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
import { POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockAwardXp = vi.mocked(awardXp);
const mockTouchStreak = vi.mocked(touchStreak);
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

function makePost(lessonId: string, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = {};
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req = new NextRequest(`http://test/api/lessons/${lessonId}/complete`, {
    method: 'POST',
    headers,
  });
  return POST(req, { params: Promise.resolve({ lessonId }) });
}

const lessonRow = { id: 'lesson-1', module: { course: { organizationId: 'org-1' } } };

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('POST /api/lessons/[lessonId]/complete', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('lesson-1', { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 LESSON_NOT_FOUND when the lesson does not exist', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await makePost('missing-lesson');
    expect(res.status).toBe(404);
  });

  it('gates on the org the lesson actually belongs to (via course.organizationId)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.lessonProgress.upsert.mockResolvedValue({ completed: true } as never);
    await makePost('lesson-1');
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'MEMBER', null);
  });

  it('first completion (false→true) awards XP and touches the streak', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.lessonProgress.findUnique.mockResolvedValue(null);
    prismaMock.lessonProgress.upsert.mockResolvedValue({ completed: true } as never);

    const res = await makePost('lesson-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ completed: true });
    expect(mockAwardXp).toHaveBeenCalledWith(expect.anything(), 'user-1', 15);
    expect(mockTouchStreak).toHaveBeenCalledWith(expect.anything(), 'user-1');

    const upsertArg = prismaMock.lessonProgress.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create?.completed).toBe(true);
  });

  it('un-checking (true→false) does not award XP again', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    prismaMock.lessonProgress.findUnique.mockResolvedValue({ completed: true } as never);
    prismaMock.lessonProgress.upsert.mockResolvedValue({ completed: false } as never);

    const res = await makePost('lesson-1');
    const body = await res.json();
    expect(body).toEqual({ completed: false });
    expect(mockAwardXp).not.toHaveBeenCalled();
    expect(mockTouchStreak).not.toHaveBeenCalled();
  });

  it('org-role gate failure is returned as-is, no progress write', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonRow as never);
    mockRequireOrgRole.mockResolvedValueOnce(
      NextResponse.json({ error: 'Organization not found' }, { status: 404 }),
    );
    const res = await makePost('lesson-1');
    expect(res.status).toBe(404);
    expect(prismaMock.lessonProgress.upsert).not.toHaveBeenCalled();
  });
});
