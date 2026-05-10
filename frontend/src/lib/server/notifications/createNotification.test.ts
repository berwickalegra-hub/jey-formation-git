// TEST-02 — companion unit test for `notifications/index.ts::createNotification`
// (PROTECTED-style entry point — every Notification row must flow through this
// function so the dedupeKey @unique catch is centralized).
//
// Asserts:
//   1. valid input creates a Notification row with the expected `data` shape.
//   2. P2002 (unique-violation on dedupeKey) is caught and returns null.
//   3. non-P2002 errors re-throw to the caller.
import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { createNotification } from './index';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(prismaMock));

const baseInput = {
  userId: 'user_1',
  type: 'payment.received',
  title: 'Payment received',
  body: 'Your order is paid.',
  dedupeKey: 'payment.received:order_1',
};

describe('createNotification (TEST-02)', () => {
  it('creates a Notification row when input is valid', async () => {
    const created = { id: 'n_1', ...baseInput, data: null, createdAt: new Date() };
    prismaMock.notification.create.mockResolvedValue(created as never);

    const out = await createNotification(prismaMock, baseInput);

    expect(out).toEqual(created);
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
    const arg = prismaMock.notification.create.mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      userId: 'user_1',
      type: 'payment.received',
      title: 'Payment received',
      body: 'Your order is paid.',
      dedupeKey: 'payment.received:order_1',
    });
  });

  it('returns null silently when prisma throws P2002 (dedupeKey collision)', async () => {
    // Duck-typed P2002 — matches the source's `'code' in err && err.code === 'P2002'` check.
    const p2002 = Object.assign(new Error('Unique constraint failed on the fields: (`dedupeKey`)'), {
      code: 'P2002',
      name: 'PrismaClientKnownRequestError',
    });
    prismaMock.notification.create.mockRejectedValueOnce(p2002 as never);

    const out = await createNotification(prismaMock, baseInput);

    expect(out).toBeNull();
  });

  it('rethrows non-P2002 errors so callers can decide whether to retry', async () => {
    const generic = new Error('connection lost');
    prismaMock.notification.create.mockRejectedValueOnce(generic as never);

    await expect(createNotification(prismaMock, baseInput)).rejects.toThrow('connection lost');
  });

  it('forwards optional `data` payload through to prisma when provided', async () => {
    const created = { id: 'n_2', ...baseInput, data: { orderId: 'o_1' }, createdAt: new Date() };
    prismaMock.notification.create.mockResolvedValue(created as never);

    await createNotification(prismaMock, { ...baseInput, data: { orderId: 'o_1' } });

    const arg = prismaMock.notification.create.mock.calls[0]?.[0];
    expect(arg?.data?.data).toEqual({ orderId: 'o_1' });
  });
});
