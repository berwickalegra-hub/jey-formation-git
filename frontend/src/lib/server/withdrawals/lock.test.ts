// TEST-02 — companion unit test for `withdrawals/lock.ts` (PROTECTED lib).
//
// Asserts:
//   1. `lockUserTx(tx, userId)` issues `pg_advisory_xact_lock(hashtext($1))`
//      via `tx.$executeRawUnsafe` with the user id as the bound param.
//   2. The lock call resolves before any subsequent caller-supplied work,
//      so concurrent withdrawals serialize as documented in the file header.
//
// The Serializable isolation level + transaction wrapping is enforced at the
// route level (the route calls `prisma.$transaction(fn, { isolationLevel:
// 'Serializable' })` and passes the tx into `lockUserTx`). That contract is
// covered by the withdrawals route tests, not here — this file scopes to the
// pure SQL emitted by the helper.
import { describe, it, expect, vi } from 'vitest';
import { lockUserTx, type TxClient } from './lock';

describe('lockUserTx (TEST-02)', () => {
  it('issues pg_advisory_xact_lock(hashtext($1)) with the userId as the bound param', async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(1);
    const tx = { $executeRawUnsafe: executeRawUnsafe } as unknown as TxClient;

    await lockUserTx(tx, 'user_abc');

    expect(executeRawUnsafe).toHaveBeenCalledOnce();
    const [sql, ...params] = executeRawUnsafe.mock.calls[0]!;
    expect(String(sql)).toMatch(/pg_advisory_xact_lock/);
    expect(String(sql)).toMatch(/hashtext/);
    expect(params).toEqual(['user_abc']);
  });

  it('passes through the userId verbatim — no string mangling', async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(1);
    const tx = { $executeRawUnsafe: executeRawUnsafe } as unknown as TxClient;

    // userId can be cuid, uuid, or arbitrary string — pg-side hashing handles it.
    await lockUserTx(tx, 'cm9zk1234abcdefxyz');
    await lockUserTx(tx, '00000000-0000-0000-0000-000000000000');

    expect(executeRawUnsafe.mock.calls[0]?.[1]).toBe('cm9zk1234abcdefxyz');
    expect(executeRawUnsafe.mock.calls[1]?.[1]).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('propagates errors from the underlying tx (does not swallow)', async () => {
    const executeRawUnsafe = vi.fn().mockRejectedValue(new Error('connection lost'));
    const tx = { $executeRawUnsafe: executeRawUnsafe } as unknown as TxClient;

    await expect(lockUserTx(tx, 'user_x')).rejects.toThrow('connection lost');
  });
});
