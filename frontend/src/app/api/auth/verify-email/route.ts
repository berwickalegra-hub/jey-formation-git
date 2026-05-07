// AUTH-03 — POST /api/auth/verify-email
//
// Consumes an EMAIL_VERIFY code: marks `usedAt`, sets `User.emailVerifiedAt`,
// and issues all three auth cookies (token, refresh path-scoped to /api/auth,
// csrf). Single-use code: a second submission of the same code returns
// VERIFICATION_CODE_INVALID. Code lookup never distinguishes user-not-found
// from code-not-found — both surface as VERIFICATION_CODE_INVALID for
// enumeration resistance.
//
// CSRF carve-out: pre-session route — the CSRF cookie is set HERE on success,
// so calling verifyCsrf would 403 every legitimate request.
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { zEmail } from '@/lib/server/zod-helpers';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createEmailLimiter } from '@/lib/server/middleware/rate-limit-by-email';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';
import {
  VERIFICATION_CODE_REGEX,
  setAuthCookies,
  setCsrfCookie,
  createAccessToken,
  createRefreshToken,
  timingSafeCompare,
} from '@/lib/server/auth';

const Body = z.object({
  email: zEmail,
  code: z.string().regex(VERIFICATION_CODE_REGEX, 'Invalid verification code format'),
});

const limiter = createEmailLimiter(redis ? { redis } : {}, {
  bucket: 'auth:verify',
  windowMs: 15 * 60 * 1000, // 15 min (D-08)
  max: Number(process.env.AUTH_VERIFY_RATE_LIMIT_MAX ?? 5),
  code: 'TOO_MANY_VERIFY_ATTEMPTS',
  message: 'Too many verification attempts. Try again later.',
});

function formatIssues(err: z.ZodError) {
  return err.errors.map((e) => ({ path: e.path.join('.'), message: e.message }));
}

export async function POST(req: NextRequest): Promise<Response> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      const res = NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: formatIssues(parsed.error) },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }
    const { email, code } = parsed.data;

    const rateFail = await limiter.check(req, email);
    if (rateFail) return rateFail;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, tokenVersion: true },
    });
    // Enumeration resistance: don't distinguish user-not-found from
    // code-not-found.
    if (!user) {
      const res = NextResponse.json(
        {
          error: 'VERIFICATION_CODE_INVALID',
          message: 'Verification code is invalid.',
        },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }

    const codeRow = await prisma.verificationCode.findFirst({
      where: {
        userId: user.id,
        code,
        type: 'EMAIL_VERIFY',
        usedAt: null,
      },
      select: { id: true, code: true, expiresAt: true },
    });
    if (!codeRow) {
      const res = NextResponse.json(
        {
          error: 'VERIFICATION_CODE_INVALID',
          message: 'Verification code is invalid.',
        },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }
    if (codeRow.expiresAt.getTime() < Date.now()) {
      const res = NextResponse.json(
        {
          error: 'VERIFICATION_CODE_EXPIRED',
          message: 'Verification code has expired.',
        },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }
    // Defensive constant-time compare (Prisma where already exact-matched).
    if (!timingSafeCompare(code, codeRow.code)) {
      const res = NextResponse.json(
        {
          error: 'VERIFICATION_CODE_INVALID',
          message: 'Verification code is invalid.',
        },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }

    await prisma.$transaction(async (tx) => {
      await tx.verificationCode.update({
        where: { id: codeRow.id },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    });

    const access = await createAccessToken({
      sub: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    });
    const refresh = await createRefreshToken(user.id, user.tokenVersion);
    await setAuthCookies(access, refresh);
    await setCsrfCookie();

    log.info('verify-email success', { userId: user.id });
    const res = NextResponse.json({
      ok: true,
      user: { sub: user.id, email: user.email },
    });
    res.headers.set('x-request-id', ctx.requestId);
    return res;
  });
}
