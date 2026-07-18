// POST /api/courses/[courseId]/modules — coach/moderator adds a module to
// a course. New modules always append at the end (order = current count) —
// no drag-reorder in v1, matches the rest of the authoring UI.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';

const Body = z.object({ title: z.string().trim().min(1).max(200) });

export async function POST(
  req: NextRequest,
  ctx2: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const gate = await requireCommunityRole(prisma, 'ADMIN', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org } = gate;
    const { courseId } = await ctx2.params;

    const course = await prisma.course.findFirst({
      where: { id: courseId, organizationId: org.id },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json(
        { error: 'COURSE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const order = await prisma.module.count({ where: { courseId } });
    const module_ = await prisma.module.create({
      data: { courseId, title: parsed.data.title, order },
    });

    return NextResponse.json(module_, { status: 201, headers: { 'x-request-id': ctx.requestId } });
  });
}
