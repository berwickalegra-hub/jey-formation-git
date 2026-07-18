import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
};
const moduleRow = { id: 'mod-1', course: { organizationId: 'org-1' } };

function makePatch(moduleId: string, body?: unknown, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req =
    body === undefined
      ? new NextRequest(`http://test/api/modules/${moduleId}`, { method: 'PATCH', headers })
      : new NextRequest(`http://test/api/modules/${moduleId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body),
        });
  return PATCH(req, { params: Promise.resolve({ moduleId }) });
}

function makeDelete(moduleId: string, opts: { csrf?: 'match' | 'missing' } = {}) {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = {};
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const req = new NextRequest(`http://test/api/modules/${moduleId}`, {
    method: 'DELETE',
    headers,
  });
  return DELETE(req, { params: Promise.resolve({ moduleId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
});

describe('PATCH /api/modules/[moduleId]', () => {
  it('missing CSRF → 403', async () => {
    const res = await makePatch('mod-1', { title: 'x' }, { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 MODULE_NOT_FOUND', async () => {
    prismaMock.module.findUnique.mockResolvedValue(null);
    const res = await makePatch('mod-x', { title: 'x' });
    expect(res.status).toBe(404);
  });

  it('gates on the org the module belongs to (ADMIN)', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    prismaMock.module.update.mockResolvedValue({ id: 'mod-1' } as never);
    await makePatch('mod-1', { title: 'Nouveau titre' });
    expect(mockRequireOrgRole).toHaveBeenCalledWith('org-1', 'ADMIN', null);
  });

  it('renames the module', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    prismaMock.module.update.mockResolvedValue({ id: 'mod-1', title: 'Nouveau titre' } as never);

    const res = await makePatch('mod-1', { title: 'Nouveau titre' });
    expect(res.status).toBe(200);
    expect(prismaMock.module.update).toHaveBeenCalledWith({
      where: { id: 'mod-1' },
      data: { title: 'Nouveau titre' },
    });
  });
});

describe('DELETE /api/modules/[moduleId]', () => {
  it('missing CSRF → 403', async () => {
    const res = await makeDelete('mod-1', { csrf: 'missing' });
    expect(res.status).toBe(403);
  });

  it('404 MODULE_NOT_FOUND', async () => {
    prismaMock.module.findUnique.mockResolvedValue(null);
    const res = await makeDelete('mod-x');
    expect(res.status).toBe(404);
    expect(prismaMock.module.delete).not.toHaveBeenCalled();
  });

  it('deletes the module', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleRow as never);
    const res = await makeDelete('mod-1');
    expect(res.status).toBe(200);
    expect(prismaMock.module.delete).toHaveBeenCalledWith({ where: { id: 'mod-1' } });
  });
});
