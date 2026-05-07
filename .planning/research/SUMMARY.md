# Project Research Summary

**Project:** amadou-monolith
**Domain:** Brownfield port — Express 5 + Next.js 16 monorepo → single Next.js 16 App Router monolith on Vercel
**Researched:** 2026-05-07
**Confidence:** HIGH

## Executive Summary

This is a precision port, not a greenfield build. The feature surface is fully defined by `amadou-template`; the research task was to verify every assumption that changes when you remove the Express process and replace it with Next.js App Router route handlers on Vercel. The verdict: the port is architecturally sound and the patterns translate cleanly, but three classes of invisible regressions must be eliminated before any route lands — the Neon pooled URL convention must be committed to `DATABASE_URL` and `schema.prisma` before M3 begins, or auth routes will exhaust database connections under moderate load; every route file must export `export const runtime = 'nodejs'` before any other logic, or Prisma/bcrypt/Buffer silently break in Vercel's edge environment; and `instrumentation.ts` must export `onRequestError` from `@sentry/nextjs`, or unhandled route errors will not be captured by Sentry in Next.js 15+.

The M3–M8 phase structure in STATUS.md is correct and needs only one shape change: M5 has significant internal parallelism. Admin + orgs + orders share no code with upload + files + withdrawals and can be ported as two independent sub-sessions. The most time-critical sub-session is withdrawals (financial-critical, depends on M4 PIN routes) and should close M5 rather than lead it. M6 crons require two invariants beyond what STATUS.md states: batch size must be 100 rows per fire (not 1), and every drain must include a stuck-PROCESSING-row reset to recover from timeout-cut transactions.

Six features are missing from the current template surface but are expected by 2026 peers: admin outbox/queue visibility endpoints, structured request ID logging, OTel via `@vercel/otel`, env-based feature flags, email magic links, and rate-limit hit counters. The first four are low-complexity with zero new dependencies and disproportionate operational value. The user must decide before requirements lock whether these are in-scope for v1 — each adds less than half a day of work. Passkeys, TOTP, and subscription enforcement are out of scope for v1.

---

## Key Findings

### Recommended Stack

Stack is locked — no swaps in v1. All versions verified against official docs. Two hard do-not-upgrade calls: **Prisma 5.22 not 6/7** (Prisma 7 is ESM-only + required driver adapters + `prisma.config.ts` — a full rewrite, not an upgrade) and **Vitest 2.1.8 not 3** (Vite 6 peer dep churn with no benefit for Node-only lib tests).

The one active configuration decision is the Neon connection URL format. STACK.md says no `?pgbouncer=true` needed since Prisma 5.10; PITFALLS.md (Pitfall 9) says use `-pooler` hostname with `?pgbouncer=true&connection_limit=1`. PITFALLS.md wins for serverless — it cites Neon official docs directly. Use the `-pooler` hostname variant with `connection_limit=1`, and add `DIRECT_URL` (non-pooled) to `schema.prisma` for migrations only.

**Core technologies (all keep existing locked versions):**
- Next.js 16.1.6 + React 19.2.3 — App Router monolith; all routes `export const runtime = 'nodejs'`
- Prisma 5.22 — ORM; pooled `-pooler` URL at runtime, `directUrl` for migrations
- Upstash Redis — HTTP-based, serverless-safe; null-fallback on all call sites
- `@sentry/nextjs` 10.51 — boots via `instrumentation.ts`; must export `onRequestError`
- Vercel Cron — replaces `setInterval` loops; min interval 1 min; gated by `CRON_SECRET`

**Critical configuration to commit before M3:**
- `DATABASE_URL` must use the `-pooler` Neon hostname with `?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`
- `DIRECT_URL` (non-pooled) added to `schema.prisma` datasource for migrations only
- `CRON_SECRET` added to `.env.example` with `openssl rand -base64 32` hint

### Expected Features

The "already shipped" list in FEATURES.md is the entire M3–M8 port scope. Six gap features require a scope decision before requirements lock.

