import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));
vi.mock('@/lib/server/notifications', () => ({
  createNotification: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { createNotification } from '@/lib/server/notifications';
import { POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockCreateNotification = vi.mocked(createNotification);
const org = { id: 'org-1', slug: 'jey-club' };
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};

function makePost(postId: string, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = {};
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req = new NextRequest(`http://test/api/posts/${postId}/like`, { method: 'POST', headers });
  return POST(req, { params: Promise.resolve({ postId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('POST /api/posts/[postId]/like', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('post-1', { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 POST_NOT_FOUND', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue(null);
    const res = await makePost('post-1');
    expect(res.status).toBe(404);
  });

  it('likes when not already liked and notifies the author', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'author-1' } as never);
    prismaMock.like.findUnique.mockResolvedValue(null);
    prismaMock.like.count.mockResolvedValue(4);

    const res = await makePost('post-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ liked: true, likeCount: 4 });
    expect(prismaMock.like.create).toHaveBeenCalledWith({
      data: { postId: 'post-1', userId: 'user-1' },
    });
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
  });

  it('does not notify when liking your own post', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'user-1' } as never);
    prismaMock.like.findUnique.mockResolvedValue(null);
    prismaMock.like.count.mockResolvedValue(1);

    await makePost('post-1');
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('unlikes when already liked', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.post.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'author-1' } as never);
    prismaMock.like.findUnique.mockResolvedValue({ id: 'like-1' } as never);
    prismaMock.like.count.mockResolvedValue(3);

    const res = await makePost('post-1');
    const body = await res.json();
    expect(body).toEqual({ liked: false, likeCount: 3 });
    expect(prismaMock.like.delete).toHaveBeenCalledWith({ where: { id: 'like-1' } });
    expect(prismaMock.like.create).not.toHaveBeenCalled();
  });
});
