---
id: 05-01-scaffold-cron-webhook-fixtures-tests
phase: "05"
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - frontend/src/lib/server/cron/auth.ts
  - frontend/src/lib/server/cron/auth.test.ts
  - frontend/src/lib/server/webhook/bictorys.ts
  - frontend/src/lib/server/webhook/bictorys.test.ts
  - frontend/src/lib/server/orders/expire.ts
  - frontend/src/lib/server/orders/expire.test.ts
  - frontend/src/lib/server/queues/email-queue-singleton.ts
  - frontend/src/test-utils/bictorys-mock.ts
  - frontend/src/app/api/webhooks/bictorys/route.test.ts
  - frontend/src/app/api/cron/outbox-drain/route.test.ts
  - frontend/src/app/api/cron/email-queue-drain/route.test.ts
  - frontend/src/app/api/cron/verification-cleanup/route.test.ts
  - frontend/src/app/api/cron/order-expiration/route.test.ts
  - frontend/src/app/api/cron/webhook-log-purge/route.test.ts
  - frontend/src/lib/server/observability/vercel-json-shape.test.ts
  - frontend/src/lib/server/observability/env-shape.test.ts
  - .env.example
autonomous: true
task_count: 6
requirements:
  - WH-01
  - WH-02
  - CRON-01
  - CRON-02
  - CRON-03
  - CRON-04
  - CRON-05
  - CRON-06
  - CRON-07
must_haves:
  truths:
    - "verifyCronSecret(req) returns null on Bearer match, NextResponse(401) on missing/wrong/empty/wrong-scheme, NextResponse(500) when CRON_SECRET env unset"
    - "bictorysWebhookProvider.extractIds upgrades kind='refunded' for status='refunded'/'refund' (not handled by classifyStatus)"
    - "expirePendingOrders({ prisma }) updates Order.status PENDING→EXPIRED for rows where expiresAt < now(); returns { expired: N }; idempotent re-run returns 0"
    - "getEmailQueue() returns null when UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN/RESEND_API_KEY missing; otherwise returns lazy-init EmailQueue singleton"
    - "All 6 RED route.test.ts files exist + RED auth/bictorys/expire helper tests + vercel-json-shape test exist; full suite is RED only on missing-route imports (NOT on setup errors)"
    - ".env.example contains WEBHOOK_LOG_RETENTION_DAYS=\"90\" and ORDER_EXPIRATION_MINUTES=\"30\"; env-shape.test.ts asserts both"
  artifacts:
    - path: "frontend/src/lib/server/cron/auth.ts"
      provides: "verifyCronSecret(req: NextRequest): NextResponse | null with timingSafeEqual"
      exports: ["verifyCronSecret"]
    - path: "frontend/src/lib/server/webhook/bictorys.ts"
      provides: "bictorysWebhookProvider — re-export of payments/bictorys.ts:webhookProvider with kind='refunded' upgrade"
      exports: ["bictorysWebhookProvider", "getBictorysWebhookProvider", "__resetBictorysWebhookProvider"]
    - path: "frontend/src/lib/server/orders/expire.ts"
      provides: "expirePendingOrders({ prisma, batchSize? }): Promise<{ expired: number }>"
      exports: ["expirePendingOrders"]
    - path: "frontend/src/lib/server/queues/email-queue-singleton.ts"
      provides: "getEmailQueue(): EmailQueue | null + __resetEmailQueueSingleton()"
      exports: ["getEmailQueue", "__resetEmailQueueSingleton"]
    - path: "frontend/src/test-utils/bictorys-mock.ts"
      provides: "bictorysFixture + bictorysFixtureRequest"
      exports: ["bictorysFixture", "bictorysFixtureRequest"]
    - path: "frontend/src/lib/server/observability/vercel-json-shape.test.ts"
      provides: "D-20 cron-schedule/route file cross-check tripwire"
      min_lines: 40
  key_links:
    - from: "frontend/src/lib/server/cron/auth.ts"
      to: "node:crypto.timingSafeEqual"
      via: "constant-time Bearer token compare against process.env.CRON_SECRET"
      pattern: "timingSafeEqual"
    - from: "frontend/src/lib/server/webhook/bictorys.ts"
      to: "frontend/src/lib/server/payments/bictorys.ts (PROTECTED — call only)"
      via: "createBictorysProvider(env).webhookProvider re-export"
      pattern: "createBictorysProvider"
    - from: "frontend/src/lib/server/orders/expire.ts"
      to: "prisma.order"
      via: "findMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } } }) + per-row $transaction updateMany"
      pattern: "expiresAt:\\s*\\{\\s*lt:"
    - from: "frontend/src/lib/server/queues/email-queue-singleton.ts"
      to: "frontend/src/lib/server/queues/email-queue.ts"
      via: "new EmailQueue({ redis, prisma, mailer }) lazy init"
      pattern: "new EmailQueue"
    - from: ".env.example (repo root)"
      to: "frontend/src/lib/server/observability/env-shape.test.ts"
      via: "static-text assertion of WEBHOOK_LOG_RETENTION_DAYS + ORDER_EXPIRATION_MINUTES"
      pattern: "WEBHOOK_LOG_RETENTION_DAYS"
---

<objective>
Wave 0 scaffolding for Phase 5: ship the 3 new helper modules (`cron/auth.ts`, `webhook/bictorys.ts`, `orders/expire.ts`), the `email-queue-singleton.ts` helper-tier, the `bictorys-mock.ts` fixture, all 6 RED `route.test.ts` files (1 webhook + 5 cron), 3 helper unit tests, the `vercel-json-shape.test.ts` D-20 tripwire, and append the 2 new env-keys to `.env.example` with env-shape assertions. Provides the test contract Wave 1 routes implement against.

Purpose: Tests-first establishes the exact behavioral contract (status codes, response shapes, lease/auth invariants, batch sizing) so Wave 1 route plans become "make the tests green" work. The 3 helpers + 1 singleton + 1 fixture eliminate scavenger-hunt work for Wave 1 executors.

Output: 3 new lib helper modules (with RED + GREEN unit tests where the unit IS the helper), 1 lazy-init queue singleton, 1 test fixture, 6 RED route.test.ts files, 1 vercel-json-shape.test.ts, 1 env-shape.test.ts assertion block, 2 new env-keys appended to .env.example. 17 files in total.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md
@.planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md
@.planning/phases/05-webhooks-and-vercel-cron/05-VALIDATION.md
@CLAUDE.md

@frontend/src/lib/server/webhook/handler.ts
@frontend/src/lib/server/outbox/dispatcher.ts
@frontend/src/lib/server/outbox/index.ts
@frontend/src/lib/server/outbox/types.ts
@frontend/src/lib/server/leader-lease.ts
@frontend/src/lib/server/payments/bictorys.ts
@frontend/src/lib/server/payments/provider-singleton.ts
@frontend/src/lib/server/queues/email-queue.ts
@frontend/src/lib/server/auth.ts
@frontend/src/lib/server/redis.ts
@frontend/src/lib/server/observability/env-shape.test.ts
@frontend/prisma/schema.prisma
@.env.example

<interfaces>
<!-- Key contracts. Wave 1 executors should use these directly — no codebase exploration needed. -->

From frontend/src/lib/server/webhook/handler.ts (PROTECTED — call only):
```typescript
export interface ParsedIds {
  externalId: string;
  eventType: string;
  kind?: 'paid' | 'refunded' | 'failed' | 'other';
}

export interface WebhookProvider<TPayload> {
  name: string;
  verifySignature(rawBody: Buffer, headers: Record<string, string>): { valid: boolean; reason?: string };
  parsePayload(rawBody: Buffer): TPayload;
  extractIds(payload: TPayload): ParsedIds;
}

export function createWebhookHandler<TPayload>(opts: WebhookHandlerOptions<TPayload>): (req: NextRequest) => Promise<NextResponse>;
```

From frontend/src/lib/server/payments/bictorys.ts (PROTECTED — call only; lines 367-428 already implement webhookProvider):
```typescript
export interface BictorysWebhookPayload {
  id?: string; charge_id?: string; chargeId?: string;
  status?: string; event_type?: string; payment_method?: string;
}
export function createBictorysProvider(env: { BICTORYS_API_URL: string; BICTORYS_API_KEY: string; BICTORYS_WEBHOOK_SECRET: string }): {
  paymentProvider: PaymentProvider;
  webhookProvider: WebhookProvider<BictorysWebhookPayload>;
};
// classifyStatus only maps "succeeded"|"completed"|"paid" → 'PAID' and "failed"|"declined"→'FAILED';
// "refunded" falls through to `kind: 'other'`. Phase 5 adds the upgrade in webhook/bictorys.ts.
```

