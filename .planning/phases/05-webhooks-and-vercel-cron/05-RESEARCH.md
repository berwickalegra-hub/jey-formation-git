# Phase 5: Webhooks and Vercel Cron - Research

**Researched:** 2026-05-08
**Domain:** Webhook idempotency + Vercel Cron scheduled background work
**Confidence:** HIGH (all prescriptive patterns verified against existing battle-tested helpers in the repo)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Bictorys is the only webhook provider shipped in v1. Route at `frontend/src/app/api/webhooks/bictorys/route.ts` calls `createWebhookHandler({ provider, prisma, onPaid, onRefunded, onFailed })`. Other providers explicitly out-of-scope.
- **D-02:** Bictorys-specific `WebhookProvider<TPayload>` impl lives at NEW file `frontend/src/lib/server/webhook/bictorys.ts` (NOT in `lib/server/payments/`). Two distinct surfaces — payments client vs. inbound HMAC verifier — deserve two files.
- **D-03:** Replay window: `BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` env (default `60000`). The factory does NOT accept this — verifier reads `process.env` at handler-call time so `vi.stubEnv` works.
- **D-04:** Side-effects go through outbox via `enqueueOutbox(tx, event)` from inside `onPaid`/`onRefunded`/`onFailed`. NEVER `postCommit` closures (the API still exposes it but new code must not use it).
- **D-05:** One route file per cron, no shared dispatcher: `frontend/src/app/api/cron/<name>/route.ts` with a `POST` handler. Six route files total (1 webhook + 5 cron). Forks delete what they don't need.
- **D-06:** Cron auth helper at NEW file `frontend/src/lib/server/cron/auth.ts`, exports `verifyCronSecret(req: NextRequest): NextResponse | null` (same shape as `verifyCsrf`).
- **D-07:** All 5 crons wrap helper call in `withLease(redis, name, ttlMs, fn)`. Defense-in-depth; `withLease` falls back to direct `fn()` when Redis is undefined.
- **D-08:** `outbox-drain` and `email-queue-drain` process up to **100 rows per invocation**. Hard-code `BATCH_SIZE = 100` (NOT env-configurable in v1).
- **D-09:** Stuck-row PROCESSING reset window: **90 seconds**. Reset is the FIRST step inside the cron route, BEFORE the claim-and-process loop. Hard-coded.
- **D-10:** `maxDuration` per route — `outbox-drain` + `email-queue-drain`: **60s**; `verification-cleanup` + `order-expiration` + `webhook-log-purge`: **30s**. Lives in each `route.ts` via `export const maxDuration = N`.
- **D-11:** `WEBHOOK_LOG_RETENTION_DAYS` env (default `90`), documented in `.env.example`.
- **D-12:** `frontend/vercel.json` — schemas + paths verbatim (see RESEARCH §6).
- **D-13:** `verification-cleanup` is a one-liner `prisma.verificationCode.deleteMany`; no new helper.
- **D-14:** `order-expiration` needs `lib/server/orders/expire.ts` helper. `ORDER_EXPIRATION_MINUTES` env (default 30); returns `{ expired: N }`.
- **D-15:** `webhook-log-purge` is inline `prisma.webhookLog.deleteMany`; no new helper.
- **D-16:** Wave 0 = scaffolding (RED tests + helpers + fixtures + `.env.example` + env-shape assertions). Wave 1 = 6 route handlers + vercel.json (7 plans, parallel).
- **D-17:** Test mocks use `NextResponse` (not plain `Response`); use `NextRequest` for handlers reading `req.nextUrl`. `verifyCronSecret` test covers: missing header, wrong scheme, wrong secret, correct.
- **D-18:** Webhook handler tests cover: valid HMAC + first delivery, replay-dedup, tampered body, expired replay window, each event type dispatches the right handler.
- **D-19:** Cron route tests cover: 401 on missing/wrong secret, happy path returns `{ processed: N }`, lease-coordination via mocked `withLease`.
- **D-20:** `vercel.json` validation test asserts: `crons` length === 5, each `path` matches `^/api/cron/[a-z-]+$`, all 5 paths correspond to actual `route.ts` files.
- **D-21:** Wave 0: ~6–10 files, all in different paths from Wave 1 routes.
- **D-22:** Wave 1: 7 parallel plans, no `files_modified` overlap.
- **D-23:** Parallel-execution lessons from Phase 4 carry forward (worktrees + `--no-verify` + no STATE.md/ROADMAP.md edits).

### Claude's Discretion

- Specific file naming inside `lib/server/cron/` (single `auth.ts` locked; future `index.ts` barrel at planner discretion).
- Logging verbosity inside cron routes — `log.info({ processed: N, durationMs })` once per drain is fine.
- Whether to add `dynamic = 'force-dynamic'` export to cron routes (planner verifies via test).
- Sentry tag conventions for cron tick failures.

### Deferred Ideas (OUT OF SCOPE)

- Distributed circuit breaker for cron-driven Bictorys calls (per-fork concern).
- Multi-provider webhook scaffold (Stripe / Paddle / etc.) — interface allows it, no v1 routes.
- Cron-tick observability dashboard — Sentry tags + log lines suffice for v1.
- `OUTBOX_STUCK_RESET_SECONDS` env var — hard-coded 90s in v1.
- Email rate-limit / send-quota tracking.
- Cron retry / dead-letter alerting beyond Sentry.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WH-01 | `POST /api/webhooks/bictorys` route — `runtime='nodejs'` + `dynamic='force-dynamic'`; raw body via `req.arrayBuffer()`; 60s replay window | §1 (HMAC scheme), §2 (factory invocation), §11 Pitfall 5 (raw body invariant) |
| WH-02 | Idempotent webhook — Serializable tx + `WebhookLog @@unique([externalId, eventType])` dedup; outbox-not-closures | §2 (factory already enforces; new code uses `enqueueOutbox(tx, ...)` inside event handlers) |
| CRON-01 | `POST /api/cron/outbox-drain` — every 1m; up to 100 rows; backoff; reset stuck rows; `maxDuration=60` | §3 (route shim with `withLease` + stuck-row reset + `drainOutbox`) |
| CRON-02 | `POST /api/cron/email-queue-drain` — every 1m; up to 100 rows; `resend.emails.send()`; `maxDuration=60` | §4 (loop calling `EmailQueue.drainOne()` up to BATCH_SIZE) |
| CRON-03 | `POST /api/cron/verification-cleanup` — hourly; deletes expired codes | §5 (one-liner `verificationCode.deleteMany`) |
| CRON-04 | `POST /api/cron/order-expiration` — every 5m; PENDING → EXPIRED | §7 (new helper `lib/server/orders/expire.ts` with batched updateMany + outbox notify) |
| CRON-05 | `POST /api/cron/webhook-log-purge` — daily; deletes by retention | §8 (inline `webhookLog.deleteMany`) |
| CRON-06 | All cron handlers verify `Authorization: Bearer ${CRON_SECRET}` | §6 (`verifyCronSecret` impl with `timingSafeEqual`) |
| CRON-07 | `vercel.json` declares schedules for all 5 | §9 (exact JSON) |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

| Directive | How Phase 5 Honors It |
|-----------|------------------------|
| Every Route Handler MUST `export const runtime = 'nodejs'` | Every route file in this phase exports it as the FIRST export; runtime-enforcement.test.ts already CI-fails otherwise |
| Webhook handlers read raw body via `req.arrayBuffer()` BEFORE any other body access | `createWebhookHandler` factory already does this (handler.ts:94); route file does NOT call `req.json()` |
| Webhook handlers emit side-effects via outbox, NEVER fire-and-forget closures | `onPaid`/`onRefunded`/`onFailed` call `enqueueOutbox(tx, event)` inside the Serializable tx |
| Cron handlers MUST verify `Authorization: Bearer ${CRON_SECRET}` | `verifyCronSecret(req)` returns 401 NextResponse on missing/wrong secret |
| Sentry init stays in `instrumentation.ts` `register()` | Not modified by this phase |
| `BICTORYS_API_KEY` (charges) and `BICTORYS_PRIVATE_KEY` (payouts) are distinct | Webhook reads `BICTORYS_WEBHOOK_SECRET` only — neither charge nor payout key |
| Cookies `httpOnly` + `Secure` (prod) + `SameSite=Lax` | N/A (cron + webhook routes never set cookies) |
| Files Claude must NOT modify: `webhook/handler.ts`, `outbox/dispatcher.ts`, `leader-lease.ts`, `payments/*` | Phase 5 calls these only — never edits |

## Summary

Phase 5 ships THIN ROUTE ADAPTERS — every line of business logic lives in protected `lib/server/*` helpers that already exist and are CALL-ONLY. The work decomposes into:

