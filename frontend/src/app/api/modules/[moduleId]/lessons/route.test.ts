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
const moduleRow = { id: 'mod-1', course: { organizationId: 'org-1' } };

function makePost(moduleId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/modules/${moduleId}/lessons`, {
          method: 'POST',
          headers,
        })
      : new NextRequest(`http://test/api/modules/${moduleId}/lessons`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
  return POST(req, { params: Promise.resolve({ moduleId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('POST /api/modules/[moduleId]/lessons', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('mod-1', { title: 'Leçon 1' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 MODULE_NOT_FOUND', async () => {
    prismaMock.module.findUnique.mockResolvedValue(null);
    const res = await makePost('mod-x', { title: 'Leçon 1' });
    expect(res.status).toBe(404);
  });

  it('gates on the org the module belongs to (ADMIN)', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    prismaMock.lesson.count.mockResolvedValue(0);
    prismaMock.lesson.create.mockResolvedValue({ id: 'lesson-1' } as never);
    await makePost('mod-1', { title: 'Leçon 1' });
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });

  it('empty title → 400 VALIDATION_FAILED', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    const res = await makePost('mod-1', { title: '' });
    expect(res.status).toBe(400);
  });

  it('invalid videoUrl → 400 VALIDATION_FAILED', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    const res = await makePost('mod-1', { title: 'Leçon 1', videoUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('creates the lesson with the next append order and null defaults', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    prismaMock.lesson.count.mockResolvedValue(1);
    prismaMock.lesson.create.mockResolvedValue({ id: 'lesson-2' } as never);

    const res = await makePost('mod-1', { title: 'Leçon 2' });
    expect(res.status).toBe(201);
    const arg = prismaMock.lesson.create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({
      moduleId: 'mod-1',
      title: 'Leçon 2',
      videoUrl: null,
      descriptionHtml: null,
      durationSeconds: null,
      order: 1,
    });
  });
});
