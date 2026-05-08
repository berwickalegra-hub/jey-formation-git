# amadou-monolith

## What This Is

A personal, headless Next.js 16 monolith starter that ports the full feature surface of [`amadou-template`](../amadou-template) (auth + OAuth, payments, withdrawals, admin back-office, multi-tenancy, webhooks, outbox, notifications, uploads, audit log) into a **single Next.js App Router app** instead of separate Express backend + Next frontend. Optimized for Vercel-first deployment, with crons running as scheduled route handlers instead of a long-running worker process. Reusable across all of my future projects (SaaS, marketplaces/fintech, content apps, internal tools/MVPs).

## Core Value

Cloning this repo and filling in `.env` produces a working Next.js app on Vercel with the **same security invariants and feature parity as `amadou-template`** — auth, payments, admin, webhooks, crons all wired, headless and ready to graft a UI on top. Time-to-shipping a new product should drop from "weeks of plumbing" to "an evening of `git clone` + product code."

## Requirements

### Validated

<!-- Inferred from existing code at the M1–M2 scaffold checkpoint (commits 509fede → 81409a1, see STATUS.md). -->

- ✓ **STACK-01**: Next.js 16 App Router on Node.js runtime, TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, Prisma 5, Tailwind 4, Vitest, ESLint 9 flat config, Prettier — existing
- ✓ **DB-01**: Prisma schema covers all generic domain models — `User`, `OAuthAccount`, `VerificationCode`, `AdminAction`, `Organization`, `OrganizationMember`, `Order`, `Withdrawal`, `FileUpload`, `Notification`, `EmailJob`, `OutboxEvent`, `WebhookLog` — with 4 migrations applied — existing
- ✓ **LIB-01**: `lib/server/` ports the load-bearing modules — `auth`, `crypto`, `redis` singleton (returns `null` when env missing), `rate-limit-store` with `MemoryRateLimitStore` dev fallback, `webhook/handler` (raw-body HMAC preserved via `req.arrayBuffer()`), `sentry` shim, `oauth/google`, `outbox/dispatcher`, `withdrawals/lock`, `payments` interface + Bictorys, `notifications/createNotification`, `admin/audit` — existing
- ✓ **MW-01**: HOF middleware — `requireAuth`, `requireAdmin`, `requireSuperadmin`, `requireOrgRole`, `optionalAuth`, `verifyCsrf`, `createEmailLimiter` — existing
- ✓ **OBS-01**: Sentry boots via `frontend/instrumentation.ts` (env-gated no-op without `SENTRY_DSN`) — existing
- ✓ **HEALTH-01**: `/api/health` (liveness) and `/api/readyz` (DB + Redis probes, 1.5s timeout, 503 on failure) routes wired — existing

#### Validated in Phase 0 (Foundation, 2026-05-07)

- ✓ **OPS-01**: `DATABASE_URL` Neon `-pooler` host + `DIRECT_URL` for migrations documented in `.env.example`; `directUrl = env("DIRECT_URL")` declared in `prisma/schema.prisma` — Phase 0
- ✓ **OPS-02**: Every `app/api/**/route.ts` exports `runtime = 'nodejs'`; CI grep guard test (Vitest + fast-glob) prevents regression — Phase 0
- ✓ **OPS-03**: `instrumentation.ts` re-exports `onRequestError` from `@sentry/nextjs` — unhandled route errors auto-captured — Phase 0
- ✓ **OPS-04**: `CRON_SECRET` documented in `.env.example` with `openssl rand -base64 32` hint — Phase 0
- ✓ **OPS-05**: `next.config.ts` confirmed clean of deprecated `experimental.instrumentationHook` (test-locked) — Phase 0
- ✓ **OBS-04**: `lib/server/observability/request-context.ts` (AsyncLocalStorage + UUID generation + inbound `X-Request-Id` validation) and `log.ts` wrapper (injects `requestId` into log context without modifying `lib/server/logger.ts`) — Phase 0; per-route `X-Request-Id` response header lands in Phase 1+
- ✓ **OBS-05**: `@vercel/otel` `registerOTel({ serviceName: 'amadou-monolith' })` in `instrumentation.ts`, coexists with Sentry — Phase 0

#### Validated in Phase 1 (Auth Routes)

- ✓ **AUTH-01**: All 9 auth routes shipped under `frontend/src/app/api/auth/*/route.ts` — `signup` (enumeration-resistant), `login` (per-email rate limit + lockout), `logout`, `refresh` (path-scoped), `me`, `verify-email` (issues cookies), `forgot-password`, `reset-password`, `change-password`. Lib helpers: banned-passwords, HIBP k-anonymity, lockout (Redis sliding-window + memory fallback), refresh-lock (SETNX + Lua release), dummy-bcrypt, email-templates. 140/140 tests green at phase close.

