# amadou-monolith — port status

Cloned from [`amadou-template`](../amadou-template) on 2026-05-07 as a Next.js full-stack variant (no separate Express backend). This document is the source of truth for what's done and what's left.

## ✅ DONE

### Phase 0 — Foundation (commit `dfb4aab`)

- Vitest config + `server-only` alias
- Observability primitives: `makeRequestContext`, `withRequestContext`, structured `log`
- `runtime='nodejs'` enforcement test (CI fails if any new route omits the export)
- Prisma client + 4 migrations under `frontend/prisma/`

### Phase 1 — Auth Routes (commits `058f185` → `ce02cd4`, fixes `9d82636` → `cac03e5`)

All 9 auth routes shipped under `frontend/src/app/api/auth/*/route.ts` plus 6 lib helpers under `frontend/src/lib/server/auth/`:

| Endpoint                | Method | Status | Requirement |
| ----------------------- | ------ | ------ | ----------- |
| `signup`                | POST   | ✓      | AUTH-01     |
| `login`                 | POST   | ✓      | AUTH-02     |
| `verify-email`          | POST   | ✓      | AUTH-03     |
| `refresh`               | POST   | ✓      | AUTH-04     |
| `logout`                | POST   | ✓      | AUTH-05     |
| `me`                    | GET    | ✓      | AUTH-06     |
| `forgot-password`       | POST   | ✓      | AUTH-07     |
| `reset-password`        | POST   | ✓      | AUTH-08     |
| `change-password`       | PUT    | ✓      | AUTH-09     |

Lib helpers: `banned-passwords` · `hibp` (k-anonymity) · `lockout` (Redis sliding-window + memory fallback) · `refresh-lock` (SETNX single-flight + Lua release) · `dummy-bcrypt` · `email-templates` (HTML-escaped). All 1 critical + 7 warnings from the standard-depth code review have been auto-fixed (`01-REVIEW-FIX.md`). 140/140 tests pass; typecheck + lint clean. Phase 1 verification status: `human_needed` — 3 live-stack UAT items remain (E2E happy path, real-Redis lockout, real-Redis refresh single-flight) and persist in `01-HUMAN-UAT.md`.

### Doc + tooling cleanup (commits `25c1cac` → `dce8bbe`)

- CI workflow now targets the monolith (`--filter frontend`, drop `BACKEND_URL` env)
- `CLAUDE.md` rewritten for App Router + Next.js 16 (was 25 dead `backend/` references)
- `README.md` rewritten for monolith architecture (was 29 dead `backend` references)
- Husky 9 + lint-staged 17 — pre-commit hook runs prettier + eslint + typecheck
- `eslint.config.mjs` dead `backend/src/**` block removed

---

## 📚 Earlier scaffold work (already on master, kept here for archaeology)

### M1 — Scaffold

- `frontend/prisma/` — schema + 4 migrations copied from `amadou-template/backend/prisma/`
- `frontend/package.json` — Prisma 5, bcryptjs, jose, arctic, @upstash/redis, resend, @aws-sdk/client-s3, @sentry/nextjs, server-only, vitest, tsx
- Workspace narrowed to `frontend/` only
- Root `package.json` scripts re-pointed at `--filter frontend`
- `pnpm install` passes; Prisma client generates

### M2 — Libs + middleware ported, fully typechecks

All `backend/src/lib/**` → `frontend/src/lib/server/**`:
- `auth.ts` rewritten: cookies via `cookies()` from `next/headers` (async), `verifyCsrf(req)` returns `NextResponse | null` (no Express middleware)
- `redis.ts` adds singleton `getRedis()` + `redis: Redis | null` export (returns null when env missing instead of throwing — call sites decide fallback)
- `rate-limit-store.ts` drops `express-rate-limit` dep, adds `MemoryRateLimitStore` for dev fallback
- `webhook/handler.ts` returns `(NextRequest) => Promise<NextResponse>`, raw body via `await req.arrayBuffer()` (preserves byte-identical HMAC invariant)
- `sentry.ts` reduced to a thin re-export of `@sentry/nextjs` + `captureRouteError()` helper (init lives in `frontend/instrumentation.ts`)
- `lib/server/middleware/index.ts` — HOFs `requireAuth` / `requireAdmin` / `requireSuperadmin` / `requireOrgRole` / `optionalAuth` returning `Context | NextResponse`
- `middleware/{require-admin,require-org-role}.ts` shrunk to role types + rank helpers
- `middleware/rate-limit-by-email.ts` rewritten as `createEmailLimiter(...).check(req, email)` returning `NextResponse | null`

### M3 (partial) — Health + readyz routes

- `frontend/src/app/api/health/route.ts` — liveness, no external calls
- `frontend/src/app/api/readyz/route.ts` — DB + Redis probes with 1.5s timeout, 503 on failure

## 🔨 TODO — explicit roadmap

