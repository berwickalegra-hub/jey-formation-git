# Codebase Concerns

**Analysis Date:** 2026-05-07

## Critical Missing Implementations

**Port incompleteness vs CLAUDE.md claims:**
- Issue: CLAUDE.md (14.5 KB) documents a full feature set (auth signup/login/OAuth, payments, withdrawals, admin, webhooks, crons, notifications, outbox, etc.) but the monolith has only ported ~6% of route code. The README and CLAUDE.md **still reference Express/backend patterns** that no longer apply (e.g., "raw body before express.json()").
- Files: `CLAUDE.md` (lines 1-200+ reference Express boot flow), `README.md` (describes `backend/` directory structure that's been removed)
- Impact: New contributors will follow stale instructions. Deployment assumptions are broken (e.g., "mount webhooks before json middleware" is Express-only; Next.js route isolation handles it implicitly, but CLAUDE.md doesn't say so).
- Fix approach: Rewrite CLAUDE.md and README.md to reflect Next.js monolith architecture. Update all references from "backend/src/" to "frontend/src/lib/server/" and "backend/src/app/api/".

**Auth routes not ported:**
- Issue: According to STATUS.md M3, all 9 auth endpoints (signup, login, logout, refresh, me, verify-email, forgot-password, reset-password, change-password) still need to be ported from `backend/src/routes/auth.ts` (709 lines).
- Files: Not yet created; source pattern in template: `backend/src/routes/auth.ts`
- Impact: Cannot complete sign-up, login, or session refresh. Frontend is blocked. Tests for auth will fail.
- Fix approach: Port file by file following STATUS.md M3 handler pattern.

**OAuth routes not ported:**
- Issue: Google OAuth start/callback routes missing. GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI env vars are defined in .env.example but routes don't exist.
- Files: `frontend/src/app/api/oauth/google/start/route.ts` (not created), `frontend/src/app/api/oauth/google/callback/route.ts` (not created)
- Impact: "Sign in with Google" button will 404. Account linking will not work.
- Fix approach: Port from `backend/src/routes/oauth.ts` (255 lines) + `backend/src/lib/oauth/google.ts` (MUST preserve state+PKCE cookie path-scoping and refuse `email_verified !== true`).

**Payment + withdrawal routes not ported:**
- Issue: Bictorys payment provider is wired (env vars present, SDK in package.json), but `/api/orders`, `/api/withdrawals`, `/api/webhooks/bictorys` route files don't exist.
- Files: `frontend/src/app/api/orders/route.ts`, `frontend/src/app/api/withdrawals/route.ts`, `frontend/src/app/api/webhooks/bictorys/route.ts` (none created)
- Impact: Cannot create payment charges or process withdrawals. Webhook dispatch will fail. Revenue collection is blocked.
- Fix approach: Port M5 routes (~1,247 lines per STATUS.md); withdrawals MUST use `pg_advisory_xact_lock(hashtext(userId))` inside Serializable tx.

**Admin + organization routes not ported:**
- Issue: Admin back-office (/api/admin/*) and org routes (/api/organizations/*) are missing. AdminRole, OrgRole middleware exist but route handlers don't.
- Files: `frontend/src/app/api/admin/*/route.ts` (9 endpoints), `frontend/src/app/api/organizations/*/route.ts` (8 endpoints) (all not created)
- Impact: Admin panel will 404. Cannot manage users, orders, audit logs, or organizations. Compliance audit trails are unavailable.
- Fix approach: Port M5 admin/org routes (~736 lines combined).

**Notification routes not ported:**
- Issue: Notification endpoints (GET list, POST mark-read, count, prefs) missing. Models exist in Prisma schema, but routes don't.
- Files: `frontend/src/app/api/notifications/route.ts`, `frontend/src/app/api/notifications/count/route.ts`, `frontend/src/app/api/notifications/prefs/route.ts` (not created)
- Impact: In-app notification system doesn't work. Dedup logic exists (createNotification in lib) but no dispatcher.
- Fix approach: Port M4 notification routes (~160 lines).

**Upload + file serving routes not ported:**
- Issue: R2/S3 upload route and file proxy route missing. R2 storage client exists and is properly lazy-loaded, but routes don't exist.
- Files: `frontend/src/app/api/upload/route.ts`, `frontend/src/app/api/files/[...key]/route.ts` (not created)
- Impact: Cannot store or retrieve files. R2 env vars in .env.example are dead weight.
- Fix approach: Port M5 upload/files routes (~229 lines combined). Multer → `req.formData()` + magic-byte sniff.

**Webhook + cron routes not ported:**
- Issue: Webhook handler for Bictorys and 5 cron routes (outbox-drain, email-queue-drain, verification-cleanup, order-expiration, webhook-log-purge) missing. Per STATUS.md M6, these need porting as Vercel Cron endpoints.
- Files: `frontend/src/app/api/webhooks/bictorys/route.ts`, `frontend/src/app/api/cron/*/route.ts` (not created)
- Impact: Webhooks won't process (failed payments won't be recorded, no outbox drain = notifications disappear). Crons won't run (stale verification codes won't be cleaned, orders won't expire, webhook logs will grow unbounded).
- Fix approach: Port M6. Each cron verifies `Authorization: Bearer ${CRON_SECRET}`. Webhook preserves raw-body for HMAC (critical invariant: never `await req.json()` before `handler()`).

## Environment Configuration Gaps

**Missing env vars in .env.example are not blocking:**
- Issue: R2_* (upload), RESEND_* (email), BICTORYS_* (payments), GOOGLE_* (OAuth) vars are present in .env.example and routes check them, but no routes exist yet to use them. During port, each route will start using these.
- Files: `.env.example` (complete), but corresponding routes missing
- Impact: None now (routes don't exist). On port, ensure tryCreateStorageClient() fallback behavior is wired (files route must proxy via FileUpload.key if R2 is null).
- Fix approach: No change needed to .env.example; update CLAUDE.md to document that providers are optional and routes gracefully no-op when env is missing.

**CRON_SECRET not in .env.example:**
- Issue: Per CLAUDE.md critical invariants and STATUS.md M6, cron handlers must verify `Bearer ${CRON_SECRET}`, but CRON_SECRET is not listed in .env.example.
- Files: `.env.example` (missing CRON_SECRET)
- Impact: Cron routes cannot verify authz once ported. Vercel can invoke them unauthenticated.
- Fix approach: Add `CRON_SECRET=""` to .env.example with a note: "Generate with: openssl rand -base64 32. Required for Vercel Cron routes in production."

## Sentry Integration Status

**Sentry booting correctly:**
- Status: ✅ Implemented. `frontend/instrumentation.ts` registers Sentry hooks, frontend/src/lib/server/sentry.ts re-exports @sentry/nextjs. SENTRY_DSN and NEXT_PUBLIC_SENTRY_DSN are optional (env-gated no-op if absent).
- Files: `frontend/instrumentation.ts`, `frontend/src/lib/server/sentry.ts`
- No action needed.

## Critical Invariants at Risk

**Webhook HMAC idempotency not yet tested in monolith:**
- Issue: Raw-body preservation logic exists (await req.arrayBuffer() in handler signature), but no webhook route exists to test it. Per CLAUDE.md invariant #2, webhook handlers MUST hash the byte-identical raw body before Bictorys verification.
- Files: `frontend/src/lib/server/webhook/handler.ts` (ported correctly but untested)
- Risk: Port may silently break HMAC verification (e.g., by calling `await req.json()` before `handler()`).
- Safe approach: When porting M6, call `createWebhookHandler()` exactly as shown in STATUS.md M6 example; never deserialize before passing raw request to handler.

**Withdrawal advisory lock must use Postgres function:**
- Issue: Lock pattern exists (imported in withdrawals lib), but route doesn't exist to test it. Per CLAUDE.md invariant #3, withdrawals MUST use `pg_advisory_xact_lock(hashtext(userId))` inside Serializable tx or double-spend race condition opens.
- Files: `frontend/src/lib/server/withdrawals/lock.ts` (ported correctly but untested)
- Risk: Port may call withdraw guards outside a tx or skip advisory lock, opening race condition.
- Safe approach: When porting M5 withdrawals route, copy the exact tx pattern from template `backend/src/routes/withdrawals.ts`; do not simplify or refactor.

**Notification dedup via P2002 catch is critical:**
- Issue: `createNotification(prisma, input)` helper exists and catches `P2002` Prisma constraint violation for dedup. Routes must call this instead of `prisma.notification.create()` directly.
- Files: `frontend/src/lib/server/notifications/` (pattern implemented but routes don't exist to enforce it)
- Risk: New notification routes may skip createNotification() and duplicate notifications silently.
- Safe approach: When porting M4 notification routes, audit that all Notification.create() calls go through createNotification() wrapper.

**Outbox claim + backoff invariants:**
- Issue: Outbox dispatcher exists (`frontend/src/lib/server/outbox/dispatcher.ts`) with atomic row-claim + exponential backoff (max 5 attempts → DEAD), but no cron route exists to drain it. If not called from cron, outbox rows pile up and notifications/emails disappear.
- Files: `frontend/src/lib/server/outbox/` (implemented), cron route M6 (not ported yet)
- Risk: Webhook handlers will enqueue side-effects that never drain.
- Safe approach: Port M6 outbox-drain cron at 1min frequency; can claim more per invocation than the 5s setInterval template since Vercel fires ~60s apart.

## Database Schema Readiness

**Schema complete for Phases 1–3:**
- Status: ✅ Prisma schema includes User, OAuthAccount, VerificationCode, AdminAction, Organization, OrganizationMember, Order, Withdrawal, FileUpload, Notification, EmailJob, OutboxEvent, WebhookLog. All 4 migrations applied.
- Files: `frontend/prisma/schema.prisma` (complete), migrations in `frontend/prisma/migrations/`
- No action needed.

## Testing Gaps

**No route tests ported yet:**
- Issue: Template includes 18 backend test files (*.test.ts) covering auth, payments, withdrawals, etc. Monolith has none.
- Files: `frontend/src/**/*.test.ts` (none exist)
- Impact: Cannot verify routes are porting correctly. Regression risk high.
- Fix approach: Port tests alongside routes, per STATUS.md M7. Route tests will need rewrite (no supertest; use `fetch` against a test server or mock Prisma directly).

**Vitest configured but empty:**
- Issue: `frontend/package.json` includes vitest, but no `vitest.config.ts` created. Setup files for JWT_SECRET/ENCRYPTION_KEY fixtures haven't been wired.
- Files: `frontend/vitest.config.ts` (missing), `frontend/src/**/*.test.ts` (missing)
- Impact: Tests can't run yet.
- Fix approach: Create `vitest.config.ts` with setupFiles pointing to a fixture that seeds JWT_SECRET/ENCRYPTION_KEY for test runs (per STATUS.md M7).

## Security Considerations

**OAuth email_verified guard not yet exercised:**
- Issue: `frontend/src/lib/server/oauth/google.ts` includes logic to refuse `email_verified !== true`, but no route exists to test it. Per CLAUDE.md invariant #7, callback MUST refuse unverified emails to prevent account takeover.
- Files: `frontend/src/lib/server/oauth/google.ts` (implemented but untested)
- Risk: Port of `frontend/src/app/api/auth/oauth/google/callback/route.ts` may inadvertently remove the check.
- Safe approach: When porting M4 OAuth routes, add an integration test that attempts sign-in with unverified email and verify it's rejected.

**Admin action audit trail enforcement:**
- Issue: `logAdminAction()` helper exists but no admin routes exist to call it. Per CLAUDE.md invariant #8, every back-office mutation MUST log an AdminAction row or audit trail is incomplete.
- Files: `frontend/src/lib/server/admin/audit.ts` (implemented), but routes don't call it yet
- Risk: Admin routes may be ported without audit logging, creating compliance gap.
- Safe approach: When porting M5 admin routes, require that every mutation (role change, order cancel, etc.) calls `logAdminAction(prisma, {...})` before returning.

**CSRF cookie path scoping for OAuth (state + PKCE):**
- Issue: Auth library and middleware support CSRF verification, but OAuth cookie path-scoping logic must stay path-scoped to `/api/auth/oauth` (not `/api/auth` broadly). CLAUDE.md and STATUS.md both emphasize this but it's not yet tested.
- Files: `frontend/src/lib/server/oauth/google.ts` (reference), `frontend/src/app/api/auth/oauth/google/*/route.ts` (not ported)
- Risk: Overly broad cookie path could leak state/verifier to other /api/auth endpoints.
- Safe approach: When porting M4, ensure state + PKCE cookies are set with `path: '/api/auth/oauth'`.

## Fragile Areas Needing Care

**Redis singleton fallback behavior:**
- Issue: `getRedis()` returns `null` when UPSTASH_REDIS_REST_URL/TOKEN are missing (no throw). Rate limiter, leader-election, and session management must all have fallback paths for dev. The MemoryRateLimitStore fallback exists but isn't yet exercised by running without Redis.
- Files: `frontend/src/lib/server/redis.ts` (line 30-39), `frontend/src/lib/server/rate-limit-store.ts` (dual-path implementation)
- Risk: Crons coordinate via Redis leader-election. In dev without Redis, both instances run simultaneously (acceptable for dev but not prod). If prod loses Redis without fallback, crons race.
- Safe approach: All call sites should check `redis !== null` or use the fallback. When porting crons, ensure they log a warning if Redis is null in prod.

**API wrapper retry logic in frontend (GET-only):**
- Issue: `frontend/src/lib/api.ts` retries only GET/HEAD on network errors, never mutating verbs. This is correct but is a silent contract that routes depend on. If a future dev extends retries to POST, duplicate charges/withdrawals become possible.
- Files: `frontend/src/lib/api.ts` (existing, correct, but no route tests enforce this)
- Risk: Accidental change in api wrapper could break payments/withdrawals.
- Safe approach: Add a comment in api.ts explaining the invariant and add a test that verifies POST is never retried on network errors.

## Scale & Performance Considerations

**Payment circuit breaker is single-instance only:**
- Issue: Per CLAUDE.md, in-memory CircuitBreaker for Bictorys charges is not distributed. Multi-pod prod will have per-pod circuit breakers, violating the single circuit semantics.
- Files: `frontend/src/lib/server/payments/circuit-breaker.ts` (acknowledged limitation in CLAUDE.md)
- Impact: In multi-pod prod, if one pod opens its CB and stops charging, other pods still charge, doubling traffic to Bictorys. Documented but not solved.
- Fix approach: Replace with Redis-backed circuit breaker in prod or add a comment documenting this as a known multi-instance limitation.

**Cron timing changes from 5s setInterval to ~60s Vercel frequency:**
- Issue: Template runs outbox drain and email queue drain every 5s via setInterval. Vercel Cron allows ~1min minimum frequency. Claim window widens from 5s to 60s, meaning slower drains.
- Files: STATUS.md M6 (acknowledges this and suggests claiming more aggressively)
- Impact: Notifications and emails may batch and deliver in larger chunks (acceptable) but latency increases.
- Safe approach: When porting M6 crons, claim 100 rows per invocation instead of 1, and enable exponential backoff retry per row.

## Documentation Debt

**CLAUDE.md describes Express backend that no longer exists:**
- Issue: CLAUDE.md extensively documents backend boot flow, middleware order, Sentry initialization, cron patterns, all using Express terminology. The monolith moved everything to Next.js App Router.
- Files: `CLAUDE.md` (lines 23-110+ describe Express patterns)
- Impact: Forks will copy stale patterns. Contributors will assume there's a separate backend binary to start; there isn't.
- Fix approach: Rewrite "Backend boot flow" section to describe Next.js App Router file structure and explain that raw-body webhook parsing is now route-specific, not global middleware. Remove all references to `express.json()` ordering.

**README.md references removed directories:**
- Issue: README.md explains endpoints under "backend/src/routes/" which no longer exists. All routes are now under "frontend/src/app/api/".
- Files: `README.md` (likely contains old path references; not fully read but STATUS.md M7 says "Rewrite README.md")
- Impact: New users will try to find routes in the wrong place.
- Fix approach: Per STATUS.md M7, rewrite to show "frontend/src/app/api/" paths and Next.js route handler patterns.

## Missing Critical Features Before Prod Readiness

**No email delivery implemented:**
- Issue: Resend SDK is in package.json, EmailJob and OutboxEvent models exist, but no email-sending routes or email-queue-drain cron exist. Notifications + password resets can't email users.
- Files: `frontend/src/lib/server/email.ts` (exists, reexports resend), but no callers yet
- Impact: Cannot email password reset codes, payment confirmations, or notifications. Users stuck without email auth.
- Fix approach: When porting M6 email-queue-drain cron, implement the queue drainer to call `resend.emails.send()` and update EmailJob rows on success/failure.

**Vercel Cron schedule not configured:**
- Issue: STATUS.md M6 mentions adding `vercel.json` with cron schedules, but this file doesn't exist yet.
- Files: `vercel.json` (missing)
- Impact: Even when cron routes are ported, Vercel won't invoke them.
- Fix approach: Create `vercel.json` with entries per STATUS.md M6 table (outbox-drain 1min, email-queue-drain 1min, verification-cleanup hourly, order-expiration 5min, webhook-log-purge daily).

**Docker setup incomplete:**
- Issue: `docker-compose.yml` still references "backend" service that was removed. Dockerfile may not exist.
- Files: `docker-compose.yml` (needs update), `Dockerfile` (not checked, likely missing single-service Next.js config)
- Impact: CI/local dev can't spin up the monolith in Docker.
- Fix approach: Per STATUS.md M7, update docker-compose.yml to drop backend service (keep db + redis + mailpit + minio), create Dockerfile for Next.js (`next build` + `next start`).

## High-Priority Blockers Before Testing

1. **Auth routes** (signup/login/logout/refresh) — blocks all frontend integration testing
2. **Webhook handler** (Bictorys) — blocks payment flow testing
3. **Cron routes** (outbox-drain, email-queue-drain) — blocks notification delivery
4. **Vitest config** (setupFiles) — blocks running any tests
5. **CRON_SECRET in .env.example** — blocks cron security
6. **CLAUDE.md + README.md rewrites** — blocks contributor onboarding

---

*Concerns audit: 2026-05-07 | Port ~6% complete (M1–M2 done, M3–M8 pending per STATUS.md)*
