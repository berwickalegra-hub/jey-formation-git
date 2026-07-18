// GET/POST /api/lessons/[lessonId]/comments — the lesson-player "Discussions"
// tab (Q&A scoped to one lesson). Shares the Comment model with post
// comments (schema.prisma: exactly one of postId/lessonId is set).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { awardXp, touchStreak, XP_AWARD } from '@/lib/server/gamification/xp';

const Body = z.object({ content: z.string().trim().min(1).max(5000) });

async function resolveLessonOrg(lessonId: string) {
  return prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, module: { select: { course: { select: { organizationId: true } } } } },
  });
}

export async function GET(
  req: NextRequest,
  ctx2: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
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
      'MEMBER',
      req.headers.get('authorization'),
    );
    if (auth instanceof NextResponse) return auth;

    const comments = await prisma.comment.findMany({
      where: { lessonId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    return NextResponse.json(
      { items: comments },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function POST(
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
      'MEMBER',
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

    const comment = await prisma.comment.create({
      data: { lessonId, authorId: auth.user.sub, content: parsed.data.content },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    await awardXp(prisma, auth.user.sub, XP_AWARD.COMMENT);
    await touchStreak(prisma, auth.user.sub);

    return NextResponse.json(comment, { status: 201, headers: { 'x-request-id': ctx.requestId } });
  });
}
