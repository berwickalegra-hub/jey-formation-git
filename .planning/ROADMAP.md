# Roadmap: amadou-monolith

## Overview

Port `amadou-template` (Express 5 + Next.js 16 monorepo) into a single Next.js 16 App Router monolith deployable to Vercel. The journey begins with cross-cutting infrastructure fixes that must be in place before any route handler lands (Phase 0), then sequences auth → simple routes → admin/org/payments → upload/files/withdrawals → webhooks/crons → tests/scripts/docker/docs, and closes with a final quality gate (Phase 7). Every phase ends at a verifiable boundary where the slice of routes it delivers can be smoke-tested in isolation.

## Phases

**Phase Numbering:**
- Integer phases (0–7): Planned milestone work, corresponding to M0–M8 in STATUS.md
- Decimal phases: Urgent insertions if needed (created via `/gsd-insert-phase`)

- [ ] **Phase 0: Foundation** - Cross-cutting infrastructure fixes that must land before any route runs
- [ ] **Phase 1: Auth Routes** - 9 auth endpoints + rate-limiting + enumeration resistance
- [ ] **Phase 2: OAuth, Notifications, Withdrawal PIN** - Google OAuth, notification CRUD, PIN management
- [ ] **Phase 3: Admin, Organizations, Orders** - Back-office endpoints, multi-tenancy, payment orders
- [ ] **Phase 4: Upload, Files, Withdrawals** - File handling, R2 proxy, financial-critical withdrawal flow
- [ ] **Phase 5: Webhooks and Vercel Cron** - Bictorys webhook handler, 5 cron route handlers, vercel.json
- [ ] **Phase 6: Tests, Scripts, Docker, Docs** - Vitest suite, helper scripts, Docker, rewritten CLAUDE.md + README.md
- [ ] **Phase 7: Final Pass** - Full lint/typecheck/test gate; tag v1

## Phase Details

### Phase 0: Foundation
**Goal**: Cross-cutting infrastructure is correct before any route handler lands — Neon pooler URL, Node.js runtime enforcement, Sentry error capture, CRON_SECRET, OTel, and request ID propagation are all in place
**Depends on**: Nothing (first phase)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OBS-04, OBS-05
**Success Criteria** (what must be TRUE):
  1. `.env.example` contains `DATABASE_URL` using the `-pooler` Neon hostname with `?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`, `DIRECT_URL` for migrations, and `CRON_SECRET` with `openssl rand -base64 32` hint — a dev can run `cp .env.example .env` and fill real values without guessing formats
  2. `instrumentation.ts` exports both the Sentry init and `onRequestError` from `@sentry/nextjs`; a deliberately thrown error in a test route is captured in Sentry (or confirmed via log when DSN absent)
  3. `pnpm lint` rejects any file under `app/api/` that exports `runtime = 'edge'` (grep/eslint rule blocks the silent-breakage pitfall)
  4. Every existing route file (`health`, `readyz`) carries `export const runtime = 'nodejs'` as its first export; `next build` completes without any edge-runtime warning
  5. `instrumentation.ts` does NOT export `experimental.instrumentationHook`; `@vercel/otel` is registered; each inbound request receives an `X-Request-Id` response header
**Plans**: 5 plans
  - [x] 00-01-PLAN.md — Wave 0: deps + vitest config + observability/ scaffold (@vercel/otel, fast-glob, vitest.config.ts)
  - [ ] 00-02-PLAN.md — Wave 1: env + schema (DATABASE_URL pooler, DIRECT_URL, CRON_SECRET, schema.prisma directUrl, prisma generate)
  - [ ] 00-03-PLAN.md — Wave 1: instrumentation.ts (onRequestError + registerOTel) + next.config.ts clean check
  - [ ] 00-04-PLAN.md — Wave 1: runtime='nodejs' guard test + audit pay-redirect/route.ts
  - [ ] 00-05-PLAN.md — Wave 1: request-context (ALS) module + logger wrapper

