// GET /api/posts — the Club feed: pinned posts first (small, unpaginated
// list — a community pins a handful of posts, not hundreds), then the
// regular feed cursor-paginated by (createdAt desc, id desc).
// POST /api/posts — the feed composer. Awards XP for posting.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { awardXp, touchStreak, XP_AWARD } from '@/lib/server/gamification/xp';

const PINNED_LIMIT = 5;

function postInclude(userId: string) {
  return {
    author: { select: { id: true, name: true, avatarUrl: true, level: true } },
    category: { select: { id: true, name: true, emoji: true } },
    _count: { select: { comments: true, likes: true } },
    likes: { where: { userId }, select: { id: true } },
  };
}

interface PostRow {
  id: string;
  title: string | null;
  content: string;
  mediaUrl: string | null;
  mediaType: string | null;
  isPinned: boolean;
  createdAt: Date;
  author: { id: string; name: string | null; avatarUrl: string | null; level: number };
  category: { id: string; name: string; emoji: string | null } | null;
  _count: { comments: number; likes: number };
  likes: { id: string }[];
}

function toPostView(post: PostRow) {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    mediaUrl: post.mediaUrl,
    mediaType: post.mediaType,
    isPinned: post.isPinned,
    createdAt: post.createdAt,
    author: post.author,
    category: post.category,
    commentCount: post._count.comments,
    likeCount: post._count.likes,
    likedByMe: post.likes.length > 0,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org, ctx: auth } = gate;

    const categoryId = req.nextUrl.searchParams.get('categoryId');
    const limit = clampLimit(req.nextUrl.searchParams.get('limit'));
    const cursor = decodeCursor(req.nextUrl.searchParams.get('cursor'));
    const baseWhere = { organizationId: org.id, ...(categoryId ? { categoryId } : {}) };

    const [pinnedRows, rows] = await Promise.all([
      prisma.post.findMany({
        where: { ...baseWhere, isPinned: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PINNED_LIMIT,
        include: postInclude(auth.user.sub),
      }),
      prisma.post.findMany({
        where: { ...baseWhere, isPinned: false, ...cursorWhere(cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: postInclude(auth.user.sub),
      }),
    ]);

    const page = buildPage(rows as unknown as PostRow[], limit);

    return NextResponse.json(
      {
        pinned: (pinnedRows as unknown as PostRow[]).map(toPostView),
        items: page.items.map(toPostView),
        nextCursor: page.nextCursor,
      },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

const Body = z
  .object({
    content: z.string().trim().min(1).max(5000),
    title: z.string().trim().min(1).max(200).optional(),
    categoryId: z.string().optional(),
    mediaUrl: z.string().url().optional(),
    mediaType: z.enum(['IMAGE', 'VIDEO']).optional(),
  })
  .refine((v) => Boolean(v.mediaUrl) === Boolean(v.mediaType), {
    message: 'mediaUrl and mediaType must be provided together',
  });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org, ctx: auth } = gate;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const { content, title, categoryId, mediaUrl, mediaType } = parsed.data;

    if (categoryId) {
      const category = await prisma.postCategory.findFirst({
        where: { id: categoryId, organizationId: org.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json(
          { error: 'CATEGORY_NOT_FOUND' },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }
    }

    const post = await prisma.post.create({
      data: {
        organizationId: org.id,
        authorId: auth.user.sub,
        content,
        title: title ?? null,
        categoryId: categoryId ?? null,
        mediaUrl: mediaUrl ?? null,
        mediaType: mediaType ?? null,
      },
      include: postInclude(auth.user.sub),
    });

    await awardXp(prisma, auth.user.sub, XP_AWARD.POST);
    await touchStreak(prisma, auth.user.sub);

    return NextResponse.json(toPostView(post as unknown as PostRow), {
      status: 201,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}
