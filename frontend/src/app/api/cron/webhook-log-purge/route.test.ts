import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const deleteMany = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: { webhookLog: { deleteMany } },
}));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  deleteMany.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function makeReq(name: string): NextRequest {
  return new NextRequest(`http://localhost/api/cron/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  });
}

describe('POST /api/cron/webhook-log-purge (CRON-05, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    // @ts-expect-error -- route ships in Wave 1 (plan 05-07); RED-by-design until then
    const { POST } = await import('./route');
    const res = await POST(makeReq('webhook-log-purge'));
    expect(res.status).toBe(401);
  });

  it('deletes webhook logs older than retention (CRON-05)', async () => {
    deleteMany.mockResolvedValueOnce({ count: 4 });
    vi.stubEnv('WEBHOOK_LOG_RETENTION_DAYS', '30');
    // @ts-expect-error -- route ships in Wave 1 (plan 05-07); RED-by-design until then
    const { POST } = await import('./route');
    const res = await POST(makeReq('webhook-log-purge'));
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalled();
    const where = (deleteMany.mock.calls[0]![0] as { where: { createdAt: { lt: Date } } }).where;
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    // Cutoff should be ~30 days ago
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(where.createdAt.lt.getTime()).toBeGreaterThan(expected - 60_000);
    expect(where.createdAt.lt.getTime()).toBeLessThan(expected + 60_000);
  });

  it('uses default 90 days when WEBHOOK_LOG_RETENTION_DAYS unset', async () => {
    deleteMany.mockResolvedValueOnce({ count: 0 });
    // @ts-expect-error -- route ships in Wave 1 (plan 05-07); RED-by-design until then
    const { POST } = await import('./route');
    await POST(makeReq('webhook-log-purge'));
    const where = (deleteMany.mock.calls[0]![0] as { where: { createdAt: { lt: Date } } }).where;
    const expected = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(where.createdAt.lt.getTime()).toBeGreaterThan(expected - 60_000);
    expect(where.createdAt.lt.getTime()).toBeLessThan(expected + 60_000);
  });
});