1. **One webhook adapter** — `app/api/webhooks/bictorys/route.ts` builds a `WebhookProvider<BictorysWebhookPayload>` and feeds it to the existing `createWebhookHandler({...})` factory at `frontend/src/lib/server/webhook/handler.ts:90`. The factory already does raw-body reading, HMAC verify, Serializable tx, dedup via `WebhookLog @@unique([externalId, eventType])`, dispatch to event handlers, and `processedAt` write-back. The route's `onPaid`/`onRefunded`/`onFailed` handlers emit side-effects via `enqueueOutbox(tx, event)` (`outbox/index.ts:25`) inside the same tx — never fire-and-forget closures.

2. **Five cron adapters + vercel.json** — `app/api/cron/<name>/route.ts` (5 files) each (a) verifies `Authorization: Bearer ${CRON_SECRET}` via the new `verifyCronSecret` helper, (b) wraps the work in `withLease(redis, name, ttlMs, fn)` from `leader-lease.ts:41`, (c) calls one of `drainOutbox(deps, 100)` / `EmailQueue.drainOne()` loop / `prisma.verificationCode.deleteMany` / `expirePendingOrders(prisma, opts)` / `prisma.webhookLog.deleteMany`. `frontend/vercel.json` declares the 5 schedules.

3. **Three new helper modules + .env.example additions** — `lib/server/cron/auth.ts` (`verifyCronSecret`), `lib/server/webhook/bictorys.ts` (HMAC verifier + payload parser), `lib/server/orders/expire.ts` (PENDING→EXPIRED batch helper). Plus `.env.example` appends `WEBHOOK_LOG_RETENTION_DAYS=90` and `ORDER_EXPIRATION_MINUTES=30`.

The HMAC scheme is **already solved** in `frontend/src/lib/server/payments/bictorys.ts:367-413` — the existing `webhookProvider` exported from `createBictorysProvider({...})` is a turnkey `WebhookProvider<BictorysWebhookPayload>`. **D-02 still requires a new `lib/server/webhook/bictorys.ts` file** (forks add new providers there), but it can either re-export the existing one from the payments module or construct one inline. Recommended: re-export to avoid duplication; document the dependency.

**Primary recommendation:** Wave 0 ships RED tests + the 3 new helpers + `.env.example` block. Wave 1 ships 7 parallel route plans (1 webhook + 5 cron + vercel.json). Every route is < 50 lines; every cron is structurally identical (verify secret → makeRequestContext → withLease → call helper → return JSON). Adopt the canonical NextRequest/NextResponse mocking from day 1 (Phase 4 lesson D-17).

## Standard Stack

### Core (already in `frontend/package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | ^16.1.6 | Route handlers + `NextRequest`/`NextResponse` | App Router is the deployment target |
| `@prisma/client` | ^5.22.0 | DB access, Serializable tx, `deleteMany` | Already wired everywhere |
| `@upstash/redis` | ^1.34.3 | `withLease` distributed lock; cron coordination | HTTP-based; no connection lifecycle |
| `node:crypto` | builtin | `timingSafeEqual` for `verifyCronSecret` HMAC compare | Stdlib — no dep |
| `vitest` | (devdep) | RED tests for all 6 routes + 3 helpers | Phase 0 baseline |

[VERIFIED: frontend/package.json:25-46]

### No new packages required

Phase 5 introduces no new npm dependencies. Every primitive needed (HMAC verify, lease coordination, outbox enqueue, email-queue drain) already exists in protected helpers.

### Alternatives Considered

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `withLease` + Redis | `setInterval` background loop | Vercel functions are stateless — no long-lived process to host the interval (CLAUDE.md "no setInterval loops") |
| Per-cron auth helper | Inline `Authorization` check in each route | DRY; one place to fix if Vercel's auth header format changes (D-06) |
| Re-use existing `payments/bictorys.ts` `webhookProvider` directly | New `webhook/bictorys.ts` file | D-02 requires the new file location for cohesion. Implementation can re-export to avoid duplication. |
| Env-configurable `BATCH_SIZE` | Hard-coded 100 | YAGNI — knob almost never moves (D-08) |
| Env-configurable `OUTBOX_STUCK_RESET_SECONDS` | Hard-coded 90s | YAGNI — defer to a real-workload need (D-09) |

## Architecture Patterns

### Recommended File Layout

```
frontend/
├── vercel.json                                          # NEW — D-12
└── src/
    ├── app/api/
    │   ├── webhooks/bictorys/
    │   │   ├── route.ts                                 # NEW — Wave 1, ~25 LOC
    │   │   └── route.test.ts                            # NEW — Wave 0, ~150 LOC RED
    │   └── cron/
    │       ├── outbox-drain/{route.ts,route.test.ts}        # NEW — Wave 1 + Wave 0
    │       ├── email-queue-drain/{route.ts,route.test.ts}   # NEW
    │       ├── verification-cleanup/{route.ts,route.test.ts}# NEW
    │       ├── order-expiration/{route.ts,route.test.ts}    # NEW
    │       └── webhook-log-purge/{route.ts,route.test.ts}   # NEW
    └── lib/server/
        ├── cron/
        │   ├── auth.ts                                  # NEW — verifyCronSecret
        │   └── auth.test.ts                             # NEW — Wave 0
        ├── webhook/
        │   ├── bictorys.ts                              # NEW — re-export or inline impl
        │   └── bictorys.test.ts                         # NEW — Wave 0
        └── orders/
            ├── expire.ts                                # NEW — expirePendingOrders helper
            └── expire.test.ts                           # NEW — Wave 0
```

[CITED: D-21, D-22 — Wave 0 / Wave 1 split]

### Pattern 1: Webhook Adapter Route

**What:** Thin route that constructs a provider + event handlers and exports the result of `createWebhookHandler`.
**When to use:** Any inbound webhook that must be idempotent + signature-verified.

```typescript
// frontend/src/app/api/webhooks/bictorys/route.ts
// PROTECTED — calls createWebhookHandler factory; never edits it.
// CLAUDE.md invariants: runtime=nodejs (Buffer/crypto); raw body before json (factory does this).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import 'server-only';
import { createWebhookHandler } from '@/lib/server/webhook/handler';
import { bictorysWebhookProvider } from '@/lib/server/webhook/bictorys';
import { enqueueOutbox } from '@/lib/server/outbox';
import { prisma } from '@/lib/server/prisma';

export const POST = createWebhookHandler({
  prisma,
  provider: bictorysWebhookProvider,

  async onPaid(payload, tx) {
    const externalRef = String(payload.charge_id ?? payload.chargeId ?? payload.id ?? '');
    const order = await tx.order.findFirst({ where: { providerChargeId: externalRef } });
    if (!order) return {}; // unknown charge — log + drop (no DB row to update)

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'PAID', paidAt: new Date(), paymentMethod: String(payload.payment_method ?? '') || null },
    });

    if (order.userId) {
      await enqueueOutbox(tx, {
        kind: 'notification.payment_received',
        payload: {
          userId: order.userId,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
        },
      });
    }
    if (order.customerEmail) {
      await enqueueOutbox(tx, {
        kind: 'email.payment_confirmation',
        payload: { to: order.customerEmail, orderId: order.id, amount: order.amount, currency: order.currency },
      });
    }
    return {}; // do NOT use postCommit — outbox-not-closures invariant (D-04)
  },

  async onRefunded(payload, tx) {
    const externalRef = String(payload.charge_id ?? payload.chargeId ?? payload.id ?? '');
    const order = await tx.order.findFirst({ where: { providerChargeId: externalRef } });
    if (!order) return {};
    await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
    return {};
  },

  async onFailed(payload, tx) {
    const externalRef = String(payload.charge_id ?? payload.chargeId ?? payload.id ?? '');
    const order = await tx.order.findFirst({ where: { providerChargeId: externalRef } });
    if (!order) return {};
    await tx.order.update({ where: { id: order.id }, data: { status: 'FAILED' } });
    return {};
  },
});
```

[VERIFIED: createWebhookHandler signature in handler.ts:90-92; enqueueOutbox shape in outbox/index.ts:25-37; OutboxEvent kinds in outbox/types.ts:12-49]

### Pattern 2: Cron Adapter Route (canonical shape)

**What:** Verify secret → enter request context → withLease → call helper → return `{ processed }`.
**When to use:** Every cron route in this phase shares this shape.

