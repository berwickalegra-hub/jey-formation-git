// ADMIN-02 — GET /api/admin/orders (list with status/since/until filters,
// cursor pagination).
//
// Mirrors the users-list pattern (Plan 03-02 Task 1) with Order-specific
// filters. since/until are silently ignored when malformed (D-LIST-05
// spirit: admin listings tolerate input rather than 400-ing).
//
// Field whitelist excludes `metadata` (often large; can be added later if
// admin needs it) but includes the essentials for the back-office UI.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import {
  clampLimit,
  cursorWhere,
  buildPage,
  decodeCursor,
} from '@/lib/server/pagination/paginate';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

const ORDER_SELECT = {
  id: true,
  userId: true,
  amount: true,
  currency: true,
  status: true,
  customerEmail: true,
  provider: true,
  providerChargeId: true,
  paymentUrl: true,
  paymentMethod: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
} as const satisfies Prisma.OrderSelect;

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const status = url.searchParams.get('status');
    const since = parseDate(url.searchParams.get('since'));
    const until = parseDate(url.searchParams.get('until'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.OrderWhereInput = {
      ...(status ? { status } : {}),
      ...(since || until
        ? {
            createdAt: {
              ...(since ? { gte: since } : {}),
              ...(until ? { lte: until } : {}),
            },
          }
        : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: ORDER_SELECT,
    });

    const page = buildPage(rows, limit);
    return NextResponse.json(page, {
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}
