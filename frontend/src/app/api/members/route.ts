// GET /api/members — the Membres directory: cursor-paginated, newest
// member first, optional `?q=` name search (case-insensitive contains).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org } = gate;

    const q = req.nextUrl.searchParams.get('q')?.trim();
    const limit = clampLimit(req.nextUrl.searchParams.get('limit'));
    const cursor = decodeCursor(req.nextUrl.searchParams.get('cursor'));

    const rows = await prisma.organizationMember.findMany({
      where: {
        organizationId: org.id,
        ...cursorWhere(cursor),
        ...(q ? { user: { name: { contains: q, mode: 'insensitive' } } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            level: true,
            xp: true,
            streakCount: true,
          },
        },
      },
    });

    const page = buildPage(rows, limit);

    return NextResponse.json(
      {
        items: page.items.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          avatarUrl: m.user.avatarUrl,
          level: m.user.level,
          xp: m.user.xp,
          streakCount: m.user.streakCount,
          role: m.role,
          joinedAt: m.createdAt,
        })),
        nextCursor: page.nextCursor,
      },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
