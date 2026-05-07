# Requirements: amadou-monolith

**Defined:** 2026-05-07
**Core Value:** Cloning this repo and filling `.env` produces a working Next.js app on Vercel with the same security invariants and feature parity as `amadou-template` — auth, payments, admin, webhooks, crons all wired, headless and ready to graft a UI on top.

## v1 Requirements

Requirements for the v1 release of the starter (the point at which the monolith reaches feature parity with `amadou-template` plus the cross-cutting fixes the research surfaced).

### Foundation (Phase 0 — pre-port cross-cutting fixes)

- [ ] **OPS-01**: `DATABASE_URL` convention uses Neon `-pooler` host with `?pgbouncer=true&connection_limit=1&pool_timeout=15`; documented in `.env.example` and `CLAUDE.md`
- [ ] **OPS-02**: Every API route handler exports `runtime = 'nodejs'` (Prisma + bcrypt + Buffer break on edge); enforced via lint rule or naming convention
- [ ] **OPS-03**: `instrumentation.ts` exports `onRequestError` from `@sentry/nextjs` so unhandled route errors are auto-captured
- [ ] **OPS-04**: `CRON_SECRET` added to `.env.example` with `openssl rand -base64 32` hint; required for Phase 6 cron auth
- [ ] **OPS-05**: Removed `experimental.instrumentationHook` from `next.config.ts` if present (deprecated since Next 15)

### Authentication

- [ ] **AUTH-01**: User can sign up with email/password — enumeration-resistant (identical 201 regardless of email existence), no cookies set at signup, dummy bcrypt work for non-existent emails
- [ ] **AUTH-02**: User can log in with email/password and receive httpOnly cookies (access JWT 15min + refresh JWT 7d scoped to `/api/auth` + CSRF double-submit cookie)
- [ ] **AUTH-03**: User can verify email via 8-char Crockford code; cookies are issued on success (this is where the real session starts)
- [ ] **AUTH-04**: User can refresh access token via refresh cookie with single-flight semantics; refresh cookie is path-scoped to `/api/auth` only
- [ ] **AUTH-05**: User can log out from any page (clears all auth cookies)
- [ ] **AUTH-06**: User can fetch their identity via `GET /api/auth/me` (`requireAuth`)
- [ ] **AUTH-07**: User can request a password reset via email — always 200 response (no enumeration leak)
- [ ] **AUTH-08**: User can reset password using emailed code + new password
- [ ] **AUTH-09**: Authenticated user can change password — bumps `tokenVersion`, invalidating other sessions; requires CSRF
- [ ] **AUTH-10**: Per-email rate limiting protects login (10/15m), signup (5/h), password reset, and verification flows on top of global IP limiter; failed-login lockout after threshold

### OAuth

- [ ] **OAUTH-01**: User can click "Sign in with Google" → server issues state + PKCE-verifier cookies (5 min, path-scoped to `/api/auth/oauth`) and 302s to Google
- [ ] **OAUTH-02**: Google OAuth callback validates state, exchanges code, decodes ID token, refuses `email_verified !== true`, find-or-creates user with account-linking by email, then issues standard auth cookies
- [ ] **OAUTH-03**: OAuth errors land on `/auth/error?code=…` with documented error codes

### Withdrawal PIN

- [ ] **PIN-01**: Authenticated user can set / change / delete a 4-6 digit withdrawal PIN; PIN is stored hashed and required on subsequent withdrawals

### Notifications

- [ ] **NOTIF-01**: Authenticated user can list their notifications (paginated, filterable by read/unread)
- [ ] **NOTIF-02**: Authenticated user can mark notifications as read (single + bulk)
- [ ] **NOTIF-03**: Authenticated user can fetch unread count
- [ ] **NOTIF-04**: Authenticated user can read / update notification preferences (per-channel: in-app, email)
- [ ] **NOTIF-05**: All notification creation goes through `createNotification(prisma, input)` which catches `P2002` for at-most-once dedup

### Uploads & Files

- [ ] **UP-01**: Authenticated user can upload a file via `POST /api/upload` with `req.formData()` + `File.arrayBuffer()`; magic-byte validation against `UPLOAD_ALLOWED_MIME` (no trusting `file.mimetype`); stored in R2 (or null R2 → DB-stored fallback)
- [ ] **UP-02**: User can fetch a file via `GET /api/files/[...key]` — proxies R2/S3 stream when configured, falls back to DB-stored content otherwise

### Payments

