---
phase: 05-webhooks-and-vercel-cron
reviewed: 2026-05-08T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - frontend/src/app/api/webhooks/bictorys/route.ts
  - frontend/src/app/api/cron/outbox-drain/route.ts
  - frontend/src/app/api/cron/email-queue-drain/route.ts
  - frontend/src/app/api/cron/verification-cleanup/route.ts
  - frontend/src/app/api/cron/order-expiration/route.ts
  - frontend/src/app/api/cron/webhook-log-purge/route.ts
  - frontend/src/lib/server/cron/auth.ts
  - frontend/src/lib/server/cron/auth.test.ts
  - frontend/src/lib/server/webhook/bictorys.ts
  - frontend/src/lib/server/webhook/bictorys.test.ts
  - frontend/src/lib/server/orders/expire.ts
  - frontend/src/lib/server/orders/expire.test.ts
  - frontend/src/lib/server/queues/email-queue-singleton.ts
  - frontend/src/test-utils/bictorys-mock.ts
  - frontend/src/lib/server/observability/vercel-json-shape.test.ts
  - frontend/src/lib/server/observability/env-shape.test.ts
  - frontend/src/app/api/webhooks/bictorys/route.test.ts
  - frontend/src/app/api/cron/outbox-drain/route.test.ts
  - frontend/src/app/api/cron/email-queue-drain/route.test.ts
  - frontend/src/app/api/cron/verification-cleanup/route.test.ts
  - frontend/src/app/api/cron/order-expiration/route.test.ts
  - frontend/src/app/api/cron/webhook-log-purge/route.test.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: clean
---

# Phase 5: Code Review Report

**Reviewed:** 2026-05-08
**Depth:** standard
**Files Reviewed:** 22 (13 source + 9 tests, plus `vercel.json` and `.env.example`)
**Status:** clean

## Summary

Phase 5 (Webhooks + Vercel Cron) lands cleanly. All CLAUDE.md invariants are honored:

- **Runtime enforcement** — every Route Handler in scope exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`. `maxDuration` is set on all five cron routes (30s for light routes, 60s for batch drainers) and `LEASE_TTL_MS` is consistently ~2× `maxDuration` (Pitfall 3 honored across the board).
- **Webhook hygiene** — `frontend/src/app/api/webhooks/bictorys/route.ts` is a pure shim that NEVER reads the request body. Body ownership is delegated to the protected `createWebhookHandler` factory which performs the byte-identical `arrayBuffer()` read before HMAC verify. Side-effects emit through `enqueueOutbox(tx, …)` inside the factory's Serializable transaction — no fire-and-forget closures (D-04 outbox-not-closures invariant respected). The `postCommit` references found in `frontend/src/lib/server/webhook/handler.ts` are the factory's own audit-only hook (no per-route postCommit closures are passed in).
- **HMAC correctness** — `frontend/src/lib/server/webhook/bictorys.ts` is a thin lazy-init re-export of `createBictorysProvider().webhookProvider` (the real HMAC code lives in the protected `payments/bictorys.ts`). The single behavioral patch — upgrading `kind` to `'refunded'` for refund payloads — is gated by a lower-cased status check and preserves the underlying ids. `frontend/src/test-utils/bictorys-mock.ts` re-derives the HMAC via the canonical recipe (`hmac(secret).update('${ts}.').update(rawBody)`) so fixture/verifier drift is impossible by construction. The fixture's `status` discriminator covers `'succeeded' | 'failed' | 'refunded'`, satisfying the paid/refunded/failed coverage requirement.
- **CRON_SECRET timing-safe compare** — `frontend/src/lib/server/cron/auth.ts` uses `crypto.timingSafeEqual` with an explicit length-mismatch fast-path (`a.length !== b.length` returns 401 *before* the buffer compare, so `timingSafeEqual` never throws on mismatched buffers). The boot-time misconfiguration path returns 500 `CRON_NOT_CONFIGURED` (fails closed). All five cron routes call `verifyCronSecret(req)` as their very first action and bail on the returned `NextResponse | null`.
- **Schema correctness** — `outbox-drain` correctly resets stuck rows via `OutboxEvent.scheduledAt` (not the non-existent `startedAt`). `webhook-log-purge` correctly queries `WebhookLog.createdAt` (not the non-existent `receivedAt`). Both confirmed against `frontend/prisma/schema.prisma:238-250` and `:255-266`.
- **Lease coordination** — every cron wraps its body in `withLease(redis ?? undefined, '<name>', LEASE_TTL_MS, fn)` with TTL ~2× `maxDuration`. Names are unique per cron.
- **TypeScript strictness** — production code contains zero `as any` / `as never` casts. The spread-omit pattern in `outbox-drain/route.ts:77` (`{ prisma, ...(queue ? { emailQueue: queue } : {}) }`) correctly handles `exactOptionalPropertyTypes` by omitting the optional field rather than assigning `undefined`. The three `as never` occurrences in `webhook/bictorys.test.ts:72,79,85` coerce minimal hand-built payloads into the strict `BictorysWebhookPayload` shape — an acceptable test idiom and not a production concern.
- **Test fidelity** — every cron-route test mocks `verifyCronSecret` to return `NextResponse.json({error}, {status:401})` for the failure path (correct shape, not a plain `Response`). No test files use `as never` to bypass type errors in the route mocks.
- **Vercel cron config** — `frontend/vercel.json` declares all five cron paths and the `vercel-json-shape.test.ts` tripwire verifies (a) exactly 5 entries, (b) path/schedule format regexes, (c) every path resolves to an actual `route.ts` file, and (d) the canonical sorted set matches.
- **Env documentation** — `.env.example` documents `CRON_SECRET` (with `openssl rand -base64 32` hint), `WEBHOOK_LOG_RETENTION_DAYS="90"`, and `ORDER_EXPIRATION_MINUTES="30"`. `env-shape.test.ts` enforces these as tripwires.

No critical or warning issues found. Two minor info-level observations follow.

## Info

### IN-01: Inconsistent multiplier symbol in TTL comments

**File:** `frontend/src/app/api/cron/outbox-drain/route.ts:21,45` vs. `frontend/src/app/api/cron/email-queue-drain/route.ts:19`, `frontend/src/app/api/cron/verification-cleanup/route.ts:18`, `frontend/src/app/api/cron/order-expiration/route.ts:19`, `frontend/src/app/api/cron/webhook-log-purge/route.ts:18`
**Issue:** Comments use a mix of `~2× maxDuration` (with mathematical multiplication sign U+00D7) and `~2 × maxDuration` (same glyph with surrounding spaces). The outbox-drain file uses both forms. Cosmetic only — does not affect behavior.
**Fix:** Pick one form and apply it uniformly. Suggested:
```ts
const LEASE_TTL_MS = 120_000; // ~2x maxDuration (Pitfall 3)
```
(ASCII `x` avoids any future encoding issues if a tool re-encodes the file.)

### IN-02: `expirePendingOrders` opens N transactions instead of one

**File:** `frontend/src/lib/server/orders/expire.ts:33-44`
**Issue:** The helper iterates `candidates` and opens a separate `prisma.$transaction(...)` for each row. With `batchSize=100` that's 100 round-trips per cron tick. The current per-row `updateMany({ where: { id, status: 'PENDING' } })` is already atomic on its own (no `findFirst` precedes it inside the tx), so the wrapping `$transaction` adds no additional safety — only latency. Performance issues are explicitly out of v1 scope per the review charter, so this is informational only and does not block.
**Fix (optional, future):** Drop the per-row tx and call `updateMany` directly:
```ts
const u = await opts.prisma.order.updateMany({
  where: { id: o.id, status: 'PENDING' },
  data: { status: 'EXPIRED' },
});
if (u.count > 0) expired++;
```
Or, even simpler, replace the entire `findMany` + loop with a single `updateMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } } })` and return its `count`. The current shape preserves the per-row hook point for a future Phase 6 outbox emit (`notification.order_expired`) — a deliberate trade-off documented in the file header — so leaving it as-is until that phase ships is fine.

---

_Reviewed: 2026-05-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
