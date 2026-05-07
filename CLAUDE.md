# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Bootstrapped from `amadou-template`: a headless full-stack starter (Next.js 16 + Express 5 + Prisma 7 + Neon + Upstash + R2 + Resend + Bictorys + Sentry). The **backend is complete and reusable** (auth + Google OAuth, payments, storage, notifications, webhooks, withdrawals, multi-tenancy, admin back-office). The **frontend ships only logic** — no UI components — so each fork designs its own UX.

Read [README.md](README.md) for the full contract (endpoints, models, env vars, extension patterns). Reference pages live in [examples/frontend-pages/](examples/frontend-pages/) — including `admin/{layout,users,withdrawals}.tsx` and `auth-error.tsx` for the OAuth error page.

## Commands

pnpm workspace — run from repo root unless noted.

| Task | Command |
|---|---|
| Dev (frontend :3000 + backend :4000 in parallel) | `pnpm dev` |
| Apply Prisma schema (dev iteration) | `pnpm db:push` |
| Versioned migrations (preferred) | `pnpm db:migrate:dev` (local) / `pnpm db:migrate:deploy` (CI/prod) |
| Spin up local deps (Postgres+Redis+MinIO+Mailpit) | `docker compose up -d` |
| Open Prisma Studio (:5555) | `pnpm db:studio` |
| Backend unit tests (Vitest) | `pnpm test` |
| Single backend test file | `pnpm --filter backend exec vitest run src/lib/<file>.test.ts` |
| Single backend test by name | `pnpm --filter backend exec vitest run -t "<test name>"` |
| Watch one test | `pnpm --filter backend exec vitest src/lib/<file>.test.ts` |
| E2E smoke (env-gated, SKIPs cleanly without creds) | `pnpm smoke` |
| Typecheck both packages | `pnpm typecheck` |
| Lint both packages | `pnpm lint` |
| Format | `pnpm format` (or `pnpm format:check`) |

Frontend has no test framework in v1 (`pnpm --filter frontend test` is a no-op).

**Before committing:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` — must all pass.

## High-level architecture

**Monorepo:** pnpm workspaces. `backend/` (Express + Prisma) and `frontend/` (Next.js, App Router) are independent packages; `pnpm dev` runs both in parallel.

**Backend boot flow** ([backend/src/index.ts](backend/src/index.ts)) — middleware order is load-bearing:
1. `helmet` → `cors(credentials: true)` → `compression` → `cookieParser`
2. **Raw-body webhook routes mount BEFORE `express.json()`** so signature verification hashes the byte-identical body. Breaking this order silently breaks Bictorys HMAC verification.
3. `express.json()` → `rateLimit` (Redis-backed in prod, MemoryStore fallback in dev with a `logger.warn`)
4. Resource routers: `auth`, `auth/oauth` (Google), `upload`, `files`, `notifications`, `orders`, `withdrawals`, `withdrawal-pin`, `organizations`, `admin`, `health`, `readyz`
5. Cron loops via `setInterval`, each wrapped in `withLease()` Redis leader-election: verification cleanup (1h), order expiration (5min), webhook-log purge (24h), outbox drain (5s), email queue drain (5s).

**Sentry boots first.** [backend/src/lib/sentry.ts](backend/src/lib/sentry.ts) is imported as the first line of [backend/src/index.ts](backend/src/index.ts) so its auto-instrumentation patches `http`/`express` before any other module loads. Without `SENTRY_DSN` it's a silent no-op (zero perf cost). Frontend uses `sentry.{client,server,edge}.config.ts` + `instrumentation.ts` + `withSentryConfig()` in `next.config.ts` — same env-gated no-op behavior via `NEXT_PUBLIC_SENTRY_DSN`.

**Optional providers boot conditionally.** If `R2_*` / `RESEND_*` / `BICTORYS_*` envs are absent, the corresponding routes either 404 silently or fall back (e.g., R2 → file proxy through `/api/files/:key`). The server still boots and `/api/auth` still works. `logger.warn` announces which providers are inert.

**Auth model:** access JWT (15min, all paths) + refresh JWT (7d, scoped to `/api/auth` for blast-radius reduction) + CSRF token (7d, double-submit cookie). All cookies are namespaced by `COOKIE_PREFIX` (default `app`). All mutating endpoints require the `x-csrf-token` header echoed from the `<prefix>-csrf` cookie. **Signup is enumeration-resistant**: identical 201 response regardless of email existence, no cookies issued at signup — cookies are issued by `POST /verify-email` after the user enters their 8-char Crockford code. Per-email rate limits (login 10/15m, signup 5/h, etc.) sit on top of the global IP limiter.

**Frontend `api()` wrapper** ([frontend/src/lib/api.ts](frontend/src/lib/api.ts)): auto-refreshes on 401 with a single-flight lock, attaches CSRF, and **only retries `GET`/`HEAD` on network errors** — never mutating verbs (would risk duplicate charges/withdrawals). `ApiError.code` exposes the backend's stable error code (e.g. `PIN_REQUIRED`, `INSUFFICIENT_BALANCE`) — switch on `.code`, not on `.message`.

**Webhook idempotency + outbox:** the handler runs a `Serializable` Prisma transaction with `WebhookLog @@unique([externalId, eventType])` for dedup. Side-effects (emails, notifications) must NOT run as a postCommit closure — they go to the **outbox** ([backend/src/lib/outbox/](backend/src/lib/outbox/)) inside the same tx. A 5-second cron drains pending events with per-row atomic claim + exponential backoff on failure (max 5 attempts → DEAD).

**Withdrawals are race-free:** the route runs guards + PENDING insert inside a `Serializable` Prisma transaction guarded by `pg_advisory_xact_lock(hashtext(userId))` ([backend/src/lib/withdrawals/lock.ts](backend/src/lib/withdrawals/lock.ts)). Two concurrent attempts for the same user serialize on the lock, so the second one sees the first's PENDING reservation and is correctly rejected as `INSUFFICIENT_BALANCE`.

**Payments are pluggable** behind the `PaymentProvider` interface ([backend/src/lib/payments/](backend/src/lib/payments/)). Bictorys is the default. A single in-memory `CircuitBreaker` guards charge calls. Webhook replay window defaults to 60s (`BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` to override).

**Multi-instance friendly:** crons coordinate via Redis leases, the outbox claims rows atomically, the job-queue uses `LMOVE` + visibility timeout. The Bictorys charge `CircuitBreaker` is still in-memory single-instance — replace with a Redis-backed variant for multi-pod prod (documented limitation).

**Google OAuth (Sign in with Google)** — [backend/src/routes/oauth.ts](backend/src/routes/oauth.ts) + [backend/src/lib/oauth/google.ts](backend/src/lib/oauth/google.ts). Implemented with `arctic` (OAuth 2.0 + PKCE). `GET /api/auth/oauth/google/start` issues state + PKCE-verifier cookies (5min, path-scoped to `/api/auth/oauth`) and 302s to Google. `GET /api/auth/oauth/google/callback` validates state, exchanges code, decodes ID token, refuses unverified emails, find-or-create user with account linking by email, then issues our standard auth cookies. Frontend errors land on `/auth/error?code=…` (see [examples/frontend-pages/auth-error.tsx](examples/frontend-pages/auth-error.tsx)). Inert without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`.

