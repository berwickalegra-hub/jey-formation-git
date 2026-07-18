import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
  optionalAuth: vi.fn(),
}));

import { requireAuth, optionalAuth } from '@/lib/server/middleware';
import { GET, POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockOptionalAuth = vi.mocked(optionalAuth);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

const org = {
  id: 'org-1',
  slug: 'ma-formation',
  name: 'Ma Formation',
  ownerId: 'owner-1',
  description: 'desc',
  tagline: 'tag',
  coverImageUrl: null,
  logoUrl: null,
  visibility: 'PUBLIC',
  priceAmount: 150000,
  pricePeriod: 'an',
  currency: 'XOF',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/community', { method: 'GET' });
}

function makePost(opts: { csrf?: 'match' | 'missing' } = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = {};
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/community', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockOptionalAuth.mockResolvedValue(null);
});

describe('GET /api/community', () => {
  it('404 COMMUNITY_NOT_CONFIGURED when no organization is seeded', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('COMMUNITY_NOT_CONFIGURED');
  });

  it('unauthenticated visitor gets community info with me: null', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.organizationMember.count.mockResolvedValue(42);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      name: 'Coach',
      avatarUrl: null,
    } as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.community.slug).toBe('ma-formation');
    expect(body.community.memberCount).toBe(42);
    expect(body.owner).toEqual({ id: 'owner-1', name: 'Coach', avatarUrl: null });
    expect(body.me).toBeNull();
  });

  it('authenticated member gets role/xp/level/streak in `me`', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.organizationMember.count.mockResolvedValue(1);
    mockOptionalAuth.mockResolvedValue(authedCtx);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: 'owner-1', name: 'Coach', avatarUrl: null } as never) // owner lookup
      .mockResolvedValueOnce({
        xp: 120,
        level: 2,
        streakCount: 3,
        name: 'Membre Un',
        avatarUrl: null,
      } as never); // current-user lookup
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: 'MEMBER',
    } as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.me).toEqual({
      role: 'MEMBER',
      xp: 120,
      level: 2,
      streakCount: 3,
      name: 'Membre Un',
      avatarUrl: null,
    });
  });

  it('authenticated but not a member → me: null', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.organizationMember.count.mockResolvedValue(1);
    mockOptionalAuth.mockResolvedValue(authedCtx);
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      name: 'Coach',
      avatarUrl: null,
    } as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.me).toBeNull();
  });
});

describe('POST /api/community/join', () => {
  it('missing CSRF → 403', async () => {
    const res = await POST(makePost({ csrf: 'missing' }));
    expect(res.status).toBe(403);
    expect(prismaMock.organizationMember.upsert).not.toHaveBeenCalled();
  });

  it('requireAuth bail → 401', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost());
    expect(res.status).toBe(401);
  });

  it('404 when no community is seeded', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const res = await POST(makePost());
    expect(res.status).toBe(404);
  });

  it('creates (or reuses) a MEMBER row and returns 201', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.organizationMember.upsert.mockResolvedValue({ role: 'MEMBER' } as never);

    const res = await POST(makePost());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ role: 'MEMBER', organizationId: 'org-1' });

    const arg = prismaMock.organizationMember.upsert.mock.calls[0]?.[0];
    expect(arg?.where?.organizationId_userId).toEqual({
      organizationId: 'org-1',
      userId: 'user-1',
    });
    expect(arg?.create).toEqual({ organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' });
  });
});
