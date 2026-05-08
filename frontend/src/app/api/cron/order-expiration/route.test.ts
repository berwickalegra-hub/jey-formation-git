import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const expirePendingOrdersMock = vi.fn();
vi.mock('@/lib/server/orders/expire', () => ({
  expirePendingOrders: expirePendingOrdersMock,
}));

vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  expirePendingOrdersMock.mockReset();
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

describe('POST /api/cron/order-expiration (CRON-04, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    // @ts-expect-error -- route ships in Wave 1 (plan 05-06); RED-by-design until then
    const { POST } = await import('./route');
    const res = await POST(makeReq('order-expiration'));
    expect(res.status).toBe(401);
  });

  it('calls expirePendingOrders helper with prisma', async () => {
    expirePendingOrdersMock.mockResolvedValueOnce({ expired: 0 });
    // @ts-expect-error -- route ships in Wave 1 (plan 05-06); RED-by-design until then
    const { POST } = await import('./route');
    await POST(makeReq('order-expiration'));
    expect(expirePendingOrdersMock).toHaveBeenCalled();
    const arg = expirePendingOrdersMock.mock.calls[0]![0] as { prisma: unknown };
    expect(arg.prisma).toBeDefined();
  });

  it('returns processed count from helper (CRON-04)', async () => {
    expirePendingOrdersMock.mockResolvedValueOnce({ expired: 5 });
    // @ts-expect-error -- route ships in Wave 1 (plan 05-06); RED-by-design until then
    const { POST } = await import('./route');
    const res = await POST(makeReq('order-expiration'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 5 });
  });
});
