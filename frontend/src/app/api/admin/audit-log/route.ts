// ADMIN-04 (D-AUDIT-01) — paginated, filterable read of AdminAction rows.
//
// This is a read-only listing endpoint for incident triage. ADMIN role
// suffices (D-ADMIN-03 — admin listings expose PII without SUPERADMIN
// gating); the AdminAction table itself is append-only (no DELETE route)
// so this endpoint is non-destructive by absence-of-mutation
// (T-03-03-01 disposition).
//
// Filters (D-AUDIT-01):
//   ?actor       — exact match on actorId
//   ?action      — exact match on the dotted-string action key (e.g. "user.role_change")
//   ?targetType  — exact match on the targetType column (e.g. "User", "Withdrawal")
//   ?since       — ISO 8601 string → createdAt >= since
//   ?until       — ISO 8601 string → createdAt <= until
//   ?cursor      — opaque base64 cursor from a prior page's nextCursor
//   ?limit       — 1..50 (default 20)
//
// Field select returns the full row shape (id, actorId, action, targetType,
// targetId, metadata, ip, userAgent, createdAt) — admins need everything
// during incident response.
//
// Rate-limited per-userId (D-ADMIN-05 / T-03-03-04) so a polling UI can't
// burn the back-office's request budget.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

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
    const actor = url.searchParams.get('actor');
    const action = url.searchParams.get('action');
    const targetType = url.searchParams.get('targetType');
    const since = parseDate(url.searchParams.get('since'));
    const until = parseDate(url.searchParams.get('until'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const createdAtFilter: Prisma.DateTimeFilter | undefined =
      since || until
        ? {
            ...(since ? { gte: since } : {}),
            ...(until ? { lte: until } : {}),
          }
        : undefined;

    const where: Prisma.AdminActionWhereInput = {
      ...(actor ? { actorId: actor } : {}),
      ...(action ? { action } : {}),
      ...(targetType ? { targetType } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.adminAction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ip: true,
        userAgent: true,
        createdAt: true,
      },
    });

    return NextResponse.json(buildPage(rows, limit), {
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}
