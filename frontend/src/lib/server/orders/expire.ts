// frontend/src/lib/server/orders/expire.ts — Phase 5 D-14.
//
// Find PENDING Order rows whose expiresAt has passed and mark them EXPIRED
// in batches of `batchSize`. Idempotent: re-running on the same set finds
// zero PENDING + expired rows (they're already EXPIRED).
//
// v1 does NOT emit `notification.order_expired` outbox events (the kind is
// not in outbox/types.ts yet — would need a Phase 6 dispatcher extension).
// Users learn of expirations via the Phase 3 admin/orders endpoint.
import 'server-only';
import type { PrismaClient } from '@prisma/client';

export interface ExpirePendingOrdersOptions {
  prisma: PrismaClient;
  batchSize?: number; // default 100 — D-08
}

export async function expirePendingOrders(
  opts: ExpirePendingOrdersOptions,
): Promise<{ expired: number }> {
  const batchSize = opts.batchSize ?? 100;

  const candidates = await opts.prisma.order.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: batchSize,
    select: { id: true, userId: true, amount: true, currency: true },
  });

  if (candidates.length === 0) return { expired: 0 };

  let expired = 0;
  for (const o of candidates) {
    // Per-row tx — atomic update. The status='PENDING' WHERE-guard prevents
    // racing with a webhook that just flipped this row to PAID.
    const updated = await opts.prisma.$transaction(async (tx) => {
      const u = await tx.order.updateMany({
        where: { id: o.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return u.count > 0;
    });
    if (updated) expired++;
  }
  return { expired };
}