#### Validated in Phase 2 (OAuth, Notifications, Withdrawal-PIN, 2026-05-08)

- ✓ **AUTH-02**: Google OAuth `start` + `callback` routes shipped at `frontend/src/app/api/auth/oauth/google/{start,callback}/route.ts` — state + PKCE cookies path-scoped to `/api/auth/oauth` (5min TTL), callback refuses `email_verified !== true` (account-takeover guard), find-or-create with email-based account linking (D-01), welcome notification dispatched via `createNotification` (D-03 + NOTIF-05 invariant)
- ✓ **AUTH-03**: Withdrawal-PIN routes shipped at `frontend/src/app/api/auth/withdrawal-pin/route.ts` (POST set/change + DELETE remove) — bcrypt cost 12, isolated lockout key `pin:${userId}` (cannot couple with login lockout), timing-safe comparison via dummy-hash on no-PIN paths
- ✓ **NOTIF-01**: Notification routes shipped at `frontend/src/app/api/notifications/{,count,prefs}/route.ts` — GET list (cursor-paginated), PATCH mark-read, GET count, GET/PATCH prefs (deep-merge for opt-out semantics). Pure-helper layer at `frontend/src/lib/server/{oauth/error-redirect,auth/pin,notifications/cursor,notifications/prefs-merge}.ts` — 49 helper tests, 262/262 full-repo tests green
- ⏳ **8 human-UAT items pending** in `02-HUMAN-UAT.md` (real Google round-trip, real Redis lockout state, populated-DB pagination, etc.)

#### Validated in Phase 4 (Upload, Files, Withdrawals, 2026-05-08)

- ✓ **UP-01**: `POST /api/upload` shipped at `frontend/src/app/api/upload/route.ts` — multipart parse via `req.formData()`, size cap (`UPLOAD_MAX_BYTES`), MIME allowlist (`UPLOAD_ALLOWED_MIME`), magic-byte sniff via `lib/server/upload/sniff.ts` (D-UP-04 ordering — gates BEFORE byte read), R2 PUT, `prisma.fileUpload.create`. Stable error codes: `STORAGE_NOT_CONFIGURED` (503), `UPLOAD_MISSING_FILE` (400), `FILE_TOO_LARGE` (413), `INVALID_MIME` (415), `MAGIC_BYTE_MISMATCH` (415), `UPLOAD_FAILED` (502). Path-traversal mitigation: `{userId}/{randomUUID()}.{ext}` key naming.
- ✓ **UP-02**: `GET /api/files/[...key]` shipped at `frontend/src/app/api/files/[...key]/route.ts` — owner-gated R2 stream proxy (404-collapse on owner mismatch to avoid existence leaks), `ReadableStream<Uint8Array>` piped directly to `Response` (no buffering, no `transformToByteArray`), ETag + Content-Length forwarded, `Cache-Control: private, max-age=3600`.
- ✓ **WD-01..04**: `POST /api/withdrawals` (advisory-lock + Serializable tx, CF-12 — `lockUserTx(tx, userId)` is FIRST awaited statement inside `prisma.$transaction(fn, { isolationLevel: Serializable })`) and `GET /api/withdrawals` (cursor-paginated own list on `requestedAt`) at `frontend/src/app/api/withdrawals/route.ts`. 8 stable guard codes (`AMOUNT_BELOW_MIN`, `AMOUNT_ABOVE_MAX`, `DAILY_LIMIT_EXCEEDED`, `COOLDOWN_ACTIVE`, `PIN_NOT_SET`, `PIN_REQUIRED`, `PIN_INVALID`, `INSUFFICIENT_BALANCE`). Post-commit notification via `createNotification` with `dedupeKey: withdrawal-requested:${id}` (Pitfall 4 — never poisons response). `WITHDRAWAL_BALANCE_CHECK=0` documented in `.env.example` with FINANCIAL-SAFETY warning. P2034 → 409 `TRANSIENT_CONFLICT`. **452/452 full-repo tests green** at phase close.
- ⏳ **3 human-UAT items deferred** in 04-VERIFICATION.md (live R2 PUT smoke, concurrent Postgres POSTs against real DB, MinIO path-style override)

### Active

<!-- Remaining port surface (M3–M8 per STATUS.md) plus monolith-specific work. Each is a hypothesis until shipped. -->

**Domain routes**
- [ ] **PAY-01**: Port `orders` route (Bictorys charge via `PaymentProvider` interface, single-instance circuit breaker)
- [ ] **ADMIN-01**: Port the 9 admin endpoints (users search/detail/role-change, orders filter, withdrawals filter + manual cancel, audit-log paginated, `/me`) — every mutation MUST call `logAdminAction`

