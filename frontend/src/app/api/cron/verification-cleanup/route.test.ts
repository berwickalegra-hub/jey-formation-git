import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const deleteMany = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: { verificationCode: { deleteMany } },
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

describe('POST /api/cron/verification-cleanup (CRON-03, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq('verification-cleanup'));
    expect(res.status).toBe(401);
  });

  it('deletes expired verification codes (CRON-03)', async () => {
    deleteMany.mockResolvedValueOnce({ count: 3 });
    const { POST } = await import('./route');
    const res = await POST(makeReq('verification-cleanup'));
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it('returns processed count from deleteMany', async () => {
    deleteMany.mockResolvedValueOnce({ count: 12 });
    const { POST } = await import('./route');
    const res = await POST(makeReq('verification-cleanup'));
    expect(await res.json()).toEqual({ ok: true, processed: 12 });
  });
});