```typescript
// frontend/src/app/api/cron/outbox-drain/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // D-10

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { drainOutbox } from '@/lib/server/outbox/dispatcher';
import { redis } from '@/lib/server/redis';
import { prisma } from '@/lib/server/prisma';
import { createLogger } from '@/lib/server/logger';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

const log = createLogger();
const BATCH_SIZE = 100;          // D-08
const STUCK_RESET_SEC = 90;      // D-09
const LEASE_TTL_MS = 120_000;    // ~2× maxDuration

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let processed = 0;

    await withLease(redis ?? undefined, 'outbox-drain', LEASE_TTL_MS, async () => {
      // 1. Reset stuck PROCESSING rows older than 90s — D-09 — FIRST step
      await prisma.$executeRaw`
        UPDATE "OutboxEvent"
        SET "status" = 'PENDING', "scheduledAt" = NOW()
        WHERE "status" = 'PROCESSING'
          AND "scheduledAt" < NOW() - INTERVAL '${Prisma.raw(STUCK_RESET_SEC.toString())} seconds'
      `;
      // (Or use prisma.outboxEvent.updateMany with a manual `lt` cutoff —
      // dispatcher uses `scheduledAt` not `startedAt` per dispatcher.ts:54.)

      // 2. Drain
      const result = await drainOutbox({ prisma }, BATCH_SIZE);
      processed = result.processed;
      log.info('outbox-drain tick', {
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        dead: result.dead,
        requestId: ctx.requestId,
      });
    });

    return NextResponse.json(
      { ok: true, processed },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

[VERIFIED: drainOutbox signature in dispatcher.ts:49-52; withLease signature in leader-lease.ts:41-46; redis import in redis.ts:43; OutboxEvent has `scheduledAt`, NOT `startedAt` — dispatcher.ts:54]

> ⚠️ **Stuck-row column name correction:** the orchestrator brief mentioned `startedAt` for the stuck-row reset. The actual `OutboxEvent` schema (`prisma/schema.prisma:238-250`) has `scheduledAt`, no `startedAt`. The dispatcher claims rows by setting `status='PROCESSING'` (dispatcher.ts:67-70) but does NOT update `scheduledAt` on claim — meaning the cutoff condition `WHERE status='PROCESSING' AND scheduledAt < NOW() - INTERVAL '90s'` works correctly: a row claimed ≥90s ago that never reached SENT/DEAD/PENDING is stuck and `scheduledAt` is its original (or last-retry) timestamp. **Action:** the planner should verify with the orchestrator whether to (a) use `scheduledAt` as proxy for stuck-time (works because PROCESSING rows aren't normally written to) or (b) add a `startedAt` column. Recommended: (a) — schema unchanged.

### Pattern 3: Anti-Patterns to Avoid

- **Edge runtime on cron/webhook routes:** breaks `node:crypto`, Prisma, Buffer. CLAUDE.md invariant + CI test enforced.
- **`req.json()` before `req.arrayBuffer()` in webhook:** silent HMAC mismatch — JSON re-serialize differs byte-for-byte from what Bictorys signed. CLAUDE.md invariant.
- **`postCommit` closures in webhook event handlers:** lost on crash. Use `enqueueOutbox(tx, ...)` (D-04, CLAUDE.md "outbox-not-closures").
- **Custom auth-style middleware:** use the HOF return pattern (`NextResponse | null`) so callers `if (fail) return fail;` cleanly.
- **Bash-style env reads at module top:** `process.env.X` at module top runs at import time. Read inside the request handler so `vi.stubEnv` works (Phase 4 lesson; mirrored in `bictorys.ts:109-116`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC verify + replay window + dedup | Custom verifier + custom dedup logic | `createWebhookHandler({...})` from `webhook/handler.ts` | Already does Serializable tx + `WebhookLog @@unique` + raw-body invariant |
| Outbox claim + backoff + DEAD-letter | Custom worker | `drainOutbox` from `outbox/dispatcher.ts` | 30s/2m/10m/30m/1h backoff, MAX_ATTEMPTS=5, atomic per-row claim |
| Distributed lock | `SETNX` ceremony | `withLease(redis, name, ttlMs, fn)` from `leader-lease.ts` | NX+EX semantics, holder-id guard, no-Redis fallback |
| Bictorys HMAC | Re-derive HMAC + replay logic | `createBictorysProvider({...}).webhookProvider` (already exists at `payments/bictorys.ts:367-413`) | Two paths (`x-secret-key` and HMAC), dev escape hatch, replay window |
| Email send + retry + DEAD-letter | Custom drain loop | `EmailQueue.drainOne()` from `queues/email-queue.ts` | Persists EmailJob row + Redis pointer; retries with backoff |
| Outbox enqueue from inside tx | `tx.outboxEvent.create({...})` directly | `enqueueOutbox(tx, event)` from `outbox/index.ts` | Type-safe `OutboxEvent` discriminated union; planner-friendly |
| Cron auth | Hand-rolled `Authorization` parser per route | `verifyCronSecret(req)` from `lib/server/cron/auth.ts` (NEW) | Single point of truth, timing-safe compare |
| Order expiration | Inline in route | `expirePendingOrders(prisma, opts)` from `lib/server/orders/expire.ts` (NEW, D-14) | Find + update + outbox emit is more than one query — testable surface |

**Key insight:** Phase 5 is gluing together existing primitives. The temptation to "inline a quick HMAC check" or "just write a quick lock myself" is the trap — every helper above is battle-tested and CLAUDE.md-protected. Calling them is a 1-line change; reimplementing is a regression hazard.

## 1. HMAC Signature Scheme for Bictorys

**Already implemented** in `frontend/src/lib/server/payments/bictorys.ts:367-428`. Two acceptance paths:

| Path | Header(s) | Verification | Notes |
|------|-----------|--------------|-------|
| 1. Shared secret | `x-secret-key` | Timing-safe compare against `BICTORYS_WEBHOOK_SECRET` | Simple; used for non-HMAC integrations |
| 2. HMAC-SHA256 | `x-webhook-signature` + `x-webhook-timestamp` | `HMAC-SHA256(secret).update("${ts}.").update(rawBody).digest('hex')` | Replay window check via `Date.now() - tsNum > webhookReplayWindowMs()` (default 60_000ms) |

[VERIFIED: payments/bictorys.ts:380-412 — both paths]

**Env var:** `BICTORYS_WEBHOOK_SECRET` (already in `.env.example:69`).
**Replay window:** `BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` (default `60000`); read at handler-call time inside `verifySignature` so `vi.stubEnv` works (D-03).
**Dev escape hatch:** `SMOKE_BYPASS_WEBHOOK_VERIFY=1` returns `{ valid: true }` with a loud warn (DEV ONLY — never set in prod). [CITED: payments/bictorys.ts:372-377]

**`extractIds` semantics** (payments/bictorys.ts:420-427):
- `externalId = payload.charge_id ?? payload.chargeId ?? payload.id ?? ''`
- `eventType = payload.event_type ?? payload.status ?? 'unknown'`
- `kind = 'paid' | 'failed' | 'other'` mapped from `classifyStatus(payload.status)` — `'refunded'` is **NOT currently mapped** (refunded events fall to `'other'`).

> ⚠️ **Recommendation:** if onRefunded is required for WH-01, the planner should plan a small extension to `classifyStatus` (or add a `classifyKind` distinct fn) to recognize `"refunded"`/`"refund"` strings. This is a 5-line change to the EXISTING bictorys.ts but the file is in the protected list — surface this for confirmation. Workaround: inline a `kind` override in the new `webhook/bictorys.ts` re-export wrapper that runs `extractIds` then upgrades `kind` when `payload.status === 'refunded'`.

### `webhook/bictorys.ts` skeleton (D-02)

```typescript
// frontend/src/lib/server/webhook/bictorys.ts — Phase 5 D-02.
// Re-exports the WebhookProvider impl from the payments adapter so the
// webhook namespace is cohesive (handler factory + per-provider impls).
// The real HMAC code lives in payments/bictorys.ts:367-428 and is PROTECTED.
import 'server-only';
import type { WebhookProvider } from './handler';
import {
  createBictorysProvider,
  type BictorysWebhookPayload,
} from '../payments/bictorys';

export type { BictorysWebhookPayload };

let _provider: WebhookProvider<BictorysWebhookPayload> | null = null;

/** Lazy-init — env reads happen at first call so `vi.stubEnv` works in tests. */
export function getBictorysWebhookProvider(): WebhookProvider<BictorysWebhookPayload> {
  if (_provider) return _provider;
  const env = {
    BICTORYS_API_URL: process.env.BICTORYS_API_URL ?? '',
    BICTORYS_API_KEY: process.env.BICTORYS_API_KEY ?? '',
    BICTORYS_WEBHOOK_SECRET: process.env.BICTORYS_WEBHOOK_SECRET ?? '',
  };
  if (!env.BICTORYS_API_URL || !env.BICTORYS_API_KEY || !env.BICTORYS_WEBHOOK_SECRET) {
    throw new Error('Bictorys webhook provider not configured (env missing)');
  }
  _provider = createBictorysProvider(env).webhookProvider;
  return _provider;
}

/** Convenience binding for the route file. */
export const bictorysWebhookProvider: WebhookProvider<BictorysWebhookPayload> = {
  name: 'bictorys',
  verifySignature: (raw, headers) => getBictorysWebhookProvider().verifySignature(raw, headers),
  parsePayload: (raw) => getBictorysWebhookProvider().parsePayload(raw),
  extractIds: (payload) => {
    const ids = getBictorysWebhookProvider().extractIds(payload);
    // Upgrade kind for refunded events (classifyStatus only handles paid/failed).
    const status = String((payload as Record<string, unknown>).status ?? '').toLowerCase();
    if (status === 'refunded' || status === 'refund') {
      return { ...ids, kind: 'refunded' };
    }
    return ids;
  },
};