The remaining work is well-bounded but substantial: **~2,548 lines of route code across 11 files** (auth M3 is now done — see `## ✅ DONE` above), plus 5 cron loops, scripts, tests, Docker. Recommend porting in **separate focused sessions** to keep quality up.

### M4 — Simple routes | source: 4 files, ~535 lines

- `oauth/google/start/route.ts` + `oauth/google/callback/route.ts` ← `routes/oauth.ts` (255 l) — keep arctic state+PKCE cookies path-scoped to `/api/auth/oauth`, refuse `email_verified !== true`
- `notifications/route.ts` (GET list, POST mark-read) + `notifications/count/route.ts` + `notifications/prefs/route.ts` ← `routes/notifications.ts` (160 l)
- `auth/withdrawal-pin/route.ts` (GET / POST / DELETE) ← `routes/withdrawal-pin.ts` (144 l)

### M5 — Heavy routes | source: 6 files, ~1,247 lines

- `upload/route.ts` ← `routes/upload.ts` (133 l) — replace multer with `await req.formData()` + `File.arrayBuffer()`, keep magic-byte sniff
- `files/[...key]/route.ts` ← `routes/files.ts` (96 l) — proxy R2/S3 stream
- `orders/route.ts` ← `routes/orders.ts` (258 l) — circuit breaker still in-memory (single-instance limit)
- `withdrawals/route.ts` (GET list + POST) ← `routes/withdrawals.ts` (238 l) — **MUST** use `pg_advisory_xact_lock(hashtext(userId))` inside Serializable tx (the lib already does this — just call it)
- `admin/<...>/route.ts` ← `routes/admin.ts` (354 l) — 9 endpoints with `requireAdmin` / `requireSuperadmin`
- `organizations/<...>/route.ts` ← `routes/organizations.ts` (382 l) — 8 endpoints with `requireOrgRole`

### M6 — Webhooks + Vercel Cron | source: `routes/webhooks.ts` + `index.ts` cron loops

Webhook (preserve raw-body HMAC):
```ts
// app/api/webhooks/bictorys/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = createWebhookHandler({ prisma, provider: bictorys.webhookProvider, onPaid, onRefunded, onFailed });
export const POST = handler;
```

Crons → `app/api/cron/<name>/route.ts`, gated by `CRON_SECRET`:

| Cron | Frequency | Replaces |
|---|---|---|
| `outbox-drain` | 1 min (Vercel) | 5s `setInterval` + leader lease |
| `email-queue-drain` | 1 min | 5s `setInterval` |
| `verification-cleanup` | hourly | 1h `setInterval` |
| `order-expiration` | every 5 min | 5min `setInterval` |
| `webhook-log-purge` | daily | 24h `setInterval` |

Each route checks `req.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\``. Add `vercel.json` with the schedule entries. Outbox/email crons can claim more aggressively per invocation (e.g. drain 100 at a time) since each fire is now ~60s apart instead of ~5s.

### M7 — Scripts, tests, Docker, docs

- `frontend/scripts/{make-superadmin,seed-dev}.ts` — runnable via `tsx`, uses `frontend/src/lib/server/prisma.ts`
- Drop `smoke-test.ts` or rewrite as Vitest (HTTP smoke against `localhost:3000`)
- ~~`frontend/vitest.config.ts` — setupFiles for JWT_SECRET/ENCRYPTION_KEY fixtures~~ ✓ done in Phase 0/1
- Port remaining backend test files for non-auth routes (auth tests already shipped in Phase 1)
- `Dockerfile` (single service, runs `next start`)
- `docker-compose.yml` — drop `backend` service, keep `db` + `redis` + `mailpit` + `minio`
- ~~Rewrite `README.md` + `CLAUDE.md` to reflect monolith architecture~~ ✓ done (commits `1b530dd`, `8c8d0e4`)

### M8 — Final pass

`pnpm install && pnpm lint && pnpm typecheck && pnpm test` must pass before tagging v1.

## Critical invariants (never compromise)

1. Sentry init stays the first thing the server runtime loads (`frontend/instrumentation.ts` register hook).
2. Webhook handler hashes raw body — never `await req.json()` before HMAC.
3. Withdrawals use `pg_advisory_xact_lock(hashtext(userId))` inside Serializable tx (Postgres-side; ports cleanly).
4. Notifications go through `createNotification(prisma, input)` — never `prisma.notification.create` directly.
5. Outbox `enqueueOutbox(tx, event)` runs INSIDE the same tx as the webhook handler.
6. Frontend `api()` wrapper retries only `GET`/`HEAD` on network errors.
7. OAuth callback refuses `email_verified !== true`.
8. Admin mutations call `logAdminAction(prisma, {...})`.
9. Cookies stay `httpOnly` + `Secure` (prod) + `SameSite=Lax`.
10. Cron handlers verify `Bearer ${CRON_SECRET}` to prevent unauthenticated invocation.
