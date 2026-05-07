// AUTH-09 — PUT /api/auth/change-password.
// Per RESEARCH.md Pattern 17 + Pitfall 9. Authenticated user updates their own
// password; we bump `tokenVersion` in the same write so OTHER sessions fail on
// next request, then issue NEW cookies (with the bumped tokenVersion) so the
// CURRENT browser stays logged in.
//
// Order of operations is load-bearing:
//   1. verifyCsrf      — cheap, no DB hit (D-02)
//   2. requireAuth     — DB hit + tokenVersion check (D-03)
//   3. Zod parse       — body shape (D-04, VALIDATION_FAILED on fail)
//   4. Password policy — length, banned, optional HIBP (D-10/D-12/D-13)
//                        BEFORE the DB lookup so weak-password attempts
//                        don't even hit prisma
//   5. user.findUnique — load passwordHash to verify currentPassword
//   6. verifyPassword  — bcrypt compare against currentPassword
//   7. hashPassword    — bcrypt hash newPassword (cost 12)
//   8. user.update     — atomic single-row write of passwordHash + tokenVersion
//   9. setAuthCookies + setCsrfCookie with the BUMPED tokenVersion (Pitfall 9)
import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import {
  createAccessToken,
  createRefreshToken,
  hashPassword,
  setAuthCookies,
  setCsrfCookie,
  verifyCsrf,
  verifyPassword,
} from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { isBanned } from '@/lib/server/auth/banned-passwords';
import { isPwned } from '@/lib/server/auth/hibp';
import { prisma } from '@/lib/server/prisma';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string(),
});

function jsonError(
  code: string,
  status: number,
  requestId: string,
  message?: string,
): NextResponse {
  const res = NextResponse.json(
    { error: code, ...(message ? { message } : {}) },
    { status },
  );
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // 1. CSRF first — short-circuit unauthenticated/forged calls cheaply.
    const csrfFail = verifyCsrf(req);
    if (csrfFail) {
      csrfFail.headers.set('x-request-id', ctx.requestId);
      return csrfFail;
    }

    // 2. requireAuth — also performs DB tokenVersion check so a stale JWT
    //    signed before a previous password change is rejected here, not later.
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
      return jsonError(
        'VALIDATION_FAILED',
        400,
        ctx.requestId,
        'Invalid request body',
      );
    }

    // 4. Password policy — length, banned, optional HIBP. All BEFORE DB read
    //    so weak-password probing can't time-attack the user lookup.
    const minLength = Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 10);
    if (body.newPassword.length < minLength) {
      return jsonError(
        'PASSWORD_TOO_SHORT',
        400,
        ctx.requestId,
        `Password must be at least ${minLength} characters`,
      );
    }
    if (isBanned(body.newPassword)) {
      return jsonError(
        'PASSWORD_BANNED',
        400,
        ctx.requestId,
        'This password is too common — choose another',
      );
    }
    if (
      process.env.PASSWORD_HIBP_CHECK === '1' &&
      (await isPwned(body.newPassword))
    ) {
      return jsonError(
        'PASSWORD_PWNED',
        400,
        ctx.requestId,
        'This password has appeared in a known data breach — choose another',
      );
    }

    // 5. Load user (needs passwordHash + current tokenVersion for the bump).
    //    OAuth-only accounts have passwordHash=null; we treat that as
    //    INVALID_CREDENTIALS rather than leaking the OAuth-only state.
    const user = await prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        tokenVersion: true,
      },
    });
    if (!user || !user.passwordHash) {
      return jsonError(
        'INVALID_CREDENTIALS',
        400,
        ctx.requestId,
        'Current password is incorrect',
      );
    }

    // 6. Verify currentPassword.
    const ok = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!ok) {
      return jsonError(
        'INVALID_CREDENTIALS',
        400,
        ctx.requestId,
        'Current password is incorrect',
      );
    }

    // 7+8. Hash new password and atomically update passwordHash + tokenVersion.
    //      A single user.update is atomic by Postgres semantics — no
    //      $transaction wrapper needed for a one-row write.
    const newHash = await hashPassword(body.newPassword);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        tokenVersion: { increment: 1 },
      },
      select: { id: true, email: true, tokenVersion: true },
    });

    // 9. Pitfall 9: mint NEW tokens with the BUMPED tokenVersion and call
    //    setAuthCookies + setCsrfCookie so the current browser stays logged
    //    in. Other sessions still hold the old tokenVersion and will fail on
    //    the next requireAuth call.
    const access = await createAccessToken({
      sub: updated.id,
      email: updated.email,
      tokenVersion: updated.tokenVersion,
    });
    const refresh = await createRefreshToken(
      updated.id,
      updated.tokenVersion,
    );
    await setAuthCookies(access, refresh);
    await setCsrfCookie();

    log.info('change-password success', { userId: updated.id });

    const res = NextResponse.json({ ok: true });
    res.headers.set('x-request-id', ctx.requestId);
    return res;
  });
}
