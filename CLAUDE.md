# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Bootstrapped from `amadou-template` and **ported to a Next.js 16 monolith**: a single full-stack app (App Router API Route Handlers + Server Actions + Prisma 5 + Neon + Upstash + R2 + Resend + Bictorys + Sentry). There is no separate Express backend anymore — server logic lives under `frontend/src/app/api/*` and `frontend/src/lib/server/*`. The app **ships only logic** — no UI components — so each fork designs its own UX.

Read [README.md](README.md) for the broader contract (endpoints, models, env vars, extension patterns) and [STATUS.md](STATUS.md) for the live port roadmap. Reference pages live in [examples/frontend-pages/](examples/frontend-pages/) — including `admin/{layout,users,withdrawals}.tsx` and `auth-error.tsx` for the OAuth error page.

## Commands

pnpm workspace — run from repo root unless noted. The root `package.json` is a thin orchestrator: every script delegates to `pnpm --filter frontend run X` (the workspace currently has a single package, but the root layer is preserved as an architectural seam).

| Task | Command |
|---|---|
| Dev (Next.js on :3000, Turbopack) | `pnpm dev` |
| Build | `pnpm build` |
| Apply Prisma schema (dev iteration) | `pnpm db:push` |
| Versioned migrations | `pnpm db:migrate:dev` (local) / `pnpm db:migrate:deploy` (CI/prod) |
| Migration status | `pnpm db:migrate:status` |
| Spin up local deps (Postgres+Redis+MinIO+Mailpit) | `docker compose up -d` |
| Open Prisma Studio (:5555) | `pnpm db:studio` |
| Bootstrap first SUPERADMIN | `pnpm db:make-superadmin <email>` |
| Unit tests (Vitest) | `pnpm test` |
| Single test file | `pnpm --filter frontend exec vitest run src/lib/server/<file>.test.ts` |
| Single test by name | `pnpm --filter frontend exec vitest run -t "<test name>"` |
| Watch one test | `pnpm --filter frontend exec vitest src/lib/server/<file>.test.ts` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format | `pnpm format` (or `pnpm format:check`) |

Integration tests are deferred to Phase 4 (`pnpm --filter frontend run test:integration` is currently a no-op stub).