/** Test-only — clear the cached provider for `vi.stubEnv` reuse. */
export function __resetBictorysWebhookProvider(): void {
  _provider = null;
}
```

[VERIFIED: WebhookProvider interface in webhook/handler.ts:39-47]

## 2. `createWebhookHandler` Invocation Pattern

The factory at `webhook/handler.ts:90-172` does **all** the heavy lifting:

| Responsibility | Where in factory |
|----------------|------------------|
| Read raw body (`req.arrayBuffer()`) | line 94 |
| Build lowercased headers record | lines 73-79, 95 |
| Verify signature, return 401 if invalid | lines 97-101 |
| Parse payload, return 400 on parse error | lines 103-109 |
| Extract `(externalId, eventType, kind)` | line 111 |
| Open Serializable tx + dedup via `WebhookLog @@unique` | lines 117-156 |
| Dispatch to `onPaid`/`onRefunded`/`onFailed` based on `kind` | lines 140-148 |
| Stamp `processedAt` after handler success | lines 150-153 |
| Return `200 { ok: true, deduped }` | line 170 |

**Route file is ~25 LOC** — see Pattern 1 above.

## 3. Outbox-Drain Route Shim

[VERIFIED: drainOutbox in dispatcher.ts:49-123; OutboxEvent in schema.prisma:238-250]

Full skeleton already shown in **Pattern 2**. Key invariants:

- **Stuck-row reset is FIRST step** inside the lease (D-09). Resets `status='PENDING'` + bumps `scheduledAt` to `NOW()` so the next claim picks it up. Note dispatcher already increments `attempts` per claim (dispatcher.ts:69) — a row reset by the cron will have its `attempts` carry-over into the next attempt; backoff index uses `attempts - 1` (dispatcher.ts:100), so this is correct (a row stuck at attempts=2 will retry against the 30s slot, not from scratch).
- **Stuck-row reset query (Prisma-friendly form):**

```typescript
await prisma.outboxEvent.updateMany({
  where: {
    status: 'PROCESSING',
    scheduledAt: { lt: new Date(Date.now() - 90_000) },
  },
  data: { status: 'PENDING', scheduledAt: new Date() },
});
```

- **`drainOutbox` returns** `{ processed, succeeded, failed, dead }` (dispatcher.ts:52). Route returns `{ ok: true, processed }`. Log the full breakdown.
- **`emailQueue` arg:** `drainOutbox` accepts an optional `emailQueue` for `email.*` event kinds (dispatcher.ts:42). For Phase 5, the **email-queue-drain** cron is the consumer of `EmailJob` rows; the **outbox-drain** cron's job is to PRODUCE them. So pass `emailQueue: undefined`? No — the dispatcher needs the queue to run `email.verification_code` / `email.password_reset` / `email.payment_confirmation` events (dispatcher.ts:133-164). The two-stage flow is: outbox-drain → `EmailQueue.enqueue()` (writes EmailJob row + Redis pointer) → email-queue-drain → `EmailQueue.drainOne()` → Resend send.

> **Action for planner:** outbox-drain MUST instantiate an `EmailQueue` to pass into `drainOutbox`. Pattern: lazy-init module singleton mirroring `payments/provider-singleton.ts`. The mailer + redis must both be present; if either is missing, log a warn and pass `undefined` (the dispatcher will throw "email queue not configured" for `email.*` events, which surfaces as a retried failure — acceptable in dev).

## 4. Email-Queue-Drain Pattern

**Drain API:** `EmailQueue.drainOne(): Promise<boolean>` (queues/email-queue.ts:101). Returns `true` if a job was processed (success or failure), `false` if the queue was empty. **Must be wrapped in a loop** at the call site to drain up to BATCH_SIZE.

```typescript
// frontend/src/app/api/cron/email-queue-drain/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { redis } from '@/lib/server/redis';
import { getEmailQueue } from '@/lib/server/queues/email-queue-singleton'; // NEW or inline
import { createLogger } from '@/lib/server/logger';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();
const BATCH_SIZE = 100;
const LEASE_TTL_MS = 120_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let processed = 0;
    await withLease(redis ?? undefined, 'email-queue-drain', LEASE_TTL_MS, async () => {
      const queue = getEmailQueue();
      if (!queue) {
        log.warn('email-queue-drain: queue not configured (UPSTASH_REDIS_REST_URL or RESEND_API_KEY missing)');
        return;
      }
      for (let i = 0; i < BATCH_SIZE; i++) {
        const handled = await queue.drainOne();
        if (!handled) break;
        processed++;
      }
      log.info('email-queue-drain tick', { processed, requestId: ctx.requestId });
    });
    return NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
```

> **Action for planner:** an `email-queue-singleton.ts` module is needed because `EmailQueue` requires `redis`, `prisma`, AND `mailer` constructed together. Pattern mirrors `payments/provider-singleton.ts:46-71`. Returns `null` if any required env (UPSTASH + RESEND) is missing.

## 5. `verification-cleanup` (one-liner per D-13)

```typescript
// frontend/src/app/api/cron/verification-cleanup/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createLogger } from '@/lib/server/logger';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let processed = 0;
    await withLease(redis ?? undefined, 'verification-cleanup', 60_000, async () => {
      const result = await prisma.verificationCode.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      processed = result.count;
      log.info('verification-cleanup tick', { processed, requestId: ctx.requestId });
    });
    return NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
```

[VERIFIED: VerificationCode schema in schema.prisma:150-163 — `expiresAt: DateTime` is the right column]

## 6. `verifyCronSecret` Implementation

**Modeled on `verifyCsrf`** at `auth.ts:192-211`. Same signature: `(req: NextRequest) => NextResponse | null`. Returns `null` on pass; 401 NextResponse on failure. Timing-safe compare via `node:crypto.timingSafeEqual`.

```typescript
// frontend/src/lib/server/cron/auth.ts — Phase 5 D-06.
//
// Vercel Cron automatically attaches `Authorization: Bearer ${CRON_SECRET}`
// to scheduled requests (CRON_SECRET is read by Vercel from the project's
// env vars). Locally (next dev) tests + curl invocations attach it manually.
//
// Mirrors verifyCsrf signature: returns null on pass, NextResponse(401) on fail.
// Timing-safe compare prevents secret-length / byte-by-byte timing oracles.
import 'server-only';
import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

export function verifyCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) {
    // Boot-time misconfiguration — fail closed loudly. Production deploys
    // without CRON_SECRET set are a security regression (any anonymous POST
    // to /api/cron/* would otherwise queue work).
    return NextResponse.json(
      { error: 'CRON_NOT_CONFIGURED', message: 'CRON_SECRET env var is required' },
      { status: 500 },
    );
  }

  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const presented = header.slice('Bearer '.length);
  if (presented.length === 0) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Constant-time compare. Buffer.from on differing-length strings would
  // produce different-length buffers — timingSafeEqual throws in that case,
  // so guard with a length-mismatch fast-path that itself runs in constant
  // time relative to the secret.
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (!crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  return null;
}
```

### Test mock shape (D-17 lesson)

```typescript
// In a cron route.test.ts:
vi.mock('@/lib/server/cron/auth', () => ({
  verifyCronSecret: vi.fn(() => null), // default-pass; override per-test
}));

// To assert 401 on missing secret:
const { verifyCronSecret } = await import('@/lib/server/cron/auth');
(verifyCronSecret as Mock).mockReturnValueOnce(
  NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
);
```

**For `auth.test.ts` itself** (the helper's own unit test), DON'T mock — exercise it for real. Required cases (D-17):
1. Missing `CRON_SECRET` env → 500 CRON_NOT_CONFIGURED
2. Missing `Authorization` header → 401
3. Wrong scheme (`Basic xxx`) → 401
4. Empty Bearer token → 401
5. Wrong secret value → 401
6. Correct `Bearer ${CRON_SECRET}` → returns `null`

## 7. Order Expiration Helper (`lib/server/orders/expire.ts`)

**Decision per D-14:** new helper at `lib/server/orders/expire.ts`. Takes more than one query (find + update + maybe outbox notify), worth its own testable surface.

[VERIFIED: Order schema in schema.prisma:275-311 — `status: String @default("PENDING")` (PENDING|PAID|EXPIRED|FAILED|REFUNDED), `expiresAt: DateTime` (NOT optional — required column). `userId: String?` (nullable for guest checkout). `customerEmail: String?`.]

> **Important:** the existing `Order` schema **already has `expiresAt: DateTime`** (set at order creation time per Phase 3). So `ORDER_EXPIRATION_MINUTES` env var is NOT used to compute a new cutoff at expiration time — it is used by the **order-creation route** (Phase 3) to set `expiresAt = createdAt + ORDER_EXPIRATION_MINUTES`. The cron just runs `where: { status: 'PENDING', expiresAt: { lt: new Date() } }`.

> **Action for planner:** confirm whether Phase 3's order-creation route reads `ORDER_EXPIRATION_MINUTES` to set `expiresAt`. If not, either (a) Phase 5 adds the env-driven default to `lib/server/orders/expire.ts` AND backfills `expiresAt` for any rows missing it (data migration risk — flag), or (b) the env knob lives only as a Phase 5 documentation reminder for forks adding order-creation. **Recommendation: (b) — keep `expire.ts` purely reading `expiresAt`; add `ORDER_EXPIRATION_MINUTES` to `.env.example` as a fork-customizable knob the order-creation route should honor.**

```typescript
// frontend/src/lib/server/orders/expire.ts — Phase 5 D-14.
//
// Find PENDING Order rows whose expiresAt has passed and mark them EXPIRED
// in batches of `batchSize`. Emits an in-app notification per expired order
// via the outbox (so the user sees "Order expired" in their notifications).
//
// Returns the count of orders transitioned. Idempotent: re-running on the
// same set finds zero PENDING + expired rows (they're already EXPIRED).
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { enqueueOutbox } from '../outbox';

