// NOTIF-04 — GET + PATCH /api/notifications/prefs
//
// Open JSON map { eventType: { email, inApp } } per D-10. Missing event
// types remain enabled (opt-out — handled by Wave 0 isChannelEnabled).
// PATCH deep-merges via Wave 0 mergePrefs and upserts; last-write-wins
// is the documented semantic (Pitfall 9 — not worth Serializable cost).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import {
  mergePrefs,
  type NotificationPrefs,
} from '@/lib/server/notifications/prefs-merge';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

const ChannelPrefs = z.object({
  email: z.boolean().optional(),
  inApp: z.boolean().optional(),
});
const PatchBody = z.object({
  prefs: z.record(z.string().min(1), ChannelPrefs),
});

function readPrefs(raw: Prisma.JsonValue | undefined | null): NotificationPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as NotificationPrefs;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const row = await prisma.notificationPreferences.findUnique({
      where: { userId: auth.user.sub },
      select: { prefs: true },
    });

    return NextResponse.json(
      { prefs: readPrefs(row?.prefs) },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
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

    const existingRow = await prisma.notificationPreferences.findUnique({
      where: { userId: auth.user.sub },
      select: { prefs: true },
    });
    const existing = readPrefs(existingRow?.prefs);
    const merged = mergePrefs(existing, parsed.data.prefs);

    await prisma.notificationPreferences.upsert({
      where: { userId: auth.user.sub },
      create: {
        userId: auth.user.sub,
        prefs: merged as unknown as Prisma.InputJsonValue,
      },
      update: { prefs: merged as unknown as Prisma.InputJsonValue },
    });

    return NextResponse.json(
      { prefs: merged },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