**Before committing:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` — must all pass.

## High-level architecture

**Single Next.js 16 App Router app** at `frontend/`. The root `package.json` keeps the pnpm-workspace shell so a future package (e.g. shared types) can be added without re-plumbing scripts. There is no `backend/` package — all server code is colocated under `frontend/src/`.

**Boot flow** — Next.js owns the server lifecycle, so there is no hand-rolled middleware chain. Three things matter:
1. **`frontend/instrumentation.ts`** is Next's `register()` hook — Sentry inits here (server + edge via `sentry.{server,edge}.config.ts`; client via `sentry.client.config.ts`). No DSN env → silent no-op.
2. **Every Route Handler MUST `export const runtime = 'nodejs'`** (Prisma + bcrypt + raw-body needs). [frontend/src/lib/server/observability/runtime-enforcement.test.ts](frontend/src/lib/server/observability/runtime-enforcement.test.ts) walks `app/api/**/route.ts` and fails CI if any route forgets it.
3. **Per-request observability** flows through [frontend/src/lib/server/observability/request-context.ts](frontend/src/lib/server/observability/request-context.ts) (`makeRequestContext` + `withRequestContext` + scoped `log`). Handlers wrap their body in `withRequestContext()` so logs auto-attach `requestId` / `userId` / `route`.

**Optional providers boot conditionally.** If `R2_*` / `RESEND_*` / `BICTORYS_*` / `GOOGLE_*` envs are absent, the corresponding routes either 404 silently or fall back (e.g., R2 → file proxy through `/api/files/:key`). `frontend/src/lib/server/redis.ts` exposes `redis: Redis | null` (returns `null` rather than throwing when env is missing — call sites decide fallback). The app still boots and `/api/auth` still works. `log.warn` announces which providers are inert.

**Auth model** ([frontend/src/lib/server/auth.ts](frontend/src/lib/server/auth.ts)): access JWT (15min, all paths) + refresh JWT (7d, scoped to `/api/auth` for blast-radius reduction) + CSRF token (7d, double-submit cookie). All cookies are namespaced by `COOKIE_PREFIX` (default `app`) and set via `cookies()` from `next/headers` (async). All mutating endpoints require the `x-csrf-token` header echoed from the `<prefix>-csrf` cookie — `verifyCsrf(req)` returns a `NextResponse | null` you bail on at the top of each handler. **Signup is enumeration-resistant**: identical 201 response regardless of email existence, no cookies issued at signup — cookies are issued by `POST /verify-email` after the user enters their 8-char Crockford code. Per-email rate limits (login 10/15m, signup 5/h, etc.) sit on top of the global IP limiter via [frontend/src/lib/server/middleware/rate-limit-by-email.ts](frontend/src/lib/server/middleware/rate-limit-by-email.ts).

**Middleware HOFs** ([frontend/src/lib/server/middleware/index.ts](frontend/src/lib/server/middleware/index.ts)) — `requireAuth` / `requireAdmin` / `requireSuperadmin` / `requireOrgRole` / `optionalAuth` each return `Context | NextResponse`. Pattern in handlers: `if (auth instanceof NextResponse) return auth;`.

**Frontend `api()` wrapper** ([frontend/src/lib/api.ts](frontend/src/lib/api.ts)): auto-refreshes on 401 with a single-flight lock, attaches CSRF, and **only retries `GET`/`HEAD` on network errors** — never mutating verbs (would risk duplicate charges/withdrawals). `ApiError.code` exposes the server's stable error code (e.g. `PIN_REQUIRED`, `INSUFFICIENT_BALANCE`) — switch on `.code`, not on `.message`.

**Webhook idempotency + outbox:** [frontend/src/lib/server/webhook/handler.ts](frontend/src/lib/server/webhook/handler.ts) returns `(NextRequest) => Promise<NextResponse>` and reads the raw body via `await req.arrayBuffer()` (preserves byte-identical HMAC). The handler runs a `Serializable` Prisma transaction with `WebhookLog @@unique([externalId, eventType])` for dedup. Side-effects (emails, notifications) must NOT run as a postCommit closure — they go to the **outbox** ([frontend/src/lib/server/outbox/](frontend/src/lib/server/outbox/)) inside the same tx, drained by a Vercel Cron route (Phase 6, see STATUS.md M6).

**Withdrawals are race-free:** the route runs guards + PENDING insert inside a `Serializable` Prisma transaction guarded by `pg_advisory_xact_lock(hashtext(userId))` ([frontend/src/lib/server/withdrawals/lock.ts](frontend/src/lib/server/withdrawals/lock.ts)). Two concurrent attempts for the same user serialize on the lock, so the second one sees the first's PENDING reservation and is correctly rejected as `INSUFFICIENT_BALANCE`.

**Payments are pluggable** behind the `PaymentProvider` interface ([frontend/src/lib/server/payments/](frontend/src/lib/server/payments/)). Bictorys is the default. A single in-memory `CircuitBreaker` guards charge calls. Webhook replay window defaults to 60s (`BICTORYS_WEBHOOK_REPLAY_WINDOW_MS` to override).

**Cron strategy.** No `setInterval` loops — Next.js / Vercel doesn't keep long-lived processes. Background work runs as **Vercel Cron** routes under `app/api/cron/<name>/route.ts`, each gated by `Authorization: Bearer ${CRON_SECRET}`. Targets: `outbox-drain` (1m), `email-queue-drain` (1m), `verification-cleanup` (hourly), `order-expiration` (5m), `webhook-log-purge` (daily). Multi-instance coordination still uses [frontend/src/lib/server/leader-lease.ts](frontend/src/lib/server/leader-lease.ts) Redis leases where two crons could collide. The Bictorys charge `CircuitBreaker` is still in-memory single-instance — replace with a Redis-backed variant for multi-pod prod (documented limitation).

**Google OAuth (Sign in with Google)** — [frontend/src/lib/server/oauth/google.ts](frontend/src/lib/server/oauth/google.ts) + Phase 2 route handlers under `frontend/src/app/api/auth/oauth/google/{start,callback}/route.ts`. Implemented with `arctic` (OAuth 2.0 + PKCE). `start` issues state + PKCE-verifier cookies (5min, path-scoped to `/api/auth/oauth`) and 302s to Google. `callback` validates state, exchanges code, decodes ID token, refuses unverified emails, find-or-create user with account linking by email, then issues our standard auth cookies. Frontend errors land on `/auth/error?code=…` (see [examples/frontend-pages/auth-error.tsx](examples/frontend-pages/auth-error.tsx)). Inert without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`.

