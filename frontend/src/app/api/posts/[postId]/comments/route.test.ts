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
vi.mock('@/lib/server/notifications', () => ({
  createNotification: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { awardXp, touchStreak } from '@/lib/server/gamification/xp';
import { createNotification } from '@/lib/server/notifications';
import { GET, POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockAwardXp = vi.mocked(awardXp);
const mockTouchStreak = vi.mocked(touchStreak);
const mockCreateNotification = vi.mocked(createNotification);
const org = { id: 'org-1', slug: 'jey-club' };
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

function makeGet(postId: string) {
  const req = new NextRequest(`http://test/api/posts/${postId}/comments`, { method: 'GET' });
  return GET(req, { params: Promise.resolve({ postId }) });
}

function makePost(postId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/posts/${postId}/comments`, { method: 'POST', headers })
      : new NextRequest(`http://test/api/posts/${postId}/comments`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
  return POST(req, { params: Promise.resolve({ postId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('GET /api/posts/[postId]/comments', () => {
  it('404 POST_NOT_FOUND', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue(null);
    const res = await makeGet('post-1');
    expect(res.status).toBe(404);
  });

  it('lists comments oldest-first', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1' } as never);
    prismaMock.comment.findMany.mockResolvedValue([{ id: 'c1' }] as never);
    const res = await makeGet('post-1');
    expect(res.status).toBe(200);
    const arg = prismaMock.comment.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ postId: 'post-1' });
    expect(arg?.orderBy).toEqual({ createdAt: 'asc' });
  });
});

describe('POST /api/posts/[postId]/comments', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('post-1', { content: 'hello' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 POST_NOT_FOUND', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue(null);
    const res = await makePost('post-1', { content: 'hello' });
    expect(res.status).toBe(404);
  });

  it('empty content → 400 VALIDATION_FAILED', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'author-1' } as never);
    const res = await makePost('post-1', { content: '' });
    expect(res.status).toBe(400);
  });

  it('creates the comment, awards XP, touches the streak, and notifies the author', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'author-1' } as never);
    prismaMock.comment.create.mockResolvedValue({
      id: 'c1',
      content: 'Bravo !',
      author: { id: 'user-1', name: 'Ada', avatarUrl: null },
    } as never);

    const res = await makePost('post-1', { content: 'Bravo !' });
    expect(res.status).toBe(201);
    expect(mockAwardXp).toHaveBeenCalledWith(expect.anything(), 'user-1', 5);
    expect(mockTouchStreak).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);

    const arg = prismaMock.comment.create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({ postId: 'post-1', authorId: 'user-1', content: 'Bravo !' });
  });

  it('does not notify when commenting on your own post', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'user-1' } as never);
    prismaMock.comment.create.mockResolvedValue({
      id: 'c1',
      content: 'Merci',
      author: { id: 'user-1', name: 'Ada', avatarUrl: null },
    } as never);

    await makePost('post-1', { content: 'Merci' });
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
