// Sentry edge runtime config — used by Next.js middleware running on the
// edge runtime. Same conditional-init pattern. Edge runtime has limited
// SDK features (no profiling, no replay) — only basic error reporting.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
  });
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}