**Webhooks & background work (Vercel-native)**

- [ ] **WH-01**: Port `webhooks/bictorys` route via `createWebhookHandler({...})` — must NOT call `req.json()` before HMAC; preserves byte-identical raw body via `req.arrayBuffer()`
- [ ] **CRON-01**: Convert all 5 `setInterval` cron loops to `/api/cron/*` route handlers gated by `Authorization: Bearer ${CRON_SECRET}` — `outbox-drain` (1 min), `email-queue-drain` (1 min), `verification-cleanup` (hourly), `order-expiration` (5 min), `webhook-log-purge` (daily). Drain 100 rows per invocation since fire interval widens from 5s to ~60s.
- [ ] **CRON-02**: Add `vercel.json` with cron schedule entries matching CRON-01

**Tooling, tests, distribution**

- [ ] **TEST-01**: Add `vitest.config.ts` with `setupFiles` for `JWT_SECRET` / `ENCRYPTION_KEY` fixtures
- [ ] **TEST-02**: Port the security-critical lib tests from the template — `auth`, `crypto`, `webhook handler`, `withdrawals/lock`, `outbox/dispatcher`, `oauth/google`, `notifications/createNotification`, `admin/audit`, `payments/circuit-breaker`. Routes get smoke tests via `fetch` against a local Next server.
- [ ] **SCRIPT-01**: Port `make-superadmin` and `seed-dev` scripts (runnable via `tsx`, importing from `lib/server/prisma.ts`)
- [ ] **DOCKER-01**: Update `docker-compose.yml` to drop the `backend` service (keep `db` + `redis` + `mailpit` + `minio`); add a single-service `Dockerfile` running `next start`
- [ ] **DOC-01**: Rewrite `CLAUDE.md` and `README.md` to reflect the Next.js monolith architecture (no Express middleware-order preamble, no separate backend boot)
- [ ] **ENV-01**: Add `CRON_SECRET` to `.env.example` with `openssl rand -base64 32` hint

### Out of Scope

<!-- Explicit boundaries — these are decisions, not omissions. -->

- **UI components / pages** — Headless by design. Every fork designs its own UX. Ship logic only.
- **Multi-provider payments out of the box** — Bictorys stays the default. The `PaymentProvider` interface lets each project plug in Stripe / Paystack / etc., but the starter doesn't ship multiple adapters.
- **Organization / multi-tenancy routes** *(deferred 2026-05-08)* — `Organization` + `OrganizationMember` Prisma models stay (already migrated, zero runtime cost) and `requireOrgRole` middleware is preserved as opt-in plumbing. The 8 `/api/organizations/*` route handlers are NOT shipped in v1. Forks that need multi-tenancy add `organizationId?` columns and route handlers per-project. Reasoning: starter scope target is solo/B2C SaaS by default; orgs add UX surface (invitations, transfer ownership, role mgmt) that most forks will never use.
- **Long-running worker process** — Vercel-first decision. All background work runs as scheduled route handlers, not a separate Node worker. Self-host can still wire a worker later, but it's not the default.
- **Auth.js / NextAuth migration** — Custom JWT + cookies + CSRF stay. We trust the template's auth surface and don't want to relearn invariants in a new framework.
- **Migrating existing `amadou-template` forks to this monolith** — The two starters coexist. New projects pick per-project; no migration path is shipped.
- **Edge runtime / Cloudflare Workers** — All routes target Node.js runtime. Edge incompatibility is an explicit non-goal.
- **Public OSS distribution / docs site / published package** — Private / personal use. No bootstrap CLI, no marketing landing, no contributor docs in v1.
- **Frontend test framework** — Vitest covers the lib only. No Playwright/Cypress/RTL in the starter.
- **Distributed payment circuit breaker** — Acknowledged single-instance limitation. Replace with Redis-backed variant *per project* if multi-pod becomes a concern.
- **Internationalization beyond FCFA defaults** — Bictorys/FCFA conventions stay (integer smallest currency unit, no decimals). Other locales are project-side concerns.
- **Non-Bictorys webhook providers in v1** — Only the Bictorys handler ships. The `WebhookProvider` interface lets each project add others.

## Context

**Origin.** Bootstrapped from `amadou-template` on 2026-05-07. The template is a pnpm monorepo with separate Express 5 backend + Next.js 16 frontend; this fork consolidates both into a single Next.js App Router app. The two coexist permanently — monorepo template for projects needing separate deploys, monolith for tighter projects.

