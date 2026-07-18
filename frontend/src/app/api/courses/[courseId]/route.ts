// GET /api/courses/[courseId] — modules/lessons for the lesson-player
// sidebar, each lesson flagged with this user's completion + latest quiz
// result (informational only — does not gate the next lesson, see schema.prisma
// Quiz model comment). Also backs the course editor (coach/moderator).
// PATCH — edit course fields. DELETE — remove the course (cascades modules/
// lessons/quiz/progress via Prisma's onDelete: Cascade).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';

export async function GET(
  req: NextRequest,
  ctx2: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org, ctx: auth } = gate;
    const { courseId } = await ctx2.params;

    const course = await prisma.course.findFirst({
      where: { id: courseId, organizationId: org.id },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              include: {
                quiz: { select: { id: true } },
                progress: { where: { userId: auth.user.sub }, select: { completed: true } },
              },
            },
          },
        },
      },
    });
    if (!course) {
      return NextResponse.json(
        { error: 'COURSE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const quizIds = course.modules.flatMap((m) =>
      m.lessons.map((l) => l.quiz?.id).filter((id): id is string => Boolean(id)),
    );
    const quizResults = quizIds.length
      ? await prisma.quizResult.findMany({
          where: { userId: auth.user.sub, quizId: { in: quizIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const latestResultByQuiz = new Map<string, (typeof quizResults)[number]>();
    for (const r of quizResults) {
      if (!latestResultByQuiz.has(r.quizId)) latestResultByQuiz.set(r.quizId, r);
    }

    return NextResponse.json(
      {
        id: course.id,
        title: course.title,
        description: course.description,
        coverImageUrl: course.coverImageUrl,
        modules: course.modules.map((m) => ({
          id: m.id,
          title: m.title,
          lessons: m.lessons.map((l) => {
            const result = l.quiz ? latestResultByQuiz.get(l.quiz.id) : undefined;
            return {
              id: l.id,
              title: l.title,
              videoUrl: l.videoUrl,
              descriptionHtml: l.descriptionHtml,
              durationSeconds: l.durationSeconds,
              completed: l.progress[0]?.completed ?? false,
              hasQuiz: Boolean(l.quiz),
              quizResult: result
                ? { scorePercent: result.scorePercent, passed: result.passed }
                : null,
            };
          }),
        })),
      },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

const UpdateBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
});

export async function PATCH(
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

    const existing = await prisma.course.findFirst({
      where: { id: courseId, organizationId: org.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: 'COURSE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const { title, description, coverImageUrl } = parsed.data;
    const course = await prisma.course.update({
      where: { id: courseId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(coverImageUrl !== undefined && { coverImageUrl }),
      },
    });

    return NextResponse.json(course, { status: 200, headers: { 'x-request-id': ctx.requestId } });
  });
}

export async function DELETE(
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

    const existing = await prisma.course.findFirst({
      where: { id: courseId, organizationId: org.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: 'COURSE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    await prisma.course.delete({ where: { id: courseId } });

    return NextResponse.json(
      { deleted: true },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
