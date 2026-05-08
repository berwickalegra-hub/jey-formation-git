// PIN-01 — POST (set/change) + DELETE on /api/auth/withdrawal-pin.
//
// Sequence (RESEARCH.md Pattern 6 + login/route.ts lockout pattern):
//
// POST:
//   1. verifyCsrf → bail 403 on miss
//   2. requireAuth → bail 401 on miss
//   3. Lookup withdrawalPinHash for ctx.user.sub
//   4. If hash exists (CHANGE path):
//      a. isLockedOut('pin:<userId>') → 423 LOCKED_OUT (early out, no bcrypt)
//      b. ChangeBody.safeParse: if fails → alwaysCompareDummy(<plain>) → 400 PIN_REQUIRED
//      c. verifyPin(currentPin, hash) → on fail: recordFailure → 423 LOCKED_OUT or 400 PIN_INVALID
//      d. recordSuccess + hashPin(newPin) + user.update → 200 { ok: true }
//   5. Else (SET path — no hash):
//      a. SetBody.safeParse: if fails → 400 VALIDATION_FAILED
//      b. hashPin(newPin) + user.update → 200 { ok: true }
//
// DELETE:
//   1. verifyCsrf → bail 403
//   2. requireAuth → bail 401
//   3. user.update({ withdrawalPinHash: null }) → 200 { ok: true }
//
// Lockout key MUST be `pin:${userId}` literal — never the email (Pitfall 7).
// Coupling PIN failures with login lockout would let either side DoS the
// other, which is the whole reason for an isolated counter namespace.
//
// Logging discipline: never log the plaintext PIN, currentPin, newPin or
// withdrawalPinHash — only userId, route, and outcome code. T-02-PIN-LOG-LEAK.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { hashPin, verifyPin, alwaysCompareDummy } from '@/lib/server/auth/pin';
import { isLockedOut, recordFailure, recordSuccess } from '@/lib/server/auth/lockout';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

const PinDigits = z.string().regex(/^\d{4,6}$/);
const SetBody = z.object({ newPin: PinDigits });
const ChangeBody = z.object({ currentPin: PinDigits, newPin: PinDigits });

/** Pitfall 7: PIN lockout namespace MUST be isolated from login lockout. */
function lockoutKey(userId: string): string {
  return `pin:${userId}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    const userRow = await prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { withdrawalPinHash: true },
    });

    // ── CHANGE path: existing hash present ────────────────────────────────
    if (userRow?.withdrawalPinHash) {
      const key = lockoutKey(auth.user.sub);

      if (await isLockedOut(key)) {
        log.warn('withdrawal-pin: locked out', { userId: auth.user.sub });
        return NextResponse.json(
          { error: 'LOCKED_OUT', message: 'Account temporarily locked.' },
          { status: 423, headers: { 'x-request-id': ctx.requestId } },
        );
      }

      const parsed = ChangeBody.safeParse(body);
      if (!parsed.success) {
        // CD-03 timing equalisation: spend ~250ms on bcrypt so wrong-shape
        // and wrong-PIN paths take the same wall-clock time. Pick the most
        // PIN-shaped value from the body, falling back to a constant string
        // — the boolean result is irrelevant.
        const probe =
          (typeof body?.['currentPin'] === 'string' ? (body['currentPin'] as string) : '') ||
          (typeof body?.['newPin'] === 'string' ? (body['newPin'] as string) : '') ||
          '0000';
        await alwaysCompareDummy(probe);
        return NextResponse.json(
          { error: 'PIN_REQUIRED', message: 'currentPin is required to change PIN.' },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }

      const ok = await verifyPin(parsed.data.currentPin, userRow.withdrawalPinHash);
      if (!ok) {
        const r = await recordFailure(key);
        if (r.locked) {
          return NextResponse.json(
            { error: 'LOCKED_OUT', message: 'Account temporarily locked.' },
            { status: 423, headers: { 'x-request-id': ctx.requestId } },
          );
        }
        return NextResponse.json(
          { error: 'PIN_INVALID', message: 'Current PIN is incorrect.' },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }

      await recordSuccess(key);
      const newHash = await hashPin(parsed.data.newPin);
      await prisma.user.update({
        where: { id: auth.user.sub },
        data: { withdrawalPinHash: newHash },
      });
      log.info('withdrawal-pin: changed', { userId: auth.user.sub });
      return NextResponse.json(
        { ok: true },
        { status: 200, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // ── SET path: no existing hash ────────────────────────────────────────
    const parsed = SetBody.safeParse(body);
    if (!parsed.success) {
      // Defense-in-depth: if a currentPin slipped in (no hash exists yet),
      // burn the same ~250ms so an attacker can't probe the inverse oracle.
      if (typeof body?.['currentPin'] === 'string') {
        await alwaysCompareDummy(body['currentPin'] as string);
      }
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const newHash = await hashPin(parsed.data.newPin);
    await prisma.user.update({
      where: { id: auth.user.sub },
      data: { withdrawalPinHash: newHash },
    });
    log.info('withdrawal-pin: set', { userId: auth.user.sub });
    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    await prisma.user.update({
      where: { id: auth.user.sub },
      data: { withdrawalPinHash: null },
    });

    log.info('withdrawal-pin: removed', { userId: auth.user.sub });
    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
