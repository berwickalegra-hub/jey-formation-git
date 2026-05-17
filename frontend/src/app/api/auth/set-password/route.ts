// POST /api/auth/set-password — first-time password for OAuth-only users.
//
// Use case: user signed up via Google (passwordHash=null) and wants to also
// be able to log in via email/password. /change-password requires the
// current password, which an OAuth-only user doesn't have, so this is the
// dedicated path.
//
// Refusal: if the user already has a passwordHash, return 409 PASSWORD_ALREADY_SET
// with a hint to use /change-password. We do NOT want this endpoint to act as
// a sneaky password-reset bypass for someone who hijacked an active session.
//
// Side-effects (identical to change-password's tail):
//   - bump tokenVersion in the same write (kills other sessions)
//   - mint fresh access + refresh tokens with the new tokenVersion
//   - rotate the CSRF token so the current browser stays logged in
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import {
  createAccessToken,
  createRefreshToken,
  hashPassword,
  setAuthCookies,
  setCsrfCookie,
  verifyCsrf,
} from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { isBanned } from '@/lib/server/auth/banned-passwords';
import { isPwned } from '@/lib/server/auth/hibp';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

const Body = z.object({
  newPassword: z.string(),
});

function jsonError(
  code: string,
  status: number,
  requestId: string,
  message?: string,
): NextResponse {
  const res = NextResponse.json({ error: code, ...(message ? { message } : {}) }, { status });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // 1. CSRF first — same order as change-password.
    const csrfFail = verifyCsrf(req);
    if (csrfFail) {
      csrfFail.headers.set('x-request-id', ctx.requestId);
      return csrfFail;
    }

    // 2. requireAuth (also does the tokenVersion DB re-check).
    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) {
      auth.headers.set('x-request-id', ctx.requestId);
      return auth;
    }

    // 3. Body validation.
    let body: z.infer<typeof Body>;
    try {
      const json = await req.json();
      body = Body.parse(json);
    } catch {
      return jsonError('VALIDATION_FAILED', 400, ctx.requestId, 'Invalid request body');
    }

    // 4. Password policy gates BEFORE the DB read.
    if (isBanned(body.newPassword)) {
      return jsonError('PASSWORD_BANNED', 400, ctx.requestId, 'This password is too common.');
    }
    const minLength = Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 10);
    if (body.newPassword.length < minLength) {
      return jsonError(
        'PASSWORD_TOO_SHORT',
        400,
        ctx.requestId,
        `Password must be at least ${minLength} characters`,
      );
    }
    if (process.env.PASSWORD_HIBP_CHECK === '1' && (await isPwned(body.newPassword))) {
      return jsonError(
        'PASSWORD_PWNED',
        400,
        ctx.requestId,
        'This password has appeared in a known data breach — choose another',
      );
    }

    // 5. Refuse if a password is already set — that's the change-password path.
    //    Doing this AFTER the policy check keeps the timing similar to a
    //    legitimate set: an attacker who steals a session and probes this
    //    endpoint sees the same latency regardless of whether the victim
    //    already has a password.
    const user = await prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { id: true, email: true, passwordHash: true, tokenVersion: true },
    });
    if (!user) {
      return jsonError('USER_NOT_FOUND', 404, ctx.requestId);
    }
    if (user.passwordHash) {
      return jsonError(
        'PASSWORD_ALREADY_SET',
        409,
        ctx.requestId,
        'A password is already set. Use change-password instead.',
      );
    }

    // 6+7. Hash and atomically write passwordHash + bump tokenVersion.
    const newHash = await hashPassword(body.newPassword);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        tokenVersion: { increment: 1 },
      },
      select: { id: true, email: true, tokenVersion: true },
    });

    // 8. Mint new cookies so this browser stays logged in (mirrors change-password).
    const access = await createAccessToken({
      sub: updated.id,
      email: updated.email,
      tokenVersion: updated.tokenVersion,
    });
    const refresh = await createRefreshToken(updated.id, updated.tokenVersion);
    await setAuthCookies(access, refresh);
    await setCsrfCookie();

    log.info('set-password success', { userId: updated.id });

    const res = NextResponse.json({ ok: true });
    res.headers.set('x-request-id', ctx.requestId);
    return res;
  });
}