From frontend/src/lib/server/leader-lease.ts (PROTECTED — call only):
```typescript
export async function withLease(
  redis: Redis | undefined,
  name: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<void>;
// No-Redis fallback: runs fn() unconditionally when redis === undefined.
```

From frontend/src/lib/server/outbox/dispatcher.ts (PROTECTED — call only):
```typescript
export interface OutboxDispatcherDeps { prisma: PrismaClient; emailQueue?: EmailQueue; }
export async function drainOutbox(
  deps: OutboxDispatcherDeps,
  batchSize?: number,
): Promise<{ processed: number; succeeded: number; failed: number; dead: number }>;
// Increments OutboxEvent.attempts on every claim — including rows reset from PROCESSING (Pitfall 4 in RESEARCH).
```

From frontend/src/lib/server/queues/email-queue.ts (PROTECTED — call only):
```typescript
export class EmailQueue {
  constructor(opts: { redis: Redis; prisma: PrismaClient; mailer: Mailer; ... });
  enqueue(input: SendEmailInput): Promise<string>;
  drainOne(): Promise<boolean>; // true if a job was processed; false if queue empty
}
```

From frontend/src/lib/server/auth.ts (PROTECTED — verifyCsrf shape modeled by verifyCronSecret):
```typescript
export function verifyCsrf(req: NextRequest): NextResponse | null;
// returns null on pass; NextResponse(403) on fail
```

From frontend/prisma/schema.prisma (verified shapes):
```prisma
model Order {
  id String @id @default(cuid())
  userId String?
  amount Int
  currency String @default("XOF")
  status String @default("PENDING") // PENDING | PAID | EXPIRED | FAILED | REFUNDED
  expiresAt DateTime  // REQUIRED column (set by Phase 3 order-creation route)
  // ...
}

model OutboxEvent {
  id String @id; kind String; payload Json
  status String @default("PENDING") // PENDING | SENT | FAILED | DEAD | PROCESSING
  attempts Int @default(0)
  scheduledAt DateTime @default(now())
  // NO startedAt column — stuck-row reset uses scheduledAt as proxy (RESEARCH §3 + Pitfall 7)
}

model WebhookLog {
  id String @id; provider String; externalId String; eventType String
  payload Json; processedAt DateTime?
  createdAt DateTime @default(now())   // ← retention column (NOT receivedAt)
  @@unique([externalId, eventType])
}
```
</interfaces>

<reference_patterns>
- **Lazy-init lib singleton:** `frontend/src/lib/server/payments/provider-singleton.ts` — mirror verbatim (cache + reset hook + typed unconfigured error)
- **verifyCsrf shape:** `frontend/src/lib/server/auth.ts:192-211` — return `NextResponse | null`, mirror style
- **env-shape test pattern:** `frontend/src/lib/server/observability/env-shape.test.ts` — append a `describe.it` block (path resolution: `../../../../../.env.example` — 5 levels up because the file is at `frontend/src/lib/server/observability/`)
- **Test mocks (D-17 lesson):** mock `verifyCronSecret` to return `NextResponse.json(...)` not plain `Response`; use `NextRequest` not plain `Request` for handlers
- **r2-mock.ts factory pattern:** `frontend/src/test-utils/r2-mock.ts` — model `bictorys-mock.ts` after this
- **Phase 4 RED-test pattern:** `frontend/src/app/api/withdrawals/route.test.ts` (mock all imports + `vi.stubEnv` lifecycle)
</reference_patterns>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Ship verifyCronSecret helper + 6-case unit test (CRON-06)</name>
  <files>
    - frontend/src/lib/server/cron/auth.ts (NEW)
    - frontend/src/lib/server/cron/auth.test.ts (NEW)
  </files>
  <read_first>
    - frontend/src/lib/server/auth.ts (verifyCsrf reference shape, lines ~192-211)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §6 "verifyCronSecret Implementation" (verbatim skeleton + 6 test cases)
    - frontend/src/lib/server/observability/env-shape.test.ts (Vitest setup style)
  </read_first>
  <behavior>
    - Returns `null` when Authorization header is `Bearer ${process.env.CRON_SECRET}` (constant-time compare)
    - Returns `NextResponse.json({ error: 'CRON_NOT_CONFIGURED' }, { status: 500 })` when CRON_SECRET env unset
    - Returns `NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })` when:
      - Authorization header missing
      - Authorization scheme is not `Bearer ` (e.g. `Basic xxx`)
      - Bearer token is empty (`Bearer ` with nothing after)
      - Token length differs from secret length (length-mismatch fast-path)
      - Token bytes differ from secret bytes (timingSafeEqual returns false)
    - Reads CRON_SECRET at call time via `process.env.CRON_SECRET ?? ''` (Pitfall 6 — supports `vi.stubEnv`)
    - NEVER logs the presented or expected secret
  </behavior>
  <action>
**1. Create `frontend/src/lib/server/cron/auth.ts`** — verbatim from RESEARCH §6:

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

**2. Create `frontend/src/lib/server/cron/auth.test.ts`** — exercise the helper for real (no mocks):

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from './auth';

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/cron/test', { method: 'POST', headers });
}

describe('verifyCronSecret (CRON-06)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'secret-value-12345');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 500 CRON_NOT_CONFIGURED when CRON_SECRET env is unset', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = verifyCronSecret(makeReq({ authorization: 'Bearer secret-value-12345' }));
    expect(res).toBeInstanceOf(NextResponse);
    expect(res!.status).toBe(500);
    expect((await res!.json()).error).toBe('CRON_NOT_CONFIGURED');
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = verifyCronSecret(makeReq());
    expect(res!.status).toBe(401);
    expect((await res!.json()).error).toBe('UNAUTHORIZED');
  });

  it('returns 401 when scheme is not Bearer (e.g. Basic)', async () => {
    const res = verifyCronSecret(makeReq({ authorization: 'Basic c29tZXVzZXI6cGFzcw==' }));
    expect(res!.status).toBe(401);
  });

  it('returns 401 when Bearer token is empty', async () => {
    const res = verifyCronSecret(makeReq({ authorization: 'Bearer ' }));
    expect(res!.status).toBe(401);
  });

  it('returns 401 when secret value is wrong', async () => {
    const res = verifyCronSecret(makeReq({ authorization: 'Bearer wrong-secret-value' }));
    expect(res!.status).toBe(401);
  });

  it('returns null on correct Bearer ${CRON_SECRET}', () => {
    const res = verifyCronSecret(makeReq({ authorization: 'Bearer secret-value-12345' }));
    expect(res).toBeNull();
  });

  it('returns 401 when token length differs from secret length (no timingSafeEqual throw)', () => {
    const res = verifyCronSecret(makeReq({ authorization: 'Bearer short' }));
    expect(res!.status).toBe(401);
  });
});
```

**Critical:**
- Do NOT modify `frontend/src/lib/server/auth.ts` — verifyCronSecret lives in a NEW file.
- The 7 test cases above cover D-17 + Pitfall 6 (env read at call time).
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/lib/server/cron/auth.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/lib/server/cron/auth.ts` exists
    - `grep -c "export function verifyCronSecret" frontend/src/lib/server/cron/auth.ts` returns 1
    - `grep -c "timingSafeEqual" frontend/src/lib/server/cron/auth.ts` returns 1
    - `grep -c "process.env.CRON_SECRET" frontend/src/lib/server/cron/auth.ts` returns 1
    - `grep -c "NextResponse.json" frontend/src/lib/server/cron/auth.ts` returns ≥ 4
    - `grep -c "'server-only'" frontend/src/lib/server/cron/auth.ts` returns 1
    - File `frontend/src/lib/server/cron/auth.test.ts` exists with at least 7 `it(` blocks (6 fail-paths + 1 pass)
    - `pnpm --filter frontend exec vitest run src/lib/server/cron/auth.test.ts` exits 0 (all GREEN — this helper is fully implemented in this task)
    - `git diff --name-only` lists ONLY the 2 new files (no protected file modified)
  </acceptance_criteria>
  <done>verifyCronSecret shipped + 7-case test green; CRON-06 contract is locked for all 5 sibling cron route plans.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship webhook/bictorys.ts re-export wrapper + RED helper test (WH-01, WH-02)</name>
  <files>
    - frontend/src/lib/server/webhook/bictorys.ts (NEW)
    - frontend/src/lib/server/webhook/bictorys.test.ts (NEW)
  </files>
  <read_first>
    - frontend/src/lib/server/payments/bictorys.ts lines 367-428 (existing webhookProvider impl — PROTECTED)
    - frontend/src/lib/server/webhook/handler.ts lines 39-47 (WebhookProvider interface)
    - frontend/src/lib/server/payments/provider-singleton.ts (lazy-init pattern to mirror)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §1 "HMAC Signature Scheme" + §"webhook/bictorys.ts skeleton"
  </read_first>
  <behavior>
    - Lazy-init: `getBictorysWebhookProvider()` reads BICTORYS_API_URL/BICTORYS_API_KEY/BICTORYS_WEBHOOK_SECRET at first call (Pitfall 6 — supports vi.stubEnv); throws Error('Bictorys webhook provider not configured (env missing)') if any empty.
    - `bictorysWebhookProvider` (named export) is a `WebhookProvider<BictorysWebhookPayload>` whose `verifySignature` and `parsePayload` delegate to the lazy provider, and whose `extractIds` upgrades `kind` to `'refunded'` when `payload.status === 'refunded'` or `'refund'`.
    - `__resetBictorysWebhookProvider()` clears the cache for tests.
    - Re-exports `BictorysWebhookPayload` from payments/bictorys.ts so consumers don't import from the protected payments dir.
  </behavior>
  <action>
