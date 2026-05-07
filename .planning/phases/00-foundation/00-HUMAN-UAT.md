---
status: partial
phase: 00-foundation
source: [00-VERIFICATION.md]
started: 2026-05-07
updated: 2026-05-07
---

## Current Test

[awaiting human testing]

## Tests

### 1. `pnpm dev` boot smoke — OTel + Sentry coexistence
expected: `pnpm --filter frontend dev` boots without errors. No `Cannot find module '@opentelemetry/...'` warnings. Sentry's HTTP auto-instrumentation still patches before route handlers run (Pitfall 6 of RESEARCH.md). `/api/health` and `/api/readyz` respond 200. If `SENTRY_DSN` is set, the Sentry init banner appears in startup logs.
result: [pending]

### 2. `next build` clean — no deprecated config warnings
expected: `pnpm --filter frontend build` completes with exit 0. Output does NOT contain `experimental.instrumentationHook` deprecation banner. Output does NOT contain "edge runtime" warnings on any `app/api/*/route.ts` file. Build artifacts under `frontend/.next/standalone` produced.
result: [pending]

### 3. End-to-end Sentry capture
expected: With `SENTRY_DSN` set in a real env (or local `.env.local`), trigger an unhandled error in a route handler (e.g. `throw new Error('test')` in a temporary `app/api/_debug/throw/route.ts`). Within ~1 minute, the error appears in the Sentry project's Issues feed with the right service name. Confirms `onRequestError` re-export is wiring correctly.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
