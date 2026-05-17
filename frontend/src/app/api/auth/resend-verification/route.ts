// POST /api/auth/resend-verification — re-send an EMAIL_VERIFY code.
//
// Pre-session route: a signup happened but the user lost / never received the
// 8-char code. We mint a fresh VerificationCode and enqueue an outbox email
// event. Old codes stay valid until expiry — no need to invalidate them.
//
// Security profile (mirrors signup):
//   - Enumeration-resistant: identical 200 { ok: true } whether the email
//     exists, is already verified, or is unknown. We never tell the client.
//   - No CSRF: pre-session route — no CSRF cookie exists yet.
//   - Rate-limited per email via Upstash Redis. Redis is MANDATORY here:
//     resend is a free email-cost vector for attackers, so we fail-closed
//     with a 503 when Redis is absent (even outside production). signup is
//     rate-limited too, but the email cost there is bounded by Resend's
//     dedupe of repeated sends to the same address — resend has no such
//     natural cap, hence the stricter posture.
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
import { enqueueOutbox } from '@/lib/server/outbox';

const VERIFICATION_TTL_MS = Number(process.env.AUTH_VERIFICATION_TTL_MIN ?? 15) * 60 * 1000;

const Body = z.object({ email: zEmail });

// Tight bucket: 3 resends per 15min per email. An attacker who knows a
// victim's email can otherwise spam them with cosmetic verification mails.
const limiter = createEmailLimiter(redis ? { redis } : {}, {
  bucket: 'auth:resend',
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RESEND_RATE_LIMIT_MAX ?? 3),
  code: 'TOO_MANY_RESEND_ATTEMPTS',
  message: 'Too many resend attempts. Try again later.',
});

function formatIssues(err: z.ZodError) {
  return err.issues.map((e) => ({ path: e.path.join('.'), message: e.message }));
}

export async function POST(req: NextRequest): Promise<Response> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // Fail-closed when Redis is absent: resend is too cheap-to-abuse without
    // a shared limiter. The signup / verify-email routes can fall back to
    // the memory store because their rate is naturally bounded by Resend's
    // dedup; resend has no such cap.
    if (!redis) {
      log.warn('resend-verification: Redis missing — refusing request');
      const res = NextResponse.json(
        {
          error: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Resend service is unavailable. Try again shortly.',
        },
        { status: 503, headers: { 'Retry-After': '30' } },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }

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

    // Enumeration-resistant: from here on, every branch returns 200 ok.
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    if (user && !user.emailVerifiedAt) {
      const code = generateVerificationCode();
      const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
      await prisma.$transaction(async (tx) => {
        await tx.verificationCode.create({
          data: {
            userId: user.id,
            code,
            type: 'EMAIL_VERIFY',
            expiresAt,
          },
        });
        await enqueueOutbox(tx, {
          kind: 'email.verification_code',
          payload: {
            to: user.email,
            code,
            expiresAt: expiresAt.toISOString(),
          },
        });
      });
      log.info('resend-verification: code re-issued', { userId: user.id });
    } else {
      // No user, OR already verified — log without leaking which case it is.
      log.info('resend-verification: noop branch (enumeration-resist)');
    }

    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.headers.set('x-request-id', ctx.requestId);
    return res;
  });
}
