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
- ✓ **OPS-01**: `/api/health` (liveness) and `/api/readyz` (DB + Redis probes, 1.5s timeout, 503 on failure) routes wired — existing

### Active

<!-- Remaining port surface (M3–M8 per STATUS.md) plus monolith-specific work. Each is a hypothesis until shipped. -->

**Auth & OAuth**

- [ ] **AUTH-01**: Port the 9 auth routes — `signup` (enumeration-resistant, no cookies), `login` (per-email rate limit + lockout), `logout`, `refresh` (path-scoped), `me`, `verify-email` (issues cookies), `forgot-password`, `reset-password`, `change-password`
- [ ] **AUTH-02**: Port the Google OAuth `start` + `callback` routes (state + PKCE cookies path-scoped to `/api/auth/oauth`, refuse `email_verified !== true`, account-link by email)
- [ ] **AUTH-03**: Port the withdrawal-PIN routes (`GET` / `POST` / `DELETE` under `/api/auth/withdrawal-pin`)

**Domain routes**

- [ ] **NOTIF-01**: Port the notification routes — list/mark-read, count, prefs
- [ ] **UP-01**: Port `upload` (replace multer with `req.formData()` + magic-byte sniff, gated by `UPLOAD_ALLOWED_MIME`) and `files/[...key]` (R2 stream proxy)
- [ ] **PAY-01**: Port `orders` route (Bictorys charge via `PaymentProvider` interface, single-instance circuit breaker)
- [ ] **WD-01**: Port `withdrawals` (GET list + POST) using `pg_advisory_xact_lock(hashtext(userId))` inside Serializable tx — must reuse the existing `withdrawals/lock.ts` exactly, never re-implement
- [ ] **ADMIN-01**: Port the 9 admin endpoints (users search/detail/role-change, orders filter, withdrawals filter + manual cancel, audit-log paginated, `/me`) — every mutation MUST call `logAdminAction`
- [ ] **ORG-01**: Port the 8 organization endpoints (CRUD, member management, role changes, transactional owner promotion); non-members get **404, not 403**

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
*Last updated: 2026-05-07 after initialization*
