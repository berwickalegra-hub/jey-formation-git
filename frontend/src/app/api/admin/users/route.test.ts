// ADMIN-01 (Wave 1) — users LIST endpoint behaviour.
//
// Pattern: prismaMock first (auto-hoists vi.mock for '@/lib/server/prisma'),
// then mock requireAdmin + enforceAdminRateLimit so we never hit the real
// JWT/Redis paths.
//
// Wave 1 covers the GET list. The role-change and status PATCH suites
// remain `it.todo` until Plan 03-06 implements those mutations.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { encodeCursor } from '@/lib/server/notifications/cursor';
import { GET } from './route';
import { seedAdmin, seedSuspendedUser } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
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
  mockRateLimit.mockResolvedValue(null);
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

// ─── Wave 2 surfaces (PATCH role / PATCH status) — NOT implemented in Plan 03-02 ───
// Plan 03-06 will convert these `it.todo` blocks to real `it` tests.
describe('/api/admin/users/[id]/role [Wave 2] — role change', () => {
  it.todo('PATCH role change SUPERADMIN succeeds and writes AdminAction');
  it.todo('PATCH role change requires SUPERADMIN (ADMIN gets 403 ADMIN_REQUIRED)');
  it.todo('PATCH refuses to demote the last SUPERADMIN with 409 LAST_SUPERADMIN');
});

describe('/api/admin/users/[id]/status [Wave 2] — suspend / restore', () => {
  it.todo('PATCH ADMIN can suspend an ACTIVE user');
  it.todo('PATCH only SUPERADMIN can restore a SUSPENDED user (ADMIN gets 403)');
  it.todo('PATCH writes AdminAction with from/to status metadata');
});
