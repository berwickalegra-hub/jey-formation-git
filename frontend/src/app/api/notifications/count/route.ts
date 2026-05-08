// NOTIF-03 — GET /api/notifications/count
//
// Returns the unread badge count. Selective on the @@index([userId, readAt])
// from schema.prisma:211. Read-only — no CSRF needed.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const count = await prisma.notification.count({
      where: { userId: auth.user.sub, readAt: null },
    });

    return NextResponse.json(
      { count },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
