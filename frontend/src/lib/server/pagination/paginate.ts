// Reusable cursor pagination helper for admin listings (D-LIST-01..04 +
// Phase 2 D-07). Wraps the existing `notifications/cursor.ts` codec so
// every admin GET handler can share the same `?limit` clamp + cursor
// where-fragment + page-slice logic.
//
// Usage from a Route Handler:
//   const limit = clampLimit(url.searchParams.get('limit'));
//   const cursor = decodeCursor(url.searchParams.get('cursor'));
//   const where: Prisma.UserWhereInput = {
//     ...filterFragments,
//     ...cursorWhere(cursor),
//   };
//   const rows = await prisma.user.findMany({
//     where,
//     orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
//     take: limit + 1,
//   });
//   return NextResponse.json(buildPage(rows, limit));
//
// Why split helpers vs a single `paginate()` wrapper: each Prisma model has
// a different `select`/`include` shape, so taking the +1 / building the
// cursor separately keeps per-route flexibility while still de-duplicating
// the boilerplate.
import 'server-only';

import { encodeCursor, decodeCursor, type Cursor } from '@/lib/server/notifications/cursor';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

/**
 * Clamp `?limit=N` into [1, MAX_LIMIT]. Falls back to DEFAULT_LIMIT on
 * NaN / non-positive / missing input. Mirrors Phase 2 `notifications/route.ts`
 * shape (D-LIST-04).
 */
export function clampLimit(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

export interface PaginateResult<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Build the cursor where-fragment. Caller merges this with its own
 * filter where-clause (so we don't have to know the model shape).
 *
 * Composite (createdAt, id) ordering matches the index strategy used by
 * Phase 2 notifications and is required for stable pagination across ties.
 */
export function cursorWhere(cursor: Cursor | null): Record<string, unknown> {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Slice the +1 page and emit the next cursor from the last visible row.
 * `rows` MUST be the result of a `findMany({ take: limit + 1, orderBy: [createdAt desc, id desc] })`.
 */
export function buildPage<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): PaginateResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { items, nextCursor };
}

export { encodeCursor, decodeCursor };
export type { Cursor };
