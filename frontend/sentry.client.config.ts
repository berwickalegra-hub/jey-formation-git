// Sentry client (browser) config — Next.js auto-loads this file.
// Boots only when NEXT_PUBLIC_SENTRY_DSN is set; otherwise the SDK
// becomes a no-op so dev / unconfigured forks don't ship a noisy DSN.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    // Tracing (optional, costly in volume) — opt in via env.
    tracesSampleRate: parseRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0),
    // Session replay (also costly) — opt in via env.
    replaysSessionSampleRate: parseRate(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SAMPLE_RATE, 0),
    replaysOnErrorSampleRate: 1.0,
    // Strip known noise.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications.',
    ],
  });
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}
