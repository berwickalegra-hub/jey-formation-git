# Phase 5: Webhooks and Vercel Cron - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 05-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 05-webhooks-and-vercel-cron
**Mode:** Auto (no interactive Q&A; Claude selected recommended option for each gray area based on prior decisions, CLAUDE.md invariants, ROADMAP success criteria, and Phase 4 patterns)
**Areas discussed:** Webhook handler structure, Cron route layout + auth, Batch sizing + maxDuration, vercel.json schema, Verification-cleanup + order-expiration helpers, Test strategy, Wave assignment

---

## Webhook handler structure

| Option | Description | Selected |
|--------|-------------|----------|
| Bictorys-only route, provider impl in `lib/server/webhook/bictorys.ts` | Single inbound webhook for v1; provider impl colocated with handler factory | ✓ |
| Bictorys-only route, provider impl in `lib/server/payments/webhook.ts` | Group all Bictorys API surfaces (charge + payout + webhook) under `payments/` | |
| Multi-provider scaffold (Stripe + Paddle template files) | Ship empty templates for future providers | |

**Notes:** PROJECT.md explicitly defers non-Bictorys webhook providers (per-project concern). Splitting `payments/bictorys.ts` (charge/payout) from `webhook/bictorys.ts` (HMAC verifier + parser) keeps two cohesive surfaces — the webhook namespace is a clean home for "all things inbound + signed".

---

## Webhook side-effect dispatch

| Option | Description | Selected |
|--------|-------------|----------|
| Outbox via `enqueueOutbox(tx, event)` inside the Serializable tx | CLAUDE.md invariant; cron drain picks up later | ✓ |
| Direct `createNotification` call inside `onPaid` handler | Simpler but loses retry semantics | |
| `postCommit` closure on the handler factory | Legacy API; CLAUDE.md says new code must NOT use it | |

**Notes:** Locked by CLAUDE.md ("Webhook handlers emit side-effects via the **outbox** (`enqueueOutbox(tx, event)` inside the tx) — never via fire-and-forget closures").

---

## Replay window source

| Option | Description | Selected |
|--------|-------------|----------|
| Env `BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` (default 60000) | Already documented in CLAUDE.md; matches `createWebhookHandler` factory API | ✓ |
| Hard-coded 60s | Less flexible | |

**Notes:** Already established by CLAUDE.md and the factory contract.

---

## Cron route layout

| Option | Description | Selected |
|--------|-------------|----------|
| One route file per cron at `app/api/cron/<name>/route.ts` | Matches CLAUDE.md guidance; each cron is independently editable + testable | ✓ |
| Single dispatcher at `app/api/cron/route.ts?job=<name>` | Fewer files but couples all crons; vercel.json gets noisy | |

**Notes:** CLAUDE.md cron strategy section is explicit: "Background work runs as **Vercel Cron** routes under `app/api/cron/<name>/route.ts`".

---

## Cron auth helper

| Option | Description | Selected |
|--------|-------------|----------|
| Shared `verifyCronSecret(req): NextResponse \| null` at `lib/server/cron/auth.ts` | Same pattern as `verifyCsrf`; one place to fix if header format ever changes | ✓ |
| Inline `if (req.headers.get('authorization') !== 'Bearer ' + process.env.CRON_SECRET)` per route | Trivially simple but duplicated 5×; constant-time compare gets re-implemented poorly | |
| Middleware HOF (`requireCronAuth`) returning a Context | Overkill — no Context needed; just pass/fail | |

**Notes:** Phase 4 RED-test/route contract bugs taught us the value of shared shape contracts. Single helper makes the test contract obvious.

---

## Multi-instance coordination (`withLease`)

| Option | Description | Selected |
|--------|-------------|----------|
| Apply `withLease` to all 5 crons | Defense-in-depth; covers non-Vercel deploys (Railway/Fly with replicas) | ✓ |
| Skip `withLease` (Vercel cron is single-instance per schedule) | Simpler but tied to Vercel | |
| Apply only to high-frequency crons (1-min drains) | Inconsistent; arbitrary cutoff | |

**Notes:** `withLease` falls back to direct `fn()` call when Redis env is unset, so single-instance dev pays nothing. PROJECT.md acknowledges "self-host can still wire a worker later" — the lease wrapper makes that path frictionless.

---

## Batch size

| Option | Description | Selected |
|--------|-------------|----------|
| 100 rows/fire (hard-coded) | Matches PROJECT.md blocker note + ROADMAP success criterion #3 | ✓ |
| Env-configurable `OUTBOX_BATCH_SIZE` (default 100) | Premature flexibility | |
| 50 rows/fire | Conservative but slower under load | |

**Notes:** PROJECT.md: "Cron batch sizing: 100 rows/fire is the recommendation. If email-drain timeouts at 100, reduce to 50 and increase `maxDuration`. Validate in Phase 5." We follow the recommendation; if it breaks under load, the next planning iteration drops it.

---

## Stuck-row PROCESSING reset window

| Option | Description | Selected |
|--------|-------------|----------|
| 90 seconds (hard-coded) | Matches ROADMAP success criterion #3 verbatim | ✓ |
| 60 seconds | Tighter but more false-positive resets | |
| 5 minutes | Safer but allows real stuck rows to linger | |

**Notes:** Locked by ROADMAP. Hard-coded constant, not env (D-09).

---

## maxDuration per route

| Option | Description | Selected |
|--------|-------------|----------|
| Drains 60s, light crons 30s | Matches CRON-01/02 spec ("maxDuration = 60") + reasonable headroom for the others | ✓ |
| All routes 60s | Wasteful for the deleteMany routes | |
| All routes 30s | Risk of timeout on email-drain under load | |