export interface ExpirePendingOrdersOptions {
  prisma: PrismaClient;
  batchSize?: number; // default 100 — D-08
}

export async function expirePendingOrders(
  opts: ExpirePendingOrdersOptions,
): Promise<{ expired: number }> {
  const batchSize = opts.batchSize ?? 100;

  // Find expired PENDING orders (oldest first — fairer cleanup).
  const candidates = await opts.prisma.order.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: batchSize,
    select: { id: true, userId: true, amount: true, currency: true },
  });

  if (candidates.length === 0) return { expired: 0 };

  let expired = 0;
  for (const o of candidates) {
    // Per-row tx — atomic update + outbox emit. Skip the row if a concurrent
    // worker already moved it to PAID (the WHERE clause guards against that).
    const updated = await opts.prisma.$transaction(async (tx) => {
      const u = await tx.order.updateMany({
        where: { id: o.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      if (u.count === 0) return false; // someone else won the race
      // Notification only if user is non-null (guest checkouts skip).
      if (o.userId) {
        // Re-use payment_received template? No — separate event kind would be
        // ideal but D-14 + outbox/types.ts only carry the 4 existing kinds.
        // Pragmatic: omit the in-app notification for now; surface in admin UI
        // (Order.status='EXPIRED' is queryable via Phase 3 admin/orders).
        // FUTURE: add `notification.order_expired` outbox kind in Phase 6.
      }
      return true;
    });
    if (updated) expired++;
  }
  return { expired };
}
```

> **Note on missing notification kind:** `outbox/types.ts:12-16` defines only 4 event variants (no `notification.order_expired`). Adding it would touch `outbox/dispatcher.ts:127-172` (the protected dispatcher) — out of scope for this phase. **Recommendation:** order-expiration cron silently transitions status without sending notifications in v1. Document in CLAUDE.md/STATE.md as a Phase 6 follow-up. This matches D-14's "find + update + emit notifications via outbox" but pragmatic v1 ships find + update only.

## 8. WebhookLog Purge (per D-15)

```typescript
// frontend/src/app/api/cron/webhook-log-purge/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createLogger } from '@/lib/server/logger';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const days = Number(process.env.WEBHOOK_LOG_RETENTION_DAYS ?? 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let processed = 0;
    await withLease(redis ?? undefined, 'webhook-log-purge', 60_000, async () => {
      const result = await prisma.webhookLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      processed = result.count;
      log.info('webhook-log-purge tick', { processed, days, requestId: ctx.requestId });
    });
    return NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
```

[VERIFIED: WebhookLog schema in schema.prisma:255-266 — has `createdAt: DateTime @default(now())`, no `receivedAt`]

> ⚠️ **Column name correction:** the orchestrator brief mentioned `receivedAt`. The actual schema has `createdAt`. Use `createdAt` (or `processedAt: { not: null, lt: cutoff }` if the planner wants to keep unprocessed records longer for debugging).

## 9. `vercel.json` Schema (per D-12)

```json
{
  "crons": [
    { "path": "/api/cron/outbox-drain",         "schedule": "*/1 * * * *" },
    { "path": "/api/cron/email-queue-drain",    "schedule": "*/1 * * * *" },
    { "path": "/api/cron/verification-cleanup", "schedule": "0 * * * *"   },
    { "path": "/api/cron/order-expiration",     "schedule": "*/5 * * * *" },
    { "path": "/api/cron/webhook-log-purge",    "schedule": "0 0 * * *"   }
  ]
}
```

[CITED: D-12]

**Notes:**
- Schedules use **UTC** — Vercel cron is UTC-only.
- Per-route `maxDuration` lives in each `route.ts` via `export const maxDuration = N`. Putting it in `vercel.json` too would be redundant (Vercel/Next picks up the route export).
- File location: `frontend/vercel.json` (Vercel project root = the `frontend/` workspace per Vercel monorepo deploy convention).
- **Validation test (D-20):** read file, parse JSON, assert `crons.length === 5`, each `path` matches `^/api/cron/[a-z-]+$`, each `schedule` matches a cron-format regex (`^[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+$`), each path corresponds to an actual `app/api/cron/<name>/route.ts` file (use `fast-glob` like `runtime-enforcement.test.ts` does at `observability/`).

## 10. Per-Route Test Fixture Patterns

### Bictorys mock (`test-utils/bictorys-mock.ts`)

Modeled on `test-utils/r2-mock.ts:15-63`. Provides canned HMAC + payload fixtures so every webhook test gets identical inputs.

```typescript
// frontend/src/test-utils/bictorys-mock.ts — Phase 5 Wave 0.
//
// Fixture builder for /api/webhooks/bictorys route tests. Returns:
//   - rawBody (Buffer) — exact bytes Bictorys would have signed
//   - headers (Record<string,string>) — including a valid HMAC signature
//   - payload (BictorysWebhookPayload) — the parsed shape
//
// Tests can mutate any field to simulate tampered body / expired ts / wrong sig.
import crypto from 'node:crypto';
import type { BictorysWebhookPayload } from '@/lib/server/payments/bictorys';

export interface BictorysFixtureOpts {
  status?: 'succeeded' | 'failed' | 'refunded';
  chargeId?: string;
  paymentMethod?: string;
  webhookSecret?: string;
  /** Override the timestamp — useful for replay-window tests. */
  timestamp?: number;
}

export function bictorysFixture(opts: BictorysFixtureOpts = {}): {
  rawBody: Buffer;
  headers: Record<string, string>;
  payload: BictorysWebhookPayload;
} {
  const status = opts.status ?? 'succeeded';
  const payload: BictorysWebhookPayload = {
    id: opts.chargeId ?? 'charge_test_001',
    charge_id: opts.chargeId ?? 'charge_test_001',
    status,
    event_type: status,
    payment_method: opts.paymentMethod ?? 'wave_money',
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const ts = String(opts.timestamp ?? Date.now());
  const secret = opts.webhookSecret ?? 'test-webhook-secret';
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.`)
    .update(rawBody)
    .digest('hex');
  return {
    rawBody,
    headers: {
      'content-type': 'application/json',
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    },
    payload,
  };
}

/** Build a NextRequest with the fixture body + headers. Use in route tests. */
export async function bictorysFixtureRequest(
  opts: BictorysFixtureOpts = {},
): Promise<{ req: Request; payload: BictorysWebhookPayload }> {
  const { rawBody, headers, payload } = bictorysFixture(opts);
  return {
    req: new Request('http://localhost/api/webhooks/bictorys', {
      method: 'POST',
      headers,
      body: rawBody,
    }),
    payload,
  };
}
```

### Cron route test mock skeleton

```typescript
// frontend/src/app/api/cron/outbox-drain/route.test.ts — RED until Wave 1.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// CRITICAL (D-17): mocks return NextResponse, not plain Response.
vi.mock('@/lib/server/cron/auth', () => ({
  verifyCronSecret: vi.fn(() => null),
}));

const drainOutboxMock = vi.fn();
vi.mock('@/lib/server/outbox/dispatcher', () => ({
  drainOutbox: drainOutboxMock,
}));

const withLeaseMock = vi.fn(async (_redis: unknown, _name: string, _ttl: number, fn: () => Promise<void>) => fn());
vi.mock('@/lib/server/leader-lease', () => ({ withLease: withLeaseMock }));

const updateManyMock = vi.fn(async () => ({ count: 0 }));
vi.mock('@/lib/server/prisma', () => ({
  prisma: { outboxEvent: { updateMany: updateManyMock } },
}));

vi.mock('@/lib/server/redis', () => ({ redis: null }));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  drainOutboxMock.mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, dead: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function makeReq() {
  return new NextRequest('http://localhost/api/cron/outbox-drain', {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  });
}

describe('POST /api/cron/outbox-drain', () => {
  it('returns 401 when verifyCronSecret fails', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it('happy path returns processed count from drainOutbox', async () => {
    drainOutboxMock.mockResolvedValueOnce({ processed: 7, succeeded: 6, failed: 1, dead: 0 });
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 7 });
  });

  it('calls withLease with name=outbox-drain and ~2x maxDuration ttl', async () => {
    const { POST } = await import('./route');
    await POST(makeReq());
    expect(withLeaseMock).toHaveBeenCalled();
    expect(withLeaseMock.mock.calls[0]?.[1]).toBe('outbox-drain');
    expect(withLeaseMock.mock.calls[0]?.[2]).toBeGreaterThanOrEqual(60_000);
  });

  it('resets stuck PROCESSING rows older than 90s before draining', async () => {
    const { POST } = await import('./route');
    await POST(makeReq());
    expect(updateManyMock).toHaveBeenCalled();
    const args = updateManyMock.mock.calls[0]?.[0] as { where?: { status?: string } } | undefined;
    expect(args?.where?.status).toBe('PROCESSING');
  });
});
```

[CITED: D-17, D-19; mirrors withdrawals/route.test.ts:30-95 mock patterns]

## 11. Common Pitfalls

### Pitfall 1: Vercel cron Authorization header is platform-injected, not env-derived

**What goes wrong:** Developers assume `CRON_SECRET` is sent through some Vercel-magic mechanism and the route reads it from `process.env`. Actual flow: Vercel **reads `CRON_SECRET` from the project's env vars** and **constructs `Authorization: Bearer ${CRON_SECRET}` itself** when invoking cron paths. Your `verifyCronSecret` reads `process.env.CRON_SECRET` independently and compares.

**Why it happens:** Vercel docs describe this implicitly; CLAUDE.md's "Cron handlers MUST verify `Authorization: Bearer ${CRON_SECRET}`" is the locked spec.

**How to avoid:** Code `verifyCronSecret` as a normal Bearer-token compare. **Test locally with curl:** `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/outbox-drain`. **In production**, no test fixture needed — Vercel attaches it.

**Warning sign:** A cron returns 401 in production but 200 locally — verify the Vercel project has `CRON_SECRET` set in **all environments** (Production, Preview, Development) and that the value matches the deployed `verifyCronSecret`'s read.

### Pitfall 2: Next.js may cache POST responses without `dynamic = 'force-dynamic'`

**What goes wrong:** Next.js 15+ aggressively caches route handler responses unless you opt out. A cron POST that returns `{ ok: true, processed: 5 }` could get cached and served identically on the next tick — making subsequent crons no-ops without triggering the actual drain logic.

**Why it happens:** App Router's static-by-default model. POST is generally not cached, but routes that don't read request-specific data (cookies, headers) can be optimized into static responses.

**How to avoid:** Every cron and webhook route MUST include both:
```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

**Warning sign:** Cron logs show `processed: N > 0` once, then `processed: 0` on every subsequent tick despite OutboxEvent table filling up.

### Pitfall 3: Lease TTL too short causes parallel runs (or too long deadlocks peers)

**What goes wrong:** `withLease(redis, name, ttlMs, fn)` uses `SET key NX EX ttlSeconds`. If `ttlMs` < actual `fn()` runtime, the lease expires mid-execution and a peer can grab it — two instances drain simultaneously, racing on `OutboxEvent` rows. If `ttlMs` >> `maxDuration`, a crashed leader's lock holds for minutes after Vercel times out.

**Why it happens:** TTL guesswork. `outbox-drain` with 100 rows × 100ms-each = 10s, but a stuck-row reset + slow Redis can push to 30s+.

**How to avoid:** Set `LEASE_TTL_MS = 2 * maxDuration * 1000` (so `outbox-drain`/`email-queue-drain`: 120_000ms; others: 60_000ms). Holder-id guard in `leader-lease.ts:69-72` prevents the worst case (releasing someone else's lease).

**Warning sign:** Two cron invocations in the same minute see `withLease` succeed (i.e., both run `fn()`), or `OutboxEvent.attempts` jumps by 2 per minute on one row.

### Pitfall 4: `drainOutbox` increments `attempts` on every claim — including rows reset from PROCESSING

**What goes wrong:** A row that was claimed (attempts=1, PROCESSING) → got stuck → was reset by the cron's first step (back to PENDING) → gets re-claimed. Per-row claim updates `attempts: { increment: 1 }` (`dispatcher.ts:69`) → row now has attempts=2. Backoff index uses `attempts - 1` → 30s slot becomes 2m slot. **Effective behavior:** stuck rows are punished with a longer next-retry delay than fresh failures.

**Why it happens:** The dispatcher was written for the "claim → process → succeed-or-fail" happy path; stuck-recovery is bolted on by Phase 5's cron.

**How to avoid:** **Accept it.** It's a feature, not a bug — repeatedly-stuck rows back off more aggressively, so a chronically broken handler doesn't hammer Resend or the DB. Document in cron route comments. **If this becomes a real issue**, the planner can update the stuck-row reset to also reset `attempts` to its previous value (requires snapshotting attempts before the reset → adds complexity).

**Warning sign:** Outbox dashboard shows rows with `attempts > 5` despite `MAX_ATTEMPTS=5` — means the row was reset multiple times. Treat as DEAD review.

### Pitfall 5: Webhook handler — `req.json()` before `req.arrayBuffer()` silently breaks HMAC

**What goes wrong:** Calling `await req.json()` consumes the body stream. Any subsequent `req.arrayBuffer()` returns 0 bytes. The HMAC computed over an empty buffer mismatches the provider's signature → all webhooks fail with `invalid signature`.

**Why it happens:** Next.js Request objects can't be re-read. The `createWebhookHandler` factory calls `req.arrayBuffer()` first (line 94) — so the rule is **never let your route file's own logic touch `req` before the factory gets to it**. The route file should be a one-liner: `export const POST = createWebhookHandler({...})`.

**How to avoid:**
1. Route file does NOT call `req.json()`, `req.text()`, or `req.formData()` before delegating to the factory.
2. The factory's `parsePayload` (in the provider) must take `Buffer` (raw body), not `Request`. Verify in tests that the fixture's raw bytes are byte-identical to what `JSON.parse(rawBody.toString('utf8'))` re-serializes.

**Warning sign:** All webhook deliveries return 401 invalid signature in production but pass locally — likely a middleware or instrumentation hook calling `req.text()` for logging.

### Pitfall 6: Cron routes run on Vercel function instances that don't persist module-level Redis clients

**What goes wrong:** Module-top `const redis = getRedis()` (which is what `redis.ts:43` does) reads env at import time. If the env is missing during a cold start (e.g., Vercel preview without secrets), `redis = null` permanently for that instance.

**Why it happens:** Vercel's serverless function model — cold-start re-imports the module, so module-top reads work. But the `getRedis()` singleton (`redis.ts:30-40`) caches `_redis = null` and won't retry — even if env materializes later (it doesn't, but the principle matters for testing).

**How to avoid:** For test ergonomics, `vi.mock('@/lib/server/redis', () => ({ redis: null }))`. For production, ensure `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set in **all environments**. The `withLease` no-Redis fallback (`leader-lease.ts:47-51`) makes the cron correct on single-instance dev — but in multi-instance prod without Redis, two crons could race.

**Warning sign:** `OutboxEvent` rows show duplicate `attempts++` per minute → likely two parallel crons running because Redis lease was bypassed.

### Pitfall 7: `OutboxEvent.scheduledAt` doubles as the stuck-detection cutoff

**What goes wrong:** The dispatcher claims a PENDING row by setting `status='PROCESSING'` + `attempts++` but **does not update `scheduledAt`** (`dispatcher.ts:67-70`). For a freshly-claimed row, `scheduledAt` is its ORIGINAL `scheduledAt` (which `lte: now()` already passed for the row to be a candidate). So `WHERE status='PROCESSING' AND scheduledAt < NOW() - INTERVAL '90s'` works only if the row was scheduled ≥90s ago — true for any normal row, but a row scheduled 1ms ago and immediately claimed wouldn't qualify until 90s later.

**Why it happens:** Schema doesn't have a `claimedAt`/`startedAt` column.

**How to avoid:** Accept the ~90s grace period (the worst case is a row stuck for 90s before reset, which matches D-09 anyway). **Alternative if the planner wants tighter detection:** add a Phase 6 migration introducing `OutboxEvent.startedAt` and update dispatcher.ts's claim query to set `startedAt = NOW()`. Out of Phase 5 scope.

**Warning sign:** Stuck rows take longer to recover than 90s — likely they were just scheduled.

## Runtime State Inventory

> **N/A — greenfield phase.** Phase 5 introduces NEW route files, NEW helper modules, NEW env vars. No existing data, runtime state, or external service config is being renamed or migrated. The only "carry-forward" is the existing `OutboxEvent` / `EmailJob` / `WebhookLog` / `VerificationCode` / `Order` rows from prior phases — these are READ/WRITTEN by Phase 5 cron routes but their schema and contents are untouched. No data migration required.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All routes (`runtime='nodejs'`) | ✓ | v22.14.0 | — |
| `@prisma/client` | All cron + webhook routes | ✓ | ^5.22.0 | — |
| `next` | App Router routes | ✓ | ^16.1.6 | — |
| `@upstash/redis` | `withLease`, `EmailQueue` | ✓ | ^1.34.3 | `withLease` falls back to direct fn call when redis=null |
| `resend` | EmailQueue → Resend send | ✓ | ^6.12.2 | Without RESEND_API_KEY: email-queue-drain is a no-op (logged warn) |
| `vitest` | RED tests | ✓ | (devdep) | — |
| `fast-glob` | vercel.json validation test (D-20 — scan app/api/cron/**) | ✓ | ^3.3.3 | — |
| Vercel Cron platform | Triggering scheduled invocations | ✓ (deployment-time) | — | Local: `pnpm dev` + manual curl with Bearer token |
| Upstash Redis (live env) | Multi-instance lease coordination | Optional | — | Single-instance no-op fallback per `leader-lease.ts:47-51` |
| `BICTORYS_WEBHOOK_SECRET` env | Webhook HMAC verify | Optional in dev | — | Without it: route returns 500 PAYMENT_PROVIDER_UNCONFIGURED on first call (lazy-init throws) |
| `CRON_SECRET` env | All cron routes | ✓ in `.env.example:18` | — | Without it: routes return 500 CRON_NOT_CONFIGURED |
| `WEBHOOK_LOG_RETENTION_DAYS` env | webhook-log-purge cron | NEW (added by Phase 5) | default 90 | — |
| `ORDER_EXPIRATION_MINUTES` env | (documentation-only — order-creation route per fork) | NEW (added by Phase 5) | default 30 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Upstash Redis, Resend, Bictorys webhook secret — each is optional in dev with graceful degradation paths documented above.

## Validation Architecture

Phase 5 is in scope for `workflow.nyquist_validation` (config absent → enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (already configured by Phase 0 Plan 00-01) |
| Config file | `frontend/vitest.config.ts` |
| Setup file | `frontend/vitest.setup.ts` |
| Quick run command | `pnpm --filter frontend exec vitest run src/app/api/cron/outbox-drain/route.test.ts` |
| Per-route test | `pnpm --filter frontend exec vitest run -t "POST /api/cron/<name>"` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WH-01 | runtime=nodejs + dynamic=force-dynamic + raw body | unit | `pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts -t "raw body"` | ❌ Wave 0 |
| WH-01 | 60s replay window enforced | unit | `pnpm ... -t "expired replay window"` | ❌ Wave 0 |
| WH-02 | Idempotent replay (same externalId+eventType) | unit | `pnpm ... -t "deduped"` | ❌ Wave 0 |
| WH-02 | Outbox enqueue inside same tx (no postCommit) | unit | `pnpm ... -t "enqueueOutbox"` | ❌ Wave 0 |
| CRON-01 | Outbox drain processes up to 100 rows | unit | `pnpm ... outbox-drain/route.test.ts -t "BATCH_SIZE 100"` | ❌ Wave 0 |
| CRON-01 | Stuck PROCESSING reset (90s) | unit | `pnpm ... outbox-drain/route.test.ts -t "stuck"` | ❌ Wave 0 |
| CRON-02 | Email-queue drain calls drainOne up to BATCH_SIZE | unit | `pnpm ... email-queue-drain/route.test.ts -t "BATCH_SIZE"` | ❌ Wave 0 |
| CRON-03 | verification-cleanup deletes expired codes | unit | `pnpm ... verification-cleanup/route.test.ts -t "deleteMany"` | ❌ Wave 0 |
| CRON-04 | order-expiration marks PENDING→EXPIRED | unit | `pnpm ... order-expiration/route.test.ts -t "EXPIRED"` | ❌ Wave 0 |
| CRON-05 | webhook-log-purge deletes by retention | unit | `pnpm ... webhook-log-purge/route.test.ts -t "retention"` | ❌ Wave 0 |
| CRON-06 | All 5 crons return 401 on missing/wrong secret | unit | `pnpm ... -t "verifyCronSecret"` (5 separate tests) | ❌ Wave 0 |
| CRON-07 | vercel.json schema | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/vercel-json-shape.test.ts` | ❌ Wave 0 |
| OPS-02 | Every new route exports `runtime='nodejs'` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ✓ (existing — picks up new routes automatically) |
| ENV | `WEBHOOK_LOG_RETENTION_DAYS` + `ORDER_EXPIRATION_MINUTES` in `.env.example` | unit | `pnpm ... env-shape.test.ts -t "phase 5"` | ❌ Wave 0 (assertions added) |

### Sampling Rate
- **Per task commit:** quick run command for the affected route's test file (< 5s)
- **Per wave merge:** `pnpm test` (full suite — < 30s currently)
- **Phase gate:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` all green

### Wave 0 Gaps (RED test scaffolds + new helpers)
- [ ] `frontend/src/app/api/webhooks/bictorys/route.test.ts` — covers WH-01, WH-02
- [ ] `frontend/src/app/api/cron/outbox-drain/route.test.ts` — covers CRON-01, CRON-06
- [ ] `frontend/src/app/api/cron/email-queue-drain/route.test.ts` — covers CRON-02, CRON-06
- [ ] `frontend/src/app/api/cron/verification-cleanup/route.test.ts` — covers CRON-03, CRON-06
- [ ] `frontend/src/app/api/cron/order-expiration/route.test.ts` — covers CRON-04, CRON-06
- [ ] `frontend/src/app/api/cron/webhook-log-purge/route.test.ts` — covers CRON-05, CRON-06
- [ ] `frontend/src/lib/server/cron/auth.test.ts` — covers verifyCronSecret 6 cases
- [ ] `frontend/src/lib/server/webhook/bictorys.test.ts` — covers HMAC verify + extractIds (incl. refunded upgrade)
- [ ] `frontend/src/lib/server/orders/expire.test.ts` — covers expirePendingOrders helper
- [ ] `frontend/src/test-utils/bictorys-mock.ts` — fixture builder
- [ ] `frontend/src/lib/server/observability/vercel-json-shape.test.ts` — D-20 validation test
- [ ] `frontend/src/lib/server/observability/env-shape.test.ts` — append `WEBHOOK_LOG_RETENTION_DAYS` + `ORDER_EXPIRATION_MINUTES` assertions
- [ ] `.env.example` — append the two env blocks
- [ ] `frontend/src/lib/server/cron/auth.ts` — verifyCronSecret implementation
- [ ] `frontend/src/lib/server/webhook/bictorys.ts` — re-export + kind-upgrade wrapper
- [ ] `frontend/src/lib/server/orders/expire.ts` — expirePendingOrders helper
- [ ] (Optional but recommended) `frontend/src/lib/server/queues/email-queue-singleton.ts` — lazy-init EmailQueue with prisma+redis+mailer

## Security Domain

`security_enforcement` is enabled (config absent — treat as enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bearer-token compare via `node:crypto.timingSafeEqual` (`verifyCronSecret`) |
| V3 Session Management | no | Cron + webhook routes are sessionless |
| V4 Access Control | yes | Cron secret IS the access control. No user-session involvement. |
| V5 Input Validation | yes | Webhook body parsed via `JSON.parse` → typed payload; HMAC verifies bytes BEFORE parse so malformed JSON is detected pre-handler-dispatch |
| V6 Cryptography | yes | HMAC-SHA256 via `node:crypto.createHmac` (NEVER hand-roll); timing-safe compare via `crypto.timingSafeEqual` |
| V11 Business Logic | yes | Webhook idempotency via `WebhookLog @@unique([externalId, eventType])` prevents duplicate side-effects under retry |

### Known Threat Patterns for Phase 5 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook replay (captured signed body) | Tampering / Repudiation | 60s replay window via `BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` + `WebhookLog @@unique` dedup |
| HMAC timing oracle | Information Disclosure | `crypto.timingSafeEqual` for sig + `timingSafeStringEqual` for `x-secret-key` (already in `payments/bictorys.ts:118-121`) |
| Cron secret leakage via logs | Information Disclosure | Don't log `Authorization` header. `request-context.ts` only stores `requestId`. |
| Cron unauthenticated invocation (DoS / unauthorized work trigger) | DoS / Tampering | `verifyCronSecret` returns 401 before any DB/Redis call |
| Outbox poisoning via webhook handler error | Tampering | `enqueueOutbox` runs inside Serializable tx — if handler throws, the row is rolled back; webhook returns 500; provider retries |
| Stuck-row attack (deliberately filling OutboxEvent with PROCESSING rows) | DoS | `MAX_ATTEMPTS=5 → DEAD` ceiling + 90s stuck-reset prevents indefinite retry |
| `CRON_SECRET` in client bundle | Information Disclosure | Never prefix with `NEXT_PUBLIC_`; `.env.example:18` already correct |

## Code Examples (already verified above — see Patterns 1, 2, 5, 8 + §10)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setInterval` worker process (Express era) | Vercel Cron route handlers | This phase (Phase 5) | No long-lived process; each tick is a function invocation |
| `postCommit` callbacks for webhook side-effects | Outbox pattern via `enqueueOutbox(tx, ...)` | Phase 1+ | Survives crashes; replayable; queryable |
| Hand-rolled HMAC verify per route | `WebhookProvider<TPayload>` interface + `createWebhookHandler` factory | Phase 3 | New providers added with ~30-line `verifySignature`+`extractIds` impl |
| Polling-based stuck-row recovery | Atomic claim with reset-cutoff | This phase | 90s ceiling; backoff persists across resets (Pitfall 4) |

**Deprecated/outdated:**
- Direct `tx.outboxEvent.create({...})` calls — use `enqueueOutbox(tx, ...)` for type-safety against `OutboxEvent` discriminated union (`outbox/index.ts:25-37`).
- `req.json()` in webhook routes — always use the factory.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Stuck-row reset can use `scheduledAt` (not a separate `startedAt` column) | §3, Pitfall 7 | If a `startedAt` column is required for tighter recovery, schema migration is out of Phase 5 scope — flag for orchestrator |
| A2 | `WebhookLog` schema column for retention is `createdAt` (not `receivedAt` as orchestrator brief said) | §8 | Pitfall: deleting by wrong column = no rows deleted, retention bug |
| A3 | `ORDER_EXPIRATION_MINUTES` is purely a fork-customizable knob for the order-creation route (Phase 3); Phase 5 only reads `Order.expiresAt` | §7 | If the orchestrator intends Phase 5 to compute the cutoff itself, the `expirePendingOrders` helper signature changes (takes minutes arg, computes cutoff) |
| A4 | Skipping the in-app notification for expired orders in v1 (since `outbox/types.ts` lacks `notification.order_expired`) is acceptable | §7 | If notification is required, the dispatcher (PROTECTED) must be extended — out of phase scope |
| A5 | Re-using `payments/bictorys.ts`'s existing `webhookProvider` via re-export from new `webhook/bictorys.ts` satisfies D-02's "two distinct surfaces" rationale | §1 | If D-02 requires duplicating the HMAC code into the new file, that's a 60-line duplication and a maintenance hazard — flag |
| A6 | `email.refunded` / `notification.refund_received` are NOT required as new outbox kinds in v1; `onRefunded` updates Order.status only | §2 | If refund notifications are required, dispatcher.ts must be extended |
| A7 | Cron routes use `dynamic = 'force-dynamic'` — verified by D-20-style test, NOT just hoped | All cron routes | If absent, Pitfall 2 fires in production silently |
| A8 | `EmailQueue` requires `prisma`+`redis`+`mailer` together; without all three, email-queue-drain is a no-op (warn-logged) | §4 | If forks ship Resend without Upstash, email-queue-drain crashes — graceful no-op is better |

## Open Questions (RESOLVED)

1. **Should `webhook/bictorys.ts` duplicate or re-export the HMAC verifier?**
   - **RESOLVED — re-export.** Duplicating the 60-line HMAC code is a maintenance hazard; the existing impl in `payments/bictorys.ts:367-428` is battle-tested and PROTECTED. The new file (D-02) wraps `getBictorysWebhookProvider()` and adds the `kind: 'refunded'` upgrade (since `classifyStatus` only handles paid/failed). Rationale: cohesion goal of D-02 ("webhook namespace cohesive") is satisfied by file location, not by code duplication.

2. **Should `expirePendingOrders` emit `notification.order_expired` outbox events?**
   - **RESOLVED — NO in v1.** `outbox/types.ts:12-16` carries 4 kinds, and adding a new kind requires editing the protected `dispatcher.ts`. Pragmatic v1: status transition only. Document as Phase 6 follow-up. Users learn of expirations via Phase 3's admin/orders UI; future phase can add the notification kind in a single planned migration.

3. **Stuck-row reset column — `scheduledAt` or new `startedAt`?**
   - **RESOLVED — use `scheduledAt`.** Schema unchanged. The 90s grace period is acceptable (D-09). If tighter recovery is needed, Phase 6 can add a column + migration without changing this phase's contract.

4. **`WebhookLog` purge column — `createdAt` or `receivedAt`?**
   - **RESOLVED — `createdAt`.** `WebhookLog` schema has `createdAt` only (`schema.prisma:255-266`). Use `where: { createdAt: { lt: cutoff } }`.

5. **Does `outbox-drain` need an `EmailQueue` to dispatch `email.*` outbox events?**
   - **RESOLVED — YES.** Dispatcher (`dispatcher.ts:133-164`) routes `email.payment_confirmation` / `email.verification_code` / `email.password_reset` to `emailQueue.enqueue()`. Phase 5 must lazy-init an EmailQueue singleton (mirroring `payments/provider-singleton.ts`) and pass it to `drainOutbox({ prisma, emailQueue }, 100)`. Without Resend env, the queue is `undefined` and dispatcher throws "email queue not configured" → row retried (acceptable in dev).

6. **Should `ORDER_EXPIRATION_MINUTES` env be CONSUMED by Phase 5 or just DECLARED for forks to use?**
   - **RESOLVED — DECLARED only.** Phase 5's `expirePendingOrders` reads `Order.expiresAt` (set at creation time). The env var goes in `.env.example` as documentation for the order-creation route (Phase 3 / fork). Phase 5 does NOT use it. This avoids data-migration risk for any orders missing `expiresAt`.

7. **Test mocks — `NextRequest` for cron routes since `webhook/handler.ts` factory takes plain `(req: NextRequest)` per line 92?**
   - **RESOLVED — YES, NextRequest universally.** D-17 explicit: use `NextRequest` (not plain `Request`). The factory's signature accepts `NextRequest` (handler.ts:92), and cron routes read headers via `req.headers.get(...)` which works on both — but consistency with Phase 4 lessons + future-proofing for `req.nextUrl` reads makes `NextRequest` the standard.

## Sources

### Primary (HIGH confidence — verified in repo)
- `frontend/src/lib/server/webhook/handler.ts` — factory signature, raw body invariant, Serializable tx, dedup
- `frontend/src/lib/server/outbox/dispatcher.ts` — drainOutbox return shape, claim semantics, backoff, MAX_ATTEMPTS
- `frontend/src/lib/server/outbox/index.ts` — enqueueOutbox signature
- `frontend/src/lib/server/outbox/types.ts` — OutboxEvent discriminated union (4 kinds)
- `frontend/src/lib/server/leader-lease.ts` — withLease NX+EX semantics, no-Redis fallback
- `frontend/src/lib/server/payments/bictorys.ts` — existing HMAC verifier (re-used by Phase 5)
- `frontend/src/lib/server/payments/provider.ts` — PaymentProvider + WebhookProvider type
- `frontend/src/lib/server/auth.ts` — verifyCsrf shape modeled by verifyCronSecret
- `frontend/src/lib/server/redis.ts` — getRedis() singleton + null fallback
- `frontend/src/lib/server/queues/email-queue.ts` — EmailQueue.drainOne() API
- `frontend/src/lib/server/queues/job-queue.ts` — underlying claim/visibility semantics
- `frontend/src/lib/server/observability/request-context.ts` — makeRequestContext + withRequestContext
- `frontend/prisma/schema.prisma` — WebhookLog, OutboxEvent, EmailJob, VerificationCode, Order columns
- `frontend/src/app/api/withdrawals/route.ts` — Phase 4 canonical route shape
- `frontend/src/app/api/withdrawals/route.test.ts` — Phase 4 canonical mock pattern
- `frontend/src/test-utils/r2-mock.ts` — Phase 4 fixture pattern
- `.env.example` (repo root) — current env shape
- `frontend/src/lib/server/observability/env-shape.test.ts` — env-shape tripwire pattern (Phase 5 appends 2 assertions)
- `.planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md` — D-01 through D-23
- `.planning/REQUIREMENTS.md:86-97` — WH-01/02 + CRON-01..07 acceptance criteria
- `./CLAUDE.md` — invariants list

### Secondary (MEDIUM confidence — Vercel Cron platform behavior)
- Vercel Cron docs (training knowledge): UTC schedules, Authorization header injection, function-instance invocation model, route-level `maxDuration` export

### Tertiary (none required)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency is already in package.json + a working Phase 4 reference exists
- Architecture: HIGH — every helper called is verified in repo with file:line citations
- Pitfalls: HIGH — derived from the actual implementations of `dispatcher.ts`, `leader-lease.ts`, `webhook/handler.ts` (not from training data)
- HMAC scheme: HIGH — copied verbatim from existing battle-tested `payments/bictorys.ts:367-428`
- vercel.json schema: HIGH — verbatim from D-12

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30 days — stable codebase, no major Next.js / Vercel breaking changes expected in window)