### Phase 1: Auth Routes
**Goal**: Users can authenticate — sign up, verify email, log in, stay logged in across sessions, log out, reset passwords, and change passwords — with full enumeration resistance and per-email rate limiting
**Depends on**: Phase 0
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09, AUTH-10
**Success Criteria** (what must be TRUE):
  1. `POST /api/auth/signup` returns identical 201 for both new and existing email addresses; no cookies are set; a `VerificationCode` row is created for genuinely new users
  2. `POST /api/auth/verify-email` with a valid 8-char Crockford code issues all three httpOnly cookies (`access`, `refresh` path-scoped to `/api/auth`, `csrf`); `GET /api/auth/me` with those cookies returns `{ user: { sub, email } }`
  3. `POST /api/auth/login` returns 429 after 10 attempts in 15 minutes for the same email; `POST /api/auth/logout` clears all three cookies; `POST /api/auth/refresh` rotates the access token without touching the refresh cookie path
  4. `POST /api/auth/forgot-password` returns 200 regardless of whether email exists; `POST /api/auth/reset-password` with a valid code + new password succeeds and invalidates the old password
  5. `PUT /api/auth/change-password` bumps `tokenVersion` (other sessions return 401 on next request); fails without `x-csrf-token` header
**Plans**: TBD

### Phase 2: OAuth, Notifications, Withdrawal PIN
**Goal**: Google sign-in works end-to-end, users can read and acknowledge notifications, and users can manage their withdrawal PIN — the prerequisites for Phase 4 withdrawals are satisfied
**Depends on**: Phase 1
**Requirements**: OAUTH-01, OAUTH-02, OAUTH-03, NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05, PIN-01
**Success Criteria** (what must be TRUE):
  1. `GET /api/auth/oauth/google/start` issues state + PKCE-verifier cookies path-scoped to `/api/auth/oauth` and responds 302 to Google's authorization URL
  2. Google OAuth callback with a valid code + state issues the standard three auth cookies; an attempt with `email_verified: false` is rejected with a redirect to `/auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED`
  3. Authenticated user can call `GET /api/notifications`, `PATCH /api/notifications` (mark-read), `GET /api/notifications/count`, and `GET /api/notifications/prefs` — all return correct shapes; a notification created via `createNotification(prisma, ...)` appears in the list
  4. `POST /api/auth/withdrawal-pin` sets a hashed PIN; `DELETE /api/auth/withdrawal-pin` removes it; calling `POST /api/auth/withdrawal-pin` again (change) succeeds; all three require auth + CSRF
**Plans**: TBD

### Phase 3: Admin, Organizations, Orders
**Goal**: Admins can operate the back-office (users, orders, withdrawals, audit log, outbox/email-queue visibility), organizations are manageable with role-gated access, and users can initiate payment orders
**Depends on**: Phase 1
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-07, ORG-01, ORG-02, ORG-03, ORG-04, ORG-05, ORG-06, PAY-01, OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. `GET /api/admin/users?q=test` returns paginated results; `PATCH /api/admin/users/:id/role` by a SUPERADMIN changes the role and writes an `AdminAction` row; attempting the same as `ADMIN` returns 403; attempting to demote the last SUPERADMIN returns 409
  2. `GET /api/admin/outbox` and `GET /api/admin/email-queue` return filterable lists of OutboxEvent and EmailJob rows respectively (may be empty before Phase 5 data exists — that is expected); `GET /api/admin/rate-limits` returns current hit counters from Redis
  3. Non-member request to any `/api/organizations/:id/*` route returns 404 (not 403); OWNER can add a member and promote them to ADMIN; owner promotion runs as a single 3-op transaction (old owner demoted, new owner promoted, audit row written)
  4. `POST /api/orders` with a valid amount (integer, smallest currency unit) creates an Order via the Bictorys `PaymentProvider` interface and returns the payment URL; circuit breaker trips after configured failure threshold and returns 503 with `PAYMENT_PROVIDER_UNAVAILABLE`
  5. `pnpm db:make-superadmin test@example.com` promotes the user and exits 0; running it against a non-existent email exits non-zero with a clear message
**Plans**: TBD
**UI hint**: no

### Phase 4: Upload, Files, Withdrawals
**Goal**: Users can upload files (magic-byte validated, R2-stored or DB-fallback), retrieve them via proxy, and request withdrawals with race-free balance enforcement
**Depends on**: Phase 2 (PIN-01 must exist before WD-01 can be tested)
**Requirements**: UP-01, UP-02, WD-01, WD-02, WD-03, WD-04
**Success Criteria** (what must be TRUE):
  1. `POST /api/upload` with a valid JPEG (magic bytes `FF D8 FF`) stores the file and returns a key; an upload with a `.jpg` extension but PDF magic bytes is rejected 415; an upload exceeding `UPLOAD_ALLOWED_MIME` allowlist is rejected 415
  2. `GET /api/files/[...key]` with a valid key streams the file from R2 (when configured) or serves DB-stored content; a non-existent key returns 404
  3. `POST /api/withdrawals` with no PIN set returns `{ code: "PIN_NOT_SET" }`; with an incorrect PIN returns `{ code: "PIN_INVALID" }`; two concurrent POST requests for the same user result in exactly one PENDING row and one `{ code: "INSUFFICIENT_BALANCE" }` — the advisory-lock + Serializable tx prevents the double-spend
  4. `WITHDRAWAL_BALANCE_CHECK=0` is documented in `.env.example` with a visible financial-safety warning comment; the default (check enabled) is tested and rejects requests with insufficient balance
