import type { PrismaClient } from '@prisma/client';
import type { TxClient } from './lock';

/**
 * Compute a user's withdrawable balance. The optional `tx` argument lets the
 * caller bind the read to an open transaction — required for race-free
 * withdrawal flow (see backend/src/routes/withdrawals.ts and
 * backend/src/lib/withdrawals/lock.ts).
 *
 * When `tx` is omitted, the read happens against the default Prisma client
 * with no isolation guarantee — fine for read-only callers (dashboards,
 * "your balance" widgets) that don't need consistency with concurrent
 * withdrawal writes.
 */
export interface BalanceComputer {
  (userId: string, tx?: TxClient): Promise<number>;
}

/**
 * Default balance formula for marketplace/fundraiser-style apps:
 *   balance = sum(PAID Orders.netAmount or amount) - sum(non-cancelled Withdrawals.amount)
 *
 * Projects with different earning models (e.g., subscription apps, vested earnings,
 * external ledgers) can swap this out by setting `app.locals.computeBalance` to their own
 * BalanceComputer in `backend/src/index.ts`.
 *
 * Returns the balance in smallest currency unit (integer). Always >= 0.
 */
export function createDefaultBalanceComputer(prisma: PrismaClient): BalanceComputer {
  return async function computeBalance(userId: string, tx?: TxClient): Promise<number> {
    const client: PrismaClient | TxClient = tx ?? prisma;

    const [orders, withdrawals] = await Promise.all([
      client.order.findMany({
        where: { userId, status: 'PAID' },
        select: { amount: true, netAmount: true },
      }),
      client.withdrawal.findMany({
        where: { userId, status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] } },
        select: { amount: true },
      }),
    ]);

    const earned = orders.reduce((sum, o) => sum + (o.netAmount ?? o.amount), 0);
    const reserved = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    return Math.max(0, earned - reserved);
  };
}
