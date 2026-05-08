---
id: 05-02-webhook-bictorys-route
phase: "05"
plan: 02
type: execute
wave: 1
depends_on:
  - 05-01-scaffold-cron-webhook-fixtures-tests
files_modified:
  - frontend/src/app/api/webhooks/bictorys/route.ts
autonomous: true
task_count: 1
requirements:
  - WH-01
  - WH-02
must_haves:
  truths:
    - "POST with valid HMAC + first delivery returns 200 { ok: true, deduped: false }"
    - "POST with same (externalId, eventType) returns 200 { ok: true, deduped: true } without re-running event handler"
    - "POST with tampered body returns 401"
    - "POST with timestamp drift > BICTORYS_WEBHOOK_REPLAY_WINDOW_MS returns 401"
    - "onPaid handler calls enqueueOutbox(tx, ...) inside same Serializable tx — never postCommit closure"
    - "Route exports runtime='nodejs' AND dynamic='force-dynamic'"
  artifacts:
    - path: "frontend/src/app/api/webhooks/bictorys/route.ts"
      provides: "POST /api/webhooks/bictorys — Bictorys payment webhook adapter"
      exports: ["POST", "runtime", "dynamic"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/webhooks/bictorys/route.ts"
      to: "frontend/src/lib/server/webhook/handler.ts (PROTECTED — call only)"
      via: "createWebhookHandler({ provider, prisma, onPaid, onRefunded, onFailed })"
      pattern: "createWebhookHandler"
    - from: "frontend/src/app/api/webhooks/bictorys/route.ts"
      to: "frontend/src/lib/server/webhook/bictorys.ts"
      via: "bictorysWebhookProvider import"
      pattern: "bictorysWebhookProvider"
    - from: "frontend/src/app/api/webhooks/bictorys/route.ts"
      to: "frontend/src/lib/server/outbox/index.ts"
      via: "enqueueOutbox(tx, { kind, payload }) inside onPaid/onRefunded/onFailed handlers"
      pattern: "enqueueOutbox\\(tx"
---

<objective>
Ship `POST /api/webhooks/bictorys`: a thin adapter that builds the WebhookProvider, defines `onPaid`/`onRefunded`/`onFailed` event handlers using `enqueueOutbox` for side-effects, and exports the result of `createWebhookHandler({...})`. Implements WH-01 + WH-02.

Purpose: This is the inbound payment-event entry point. The factory at `lib/server/webhook/handler.ts` (PROTECTED) does ALL the hard work — raw body, HMAC verify, Serializable tx, dedup, dispatch, processedAt write-back. The route is ~30 LOC of glue code that turns the Wave 0 RED tests GREEN.

Output: One route handler file. All 6 Wave 0 RED webhook tests now GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md
@.planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md
@.planning/phases/05-webhooks-and-vercel-cron/05-VALIDATION.md
@CLAUDE.md

@frontend/src/lib/server/webhook/handler.ts
@frontend/src/lib/server/webhook/bictorys.ts
@frontend/src/lib/server/outbox/index.ts
@frontend/src/lib/server/outbox/types.ts
@frontend/src/lib/server/payments/bictorys.ts
@frontend/src/app/api/webhooks/bictorys/route.test.ts

<interfaces>
From frontend/src/lib/server/webhook/handler.ts (PROTECTED — call only):
```typescript
export interface WebhookHandlerOptions<TPayload> {
  prisma: PrismaClient;
  provider: WebhookProvider<TPayload>;
  onPaid?: WebhookEventHandler<TPayload>;
  onRefunded?: WebhookEventHandler<TPayload>;
  onFailed?: WebhookEventHandler<TPayload>;
}
export type WebhookEventHandler<TPayload> = (
  payload: TPayload,
  tx: PrismaTransactionClient,
) => Promise<WebhookHandlerResult>;
export interface WebhookHandlerResult { postCommit?: () => Promise<void>; }
export function createWebhookHandler<TPayload>(opts: WebhookHandlerOptions<TPayload>): (req: NextRequest) => Promise<NextResponse>;
```

From frontend/src/lib/server/webhook/bictorys.ts (Wave 0):
```typescript
export const bictorysWebhookProvider: WebhookProvider<BictorysWebhookPayload>;
export type { BictorysWebhookPayload };
```

From frontend/src/lib/server/outbox/index.ts:
```typescript
export type OutboxTxClient = Pick<Prisma.TransactionClient, 'outboxEvent'>;
export async function enqueueOutbox(tx: OutboxTxClient, event: OutboxEvent): Promise<{ id: string }>;
```

From frontend/src/lib/server/outbox/types.ts (4 kinds — adding new ones touches PROTECTED dispatcher.ts):
- `notification.payment_received` { userId, orderId, amount, currency }
- `email.payment_confirmation` { to, orderId, amount, currency }
- `email.verification_code` { to, code }
- `email.password_reset` { to, code }

From frontend/prisma/schema.prisma:
```prisma
model Order {
  id String @id; userId String?; amount Int; currency String; status String;
  customerEmail String?; providerChargeId String? @unique;
  paidAt DateTime?; paymentMethod String?;
}
```
</interfaces>

<reference_patterns>
- **Webhook adapter shape:** RESEARCH §"Pattern 1: Webhook Adapter Route" — verbatim 30-LOC skeleton
- **Outbox-not-closures invariant:** D-04 + CLAUDE.md "Webhook handlers emit side-effects via the outbox, NEVER fire-and-forget closures"
- **Status mapping:** `kind === 'paid'` → onPaid; `'refunded'` → onRefunded (kind upgrade lives in webhook/bictorys.ts wrapper); `'failed'` → onFailed; `'other'` → no dispatch (still 200 deduped:false after WebhookLog upsert)
</reference_patterns>
</context>

<sibling_plans_note>
The Wave 0 RED test file (`frontend/src/app/api/webhooks/bictorys/route.test.ts`) was authored in plan 05-01's worktree and lives in the merge-back tree alongside this plan. Sibling Wave 1 plans (05-03..05-08) ship parallel routes/files with NO `files_modified` overlap, so this plan can run in its own worktree without conflict. Run `pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts` AFTER merge-back to confirm GREEN.
</sibling_plans_note>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement POST /api/webhooks/bictorys route adapter</name>
  <files>
    - frontend/src/app/api/webhooks/bictorys/route.ts (NEW)
  </files>
  <read_first>
    - frontend/src/app/api/webhooks/bictorys/route.test.ts (the contract — every test must pass)
    - frontend/src/lib/server/webhook/handler.ts lines 90-172 (factory body — verify the dispatch behavior; do NOT modify)
    - frontend/src/lib/server/webhook/bictorys.ts (provider import target — Wave 0)
    - frontend/src/lib/server/outbox/index.ts (enqueueOutbox signature)
    - frontend/src/lib/server/outbox/types.ts (OutboxEvent discriminated union — 4 kinds)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §"Pattern 1: Webhook Adapter Route" (verbatim implementation reference)
    - frontend/prisma/schema.prisma lines 275-311 (Order model — providerChargeId, status, paidAt, paymentMethod)
  </read_first>
  <behavior>
    1. `runtime = 'nodejs'` exported (CI-enforced by runtime-enforcement.test.ts)
    2. `dynamic = 'force-dynamic'` exported (Pitfall 2 — prevents Next.js POST-response caching)
    3. `POST` is the result of `createWebhookHandler({ prisma, provider: bictorysWebhookProvider, onPaid, onRefunded, onFailed })` — NO `req.json()` / `req.text()` / `req.formData()` call BEFORE the factory (Pitfall 5 — silent HMAC regression)
    4. `onPaid(payload, tx)`:
       - extracts external charge id from `payload.charge_id ?? payload.chargeId ?? payload.id`
       - finds Order via `tx.order.findFirst({ where: { providerChargeId } })` — returns `{}` (no postCommit) if not found
       - updates Order: `status='PAID'`, `paidAt: new Date()`, `paymentMethod` from payload (when present)
       - if `order.userId` set: `enqueueOutbox(tx, { kind: 'notification.payment_received', payload: { userId, orderId, amount, currency } })`
       - if `order.customerEmail` set: `enqueueOutbox(tx, { kind: 'email.payment_confirmation', payload: { to, orderId, amount, currency } })`
       - returns `{}` — NO postCommit closure (D-04, CLAUDE.md outbox-not-closures invariant)
    5. `onRefunded(payload, tx)`: find order by providerChargeId; if found, update status='REFUNDED'. No outbox emit in v1 (no `notification.refund_received` kind in outbox/types.ts — RESEARCH A6).
    6. `onFailed(payload, tx)`: find order; update status='FAILED'. No outbox emit in v1.
  </behavior>
  <action>
Create `frontend/src/app/api/webhooks/bictorys/route.ts` — verbatim from RESEARCH §"Pattern 1":

```typescript
// PROTECTED imports — calls createWebhookHandler factory; never edits it.
// CLAUDE.md invariants:
//   - runtime=nodejs (Buffer/crypto)
//   - raw body before json (the factory calls req.arrayBuffer() FIRST — this
//     route file MUST NOT call req.json/text/formData before delegating)
//   - outbox-not-closures (event handlers use enqueueOutbox(tx, ...) inside
//     the same Serializable tx the factory opens)
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
    const externalRef = String(
      (payload.charge_id ?? payload.chargeId ?? payload.id ?? ''),
    );
    if (!externalRef) return {}; // no id to correlate

    const order = await tx.order.findFirst({
      where: { providerChargeId: externalRef },
    });
    if (!order) return {}; // unknown charge — log + drop (no DB row to update)

    const paymentMethod = payload.payment_method
      ? String(payload.payment_method)
      : null;

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        ...(paymentMethod !== null ? { paymentMethod } : {}),
      },
    });

    // Outbox emits — NEVER postCommit closures (D-04, CLAUDE.md outbox-not-closures).
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
        payload: {
          to: order.customerEmail,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
        },
      });
    }

    return {}; // no postCommit
  },

  async onRefunded(payload, tx) {
    const externalRef = String(
      (payload.charge_id ?? payload.chargeId ?? payload.id ?? ''),
    );
    if (!externalRef) return {};
    const order = await tx.order.findFirst({
      where: { providerChargeId: externalRef },
    });
    if (!order) return {};
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'REFUNDED' },
    });
    // No outbox emit in v1 — `notification.refund_received` kind not in
    // outbox/types.ts. Documented RESEARCH §"Pattern 1" + A6.
    return {};
  },

  async onFailed(payload, tx) {
    const externalRef = String(
      (payload.charge_id ?? payload.chargeId ?? payload.id ?? ''),
    );
    if (!externalRef) return {};
    const order = await tx.order.findFirst({
      where: { providerChargeId: externalRef },
    });
    if (!order) return {};
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'FAILED' },
    });
    return {};
  },
});
```

**Critical:**
- Do NOT add a `POST(req: NextRequest)` wrapper around `createWebhookHandler` — assign the result directly to `export const POST`. Wrapping would require `await req.arrayBuffer()` to happen in the wrapper, which is the Pitfall 5 trap.
- Do NOT modify any of: `webhook/handler.ts`, `webhook/bictorys.ts` (Wave 0), `outbox/dispatcher.ts`, `outbox/index.ts`, `payments/bictorys.ts` — all PROTECTED.
- Do NOT use `postCommit` for any side-effect — the field exists in `WebhookHandlerResult` for legacy reasons but new code MUST emit via `enqueueOutbox(tx, ...)`.
- The factory's `payload` parameter is typed `BictorysWebhookPayload` because `bictorysWebhookProvider` is `WebhookProvider<BictorysWebhookPayload>` — fields like `payload.charge_id` are typed without casts.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/webhooks/bictorys/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/webhooks/bictorys/route.ts` returns 1
    - `grep -c "export const dynamic = 'force-dynamic'" frontend/src/app/api/webhooks/bictorys/route.ts` returns 1
    - `grep -c "createWebhookHandler" frontend/src/app/api/webhooks/bictorys/route.ts` returns 1
    - `grep -c "bictorysWebhookProvider" frontend/src/app/api/webhooks/bictorys/route.ts` returns 1
    - `grep -c "enqueueOutbox(tx" frontend/src/app/api/webhooks/bictorys/route.ts` returns ≥ 2 (notification + email outbox emits inside onPaid)
    - `grep -c "notification.payment_received" frontend/src/app/api/webhooks/bictorys/route.ts` returns 1
    - `grep -c "email.payment_confirmation" frontend/src/app/api/webhooks/bictorys/route.ts` returns 1
    - `grep -c "providerChargeId" frontend/src/app/api/webhooks/bictorys/route.ts` returns ≥ 3 (one per onPaid/onRefunded/onFailed)
    - `grep -c "postCommit" frontend/src/app/api/webhooks/bictorys/route.ts` returns 0 (D-04 outbox-not-closures invariant)
    - `grep -c "req.json\\|req.text\\|req.formData" frontend/src/app/api/webhooks/bictorys/route.ts` returns 0 (Pitfall 5 — never read body before factory)
    - `pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts` exits 0 (all 6 RED tests now GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0 (route exports `runtime='nodejs'`)
    - No protected file modified (`git diff --name-only` lists only `frontend/src/app/api/webhooks/bictorys/route.ts`)
  </acceptance_criteria>
  <done>POST /api/webhooks/bictorys ships as a thin createWebhookHandler adapter; outbox-not-closures invariant honored; all Wave 0 RED webhook tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Bictorys→API | Untrusted webhook body — payload fields are attacker-controllable; HMAC signature verifies bytes against shared secret |
| API→DB | Order updates run inside Serializable tx opened by createWebhookHandler factory |
| API→Outbox | enqueueOutbox(tx, ...) writes inside the same tx — atomic with status update |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-02-01 | T (Tampering) | webhook body bytes | mitigate | createWebhookHandler reads `req.arrayBuffer()` BEFORE any other body access (handler.ts:94); HMAC verified by `bictorysWebhookProvider.verifySignature` against `BICTORYS_WEBHOOK_SECRET`; tampered → 401. |
| T-05-02-02 | R (Repudiation) | replay attack | mitigate | 60s replay window via `BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` (default) + `WebhookLog @@unique([externalId, eventType])` dedup. Replays return `deduped:true` without re-running the event handler. |
| T-05-02-03 | I (Information disclosure) | unknown charge_id leaked via 404 vs. 200 | accept | Both unknown and known charges return 200 — no information leaked about Order existence. (handler.ts always returns 200 after WebhookLog upsert.) |
| T-05-02-04 | T | side-effect lost on crash between commit and postCommit | mitigate | Side-effects emitted via `enqueueOutbox(tx, ...)` INSIDE the Serializable tx — atomic. Crash after commit = outbox row persists; cron drains later. NO postCommit closure used (D-04). |
| T-05-02-05 | E (Elevation of privilege) | unauthenticated POST | mitigate | HMAC verify is THE access control. Cookies / sessions not involved. CRON_SECRET not applicable. |
| T-05-02-06 | D (DoS) | repeated calls with valid signature drain DB connections | accept | Bictorys retries with exponential backoff; idempotency via WebhookLog dedup means N retries → 1 actual handler run. Acceptable. |
| T-05-02-07 | I | sensitive payload fields logged on error | mitigate | The factory logs `{ reason }` only on signature failure (handler.ts:99) + `String(err)` on tx failure (handler.ts:158). Payload itself never logged at top-level. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts` exits 0 (all RED tests GREEN)
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
- No protected file modified
- `grep -r "postCommit" frontend/src/app/api/webhooks/bictorys/` returns no matches (CLAUDE.md outbox-not-closures invariant honored)
</verification>

<success_criteria>
- Route handler shipped as thin createWebhookHandler adapter (~70 LOC)
- onPaid emits 2 outbox events (notification + email) atomically with Order.status='PAID' update
- onRefunded + onFailed update Order.status only (no outbox in v1 per RESEARCH A6)
- runtime='nodejs' + dynamic='force-dynamic' both exported
- All 6 Wave 0 RED webhook tests GREEN
- Zero modifications to PROTECTED files
</success_criteria>

<output>
After completion, create `.planning/phases/05-webhooks-and-vercel-cron/05-02-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (6 of 6 from webhooks/bictorys/route.test.ts)
- Outbox kinds emitted (notification.payment_received + email.payment_confirmation in onPaid)
- Any deviation from RESEARCH §"Pattern 1" (e.g., if BictorysWebhookPayload field names differ from spec)
- Open follow-ups (e.g., notification.refund_received outbox kind for Phase 6 dispatcher extension)
</output>
</content>
</invoke>