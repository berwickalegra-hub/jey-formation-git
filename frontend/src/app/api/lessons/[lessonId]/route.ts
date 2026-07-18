// PATCH /api/lessons/[lessonId] — edit lesson fields (coach/moderator).
// DELETE /api/lessons/[lessonId] — remove a lesson (cascades progress/quiz/
// comments via Prisma's onDelete: Cascade).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';

async function resolveLessonOrg(lessonId: string) {
  return prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, module: { select: { course: { select: { organizationId: true } } } } },
  });
}

const Body = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  videoUrl: z.string().url().nullable().optional(),
  descriptionHtml: z.string().trim().max(20000).nullable().optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx2: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { lessonId } = await ctx2.params;
    const lesson = await resolveLessonOrg(lessonId);
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

    const { title, videoUrl, descriptionHtml, durationSeconds } = parsed.data;
    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        ...(title !== undefined && { title }),
        ...(videoUrl !== undefined && { videoUrl }),
        ...(descriptionHtml !== undefined && { descriptionHtml }),
        ...(durationSeconds !== undefined && { durationSeconds }),
      },
    });

    return NextResponse.json(updated, { status: 200, headers: { 'x-request-id': ctx.requestId } });
  });
}

export async function DELETE(
  req: NextRequest,
  ctx2: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { lessonId } = await ctx2.params;
    const lesson = await resolveLessonOrg(lessonId);
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

    await prisma.lesson.delete({ where: { id: lessonId } });

    return NextResponse.json(
      { deleted: true },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
