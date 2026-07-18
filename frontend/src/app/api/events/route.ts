// GET /api/events — the Calendrier month grid, any community member.
// `?month=YYYY-MM` scopes to that calendar month (defaults to the current
// month); a month's worth of events is small enough to return unpaginated.
// POST /api/events — coach/moderator schedules a new event.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';

function monthRange(month: string | null): { start: Date; end: Date } | null {
  if (month === null) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, monthIndex, 1)),
      end: new Date(Date.UTC(year, monthIndex + 1, 1)),
    };
  }
  const match = month.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return null;
  const year = Number.parseInt(match[1] as string, 10);
  const monthIndex = Number.parseInt(match[2] as string, 10) - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org } = gate;

    const range = monthRange(req.nextUrl.searchParams.get('month'));
    if (!range) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'month must be YYYY-MM' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const events = await prisma.event.findMany({
      where: { organizationId: org.id, startAt: { gte: range.start, lt: range.end } },
      orderBy: { startAt: 'asc' },
      include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
    });

    return NextResponse.json(
      { items: events },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

const Body = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  startAt: z.string().datetime(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60),
  isOnline: z.boolean().default(true),
  meetingUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const gate = await requireCommunityRole(prisma, 'ADMIN', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org, ctx: auth } = gate;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const { title, description, startAt, durationMinutes, isOnline, meetingUrl } = parsed.data;

    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        createdById: auth.user.sub,
        title,
        description: description ?? null,
        startAt: new Date(startAt),
        durationMinutes,
        isOnline,
        meetingUrl: meetingUrl ?? null,
      },
      include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
    });

    return NextResponse.json(event, { status: 201, headers: { 'x-request-id': ctx.requestId } });
  });
}
