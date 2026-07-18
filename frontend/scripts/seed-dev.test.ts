// SCRIPT-01 — companion unit test for `scripts/seed-dev.ts`.
//
// Asserts:
//   1. NODE_ENV=production refuses with exit 1 BEFORE any prisma call (Rule 2 —
//      production-safety; matches the threat model T-06-01-02 mitigation).
//   2. 3 seed users are upserted (idempotent — runs upsert, not create).
//   3. The first call's `create.passwordHash` matches the bcrypt prefix
//      `$2[ab]$` and never contains plaintext.
//
// Tests invoke `main([], { prisma })` directly with a mocked Prisma client
// (no subprocess spawn, no real DB). The CLI entrypoint guard
// (`if (import.meta.url === ...)`) keeps the auto-run path inert when
// imported by Vitest.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { main, seedCommunity } from './seed-dev';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

const ORIG_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  mockReset(prismaMock);
});

afterEach(() => {
  process.env.NODE_ENV = ORIG_NODE_ENV;
  vi.restoreAllMocks();
});

describe('scripts/seed-dev (SCRIPT-01)', () => {
  it('refuses to run with NODE_ENV=production and exits 1 BEFORE any prisma call', async () => {
    process.env.NODE_ENV = 'production';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit:${code}__`);
    }) as never);

    await expect(main([], { prisma: prismaMock })).rejects.toThrow('__exit:1__');
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/production/i));
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('upserts each seed user (idempotent — runs upsert, not create)', async () => {
    process.env.NODE_ENV = 'test';
    prismaMock.user.upsert.mockResolvedValue({
      email: 'admin@example.com',
      role: 'SUPERADMIN',
      emailVerifiedAt: new Date(),
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    // 3 seed users → 3 upserts (admin, user, unverified).
    expect(prismaMock.user.upsert).toHaveBeenCalledTimes(3);
    const firstCall = prismaMock.user.upsert.mock.calls[0]?.[0];
    expect(firstCall?.where).toEqual({ email: 'admin@example.com' });
    expect(firstCall?.create).toMatchObject({
      email: 'admin@example.com',
      role: 'SUPERADMIN',
    });
  });

  it('hashes passwords with bcrypt before upsert (never plaintext)', async () => {
    process.env.NODE_ENV = 'test';
    prismaMock.user.upsert.mockResolvedValue({
      email: 'admin@example.com',
      role: 'SUPERADMIN',
      emailVerifiedAt: new Date(),
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    const firstCall = prismaMock.user.upsert.mock.calls[0]?.[0];
    const create = firstCall?.create as { passwordHash: string };
    expect(create.passwordHash).toMatch(/^\$2[ab]\$/); // bcrypt prefix
    expect(create.passwordHash).not.toContain('AdminPassword123!'); // never plaintext

    // The update branch also receives the bcrypt-hashed password.
    const update = firstCall?.update as { passwordHash: string };
    expect(update.passwordHash).toMatch(/^\$2[ab]\$/);
    expect(update.passwordHash).not.toContain('AdminPassword123!');
  });

  it('marks the unverified seed user with emailVerifiedAt=null', async () => {
    process.env.NODE_ENV = 'test';
    prismaMock.user.upsert.mockResolvedValue({
      email: 'x',
      role: 'USER',
      emailVerifiedAt: null,
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    // The third seed user (`unverified@example.com`) has skipVerify=true.
    const thirdCall = prismaMock.user.upsert.mock.calls[2]?.[0];
    expect(thirdCall?.where).toEqual({ email: 'unverified@example.com' });
    expect((thirdCall?.create as { emailVerifiedAt: Date | null }).emailVerifiedAt).toBeNull();
  });
});

describe('seedCommunity', () => {
  const org = { id: 'org-1', slug: 'jey-club', name: 'Jey-club' };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    prismaMock.organization.upsert.mockResolvedValue(org as never);
  });

  it('upserts the organization by slug and both memberships', async () => {
    prismaMock.postCategory.count.mockResolvedValue(1);
    prismaMock.course.count.mockResolvedValue(1);
    prismaMock.post.count.mockResolvedValue(1);
    prismaMock.document.count.mockResolvedValue(1);
    prismaMock.event.count.mockResolvedValue(1);

    await seedCommunity(prismaMock, 'owner-1', 'member-1');

    expect(prismaMock.organization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'jey-club' } }),
    );
    expect(prismaMock.organizationMember.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.organizationMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_userId: { organizationId: 'org-1', userId: 'owner-1' } },
        create: { organizationId: 'org-1', userId: 'owner-1', role: 'OWNER' },
      }),
    );
    expect(prismaMock.organizationMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_userId: { organizationId: 'org-1', userId: 'member-1' } },
        create: { organizationId: 'org-1', userId: 'member-1', role: 'MEMBER' },
      }),
    );
  });

  it('skips demo content that already exists (idempotent re-run)', async () => {
    prismaMock.postCategory.count.mockResolvedValue(3);
    prismaMock.course.count.mockResolvedValue(1);
    prismaMock.post.count.mockResolvedValue(2);
    prismaMock.document.count.mockResolvedValue(2);
    prismaMock.event.count.mockResolvedValue(1);

    await seedCommunity(prismaMock, 'owner-1', 'member-1');

    expect(prismaMock.postCategory.create).not.toHaveBeenCalled();
    expect(prismaMock.course.create).not.toHaveBeenCalled();
    expect(prismaMock.post.create).not.toHaveBeenCalled();
    expect(prismaMock.document.create).not.toHaveBeenCalled();
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it('creates the demo course as one nested write (modules → lessons → quiz)', async () => {
    prismaMock.postCategory.count.mockResolvedValue(1);
    prismaMock.course.count.mockResolvedValue(0);
    prismaMock.post.count.mockResolvedValue(1);
    prismaMock.document.count.mockResolvedValue(1);
    prismaMock.event.count.mockResolvedValue(1);
    prismaMock.course.create.mockResolvedValue({ id: 'course-1' } as never);

    await seedCommunity(prismaMock, 'owner-1', 'member-1');

    expect(prismaMock.course.create).toHaveBeenCalledTimes(1);
    const arg = prismaMock.course.create.mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({ organizationId: 'org-1', title: 'Fondations' });
    const modulesCreate = (arg?.data as { modules: { create: unknown[] } }).modules.create;
    expect(modulesCreate).toHaveLength(2);
  });

  it('creates the pinned welcome post, a reply comment, and a like', async () => {
    prismaMock.postCategory.count.mockResolvedValue(1);
    prismaMock.course.count.mockResolvedValue(1);
    prismaMock.post.count.mockResolvedValue(0);
    prismaMock.document.count.mockResolvedValue(1);
    prismaMock.event.count.mockResolvedValue(1);
    prismaMock.postCategory.findFirst.mockResolvedValue({ id: 'cat-1' } as never);
    prismaMock.post.create.mockResolvedValueOnce({ id: 'post-1' } as never);
    prismaMock.post.create.mockResolvedValueOnce({ id: 'post-2' } as never);

    await seedCommunity(prismaMock, 'owner-1', 'member-1');

    expect(prismaMock.post.create).toHaveBeenCalledTimes(2);
    const firstPost = prismaMock.post.create.mock.calls[0]?.[0];
    expect(firstPost?.data).toMatchObject({
      authorId: 'owner-1',
      isPinned: true,
      categoryId: 'cat-1',
    });

    expect(prismaMock.comment.create).toHaveBeenCalledWith({
      data: { postId: 'post-1', authorId: 'member-1', content: expect.any(String) },
    });
    expect(prismaMock.like.create).toHaveBeenCalledWith({
      data: { postId: 'post-1', userId: 'member-1' },
    });
  });
});