**1. Create `frontend/src/lib/server/webhook/bictorys.ts`** — verbatim from RESEARCH §"webhook/bictorys.ts skeleton (D-02)":

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

**2. Create `frontend/src/lib/server/webhook/bictorys.test.ts`** — unit-test the wrapper. Real env stubbing; no mocks needed (calls real `createBictorysProvider` from PROTECTED `payments/bictorys.ts`):

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  bictorysWebhookProvider,
  getBictorysWebhookProvider,
  __resetBictorysWebhookProvider,
} from './bictorys';

const SECRET = 'test-webhook-secret';

beforeEach(() => {
  vi.stubEnv('BICTORYS_API_URL', 'https://api.bictorys.test');
  vi.stubEnv('BICTORYS_API_KEY', 'test-api-key');
  vi.stubEnv('BICTORYS_WEBHOOK_SECRET', SECRET);
  __resetBictorysWebhookProvider();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetBictorysWebhookProvider();
});

describe('bictorysWebhookProvider (WH-01)', () => {
  it('verifies a valid HMAC + timestamp', () => {
    const ts = String(Date.now());
    const body = Buffer.from(JSON.stringify({ id: 'c1', status: 'succeeded' }));
    const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
    const r = bictorysWebhookProvider.verifySignature(body, {
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    });
    expect(r.valid).toBe(true);
  });

  it('rejects tampered body', () => {
    const ts = String(Date.now());
    const body = Buffer.from(JSON.stringify({ id: 'c1', status: 'succeeded' }));
    const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
    const tampered = Buffer.from(JSON.stringify({ id: 'c1', status: 'failed' }));
    const r = bictorysWebhookProvider.verifySignature(tampered, {
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects expired replay (drift > 60s default)', () => {
    const ts = String(Date.now() - 70_000); // 70s old
    const body = Buffer.from('{}');
    const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
    const r = bictorysWebhookProvider.verifySignature(body, {
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/replay/i);
  });

  it('throws when env unset (lazy init)', () => {
    vi.stubEnv('BICTORYS_API_KEY', '');
    __resetBictorysWebhookProvider();
    expect(() => getBictorysWebhookProvider()).toThrow(/not configured/i);
  });

  it('extractIds upgrades kind to refunded for status="refunded"', () => {
    const payload = { id: 'c1', charge_id: 'c1', status: 'refunded', event_type: 'charge.refunded' };
    const ids = bictorysWebhookProvider.extractIds(payload as never);
    expect(ids.kind).toBe('refunded');
    expect(ids.externalId).toBe('c1');
  });

  it('extractIds upgrades kind to refunded for status="refund"', () => {
    const payload = { id: 'c2', status: 'refund' };
    const ids = bictorysWebhookProvider.extractIds(payload as never);
    expect(ids.kind).toBe('refunded');
  });

  it('extractIds keeps kind=paid for status="succeeded"', () => {
    const payload = { id: 'c3', charge_id: 'c3', status: 'succeeded' };
    const ids = bictorysWebhookProvider.extractIds(payload as never);
    expect(ids.kind).toBe('paid');
  });
});
```
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/lib/server/webhook/bictorys.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/lib/server/webhook/bictorys.ts` exists
    - `grep -c "export const bictorysWebhookProvider" frontend/src/lib/server/webhook/bictorys.ts` returns 1
    - `grep -c "getBictorysWebhookProvider" frontend/src/lib/server/webhook/bictorys.ts` returns ≥ 3
    - `grep -c "__resetBictorysWebhookProvider" frontend/src/lib/server/webhook/bictorys.ts` returns 1
    - `grep -c "createBictorysProvider" frontend/src/lib/server/webhook/bictorys.ts` returns 1
    - `grep -c "kind: 'refunded'" frontend/src/lib/server/webhook/bictorys.ts` returns 1
    - File `frontend/src/lib/server/webhook/bictorys.test.ts` exists with ≥ 7 `it(` blocks
    - `pnpm --filter frontend exec vitest run src/lib/server/webhook/bictorys.test.ts` exits 0 (GREEN)
    - `git diff --stat frontend/src/lib/server/payments/bictorys.ts` shows zero changes (PROTECTED)
  </acceptance_criteria>
  <done>webhook/bictorys.ts re-export shipped with refunded-kind upgrade; HMAC verify + replay-window + extractIds tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Ship orders/expire.ts helper + unit test (CRON-04)</name>
  <files>
    - frontend/src/lib/server/orders/expire.ts (NEW)
    - frontend/src/lib/server/orders/expire.test.ts (NEW)
  </files>
  <read_first>
    - frontend/prisma/schema.prisma lines 275-311 (Order model — `status`, `expiresAt`, `userId?`)
    - frontend/src/lib/server/outbox/index.ts (enqueueOutbox signature; not currently used in v1 helper per RESEARCH §7 note about missing notification.order_expired kind)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §7 "Order Expiration Helper" (verbatim skeleton + assumption A3/A4)
  </read_first>
  <behavior>
    - `expirePendingOrders({ prisma, batchSize? })` finds Order rows where `status='PENDING' AND expiresAt < new Date()`, ordered `expiresAt: 'asc'`, take=batchSize (default 100).
    - For each candidate, runs a per-row `prisma.$transaction` with `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } })` — guards against a concurrent webhook flipping the row to PAID first.
    - Returns `{ expired: N }` where N is the count of rows actually transitioned (not the candidate count — the WHERE-guard may filter some out under contention).
    - Idempotent: re-running on a set with no PENDING+expired rows returns `{ expired: 0 }`.
    - Does NOT enqueue notifications in v1 (RESEARCH §7 — missing `notification.order_expired` outbox kind; protected dispatcher would need extension).
  </behavior>
  <action>
**1. Create `frontend/src/lib/server/orders/expire.ts`** — verbatim from RESEARCH §7:

```typescript
// frontend/src/lib/server/orders/expire.ts — Phase 5 D-14.
//
// Find PENDING Order rows whose expiresAt has passed and mark them EXPIRED
// in batches of `batchSize`. Idempotent: re-running on the same set finds
// zero PENDING + expired rows (they're already EXPIRED).
//
// v1 does NOT emit `notification.order_expired` outbox events (the kind is
// not in outbox/types.ts yet — would need a Phase 6 dispatcher extension).
// Users learn of expirations via the Phase 3 admin/orders endpoint.
import 'server-only';
import type { PrismaClient } from '@prisma/client';

export interface ExpirePendingOrdersOptions {
  prisma: PrismaClient;
  batchSize?: number; // default 100 — D-08
}

export async function expirePendingOrders(
  opts: ExpirePendingOrdersOptions,
): Promise<{ expired: number }> {
  const batchSize = opts.batchSize ?? 100;

  const candidates = await opts.prisma.order.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: batchSize,
    select: { id: true, userId: true, amount: true, currency: true },
  });

  if (candidates.length === 0) return { expired: 0 };

  let expired = 0;
  for (const o of candidates) {
    // Per-row tx — atomic update. The status='PENDING' WHERE-guard prevents
    // racing with a webhook that just flipped this row to PAID.
    const updated = await opts.prisma.$transaction(async (tx) => {
      const u = await tx.order.updateMany({
        where: { id: o.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return u.count > 0;
    });
    if (updated) expired++;
  }
  return { expired };
}
```

**2. Create `frontend/src/lib/server/orders/expire.test.ts`** — mock prisma:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expirePendingOrders } from './expire';

describe('expirePendingOrders (CRON-04)', () => {
  let findMany: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let $transaction: ReturnType<typeof vi.fn>;
  let prisma: never;

  beforeEach(() => {
    findMany = vi.fn();
    updateMany = vi.fn();
    $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ order: { updateMany } }),
    );
    prisma = { order: { findMany }, $transaction } as never;
  });

  it('returns { expired: 0 } when no candidates', async () => {
    findMany.mockResolvedValueOnce([]);
    const r = await expirePendingOrders({ prisma });
    expect(r).toEqual({ expired: 0 });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('marks all candidates EXPIRED and returns the count', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'o1', userId: 'u1', amount: 1000, currency: 'XOF' },
      { id: 'o2', userId: null, amount: 2000, currency: 'XOF' },
    ]);
    updateMany.mockResolvedValue({ count: 1 });
    const r = await expirePendingOrders({ prisma });
    expect(r).toEqual({ expired: 2 });
    expect(updateMany).toHaveBeenCalledTimes(2);
    // Verify the WHERE-guard
    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: 'o1', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
  });

  it('uses default batchSize=100 in findMany.take', async () => {
    findMany.mockResolvedValueOnce([]);
    await expirePendingOrders({ prisma });
    expect(findMany.mock.calls[0]![0]).toMatchObject({ take: 100, orderBy: { expiresAt: 'asc' } });
  });

  it('honors custom batchSize', async () => {
    findMany.mockResolvedValueOnce([]);
    await expirePendingOrders({ prisma, batchSize: 50 });
    expect(findMany.mock.calls[0]![0].take).toBe(50);
  });

  it('skips rows the WHERE-guard rejects (raced to PAID by webhook)', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'o1', userId: 'u1', amount: 1000, currency: 'XOF' },
      { id: 'o2', userId: 'u2', amount: 1000, currency: 'XOF' },
    ]);
    // o1 wins, o2 lost the race (count=0 → another worker flipped to PAID)
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const r = await expirePendingOrders({ prisma });
    expect(r).toEqual({ expired: 1 });
  });

  it('queries with status=PENDING AND expiresAt < now()', async () => {
    findMany.mockResolvedValueOnce([]);
    await expirePendingOrders({ prisma });
    const where = findMany.mock.calls[0]![0].where as { status: string; expiresAt: { lt: Date } };
    expect(where.status).toBe('PENDING');
    expect(where.expiresAt.lt).toBeInstanceOf(Date);
  });
});
```
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/lib/server/orders/expire.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/lib/server/orders/expire.ts` exists
    - `grep -c "export async function expirePendingOrders" frontend/src/lib/server/orders/expire.ts` returns 1
    - `grep -c "status: 'PENDING'" frontend/src/lib/server/orders/expire.ts` returns ≥ 2 (one in findMany WHERE, one in updateMany WHERE-guard)
    - `grep -c "status: 'EXPIRED'" frontend/src/lib/server/orders/expire.ts` returns 1
    - `grep -c "expiresAt: { lt:" frontend/src/lib/server/orders/expire.ts` returns 1
    - `grep -c "batchSize ?? 100" frontend/src/lib/server/orders/expire.ts` returns 1
    - `grep -c "\$transaction" frontend/src/lib/server/orders/expire.ts` returns 1
    - File `frontend/src/lib/server/orders/expire.test.ts` exists with ≥ 6 `it(` blocks
    - `pnpm --filter frontend exec vitest run src/lib/server/orders/expire.test.ts` exits 0 (GREEN)
  </acceptance_criteria>
  <done>expirePendingOrders helper shipped + 6-case test green; CRON-04 contract is locked.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Ship email-queue-singleton lazy-init helper (CRON-02 dep)</name>
  <files>
    - frontend/src/lib/server/queues/email-queue-singleton.ts (NEW)
  </files>
  <read_first>
    - frontend/src/lib/server/queues/email-queue.ts (EmailQueue constructor signature)
    - frontend/src/lib/server/payments/provider-singleton.ts (lazy-init pattern to mirror)
    - frontend/src/lib/server/redis.ts (`redis: Redis | null` export)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §"Action for planner: an email-queue-singleton.ts module is needed" (in §3 outbox-drain) + §4 "Email-Queue-Drain Pattern"
  </read_first>
  <behavior>
    - `getEmailQueue()` returns the cached `EmailQueue` if all of `redis`, `prisma`, and `mailer` are available; returns `null` (NOT throws) if any is missing.
    - First call constructs a `Mailer` (resend transport when `RESEND_API_KEY` present; no-op otherwise — read from existing email module per `frontend/src/lib/server/email/index.ts` if available, else inline the resend client construction).
    - Returns `null` when `UPSTASH_REDIS_REST_URL` OR `UPSTASH_REDIS_REST_TOKEN` OR `RESEND_API_KEY` is empty/unset.
    - `__resetEmailQueueSingleton()` clears the cache for tests.
    - Reads env at first call (Pitfall 6 — supports vi.stubEnv).
    - Used by `outbox-drain` (passes to `drainOutbox`) AND `email-queue-drain` (calls `.drainOne()`).
  </behavior>
  <action>
