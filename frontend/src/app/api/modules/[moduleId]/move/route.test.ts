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
const moduleRow = {
  id: 'mod-2',
  order: 1,
  courseId: 'course-1',
  course: { organizationId: 'org-1' },
};
const siblings = [
  { id: 'mod-1', order: 0 },
  { id: 'mod-2', order: 1 },
  { id: 'mod-3', order: 2 },
];

function makePost(moduleId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/modules/${moduleId}/move`, { method: 'POST', headers })
      : new NextRequest(`http://test/api/modules/${moduleId}/move`, {
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

describe('POST /api/modules/[moduleId]/move', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePost('mod-2', { direction: 'up' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 MODULE_NOT_FOUND', async () => {
    prismaMock.module.findUnique.mockResolvedValue(null);
    const res = await makePost('mod-x', { direction: 'up' });
    expect(res.status).toBe(404);
  });

  it('gates on the org the module belongs to (ADMIN)', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    prismaMock.module.findMany.mockResolvedValue(siblings as never);
    await makePost('mod-2', { direction: 'up' });
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });

  it('invalid direction → 400 VALIDATION_FAILED', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    const res = await makePost('mod-2', { direction: 'sideways' });
    expect(res.status).toBe(400);
  });

  it('moving the first module up → 400 CANNOT_MOVE', async () => {
    prismaMock.module.findUnique.mockResolvedValue({
      ...moduleRow,
      id: 'mod-1',
      order: 0,
    } as never);
    prismaMock.module.findMany.mockResolvedValue(siblings as never);
    const res = await makePost('mod-1', { direction: 'up' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('CANNOT_MOVE');
  });

  it('moving the last module down → 400 CANNOT_MOVE', async () => {
    prismaMock.module.findUnique.mockResolvedValue({
      ...moduleRow,
      id: 'mod-3',
      order: 2,
    } as never);
    prismaMock.module.findMany.mockResolvedValue(siblings as never);
    const res = await makePost('mod-3', { direction: 'down' });
    expect(res.status).toBe(400);
  });

  it('swaps order with the previous sibling when moving up', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    prismaMock.module.findMany.mockResolvedValue(siblings as never);

    const res = await makePost('mod-2', { direction: 'up' });
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.module.update).toHaveBeenCalledWith({
      where: { id: 'mod-2' },
      data: { order: 0 },
    });
    expect(prismaMock.module.update).toHaveBeenCalledWith({
      where: { id: 'mod-1' },
      data: { order: 1 },
    });
  });
});