**Multi-tenancy is opt-in.** [frontend/src/lib/server/middleware/require-org-role.ts](frontend/src/lib/server/middleware/require-org-role.ts) ships role types + rank helpers (`OWNER` > `ADMIN` > `MEMBER`). Default project surface stays user-owned (`Order.userId`, `Withdrawal.userId`). Apps that need orgs add `organizationId String?` on their domain models case by case and gate routes via `requireOrgRole('ADMIN', 'orgId')` from the middleware HOFs. Owner promotion is transactional (3 ops in a single tx). Non-members get **404, not 403**, to avoid leaking org existence.

**Admin back-office** — [frontend/src/lib/server/admin/audit.ts](frontend/src/lib/server/admin/audit.ts) + [frontend/src/lib/server/middleware/require-admin.ts](frontend/src/lib/server/middleware/require-admin.ts). App-wide role on `User` (`USER` < `ADMIN` < `SUPERADMIN`). Phase-5 endpoints under `/api/admin/*` cover users (search/detail/role-change), orders (filter), withdrawals (filter + manual cancel), audit-log (paginated/filterable), and `/me` (admin probe). Every mutation calls `logAdminAction(prisma, {...})` → `AdminAction` row so we can answer "who did what when" during incidents. Bootstrap the first SUPERADMIN with `pnpm db:make-superadmin <email>` (script lives at `frontend/scripts/make-superadmin.ts` once Phase 7 lands — see STATUS.md M7).

## Files Claude must NOT modify (battle-tested)

- [frontend/src/lib/server/auth.ts](frontend/src/lib/server/auth.ts), [crypto.ts](frontend/src/lib/server/crypto.ts), [logger.ts](frontend/src/lib/server/logger.ts), [redis.ts](frontend/src/lib/server/redis.ts), [rate-limit-store.ts](frontend/src/lib/server/rate-limit-store.ts), [slug.ts](frontend/src/lib/server/slug.ts), [zod-helpers.ts](frontend/src/lib/server/zod-helpers.ts) — refresh-token races, log-redaction holes, retry storms on POSTs all live here
- [frontend/src/lib/server/webhook/handler.ts](frontend/src/lib/server/webhook/handler.ts) — Serializable transaction + idempotency + raw-body invariants
- [frontend/src/lib/server/payments/circuit-breaker.ts](frontend/src/lib/server/payments/circuit-breaker.ts) — single-instance semantics by design
- [frontend/src/lib/server/oauth/google.ts](frontend/src/lib/server/oauth/google.ts) — state/PKCE cookie scoping, account-linking, ID-token decode are all interdependent (Phase 2 route handlers in `frontend/src/app/api/auth/oauth/google/*` consume this and are also off-limits)
- [frontend/src/lib/server/outbox/dispatcher.ts](frontend/src/lib/server/outbox/dispatcher.ts) — atomic claim + backoff invariants
- [frontend/src/lib/server/admin/audit.ts](frontend/src/lib/server/admin/audit.ts) — every back-office mutation MUST go through this; bypass = unaudited action
- [frontend/src/lib/server/middleware/index.ts](frontend/src/lib/server/middleware/index.ts), [require-admin.ts](frontend/src/lib/server/middleware/require-admin.ts), [require-org-role.ts](frontend/src/lib/server/middleware/require-org-role.ts) — role precedence + Context shape consumed by every route
- [frontend/src/lib/server/observability/request-context.ts](frontend/src/lib/server/observability/request-context.ts) — `requestId` propagation; breaking it silently strips correlation IDs from logs
- [frontend/instrumentation.ts](frontend/instrumentation.ts) — Sentry register hook; must run before any other server code
- [frontend/src/lib/api.ts](frontend/src/lib/api.ts) — auto-refresh + CSRF + retry-only-GET; do not extend retry to mutating verbs

If a change is genuinely required in any of these, surface a brief "I am about to modify X because Y — confirm?" before editing.

## Files Claude SHOULD modify (project surface)

