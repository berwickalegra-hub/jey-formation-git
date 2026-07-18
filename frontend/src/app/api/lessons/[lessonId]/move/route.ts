// POST /api/lessons/[lessonId]/move — reorder a lesson up/down among its
// siblings (same moduleId) by swapping `order` with the adjacent sibling.
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
  ctx2: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { lessonId } = await ctx2.params;
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        order: true,
        moduleId: true,
        module: { select: { course: { select: { organizationId: true } } } },
      },
    });
    if (!lesson) {
      return NextResponse.json(
        { error: 'LESSON_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const auth = await requireOrgRole(
      lesson.module.course.organizationId,
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

    const siblings = await prisma.lesson.findMany({
      where: { moduleId: lesson.moduleId },
      orderBy: { order: 'asc' },
      select: { id: true, order: true },
    });
    const index = siblings.findIndex((s) => s.id === lessonId);
    const targetIndex = parsed.data.direction === 'up' ? index - 1 : index + 1;
    const target = siblings[targetIndex];
    if (!target) {
      return NextResponse.json(
        { error: 'CANNOT_MOVE' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    await prisma.$transaction([
      prisma.lesson.update({ where: { id: lesson.id }, data: { order: target.order } }),
      prisma.lesson.update({ where: { id: target.id }, data: { order: lesson.order } }),
    ]);

    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
