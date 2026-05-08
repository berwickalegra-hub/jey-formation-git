// ADMIN-01 (Wave 2) — PATCH /api/admin/users/[id]/role
//
// SUPERADMIN-only role mutation. The handler enforces CF-09 (last-SUPERADMIN
// guard) atomically by performing COUNT + UPDATE inside the same Prisma
// transaction (Pitfall 1 in 03-RESEARCH.md), preventing the demote-last-
// SUPERADMIN race.
//
// Sequence:
//   makeRequestContext → withRequestContext →
//     verifyCsrf (CF-02) → requireSuperadmin (D-ADMIN-01-style, CF-08) →
//     enforceAdminRateLimit (D-ADMIN-05) → Zod parse →
//     prisma.$transaction(async tx => find → guard → update → logAdminAction)
//
// Audit metadata shape (per RESEARCH.md "AdminAction metadata shapes"):
//   action: 'user.role_change', metadata: { from, to }
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  role: z.enum(['USER', 'ADMIN', 'SUPERADMIN']),
});

type Discriminator =
  | { kind: 'NOT_FOUND' }
  | { kind: 'LAST_SUPERADMIN' }
  | { kind: 'OK'; user: { id: string; role: string } };

export async function PATCH(
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

    const result: Discriminator = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      // CF-09 / Pitfall 1: COUNT + UPDATE in same tx prevents the race where
      // two concurrent demotions both see count=2 and both succeed.
      if (target.role === 'SUPERADMIN' && parsed.data.role !== 'SUPERADMIN') {
        const superadminCount = await tx.user.count({ where: { role: 'SUPERADMIN' } });
        if (superadminCount <= 1) {
          return { kind: 'LAST_SUPERADMIN' as const };
        }
      }

      const updated = await tx.user.update({
        where: { id },
        data: { role: parsed.data.role },
        select: { id: true, role: true },
      });

      await logAdminAction(tx, {
        actorId: auth.admin.id,
        action: 'user.role_change',
        targetType: 'User',
        targetId: id,
        metadata: { from: target.role, to: parsed.data.role },
      });

      return { kind: 'OK' as const, user: updated };
    });

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'User not found' },
        { status: 404 },
      );
    }
    if (result.kind === 'LAST_SUPERADMIN') {
      return NextResponse.json(
        { error: 'LAST_SUPERADMIN', message: 'Refuse to demote the last SUPERADMIN.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ user: result.user }, { status: 200 });
  });
}
