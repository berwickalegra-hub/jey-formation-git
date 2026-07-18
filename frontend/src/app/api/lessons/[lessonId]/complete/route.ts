// POST /api/lessons/[lessonId]/complete — toggles the completion checkbox
// shown in the lesson-player nav bar. Awards XP + bumps the daily streak
// only on the false→true transition (no clawback on uncheck, no re-award
// on repeated toggling — XP here is a vanity gamification metric, not a
// balance, so this is an acceptable simplification for v1).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { awardXp, touchStreak, XP_AWARD } from '@/lib/server/gamification/xp';

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
      select: { id: true, module: { select: { course: { select: { organizationId: true } } } } },
    });
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

    const existing = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: auth.user.sub, lessonId } },
    });
    const wasCompleted = existing?.completed ?? false;
    const nextCompleted = !wasCompleted;

    const progress = await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: auth.user.sub, lessonId } },
      update: { completed: nextCompleted, completedAt: nextCompleted ? new Date() : null },
      create: {
        userId: auth.user.sub,
        lessonId,
        completed: nextCompleted,
        completedAt: nextCompleted ? new Date() : null,
      },
    });

    if (!wasCompleted && nextCompleted) {
      await awardXp(prisma, auth.user.sub, XP_AWARD.LESSON_COMPLETE);
      await touchStreak(prisma, auth.user.sub);
    }

    return NextResponse.json(
      { completed: progress.completed },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
