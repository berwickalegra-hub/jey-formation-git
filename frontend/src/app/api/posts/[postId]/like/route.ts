// POST /api/posts/[postId]/like — toggles a like (create/delete on the
// `@@unique([postId, userId])` row). Notifies the post's author on a new
// like (not on unlike), deduped per (postId, likerId) so re-liking after
// an unlike doesn't spam a second notification.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';
import { createNotification } from '@/lib/server/notifications';
import { newPostLike } from '@/lib/server/notifications/templates';

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

    const existing = await prisma.like.findUnique({
      where: { postId_userId: { postId, userId: auth.user.sub } },
    });

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
    } else {
      await prisma.like.create({ data: { postId, userId: auth.user.sub } });
      if (post.authorId !== auth.user.sub) {
        await createNotification(prisma, newPostLike(post.authorId, postId, auth.user.sub));
      }
    }

    const likeCount = await prisma.like.count({ where: { postId } });

    return NextResponse.json(
      { liked: !existing, likeCount },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