Create `frontend/src/lib/server/queues/email-queue-singleton.ts`:

```typescript
// frontend/src/lib/server/queues/email-queue-singleton.ts — Phase 5.
//
// Lazy-init EmailQueue. Returns null when any of UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN / RESEND_API_KEY is missing. Callers MUST handle
// the null case gracefully — outbox-drain skips email.* events with a logged
// "email queue not configured" warning; email-queue-drain returns a no-op
// `{ ok: true, processed: 0 }` response.
//
// Pattern mirrors payments/provider-singleton.ts.
import 'server-only';
import { EmailQueue } from './email-queue';
import { prisma } from '../prisma';
import { redis } from '../redis';
import { createLogger } from '../logger';

const log = createLogger();

let _queue: EmailQueue | null = null;
let _initialized = false;

/**
 * Lazy-init EmailQueue. Idempotent — first call constructs, subsequent calls
 * return the cached instance (or cached null if env was missing on first call).
 *
 * Returns null if any required env var is missing — caller decides whether to
 * skip work (preferred) or surface as an error.
 */
export function getEmailQueue(): EmailQueue | null {
  if (_initialized) return _queue;

  const url = process.env.UPSTASH_REDIS_REST_URL ?? '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
  const resendKey = process.env.RESEND_API_KEY ?? '';

  if (!url || !token || !resendKey || !redis) {
    log.warn(
      'email-queue-singleton: not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN / RESEND_API_KEY required)',
    );
    _initialized = true;
    _queue = null;
    return null;
  }

  // Construct mailer. Inline the Resend client to avoid coupling to whatever
  // mailer module exists; if frontend/src/lib/server/email exports a Mailer
  // factory, prefer it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Resend } = require('resend') as typeof import('resend');
  const resend = new Resend(resendKey);
  const from = process.env.EMAIL_FROM ?? 'noreply@localhost';

  const mailer = {
    async send(input: { to: string; subject: string; html: string; text?: string }) {
      await resend.emails.send({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text !== undefined ? { text: input.text } : {}),
      });
    },
  };

  _queue = new EmailQueue({ redis, prisma, mailer });
  _initialized = true;
  return _queue;
}

/** Test-only — clear the cached queue. */
export function __resetEmailQueueSingleton(): void {
  _queue = null;
  _initialized = false;
}
```

**Note for executor:** if `frontend/src/lib/server/email/index.ts` (or similar) already exports a `getMailer()` factory or `Mailer` instance, replace the inline `mailer` construction with that import. Verify by reading the email/ directory before writing. Either approach satisfies the contract.