**Must have (table stakes — already shipped, confirm only via port):**
- Enumeration-resistant auth (signup/verify-email cookie split), Google OAuth PKCE, access+refresh+CSRF cookie triple
- Withdrawal advisory-lock + Serializable tx, Bictorys PaymentProvider, webhook HMAC idempotency
- Outbox + crons, R2 uploads with magic-byte sniff, notifications with dedup, admin audit trail

**Missing table stakes — decision owed (low complexity, high value):**
- Admin outbox + email-queue visibility endpoints — zero new models, direct Prisma queries, < 2h
- Structured request ID logging — AsyncLocalStorage + Pino, ~3h, hardest to retrofit later
- OTel via `@vercel/otel` in `instrumentation.ts` — 15 lines, < 1h, Vercel-native
- Env-based feature flags (`lib/server/flags.ts`) — 40 lines, ~1h, zero new deps

**Defer to per-project (decision final):**
- Email magic links — medium effort; content + internal profiles benefit but not parity-blocking
- Passkeys/WebAuthn — fintech value but per-project enforcement semantics differ
- Rate-limit hit counters — useful for abuse detection, not parity-blocking
- TOTP/2FA, subscription enforcement, Stripe adapter, i18n — explicitly out of scope

**Anti-features (do not build):**
- Stripe as default payment provider — geography mismatch; `PaymentProvider` interface is the escape hatch
- UI component library — headless by design
- Long-running worker process — contradicts Vercel-first constraint
- Managed feature flag services (LaunchDarkly, PostHog) — unnecessary dep for a starter

### Architecture Approach

The App Router architecture maps cleanly to the Express architecture. Route handlers replace Express routers; HOF guard composition (`verifyCsrf` → `requireAuth` → body parse → domain lib call → `NextResponse`) replaces Express middleware chains. `lib/server/` is the server-only boundary enforced by `import 'server-only'` at `prisma.ts` and `auth.ts`. `middleware.ts` runs on edge runtime and does redirect-only — never a security boundary. All 50+ API routes must carry `export const runtime = 'nodejs'`.

**Major components:**
1. `app/api/**/route.ts` — thin HTTP entry points; guard composition + `NextResponse`; no business logic inline
2. `lib/server/middleware/` — HOF guards returning typed context or `NextResponse` error
3. `lib/server/{domain}/` — stateless domain libs; `payments/`, `withdrawals/`, `oauth/`, `outbox/`, `webhook/`, `notifications/`, `admin/`, `upload/`
4. `lib/server/{singletons}/` — `prisma.ts` (globalThis guard), `redis.ts` (null fallback), `auth.ts`, `logger.ts`
5. `app/api/cron/*` — Vercel Cron route handlers; CRON_SECRET bearer check; drain 100 rows/invocation; stuck-row reset
6. `instrumentation.ts` — Sentry init + `onRequestError` export; first to load

**Key patterns (non-negotiable):**
- `req.arrayBuffer()` before any body access in webhook routes
- `enqueueOutbox(tx, event)` inside the same Serializable tx as the webhook handler
- `pg_advisory_xact_lock(hashtext(userId))` inside the Serializable tx for withdrawals
- `export const runtime = 'nodejs'` at the top of every file under `app/api/`
- `export const dynamic = 'force-dynamic'` on all webhook and cron routes

### Critical Pitfalls

All pitfalls below are HIGH confidence, verified against official sources.

1. **Missing `-pooler` URL before M3** — Auth routes exhaust Neon connection ceiling at ~50 concurrent requests. Fix is the pooled hostname + `connection_limit=1` in `DATABASE_URL`. Must precede the first route landing.

2. **`req.json()` before HMAC in webhook handler** — Consumes the body stream; HMAC never matches real Bictorys signatures; all payments silently unconfirmed. Never deserialize before `createWebhookHandler()`. No global enforcement in App Router — must be enforced by code structure.

