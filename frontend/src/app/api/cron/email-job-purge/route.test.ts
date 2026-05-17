import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const deleteMany = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: { emailJob: { deleteMany } },
}));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  deleteMany.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/cron/email-job-purge', {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  });
}

describe('POST /api/cron/email-job-purge', () => {
  it('returns 401 when verifyCronSecret fails', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it('deletes SENT EmailJob rows older than retention window', async () => {
    deleteMany.mockResolvedValueOnce({ count: 7 });
    vi.stubEnv('EMAIL_JOB_RETENTION_DAYS', '14');
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, processed: 7 });

    const where = (
      deleteMany.mock.calls[0]![0] as {
        where: { status: string; sentAt: { lt: Date } };
      }
    ).where;
    expect(where.status).toBe('SENT');
    expect(where.sentAt.lt).toBeInstanceOf(Date);
    const expected = Date.now() - 14 * 24 * 60 * 60 * 1000;
    expect(where.sentAt.lt.getTime()).toBeGreaterThan(expected - 60_000);
    expect(where.sentAt.lt.getTime()).toBeLessThan(expected + 60_000);
  });

  it('uses default 30 days when EMAIL_JOB_RETENTION_DAYS unset', async () => {
    deleteMany.mockResolvedValueOnce({ count: 0 });
    const { POST } = await import('./route');
    await POST(makeReq());
    const where = (
      deleteMany.mock.calls[0]![0] as {
        where: { status: string; sentAt: { lt: Date } };
      }
    ).where;
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(where.sentAt.lt.getTime()).toBeGreaterThan(expected - 60_000);
    expect(where.sentAt.lt.getTime()).toBeLessThan(expected + 60_000);
  });

  it('does NOT delete DEAD or PENDING rows (only SENT)', async () => {
    deleteMany.mockResolvedValueOnce({ count: 0 });
    const { POST } = await import('./route');
    await POST(makeReq());
    const where = (deleteMany.mock.calls[0]![0] as { where: { status: string } }).where;
    expect(where.status).toBe('SENT');
  });
});
