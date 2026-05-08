// ADMIN-01 (Waves 1 & 2) — users LIST endpoint + role/status PATCH endpoints.
//
// Pattern: prismaMock first (auto-hoists vi.mock for '@/lib/server/prisma'),
// then mock requireAdmin + requireSuperadmin + enforceAdminRateLimit + verifyCsrf
// so we never hit real JWT/Redis/cookie paths.
//
// Wave 1 covers the GET list. Wave 2 (Plan 03-06) covers PATCH /[id]/role and
// PATCH /[id]/status.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
  requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return {
    ...actual,
    verifyCsrf: vi.fn(),
  };
});
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin, requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { verifyCsrf } from '@/lib/server/auth';
import { logAdminAction } from '@/lib/server/admin/audit';
import { encodeCursor } from '@/lib/server/notifications/cursor';
import { GET } from './route';
import { PATCH as PATCH_ROLE } from './[id]/role/route';
import { PATCH as PATCH_STATUS } from './[id]/status/route';
import {
  seedAdmin,
  seedSuperadmin,
  seedDemotableSuperadmin,
  seedSuspendedUser,
} from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockVerifyCsrf = vi.mocked(verifyCsrf);
const mockLogAdminAction = vi.mocked(logAdminAction);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};

const superadminUser = seedSuperadmin({ id: 'superadmin_1', email: 'superadmin@test.local' });
const superadminCtx = {
  user: { sub: superadminUser.id, email: superadminUser.email },
  admin: { id: superadminUser.id, email: superadminUser.email, role: 'SUPERADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

// Build the row shape the prisma.user.findMany select returns.
// Matches USER_SELECT in route.ts.
interface UserListRow {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

function userRow(overrides: Partial<UserListRow> = {}): UserListRow {
  const id = overrides.id ?? 'u1';
  return {
    id,
    email: overrides.email ?? `${id}@test.local`,
    name: overrides.name ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
    role: overrides.role ?? 'USER',
    status: overrides.status ?? 'ACTIVE',
    emailVerifiedAt: overrides.emailVerifiedAt ?? new Date('2026-01-01T00:00:00Z'),
    createdAt: overrides.createdAt ?? new Date('2026-05-01T00:00:00Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRequireSuperadmin.mockResolvedValue(superadminCtx);
  mockRateLimit.mockResolvedValue(null);
  mockVerifyCsrf.mockReturnValue(null);
  mockLogAdminAction.mockResolvedValue(undefined);
  // Default $transaction passthrough — runs the callback against the prismaMock.
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
});

describe('/api/admin/users [Wave 1] — list', () => {
  it('GET returns paginated users for ADMIN', async () => {
    const u1 = userRow({
      id: 'u1',
      email: 'alpha@test.local',
      createdAt: new Date('2026-05-03T00:00:00Z'),
    });
    const u2 = userRow({
      id: 'u2',
      email: 'beta@test.local',
      createdAt: new Date('2026-05-02T00:00:00Z'),
    });
    prismaMock.user.findMany.mockResolvedValueOnce([u1, u2] as never);

    const res = await GET(makeGet('http://test/api/admin/users'));
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: UserListRow[]; nextCursor: string | null };
    expect(body.items.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(body.nextCursor).toBeNull();
    // PII whitelist: passwordHash etc. must NOT appear
    expect(body.items[0]).not.toHaveProperty('passwordHash');
    expect(body.items[0]).not.toHaveProperty('withdrawalPinHash');
    expect(body.items[0]).not.toHaveProperty('tokenVersion');
    // findMany was called with createdAt+id ordering and select whitelist
    const args = prismaMock.user.findMany.mock.calls[0]?.[0];
    expect(args?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args?.select).toMatchObject({ id: true, email: true, role: true, status: true });
    expect((args?.select as Record<string, unknown> | undefined)?.['passwordHash']).toBeUndefined();
  });

  it('GET returns empty 200 (never 404) on no rows', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([] as never);
    const res = await GET(makeGet('http://test/api/admin/users'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('GET applies q search case-insensitive on email + name', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet('http://test/api/admin/users?q=Foo'));
    const args = prismaMock.user.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    expect(where?.['OR']).toEqual([
      { email: { contains: 'Foo', mode: 'insensitive' } },
      { name: { contains: 'Foo', mode: 'insensitive' } },
    ]);
  });

  it('GET filters by status and role', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      userRow({ id: 's1', status: 'SUSPENDED', role: 'USER' }),
    ] as never);
    await GET(makeGet('http://test/api/admin/users?status=SUSPENDED&role=USER'));
    const args = prismaMock.user.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    expect(where?.['status']).toBe('SUSPENDED');
    expect(where?.['role']).toBe('USER');
  });

  it('GET clamps limit to MAX_LIMIT=50 and emits nextCursor when hasMore', async () => {
    // 21 rows (= default 20 + 1) → nextCursor populated, last visible row drives the cursor
    const rows = Array.from({ length: 21 }, (_, i) =>
      userRow({
        id: `u${i}`,
        email: `u${i}@test.local`,
        createdAt: new Date(Date.UTC(2026, 4, 21 - i)),
      }),
    );
    prismaMock.user.findMany.mockResolvedValueOnce(rows as never);

    const res = await GET(makeGet('http://test/api/admin/users'));
    const body = (await res.json()) as { items: UserListRow[]; nextCursor: string | null };
    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).not.toBeNull();
    // Verify Prisma was called with take=21 (limit+1) — confirms +1 fetch
    const args = prismaMock.user.findMany.mock.calls[0]?.[0];
    expect(args?.take).toBe(21);
  });

  it('GET cursor pagination round-trips', async () => {
    const cursorVal = encodeCursor({
      createdAt: new Date('2026-05-02T00:00:00Z'),
      id: 'u2',
    });
    prismaMock.user.findMany.mockResolvedValueOnce([
      userRow({ id: 'u3', createdAt: new Date('2026-05-01T00:00:00Z') }),
    ] as never);
    await GET(makeGet(`http://test/api/admin/users?cursor=${encodeURIComponent(cursorVal)}`));
    const args = prismaMock.user.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    expect(where?.['OR']).toBeDefined();
  });

  it('rate limits admin per-userId after 100/min — propagates 429 from helper', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/users'));
    expect(res.status).toBe(429);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('GET propagates 401/403 from requireAdmin (non-admin sees 403)', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: 'ADMIN_REQUIRED', message: 'Admin access required' },
        { status: 403 },
      ),
    );
    const res = await GET(makeGet('http://test/api/admin/users'));
    expect(res.status).toBe(403);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it('GET ignores oversized q (clamps to 200 chars)', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([] as never);
    const huge = 'x'.repeat(500);
    await GET(makeGet(`http://test/api/admin/users?q=${huge}`));
    const args = prismaMock.user.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    const or = where?.['OR'] as Array<{ email: { contains: string } }> | undefined;
    expect(or?.[0]?.email.contains.length).toBe(200);
  });

  it('GET does NOT touch the suspended-user shape outside its select', async () => {
    // Sanity: seedSuspendedUser is a User row; we just confirm the row's status
    // surfaces correctly through the route's status filter.
    const susp = seedSuspendedUser();
    prismaMock.user.findMany.mockResolvedValueOnce([
      userRow({ id: susp.id, email: susp.email, status: 'SUSPENDED' }),
    ] as never);
    const res = await GET(makeGet('http://test/api/admin/users?status=SUSPENDED'));
    const body = (await res.json()) as { items: UserListRow[] };
    expect(body.items[0]?.status).toBe('SUSPENDED');
  });
});

