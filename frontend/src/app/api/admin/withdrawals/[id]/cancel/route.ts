// ADMIN-03 / D-ADMIN-01 (Wave 2) — POST /api/admin/withdrawals/[id]/cancel
//
// Manual SUPERADMIN-only withdrawal cancel. Race-free per CLAUDE.md
// "Withdrawals are race-free" invariant: runs inside a Serializable
// prisma.$transaction whose FIRST statement is `lockUserTx(tx, w.userId)`,
// the same pg_advisory_xact_lock(hashtext(userId)) used by POST
// /api/withdrawals. Two concurrent admin cancels (or an admin cancel
// interleaving with a user-initiated mutation) on the same userId
// serialize on the lock instead of producing inconsistent balance/status.
//
// Two-phase lookup pattern:
//   1) Read userId outside the lock (need the key to acquire the lock).
//   2) Acquire lock as the FIRST statement inside the Serializable tx.
//   3) Re-fetch the withdrawal under the lock — status may have changed
//      while we waited.
//
// Audit metadata shape (per RESEARCH.md "AdminAction metadata shapes"):
//   action: 'withdrawal.cancel'
//   metadata: { withdrawalId, amount, currency, reason, previousStatus }
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { lockUserTx } from '@/lib/server/withdrawals/lock';

const Body = z.object({
  reason: z.string().min(1).max(500),
});

const CANCELLABLE: ReadonlySet<string> = new Set(['PENDING', 'PROCESSING']);

type Discriminator =
  | { kind: 'NOT_FOUND' }
  | { kind: 'NOT_CANCELLABLE' }
  | { kind: 'OK'; withdrawal: { id: string; status: string; userId: string } };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400 },
      );
    }

    // Phase 1 — read owner OUTSIDE the lock. Required because
    // `lockUserTx` is keyed on userId (hashtext) and we need the value
    // before entering the locked tx region.
    const owner = await prisma.withdrawal.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!owner) {
      return NextResponse.json(
        { error: 'WITHDRAWAL_NOT_FOUND', message: 'Withdrawal not found.' },
        { status: 404 },
      );
    }

    // Phase 2 — Serializable tx; lockUserTx is the FIRST statement.
    const result: Discriminator = await prisma.$transaction(
      async (tx) => {
        // pg_advisory_xact_lock(hashtext(userId)) — held until commit/rollback.
        // Serializes with POST /api/withdrawals (CLAUDE.md "Withdrawals are race-free").
        // Use the WITHDRAWAL'S OWNER (not the admin actor) so admin cancels
        // queue against the user's own balance-mutating attempts.
        await lockUserTx(tx, owner.userId);

        // Re-fetch under the lock — status may have changed while we waited.
        const w = await tx.withdrawal.findUnique({ where: { id } });
        if (!w) return { kind: 'NOT_FOUND' as const };
        if (!CANCELLABLE.has(w.status)) return { kind: 'NOT_CANCELLABLE' as const };

        const now = new Date();
        const updated = await tx.withdrawal.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            failureReason: parsed.data.reason,
            processedAt: w.processedAt ?? now,
            completedAt: now,
          },
        });

        await logAdminAction(tx, {
          actorId: auth.admin.id,
          action: 'withdrawal.cancel',
          targetType: 'Withdrawal',
          targetId: id,
          metadata: {
            withdrawalId: id,
            amount: w.amount,
            currency: w.currency,
            reason: parsed.data.reason,
            previousStatus: w.status,
          },
        });

        return { kind: 'OK' as const, withdrawal: updated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'WITHDRAWAL_NOT_FOUND', message: 'Withdrawal not found.' },
        { status: 404 },
      );
    }
    if (result.kind === 'NOT_CANCELLABLE') {
      return NextResponse.json(
        {
          error: 'WITHDRAWAL_NOT_CANCELLABLE',
          message: 'Withdrawal is not in a cancellable state.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ withdrawal: result.withdrawal }, { status: 200 });
  });
}
