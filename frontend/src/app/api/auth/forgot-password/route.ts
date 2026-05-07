// AUTH-07 — POST /api/auth/forgot-password
//
// Enumeration-resistant: returns 200 { ok: true } regardless of whether the
// email exists (D-23). When the user exists, creates a PASSWORD_RESET code
// + email outbox event in one tx. When the user does not exist, runs
// dummyBcryptCompare for timing parity. No cookies are touched here — the
// flow continues at /api/auth/reset-password.
//
// CSRF carve-out: pre-session route.
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { zEmail } from '@/lib/server/zod-helpers';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createEmailLimiter } from '@/lib/server/middleware/rate-limit-by-email';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';
import { generateVerificationCode } from '@/lib/server/auth';
import { dummyBcryptCompare } from '@/lib/server/auth/dummy-bcrypt';
import { enqueueOutbox } from '@/lib/server/outbox';

const VERIFICATION_TTL_MS = Number(process.env.AUTH_VERIFICATION_TTL_MIN ?? 15) * 60 * 1000;

const Body = z.object({ email: zEmail });

const limiter = createEmailLimiter(redis ? { redis } : {}, {
  bucket: 'auth:forgot',
  windowMs: 60 * 60 * 1000, // 1 hour (D-08)
  max: Number(process.env.AUTH_FORGOT_RATE_LIMIT_MAX ?? 3),
  code: 'TOO_MANY_FORGOT_ATTEMPTS',
  message: 'Too many password-reset requests. Try again later.',
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
    const { email } = parsed.data;

    const rateFail = await limiter.check(req, email);
    if (rateFail) return rateFail;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      // Enumeration resistance (D-23): identical 200 + bcrypt timing parity.
      // Use the email as the dummy plaintext — the value is irrelevant; the
      // bcrypt cost is what matters.
      await dummyBcryptCompare(email);
      log.info('forgot-password no-user (enumeration-resist)');
      const res = NextResponse.json({ ok: true });
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await prisma.$transaction(async (tx) => {
      await tx.verificationCode.create({
        data: {
          userId: user.id,
          code,
          type: 'PASSWORD_RESET',
          expiresAt,
        },
      });
      await enqueueOutbox(tx, {
        kind: 'email.password_reset',
        payload: {
          to: email,
          code,
          expiresAt: expiresAt.toISOString(),
        },
      });
    });

    log.info('forgot-password code issued', { userId: user.id });
    const res = NextResponse.json({ ok: true });
    res.headers.set('x-request-id', ctx.requestId);
    return res;
  });
}
