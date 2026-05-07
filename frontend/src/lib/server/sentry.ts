/**
 * Sentry helpers for server-side capture inside route handlers / cron jobs.
 *
 * In the monolith, Sentry is initialised by `frontend/instrumentation.ts`
 * via `@sentry/nextjs` (auto-instruments fetch + Node http + RSC). This
 * module just re-exports the SDK and a `captureRouteError` helper for
 * try/catch blocks in route handlers, so callers don't need to import
 * `@sentry/nextjs` directly everywhere.
 */
import 'server-only';
import * as Sentry from '@sentry/nextjs';

export { Sentry };

/**
 * Capture an exception from a route handler / cron / server action and
 * return a sanitized message for the response body. Use inside catch:
 *
 *   } catch (err) {
 *     captureRouteError(err, { route: 'POST /api/orders' });
 *     return NextResponse.json({ error: 'Internal error' }, { status: 500 });
 *   }
 */
export function captureRouteError(err: unknown, context: Record<string, unknown> = {}): void {
  Sentry.captureException(err, { extra: context });
}
