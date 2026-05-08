import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const drainOne = vi.fn();
const queueMock = { drainOne };
const getEmailQueueMock = vi.fn(() => queueMock as { drainOne: typeof drainOne } | null);
vi.mock('@/lib/server/queues/email-queue-singleton', () => ({
  getEmailQueue: getEmailQueueMock,
}));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  drainOne.mockReset();
  getEmailQueueMock.mockReturnValue(queueMock);
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

describe('POST /api/cron/email-queue-drain (CRON-02, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq('email-queue-drain'));
    expect(res.status).toBe(401);
  });

  it('drains up to BATCH_SIZE=100 jobs', async () => {
    drainOne.mockResolvedValue(true);
    const { POST } = await import('./route');
    const res = await POST(makeReq('email-queue-drain'));
    expect(res.status).toBe(200);
    expect(drainOne).toHaveBeenCalledTimes(100);
    expect(await res.json()).toEqual({ ok: true, processed: 100 });
  });

  it('stops early when drainOne returns false (queue empty)', async () => {
    drainOne.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { POST } = await import('./route');
    const res = await POST(makeReq('email-queue-drain'));
    expect(drainOne).toHaveBeenCalledTimes(3);
    expect(await res.json()).toEqual({ ok: true, processed: 2 });
  });

  it('returns processed=0 when getEmailQueue returns null', async () => {
    getEmailQueueMock.mockReturnValueOnce(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq('email-queue-drain'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 0 });
    expect(drainOne).not.toHaveBeenCalled();
  });
});
