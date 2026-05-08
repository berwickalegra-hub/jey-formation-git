// OBS-01 — Admin outbox visibility (read-only, paginated).
//
// Threat T-03-04-04 (field-name confusion): the schema column is `kind`
// (free-form dispatcher routing key, e.g. "notification.payment_received").
// We standardise on `kind` everywhere — query param + response field both
// named `kind`. Do NOT alias to `type` (RESEARCH.md Pitfall 4).
//
// Pattern mirrors Plan 03-02's user-list route:
//   requireAdmin('ADMIN') → enforceAdminRateLimit → parse filters →
//   prisma.outboxEvent.findMany(take=limit+1) → buildPage(rows, limit) →
//   serialize and return.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { OutboxEvent, Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { prisma } from '@/lib/server/prisma';
import {
  buildPage,
  clampLimit,
  cursorWhere,
  decodeCursor,
} from '@/lib/server/pagination/paginate';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

type OutboxStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DEAD';
const VALID_STATUSES = new Set<OutboxStatus>(['PENDING', 'SENT', 'FAILED', 'DEAD']);

interface SerializedOutboxEvent {
  id: string;
  kind: string;
  payload: unknown;
  status: string;
  attempts: number;
  lastError: string | null;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
}

function serialize(e: OutboxEvent): SerializedOutboxEvent {
  return {
    id: e.id,
    kind: e.kind,
    payload: e.payload,
    status: e.status,
    attempts: e.attempts,
    lastError: e.lastError,
    scheduledAt: e.scheduledAt.toISOString(),
    sentAt: e.sentAt ? e.sentAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const url = req.nextUrl;
    const statusParam = url.searchParams.get('status');
    const status =
      statusParam && VALID_STATUSES.has(statusParam as OutboxStatus)
        ? (statusParam as OutboxStatus)
        : null;
    const kind = url.searchParams.get('kind');
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.OutboxEventWhereInput = {
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.outboxEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const page = buildPage(rows, limit);
    return NextResponse.json(
      { items: page.items.map(serialize), nextCursor: page.nextCursor },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
