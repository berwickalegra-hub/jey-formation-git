import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const drainOutboxMock = vi.fn();
vi.mock('@/lib/server/outbox/dispatcher', () => ({ drainOutbox: drainOutboxMock }));

const updateManyMock = vi.fn(async () => ({ count: 0 }));
vi.mock('@/lib/server/prisma', () => ({
  prisma: { outboxEvent: { updateMany: updateManyMock } },
}));

vi.mock('@/lib/server/queues/email-queue-singleton', () => ({
  getEmailQueue: vi.fn(() => null),
}));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  drainOutboxMock.mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, dead: 0 });
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

describe('POST /api/cron/outbox-drain (CRON-01, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq('outbox-drain'));
    expect(res.status).toBe(401);
  });

  it('happy path returns processed count from drainOutbox', async () => {
    drainOutboxMock.mockResolvedValueOnce({ processed: 7, succeeded: 6, failed: 1, dead: 0 });
    const { POST } = await import('./route');
    const res = await POST(makeReq('outbox-drain'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 7 });
  });

  it('calls withLease with name=outbox-drain and ttl >= 60_000ms', async () => {
    const { withLease } = await import('@/lib/server/leader-lease');
    const { POST } = await import('./route');
    await POST(makeReq('outbox-drain'));
    expect(withLease).toHaveBeenCalled();
    expect((withLease as Mock).mock.calls[0]![1]).toBe('outbox-drain');
    expect((withLease as Mock).mock.calls[0]![2]).toBeGreaterThanOrEqual(60_000);
  });

  it('resets stuck PROCESSING rows older than 90s before drainOutbox (D-09)', async () => {
    const { POST } = await import('./route');
    await POST(makeReq('outbox-drain'));
    expect(updateManyMock).toHaveBeenCalled();
    const callArgs = (updateManyMock.mock.calls as unknown as unknown[][])[0]!;
    const args = callArgs[0] as {
      where?: { status?: string };
      data?: { status?: string };
    };
    expect(args.where?.status).toBe('PROCESSING');
    expect(args.data?.status).toBe('PENDING');
    // Verify the call ordering: updateMany BEFORE drainOutbox
    const updateOrder = (updateManyMock as Mock).mock.invocationCallOrder[0]!;
    const drainOrder = (drainOutboxMock as Mock).mock.invocationCallOrder[0]!;
    expect(updateOrder).toBeLessThan(drainOrder);
  });

  it('passes BATCH_SIZE=100 to drainOutbox (D-08)', async () => {
    const { POST } = await import('./route');
    await POST(makeReq('outbox-drain'));
    expect(drainOutboxMock.mock.calls[0]![1]).toBe(100);
  });
});
