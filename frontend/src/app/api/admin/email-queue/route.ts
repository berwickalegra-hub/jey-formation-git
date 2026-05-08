// OBS-02 — Admin email-queue visibility (read-only, paginated, PII-scoped).
//
// Threat T-03-04-01 (Information Disclosure): EmailJob.html may contain user
// secrets (verification codes, password-reset URLs, magic links). The admin
// response truncates `html` to ≤200 chars as `bodyPreview` and never returns
// the full `html` or `text` fields. D-OBS-02.
//
// WR-02 — explicit PII disclosure policy (no field-level redaction beyond
// the html/text drop):
//
//   - `to` is returned verbatim. Admins already see recipient emails on the
//     /api/admin/users user-detail and audit-log surfaces; redacting here
//     would not actually limit ADMIN-tier visibility.
//   - `subject` is returned verbatim. Some transactional templates encode
//     the verification code in the subject line ("Verify your email — code
//     XXXXXXXX"). Admins are trusted with this per CONTEXT.md (D-OBS-02:
//     PII access is allowed for admins). Subject visibility is the same
//     policy applied to outbox events on /api/admin/outbox.
//   - `lastError` is returned verbatim — used for incident triage; we
//     accept that provider-bounce messages may echo recipient addresses.
//   - `bodyPreview` is the FIRST 200 chars of `html` only. The full `html`
//     and `text` fields are NEVER selected for the response; the cap is
//     defense-in-depth against tokens that appear past the first 200 chars.
//
// If a future threat-model decision tightens this (e.g. mask `to`,
// strip alphanumeric runs ≥6 in subject), the masking should land here so
// the admin response is the single chokepoint.
//
// Sequence:
//   requireAdmin('ADMIN') → enforceAdminRateLimit → parse filters →
//   prisma.emailJob.findMany(take=limit+1) → drop html/text + emit
//   bodyPreview → encode nextCursor → return.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { prisma } from '@/lib/server/prisma';
import {
  clampLimit,
  cursorWhere,
  decodeCursor,
  encodeCursor,
} from '@/lib/server/pagination/paginate';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

type EmailJobStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DEAD';
const VALID_STATUSES = new Set<EmailJobStatus>(['PENDING', 'SENT', 'FAILED', 'DEAD']);

interface EmailJobSummary {
  id: string;
  to: string;
  subject: string;
  bodyPreview: string;
  status: string;
  attempts: number;
  lastError: string | null;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
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
      statusParam && VALID_STATUSES.has(statusParam as EmailJobStatus)
        ? (statusParam as EmailJobStatus)
        : null;
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.EmailJobWhereInput = {
      ...(status ? { status } : {}),
      ...cursorWhere(cursor),
    };

    // PII-protective select — `html` is selected only so we can compute the
    // 200-char preview, then dropped from the response. `text` is never
    // selected (never reaches the wire).
    const rows = await prisma.emailJob.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        to: true,
        subject: true,
        html: true,
        status: true,
        attempts: true,
        lastError: true,
        scheduledAt: true,
        sentAt: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items: EmailJobSummary[] = sliced.map(({ html, ...rest }) => ({
      id: rest.id,
      to: rest.to,
      subject: rest.subject,
      bodyPreview: (html ?? '').slice(0, 200),
      status: rest.status,
      attempts: rest.attempts,
      lastError: rest.lastError,
      scheduledAt: rest.scheduledAt.toISOString(),
      sentAt: rest.sentAt ? rest.sentAt.toISOString() : null,
      createdAt: rest.createdAt.toISOString(),
    }));
    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return NextResponse.json({ items, nextCursor }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
