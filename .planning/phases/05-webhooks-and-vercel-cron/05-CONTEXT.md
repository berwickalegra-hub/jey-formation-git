# Phase 5: Webhooks and Vercel Cron - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the production wiring for asynchronous server work that the prior phases queue up but never drain on their own:

1. **Bictorys payment webhooks** — one route handler at `POST /api/webhooks/bictorys` that consumes the existing battle-tested `createWebhookHandler({...})` factory at `frontend/src/lib/server/webhook/handler.ts`, plus a Bictorys-specific `WebhookProvider` implementation (HMAC scheme + payload parser) that lives next to it. Handles `paid` / `refunded` / `failed` event types; emits side-effects via `enqueueOutbox(tx, event)` inside the same Serializable transaction (never fire-and-forget closures).

2. **Five Vercel Cron route handlers** — `outbox-drain`, `email-queue-drain`, `verification-cleanup`, `order-expiration`, `webhook-log-purge` — each at `frontend/src/app/api/cron/<name>/route.ts`, gated by `Authorization: Bearer ${CRON_SECRET}`. Each route is a thin shim that calls existing lib helpers (`drainOutbox`, `drainEmailQueue`, etc.) wrapped in `withLease(redis, name, ttlMs, fn)` for multi-instance coordination.

3. **`frontend/vercel.json`** — declares cron schedules + `maxDuration` per route. Validated by `next build` and integration test (file shape, schedule format, all 5 routes referenced).

This phase ships ZERO new domain logic. Every line of business behavior was already written in `lib/server/webhook/handler.ts`, `lib/server/outbox/dispatcher.ts`, `lib/server/email/queue.ts`, `lib/server/leader-lease.ts`, `lib/server/payments/bictorys.ts`, `lib/server/admin/audit.ts` (verification cleanup is a one-liner deleteMany). The route handlers are *adapters* — they translate `NextRequest → existing-helper-call → NextResponse`. Forks add new webhook providers by copying the Bictorys provider template; they add new crons by copying any of the 5 route shims.

</domain>

<decisions>
## Implementation Decisions

### Webhook handler structure

- **D-01:** Bictorys is the only webhook provider shipped in v1. The route file at `frontend/src/app/api/webhooks/bictorys/route.ts` calls `createWebhookHandler({ provider: bictorysProvider, prisma, onPaid, onRefunded, onFailed, replayWindowMs })` and returns the resulting handler. Other providers are explicitly out-of-scope per PROJECT.md "Non-Bictorys webhook providers in v1" boundary — forks add `webhooks/<provider>/route.ts` per-project.
- **D-02:** The Bictorys-specific `WebhookProvider<TPayload>` implementation lives at a NEW file `frontend/src/lib/server/webhook/bictorys.ts` (not in `lib/server/payments/`). Rationale: `payments/bictorys.ts` is the charge/payout API client; `webhook/bictorys.ts` is the inbound HMAC verifier + payload parser. Two distinct surfaces, deserve two files. Keeps the `webhook/` namespace cohesive (handler factory + per-provider impls colocated).
- **D-03:** Replay window: `BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` env (default `60000`, i.e. 60s per CLAUDE.md). The factory already accepts this; the route just reads `process.env` at handler-call time so `vi.stubEnv` works in tests.
- **D-04:** Side-effects go through the outbox, NEVER through `postCommit`. The `createWebhookHandler` API still exposes `postCommit` for legacy reasons, but new code (this phase) MUST use `enqueueOutbox(tx, event)` from inside the `onPaid` / `onRefunded` / `onFailed` handlers. This is a CLAUDE.md invariant; code review will flag any closure-style side effect.

### Cron route layout

- **D-05:** One route file per cron, no shared dispatcher: `frontend/src/app/api/cron/<name>/route.ts` with a `POST` handler. Six files total (outbox-drain, email-queue-drain, verification-cleanup, order-expiration, webhook-log-purge — five plus the auth helper). Matches CLAUDE.md guidance ("Background work runs as Vercel Cron routes under `app/api/cron/<name>/route.ts`"). Forks delete the ones they don't need.
- **D-06:** Cron auth helper at NEW file `frontend/src/lib/server/cron/auth.ts`, exporting `verifyCronSecret(req: NextRequest): NextResponse | null` (returns `null` on success, 401 NextResponse on failure — same shape as `verifyCsrf`). Each cron route does `const fail = verifyCronSecret(req); if (fail) return fail;` at the top before any work. Single point of truth for the auth check; one place to fix if Vercel's auth header format ever changes.
- **D-07:** All 5 crons wrap their helper call in `withLease(redis, name, ttlMs, fn)`. Even though Vercel cron is single-instance for the same schedule, this is defense-in-depth: if a fork ever runs on a non-Vercel target (Railway, Fly.io with multiple replicas), the lease prevents double-work. TTL = roughly `2 × maxDuration × 1000` so a stuck leader can't deadlock its peers indefinitely. With Redis env unset, `withLease` falls back to running `fn()` unconditionally — correct for single-instance dev.