**No dedicated test file in this task** — the singleton is exercised end-to-end by `cron/email-queue-drain/route.test.ts` (Wave 0 Task 5). Standalone unit tests would add minimal value over those route tests.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec tsc -p tsconfig.json --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/lib/server/queues/email-queue-singleton.ts` exists
    - `grep -c "export function getEmailQueue" frontend/src/lib/server/queues/email-queue-singleton.ts` returns 1
    - `grep -c "__resetEmailQueueSingleton" frontend/src/lib/server/queues/email-queue-singleton.ts` returns 1
    - `grep -c "process.env.UPSTASH_REDIS_REST_URL" frontend/src/lib/server/queues/email-queue-singleton.ts` returns 1
    - `grep -c "process.env.RESEND_API_KEY" frontend/src/lib/server/queues/email-queue-singleton.ts` returns 1
    - `grep -c "new EmailQueue" frontend/src/lib/server/queues/email-queue-singleton.ts` returns 1
    - `grep -c "return null" frontend/src/lib/server/queues/email-queue-singleton.ts` returns ≥ 1 (graceful no-op path)
    - `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
    - No protected file modified (`git diff --name-only frontend/src/lib/server/queues/email-queue.ts | wc -l` returns 0)
  </acceptance_criteria>
  <done>EmailQueue lazy-init singleton ready; outbox-drain and email-queue-drain Wave 1 routes import this without scavenger-hunting.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Ship 6 RED route.test.ts files + bictorys-mock.ts fixture (WH-01..02, CRON-01..06)</name>
  <files>
    - frontend/src/test-utils/bictorys-mock.ts (NEW)
    - frontend/src/app/api/webhooks/bictorys/route.test.ts (NEW)
    - frontend/src/app/api/cron/outbox-drain/route.test.ts (NEW)
    - frontend/src/app/api/cron/email-queue-drain/route.test.ts (NEW)
    - frontend/src/app/api/cron/verification-cleanup/route.test.ts (NEW)
    - frontend/src/app/api/cron/order-expiration/route.test.ts (NEW)
    - frontend/src/app/api/cron/webhook-log-purge/route.test.ts (NEW)
  </files>
  <read_first>
    - frontend/src/test-utils/r2-mock.ts (factory pattern to mirror for bictorys-mock)
    - frontend/src/app/api/withdrawals/route.test.ts (Phase 4 mock-shape canon — NextRequest + NextResponse + vi.stubEnv lifecycle)
    - frontend/src/lib/server/webhook/handler.ts (createWebhookHandler signature; how route.ts will use it)
    - frontend/src/lib/server/payments/bictorys.ts lines 367-428 (HMAC algorithm — bictorys-mock fixture must match)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §10 "Per-Route Test Fixture Patterns" (verbatim bictorys-mock + cron route test mock skeleton) + §"createWebhookHandler Invocation Pattern" §2
  </read_first>
  <behavior>
    bictorys-mock.ts:
    - `bictorysFixture(opts?)` returns `{ rawBody, headers, payload }` with valid HMAC computed via `crypto.createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest('hex')`.
    - `bictorysFixtureRequest(opts?)` returns `{ req: Request, payload }` for direct route POST.

    All 6 route.test.ts files follow this pattern (D-17, D-19):
    - `vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }))` — default-pass; override per-test to return `NextResponse.json(...)` for 401 cases.
    - `vi.mock('@/lib/server/leader-lease', () => ({ withLease: vi.fn(async (_r, _n, _t, fn) => fn()) }))` — pass-through.
    - `vi.mock('@/lib/server/redis', () => ({ redis: null }))`.
    - Use `NextRequest` (NOT plain `Request`) for the request.
    - Use `await import('./route')` inside each test so route module-not-found yields an explicit RED test failure (instead of suite-level setup error).

    Per-route cases:

    **webhooks/bictorys/route.test.ts** (≥ 5 cases — WH-01, WH-02):
    - "valid HMAC + first delivery" → 200 `{ ok: true, deduped: false }`; mock prisma.$transaction + webhookLog
    - "replay of same (externalId, eventType)" → 200 `{ ok: true, deduped: true }`; existing.processedAt set in mock
    - "tampered body" → 401 invalid signature
    - "expired replay window (drift > 60s)" → 401
    - "onPaid dispatched for status=succeeded" → assert handler-side enqueueOutbox call
    - "raw body via req.arrayBuffer" → assert no `.json()` call before factory

    **cron/outbox-drain/route.test.ts** (≥ 5 cases — CRON-01, CRON-06):
    - "401 when verifyCronSecret returns NextResponse" → mock override
    - "happy path returns processed count from drainOutbox" → drainOutbox returns `{ processed: 7, ... }` → response `{ ok: true, processed: 7 }`
    - "calls withLease with name=outbox-drain and ttl ≥ 60_000ms" → assert `withLeaseMock.mock.calls[0][1]` and `[2]`
    - "resets stuck PROCESSING rows older than 90s before drainOutbox" → assert `prisma.outboxEvent.updateMany` called with `where.status='PROCESSING'` BEFORE drainOutbox
    - "passes BATCH_SIZE=100 to drainOutbox" → assert `drainOutboxMock.mock.calls[0][1] === 100`

    **cron/email-queue-drain/route.test.ts** (≥ 4 cases — CRON-02, CRON-06):
    - "401 when verifyCronSecret fails"
    - "happy path drains up to BATCH_SIZE=100 jobs"
    - "stops early when drainOne returns false (queue empty)" → assert exit before 100
    - "no-op when getEmailQueue returns null"

    **cron/verification-cleanup/route.test.ts** (≥ 3 cases — CRON-03, CRON-06):
    - "401 when verifyCronSecret fails"
    - "deletes expired verification codes" → assert `prisma.verificationCode.deleteMany` called with `where.expiresAt: { lt: <Date> }`
    - "returns processed count from deleteMany"

    **cron/order-expiration/route.test.ts** (≥ 3 cases — CRON-04, CRON-06):
    - "401 when verifyCronSecret fails"
    - "calls expirePendingOrders helper" → mock the helper, assert called with `{ prisma }`
    - "returns processed count" → helper returns `{ expired: 5 }` → response `{ ok: true, processed: 5 }`

    **cron/webhook-log-purge/route.test.ts** (≥ 3 cases — CRON-05, CRON-06):
    - "401 when verifyCronSecret fails"
    - "deletes webhook logs older than retention" → assert `prisma.webhookLog.deleteMany` called with `where.createdAt: { lt: <cutoff> }`
    - "uses WEBHOOK_LOG_RETENTION_DAYS env (default 90)" → stub env to 30, assert cutoff is ~30 days ago
  </behavior>
  <action>
**File 1: `frontend/src/test-utils/bictorys-mock.ts`** — verbatim from RESEARCH §10:

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

import { NextRequest } from 'next/server';

/** Build a NextRequest with the fixture body + headers. Use in route tests. */
export function bictorysFixtureRequest(opts: BictorysFixtureOpts = {}): {
  req: NextRequest;
  payload: BictorysWebhookPayload;
} {
  const { rawBody, headers, payload } = bictorysFixture(opts);
  return {
    req: new NextRequest('http://localhost/api/webhooks/bictorys', {
      method: 'POST',
      headers,
      body: rawBody,
    }),
    payload,
  };
}
```

**File 2: `frontend/src/app/api/webhooks/bictorys/route.test.ts`** — RED. Mocks the createWebhookHandler factory's deps so the route's `export const POST = createWebhookHandler({...})` is exercised end-to-end:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';
import { bictorysFixtureRequest } from '@/test-utils/bictorys-mock';

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const outboxCreate = vi.fn();

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: { findUnique, create, update },
    order: { findFirst: orderFindFirst, update: orderUpdate },
    outboxEvent: { create: outboxCreate },
  }),
);

vi.mock('@/lib/server/prisma', () => ({
  prisma: { $transaction },
}));

beforeEach(() => {
  vi.stubEnv('BICTORYS_API_URL', 'https://api.bictorys.test');
  vi.stubEnv('BICTORYS_API_KEY', 'test-api-key');
  vi.stubEnv('BICTORYS_WEBHOOK_SECRET', 'test-webhook-secret');
  vi.stubEnv('BICTORYS_WEBHOOK_REPLAY_WINDOW_MS', '60000');
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  orderFindFirst.mockReset();
  orderUpdate.mockReset();
  outboxCreate.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/webhooks/bictorys', () => {
  it('valid HMAC + first delivery returns 200 deduped:false (WH-01)', async () => {
    findUnique.mockResolvedValueOnce(null); // no existing WebhookLog row
    orderFindFirst.mockResolvedValueOnce(null); // unknown charge — onPaid drops
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduped: false });
    expect(create).toHaveBeenCalled(); // WebhookLog row inserted
  });

  it('replay of same (externalId, eventType) returns deduped:true (WH-02)', async () => {
    findUnique.mockResolvedValueOnce({ id: 'wl1', processedAt: new Date() });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduped: true });
    expect(create).not.toHaveBeenCalled(); // no new row written
  });

  it('tampered body returns 401', async () => {
    const { rawBody, headers } = (await import('@/test-utils/bictorys-mock')).bictorysFixture({
      status: 'succeeded',
    });
    const tampered = Buffer.from(rawBody.toString('utf8').replace('succeeded', 'failed'));
    const { POST } = await import('./route');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost/api/webhooks/bictorys', {
      method: 'POST',
      headers,
      body: tampered,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('expired replay window (drift > 60s) returns 401', async () => {
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({
      status: 'succeeded',
      timestamp: Date.now() - 70_000, // 70s old
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('onPaid enqueues outbox event when order is found (WH-02 — outbox-not-closures)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o1',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 1000,
      currency: 'XOF',
    });
    outboxCreate.mockResolvedValue({ id: 'ob1' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(outboxCreate).toHaveBeenCalled();
    // Assert at least one outbox row's kind starts with 'notification.' or 'email.'
    const kinds = outboxCreate.mock.calls.map((c) => (c[0] as { data: { kind: string } }).data.kind);
    expect(kinds.some((k) => k === 'notification.payment_received' || k === 'email.payment_confirmation')).toBe(true);
  });

  it('exports runtime=nodejs and dynamic=force-dynamic (WH-01)', async () => {
    const mod = (await import('./route')) as { runtime?: string; dynamic?: string };
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
  });
});
```

