// ADMIN-01 / D-ADMIN-02 (Wave 2) — PATCH /api/admin/users/[id]/status
//
// ADMIN gates the route; the inner restore (SUSPENDED → ACTIVE) branch
// additionally requires SUPERADMIN. Same-status PATCH is idempotent and
// writes NO AdminAction (T-03-06-08 mitigation: prevents audit-log noise).
//
// Sequence:
//   makeRequestContext → withRequestContext →
//     verifyCsrf (CF-02) → requireAdmin('ADMIN') (CF-08) →
//     enforceAdminRateLimit (D-ADMIN-05) → Zod parse →
//     prisma.$transaction(async tx => find → role-aware gate → update → logAdminAction)
//
// Audit metadata shape (per RESEARCH.md "AdminAction metadata shapes"):
//   user.suspend: { from: 'ACTIVE', to: 'SUSPENDED', reason?: string }
//   user.restore: { from: 'SUSPENDED', to: 'ACTIVE', reason?: string }
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().min(1).max(500).optional(),
});

type Discriminator =
  | { kind: 'NOT_FOUND' }
  | { kind: 'RESTORE_REQUIRES_SUPERADMIN' }
  | { kind: 'SUSPEND_REQUIRES_SUPERADMIN' }
  | { kind: 'OK'; user: { id: string; status: string } };

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAdmin('ADMIN');
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

    const result: Discriminator = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, status: true, email: true, name: true, role: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      // Idempotent no-op: same status → return without writing AdminAction.
      // Mitigation T-03-06-08 (audit-log noise from repeated PATCH).
      if (target.status === parsed.data.status) {
        return {
          kind: 'OK' as const,
          user: { id: target.id, status: target.status },
        };
      }

      // SUSPENDED → ACTIVE = restore. Only SUPERADMIN allowed (D-ADMIN-02).
      const isRestore = target.status === 'SUSPENDED' && parsed.data.status === 'ACTIVE';
      if (isRestore && auth.admin.role !== 'SUPERADMIN') {
        return { kind: 'RESTORE_REQUIRES_SUPERADMIN' as const };
      }

      // CR-01: ACTIVE → SUSPENDED on a SUPERADMIN target requires SUPERADMIN
      // actor. Without this an ADMIN could lock every higher-privilege account
      // out of the system in one PATCH (combined with the ACCOUNT_SUSPENDED
      // 403 on /api/auth/login + /api/auth/refresh), bypassing the
      // last-SUPERADMIN guard which only watches `User.role`. Mirrors the
      // CLAUDE.md rule "Only SUPERADMIN can change roles" — suspension is
      // functionally a role change because it strips authentication.
      const isSuspend = target.status === 'ACTIVE' && parsed.data.status === 'SUSPENDED';
      if (isSuspend && target.role === 'SUPERADMIN' && auth.admin.role !== 'SUPERADMIN') {
        return { kind: 'SUSPEND_REQUIRES_SUPERADMIN' as const };
      }

      const updated = await tx.user.update({
        where: { id },
        data: { status: parsed.data.status },
        select: { id: true, status: true },
      });

      await logAdminAction(tx, {
        actorId: auth.admin.id,
        action: isRestore ? 'user.restore' : 'user.suspend',
        targetType: 'User',
        targetId: id,
        metadata: {
          from: target.status,
          to: parsed.data.status,
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        },
      });

      return { kind: 'OK' as const, user: updated };
    });

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'User not found' },
        { status: 404 },
      );
    }
    if (result.kind === 'RESTORE_REQUIRES_SUPERADMIN') {
      return NextResponse.json(
        {
          error: 'RESTORE_REQUIRES_SUPERADMIN',
          message: 'Only a SUPERADMIN can restore a suspended account.',
        },
        { status: 403 },
      );
    }
    if (result.kind === 'SUSPEND_REQUIRES_SUPERADMIN') {
      return NextResponse.json(
        {
          error: 'SUSPEND_REQUIRES_SUPERADMIN',
          message: 'Only a SUPERADMIN can suspend a SUPERADMIN account.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ user: result.user }, { status: 200 });
  });
}