- [ ] **PAY-01**: Authenticated user can create an order via `POST /api/orders`; goes through `PaymentProvider` interface (Bictorys default) with single-instance circuit breaker; integer amount in smallest currency unit (FCFA = no decimals, USD = cents)

### Withdrawals

- [ ] **WD-01**: Authenticated user with a set PIN can request a withdrawal via `POST /api/withdrawals`; runs guards + PENDING insert inside a Serializable Prisma transaction guarded by `pg_advisory_xact_lock(hashtext(userId))` — race-free
- [ ] **WD-02**: Withdrawal guards return stable error codes (`AMOUNT_BELOW_MIN`, `AMOUNT_ABOVE_MAX`, `DAILY_LIMIT_EXCEEDED`, `COOLDOWN_ACTIVE`, `PIN_NOT_SET`, `PIN_REQUIRED`, `PIN_INVALID`, `INSUFFICIENT_BALANCE`); frontend switches on `code`, never on translated messages
- [ ] **WD-03**: Authenticated user can list their own withdrawals (filtered by user)
- [ ] **WD-04**: Balance check is enabled by default (`WITHDRAWAL_BALANCE_CHECK=1`); disabling it on a real-money project is documented as a financial-safety risk

### Admin Back-Office

- [ ] **ADMIN-01**: SUPERADMIN/ADMIN can search users, view detail, change role (only SUPERADMIN can change roles; refuse to demote the last SUPERADMIN)
- [ ] **ADMIN-02**: SUPERADMIN/ADMIN can list/filter orders
- [ ] **ADMIN-03**: SUPERADMIN/ADMIN can list/filter withdrawals and manually cancel them
- [ ] **ADMIN-04**: SUPERADMIN/ADMIN can list/filter the audit log (paginated)
- [ ] **ADMIN-05**: `GET /api/admin/me` returns admin probe info
- [ ] **ADMIN-06**: Every admin mutation calls `logAdminAction(prisma, {...})` — bypassing it is a compliance regression
- [ ] **ADMIN-07**: `pnpm db:make-superadmin <email>` script promotes the first SUPERADMIN

### Organizations (multi-tenancy, opt-in)

- [ ] **ORG-01**: Authenticated user can create an organization (becomes OWNER)
- [ ] **ORG-02**: User can list orgs they belong to and read their member list (with role)
- [ ] **ORG-03**: OWNER/ADMIN can invite/add members, change member roles, remove members
- [ ] **ORG-04**: Owner promotion is transactional (3 ops in one tx — old owner demoted, new owner promoted, audit row written)
- [ ] **ORG-05**: `requireOrgRole(min, paramName)` returns **404, not 403** to non-members so org existence is not leaked
- [ ] **ORG-06**: Org role precedence enforced: MEMBER < ADMIN < OWNER

### Webhooks

- [ ] **WH-01**: `POST /api/webhooks/bictorys` route uses `runtime='nodejs'` + `dynamic='force-dynamic'`; `createWebhookHandler({...})` is called WITHOUT `req.json()` first (raw body via `req.arrayBuffer()`); 60s replay window enforced
- [ ] **WH-02**: Webhook handler runs idempotently — Serializable transaction + `WebhookLog @@unique([externalId, eventType])` dedup; side-effects go to outbox via `enqueueOutbox(tx, event)` inside the same tx (never fire-and-forget closures)

### Background work (Vercel Cron)

- [ ] **CRON-01**: `POST /api/cron/outbox-drain` (every 1 min) drains up to 100 pending OutboxEvent rows per invocation with atomic claim + exponential backoff (max 5 attempts → DEAD); resets stuck `PROCESSING` rows older than 90s; `maxDuration = 60`
- [ ] **CRON-02**: `POST /api/cron/email-queue-drain` (every 1 min) drains up to 100 pending EmailJob rows per invocation; calls `resend.emails.send()`; updates row on success/failure; `maxDuration = 60`
- [ ] **CRON-03**: `POST /api/cron/verification-cleanup` (hourly) deletes expired verification codes
- [ ] **CRON-04**: `POST /api/cron/order-expiration` (every 5 min) marks expired pending orders as EXPIRED
- [ ] **CRON-05**: `POST /api/cron/webhook-log-purge` (daily) purges WebhookLog rows older than retention window
- [ ] **CRON-06**: All cron handlers verify `Authorization: Bearer ${CRON_SECRET}` — unauthenticated invocation returns 401
- [ ] **CRON-07**: `vercel.json` declares schedules matching CRON-01 through CRON-05

### Observability (additions beyond template parity)