**Files 3–7 (cron route tests):** Follow the canonical mock skeleton from RESEARCH §10. Each cron test file uses this template (replace `<NAME>` and adjust mocks per-route):

Common mock prelude (all 5 cron route tests):
```typescript
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

beforeEach(() => { vi.stubEnv('CRON_SECRET', 'test-secret'); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function makeReq(name: string): NextRequest {
  return new NextRequest(`http://localhost/api/cron/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  });
}
```

**File 3: `outbox-drain/route.test.ts`:**
```typescript
// ...common prelude...
const drainOutboxMock = vi.fn();
vi.mock('@/lib/server/outbox/dispatcher', () => ({ drainOutbox: drainOutboxMock }));

const updateManyMock = vi.fn(async () => ({ count: 0 }));
vi.mock('@/lib/server/prisma', () => ({
  prisma: { outboxEvent: { updateMany: updateManyMock } },
}));

vi.mock('@/lib/server/queues/email-queue-singleton', () => ({
  getEmailQueue: vi.fn(() => null),
}));

beforeEach(() => {
  drainOutboxMock.mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, dead: 0 });
});

describe('POST /api/cron/outbox-drain (CRON-01, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq('outbox-drain'));
    expect(res.status).toBe(401);
  });

  it('happy path returns processed count from drainOutbox', async () => {
    drainOutboxMock.mockResolvedValueOnce({ processed: 7, succeeded: 6, failed: 1, dead: 0 });
    const { POST } = await import('./route');
    const res = await POST(makeReq('outbox-drain'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 7 });
  });

  it('calls withLease with name=outbox-drain and ttl ≥ 60_000ms', async () => {
    const { withLease } = await import('@/lib/server/leader-lease');
    const { POST } = await import('./route');
    await POST(makeReq('outbox-drain'));
    expect(withLease).toHaveBeenCalled();
    expect((withLease as Mock).mock.calls[0]![1]).toBe('outbox-drain');
    expect((withLease as Mock).mock.calls[0]![2]).toBeGreaterThanOrEqual(60_000);
  });

  it('resets stuck PROCESSING rows older than 90s before drainOutbox (D-09)', async () => {
    const { POST } = await import('./route');
    await POST(makeReq('outbox-drain'));
    expect(updateManyMock).toHaveBeenCalled();
    const args = updateManyMock.mock.calls[0]![0] as { where?: { status?: string }; data?: { status?: string } };
    expect(args.where?.status).toBe('PROCESSING');
    expect(args.data?.status).toBe('PENDING');
    // Verify the call ordering: updateMany BEFORE drainOutbox
    expect((updateManyMock as Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (drainOutboxMock as Mock).mock.invocationCallOrder[0]!,
    );
  });

  it('passes BATCH_SIZE=100 to drainOutbox (D-08)', async () => {
    const { POST } = await import('./route');
    await POST(makeReq('outbox-drain'));
    expect(drainOutboxMock.mock.calls[0]![1]).toBe(100);
  });
});
```

**File 4: `email-queue-drain/route.test.ts`:**
```typescript
// ...common prelude...
const drainOne = vi.fn();
const queueMock = { drainOne };
const getEmailQueueMock = vi.fn(() => queueMock);
vi.mock('@/lib/server/queues/email-queue-singleton', () => ({
  getEmailQueue: getEmailQueueMock,
}));

beforeEach(() => { drainOne.mockReset(); getEmailQueueMock.mockReturnValue(queueMock); });

describe('POST /api/cron/email-queue-drain (CRON-02, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq('email-queue-drain'));
    expect(res.status).toBe(401);
  });

  it('drains up to BATCH_SIZE=100 jobs', async () => {
    drainOne.mockResolvedValue(true);
    const { POST } = await import('./route');
    const res = await POST(makeReq('email-queue-drain'));
    expect(res.status).toBe(200);
    expect(drainOne).toHaveBeenCalledTimes(100);
    expect(await res.json()).toEqual({ ok: true, processed: 100 });
  });

  it('stops early when drainOne returns false (queue empty)', async () => {
    drainOne.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { POST } = await import('./route');
    const res = await POST(makeReq('email-queue-drain'));
    expect(drainOne).toHaveBeenCalledTimes(3);
    expect(await res.json()).toEqual({ ok: true, processed: 2 });
  });

  it('returns processed=0 when getEmailQueue returns null', async () => {
    getEmailQueueMock.mockReturnValueOnce(null as never);
    const { POST } = await import('./route');
    const res = await POST(makeReq('email-queue-drain'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 0 });
    expect(drainOne).not.toHaveBeenCalled();
  });
});
```

**File 5: `verification-cleanup/route.test.ts`:**
```typescript
// ...common prelude...
const deleteMany = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: { verificationCode: { deleteMany } },
}));

beforeEach(() => { deleteMany.mockReset(); });

describe('POST /api/cron/verification-cleanup (CRON-03, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq('verification-cleanup'));
    expect(res.status).toBe(401);
  });

  it('deletes expired verification codes (CRON-03)', async () => {
    deleteMany.mockResolvedValueOnce({ count: 3 });
    const { POST } = await import('./route');
    const res = await POST(makeReq('verification-cleanup'));
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it('returns processed count from deleteMany', async () => {
    deleteMany.mockResolvedValueOnce({ count: 12 });
    const { POST } = await import('./route');
    const res = await POST(makeReq('verification-cleanup'));
    expect(await res.json()).toEqual({ ok: true, processed: 12 });
  });
});
```

**File 6: `order-expiration/route.test.ts`:**
```typescript
// ...common prelude...
const expirePendingOrdersMock = vi.fn();
vi.mock('@/lib/server/orders/expire', () => ({
  expirePendingOrders: expirePendingOrdersMock,
}));

vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

beforeEach(() => { expirePendingOrdersMock.mockReset(); });

describe('POST /api/cron/order-expiration (CRON-04, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq('order-expiration'));
    expect(res.status).toBe(401);
  });

  it('calls expirePendingOrders helper with prisma', async () => {
    expirePendingOrdersMock.mockResolvedValueOnce({ expired: 0 });
    const { POST } = await import('./route');
    await POST(makeReq('order-expiration'));
    expect(expirePendingOrdersMock).toHaveBeenCalled();
    const arg = expirePendingOrdersMock.mock.calls[0]![0] as { prisma: unknown };
    expect(arg.prisma).toBeDefined();
  });

  it('returns processed count from helper (CRON-04)', async () => {
    expirePendingOrdersMock.mockResolvedValueOnce({ expired: 5 });
    const { POST } = await import('./route');
    const res = await POST(makeReq('order-expiration'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 5 });
  });
});
```

**File 7: `webhook-log-purge/route.test.ts`:**
```typescript
// ...common prelude...
const deleteMany = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: { webhookLog: { deleteMany } },
}));

beforeEach(() => { deleteMany.mockReset(); });

