# amadou-template

Headless full-stack starter kit for the Next.js + Express + Prisma + Neon + Upstash + R2 + Resend + Bictorys + Sentry stack.
Backend is complete and reusable (auth + Google OAuth, payments, storage, notifications, webhooks, withdrawals, multi-tenancy, admin back-office). Frontend ships only logic (no UI/design).

## Stack

- Frontend: Next.js 16 + React 19 + TypeScript (logic-only — no UI components shipped)
- Backend: Express 5 + Prisma 7 + PostgreSQL (Neon serverless)
- Infra: Upstash Redis (queue + rate limit + leader election), Cloudflare R2 (storage), Resend (email), Bictorys (payments)
- Auth: cookie + CSRF + JWT (15min/7d/7d), `arctic` for Google OAuth 2.0 + PKCE
- Observability: Sentry (backend Node SDK + frontend client/server/edge configs) — env-gated no-op without `SENTRY_DSN`
- Tooling: pnpm workspaces, Vitest, ESLint 9 flat config, Prettier, Node 20 LTS

## Quickstart

```bash
gh repo create my-project --template=<your-org>/amadou-template --private --clone
cd my-project
cp .env.example .env             # fill in DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY at minimum
pnpm install
pnpm db:migrate:deploy           # applies versioned migrations (0_init → 3_admin)
pnpm dev                         # starts frontend (3000) + backend (4000) in parallel
pnpm db:make-superadmin you@example.com   # bootstrap the first admin (after signing up)
pnpm smoke                       # runs E2E smoke tests (skips Bictorys/R2 if creds absent)
```