- [ ] **OBS-01**: `GET /api/admin/outbox` lists OutboxEvent rows (filter by status: PENDING, PROCESSING, DELIVERED, DEAD); zero new models, just SELECTs over existing OutboxEvent table — answers "why didn't this side-effect run?"
- [ ] **OBS-02**: `GET /api/admin/email-queue` lists EmailJob rows with status filter; same shape as OBS-01
- [ ] **OBS-03**: `GET /api/admin/rate-limits` lists current rate-limit hit counters (per-key, per-window) from Redis; visibility into who's hitting limits
- [ ] **OBS-04**: Request ID generated per inbound request, propagated to `logger` calls, returned as `X-Request-Id` response header — incident triage 10x faster
- [ ] **OBS-05**: OpenTelemetry via `@vercel/otel` registered in `instrumentation.ts` (15 LOC); Vercel/Next.js auto-detect; gives distributed traces beyond Sentry's surface

### Tests

- [ ] **TEST-01**: `vitest.config.ts` exists with `setupFiles` seeding `JWT_SECRET` / `ENCRYPTION_KEY` test fixtures
- [ ] **TEST-02**: Security-critical lib has Vitest unit tests — `auth`, `crypto`, `webhook/handler`, `withdrawals/lock`, `outbox/dispatcher`, `oauth/google`, `notifications/createNotification`, `admin/audit`, `payments/circuit-breaker`
- [ ] **TEST-03**: Smoke test against running Next dev server (`fetch` against `localhost:3000`) covers the auth happy path

### Tooling & Distribution

- [ ] **SCRIPT-01**: `scripts/make-superadmin.ts` and `scripts/seed-dev.ts` runnable via `tsx`; import from `lib/server/prisma.ts`
- [ ] **DOCKER-01**: `docker-compose.yml` updated to drop the `backend` service (keep `db` + `redis` + `mailpit` + `minio`); `Dockerfile` runs `next build && next start` for prod; both verified locally
- [ ] **DOC-01**: `CLAUDE.md` rewritten for the Next.js monolith architecture — no Express middleware ordering, no separate backend boot, all paths under `frontend/src/app/api/` and `frontend/src/lib/server/`
- [ ] **DOC-02**: `README.md` rewritten — quickstart, env reference, deploy-to-Vercel guide, route inventory pointing at `frontend/src/app/api/`

## v2 Requirements

Acknowledged but deferred — not in v1 scope.

### Auth Modernization

- **AUTH-V2-01**: Magic link login (email-only auth)
- **AUTH-V2-02**: Passkeys / WebAuthn

### Distributed Operation

- **OPS-V2-01**: Redis-backed circuit breaker (replace in-memory single-instance limit) — needed when running multiple Vercel regions or pods
- **OPS-V2-02**: Prisma 7 migration (ESM-only + driver adapters) — clean post-v1 milestone

### Feature Flags

- **FLAG-V2-01**: Env-based feature-flag helper (`getFlag(name)` reading `FEATURE_X` env). Deferred — speculative until a real fork needs it; easy to add without architectural change.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| UI components / pages | Headless by design — every fork builds its own UX |
| Multi-provider payments out of the box | `PaymentProvider` interface allows per-project swap; starter ships Bictorys default only |
| Long-running worker process | Vercel-first decision — all background work runs as scheduled route handlers |
| Auth.js / NextAuth migration | Custom JWT + cookies + CSRF kept for full template parity |
| Migrating existing `amadou-template` forks to this monolith | The two starters coexist; no migration path |
| Edge runtime / Cloudflare Workers compatibility | All routes are `runtime='nodejs'` |
| Public OSS distribution (docs site, npm package, CLI bootstrapper) | Personal/private use |
| Frontend test framework (Playwright / RTL) | Vitest covers `lib/server/**` only; UI tests are per-project |
| Distributed circuit breaker in v1 | Acknowledged single-instance limit; deferred to v2 |
| i18n beyond FCFA defaults | Per-project concern |
| Non-Bictorys webhook providers in v1 | `WebhookProvider` interface allows per-project addition |
| Managed feature-flag service (LaunchDarkly, PostHog) | Vendor lock-in; env-based flags are sufficient |
| Built-in TOTP / 2FA | Enforcement semantics are domain-specific; passkeys (v2) supersede |
| Subscription plan enforcement | Too domain-specific |

## Traceability

Empty initially — populated by the roadmapper agent during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| _(filled by roadmap)_ | _(pending)_ | _(pending)_ |

**Coverage:**
- v1 requirements: 56 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 56 ⚠️

---
*Requirements defined: 2026-05-07*
*Last updated: 2026-05-07 after initial definition*
