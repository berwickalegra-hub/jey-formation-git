// OBS-02 — Admin email-queue visibility (read-only, paginated, PII-truncated).
//
// Threat T-03-04-01 (Information Disclosure): EmailJob.html may contain user
// PII (verification codes, password reset URLs, magic links). The admin
// response truncates `html` to ≤200 chars as `bodyPreview` and never returns
// the full `html` or `text` fields. D-OBS-02.
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
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

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

    return NextResponse.json(
      { items, nextCursor },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
