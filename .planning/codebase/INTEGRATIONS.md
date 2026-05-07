# External Integrations

**Analysis Date:** 2026-05-07

## APIs & External Services

**Google OAuth (Sign in with Google):**
- Service: Google Cloud OAuth 2.0
- What it's used for: User authentication via "Sign in with Google"
- SDK/Client: `arctic` 3.7.0 (OAuth 2.0 + PKCE helper)
- Auth: Environment variables (see "Environment Configuration" below)
- Implementation: `frontend/src/lib/server/auth.ts` (cookie/JWT management)
- Status: Conditional — inert without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
- Callback: `GET /api/auth/oauth/google/callback` (Not yet ported from Express template)

**Email Delivery (Transactional):**
- Service: Resend
- What it's used for: Sending verification codes, password resets, notifications
- SDK/Client: `resend` 6.12.2
- Auth: `RESEND_API_KEY` env var
- Implementation: `frontend/src/lib/server/email.ts` (Mailer interface)
- Status: Conditional — API routes not yet ported to Next.js (template planned for Phase 2)
- Features: RFC 2369 List-Unsubscribe header support built-in

**File Storage (R2/S3-Compatible):**
- Service: Cloudflare R2 (S3-compatible)
- What it's used for: Private file uploads + storage
- SDK/Client: `@aws-sdk/client-s3` 3.1037.0 (pointed at R2 endpoint via `https://<account>.r2.cloudflarestorage.com`)
- Auth: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` env vars
- Implementation: `frontend/src/lib/server/storage.ts` (StorageClient interface, provider-agnostic)
- Public URL: Optional `R2_PUBLIC_URL` for rewriting to public URLs (defaults to private proxy via `/api/files/:key`)
- Status: Conditional — falls back gracefully without env vars (no-op in dev)

**Payment Processing (Bictorys):**
- Service: Bictorys (Senegalese mobile money aggregator)
- What it's used for: Charge requests (orders) + payouts (withdrawals)
- SDK/Client: HTTP REST API (no official SDK in use)
- Auth: 
  - `BICTORYS_API_KEY` - Used for charges (Order creation)
  - `BICTORYS_PRIVATE_KEY` - Used for payouts (Withdrawal requests)
  - `BICTORYS_WEBHOOK_SECRET` - HMAC verification for webhook signatures
  - `BICTORYS_MERCHANT_SECRET_CODE` - Used for payouts only
  - `BICTORYS_API_URL` - Base endpoint (default: https://api.bictorys.com)
- Status: **Template references but NOT YET PORTED to monolith**
  - Models exist: `Order` + `Withdrawal` (Prisma schema)
  - Routes not found in Next.js: `/api/orders`, `/api/withdrawals`, `/api/webhooks/bictorys`
  - Expected paths (from Express template): backend/src/routes/payments/, backend/src/lib/payments/
- Webhook idempotency: Handled via `WebhookLog` table with `@@unique([externalId, eventType])`
- Circuit breaker: In-memory single-instance (documented limitation for multi-pod deployments)

## Data Storage

**Databases:**
- **PostgreSQL**
  - Provider: Neon (serverless), Supabase, or self-hosted
  - Connection: `DATABASE_URL` env var (e.g., `postgresql://user:pass@localhost:5432/amadou_dev`)
  - Client: Prisma ORM (`@prisma/client` 5.22.0)
  - Schema location: `frontend/prisma/schema.prisma`
  - Migrations location: `frontend/prisma/migrations/`

**File Storage:**
- **R2/S3-Compatible**
  - Cloudflare R2 preferred (but AWS S3 compatible)
  - Buckets, keys, and metadata via `frontend/src/lib/server/storage.ts`
  - Optional public URL rewriting

**Caching & Session State:**
- **Upstash Redis (HTTP-based)**
  - Provider: Upstash.com
  - Connection: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars
  - Client: `@upstash/redis` 1.34.3 (HTTP REST client, no TCP connection)
  - Use cases:
    - Rate limiting (IP-based global + per-email)
    - Refresh token revocation (tokenVersion on User)
    - Job queue (outbox event distribution)
    - Leader lease (distributed cron locks)
  - Status in dev: Optional (falls back to in-memory MemoryStore with `logger.warn`)
  - Status in prod: **Required** for rate limiting (inert without env vars)

## Authentication & Identity

**Auth Provider:**
- Custom JWT + Cookie-based (not delegated to third-party service)
  - Access token: JWT, 15-minute expiry, all paths
  - Refresh token: JWT, 7-day expiry, scoped to `/api/auth` path (blast-radius reduction)
  - CSRF token: Random 32-char string, 7-day expiry, double-submit cookie
  - Cookie prefix: Configurable via `COOKIE_PREFIX` env var (default: "app")
  - All cookies: httpOnly, secure (in prod), sameSite=lax, path-scoped

**JWT Secret:**
- Location: `JWT_SECRET` env var (required)
- Validation: ≥32 characters, rejected if matches placeholder patterns ("change-me", "secret", "test", etc.)
- Signing: jose 5.9.6 (JOSE library, ES256/RS256 compatible)
- Implementation: `frontend/src/lib/server/auth.ts`

