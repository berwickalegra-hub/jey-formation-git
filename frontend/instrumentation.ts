// Source: composed per Pattern 2 above + existing file at frontend/instrumentation.ts.
// CRITICAL: keep Sentry imports inside `register()` to preserve runtime-conditional
// boot. registerOTel() is safe to call from both nodejs and edge runtimes.
import { registerOTel } from '@vercel/otel';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
  registerOTel({ serviceName: 'amadou-monolith' });
}

// Required for Sentry to capture unhandled route errors (Next.js 15+).
export { onRequestError } from '@sentry/nextjs';
