import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expirePendingOrders } from './expire';

describe('expirePendingOrders (CRON-04)', () => {
  let findMany: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let $transaction: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(() => {
    findMany = vi.fn();
    updateMany = vi.fn();
    $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ order: { updateMany } }),
    );
    prisma = { order: { findMany }, $transaction };
  });

  it('returns { expired: 0 } when no candidates', async () => {
    findMany.mockResolvedValueOnce([]);
    const r = await expirePendingOrders({ prisma });
    expect(r).toEqual({ expired: 0 });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('marks all candidates EXPIRED and returns the count', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'o1', userId: 'u1', amount: 1000, currency: 'XOF' },
      { id: 'o2', userId: null, amount: 2000, currency: 'XOF' },
    ]);
    updateMany.mockResolvedValue({ count: 1 });
    const r = await expirePendingOrders({ prisma });
    expect(r).toEqual({ expired: 2 });
    expect(updateMany).toHaveBeenCalledTimes(2);
    // Verify the WHERE-guard
    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: 'o1', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
  });

  it('uses default batchSize=100 in findMany.take', async () => {
    findMany.mockResolvedValueOnce([]);
    await expirePendingOrders({ prisma });
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      take: 100,
      orderBy: { expiresAt: 'asc' },
    });
  });

  it('honors custom batchSize', async () => {
    findMany.mockResolvedValueOnce([]);
    await expirePendingOrders({ prisma, batchSize: 50 });
    expect(findMany.mock.calls[0]![0].take).toBe(50);
  });

  it('skips rows the WHERE-guard rejects (raced to PAID by webhook)', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'o1', userId: 'u1', amount: 1000, currency: 'XOF' },
      { id: 'o2', userId: 'u2', amount: 1000, currency: 'XOF' },
    ]);
    // o1 wins, o2 lost the race (count=0 → another worker flipped to PAID)
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const r = await expirePendingOrders({ prisma });
    expect(r).toEqual({ expired: 1 });
  });

  it('queries with status=PENDING AND expiresAt < now()', async () => {
    findMany.mockResolvedValueOnce([]);
    await expirePendingOrders({ prisma });
    const where = findMany.mock.calls[0]![0].where as { status: string; expiresAt: { lt: Date } };
    expect(where.status).toBe('PENDING');
    expect(where.expiresAt.lt).toBeInstanceOf(Date);
  });
});