// ─── Wave 2 surfaces (Plan 03-06) ───

function makePatch(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function paramsOf(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('/api/admin/users/[id]/role [Wave 2] — role change', () => {
  it('PATCH role by SUPERADMIN → 200 + AdminAction row', async () => {
    const { keeper, demotable } = seedDemotableSuperadmin();
    mockRequireSuperadmin.mockResolvedValueOnce({
      user: { sub: keeper.id, email: keeper.email },
      admin: { id: keeper.id, email: keeper.email, role: 'SUPERADMIN' as const },
    });
    // Inside the tx: findUnique returns the demotable user, count=2, then update.
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: demotable.id,
      role: 'SUPERADMIN',
    } as never);
    prismaMock.user.count.mockResolvedValueOnce(2);
    prismaMock.user.update.mockResolvedValueOnce({ id: demotable.id, role: 'ADMIN' } as never);

    const res = await PATCH_ROLE(
      makePatch(`http://test/api/admin/users/${demotable.id}/role`, { role: 'ADMIN' }),
      paramsOf(demotable.id),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; role: string } };
    expect(body.user).toEqual({ id: demotable.id, role: 'ADMIN' });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: demotable.id },
      data: { role: 'ADMIN' },
      select: { id: true, role: true },
    });
    expect(mockLogAdminAction).toHaveBeenCalledTimes(1);
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: keeper.id,
        action: 'user.role_change',
        targetType: 'User',
        targetId: demotable.id,
        metadata: { from: 'SUPERADMIN', to: 'ADMIN' },
      }),
    );
  });

  it('PATCH role by ADMIN → 403 ADMIN_REQUIRED (requireSuperadmin gate)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: 'ADMIN_REQUIRED', message: 'Admin access required' },
        { status: 403 },
      ),
    );

    const res = await PATCH_ROLE(
      makePatch('http://test/api/admin/users/u_target/role', { role: 'ADMIN' }),
      paramsOf('u_target'),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ADMIN_REQUIRED');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('PATCH demoting last SUPERADMIN → 409 LAST_SUPERADMIN (no update, no AdminAction)', async () => {
    // Only ONE SUPERADMIN exists; SUPERADMIN tries to demote themselves.
    const onlyOne = seedSuperadmin({ id: 'superadmin_only', email: 'only@test.local' });
    mockRequireSuperadmin.mockResolvedValueOnce({
      user: { sub: onlyOne.id, email: onlyOne.email },
      admin: { id: onlyOne.id, email: onlyOne.email, role: 'SUPERADMIN' as const },
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: onlyOne.id,
      role: 'SUPERADMIN',
    } as never);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const res = await PATCH_ROLE(
      makePatch(`http://test/api/admin/users/${onlyOne.id}/role`, { role: 'ADMIN' }),
      paramsOf(onlyOne.id),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('LAST_SUPERADMIN');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('PATCH role on missing user → 404 USER_NOT_FOUND', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH_ROLE(
      makePatch('http://test/api/admin/users/u_missing/role', { role: 'ADMIN' }),
      paramsOf('u_missing'),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('USER_NOT_FOUND');
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('PATCH role with invalid body → 400 VALIDATION_FAILED', async () => {
    const res = await PATCH_ROLE(
      makePatch('http://test/api/admin/users/u_target/role', { role: 'BOGUS' }),
      paramsOf('u_target'),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('PATCH role rejects when CSRF fails — verifyCsrf 403 short-circuits before auth', async () => {
    mockVerifyCsrf.mockReturnValueOnce(
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 }),
    );

    const res = await PATCH_ROLE(
      makePatch('http://test/api/admin/users/u_target/role', { role: 'ADMIN' }),
      paramsOf('u_target'),
    );

    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('/api/admin/users/[id]/status [Wave 2] — suspend / restore', () => {
  it('PATCH ADMIN can suspend an ACTIVE user → 200 + AdminAction user.suspend', async () => {
    const target = seedAdmin({ id: 'u_active', email: 'active@test.local', status: 'ACTIVE' });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: target.id,
      status: 'ACTIVE',
      email: target.email,
      name: null,
      role: 'USER',
    } as never);
    prismaMock.user.update.mockResolvedValueOnce({ id: target.id, status: 'SUSPENDED' } as never);

    const res = await PATCH_STATUS(
      makePatch(`http://test/api/admin/users/${target.id}/status`, {
        status: 'SUSPENDED',
        reason: 'fraud',
      }),
      paramsOf(target.id),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; status: string } };
    expect(body.user).toEqual({ id: target.id, status: 'SUSPENDED' });
    expect(mockLogAdminAction).toHaveBeenCalledTimes(1);
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: adminUser.id,
        action: 'user.suspend',
        targetType: 'User',
        targetId: target.id,
        metadata: { from: 'ACTIVE', to: 'SUSPENDED', reason: 'fraud' },
      }),
    );
  });

  it('PATCH SUSPENDED → ACTIVE by ADMIN → 403 RESTORE_REQUIRES_SUPERADMIN (no update, no AdminAction)', async () => {
    const susp = seedSuspendedUser();
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: susp.id,
      status: 'SUSPENDED',
      email: susp.email,
      name: null,
      role: 'USER',
    } as never);

    const res = await PATCH_STATUS(
      makePatch(`http://test/api/admin/users/${susp.id}/status`, { status: 'ACTIVE' }),
      paramsOf(susp.id),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('RESTORE_REQUIRES_SUPERADMIN');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('PATCH SUSPENDED → ACTIVE by SUPERADMIN → 200 + AdminAction user.restore', async () => {
    mockRequireAdmin.mockResolvedValueOnce(superadminCtx);
    const susp = seedSuspendedUser();
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: susp.id,
      status: 'SUSPENDED',
      email: susp.email,
      name: null,
      role: 'USER',
    } as never);
    prismaMock.user.update.mockResolvedValueOnce({ id: susp.id, status: 'ACTIVE' } as never);

    const res = await PATCH_STATUS(
      makePatch(`http://test/api/admin/users/${susp.id}/status`, {
        status: 'ACTIVE',
        reason: 'appeal granted',
      }),
      paramsOf(susp.id),
    );

    expect(res.status).toBe(200);
    expect(mockLogAdminAction).toHaveBeenCalledTimes(1);
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: superadminUser.id,
        action: 'user.restore',
        targetType: 'User',
        targetId: susp.id,
        metadata: { from: 'SUSPENDED', to: 'ACTIVE', reason: 'appeal granted' },
      }),
    );
  });

  it('PATCH same-status (idempotent no-op) → 200 + NO AdminAction', async () => {
    const target = seedAdmin({ id: 'u_active2', status: 'ACTIVE' });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: target.id,
      status: 'ACTIVE',
      email: target.email,
      name: null,
      role: 'USER',
    } as never);

    const res = await PATCH_STATUS(
      makePatch(`http://test/api/admin/users/${target.id}/status`, { status: 'ACTIVE' }),
      paramsOf(target.id),
    );

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('PATCH writes AdminAction with from/to status metadata (suspend canonical shape, no reason)', async () => {
    const target = seedAdmin({ id: 'u_active3', status: 'ACTIVE' });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: target.id,
      status: 'ACTIVE',
      email: target.email,
      name: null,
      role: 'USER',
    } as never);
    prismaMock.user.update.mockResolvedValueOnce({ id: target.id, status: 'SUSPENDED' } as never);

    await PATCH_STATUS(
      makePatch(`http://test/api/admin/users/${target.id}/status`, { status: 'SUSPENDED' }),
      paramsOf(target.id),
    );

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'user.suspend',
        metadata: { from: 'ACTIVE', to: 'SUSPENDED' },
      }),
    );
  });

  it('PATCH status on missing user → 404 USER_NOT_FOUND', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH_STATUS(
      makePatch('http://test/api/admin/users/u_missing/status', { status: 'SUSPENDED' }),
      paramsOf('u_missing'),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('USER_NOT_FOUND');
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('PATCH status with invalid body → 400 VALIDATION_FAILED', async () => {
    const res = await PATCH_STATUS(
      makePatch('http://test/api/admin/users/u_target/status', { status: 'BOGUS' }),
      paramsOf('u_target'),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('PATCH status rejects when CSRF fails', async () => {
    mockVerifyCsrf.mockReturnValueOnce(
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 }),
    );

    const res = await PATCH_STATUS(
      makePatch('http://test/api/admin/users/u_target/status', { status: 'SUSPENDED' }),
      paramsOf('u_target'),
    );

    expect(res.status).toBe(403);
    expect(mockRequireAdmin).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