**Notes:** REQUIREMENTS.md CRON-01 / CRON-02 explicitly say `maxDuration = 60`. The other 3 are sub-second deleteMany / updateMany — 30s is plenty.

---

## WebhookLog retention

| Option | Description | Selected |
|--------|-------------|----------|
| Env `WEBHOOK_LOG_RETENTION_DAYS` (default 90) | Compliance teams sometimes want 1y or 7y | ✓ |
| Hard-coded 90 days | Less flexible | |
| Hard-coded 30 days | Tight; dev/staging would lose audit history | |

**Notes:** This is the one knob worth exposing — webhook log retention is a compliance question with answers that vary per industry.

---

## `vercel.json` location

| Option | Description | Selected |
|--------|-------------|----------|
| `frontend/vercel.json` | Vercel project root is the `frontend/` workspace | ✓ |
| Repo root `vercel.json` | Wrong — Vercel won't find it from the workspace | |

**Notes:** No real choice; just document the location explicitly so the planner doesn't put it at repo root.

---

## `vercel.json` schedule format

| Option | Description | Selected |
|--------|-------------|----------|
| Cron expressions per ROADMAP success criterion #4 + REQUIREMENTS.md CRON-07 | Matches the spec | ✓ |
| Per-route `maxDuration` in `vercel.json` (in addition to `route.ts`) | Redundant; Next.js 16 picks up `export const maxDuration` from the route | |

**Notes:** The 5 schedules: 1-min, 1-min, hourly, 5-min, daily. `maxDuration` lives in route files via `export const maxDuration = N;`.

---

## `verification-cleanup` + `order-expiration` helper layout

| Option | Description | Selected |
|--------|-------------|----------|
| `verification-cleanup` inline (one-liner deleteMany); `order-expiration` in `lib/server/orders/expire.ts` | Matches complexity: deleteMany doesn't deserve a file, but find+update+notify-via-outbox does | ✓ |
| Both inline | Loses testability for order-expiration's outbox-notify branch | |
| Both in lib helpers | Over-engineering for the one-liner | |

**Notes:** Asymmetric by design — file count tracks complexity, not consistency.

---

## Test strategy (RED tests + waves)

| Option | Description | Selected |
|--------|-------------|----------|
| Wave 0 RED tests + helpers; Wave 1 = 6 routes + vercel.json in parallel | Mirrors Phase 4 successful pattern | ✓ |
| Sequential: helpers → tests → routes one-by-one | Slower; loses parallelism | |
| Tests inline with routes (no Wave 0) | Loses the "test contract = locked" property | |

**Notes:** Phase 4's 4-plan parallel run shipped in ~10 minutes wall-clock; same template here. The contract-mismatch bugs we hit in Phase 4 are mitigated upstream by D-17 / D-19 (canonical NextResponse/NextRequest shapes from day 1).

---

## `vercel.json` validation tripwire

| Option | Description | Selected |
|--------|-------------|----------|
| Test reads vercel.json + asserts shape + cross-checks each path against existing route.ts files | Catches typos + drift between schedule and route | ✓ |
| No test (rely on Vercel deploy errors) | Fails too late; deploy-time only | |
| Schema validation only (no path cross-check) | Misses the "schedule fires but route doesn't exist" case | |

**Notes:** This is the kind of regression that's silent until production cron stops firing. Cheap test, big payoff.

---

## Order-expiration retention window

| Option | Description | Selected |
|--------|-------------|----------|
| Env `ORDER_EXPIRATION_MINUTES` (default 30) | Different industries want different windows (food delivery: 5 min; wholesale: hours) | ✓ |
| Hard-coded 30 min | Less flexible | |
| Hard-coded 24h | Too long for most flows | |

**Notes:** Marketplace forks may want 5–15 min; SaaS forks may want 24h. Env knob lets each fork pick.

---

## Claude's Discretion

- Specific naming inside `lib/server/cron/` beyond `auth.ts` (e.g., barrel exports).
- Cron-route logging verbosity beyond a per-drain summary.
- Whether to add `export const dynamic = 'force-dynamic'` to cron routes (Next.js may default-cache POST responses; planner verifies via test).
- Sentry tag conventions for cron failures.

## Deferred Ideas

- Distributed circuit breaker for outbound Bictorys calls from cron (per-fork concern per PROJECT.md).
- Multi-provider webhook scaffolding (Stripe / Paddle / etc.) — `WebhookProvider<TPayload>` interface already covers it; forks add per-project routes.
- `/api/admin/cron-status` endpoint with last-tick + duration per cron (future ops work).
- `OUTBOX_STUCK_RESET_SECONDS` env var (hard-coded 90s in v1).
- Email rate-limit / send-quota tracking beyond what Resend provides.
- Sentry alerting for `OutboxEvent.status='DEAD'` promotions (Phase 3 admin endpoint already exposes the rows for manual triage).

---

*Auto-mode rationale:* User invoked `/gsd-discuss-phase 5` while harness auto-mode was active and asked for autonomous execution. Phase 5 has unusually few genuine gray areas because architecture is fully predetermined by CLAUDE.md invariants (raw-body, runtime=nodejs, CRON_SECRET, outbox-not-closures), the battle-tested helpers (`createWebhookHandler`, `drainOutbox`, `withLease` — call-only, never modify), the ROADMAP success criteria (90s reset, 100 rows, vercel.json shape), and Phase 4's parallel-worktree TDD pattern. The decisions above are the obvious ones; any deviation is for the planner to surface before execution.
