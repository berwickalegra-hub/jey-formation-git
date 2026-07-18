// GET /api/post-categories — the category pills shown above the Club feed
// composer/filter bar. Small, unpaginated list (a community has a handful
// of categories, not hundreds).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org } = gate;

    const categories = await prisma.postCategory.findMany({
      where: { organizationId: org.id },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, emoji: true },
    });

    return NextResponse.json(
      { items: categories },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