describe('POST /api/cron/webhook-log-purge (CRON-05, CRON-06)', () => {
  it('returns 401 when verifyCronSecret fails (CRON-06)', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq('webhook-log-purge'));
    expect(res.status).toBe(401);
  });

  it('deletes webhook logs older than retention (CRON-05)', async () => {
    deleteMany.mockResolvedValueOnce({ count: 4 });
    vi.stubEnv('WEBHOOK_LOG_RETENTION_DAYS', '30');
    const { POST } = await import('./route');
    const res = await POST(makeReq('webhook-log-purge'));
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalled();
    const where = (deleteMany.mock.calls[0]![0] as { where: { createdAt: { lt: Date } } }).where;
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    // Cutoff should be ~30 days ago
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(where.createdAt.lt.getTime()).toBeGreaterThan(expected - 60_000);
    expect(where.createdAt.lt.getTime()).toBeLessThan(expected + 60_000);
  });

  it('uses default 90 days when WEBHOOK_LOG_RETENTION_DAYS unset', async () => {
    deleteMany.mockResolvedValueOnce({ count: 0 });
    const { POST } = await import('./route');
    await POST(makeReq('webhook-log-purge'));
    const where = (deleteMany.mock.calls[0]![0] as { where: { createdAt: { lt: Date } } }).where;
    const expected = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(where.createdAt.lt.getTime()).toBeGreaterThan(expected - 60_000);
    expect(where.createdAt.lt.getTime()).toBeLessThan(expected + 60_000);
  });
});
```

**These tests will all FAIL until Wave 1 ships the routes.** RED is correct — the failures are `Cannot find module './route'`, NOT setup errors.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys src/app/api/cron --reporter=verbose 2>&1 | grep -E "(Tests|FAIL|test files|module)" | head -20</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/test-utils/bictorys-mock.ts` exists, exports `bictorysFixture` + `bictorysFixtureRequest`
    - `grep -c "createHmac\\('sha256'" frontend/src/test-utils/bictorys-mock.ts` returns 1
    - 6 RED test files exist at the listed paths
    - `grep -c "verifyCronSecret" frontend/src/app/api/cron/outbox-drain/route.test.ts` returns ≥ 1
    - `grep -c "withLease" frontend/src/app/api/cron/outbox-drain/route.test.ts` returns ≥ 1
    - `grep -c "BATCH_SIZE" frontend/src/app/api/cron/outbox-drain/route.test.ts` returns ≥ 1 (test name contains "BATCH_SIZE=100")
    - `grep -c "deduped: false" frontend/src/app/api/webhooks/bictorys/route.test.ts` returns ≥ 1
    - `grep -c "deduped: true" frontend/src/app/api/webhooks/bictorys/route.test.ts` returns ≥ 1
    - `grep -lc "NextRequest" frontend/src/app/api/cron/*/route.test.ts | wc -l` returns 5 (all 5 cron tests use NextRequest, not Request)
    - `grep -c "NextResponse.json" frontend/src/app/api/cron/outbox-drain/route.test.ts` returns ≥ 1 (D-17 mock-shape canon)
    - All 6 route.test files run and report `Cannot find module './route'` (RED is correct here — Wave 1 builds the routes)
    - The 3 helper tests from Tasks 1–3 are GREEN
    - No protected file modified
  </acceptance_criteria>
  <done>6 RED route.test.ts files committed using D-17/D-19 canonical mock shapes; bictorys-mock fixture ready; suite is RED only on missing route imports.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Append env.example blocks + env-shape + vercel-json-shape tripwire tests (CRON-07, ENV)</name>
  <files>
    - .env.example (APPEND ONLY — preserve existing content)
    - frontend/src/lib/server/observability/env-shape.test.ts (EXTEND)
    - frontend/src/lib/server/observability/vercel-json-shape.test.ts (NEW)
  </files>
  <read_first>
    - .env.example (current content — append at end; existing keys: CRON_SECRET line 18, BICTORYS_WEBHOOK_SECRET line 69)
    - frontend/src/lib/server/observability/env-shape.test.ts (existing structure — `describe('.env.example phase 4 additions')` block at line 60+; add a new sibling describe for phase 5)
    - frontend/src/lib/server/observability/runtime-enforcement.test.ts (fast-glob walk pattern to mirror in vercel-json-shape.test.ts)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §9 "vercel.json Schema" + D-20 validation test
  </read_first>
  <behavior>
    .env.example: append a Phase 5 block declaring `WEBHOOK_LOG_RETENTION_DAYS="90"` and `ORDER_EXPIRATION_MINUTES="30"` with explanatory comments.
    env-shape.test.ts: append a new `describe('.env.example phase 5 additions (CRON-05 + Phase 5 ENV)')` with an `it()` that asserts the literal substrings exist in the file.
    vercel-json-shape.test.ts: NEW file at `frontend/src/lib/server/observability/vercel-json-shape.test.ts`. Asserts:
    - `frontend/vercel.json` does NOT yet exist (RED — Wave 1 plan 05-08 ships it). The test should be SKIPPED-or-RED until vercel.json lands. Implementation strategy: use `fs.existsSync` to gate; if absent, mark test as `it.todo` OR write the test as RED with `expect(existsSync).toBe(true)`. Choose RED-by-design — Wave 1 plan 05-08's success is signaled by this test going GREEN.
    - When vercel.json exists: parse JSON, assert `crons.length === 5`, each entry has `path` matching `/^\/api\/cron\/[a-z-]+$/` and `schedule` matching `/^[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+$/`, all 5 paths correspond to actual `app/api/cron/<name>/route.ts` files.
  </behavior>
  <action>
**1. APPEND to `.env.example` (repo root)** — do NOT rewrite or reorder. Append at the end:

```ini
# ---------------------------------------------------------------------------
# Phase 5 — webhook log retention + order expiration
# ---------------------------------------------------------------------------
# WEBHOOK_LOG_RETENTION_DAYS — used by /api/cron/webhook-log-purge (daily).
# Compliance teams sometimes want 1y or 7y retention; flip this knob without
# re-deploying. Default 90.
WEBHOOK_LOG_RETENTION_DAYS="90"

# ORDER_EXPIRATION_MINUTES — fork-customizable knob for the order-creation
# route (Phase 3) to compute Order.expiresAt = createdAt + N minutes. The
# /api/cron/order-expiration (every 5 min) reads Order.expiresAt directly
# and is INDEPENDENT of this env — but forks adjusting checkout windows
# tweak this single value rather than the route code. Default 30 min.
ORDER_EXPIRATION_MINUTES="30"
```

**2. EXTEND `frontend/src/lib/server/observability/env-shape.test.ts`** — add a NEW `describe` (do NOT delete existing tests). Mirror the path-resolution style used in the file (`__dirname` + `resolve('../../../../../.env.example')` per line 15):

```typescript
describe('.env.example phase 5 additions (CRON-05 + Phase 5 ENV)', () => {
  it('contains WEBHOOK_LOG_RETENTION_DAYS and ORDER_EXPIRATION_MINUTES with defaults', () => {
    const text = readFileSync(ENV_EXAMPLE, 'utf8');
    expect(text).toContain('WEBHOOK_LOG_RETENTION_DAYS="90"');
    expect(text).toContain('ORDER_EXPIRATION_MINUTES="30"');
  });
});
```

(The exact import names — `readFileSync`, `ENV_EXAMPLE` — must match what the existing file uses. If it uses `resolve(__dirname, '../../../../../.env.example')` directly, mirror that.)

**3. CREATE `frontend/src/lib/server/observability/vercel-json-shape.test.ts`** — new file. Will be RED until Wave 1 plan 05-08 ships vercel.json:

