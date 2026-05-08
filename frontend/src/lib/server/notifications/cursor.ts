// Phase 2 Plan 02-00 — D-07 cursor pagination helper for notifications.
//
// Cursor shape (locked by 02-CONTEXT.md): base64(JSON.stringify({ createdAt, id }))
// where createdAt is an ISO 8601 string and id is the Notification's cuid.
// The cursor is opaque to clients — they pass it back verbatim.
//
// Why two fields: createdAt alone is not unique (two notifications minted in
// the same millisecond would tie); id alone breaks ordering across pages
// when notifications come in out-of-order. The composite (createdAt, id)
// matches the Prisma `@@index([userId, createdAt])` and disambiguates
// ties via the cuid lexicographic order.
//
// T-02-NOTIF-CURSOR-INJECTION: cursor is decoded into typed fields and fed
// to Prisma's parameterised `where` — there is no raw-SQL path, so a malformed
// cursor is harmless. We return null on any parse failure so the caller falls
// back to "first page" rather than 400-ing the client (cursors expire when
// notifications are deleted; treating them as a soft hint is friendlier).
import 'server-only';

export interface Cursor {
  createdAt: Date;
  id: string;
}

/** Encode a Cursor to the D-07 opaque base64 string. */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: c.createdAt.toISOString(), id: c.id }),
    'utf8',
  ).toString('base64');
}

/**
 * Decode a cursor string back to a typed Cursor.
 *
 * Returns null on any failure (null/undefined/empty input, malformed base64,
 * malformed JSON, missing fields, invalid date) so the caller falls back to
 * "first page" rather than 400-ing.
 */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    const createdAtRaw = obj['createdAt'];
    const idRaw = obj['id'];
    if (typeof createdAtRaw !== 'string' || typeof idRaw !== 'string' || idRaw.length === 0) {
      return null;
    }
    const createdAt = new Date(createdAtRaw);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: idRaw };
  } catch {
    return null;
  }
}