- [frontend/prisma/schema.prisma](frontend/prisma/schema.prisma) — add domain models alongside the generic ones (User, Order, Withdrawal, Organization, AdminAction, OAuthAccount, …). Do not rename the generic models.
- `frontend/src/app/api/<resource>/route.ts` — add new Route Handlers; always `export const runtime = 'nodejs'`, call `verifyCsrf(req)` for mutations, `requireAuth(req)` (or admin/org variants) at the top.
- [frontend/src/lib/server/notifications/templates.ts](frontend/src/lib/server/notifications/templates.ts) — add typed wrappers per notification type (must include a `dedupeKey` for at-most-once delivery)
- [frontend/src/lib/server/payments/](frontend/src/lib/server/payments/) — add new providers behind the `PaymentProvider` interface (use `bictorys.ts` as reference)
- [frontend/src/lib/server/withdrawals/guards.ts](frontend/src/lib/server/withdrawals/guards.ts) — add KYC / tier / AML guards (project-specific, not shipped)
- [frontend/src/lib/server/oauth/](frontend/src/lib/server/oauth/) — add new OAuth providers (`github.ts`, `apple.ts`, …) modeled on `google.ts`; add a sibling route handler under `frontend/src/app/api/auth/oauth/<provider>/{start,callback}/route.ts`
- [frontend/src/app/](frontend/src/app/) — your pages, your design (including `/admin/*` if you keep the back-office)

## Critical invariants

- **Every Route Handler MUST `export const runtime = 'nodejs'`.** The runtime-enforcement test in `frontend/src/lib/server/observability/` fails CI otherwise (Prisma + bcrypt break on edge).
- Webhook handlers read the raw body via `await req.arrayBuffer()` and hash it BEFORE any JSON parse — calling `await req.json()` first is a silent HMAC-verification regression.
- Notification dispatchers MUST go through `createNotification(prisma, input)` — never `prisma.notification.create` directly (skips the dedup `P2002` catch).
- Webhook handlers emit side-effects via the **outbox** (`enqueueOutbox(tx, event)` inside the tx) — never via fire-and-forget closures.
- Withdrawals must use the advisory-lock + Serializable tx pattern (the `withdrawals/lock.ts` helper does this — just call it). Calling guards + insert outside a tx is a double-spend regression.
- Payment amounts are **integer in smallest currency unit** (FCFA = no decimals; USD = cents). Never store decimals.
- `BICTORYS_API_KEY` (charges) and `BICTORYS_PRIVATE_KEY` (payouts) are distinct keys — must NEVER be confused.
- Withdrawal balance check is ON by default (`WITHDRAWAL_BALANCE_CHECK=0` to disable). Disabling on a real-money project is a financial-safety risk — only do it if you have an alternative ledger.
- Withdrawal guards return **stable error codes** (`AMOUNT_BELOW_MIN`, `AMOUNT_ABOVE_MAX`, `DAILY_LIMIT_EXCEEDED`, `COOLDOWN_ACTIVE`, `PIN_NOT_SET`, `PIN_REQUIRED`, `PIN_INVALID`, `INSUFFICIENT_BALANCE`). Frontend switches on `ApiError.code`, not translated messages.
- Frontend `api()` retries only `GET`/`HEAD` on network errors. Do not extend to `POST`/`PUT`/`PATCH`/`DELETE`.
- Signup never sets cookies and never reveals email existence. Cookies are issued by `/verify-email` after the user enters their code.
- Upload route enforces magic-byte validation against `UPLOAD_ALLOWED_MIME` via [frontend/src/lib/server/upload/sniff.ts](frontend/src/lib/server/upload/sniff.ts) — don't bypass by trusting `File.type` alone.
- Admin mutations MUST go through `logAdminAction(prisma, {...})` — every back-office write is auditable. Skipping it is a compliance regression.
- Admin role precedence: `USER` < `ADMIN` < `SUPERADMIN`. Only SUPERADMIN can change roles. The route refuses to demote the **last** SUPERADMIN to avoid locking the org out.
- Org role precedence: `MEMBER` < `ADMIN` < `OWNER`. `requireOrgRole(min, paramName)` returns **404** to non-members (not 403) so org existence isn't leaked.
- OAuth callback MUST refuse `email_verified !== true` from Google — otherwise an attacker with an unverified Google account matching a victim's email can take over the account via auto-linking.
- Cron handlers MUST verify `Authorization: Bearer ${CRON_SECRET}` to prevent unauthenticated invocation of background work.
- Cookies stay `httpOnly` + `Secure` (prod) + `SameSite=Lax`.
- Sentry init stays in [frontend/instrumentation.ts](frontend/instrumentation.ts) `register()` — do not move it into a route module (the hook fires before app code, route imports do not).

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — don't silence with `any` casts.
- ESLint 9 flat config + Prettier (run `pnpm format` before committing).
- Vitest for unit tests; setup file at [frontend/vitest.setup.ts](frontend/vitest.setup.ts), shared mocks under `frontend/src/test-utils/` (alias `server-only` to a no-op for jsdom).
- Conventional Commits.
- Node ≥ 20, pnpm ≥ 9 (see `engines` in [package.json](package.json)).