3. **`export const runtime = 'nodejs'` missing from any route** — Prisma/bcrypt/Buffer undefined on Vercel edge. Add to every route file as the first export. CI grep: `grep -r "runtime = 'edge'" src/app/api/ && exit 1`.

4. **`onRequestError` missing from `instrumentation.ts`** — Unhandled route errors not captured by Sentry in Next.js 15+. Add `export { onRequestError } from '@sentry/nextjs'`.

5. **Outbox cron batch size = 1** — At 1 min Vercel Cron intervals, single-row drain builds unbounded backlog under load. Set `batchSize: 100`. Add stuck-PROCESSING-row reset at top of each drain (rows `claimedAt < now - 90s` → reset to PENDING).

6. **Withdrawal double-spend: advisory lock outside Serializable tx** — Copy `withdrawalLock(userId)` verbatim; never separate the balance read from the INSERT.

7. **`prisma migrate deploy` in Vercel build script** — Runs migration against prod DB while old code still serves; keep build as `prisma generate && next build` only.

8. **Doc drift: CLAUDE.md still describes Express patterns** — Treat DOC-01 (M7) as a hard deliverable, not polish. Stale Express-pattern docs cause security regressions in future forks.

---

## Implications for Roadmap

The M3–M8 shape from STATUS.md is correct with the following refinements.

### Pre-M3 Prerequisite (no phase, < 1 hour)

**Rationale:** Two configuration commits must land before any route handler runs on Neon; fixing them later requires env var changes across Vercel + local `.env`.

**Actions:**
- Commit pooled `DATABASE_URL` format + `DIRECT_URL` to `schema.prisma` datasource
- Add `CRON_SECRET` to `.env.example` with generation hint
- Add `export { onRequestError } from '@sentry/nextjs'` to `instrumentation.ts`
- Add CI grep blocking `runtime = 'edge'` in `app/api/`
- Remove `experimental.instrumentationHook` from `next.config.ts` if present (deprecated since Next.js 15)

### M3 — Auth Routes

**Rationale:** Highest-frequency route group, highest security surface, everything else depends on `requireAuth`. Port first to validate guard infrastructure.

**Delivers:** 9 auth endpoints (signup through change-password); per-email rate limits; enumeration resistance.

**Avoids:** Pitfall 3 (runtime), Pitfall 9 (connection pool), M4 refresh cookie path-scoping (set `path: '/api/auth'` on refresh token explicitly).

**No parallelism** — all 9 routes share auth lib infrastructure; port sequentially to catch shared state bugs early.

### M4 — Simple Routes (OAuth, Notifications, WithdrawalPin)

**Rationale:** OAuth callback must exist before M5 can use Google-authed sessions. WithdrawalPin must exist before M5 Withdrawals (PIN guard dependency).

**Delivers:** Google OAuth start+callback; notifications list/count/prefs; withdrawal-pin CRUD.

**Avoids:** Pitfall 10 (OAuth state/PKCE cookie path must be `/api/auth/oauth`, not `/`). Refuse `email_verified !== true` verbatim.

**Internal parallelism:** OAuth, notification, and withdrawal-pin routes are mutually independent.

### M5 — Heavy Routes (two sub-sessions)

**Rationale:** M5 is 1,247 lines across 6 files. Splitting into sub-sessions maintains quality and isolates financial-critical withdrawal work.

**Sub-session A (admin + orgs + orders):** Standard HOF + Prisma patterns, no financial-critical invariants.
- Admin: 9 endpoints; every mutation calls `logAdminAction` (Pitfall N4)
- Orgs: 8 endpoints; non-members get 404 not 403
- Orders: circuit breaker is in-memory per-instance — document as known limitation

**Sub-session B (upload + files + withdrawals):** Financial-critical and body-handling complexity.
- Upload: replace multer with `req.formData()` + magic-byte sniff; document 4.5 MB Vercel limit; presigned URL path for files > 4 MB
- Files: R2 stream proxy
- Withdrawals: copy `withdrawalLock(userId)` verbatim; never refactor the tx pattern (Pitfall 5)