**Port checkpoint.** Currently at M1–M2 per [STATUS.md](../STATUS.md): scaffold + lib + middleware + redis singleton + health/readyz ported. Roughly **6% of route code ported**, with 3,257 lines of route code across 12 files plus 5 cron loops + scripts + tests + Docker + docs remaining. The Prisma schema is complete and all migrations are applied — the lib layer is ready for routes to plug into.

**Doc drift.** [CLAUDE.md](../CLAUDE.md) and [README.md](../README.md) still describe the Express backend architecture (middleware order, raw-body-before-`express.json()`, separate `backend/` directory). They must be rewritten before this is usable as a starter.

**Stack drift relative to original CLAUDE.md.** Prisma is on 5.22 (not 7), Sentry is on 10.51, Tailwind on 4.0. Docker compose still has the old `backend` service entry. These are mismatches the M3–M8 work fixes naturally.

**Multi-target reuse.** The starter must serve four project profiles: SaaS/B2B (auth + payments + multi-tenancy), marketplaces/fintech (full payments + withdrawals + ledger), content/consumer (auth + uploads + notifications), and internal tools/MVPs (auth + admin + speed-to-prototype). Keeping the surface generic — no domain-specific bias — is a constant.

**Phase 0 complete (2026-05-07).** Foundation infrastructure landed: Neon `-pooler` URL convention + `DIRECT_URL` for migrations, `runtime='nodejs'` enforcement on every route handler (CI grep guard via Vitest + fast-glob), Sentry `onRequestError` re-export wired in `instrumentation.ts`, `@vercel/otel` registered for distributed traces, `CRON_SECRET` documented, request-context module (`AsyncLocalStorage`) + logger wrapper available for Phase 1+ adoption. 31/31 tests green, no `middleware.ts`, `lib/server/logger.ts` untouched. Three human-verification items (`pnpm dev` boot smoke, `next build` clean, end-to-end Sentry capture) tracked in `00-HUMAN-UAT.md` for follow-up.

## Constraints

- **Tech stack**: Next.js 16 App Router, TS 5.9 strict, Prisma 5.22, Postgres (Neon), Upstash Redis, R2, Resend, Sentry, Bictorys — no swaps in v1
- **Deployment**: Vercel-first. All background work runs as scheduled route handlers, gated by `CRON_SECRET`. Self-host remains theoretically possible but isn't the design center.
- **Auth model**: keep template invariants — access JWT (15 min) + refresh JWT (7 d, scoped to `/api/auth`) + CSRF double-submit cookie, signup never sets cookies, OAuth refuses `email_verified !== true`, refresh cookie path-scoped, withdrawal advisory-lock + Serializable tx
- **Security**: webhook handlers MUST hash byte-identical raw body before HMAC verification, all admin mutations MUST call `logAdminAction`, all cron routes MUST verify `Bearer ${CRON_SECRET}`, cookies stay `httpOnly` + `Secure` in prod + `SameSite=Lax`
- **TS strictness**: no `any` casts to silence `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`
- **Headless**: no UI components in the starter
- **Tests**: Vitest for `lib/server/**` only; no Playwright/RTL/E2E framework in v1
- **Privacy / distribution**: personal repo; no published package, no docs site, no public README polish
- **Quality over speed**: no specific project blocking on this; prefer correctness and invariant fidelity over rapid feature push

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single Next.js app instead of Express + Next monorepo | Tighter dev loop, one deploy, fewer moving parts; Next.js route handlers are sufficient for the API surface | — Pending |
| Coexist with `amadou-template` (don't deprecate) | The monorepo template still wins for projects needing separate scaling/deploys; deprecating closes off that path | — Pending |
| Vercel-first deployment | Personal projects ship to Vercel by default; matches the lowest-friction path | — Pending |
| Scheduled route handlers (Vercel Cron) instead of long-running workers | No persistent process needed on Vercel; route handlers are stateless and trivially scaled | — Pending |
| Keep custom JWT/cookie/CSRF auth (no Auth.js) | Trust the template's auth model; full parity is a stronger guarantee than re-deriving security in a new framework | — Pending |
| Bictorys default; `PaymentProvider` interface for swaps | Most of my projects target FCFA / Sénégal; interface keeps escape hatch open | — Pending |
| Headless (no UI components) | All four target app types want different UI; UI lock-in defeats the purpose of a starter | — Pending |
| Keep all cloud providers (Neon, Upstash, R2, Resend, Sentry) | No friction with current stack; switching is its own project | — Pending |
| Vitest for `lib/server/**` only; no frontend test framework | Lib carries the security-critical invariants; UI gets tested per-project | — Pending |
| Bictorys circuit breaker stays in-memory in v1 | Acknowledged limitation; multi-pod is a per-project concern | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-08 after Phase 4 (Upload, Files, Withdrawals) completion*