**Multi-tenancy is opt-in.** [backend/src/routes/organizations.ts](backend/src/routes/organizations.ts) + [backend/src/middleware/require-org-role.ts](backend/src/middleware/require-org-role.ts) ship the `Organization` + `OrganizationMember` primitives (roles: `OWNER` > `ADMIN` > `MEMBER`). Default project surface stays user-owned (`Order.userId`, `Withdrawal.userId`). Apps that need orgs add `organizationId String?` on their domain models case by case and gate routes with `requireOrgRole('ADMIN', 'orgId')`. Owner promotion is transactional (3 ops in a single tx). Non-members get **404, not 403**, to avoid leaking org existence.

**Admin back-office** — [backend/src/routes/admin.ts](backend/src/routes/admin.ts) + [backend/src/middleware/require-admin.ts](backend/src/middleware/require-admin.ts) + [backend/src/lib/admin/audit.ts](backend/src/lib/admin/audit.ts). App-wide role on `User` (`USER` < `ADMIN` < `SUPERADMIN`). Endpoints under `/api/admin/*` cover users (search/detail/role-change), orders (filter), withdrawals (filter + manual cancel), audit-log (paginated/filterable), and `/me` (admin probe). Every mutation calls `logAdminAction(prisma, {...})` → `AdminAction` row so we can answer "who did what when" during incidents. Bootstrap the first SUPERADMIN with `pnpm db:make-superadmin <email>` ([backend/scripts/make-superadmin.ts](backend/scripts/make-superadmin.ts)).

## Files Claude must NOT modify (battle-tested)

- [backend/src/lib/auth.ts](backend/src/lib/auth.ts), [crypto.ts](backend/src/lib/crypto.ts), [logger.ts](backend/src/lib/logger.ts), [redis.ts](backend/src/lib/redis.ts), [rate-limit-store.ts](backend/src/lib/rate-limit-store.ts), [slug.ts](backend/src/lib/slug.ts), [zod-helpers.ts](backend/src/lib/zod-helpers.ts) — refresh-token races, log-redaction holes, retry storms on POSTs all live here
- [backend/src/lib/webhook/handler.ts](backend/src/lib/webhook/handler.ts) — Serializable transaction + idempotency invariants
- [backend/src/lib/payments/circuit-breaker.ts](backend/src/lib/payments/circuit-breaker.ts) — single-instance semantics by design
- [backend/src/lib/oauth/google.ts](backend/src/lib/oauth/google.ts) + [backend/src/routes/oauth.ts](backend/src/routes/oauth.ts) — state/PKCE cookie scoping, account-linking, ID-token decode are all interdependent
- [backend/src/lib/outbox/dispatcher.ts](backend/src/lib/outbox/dispatcher.ts) — atomic claim + backoff invariants
- [backend/src/lib/admin/audit.ts](backend/src/lib/admin/audit.ts) — every back-office mutation MUST go through this; bypass = unaudited action
- [backend/src/middleware/require-admin.ts](backend/src/middleware/require-admin.ts) + [require-org-role.ts](backend/src/middleware/require-org-role.ts) — role precedence + req.adminUser/req.orgMembership shape consumed by routes
- [frontend/src/lib/api.ts](frontend/src/lib/api.ts) — auto-refresh + CSRF + retry-only-GET; do not extend retry to mutating verbs

