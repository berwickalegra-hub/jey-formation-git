// POST /api/modules/[moduleId]/move — reorder a module up/down among its
// siblings (same courseId) by swapping `order` with the adjacent sibling.
// No drag-and-drop in v1 — this is the lightweight alternative.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';

const Body = z.object({ direction: z.enum(['up', 'down']) });

export async function POST(
  req: NextRequest,
  ctx2: { params: Promise<{ moduleId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { moduleId } = await ctx2.params;
    const mod = await prisma.module.findUnique({
      where: { id: moduleId },
      select: {
        id: true,
        order: true,
        courseId: true,
        course: { select: { organizationId: true } },
      },
    });
    if (!mod) {
      return NextResponse.json(
        { error: 'MODULE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const auth = await requireOrgRole(
      mod.course.organizationId,
      'ADMIN',
      req.headers.get('authorization'),
    );
    if (auth instanceof NextResponse) return auth;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const siblings = await prisma.module.findMany({
      where: { courseId: mod.courseId },
      orderBy: { order: 'asc' },
      select: { id: true, order: true },
    });
    const index = siblings.findIndex((s) => s.id === moduleId);
    const targetIndex = parsed.data.direction === 'up' ? index - 1 : index + 1;
    const target = siblings[targetIndex];
    if (!target) {
      return NextResponse.json(
        { error: 'CANNOT_MOVE' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    await prisma.$transaction([
      prisma.module.update({ where: { id: mod.id }, data: { order: target.order } }),
      prisma.module.update({ where: { id: target.id }, data: { order: mod.order } }),
    ]);

    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