**Avoids:** Pitfall 5 (double-spend), Pitfall 11 (upload 413), Pitfall N1 (Bictorys key direction), Pitfall N2 (WITHDRAWAL_BALANCE_CHECK prod guard), Pitfall N3 (integer amounts).

### M6 — Webhooks + Vercel Cron

**Rationale:** Depends on orders route existing (webhook `onPaid` updates orders). Cron routes are independent of each other.

**Delivers:** Bictorys webhook route; 5 cron handlers; `vercel.json` with schedule entries.

**Critical invariants for this phase:**
- Webhook: `createWebhookHandler()` is the POST export directly; no `req.json()` before it (Pitfall 1)
- Crons: `batchSize: 100`; stuck-PROCESSING reset at top; `timingSafeEqual` for CRON_SECRET comparison
- `export const maxDuration = 60` on email-drain cron (Resend calls × 100 can approach 10s default timeout)

**Internal parallelism:** All 5 cron routes and the webhook route are mutually independent.

### M7 — Scripts, Tests, Docker, Docs

**Rationale:** All routes must be stable before tests reference them. DOC-01 is a hard deliverable.

**Delivers:** Vitest config + 18 test files ported; scripts; Dockerfile; updated docker-compose (drop `backend` service); rewritten CLAUDE.md + README.md.

**Critical:** DOC-01 rewrite must eliminate all Express-pattern references and replace with App Router equivalents. Also fix `withSentryConfig` shape for Sentry 10.x: add `release.name`, `sourcemaps.deleteSourcemapsAfterUpload`; remove any `sentry:` key from `nextConfig` (Pitfall M2).

**Internal parallelism:** Scripts, Dockerfile, docker-compose, and docs are mutually independent.

### M8 — Final Pass

`pnpm install && pnpm format && pnpm lint && pnpm typecheck && pnpm test` all green. Tag v1.

### Phase Ordering Rationale

- Pre-M3 config prevents connection exhaustion from being a latent production risk discovered after all routes are wired.
- M3 before M4 because OAuth and notification routes import HOFs that `requireAuth` exercises — a bug in auth surfaces immediately.
- M4 before M5-B because `withdrawals/route.ts` uses the PIN guard, which requires the withdrawal-pin route for integration testing.
- M5-A before M5-B because admin routes are simpler and validate `requireAdmin` HOF before financial-critical withdrawal code touches the same guard infrastructure.
- M6 after M5 because `onPaid` callback references the orders table.
- M7 after M6 so tests cover the full route surface.

### Highest-Leverage Early Actions (Top 5)

Doing these before M3 prevents the most expensive rework later:

1. **Commit Neon pooled URL convention** — prevents connection exhaustion from ever being a latent bug; costs < 5 minutes
2. **Add `export const runtime = 'nodejs'` lint rule** — prevents any route accidentally slipping to edge; costs < 15 minutes
3. **Fix `instrumentation.ts` with `onRequestError` export** — ensures all unhandled errors are captured from the first route onward; costs < 5 minutes
4. **Remove `experimental.instrumentationHook` from `next.config.ts`** — deprecated since Next.js 15; causes a warning on every build; costs < 2 minutes
5. **Decide scope of 6 missing table-stakes features** — admin visibility + request ID logging + OTel + feature flags are easiest to wire during M3/M4 than retrofit; deferring them adds rework

### Research Flags

Phases with standard patterns (skip additional research):
- **Pre-M3 config** — exact URL format verified against Neon + Prisma official docs
- **M3** — HOF guard pattern established; auth lib already ported and typechecks
- **M4** — arctic PKCE pattern already in `lib/server/oauth/google.ts`
- **M5-A** — standard CRUD + audit pattern
- **M6** — `createWebhookHandler` already ported; Vercel Cron docs verified
- **M7** — standard test/docker/doc work
- **M8** — CI gate pass

