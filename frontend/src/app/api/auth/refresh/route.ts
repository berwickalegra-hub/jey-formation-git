// POST /api/auth/refresh — AUTH-04 single-flight refresh.
//
// Source: RESEARCH.md Pattern 12 + Pattern 5 caller pattern.
//
// Flow:
//   1. Read refresh cookie (path-scoped /api/auth — D-21)
//   2. verifyRefreshToken → 401 on bad token
//   3. user.findUnique by sub → 401 if deleted
//   4. tokenVersion DB check → 401 on mismatch (D-19, T-1-02 mitigation)
//   5. acquireRefreshLock(userId) → 409 CONFLICT on contention (D-20)
//   6. Mint new access + refresh + csrf cookies
//   7. release lock in finally (Pitfall 6 — release even on error)
//
// No CSRF check: refresh is itself authenticated via the refresh cookie and is
// path-scoped to /api/auth. The refresh cookie cannot be used cross-site for
// non-/api/auth requests, so CSRF would block legitimate refresh.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  REFRESH_COOKIE_NAME,
  createAccessToken,
  createRefreshToken,
  setAuthCookies,
  setCsrfCookie,
  verifyRefreshToken,
} from '@/lib/server/auth';
import { acquireRefreshLock } from '@/lib/server/auth/refresh-lock';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const refreshCookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
    if (!refreshCookie) {
      return NextResponse.json(
        { error: 'INVALID_REFRESH', message: 'Refresh token missing.' },
        { status: 401, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const payload = await verifyRefreshToken(refreshCookie);
    if (!payload) {
      return NextResponse.json(
        { error: 'INVALID_REFRESH', message: 'Refresh token invalid or expired.' },
        { status: 401, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, tokenVersion: true },
    });
    if (!user) {
      return NextResponse.json(
        { error: 'INVALID_REFRESH', message: 'Account not found.' },
        { status: 401, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    if (user.tokenVersion !== payload.tokenVersion) {
      // D-19 — refresh post-password-change is rejected.
      return NextResponse.json(
        { error: 'INVALID_REFRESH', message: 'Session expired.' },
        { status: 401, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // D-20 — single-flight: only one rotation in flight per user.
    const release = await acquireRefreshLock(user.id);
    if (!release) {
      return NextResponse.json(
        { error: 'CONFLICT', message: 'Concurrent refresh; retry shortly.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    try {
      const accessToken = await createAccessToken({
        sub: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion,
      });
      const refreshToken = await createRefreshToken(user.id, user.tokenVersion);
      await setAuthCookies(accessToken, refreshToken);
      await setCsrfCookie();
      return NextResponse.json(
        { ok: true },
        { status: 200, headers: { 'x-request-id': ctx.requestId } },
      );
    } finally {
      await release();
    }
  });
}