> Optional: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` enable Sign in with Google. Without them, the `/api/auth/oauth/google/*` routes are inert. Same env-gating applies to `R2_*`, `RESEND_*`, `BICTORYS_*`, and `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.

## How an AI Agent Should Use This Template

If you are an AI agent (Claude Code, Cursor, Aider, etc.) bootstrapping a new project from this template, here is the contract:

1. **Do not touch** `backend/src/lib/{auth,crypto,logger,redis,rate-limit-store,slug,zod-helpers}.ts` and `frontend/src/lib/api.ts`. These are battle-tested. Modifying them risks subtle regressions (refresh-token races, redaction holes, retry storms on POSTs).
2. **Do not modify** `backend/src/lib/webhook/handler.ts` — it enforces idempotency invariants (`@@unique([externalId, eventType])` + Serializable transaction + post-commit hooks). Add new providers via `WebhookProvider<T>` instead.
3. **Do not modify** `backend/src/lib/payments/circuit-breaker.ts` — single-instance limitation is by design (documented).
4. **Build your domain models** in `backend/prisma/schema.prisma` alongside the existing generic models (User, Order, etc.). Do not rename the generic models.
5. **Build your API routes** under `backend/src/routes/<your-resource>.ts` and mount them in `backend/src/index.ts`. Use `requireAuth` + `verifyCsrf` for mutations.
6. **Build your UI** in `frontend/src/app/...`. The starter provides AuthContext + api wrapper. Copy `examples/frontend-pages/*.tsx` for reference, then restyle freely.
7. **Add a payment provider**: see `## Extending — payment providers` below.
8. **Add a notification type**: see `## Extending — notifications` below.
9. **Always preserve** the raw-body parser ordering at `/api/webhooks` (must come BEFORE `express.json()` in `backend/src/index.ts`).
10. **Run** `pnpm test && pnpm typecheck && pnpm lint` before committing.

## Project layout

```
amadou-template/
├── backend/
│   ├── prisma/schema.prisma       Generic models (User, Order, Withdrawal, ...)
│   ├── scripts/                   seed-dev, smoke-test
│   └── src/
│       ├── index.ts               Express server + middleware chain + cron jobs
│       ├── lib/                   Reusable libraries (DO NOT MODIFY in fork)
│       ├── middleware/            requireAuth, optionalAuth, verifyCsrf
│       └── routes/                auth, upload, files, notifications, webhooks, orders, withdrawals
├── frontend/
│   └── src/
│       ├── app/                   Next.js routes (homepage placeholder + pay-redirect API only)
│       ├── contexts/              AuthContext, ToastContext
│       └── lib/                   api wrapper, useApi hook, utils, constants
└── examples/
    └── frontend-pages/            Reference implementations to copy and restyle
```

## API Endpoints

Base URL: `http://localhost:4000` in dev. All mutating endpoints require `x-csrf-token` header (read from the `<prefix>-csrf` cookie).

### Auth (`/api/auth`)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/signup` | none | `{ email, password }` | `{ user: { sub, email } }` + cookies set |
| POST | `/login` | none | `{ email, password }` | same as signup |
| POST | `/logout` | cookies | (empty) | `{ ok: true }` + cookies cleared |
| POST | `/refresh` | refresh cookie | (empty) | `{ user }` + new access cookie |
| GET | `/me` | access cookie | — | `{ user: { sub, email } }` |
| POST | `/verify-email` | none | `{ code }` | `{ ok: true }` + cookies set |
| POST | `/forgot-password` | none | `{ email }` | `{ ok: true }` (always — no enumeration) |
| POST | `/reset-password` | none | `{ code, newPassword }` | `{ ok: true }` |
| **PUT** | `/change-password` | access + CSRF | `{ currentPassword, newPassword }` | `{ ok: true }` |
| GET | `/withdrawal-pin` | access | — | `{ hasPin: boolean }` |
| POST | `/withdrawal-pin` | access + CSRF | `{ currentPassword, pin }` (4-12 digits) | `{ ok: true }` |
| DELETE | `/withdrawal-pin` | access + CSRF | `{ currentPassword }` | `{ ok: true }` |
| GET | `/oauth/google/start` | none | query `?next=/dashboard` (relative paths only) | 302 → Google consent + state/PKCE cookies |
| GET | `/oauth/google/callback` | state cookie | query `?code&state` | 302 → `next` (or `/auth/error?code=…` on failure) + auth cookies set |

### Storage (`/api/upload`, `/api/files`)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/upload` | access + CSRF | multipart `file` (max 10 MB) | `{ id, key, url, sizeBytes, mimeType }` |
| GET | `/files/:key(*)` | none | — | binary stream + Cache-Control: immutable |

### Notifications (`/api/notifications`)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/` | access | query `?limit=20&cursor=<id>` | `{ items, nextCursor }` |
| GET | `/count` | access | — | `{ unread: number }` |
| POST | `/mark-read` | access + CSRF | `{ ids: string[] }` or `{ all: true }` | `{ updated: number }` |
| GET | `/prefs` | access | — | `{ prefs: object }` |
| PATCH | `/prefs` | access + CSRF | `{ prefs: object }` (merged) | `{ prefs: object }` |

### Orders (`/api/orders`)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/` | optional | `{ amount, currency?, customerEmail?, customerPhone?, customerName?, metadata?, successUrl?, failureUrl? }` | `{ orderId, paymentUrl }` (or `503` if circuit open) |

Rate limited: 20/IP/min, 100/IP/hour, 5/email/min.

### Withdrawals (`/api/withdrawals`)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/` | access + CSRF | `{ amount, currency, destination: { method, phone, accountName? }, pin? }` | `{ withdrawalId, status }` or `4xx { error: <code>, message }` |
| GET | `/` | access | query `?limit=20&cursor=<id>` | `{ items, nextCursor }` |

POST failure codes (see "Withdrawals — financial guards" below): `AMOUNT_BELOW_MIN`, `AMOUNT_ABOVE_MAX`, `DAILY_LIMIT_EXCEEDED`, `COOLDOWN_ACTIVE`, `PIN_NOT_SET`, `PIN_REQUIRED`, `PIN_INVALID`, `INSUFFICIENT_BALANCE`.

### Webhooks (`/api/webhooks`)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/bictorys` | provider signature (`x-secret-key` or HMAC) | raw JSON | `{ ok: true, deduped: boolean }` |

Raw body parser is mounted on `/api/webhooks` BEFORE `express.json()` — preserve this ordering.

### Organizations (`/api/organizations`) — multi-tenancy (opt-in)

Roles: `OWNER` > `ADMIN` > `MEMBER`. Non-members get **404** (not 403) so org existence isn't leaked.

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/` | access | — | `{ items: [{ id, slug, name, role }] }` (orgs the user belongs to) |
| POST | `/` | access + CSRF | `{ slug, name }` | `{ organization }` (creates org + OWNER membership in one tx) |
| GET | `/:id` | MEMBER | — | `{ organization, role }` |
| PATCH | `/:id` | ADMIN | `{ name?, slug? }` | `{ organization }` |
| DELETE | `/:id` | OWNER | — | `{ ok: true }` (cascades members; restricts if owned resources block delete) |
| GET | `/:id/members` | MEMBER | — | `{ items: [{ id, userId, role, user: { email, name } }] }` |
| POST | `/:id/members` | ADMIN | `{ email, role }` | `{ membership }` |
| PATCH | `/:id/members/:memberId` | OWNER (for OWNER promotion) / ADMIN | `{ role }` | `{ membership }` |
| DELETE | `/:id/members/:memberId` | OWNER (for OWNER) / ADMIN | — | `{ ok: true }` |

Owner promotion is transactional (3 ops in a single tx): demote current owner → promote target → update `Organization.ownerId`.

### Admin back-office (`/api/admin`)

Gated by `requireAdmin` / `requireSuperadmin`. App-wide role on `User` (`USER` < `ADMIN` < `SUPERADMIN`). Bootstrap the first SUPERADMIN with `pnpm db:make-superadmin <email>`. Every mutation writes an `AdminAction` row via `logAdminAction(...)`.

| Method | Path | Auth | Body / Query | Response |
|---|---|---|---|---|
| GET | `/me` | ADMIN | — | `{ admin: { id, email, role } }` (probe — used by frontend `/admin` layout) |
| GET | `/users` | ADMIN | `?q&role&limit&cursor` | `{ items, nextCursor }` (cursor pagination) |
| GET | `/users/:id` | ADMIN | — | `{ user }` (with `_count` of orders/withdrawals/oauth/memberships) |
| **PATCH** | `/users/:id/role` | SUPERADMIN + CSRF | `{ role }` (USER\|ADMIN\|SUPERADMIN) | `{ user }` (refuses to demote the last SUPERADMIN → 409 `LAST_SUPERADMIN`; bumps `tokenVersion` to invalidate sessions) |
| GET | `/orders` | ADMIN | `?status&email&limit&cursor` | `{ items, nextCursor }` |
| GET | `/withdrawals` | ADMIN | `?status&limit&cursor` | `{ items, nextCursor }` (with `user.email`) |
| **POST** | `/withdrawals/:id/cancel` | ADMIN + CSRF | `{ reason }` | `{ ok: true }` (refuses if `COMPLETED` or `CANCELLED` → 409 `INVALID_STATUS_TRANSITION`) |
| GET | `/audit-log` | ADMIN | `?actorId&action&targetType&targetId&limit&cursor` | `{ items, nextCursor }` (with actor email) |

### Health

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ ok: true, time: ISO8601 }` (liveness — always 200 if process is up) |
| GET | `/readyz` | `{ ok, db, redis }` (readiness — 503 if a hard dependency is down) |

## Prisma Models

| Model | Key fields | Constraints |
|---|---|---|
| `User` | `id (cuid)`, `email @unique`, `passwordHash?` (null for OAuth-only), `emailVerifiedAt?`, `name?`, `avatarUrl?`, `role` (USER\|ADMIN\|SUPERADMIN), `tokenVersion`, `withdrawalPinHash?`, `createdAt`, `updatedAt` | unique email; index on role |
| `OAuthAccount` | `userId (FK)`, `provider` ("google"…), `providerAccountId` (sub from OIDC ID token), `refreshToken?` | unique (provider, providerAccountId) — same Google account can't link twice |
| `Organization` | `id (cuid)`, `slug @unique`, `name`, `ownerId (FK)`, timestamps | slug unique app-wide; index on ownerId |
| `OrganizationMember` | `organizationId (FK)`, `userId (FK)`, `role` (OWNER\|ADMIN\|MEMBER), `createdAt` | unique (organizationId, userId); owner is also a member row |
| `AdminAction` | `actorId (FK)`, `action` (dotted, e.g. "withdrawal.cancel"), `targetType?`, `targetId?`, `metadata? (Json)`, `ip?`, `userAgent?`, `createdAt` | indexes on (actorId, createdAt), (action, createdAt), (targetType, targetId); never auto-pruned (compliance) |
| `VerificationCode` | `userId (FK)`, `code`, `type` (EMAIL_VERIFY \| PASSWORD_RESET), `expiresAt`, `usedAt?`, `attempts` | indexes on (userId, type), (code, type) |
| `FileUpload` | `userId? (FK)`, `key @unique`, `filename`, `mimeType`, `sizeBytes`, `createdAt` | unique key |
| `EmailJob` | `to`, `subject`, `html`, `text?`, `status` (PENDING\|SENT\|FAILED\|DEAD), `attempts`, `lastError?`, `scheduledAt`, `sentAt?` | index on (status, scheduledAt) |
| `Notification` | `userId (FK)`, `type`, `title`, `body`, `data?`, `dedupeKey @unique`, `readAt?`, `createdAt` | unique dedupeKey for at-most-once |
| `NotificationPreferences` | `userId (PK+FK)`, `prefs (Json)`, `updatedAt` | one row per user |
| `OutboxEvent` | `eventType`, `payload (Json)`, `status` (PENDING\|PROCESSING\|SENT\|DEAD), `attempts`, `lastError?`, `scheduledAt`, `dispatchedAt?` | drained by 5s cron with atomic claim + exponential backoff (max 5 attempts → DEAD) |
| `WebhookLog` | `provider`, `externalId`, `eventType`, `payload (Json)`, `processedAt?`, `createdAt` | unique (externalId, eventType) for idempotency |
| `Order` | `userId? (FK)`, `amount`, `currency` (XOF default), `status` (PENDING\|PAID\|EXPIRED\|FAILED\|REFUNDED), `customerEmail?`, `customerPhone?`, `customerName?`, `metadata?`, `provider`, `providerChargeId? @unique`, `paymentUrl?`, `paymentMethod?`, `commissionAmount?`, `netAmount?`, `expiresAt`, `paidAt?`, timestamps | unique providerChargeId |
| `Withdrawal` | `userId (FK)`, `amount`, `currency`, `status`, `destination (Json)`, `provider`, `providerPayoutId? @unique`, `failureReason?`, `requestedAt`, `processedAt?`, `completedAt?` | unique providerPayoutId |

Amounts are in **smallest currency unit as integer** (FCFA = no decimals → `amount: 10000` = 10000 FCFA). For USD adapt to cents per project.

## Environment Variables

Required to boot:

| Variable | Required | Sensible default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Neon PostgreSQL connection string with `?sslmode=require` |
| `JWT_SECRET` | yes | — | ≥32 chars, generate with `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | yes | — | 32 bytes base64, generate with `openssl rand -base64 32` |
| `COOKIE_PREFIX` | no | `app` | Cookie name prefix (`<prefix>-token`, `<prefix>-csrf`, `<prefix>-refresh`) |
| `FRONTEND_URL` | yes | `http://localhost:3000` | Used for CORS and email link generation |
| `BACKEND_URL` | no | `http://localhost:4000` | For self-references in dev; CORS already covers FRONTEND_URL |
| `ALLOWED_ORIGINS` | no | derived from `FRONTEND_URL` | Comma-separated additional CORS origins |
| `NODE_ENV` | no | `development` | Unknown values fail-safe to `production` redaction |

Storage (R2) — required for `/api/upload` and `/api/files`:

| Variable | Required | Purpose |
|---|---|---|
| `R2_ACCOUNT_ID` | yes (for R2) | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | yes (for R2) | R2 access key |
| `R2_SECRET_ACCESS_KEY` | yes (for R2) | R2 secret |
| `R2_BUCKET` | yes (for R2) | Bucket name |
| `R2_PUBLIC_URL` | no | Public bucket URL; if absent, files are proxied through `/api/files/:key` |

Email (Resend) — required for password reset and email verification:

| Variable | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | yes (for email) | Resend API key |
| `EMAIL_FROM` | yes (for email) | `noreply@yourdomain.com` |

Rate limiting + queues (Upstash Redis) — required for production:

| Variable | Required | Purpose |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | yes (prod) | Falls back to MemoryStore in dev with a logger.warn |
| `UPSTASH_REDIS_REST_TOKEN` | yes (prod) | — |

Google OAuth — optional, enables `/api/auth/oauth/google/*`:

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes (for Google sign-in) | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | yes (for Google sign-in) | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | yes (for Google sign-in) | Must match an Authorized redirect URI in the Cloud Console exactly. Default dev: `http://localhost:4000/api/auth/oauth/google/callback` |

Sentry (observability) — optional everywhere; SDK is a silent no-op without DSN:

| Variable | Required | Purpose |
|---|---|---|
| `SENTRY_DSN` | no | Backend (Node) DSN |
| `SENTRY_ENVIRONMENT` | no | Defaults to `NODE_ENV` |
| `SENTRY_RELEASE` | no | Set by CI for source-map symbolication |
| `SENTRY_TRACES_SAMPLE_RATE` | no | 0.0–1.0, default 0 (off) |
| `NEXT_PUBLIC_SENTRY_DSN` | no | Frontend (browser) DSN — recommend a separate Sentry project |
| `NEXT_PUBLIC_SENTRY_*` | no | Same shape as backend (`_ENVIRONMENT`, `_RELEASE`, `_TRACES_SAMPLE_RATE`, `_REPLAYS_SAMPLE_RATE`) |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | no (CI-only) | Source-map upload during `next build` |

Payments (Bictorys) — required for `/api/orders` and `/api/webhooks/bictorys`:

| Variable | Required | Purpose |
|---|---|---|
| `BICTORYS_API_KEY` | yes (for charge) | Bictorys charge key |
| `BICTORYS_PRIVATE_KEY` | yes (for payout) | Separate key for payouts — NEVER reuse `BICTORYS_API_KEY` |
| `BICTORYS_API_URL` | no | Default: `https://api.bictorys.com` |
| `BICTORYS_WEBHOOK_SECRET` | yes | For `x-secret-key` signature verification |
| `BICTORYS_MERCHANT_SECRET_CODE` | yes | Required by Bictorys API |
| `COMMISSION_RATE_BP` | no | If set (e.g. `600` = 6%), commission is computed and stored on Order. Otherwise null. |

Dev-only flags (NEVER set in production):

| Variable | Purpose |
|---|---|
| `SMOKE_BYPASS_WEBHOOK_VERIFY` | When `=1`, bypass webhook signature for smoke tests. Logger.warn fires every call. |
| `BICTORYS_RETRY_DELAYS_MS_OVERRIDE` | Override the `[2000, 4000, 8000]` retry backoff for unit tests. |

## Extending — payment providers

To add a new provider (e.g. Stripe, MTN MoMo, PayDunya):

1. Create `backend/src/lib/payments/<your-provider>.ts` exporting a function that returns `PaymentProvider & { webhookProvider: WebhookProvider<...> }`. Use `bictorys.ts` as reference.
2. Implement the four methods: `charge(input)`, optionally `payout(input)` and `refund(input)`, and the `webhookProvider` shape (`name`, `verifySignature`, `parsePayload`, `extractIds`).
3. Register the route in `backend/src/routes/webhooks.ts`:
   ```typescript
   router.post('/<your-provider>', createWebhookHandler({
     prisma,
     provider: yourProviderInstance.webhookProvider,
     onPaid: async (payload, tx) => { ... },
   }));
   ```
4. Switch the provider used by `/api/orders` in `backend/src/routes/orders.ts` (or fork to a new endpoint per provider).

The `PaymentProvider` interface is currency-agnostic (amounts in smallest unit as integer). Ship Bictorys is positioned as a default example — replace it freely.

## Extending — notification types

`backend/src/lib/notifications/templates.ts` ships one example wrapper (`welcomeNotification`). Add your own:

```typescript
// backend/src/lib/notifications/templates.ts
import type { CreateNotificationInput } from './index.js';

export function paymentReceived(userId: string, orderId: string, amount: number, currency: string): CreateNotificationInput {
  return {
    userId,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment received',
    body: `Order ${orderId} for ${amount} ${currency} confirmed.`,
    data: { orderId, amount, currency },
    dedupeKey: `payment-received:${orderId}`,  // at-most-once delivery
  };
}
```

Call it from your event source:

```typescript
import { createNotification } from '../lib/notifications/index.js';
import { paymentReceived } from '../lib/notifications/templates.js';

await createNotification(prisma, paymentReceived(order.userId, order.id, order.amount, order.currency));
// Returns null silently if dedupeKey already exists (P2002 caught) — no double-delivery.
```

## Extending — OAuth providers

The starter ships Google via `arctic` ([backend/src/lib/oauth/google.ts](backend/src/lib/oauth/google.ts) + [backend/src/routes/oauth.ts](backend/src/routes/oauth.ts)). To add another provider (GitHub, Apple, …):

1. Create `backend/src/lib/oauth/<provider>.ts` exporting a configured arctic provider + an `isConfigured()` boot guard.
2. Add the routes to `backend/src/routes/oauth.ts` (`GET /<provider>/start`, `GET /<provider>/callback`). Reuse the cookie pattern (state + PKCE-verifier, 5min TTL, path-scoped to `/api/auth/oauth`).
3. In the callback: validate state, exchange code, get the user's email + verified flag, **refuse unverified emails** (auto-link bypass otherwise), find-or-create User, write an `OAuthAccount` row, then issue our standard auth cookies via `setSessionCookies(res, user)`.
4. Errors redirect to `${FRONTEND_URL}/auth/error?code=…` ([examples/frontend-pages/auth-error.tsx](examples/frontend-pages/auth-error.tsx) shows the codes the page handles).

## Multi-tenancy (Organizations) — opt-in

The starter ships `Organization` + `OrganizationMember` + `requireOrgRole()` middleware but **no domain models are org-scoped by default**. If your project needs orgs (marketplace, B2B SaaS, classifieds):

1. Add `organizationId String?` (or `String` if always required) to your domain models in `schema.prisma`. Index it.
2. Gate routes with `requireOrgRole('ADMIN', 'orgId')` (the second arg is the route param name carrying the org id).
3. Inside the handler, `req.orgMembership` carries `{ id, organizationId, userId, role }` so you can scope queries.

Role precedence: `OWNER` > `ADMIN` > `MEMBER`. The `requireOrgRole` middleware returns **404** (not 403) to non-members so org existence isn't leaked. Owner promotion is transactional. Apps that don't need orgs can ignore the routes entirely — they don't show up unless your frontend links to them.

## Admin back-office

Gated by an app-wide role on `User` (`USER` < `ADMIN` < `SUPERADMIN`). Bootstrap the first SUPERADMIN after signing up:

```bash
pnpm db:make-superadmin you@example.com
```

This bumps `User.tokenVersion` so any existing session is invalidated and the user signs in again with the elevated role. The script lives at [backend/scripts/make-superadmin.ts](backend/scripts/make-superadmin.ts).

Endpoints sit under `/api/admin/*` (see API table above) and every mutation calls `logAdminAction(prisma, {...})` → `AdminAction` row (actor, action, target, metadata, ip, ua). The audit log is **never auto-pruned** (compliance); add a cron in [backend/src/index.ts](backend/src/index.ts) modeled on the WebhookLog purge if your jurisdiction requires deletion.

Reference frontend pages live in [examples/frontend-pages/admin/](examples/frontend-pages/admin/):
- `layout.tsx` — gates `/admin/*` via `GET /api/admin/me`, redirects non-admins
- `users.tsx` — search + cursor pagination
- `withdrawals.tsx` — filter + per-row cancel with audited reason

The 9 admin endpoints all use cursor-based pagination (`?limit&cursor`), default 50, max 200.

## Observability — Sentry

Both runtimes ship Sentry but are silent no-ops without `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (zero perf cost when unconfigured).

- **Backend**: [backend/src/lib/sentry.ts](backend/src/lib/sentry.ts). `initSentry()` is the **first import** of [backend/src/index.ts](backend/src/index.ts) so HTTP/Express auto-instrumentation patches at module load. The error pipeline runs `captureExpressError()` before our error handler so all 5xx are reported. Don't move the Sentry import — anything before it escapes tracing.
- **Frontend**: `frontend/sentry.{client,server,edge}.config.ts` + `frontend/instrumentation.ts` (Next.js register hook) + `withSentryConfig()` wrapping `next.config.ts`. Source-map upload runs during `next build` if `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` are present in CI.

Sample rates default to 0 (errors only); set `SENTRY_TRACES_SAMPLE_RATE=0.1` etc. to enable performance monitoring.

## Withdrawals — financial guards

The withdrawal route runs configurable safety checks before calling the payment provider's `payout`. **Defaults are safe out of the box**: positive amount required, balance check enabled, no max/daily/cooldown/PIN.

| Guard | Default | Env var | Effect |
|---|---|---|---|
| Min amount | 1 | `WITHDRAWAL_MIN_AMOUNT` | Reject `amount < min` |
| Max amount | unlimited | `WITHDRAWAL_MAX_AMOUNT` | Reject `amount > max` |
| Daily limit | unlimited | `WITHDRAWAL_DAILY_LIMIT` | Reject if `sum(withdrawals last 24h) + amount > limit` |
| Cooldown | 0 hours | `WITHDRAWAL_COOLDOWN_HOURS` | Reject if last withdrawal younger than N hours |
| Require PIN | off | `WITHDRAWAL_REQUIRE_PIN=1` | Reject without valid PIN; user must set PIN first |
| Balance check | **on** | `WITHDRAWAL_BALANCE_CHECK=0` to disable | Reject `amount > computeBalance(userId)` |

Failure responses use stable error codes for the frontend to handle:
`AMOUNT_BELOW_MIN`, `AMOUNT_ABOVE_MAX`, `DAILY_LIMIT_EXCEEDED`, `COOLDOWN_ACTIVE`, `PIN_NOT_SET`, `PIN_REQUIRED`, `PIN_INVALID`, `INSUFFICIENT_BALANCE`.

### Balance formula

Default formula (marketplace/fundraiser-style apps):

```
balance = SUM(PAID Orders.netAmount or amount where userId)
        − SUM(Withdrawals.amount where userId AND status IN ('PENDING','PROCESSING','COMPLETED'))
```

If your project has a different earning model (subscriptions, vested earnings, external ledger), swap it:

```typescript
// backend/src/index.ts
import type { BalanceComputer } from './lib/withdrawals/balance.js';

const myComputeBalance: BalanceComputer = async (userId) => {
  // Your custom formula. Return integer in smallest currency unit.
  return 0;
};

app.locals.computeBalance = myComputeBalance;
```

Or disable balance check entirely with `WITHDRAWAL_BALANCE_CHECK=0`. **Disabling balance check on a project that processes real money is a financial safety risk** — only do this if you have an alternative ledger ensuring no one withdraws more than they earned.

### PIN management

The starter ships endpoints to opt-in to a withdrawal PIN per user (4-12 digits, bcrypt-hashed). Frontend integration: gate the withdrawal form with a PIN prompt when `GET /api/auth/withdrawal-pin` returns `{ hasPin: true }`, then attach `pin` in the POST `/api/withdrawals` body.

KYC, tier-based limits, and AML rules are NOT in the starter — they are project-specific (legal/compliance). Add them as additional guards in `backend/src/lib/withdrawals/guards.ts` if needed.

## Architecture decisions

- **Circuit breaker (payments) is in-memory, single-instance only.** Multi-instance scaling requires a Redis-backed swap. Documented limitation accepted for v1.
- **Cron jobs are `setInterval` in `backend/src/index.ts`.** Single-instance only. Multi-instance prod needs Vercel Cron / BullMQ / similar. Affects: verification code cleanup (1h), order expiration (5min), email queue drain (5s).
- **JWT cookies:** access 15min, refresh 7d, csrf 7d. bcrypt 12 rounds. Refresh token cookie is scoped to `/api/auth` for blast-radius reduction.
- **Refresh on 401:** the frontend `api()` wrapper auto-calls `/api/auth/refresh` and retries the original request, with a lock to prevent concurrent refreshes. Only `GET`/`HEAD` are retried on network errors — never `POST/PUT/PATCH/DELETE` (would risk duplicate charges).
- **Rate limiting** falls back to `MemoryStore` if Upstash env vars are absent, with a `logger.warn` at boot. Production must have Upstash configured.
- **`SMOKE_BYPASS_WEBHOOK_VERIFY` is dev-only** — logger.warn fires on every bypass.
- **No frontend UI shipped.** Reference implementations live in `examples/frontend-pages/` for copy-paste.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Starts frontend (3000) + backend (4000) in parallel |
| `pnpm build` | Builds both packages |
| `pnpm test` | Runs Vitest in backend |
| `pnpm lint` | ESLint check on both |
| `pnpm typecheck` | tsc --noEmit on both |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm db:push` | Applies Prisma schema to DB (dev iteration) |
| `pnpm db:migrate:dev` | Generates + applies a new versioned migration (local) |
| `pnpm db:migrate:deploy` | Applies pending migrations (CI/prod) |
| `pnpm db:migrate:status` | Shows applied vs pending migrations |
| `pnpm db:studio` | Opens Prisma Studio on port 5555 |
| `pnpm db:make-superadmin <email>` | One-time bootstrap: promotes a User to SUPERADMIN + invalidates their sessions |
| `pnpm smoke` | Runs E2E smoke test (env-gated SKIPs for absent creds) |

## License

UNLICENSED — internal template.
