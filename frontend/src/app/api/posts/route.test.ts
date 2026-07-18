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
import { GET, POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockAwardXp = vi.mocked(awardXp);
const mockTouchStreak = vi.mocked(touchStreak);
const org = { id: 'org-1', slug: 'jey-club' };
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

const postRow = {
  id: 'post-1',
  title: null,
  content: 'Salut la team',
  mediaUrl: null,
  mediaType: null,
  isPinned: false,
  createdAt: new Date('2026-01-01'),
  author: { id: 'user-1', name: 'Ada', avatarUrl: null, level: 2 },
  category: null,
  _count: { comments: 3, likes: 5 },
  likes: [],
};

function makeGet(qs = ''): NextRequest {
  return new NextRequest(`http://test/api/posts${qs}`, { method: 'GET' });
}

function makePost(body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return body === undefined
    ? new NextRequest('http://test/api/posts', { method: 'POST', headers })
    : new NextRequest('http://test/api/posts', {
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

describe('GET /api/posts', () => {
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
    expect(prismaMock.post.findMany).not.toHaveBeenCalled();
  });

  it('returns pinned + paginated feed with likedByMe/commentCount/likeCount', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...postRow, likes: [{ id: 'like-1' }] }] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pinned).toEqual([]);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'post-1',
      commentCount: 3,
      likeCount: 5,
      likedByMe: true,
    });
    expect(body.nextCursor).toBeNull();
  });

  it('filters by categoryId when provided', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findMany.mockResolvedValue([] as never);
    await GET(makeGet('?categoryId=cat-1'));
    const pinnedArg = prismaMock.post.findMany.mock.calls[0]?.[0];
    expect(pinnedArg?.where).toMatchObject({ categoryId: 'cat-1', isPinned: true });
  });
});

describe('POST /api/posts', () => {
  it('missing CSRF → 403', async () => {
    const res = await POST(makePost({ content: 'hey' }, { csrf: 'missing' }));
    expect(res.status).toBe(403);
  });

  it('empty content → 400 VALIDATION_FAILED', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    const res = await POST(makePost({ content: '' }));
    expect(res.status).toBe(400);
  });

  it('mediaUrl without mediaType → 400 VALIDATION_FAILED', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    const res = await POST(makePost({ content: 'hey', mediaUrl: 'https://x.com/a.png' }));
    expect(res.status).toBe(400);
  });

  it('unknown categoryId → 400 CATEGORY_NOT_FOUND', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.postCategory.findFirst.mockResolvedValue(null);
    const res = await POST(makePost({ content: 'hey', categoryId: 'nope' }));
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toBe('CATEGORY_NOT_FOUND');
  });

  it('creates the post and awards XP + touches the streak', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.create.mockResolvedValue(postRow as never);

    const res = await POST(makePost({ content: 'Salut la team' }));
    expect(res.status).toBe(201);
    expect(mockAwardXp).toHaveBeenCalledWith(expect.anything(), 'user-1', 10);
    expect(mockTouchStreak).toHaveBeenCalledWith(expect.anything(), 'user-1');

    const arg = prismaMock.post.create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({
      organizationId: 'org-1',
      authorId: 'user-1',
      content: 'Salut la team',
      title: null,
      categoryId: null,
      mediaUrl: null,
      mediaType: null,
    });
  });
});