Phases that may need spot research during planning:
- **M5-B (upload)** — if any target profile needs > 4 MB uploads, research R2 presigned PUT pattern before writing the route (the 4.5 MB Vercel body limit is a hard architectural branch point)
- **M5-B (withdrawals)** — if KYC/tier guards are added to `withdrawals/guards.ts` beyond shipped stubs, research specific guard semantics before adding them

### Scope Decision Required Before Requirements Lock

| Feature | Est. Effort | Suggested Phase | Risk if Deferred |
|---------|-------------|-----------------|-----------------|
| Admin outbox + email-queue visibility | < 2h | M5-A | No operational visibility into silent failures |
| Structured request ID logging | ~3h | M3 | Hard to retrofit; log lines added later lack requestId |
| OTel via `@vercel/otel` | < 1h | Pre-M3 or M3 | No trace data until added |
| Env-based feature flags | ~1h | M3 or M4 | No kill switch in v1 forks |
| Email magic links | ~4h | M4 | Content + internal profiles lack passwordless |
| Rate-limit hit counters | ~2h | M5-A or M6 | No abuse visibility |

Recommendation: include the first four in v1 (operational hygiene every fork benefits from immediately); defer magic links and rate-limit counters to per-project if timeline is constrained.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All version pins verified against official docs; one conflict resolved (Neon URL format — PITFALLS.md wins) |
| Features | MEDIUM-HIGH | Already-shipped features are code-verified; gap features are pattern-inferred from 2026 ecosystem analysis |
| Architecture | HIGH | App Router patterns verified against Next.js + Vercel official docs; existing lib already validates the approach |
| Pitfalls | HIGH | All critical pitfalls verified against official docs; financial-critical ones corroborated by multiple sources |

**Overall confidence:** HIGH

### Gaps to Address

- **Neon URL conflict (STACK vs PITFALLS):** Resolved — use PITFALLS.md prescription (pooler hostname + `connection_limit=1`) for serverless. Validate at M3 start by checking Neon dashboard connection count under load.

- **Cron batch sizing:** 100 rows/fire is the research recommendation but actual throughput depends on Resend API latency. If email drain consistently times out at 100, reduce to 50 and add `maxDuration = 60`. Validate in M6.

- **Magic link scope:** If the starter prioritizes content + internal profiles, include in M4 (minimal code change, reuses VerificationCode with `type: MAGIC_LINK`). Decision must happen before M4 planning.

- **Prisma 7 migration path:** Out of scope for v1 by explicit decision. Flag in M8 docs as a separate post-v1 milestone.

---

## Sources

### Primary (HIGH confidence)
- Neon + Prisma connection guide: https://neon.com/docs/guides/prisma
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Vercel Functions Limitations: https://vercel.com/docs/functions/limitations
- Next.js Route Segment Config: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- Next.js security model (middleware): https://nextjs.org/blog/security-nextjs-server-components-actions
- Sentry Next.js manual setup: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
- Sentry v8 to v9 migration: https://docs.sentry.io/platforms/javascript/guides/nextjs/migration/v8-to-v9/
- Next.js cookies() API: https://nextjs.org/docs/app/api-reference/functions/cookies
- Prisma upgrade to v7: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
- CVE-2025-29927 postmortem: https://vercel.com/blog/postmortem-on-next-js-middleware-bypass
- Next.js OTel guide: https://nextjs.org/docs/app/guides/open-telemetry
- Auth.js passkey provider: https://authjs.dev/getting-started/providers/passkey

### Secondary (MEDIUM confidence)
- Next.js 16 upgrade guide: https://nextjs.org/docs/app/guides/upgrading/version-16
- Vitest 3 release notes: https://vitest.dev/blog/vitest-3
- Neon cold start + connection latency: https://neon.com/docs/connect/connection-latency
- Prisma deploy to Vercel: https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel

### Tertiary (LOW confidence)
- T3 Stack 2026 positioning: https://starterpick.com/blog/t3-stack-2026
- Makerkit/supastarter feature comparison: https://supastarter.dev/supastarter-vs-makerkit

---

*Research completed: 2026-05-07*
*Ready for roadmap: yes*
