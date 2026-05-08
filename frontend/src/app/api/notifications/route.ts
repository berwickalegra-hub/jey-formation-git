// NOTIF-01 (GET list, cursor pagination) + NOTIF-02 (PATCH mark-read).
//
// Sequence (RESEARCH.md Patterns 4 & 5):
//   GET:    requireAuth → parse `unread`, `limit`, `cursor` → Prisma
//           findMany(take=limit+1) → encode nextCursor if hasMore →
//           serialize and return
//   PATCH:  verifyCsrf → requireAuth → Zod validate body → updateMany
//           scoped by userId → count unread → return { updated, unreadCount }
//
// userId is ALWAYS in the where clause; cross-tenant ids are silently
// ignored (D-13). Don't 403/404 differentiate — would leak existence.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Notification, Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { encodeCursor, decodeCursor } from '@/lib/server/notifications/cursor';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const PatchBody = z.object({
  ids: z.union([z.array(z.string().min(1)).min(1), z.literal('all')]),
});

interface SerializedNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

function serialize(n: Notification): SerializedNotification {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

function clampLimit(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const unread = url.searchParams.get('unread') === 'true';
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.NotificationWhereInput = {
      userId: auth.user.sub,
      ...(unread ? { readAt: null } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return NextResponse.json(
      { items: page.map(serialize), nextCursor },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => null);
    const parsed = PatchBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const where: Prisma.NotificationWhereInput =
      parsed.data.ids === 'all'
        ? { userId: auth.user.sub, readAt: null }
        : { userId: auth.user.sub, readAt: null, id: { in: parsed.data.ids } };

    const r = await prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });
    const unreadCount = await prisma.notification.count({
      where: { userId: auth.user.sub, readAt: null },
    });

    return NextResponse.json(
      { updated: r.count, unreadCount },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