**OAuth Integration:**
- Google Sign-in via arctic 3.7.0
- PKCE flow with state + verifier cookies (5-min, path-scoped to `/api/auth/oauth`)
- Account linking by email (prevents duplicates)
- ID token verification enforced (rejects unverified emails)

**Password Management:**
- Hashing: bcryptjs 2.4.3
- Nullable for OAuth-only users (Google Sign-in without email/password)
- Verification codes: 8-char Crockford Base32, sent via email

## Monitoring & Observability

**Error Tracking:**
- Sentry (@sentry/nextjs 10.51.0)
  - Backend DSN: `SENTRY_DSN` env var
  - Frontend DSN: `NEXT_PUBLIC_SENTRY_DSN` env var (separate project recommended)
  - Environment: `SENTRY_ENVIRONMENT` (defaults to `NODE_ENV`)
  - Release: `SENTRY_RELEASE` (set by CI for source-map matching)
  - Traces: `SENTRY_TRACES_SAMPLE_RATE` (0.0–1.0, default 0, off)
  - Status: Optional (zero perf cost when DSN is absent)
  - Source map upload: Via CI with `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`
  - Auto-instrumentation: HTTP, Express (legacy), React Server Components, fetch
  - Helper: `captureRouteError()` in `frontend/src/lib/server/sentry.ts`

**Logs:**
- Approach: console (native Node.js)
- Implementation: `frontend/src/lib/server/logger.ts` (custom wrapper)
- PII redaction: Automatic when `NODE_ENV !== 'development'`
- Rate limiter fallback warning: Logged when Redis is absent in prod

## CI/CD & Deployment

**Hosting:**
- Vercel recommended (Next.js official platform)
- Docker-compatible (`.next/standalone` output + Docker deployment support)
- Any Node.js 20+ runtime (Fly.io, Railway, etc.)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/` directory present)
- Status: Pipeline configuration location verified but not analyzed in detail

**Environment Configuration:**
- `NODE_ENV` - "development" (local) or "production" (inferred from VERCEL_ENV if absent)
- Deployment: Standalone output enables Docker bundling

## Environment Configuration

**Required env vars (no fallback):**
- `DATABASE_URL` - PostgreSQL connection string (blocks boot if absent)
- `JWT_SECRET` - ≥32 chars, validated at boot (fails on placeholder patterns)
- `COOKIE_PREFIX` - Cookie namespace (default: "app" if unset)

**Recommended env vars (prod):**
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` - Redis for rate limiting
- `SENTRY_DSN` (or `NEXT_PUBLIC_SENTRY_DSN` for frontend) - Error reporting

**Optional env vars (graceful degradation):**
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` - OAuth 2.0 (disabled if absent)
- `RESEND_API_KEY` + `EMAIL_FROM` - Email delivery (disabled if absent)
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` - File uploads (disabled if absent)
- `R2_PUBLIC_URL` - Public file URL rewriting (optional, proxy used if absent)
- `BICTORYS_*` - Payment processing (disabled if absent; Order/Withdrawal models still exist)

**Frontend-specific (NEXT_PUBLIC prefix):**
- `NEXT_PUBLIC_API_URL` - Backend API endpoint (default: http://localhost:4000)
- `NEXT_PUBLIC_COOKIE_PREFIX` - Must match `COOKIE_PREFIX` on backend
- `NEXT_PUBLIC_SENTRY_DSN` - Frontend error reporting DSN (separate from backend)

**Secrets location:**
- `.env` file (root, shared by Next.js + scripts)
- CI/CD: GitHub Secrets or Vercel Environment Variables

## Webhooks & Callbacks

**Incoming Webhooks:**
- Bictorys payment webhooks (Order + Withdrawal status updates)
  - Path: `/api/webhooks/bictorys` (NOT YET PORTED)
  - HMAC verification: `BICTORYS_WEBHOOK_SECRET` (raw-body middleware required BEFORE `express.json()`)
  - Idempotency: `WebhookLog` dedup table with `@@unique([externalId, eventType])`
  - Side-effects: Emitted via outbox (not fire-and-forget)
  - Replay window: 60s default (configurable via `BICTORYS_WEBHOOK_REPLAY_WINDOW_MS`)

**Outgoing Webhooks:**
- None detected in current codebase (template supports via outbox pattern)

**OAuth Callback:**
- Google OAuth callback: `GET /api/auth/oauth/google/callback`
  - Expected backend URL: `GOOGLE_REDIRECT_URI` env var
  - Frontend error page: `/auth/error?code=…` (see `examples/frontend-pages/auth-error.tsx`)

## Integration Status Summary

| Integration | Ported to Monolith | Status |
|---|---|---|
| PostgreSQL + Prisma | ✓ | Active |
| Upstash Redis | ✓ | Active (conditional, dev fallback) |
| Google OAuth | Partial | Installed (`arctic`), routes NOT ported |
| Resend Email | ✓ Installed | Code present, routes NOT ported (Phase 2) |
| R2/S3 Upload | ✓ Installed | Code present, routes NOT ported (Phase 2) |
| Bictorys Payments | ✓ Installed | Models exist, routes NOT ported (Phase 3) |
| Sentry Monitoring | ✓ | Active (conditional) |

---

*Integration audit: 2026-05-07*
