// TEST-02 — companion unit test for `admin/audit.ts::logAdminAction`
// (PROTECTED lib — every back-office mutation must call this helper).
//
// Asserts:
//   1. logAdminAction writes an AdminAction row with all required fields.
//   2. Optional fields (targetType, targetId, metadata, ip, userAgent) default
//      to null when omitted.
//   3. Accepts a transaction-shaped client (Prisma TransactionClient is a
//      subset of PrismaClient — both expose `adminAction.create`).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { logAdminAction } from './audit';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => mockReset(prismaMock));

describe('logAdminAction (TEST-02)', () => {
  it('writes an AdminAction row with all required fields', async () => {
    prismaMock.adminAction.create.mockResolvedValue({} as never);

    await logAdminAction(prismaMock, {
      actorId: 'admin_1',
      action: 'withdrawal.cancel',
      targetType: 'Withdrawal',
      targetId: 'wd_1',
      metadata: { reason: 'fraud' },
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });

    expect(prismaMock.adminAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin_1',
        action: 'withdrawal.cancel',
        targetType: 'Withdrawal',
        targetId: 'wd_1',
        metadata: { reason: 'fraud' },
        ip: '203.0.113.5',
        userAgent: 'Mozilla/5.0',
      }),
    });
  });

  it('defaults optional fields to null when omitted', async () => {
    prismaMock.adminAction.create.mockResolvedValue({} as never);

    await logAdminAction(prismaMock, {
      actorId: 'admin_2',
      action: 'user.role_change',
    });

    const arg = prismaMock.adminAction.create.mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      actorId: 'admin_2',
      action: 'user.role_change',
      targetType: null,
      targetId: null,
      ip: null,
      userAgent: null,
    });
  });

  it('accepts a tx-shaped client (TransactionClient subset)', async () => {
    // Prisma transaction clients expose `adminAction.create` identically — the
    // helper's type signature accepts `Pick<PrismaClient, 'adminAction'>` so a
    // partial mock works fine at runtime.
    const adminActionCreate = vi.fn().mockResolvedValue({});
    const txMock = { adminAction: { create: adminActionCreate } } as never;

    await logAdminAction(txMock, { actorId: 'a', action: 'x' });

    expect(adminActionCreate).toHaveBeenCalledOnce();
  });
});
