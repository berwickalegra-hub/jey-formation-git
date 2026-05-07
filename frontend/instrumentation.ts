// Next.js instrumentation hook — runs once per runtime at boot. We use it
// to import the right Sentry config file for the runtime we're in.
// See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
//
// `register()` is called by Next.js automatically on cold start of each
// runtime (Node, edge). This file is the canonical entry point for
// runtime-side observability — add other init (OpenTelemetry, etc) here.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
