// OBS-02 — Admin email-queue visibility tests.
//
// D-OBS-02: response uses `bodyPreview` (≤200 chars) instead of full `body`
// — PII protection so admins can spot-check delivery without leaking
// reset-password links or magic codes. The full `html` and `text` fields
// must NEVER appear on the wire.
//
// Wave 1 conversion of the it.todo scaffold from Plan 03-01 (Wave 0).
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { seedAdmin, seedEmailJob } from '@/test-utils/admin-fixtures';

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
const mockEnforceAdminRateLimit = vi.mocked(enforceAdminRateLimit);

const admin = seedAdmin({ id: 'admin-1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: admin.id, email: admin.email },
  admin: { id: admin.id, email: admin.email, role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockEnforceAdminRateLimit.mockResolvedValue(null);
});

describe('/api/admin/email-queue [Wave 1]', () => {
  it('GET returns EmailJob rows with bodyPreview ≤200 chars (PII protection)', async () => {
    // 1000-char html should be truncated to exactly 200 chars
    const longHtml = 'a'.repeat(1000);
    prismaMock.emailJob.findMany.mockResolvedValue([
      seedEmailJob({ id: 'ej-long', html: longHtml }),
    ] as never);

    const res = await GET(makeGet('http://test/api/admin/email-queue'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(typeof item.bodyPreview).toBe('string');
    expect(item.bodyPreview).toHaveLength(200);
    expect(item.bodyPreview).toBe('a'.repeat(200));
  });

  it('GET filters by status (PENDING|SENT|FAILED|DEAD)', async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);

    await GET(makeGet('http://test/api/admin/email-queue?status=PENDING'));
    let args = prismaMock.emailJob.findMany.mock.calls[0]?.[0];
    expect(args?.where?.status).toBe('PENDING');

    await GET(makeGet('http://test/api/admin/email-queue?status=SENT'));
    args = prismaMock.emailJob.findMany.mock.calls[1]?.[0];
    expect(args?.where?.status).toBe('SENT');

    await GET(makeGet('http://test/api/admin/email-queue?status=FAILED'));
    args = prismaMock.emailJob.findMany.mock.calls[2]?.[0];
    expect(args?.where?.status).toBe('FAILED');

    await GET(makeGet('http://test/api/admin/email-queue?status=DEAD'));
    args = prismaMock.emailJob.findMany.mock.calls[3]?.[0];
    expect(args?.where?.status).toBe('DEAD');

    // Invalid status is ignored
    await GET(makeGet('http://test/api/admin/email-queue?status=PROCESSING'));
    args = prismaMock.emailJob.findMany.mock.calls[4]?.[0];
    expect(args?.where?.status).toBeUndefined();
  });

  it('GET never returns the full html body field', async () => {
    const longHtml = 'X'.repeat(500);
    prismaMock.emailJob.findMany.mockResolvedValue([
      seedEmailJob({ id: 'ej-1', html: longHtml }),
    ] as never);

    const res = await GET(makeGet('http://test/api/admin/email-queue'));
    const body = await res.json();
    const item = body.items[0];
    expect(item).not.toHaveProperty('html');
    expect(item).not.toHaveProperty('text');
    // bodyPreview is the only window into the body
    expect(item.bodyPreview).toBeDefined();
    expect(item.bodyPreview.length).toBeLessThanOrEqual(200);

    // Raw response JSON also must not contain the full html marker
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('X'.repeat(201)); // anything beyond 200 chars leaked = bug
  });

  it('GET handles empty result with nextCursor=null', async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);
    const res = await GET(makeGet('http://test/api/admin/email-queue'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], nextCursor: null });
  });

  it('GET returns nextCursor when more rows exist', async () => {
    // 11 rows + limit=10 → 10 items returned + nextCursor
    const rows = Array.from({ length: 11 }, (_, i) =>
      seedEmailJob({
        id: `ej-${i}`,
        html: 'short body',
      }),
    );
    prismaMock.emailJob.findMany.mockResolvedValue(rows as never);

    const res = await GET(makeGet('http://test/api/admin/email-queue?limit=10'));
    const body = await res.json();
    expect(body.items).toHaveLength(10);
    expect(body.nextCursor).not.toBeNull();
    const args = prismaMock.emailJob.findMany.mock.calls[0]?.[0];
    expect(args?.take).toBe(11);
  });

  it('GET handles null html safely (bodyPreview = empty string)', async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([
      // Cast to never because the seed factory expects a string for html;
      // at the schema level html is non-null, but defensive code path matters.
      { ...seedEmailJob({ id: 'ej-null' }), html: null } as never,
    ] as never);
    const res = await GET(makeGet('http://test/api/admin/email-queue'));
    const body = await res.json();
    expect(body.items[0].bodyPreview).toBe('');
  });

  it('GET returns 401/403 when requireAdmin bails', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: 'ADMIN_REQUIRED', message: 'Admin access required' },
        { status: 403 },
      ),
    );
    const res = await GET(makeGet('http://test/api/admin/email-queue'));
    expect(res.status).toBe(403);
    expect(prismaMock.emailJob.findMany).not.toHaveBeenCalled();
  });

  it('GET short-circuits when admin rate limit is exceeded', async () => {
    mockEnforceAdminRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/email-queue'));
    expect(res.status).toBe(429);
    expect(prismaMock.emailJob.findMany).not.toHaveBeenCalled();
  });

  it('GET response includes x-request-id header', async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);
    const res = await GET(makeGet('http://test/api/admin/email-queue'));
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });

  it('route source uses slice(0, 200) for bodyPreview truncation', () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/slice\(0,\s*200\)|slice\(0, BODY_PREVIEW_MAX\)/);
    expect(src).toContain('bodyPreview');
  });
});
