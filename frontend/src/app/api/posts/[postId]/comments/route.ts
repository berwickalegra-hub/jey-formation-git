// GET/POST /api/posts/[postId]/comments — the Club feed's comment thread
// (shares the Comment model with lesson comments — see schema.prisma:
// exactly one of postId/lessonId is set). POST awards XP + notifies the
// post's author.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';
import { awardXp, touchStreak, XP_AWARD } from '@/lib/server/gamification/xp';
import { createNotification } from '@/lib/server/notifications';
import { newPostComment } from '@/lib/server/notifications/templates';

const Body = z.object({ content: z.string().trim().min(1).max(5000) });

export async function GET(
  req: NextRequest,
  ctx2: { params: Promise<{ postId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org } = gate;

    const { postId } = await ctx2.params;
    const post = await prisma.post.findFirst({
      where: { id: postId, organizationId: org.id },
      select: { id: true },
    });
    if (!post) {
      return NextResponse.json(
        { error: 'POST_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const comments = await prisma.comment.findMany({
      where: { postId },
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
  ctx2: { params: Promise<{ postId: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org, ctx: auth } = gate;

    const { postId } = await ctx2.params;
    const post = await prisma.post.findFirst({
      where: { id: postId, organizationId: org.id },
      select: { id: true, authorId: true },
    });
    if (!post) {
      return NextResponse.json(
        { error: 'POST_NOT_FOUND' },
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

    const comment = await prisma.comment.create({
      data: { postId, authorId: auth.user.sub, content: parsed.data.content },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    await awardXp(prisma, auth.user.sub, XP_AWARD.COMMENT);
    await touchStreak(prisma, auth.user.sub);

    if (post.authorId !== auth.user.sub) {
      await createNotification(
        prisma,
        newPostComment(post.authorId, postId, comment.id, comment.author.name ?? 'Un membre'),
      );
    }

    return NextResponse.json(comment, { status: 201, headers: { 'x-request-id': ctx.requestId } });
  });
}