**Plans**: TBD

### Phase 5: Webhooks and Vercel Cron
**Goal**: Bictorys payment webhooks are processed idempotently with HMAC verification, and all five background jobs run as Vercel Cron route handlers with proper batching and CRON_SECRET auth
**Depends on**: Phase 3 (orders table populated by Phase 3), Phase 4 (withdrawals table populated)
**Requirements**: WH-01, WH-02, CRON-01, CRON-02, CRON-03, CRON-04, CRON-05, CRON-06, CRON-07
**Success Criteria** (what must be TRUE):
  1. `POST /api/webhooks/bictorys` with a valid HMAC signature returns 200 `{ ok: true, deduped: false }`; replaying the same `externalId + eventType` returns 200 `{ ok: true, deduped: true }` without running the handler again; a tampered body returns 401
  2. All five cron routes (`/api/cron/outbox-drain`, `email-queue-drain`, `verification-cleanup`, `order-expiration`, `webhook-log-purge`) return 401 without `Authorization: Bearer ${CRON_SECRET}`; with correct credentials each returns 200 `{ processed: N }`
  3. `outbox-drain` and `email-queue-drain` process up to 100 rows per invocation and reset any `PROCESSING` rows older than 90 seconds back to `PENDING` (visible in the admin outbox/email-queue endpoint from Phase 3)
  4. `vercel.json` declares cron schedules for all five handlers matching the intervals in CRON-01 through CRON-05; `next build` accepts the file without errors
**Plans**: TBD

### Phase 6: Tests, Scripts, Docker, Docs
**Goal**: The full test suite is green, helper scripts work, Docker builds a runnable image, and CLAUDE.md + README.md describe the monolith (not the old Express backend)
**Depends on**: Phase 5 (full route surface must exist before smoke tests reference it)
**Requirements**: TEST-01, TEST-02, TEST-03, SCRIPT-01, DOCKER-01, DOC-01, DOC-02, ENV-01
**Success Criteria** (what must be TRUE):
  1. `pnpm test` runs all Vitest unit tests (auth, crypto, webhook/handler, withdrawals/lock, outbox/dispatcher, oauth/google, notifications/createNotification, admin/audit, payments/circuit-breaker) with zero failures; `vitest.config.ts` seeds `JWT_SECRET` and `ENCRYPTION_KEY` fixtures
  2. Auth happy-path smoke test (`fetch` against `localhost:3000`) covers signup → verify-email → me → logout and exits 0
  3. `tsx scripts/make-superadmin.ts test@example.com` and `tsx scripts/seed-dev.ts` both run without error against a local Neon/Postgres DB
  4. `docker build -t amadou-monolith .` succeeds; `docker compose up -d` starts `db` + `redis` + `mailpit` + `minio` (no `backend` service); `docker run` of the built image serves `/api/health` returning 200
  5. `CLAUDE.md` contains no references to Express, `backend/src/`, `express.json()`, or Express middleware ordering; `README.md` has a working quickstart section pointing at `frontend/src/app/api/`
**Plans**: TBD

### Phase 7: Final Pass
**Goal**: All quality gates pass and the starter is taggable as v1
**Depends on**: Phase 6
**Requirements**: (gate phase — validates all prior phases; no new requirements)
**Success Criteria** (what must be TRUE):
  1. `pnpm format && pnpm lint && pnpm typecheck && pnpm test` all exit 0 from the repo root with no suppressed errors or `any` casts
  2. `grep -r "runtime = 'edge'" frontend/src/app/api/` returns no matches
  3. `grep -r "express" CLAUDE.md README.md` returns no matches (doc drift fully eliminated)
**Plans**: TBD

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundation | 1/5 | In Progress|  |
| 1. Auth Routes | 0/? | Not started | - |
| 2. OAuth, Notifications, Withdrawal PIN | 0/? | Not started | - |
| 3. Admin, Organizations, Orders | 0/? | Not started | - |
| 4. Upload, Files, Withdrawals | 0/? | Not started | - |
| 5. Webhooks and Vercel Cron | 0/? | Not started | - |
| 6. Tests, Scripts, Docker, Docs | 0/? | Not started | - |
| 7. Final Pass | 0/? | Not started | - |