### Batch sizing + maxDuration

- **D-08:** `outbox-drain` and `email-queue-drain` process up to **100 rows per invocation**. Matches the blocker note in PROJECT.md "Cron batch sizing: 100 rows/fire is the recommendation" and ROADMAP success criterion #3. If a real workload reaches that ceiling, the next planning iteration drops to 50 + raises `maxDuration`. Hard-code 100 as `BATCH_SIZE` constant in each cron route file (NOT env-configurable in v1 — env-configurability is a YAGNI hazard for a knob that almost never moves).
- **D-09:** Stuck-row PROCESSING reset window: **90 seconds** (matches ROADMAP success criterion #3). Rows where `status='PROCESSING' AND startedAt < now() - interval '90 seconds'` are reset to `PENDING` so they can be retried. Implement as the FIRST step inside the cron route, BEFORE the claim-and-process loop. Hard-code 90s; not env-configurable.
- **D-10:** `maxDuration` per route in `vercel.json`:
  - `outbox-drain`, `email-queue-drain`: **60s** (drain 100 rows + per-row email/notification dispatch can take 30–45s under load)
  - `verification-cleanup`, `order-expiration`, `webhook-log-purge`: **30s** (single deleteMany / updateMany — sub-second in practice)
- **D-11:** WebhookLog retention: env-configurable `WEBHOOK_LOG_RETENTION_DAYS` (default `90`), documented in `.env.example` next to `CRON_SECRET`. Compliance teams sometimes want 1y or 7y retention; this is the one knob worth exposing.

### `vercel.json` location + format

- **D-12:** File at `frontend/vercel.json` (Vercel project root is the `frontend/` workspace, not the repo root). Schema:
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
  Per-route `maxDuration` lives in each `route.ts` file via `export const maxDuration = N;` (Next.js 16 + Vercel auto-pick this up; per-route `maxDuration` in `vercel.json` is redundant when both are present).

### Verification-cleanup + order-expiration helpers

- **D-13:** `verification-cleanup` is a one-liner: `await prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date() } } })`. No new lib helper — the route does the deleteMany directly inside the lease. (If complexity grows, refactor to `lib/server/auth/verification-cleanup.ts` later.)
- **D-14:** `order-expiration` needs a small lib helper at `lib/server/orders/expire.ts` that finds `PENDING` orders older than `ORDER_EXPIRATION_MINUTES` (default 30, env) and updates them to `EXPIRED` in batches of `BATCH_SIZE` (100). Returns `{ expired: N }`. Reason: more than one query (find + update + emit notifications via outbox), worth its own testable surface.
- **D-15:** `webhook-log-purge` deletes `WebhookLog` rows older than `WEBHOOK_LOG_RETENTION_DAYS`: `await prisma.webhookLog.deleteMany({ where: { receivedAt: { lt: cutoff } } })`. Inline in the route — same rationale as D-13.

### Test strategy (TDD pattern from Phase 4)

- **D-16:** Same wave structure as Phase 4: **Wave 0** ships scaffolding (RED tests for all 6 routes + the `verifyCronSecret` helper + the Bictorys `WebhookProvider` implementation + `lib/server/orders/expire.ts` helper + `.env.example` blocks for `WEBHOOK_LOG_RETENTION_DAYS` and `ORDER_EXPIRATION_MINUTES`). **Wave 1** ships the 6 route handlers (1 webhook + 5 cron) in parallel worktrees.
- **D-17:** Test mocks for cron routes follow Phase 4's lessons learned: mock `requireAuth`-equivalent helpers to return `NextResponse` (not plain `Response`); use `NextRequest` (not plain `Request`) for any handler that reads `req.nextUrl`. The `verifyCronSecret` test must cover: missing `Authorization` header (401), wrong scheme (401), wrong secret (401), correct `Bearer ${CRON_SECRET}` (null = pass).
- **D-18:** Webhook handler tests exercise: valid HMAC + first delivery (200, `deduped:false`), valid HMAC + replay of same `(externalId, eventType)` (200, `deduped:true`, no second handler invocation), tampered body (401), expired `(now - eventTime) > replayWindowMs` (401), each event type dispatches the correct handler (`onPaid` / `onRefunded` / `onFailed`).
- **D-19:** Cron route tests exercise: 401 on missing/wrong secret (CRON-06), happy path returns `{ processed: N }` with N matching the lib helper's return value, lease coordination via mocked `withLease` (verify it was called with the correct name + ttl).
- **D-20:** `vercel.json` validation test: read the file, parse JSON, assert `crons` array length === 5, assert each entry has `path` matching `/^\/api\/cron\/[a-z-]+$/` and `schedule` matching cron-format regex, assert all 5 schedule paths correspond to existing `route.ts` files. This tripwire prevents the route-file/schedule mismatch regression class.

### Wave assignment + parallelization

- **D-21:** Wave 0 (one plan, sequential by nature): RED tests + helpers + fixtures. ~6–10 files, all in different paths from Wave 1 routes. Files include: `lib/server/cron/auth.ts`, `lib/server/webhook/bictorys.ts`, `lib/server/orders/expire.ts`, the 6 RED `route.test.ts` files, env-shape tripwire updates, `.env.example` block additions.
- **D-22:** Wave 1 (six parallel plans, no `files_modified` overlap): one plan per route + one plan for `vercel.json`. Routes write to `app/api/webhooks/bictorys/route.ts` and `app/api/cron/<name>/route.ts` (5 of those) — completely disjoint paths. The `vercel.json` plan touches only `frontend/vercel.json`. Per Phase 4's `files_modified` overlap detection, all 7 Wave 1 plans can run in parallel worktrees.
- **D-23:** Parallel-execution lessons from Phase 4 carry forward: each worktree branches from the captured `EXPECTED_BASE`, uses `--no-verify` for commits, never touches STATE.md / ROADMAP.md (orchestrator updates after merge-back). Test-route-contract drift (the 3 mock-shape bugs we hit at the end of Phase 4) is mitigated by D-17 / D-19 — Wave 0 tests use the canonical `NextResponse` / `NextRequest` shapes from day 1.

### Claude's Discretion

- Specific file naming inside `lib/server/cron/` (e.g., a single `auth.ts` is locked, but a future `lib/server/cron/index.ts` barrel export is at planner discretion).
- Logging verbosity inside cron routes — `log.info({ processed: N, durationMs })` once per drain is fine; per-row logs in the dispatcher already exist.
- Whether to add a `dynamic = 'force-dynamic'` export to cron routes (Next.js may cache `POST` responses by default — planner verifies via test).
- Sentry tag conventions for cron tick failures (e.g., `tag: cron, name: outbox-drain`) — pick what's discoverable in Sentry.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — vision + boundaries (Vercel-first, single-instance circuit breaker, "Non-Bictorys webhook providers" out-of-scope)
- `.planning/REQUIREMENTS.md` lines 86–97 — WH-01, WH-02, CRON-01..07 acceptance criteria
- `.planning/ROADMAP.md` Phase 5 block (lines ~89–105) — goal + success criteria
- `./CLAUDE.md` — invariants list: raw-body-before-json, runtime=nodejs, CRON_SECRET auth, outbox-not-closures

### Phase artifacts
- `.planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md` (this file)
- `.planning/phases/05-webhooks-and-vercel-cron/05-DISCUSSION-LOG.md` (audit trail)

### Battle-tested helpers (CALL ONLY — DO NOT MODIFY per CLAUDE.md)
- `frontend/src/lib/server/webhook/handler.ts` — `createWebhookHandler({...})` factory + `WebhookProvider<TPayload>` interface (lines 1–60 doc-comment is the spec)
- `frontend/src/lib/server/outbox/dispatcher.ts` — `drainOutbox(deps, batchSize)` + atomic per-row claim + 30s/2m/10m/30m/1h backoff (MAX_ATTEMPTS=5 → DEAD)
- `frontend/src/lib/server/leader-lease.ts` — `withLease(redis, name, ttlMs, fn)` with NX+EX semantics + holder-id guard + no-Redis fallback
- `frontend/src/lib/server/auth.ts` — `verifyCsrf` reference shape for `verifyCronSecret`
- `frontend/src/lib/server/middleware/index.ts` — `requireAuth` Context shape for any auth-equivalent helper

### Existing surfaces this phase plugs into
- `frontend/src/lib/server/payments/bictorys.ts` + `provider.ts` + `provider-singleton.ts` — Bictorys charge/payout API (the webhook just reads its env / signature secret)
- `frontend/src/lib/server/email/queue.ts` (path inferred from `outbox/dispatcher.ts` import of `../queues/email-queue`) — `EmailQueue` type + drain helper
- `frontend/src/lib/server/notifications/index.ts` — `createNotification` (called from outbox dispatcher; cron routes do NOT call directly)
- `frontend/src/app/api/admin/email-queue/`, `admin/outbox/` — Phase 3 admin endpoints; populated by THIS phase's drains; integration test asserts admin endpoints reflect cron activity
- `frontend/.env.example` — already has `CRON_SECRET=""` and `BICTORYS_WEBHOOK_SECRET=""` blocks (Phase 0 + Phase 4); this phase APPENDS `WEBHOOK_LOG_RETENTION_DAYS` and `ORDER_EXPIRATION_MINUTES`
- `frontend/src/lib/server/observability/env-shape.test.ts` — env-shape tripwire from Phase 0 / 4; Wave 0 of this phase appends 2 assertions

### Database tables this phase reads/writes
- `WebhookLog` — `@@unique([externalId, eventType])` from `prisma/schema.prisma`; webhook handler upserts; webhook-log-purge deletes by `receivedAt < cutoff`
- `OutboxEvent` — outbox-drain claims `PENDING` → updates to `SENT|DEAD`; webhook handlers enqueue inside their tx
- `EmailJob` — email-queue-drain claims and dispatches via `resend.emails.send()`
- `VerificationCode` — verification-cleanup deletes by `expiresAt < now()`
- `Order` — order-expiration updates `PENDING` rows older than `ORDER_EXPIRATION_MINUTES` to `EXPIRED`
- `Withdrawal` — outbox dispatcher already handles `WITHDRAWAL_*` outbox events (Phase 4 plugged in); this phase doesn't touch the table directly

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`createWebhookHandler` factory** at `frontend/src/lib/server/webhook/handler.ts` — does ALL the hard work (raw body, HMAC verify, Serializable tx, dedup, postCommit). The route file is ~10 lines: import factory, build provider, build event handlers, export `POST = createWebhookHandler({...})`.
- **`drainOutbox` dispatcher** — already implements per-row claim (UPDATE WHERE id=$1 AND status='PENDING' RETURNING id), backoff, DEAD-letter promotion. The cron route is ~5 lines: `withLease(redis, 'outbox-drain', 30000, () => drainOutbox({prisma, emailQueue}, 100))`.
- **`withLease` Redis lease helper** — single import; falls back to direct fn() call when Redis is undefined; perfect for the 5-cron coordination story.
- **`verifyCsrf` shape** at `frontend/src/lib/server/auth.ts` — the exact "return null on pass, NextResponse on fail" pattern to mirror in `verifyCronSecret`.
- **Phase 4 RED-test pattern** (3 `route.test.ts` files in `app/api/upload`, `files`, `withdrawals`) — copy-paste the mock structure (`vi.mock('@/lib/server/middleware', ...)` for auth-equivalent, `vi.mock('@/lib/server/prisma', ...)` for DB) and the `vi.stubEnv` lifecycle.
- **`r2-mock.ts` factory pattern** at `frontend/src/test-utils/r2-mock.ts` — model `bictorys-mock.ts` after this for the webhook test fixture (mocks the HMAC sig verify + canned payloads for paid/refunded/failed).

### Established Patterns

- **Lazy-init helpers (Phase 4 D-03 / 04-RESEARCH.md):** R2 client construction deferred to first call so env reads happen at request time, not module-top. Same pattern for any Redis/Bictorys-secret reads inside cron routes.
- **Stable error codes via `ApiError.code`:** Frontend never switches on the message. For cron + webhook routes, the response shape is `{ ok: true, processed: N }` or `{ ok: false, error: <code> }` — keep code names stable.
- **Env-shape tripwire (`env-shape.test.ts`):** Phase 0 introduced this; Phase 4 added 4 assertions for upload/withdrawal env. This phase adds 2 (`WEBHOOK_LOG_RETENTION_DAYS`, `ORDER_EXPIRATION_MINUTES`). The test reads `.env.example` and asserts substring presence of each declared key.
- **Outbox-not-closures invariant:** Webhooks emit side-effects via `enqueueOutbox(tx, {...})` inside the same tx; the cron drain picks them up later. THIS is what `createWebhookHandler`'s `postCommit` exists for legacy reasons but new code must NOT use.
- **Single-writer for STATE.md / ROADMAP.md in worktree mode (Phase 4 carry-forward):** Executor agents skip STATE/ROADMAP updates; orchestrator updates them once after merge-back. Same pattern this phase.

### Integration Points

- **Webhook → Outbox → Drain chain:** The webhook route's `onPaid` handler calls `enqueueOutbox(tx, { type: 'PAYMENT_RECEIVED', payload: {...} })` inside the Serializable tx; outbox-drain (cron) picks it up 1 minute later, calls `createNotification` + `EmailQueue.enqueue`. Integration test (deferred to Phase 6 if not feasible here) asserts the chain end-to-end.
- **Admin endpoints (Phase 3) → Cron routes (Phase 5):** `GET /api/admin/outbox` and `GET /api/admin/email-queue` show row status + counts. Manual UAT: run a webhook, watch the outbox row appear PENDING → drain → SENT in the admin UI. No new admin code in this phase — just proof that the cron actually moves rows.
- **`vercel.json` ↔ route file path matching:** A route at `app/api/cron/foo-bar/route.ts` requires a vercel.json entry at path `/api/cron/foo-bar`. The validation test (D-20) catches typos.
- **`CRON_SECRET` ↔ Vercel cron auth:** Vercel automatically attaches `Authorization: Bearer <CRON_SECRET-from-env>` to cron requests. Locally (next dev) the test or curl invocation must attach it manually. `.env.example` already has the placeholder + openssl-rand hint.

</code_context>

<specifics>
## Specific Ideas

- **Phase 4 deviation lesson:** The 3 RED-test/route contract bugs we hit (`auth instanceof NextResponse` vs plain Response; `req.nextUrl` vs `req.url`; `body.id` vs `body.withdrawalId`) cost a manual fix commit. For Phase 5, Wave 0 RED tests use the canonical NextResponse/NextRequest shapes from day 1 (D-17). The cron-auth helper test is the contract — anything that calls it gets the same shape for free.
- **Vercel cron caveat:** Vercel's `vercel.json` cron schedules use UTC. The 5-min `order-expiration` and 1-min drains are UTC-agnostic (they just fire on intervals). The hourly `verification-cleanup` and daily `webhook-log-purge` fire at the top of the UTC hour / midnight UTC respectively — that's fine for v1 since users span multiple timezones anyway.
- **Reference admin endpoints:** Phase 3 already shipped `GET /api/admin/outbox` and `GET /api/admin/email-queue`. Manual smoke test after Phase 5 ships: trigger a charge in dev, watch the outbox row flow PENDING → drained → SENT via the admin endpoint.
- **No new `lib/server/cron/` directory until needed:** Only the auth helper goes there in v1. If a fork ever wants a shared `withCronEnvelope(name, fn)` wrapper, refactor then — not now.

</specifics>

<deferred>
## Deferred Ideas

- **Distributed circuit breaker for cron-driven Bictorys calls** — outbox-drain may call `bictorys.charge()` indirectly (through notification email links or refund jobs). Phase 5 inherits the Phase 4 single-instance circuit breaker. A Redis-backed variant is a per-fork concern (PROJECT.md "Distributed payment circuit breaker" out-of-scope).
- **Multi-provider webhook scaffold (Stripe / Paddle / etc.)** — Already covered by `WebhookProvider<TPayload>` interface; forks add `app/api/webhooks/<provider>/route.ts` per-project. Not shipped in v1.
- **Cron-tick observability dashboard** — Sentry tags + log lines suffice for v1. A dedicated `/api/admin/cron-status` endpoint listing last-tick + duration per cron is a future phase if operators need it.
- **`OUTBOX_STUCK_RESET_SECONDS` env var** — Hard-coded 90s in v1 (D-09). Make env-configurable only when a real workload demands it.
- **Email rate-limit / send-quota tracking** — Resend has its own rate-limits; the email-queue drain inherits them. A dedicated retry/quota table is a future concern.
- **Cron retry / dead-letter alerting** — `OutboxEvent.status='DEAD'` is queryable via Phase 3's admin/outbox endpoint. Sentry alerts for DEAD-letter promotion = future ops work.

</deferred>

---

*Phase: 05-webhooks-and-vercel-cron*
*Context gathered: 2026-05-08*