```typescript
// frontend/src/lib/server/observability/vercel-json-shape.test.ts — Phase 5 D-20.
//
// Tripwire: verifies vercel.json declares all 5 cron schedules with valid
// cron-format strings and paths that correspond to actual route.ts files.
//
// Wave 0 status: RED until Wave 1 plan 05-08 ships frontend/vercel.json.
// Once GREEN, this test guards against route-rename / schedule-drift
// regressions where a developer renames a cron route file but forgets
// vercel.json.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import fg from 'fast-glob';

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(here, '../../../../');
const VERCEL_JSON = resolve(FRONTEND_ROOT, 'vercel.json');
const APP_API_CRON = resolve(FRONTEND_ROOT, 'src/app/api/cron');

const PATH_RE = /^\/api\/cron\/[a-z][a-z0-9-]*$/;
// Permissive cron-format: 5 fields, each containing only digits, *, /, ,, -, or whitespace
const SCHED_RE = /^[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+$/;

interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>;
}

describe('vercel.json schema (CRON-07, D-20)', () => {
  it('frontend/vercel.json exists', () => {
    expect(existsSync(VERCEL_JSON)).toBe(true);
  });

  it('declares exactly 5 cron schedules', () => {
    if (!existsSync(VERCEL_JSON)) return; // skip silently when RED-by-design
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
    expect(cfg.crons).toBeDefined();
    expect(cfg.crons!.length).toBe(5);
  });

  it('every cron path matches /^\\/api\\/cron\\/[a-z-]+$/ and schedule is valid 5-field cron', () => {
    if (!existsSync(VERCEL_JSON)) return;
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
    for (const c of cfg.crons ?? []) {
      expect(c.path).toMatch(PATH_RE);
      expect(c.schedule).toMatch(SCHED_RE);
    }
  });

  it('every cron path corresponds to an existing app/api/cron/<name>/route.ts file', async () => {
    if (!existsSync(VERCEL_JSON)) return;
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
    const routeFiles = await fg('*/route.ts', { cwd: APP_API_CRON, onlyFiles: true });
    const routeNames = new Set(routeFiles.map((f) => f.split('/')[0]));
    for (const c of cfg.crons ?? []) {
      const name = c.path.replace('/api/cron/', '');
      expect(routeNames.has(name), `vercel.json declares /api/cron/${name} but no route.ts found`).toBe(true);
    }
  });

  it('declares schedules for the 5 canonical Phase 5 crons', () => {
    if (!existsSync(VERCEL_JSON)) return;
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
    const paths = (cfg.crons ?? []).map((c) => c.path).sort();
    expect(paths).toEqual([
      '/api/cron/email-queue-drain',
      '/api/cron/order-expiration',
      '/api/cron/outbox-drain',
      '/api/cron/verification-cleanup',
      '/api/cron/webhook-log-purge',
    ]);
  });
});
```

**Notes:**
- Path resolution: the test sits at `frontend/src/lib/server/observability/`, 4 levels deep from `frontend/`, so `resolve(here, '../../../../')` = `frontend/`. Verify with `console.log` if uncertain.
- `existsSync` gates the post-ships-it tests so the suite passes "first existence" check as the only RED point — once Wave 1 plan 05-08 ships `vercel.json`, all 5 assertions run.
- `fast-glob` is already a Phase 0 dep (used in `runtime-enforcement.test.ts`).
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts src/lib/server/observability/vercel-json-shape.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "WEBHOOK_LOG_RETENTION_DAYS" .env.example` returns ≥ 1
    - `grep -c "ORDER_EXPIRATION_MINUTES" .env.example` returns ≥ 1
    - `grep -c "WEBHOOK_LOG_RETENTION_DAYS" frontend/src/lib/server/observability/env-shape.test.ts` returns ≥ 1
    - `grep -c "ORDER_EXPIRATION_MINUTES" frontend/src/lib/server/observability/env-shape.test.ts` returns ≥ 1
    - `grep -c "phase 5 additions" frontend/src/lib/server/observability/env-shape.test.ts` returns 1
    - File `frontend/src/lib/server/observability/vercel-json-shape.test.ts` exists
    - `grep -c "crons" frontend/src/lib/server/observability/vercel-json-shape.test.ts` returns ≥ 3
    - `grep -c "fast-glob\\|fg\\(" frontend/src/lib/server/observability/vercel-json-shape.test.ts` returns ≥ 1
    - `grep -c "PATH_RE\\|/api/cron/" frontend/src/lib/server/observability/vercel-json-shape.test.ts` returns ≥ 2
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/vercel-json-shape.test.ts` exits non-zero (RED — `frontend/vercel.json` does NOT yet exist; Wave 1 plan 05-08 turns it green) — only the "frontend/vercel.json exists" assertion fails; the 4 others skip gracefully
    - No protected file modified
  </acceptance_criteria>
  <done>.env.example carries Phase 5 env block; env-shape green; vercel-json-shape test RED-by-design (will go GREEN when plan 05-08 ships vercel.json).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer→repo | `.env.example` is checked into git — secrets stay placeholder strings only |
| test→production | `bictorys-mock.ts` builds valid HMAC fixtures with `test-webhook-secret`; never imports into production code paths |
| public→cron | `verifyCronSecret` is THE access boundary for `/api/cron/*` — any bug here lets anonymous callers trigger drain/purge work |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-01-01 | S (Spoofing) | `verifyCronSecret` Bearer compare | mitigate | `node:crypto.timingSafeEqual` constant-time compare; length-mismatch fast-path prevents Buffer.from-throw + side-channel; secret never logged. CRON-06 acceptance test exercises 6 attack paths. |
| T-05-01-02 | I (Information disclosure) | `verifyCronSecret` env read | mitigate | Returns 500 CRON_NOT_CONFIGURED with NO env values in response payload; logs warn-level only on misconfig at request time, never at module import. |
| T-05-01-03 | T (Tampering) | webhook fixture HMAC re-derivation | mitigate | `bictorys-mock.ts` derives HMAC verbatim from `payments/bictorys.ts:367-413` algorithm — drift between fixture and verifier is impossible by construction. Unit tests in webhook/bictorys.test.ts verify both succeed-path and tamper-path. |
| T-05-01-04 | I | `bictorysWebhookProvider` singleton state leak across tests | mitigate | `__resetBictorysWebhookProvider()` exported and called in test `beforeEach`/`afterEach`; cached env values do NOT survive vi.stubEnv changes within a test file. |
| T-05-01-05 | E (Elevation of privilege) | `expirePendingOrders` race vs. webhook | mitigate | Per-row `prisma.$transaction` with `updateMany WHERE status='PENDING'` — the WHERE-guard prevents flipping a row already moved to PAID by a concurrent webhook. RESEARCH §7 verifies. |
| T-05-01-06 | D (DoS) | unconfigured `EmailQueue` causing infinite outbox retries | accept | `getEmailQueue()` returns `null` gracefully; `outbox-drain` logs warn and skips email.* events; rows retry per existing dispatcher backoff (30s→1h, MAX_ATTEMPTS=5 → DEAD). Acceptable in dev; production deploys MUST set RESEND_API_KEY. |
| T-05-01-07 | I | `CRON_SECRET` accidentally added with `NEXT_PUBLIC_` prefix | mitigate | env-shape.test.ts existing assertions enforce `CRON_SECRET=""` (no NEXT_PUBLIC_ prefix); naming convention enforced by Phase 0. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/lib/server/cron/auth.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/webhook/bictorys.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/orders/expire.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/vercel-json-shape.test.ts` exits non-zero (RED — vercel.json absent; Wave 1 plan 05-08 closes the gap)
- `pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys src/app/api/cron` exits non-zero (RED — route modules absent; Wave 1 plans 05-02..07 close the gap)
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0 (no new routes yet — still passing)
- No file from CLAUDE.md "Files Claude must NOT modify" list was touched
</verification>

<success_criteria>
- 3 new lib helpers shipped + their unit tests green: `cron/auth.ts`, `webhook/bictorys.ts`, `orders/expire.ts`
- 1 lazy-init queue singleton shipped: `queues/email-queue-singleton.ts`
- 1 fixture shipped: `test-utils/bictorys-mock.ts`
- 6 RED route.test.ts files committed with D-17/D-19 canonical mock shapes (NextRequest + NextResponse + vi.stubEnv)
- 1 vercel-json-shape.test.ts shipped (RED-by-design until plan 05-08)
- env-shape.test.ts extended with Phase 5 assertions (GREEN)
- `.env.example` carries WEBHOOK_LOG_RETENTION_DAYS + ORDER_EXPIRATION_MINUTES
- All 9 phase requirement IDs (WH-01, WH-02, CRON-01..07) have at least one Wave 0 contract artifact (test or helper)
</success_criteria>

<output>
After completion, create `.planning/phases/05-webhooks-and-vercel-cron/05-01-SUMMARY.md` capturing:
- Files created/modified (17 files)
- Test counts (≥7 + ≥7 + ≥6 helper unit tests; ≥6 + ≥5 + ≥4 + ≥3 + ≥3 + ≥3 RED route tests; ≥5 vercel-json-shape; 1 env-shape addition)
- Wave 1 readiness signal (route plans 05-02..05-08 can now consume the contracts)
- Any deviation from RESEARCH (e.g., if `frontend/src/lib/server/email/index.ts` exposed a different Mailer factory and we adapted)
</output>
</content>
</invoke>