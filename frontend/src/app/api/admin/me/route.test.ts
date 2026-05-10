// ADMIN-05 (admin probe + capability list) — D-ADMIN-04 verbatim shape:
// returns { admin: { id, email, role }, can: string[] } where the
// capability array is keyed by role.
//
// Test pattern mirrors notifications/route.test.ts:
//   - mockNextCookies() for the next/headers async cookies() store
//   - vi.mock('@/lib/server/middleware') so requireAdmin is controlled per test
//   - vi.mock('@/lib/server/middleware/rate-limit-by-userid') so the rate
//     limiter is a no-op by default (per-test override surfaces 429 path)
//
// No prismaMock import needed — this route hits no Prisma model directly
// (requireAdmin does the user re-query, which is mocked away here).
import { mockNextCookies } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { GET } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockEnforceRateLimit = vi.mocked(enforceAdminRateLimit);

const adminCtx = {
  user: { sub: 'admin-1', email: 'admin@test.local' },
  admin: { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN' as const },
};

const superadminCtx = {
  user: { sub: 'super-1', email: 'super@test.local' },
  admin: { id: 'super-1', email: 'super@test.local', role: 'SUPERADMIN' as const },
};

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/admin/me', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnforceRateLimit.mockResolvedValue(null);
});

describe('GET /api/admin/me [Wave 1]', () => {
  it('GET returns role + capability list for ADMIN (8-item exact list)', async () => {
    mockRequireAdmin.mockResolvedValueOnce(adminCtx);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admin).toEqual({
      id: 'admin-1',
      email: 'admin@test.local',
      role: 'ADMIN',
    });
    expect(body.can).toEqual([
      'users:read',
      'users:status:suspend',
      'orders:read',
      'withdrawals:read',
      'audit-log:read',
      'outbox:read',
      'email-queue:read',
      'rate-limits:read',
    ]);
    expect(body.can).toHaveLength(8);
  });

  it('GET returns broader capability list for SUPERADMIN including users:role and withdrawals:cancel', async () => {
    mockRequireAdmin.mockResolvedValueOnce(superadminCtx);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admin).toEqual({
      id: 'super-1',
      email: 'super@test.local',
      role: 'SUPERADMIN',
    });
    expect(body.can).toContain('users:role');
    expect(body.can).toContain('withdrawals:cancel');
    expect(body.can).toContain('users:status:restore');
    expect(body.can).toHaveLength(11);
  });

  it('SUPERADMIN list is the exact 11-item set required by D-ADMIN-04', async () => {
    mockRequireAdmin.mockResolvedValueOnce(superadminCtx);
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.can).toEqual([
      'users:read',
      'users:role',
      'users:status:suspend',
      'users:status:restore',
      'orders:read',
      'withdrawals:read',
      'withdrawals:cancel',
      'audit-log:read',
      'outbox:read',
      'email-queue:read',
      'rate-limits:read',
    ]);
  });

  it('GET 401 when no auth cookie present (requireAdmin returns 401)', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it('GET 403 when authenticated as USER (requireAdmin returns 403 ADMIN_REQUIRED)', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: 'ADMIN_REQUIRED', message: 'Admin access required' },
        { status: 403 },
      ),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it('GET returns 429 when rate-limit gate fires after auth passes', async () => {
    mockRequireAdmin.mockResolvedValueOnce(adminCtx);
    mockEnforceRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(429);
  });

  it('GET applies rate-limit using the admin userId (not email or role)', async () => {
    mockRequireAdmin.mockResolvedValueOnce(adminCtx);
    await GET(makeGet());
    expect(mockEnforceRateLimit).toHaveBeenCalledWith('admin-1');
  });

  it('ADMIN list does NOT include any SUPERADMIN-only capabilities', async () => {
    mockRequireAdmin.mockResolvedValueOnce(adminCtx);
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.can).not.toContain('users:role');
    expect(body.can).not.toContain('users:status:restore');
    expect(body.can).not.toContain('withdrawals:cancel');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs', requireAdmin('ADMIN'), enforceAdminRateLimit, CAPABILITIES_BY_ROLE, withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain("requireAdmin('ADMIN')");
    expect(src).toContain('enforceAdminRateLimit');
    expect(src).toContain('CAPABILITIES_BY_ROLE');
    expect(src).toContain('withRequestContext');
  });

  it("each SUPERADMIN-only capability ('users:role', 'users:status:restore', 'withdrawals:cancel') appears exactly once in the code (not counting comments)", () => {
    // Strip line- and block-comments before counting so the docstring
    // listing the SUPERADMIN-only capabilities doesn't inflate the count
    // (the acceptance check is "appears in SUPERADMIN list only, not ADMIN").
    const raw = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const occurrences = (s: string) => (code.match(new RegExp(`'${s}'`, 'g')) ?? []).length;
    expect(occurrences('users:role')).toBe(1);
    expect(occurrences('withdrawals:cancel')).toBe(1);
    expect(occurrences('users:status:restore')).toBe(1);
  });
});
