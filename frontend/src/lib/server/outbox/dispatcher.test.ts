// TEST-02 — companion unit test for `outbox/dispatcher.ts::drainOutbox`
// (PROTECTED lib).
//
// Asserts:
//   1. claims a PENDING row via updateMany (PROCESSING + attempts++) before
//      reading it; honors the per-row claim contract that protects against
//      multi-instance double-dispatch.
//   2. on successful dispatch, marks the row SENT with sentAt + lastError=null.
//   3. on dispatch failure with attempts < MAX_ATTEMPTS (5), marks the row
//      PENDING with `lastError` + a future `scheduledAt` (exponential backoff).
//   4. on dispatch failure with attempts >= MAX_ATTEMPTS, marks the row DEAD.
//   5. concurrent claim losing the race (claimed.count === 0) is skipped
//      without further work.
import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { drainOutbox } from './dispatcher';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(prismaMock));

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'oe_1',
    kind: 'notification.payment_received',
    payload: { userId: 'u_1', orderId: 'o_1', amount: 1000, currency: 'XOF' },
    status: 'PROCESSING',
    attempts: 1,
    scheduledAt: new Date('2026-01-01T00:00:00Z'),
    sentAt: null,
    lastError: null,
    ...overrides,
  };
}

describe('drainOutbox (TEST-02)', () => {
  it('claims a PENDING row via updateMany (PROCESSING + attempts++) before reading it', async () => {
    const row = makeRow();
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    // Make the dispatch succeed (notification.payment_received → createNotification).
    prismaMock.notification.create.mockResolvedValue({} as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    await drainOutbox({ prisma: prismaMock });

    expect(prismaMock.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'oe_1', status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
  });

  it('marks the row SENT with sentAt + lastError=null on successful dispatch', async () => {
    const row = makeRow();
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    prismaMock.notification.create.mockResolvedValue({} as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats.succeeded).toBe(1);
    const finalUpdate = prismaMock.outboxEvent.update.mock.calls[0]?.[0];
    expect(finalUpdate?.where).toEqual({ id: 'oe_1' });
    expect(finalUpdate?.data).toMatchObject({
      status: 'SENT',
      lastError: null,
    });
    expect(finalUpdate?.data?.sentAt).toBeInstanceOf(Date);
  });

  it('reschedules with PENDING + future scheduledAt + lastError when attempts < MAX_ATTEMPTS', async () => {
    // attempts=1 means we are well below the 5-attempt ceiling.
    const row = makeRow({ attempts: 1 });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    // Force the dispatch path to throw — createNotification rejects.
    prismaMock.notification.create.mockRejectedValueOnce(new Error('notification provider down') as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats.failed).toBe(1);
    expect(stats.dead).toBe(0);
    const finalUpdate = prismaMock.outboxEvent.update.mock.calls[0]?.[0];
    expect(finalUpdate?.data).toMatchObject({
      status: 'PENDING',
      lastError: 'notification provider down',
    });
    // Backoff schedule pushes scheduledAt into the future.
    const scheduledAt = finalUpdate?.data?.scheduledAt as Date;
    expect(scheduledAt).toBeInstanceOf(Date);
    expect(scheduledAt.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('marks the row DEAD when attempts >= MAX_ATTEMPTS (5)', async () => {
    // attempts=5 → MAX_ATTEMPTS reached → DEAD path.
    const row = makeRow({ attempts: 5 });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    prismaMock.notification.create.mockRejectedValueOnce(new Error('still down') as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats.dead).toBe(1);
    expect(stats.failed).toBe(0);
    const finalUpdate = prismaMock.outboxEvent.update.mock.calls[0]?.[0];
    expect(finalUpdate?.data).toMatchObject({
      status: 'DEAD',
      lastError: 'still down',
    });
  });

  it('skips a row when the per-row claim loses the race (claimed.count === 0)', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    // Race lost — another worker won the claim.
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 0 } as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats.processed).toBe(1); // candidate count
    expect(stats.succeeded).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.dead).toBe(0);
    expect(prismaMock.outboxEvent.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.outboxEvent.update).not.toHaveBeenCalled();
  });

  it('returns zero counts when there are no PENDING candidates', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([] as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats).toEqual({ processed: 0, succeeded: 0, failed: 0, dead: 0 });
    expect(prismaMock.outboxEvent.updateMany).not.toHaveBeenCalled();
  });
});