If a change is genuinely required in any of these, surface a brief "I am about to modify X because Y — confirm?" before editing.

## Files Claude SHOULD modify (project surface)

- [backend/prisma/schema.prisma](backend/prisma/schema.prisma) — add domain models alongside the generic ones (User, Order, Withdrawal, Organization, AdminAction, OAuthAccount, …). Do not rename the generic models.
- [backend/src/routes/](backend/src/routes/) — add new resource routes; mount them in [backend/src/index.ts](backend/src/index.ts) with `requireAuth` + `verifyCsrf` for mutations
- [backend/src/lib/notifications/templates.ts](backend/src/lib/notifications/templates.ts) — add typed wrappers per notification type (must include a `dedupeKey` for at-most-once delivery)
- [backend/src/lib/payments/](backend/src/lib/payments/) — add new providers behind the `PaymentProvider` interface (use `bictorys.ts` as reference)
- [backend/src/lib/withdrawals/guards.ts](backend/src/lib/withdrawals/guards.ts) — add KYC / tier / AML guards (project-specific, not shipped)
- [backend/src/lib/oauth/](backend/src/lib/oauth/) — add new OAuth providers (`github.ts`, `apple.ts`, …) modeled on `google.ts`; mount in [backend/src/routes/oauth.ts](backend/src/routes/oauth.ts)
- [frontend/src/app/](frontend/src/app/) — your pages, your design (including `/admin/*` if you keep the back-office)

## Critical invariants

- Raw body parser at `/api/webhooks` MUST be mounted BEFORE `express.json()` in [backend/src/index.ts](backend/src/index.ts).
- Notification dispatchers MUST go through `createNotification(prisma, input)` — never `prisma.notification.create` directly (skips the dedup `P2002` catch).
- Webhook handlers emit side-effects via the **outbox** (`enqueueOutbox(tx, event)` inside the tx) — never via fire-and-forget callbacks that the previous postCommit pattern allowed to silently fail.
- Withdrawals must use the advisory-lock + Serializable tx pattern (see [backend/src/routes/withdrawals.ts](backend/src/routes/withdrawals.ts)). Calling guards + insert outside a tx is a double-spend regression.
- Payment amounts are **integer in smallest currency unit** (FCFA = no decimals; USD = cents). Never store decimals.
- `BICTORYS_API_KEY` (charges) and `BICTORYS_PRIVATE_KEY` (payouts) are distinct keys — must NEVER be confused.
- Withdrawal balance check is ON by default (`WITHDRAWAL_BALANCE_CHECK=0` to disable). Disabling on a real-money project is a financial-safety risk — only do it if you have an alternative ledger.
- Withdrawal guards return **stable error codes** (`AMOUNT_BELOW_MIN`, `AMOUNT_ABOVE_MAX`, `DAILY_LIMIT_EXCEEDED`, `COOLDOWN_ACTIVE`, `PIN_NOT_SET`, `PIN_REQUIRED`, `PIN_INVALID`, `INSUFFICIENT_BALANCE`). Frontend switches on `ApiError.code`, not translated messages.
- Frontend `api()` retries only `GET`/`HEAD` on network errors. Do not extend to `POST`/`PUT`/`PATCH`/`DELETE`.
- Signup never sets cookies and never reveals email existence. Cookies are issued by `/verify-email` after the user enters their code.
- Upload route enforces magic-byte validation against `UPLOAD_ALLOWED_MIME` — don't bypass by trusting `file.mimetype` alone.
- Admin mutations MUST go through `logAdminAction(prisma, {...})` — every back-office write is auditable. Skipping it is a compliance regression.
- Admin role precedence: `USER` < `ADMIN` < `SUPERADMIN`. Only SUPERADMIN can change roles. The route refuses to demote the **last** SUPERADMIN to avoid locking the org out.
- Org role precedence: `MEMBER` < `ADMIN` < `OWNER`. `requireOrgRole(min, paramName)` returns **404** to non-members (not 403) so org existence isn't leaked.
- OAuth callback MUST refuse `email_verified !== true` from Google — otherwise an attacker with an unverified Google account matching a victim's email can take over the account via auto-linking.
- Sentry import MUST stay the very first line of [backend/src/index.ts](backend/src/index.ts) (before any other import) so the `http`/`express` auto-instrumentation patches at module load.

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — don't silence with `any` casts.
- ESLint 9 flat config + Prettier (run `pnpm format` before committing).
- Vitest for backend tests; no frontend test framework in v1.
- Conventional Commits.
- Node ≥ 20, pnpm ≥ 9 (see `.nvmrc` and `engines` in [package.json](package.json)).
