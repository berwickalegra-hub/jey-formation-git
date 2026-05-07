# Domain Pitfalls

**Domain:** Next.js 16 App Router monolith on Vercel, ported from Express + Next monorepo (auth + webhooks + crons + uploads + payments)
**Researched:** 2026-05-07
**Confidence:** HIGH (all critical pitfalls verified against official docs and multiple sources)

---

## Critical Pitfalls

Mistakes that cause security regressions, financial bugs, or prod outages.

---

### Pitfall 1: `req.json()` before HMAC — silent HMAC verification failure

**Severity:** SECURITY-CRITICAL

**What goes wrong:**
Calling `await req.json()` (or `await req.text()`) before passing the raw request to the webhook handler consumes the body stream. The handler then gets an empty or re-serialized body to hash — the HMAC will never match a real Bictorys signature. All webhook events will return 401/400 silently, payments will not be processed, and the outbox will never fill.

**Why it happens:**
In Express the raw-body/json ordering was enforced globally at middleware registration time (raw route mounted *before* `express.json()`). In Next.js there is no global body parser — each route handler consumes its own body independently. Developers port the route and add a `const body = await req.json()` for logging or validation at the top of the handler, breaking the invariant invisibly.

**Consequences:**
- Every real Bictorys webhook returns HMAC mismatch → payments never confirmed
- No error thrown at boot time — failure only appears in prod when a real payment fires
- Outbox rows never enqueued → notifications and emails silently disappear

**Prevention:**
```typescript
// app/api/webhooks/bictorys/route.ts
export const runtime = 'nodejs'; // REQUIRED — edge runtime breaks ArrayBuffer → Buffer
export const dynamic = 'force-dynamic';

// CORRECT: createWebhookHandler calls req.arrayBuffer() internally
const handler = createWebhookHandler({ prisma, provider: bictorys.webhookProvider, onPaid, onRefunded, onFailed });
export const POST = handler;

// WRONG — never do this:
// export async function POST(req: NextRequest) {
//   const body = await req.json(); // ← destroys the raw body stream
//   return handler(req);
// }
```

**Detection:**
- Webhook returns 400/401 for every real Bictorys event but 200 for test events you manually craft
- Log shows "HMAC mismatch" on every real call
- `WebhookLog` table never gains rows despite confirmed Bictorys payment activity

**Phase:** M6 (Webhooks)

---

### Pitfall 2: `runtime = 'edge'` on any route that uses Prisma, Buffer, or Node crypto

**Severity:** SECURITY-CRITICAL / CORRECTNESS

**What goes wrong:**
Next.js App Router route handlers default to Node.js runtime — **but `middleware.ts` always runs on Edge**. Any shared module imported by both a route handler and middleware (e.g., `lib/server/auth.ts` which uses `Buffer` and `jose`) will silently fail in the middleware context. Additionally, if any route accidentally exports `export const runtime = 'edge'`, Prisma throws at import time because `@prisma/client` is not edge-compatible without the Neon adapter.

**Why it happens:**
Tutorials recommend `export const runtime = 'edge'` for performance. The `middleware.ts` file is *always* edge and cannot import Prisma. Developers copy-paste the `runtime = 'edge'` export into auth or webhook routes thinking it's an optimization.

**Consequences:**
- `Buffer is not defined` at runtime in edge-deployed routes — breaks HMAC verification, bcrypt, JWT signing
- Prisma throws `PrismaClientKnownRequestError: This operation is not supported in the edge runtime`
- Middleware can never access Prisma — any auth gate placed in `middleware.ts` is structurally wrong for this stack

**Prevention:**
```typescript
// Every route handler in this codebase MUST have:
export const runtime = 'nodejs';

// Do NOT place auth gates in middleware.ts — use requireAuth() HOF in each route handler.
// middleware.ts (if needed at all) should only do lightweight path rewrites, never DB access.
```

Add an ESLint rule or `grep` in CI to detect any `runtime = 'edge'` export in `app/api/`:
```bash
grep -r "runtime = 'edge'" src/app/api/ && echo "FAIL: edge runtime in API route" && exit 1
```

**Detection:**
- `ReferenceError: Buffer is not defined` in Vercel function logs
- `PrismaClientInitializationError` about edge runtime

**Phase:** M3 (Auth) — set the pattern immediately, enforce in every subsequent route

---

### Pitfall 3: `cookies()` mutation from Server Components — auth cookie writes silently dropped

**Severity:** SECURITY-CRITICAL

**What goes wrong:**
`cookies()` from `next/headers` can only **set** cookies inside Route Handlers and Server Actions. Calling `cookies().set(...)` inside a Server Component (page or layout) at best throws, at worst does nothing — the cookie is never written. Auth flows that call `setAuthCookies()` from the wrong execution context will appear to work in dev (React renders the component) but the session cookie never reaches the browser.

**Why it happens:**
The lib already uses `await cookies()` correctly in `lib/server/auth.ts` for the monolith port. The risk is adding helper functions that call `setAuthCookies()` from page-level server code during a future UI phase, or when a developer moves auth logic up into a layout to share across pages.

**Consequences:**
- Login appears successful (200 from route handler) but session cookie not set → user immediately unauthenticated on next request
- Refresh tokens not rotated → stale sessions silently accepted
- Hard to diagnose because route handler returns 200, cookie just never appears in browser

**Prevention:**
- All cookie writes live exclusively in `app/api/auth/*/route.ts` Route Handlers, never in `app/**/page.tsx` or `app/**/layout.tsx`
- The `setAuthCookies()` function is already gated by `server-only` import — keep it that way
- Code review rule: any call to `setAuthCookies`, `clearAuthCookies`, or `cookies().set()` outside an `app/api/` file is a bug

**Detection:**
- Login returns 200 but `Set-Cookie` header absent from response
- Browser DevTools → Application → Cookies shows no new cookie after successful login response

**Phase:** M3 (Auth), enforced in every subsequent auth-touching phase

---

### Pitfall 4: Prisma `migrate deploy` in Vercel build step — deploys migration against prod DB before code is live

**Severity:** CORRECTNESS / OUTAGE RISK

**What goes wrong:**
Running `prisma migrate deploy` as part of the Vercel build command (e.g. `prisma migrate deploy && next build`) applies the migration to the production database while old code is *still serving live traffic* — because Vercel deploys atomically but the build phase runs before the swap. Additive migrations (new columns) are safe; destructive ones (rename, drop, change type) will break the old code until the swap completes.

Additionally, Vercel Preview Deployments share the same `DATABASE_URL` as production by default unless explicitly overridden. A migration triggered by a PR preview build runs against prod.

**Why it happens:**
Recommended tutorials say "run `prisma migrate deploy` in your build script." This is advice for simple apps without live traffic. The template has 4 migrations already applied and will accumulate more.

**Consequences:**
- Renamed column: old pods return `column "X" does not exist` errors until swap → 500s in prod
- Dropped column: immediately fatal for in-flight requests
- Preview deployments corrupt prod schema

**Prevention:**
```bash
# vercel.json — use a dedicated migrate script, NOT build:
# Option A: separate Vercel deploy hook (preferred for additive migrations)
# Option B: run migrate deploy ONLY in prod, never preview

# package.json
"scripts": {
  "vercel-build": "prisma generate && next build"
  // Do NOT include prisma migrate deploy here
}
```
Run migrations manually via `pnpm db:migrate:deploy` or a separate CI step with `--if-present` after the deploy swap. Use `DIRECT_URL` (non-pooled) for migrations, `DATABASE_URL` (pooled) for runtime queries.

**Detection:**
- 500 errors in prod immediately after deploy with Prisma column-not-found errors
- Preview build changes production schema (check Vercel env var scope)

**Phase:** M7 (Docker/scripts/docs) — add explicit note in CLAUDE.md; do NOT add `migrate deploy` to build script

---

### Pitfall 5: Withdrawal double-spend when advisory lock called outside Serializable tx

**Severity:** FINANCIAL-CRITICAL

**What goes wrong:**
If `pg_advisory_xact_lock(hashtext(userId))` is called outside a `Serializable` Prisma transaction, or if the balance check and `Withdrawal` INSERT happen in separate transactions, two concurrent withdrawal requests from the same user can both pass the balance guard simultaneously and both successfully insert — each consuming the full balance.

**Why it happens:**
The `withdrawals/lock.ts` lib is already correct. The risk is in the route handler: if a developer "simplifies" the tx pattern (e.g., reads balance, runs guards, then opens a tx for the insert) they recreate the race condition.

**Consequences:**
- Double spend: user withdraws the same balance twice → negative balance
- Financial loss, potential fraud vector
- Difficult to detect in testing because it requires concurrent requests

**Prevention:**
Copy the advisory-lock + Serializable tx pattern verbatim from the template. Never simplify:
```typescript
// CORRECT — everything inside one tx
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  // guards run inside tx, with locked view
  const withdrawal = await tx.withdrawal.create({ ... });
}, { isolationLevel: 'Serializable' });

// WRONG — race window between read and write
const user = await prisma.user.findUnique(...); // no lock
if (user.balance < amount) throw ...;
await prisma.$transaction(async (tx) => { // lock too late
  await tx.withdrawal.create({ ... });
});
```

**Detection:**
- Negative `User.balance` values in prod
- `Withdrawal` table has two `PENDING` rows for the same user with overlapping timestamps

**Phase:** M5 (Withdrawals)

---

### Pitfall 6: Outbox drain cron timing — 60s fire interval with small batch = perpetual lag

**Severity:** CORRECTNESS

**What goes wrong:**
The Express template drains the outbox every 5 seconds, claiming rows one at a time. Porting to a 1-minute Vercel Cron that still claims 1–5 rows per fire means high-volume periods build up a backlog of `PENDING` outbox events. Notifications and emails fall further and further behind. With exponential backoff on failed rows, a `DEAD` row that needed 5 retries x 2^n backoff can block the drain for hours at the default claim-one-at-a-time rate.

**Why it happens:**
STATUS.md correctly notes "claim 100 rows per invocation." The pitfall is forgetting and copying the Express single-row claim logic.

**Consequences:**
- Notifications and emails delivered minutes or hours late
- `DEAD` rows pile up silently — no alert, no log by default
- On high-traffic days, outbox backlog grows unbounded

**Prevention:**
```typescript
// app/api/cron/outbox-drain/route.ts
const BATCH_SIZE = 100; // not 1 or 5
const events = await claimOutboxBatch(prisma, BATCH_SIZE); // claim atomically
await Promise.allSettled(events.map(e => dispatch(e)));
// Log DEAD count as metric/alert signal
const deadCount = await prisma.outboxEvent.count({ where: { status: 'DEAD' } });
if (deadCount > 0) logger.warn({ deadCount }, 'outbox has DEAD events — manual review needed');
```

Add `vercel.json` cron for `outbox-drain` at `"*/1 * * * *"` (1-minute frequency).

**Detection:**
- `OutboxEvent` table has growing `PENDING` count
- Email / notification delivery latency > 2 minutes consistently
- `DEAD` rows accumulate without alert

**Phase:** M6 (Crons)

---

### Pitfall 7: Vercel Cron function timeout cuts a transaction mid-claim

**Severity:** CORRECTNESS

**What goes wrong:**
Vercel functions have a 10-second default duration (60-second max without Fluid Compute). A cron that drains 100 outbox rows, each requiring an external HTTP call (Resend, Bictorys payout), will time out mid-batch. Rows claimed atomically (`status = 'PROCESSING'`) but not completed become stuck in `PROCESSING` forever unless a timeout/recovery mechanism re-queues them.

**Why it happens:**
The Express template ran `setInterval` in a long-lived process — timeouts didn't truncate mid-batch. Vercel's function model is hard-killed at the duration limit.

**Consequences:**
- Rows permanently stuck in `PROCESSING` — never retried, never `DEAD` — silent message loss
- `PROCESSING` rows block downstream logic that assumes `PENDING` → `PROCESSING` → `DONE`

**Prevention:**
1. Set `export const maxDuration = 60` in cron route handlers (requires Vercel Pro or Fluid Compute)
2. Add a claim timeout: rows in `PROCESSING` for > 90 seconds should be reset to `PENDING` by the next cron fire
3. Keep external HTTP calls per invocation to a safe number (10–20 with timeout, not 100)

```typescript
// Reset stuck PROCESSING rows from previous timeout
await prisma.outboxEvent.updateMany({
  where: { status: 'PROCESSING', claimedAt: { lt: new Date(Date.now() - 90_000) } },
  data: { status: 'PENDING', claimedAt: null },
});
```

**Detection:**
- `OutboxEvent` rows with `status = 'PROCESSING'` and `claimedAt` > 2 minutes ago
- Vercel function logs show `FUNCTION_INVOCATION_TIMEOUT` for cron handlers

**Phase:** M6 (Crons)

---

### Pitfall 8: `CRON_SECRET` static token leak — permanent auth bypass on all cron routes

**Severity:** SECURITY-CRITICAL

**What goes wrong:**
`Authorization: Bearer ${CRON_SECRET}` is a static string stored as a Vercel env var. If it leaks (committed to git, visible in a build log, in an error trace), every cron endpoint is permanently open until the secret is manually rotated and redeployed. Vercel Cron invoker IPs are not fixed, so IP allowlisting alone is not reliable. There is no expiry mechanism.

**Why it happens:**
This is the official Vercel pattern and the only pattern most tutorials show. The limitation (static token, permanent until rotated) is real but rarely highlighted.

**Consequences:**
- Leaked `CRON_SECRET` → attacker can drain outbox arbitrarily, trigger order expiration at will, spam cleanup jobs
- For `outbox-drain`: attacker can drain email queues (information leak) or trigger email floods
- For `order-expiration`: attacker can expire valid orders

**Prevention:**
1. Never log or expose `CRON_SECRET` in error traces — ensure it is not included in any `logger.info(req.headers)` call
2. Use `timingSafeEqual` for comparison (prevents timing attacks):
```typescript
import { timingSafeEqual } from 'crypto';
function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}
```
3. Add `CRON_SECRET` to `.env.example` with generation hint: `openssl rand -base64 32`
4. Do NOT commit a real value to `.env.example`
5. Rotate immediately if any Vercel build log or error trace is exposed publicly

**Detection:**
- `CRON_SECRET` value appears in Vercel function logs or Sentry error context
- Unexpected cron invocations at non-scheduled times in Vercel function logs

**Phase:** M6 (Crons)

---

### Pitfall 9: Postgres connection exhaustion — PrismaClient instantiated per request

**Severity:** CORRECTNESS / OUTAGE RISK

**What goes wrong:**
In serverless environments, each concurrent function invocation can instantiate its own `PrismaClient` with its own connection pool. At moderate traffic (50+ concurrent requests), this exhausts Neon's connection limit (~100 direct connections on the free tier). All subsequent queries fail with `Can't reach database server` or `connection pool exhausted`.

**Why it happens:**
The standard singleton pattern for `PrismaClient` (module-level `const prisma = new PrismaClient()`) works in a long-lived Node.js process. In serverless, each warm instance may share the module, but many cold-start instances each hold their own pool. Without the `-pooler` connection string, Neon receives one connection per pool slot per instance.

**Consequences:**
- 500 errors under moderate traffic load
- Neon dashboard shows connection count at ceiling
- Auth routes (most frequent) are first to fail

**Prevention:**
Use Neon's built-in PgBouncer pooler. The pooled connection string has `-pooler` in the hostname:
```bash
# .env — use pooled URL for runtime queries
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.neon.tech/dbname?sslmode=require"

# Separate non-pooled URL for migrations only
DIRECT_URL="postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require"
```

```prisma
// schema.prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")       // pooled — runtime
  directUrl = env("DIRECT_URL")         // direct — migrations only
}
```

The `prisma.ts` singleton in `lib/server/prisma.ts` is correct for module-level caching; the pooler URL is the other half of the solution.

**Detection:**
- `PrismaClientKnownRequestError: Can't reach database server` under load
- Neon console shows connection count consistently at the ceiling
- Errors spike exactly at traffic peaks, not at off-hours

**Phase:** M3 (Auth) — fix before any routes land, as auth is highest-frequency

---

### Pitfall 10: OAuth PKCE/state cookie path too broad — state leaks to other `/api/auth` subroutes

**Severity:** SECURITY (moderate)

**What goes wrong:**
The OAuth `start` handler sets state and PKCE verifier cookies scoped to `path: '/api/auth/oauth'`. If the path is set to `'/'` or `'/api/auth'` (broader), the verifier cookie is sent with every subsequent auth request (login, refresh, etc.) — a passive info leak and potential oracle for state-guessing attacks.

**Why it happens:**
The `cookies().set({ path: '/api/auth/oauth' })` scoping from the Express template must be preserved exactly. When porting, developers sometimes use `'/'` as a default path or omit `path` entirely (Next.js default is `'/'`).

**Prevention:**
```typescript
// app/api/auth/oauth/google/start/route.ts
cookieStore.set(`${COOKIE_PREFIX}-oauth-state`, state, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 60 * 5, // 5 minutes
  path: '/api/auth/oauth', // MUST be this exact scope — not '/'
});
cookieStore.set(`${COOKIE_PREFIX}-oauth-pkce`, codeVerifier, {
  path: '/api/auth/oauth', // same
  ...
});
```

**Detection:**
- Chrome DevTools → Request Headers for `/api/auth/login` shows OAuth state/PKCE cookies being sent

**Phase:** M4 (OAuth)

---

### Pitfall 11: Upload route hitting 4.5 MB Vercel body size limit — silent 413

**Severity:** CORRECTNESS

**What goes wrong:**
Vercel serverless functions have a hard 4.5 MB request body limit. The upload route uses `await req.formData()` which buffers the entire multipart body in memory. Any file larger than ~4 MB (accounting for multipart envelope overhead) returns HTTP 413 `FUNCTION_PAYLOAD_TOO_LARGE` before the route handler is invoked — the magic-byte validation never runs, and the error is returned as a Vercel-level response (not your own 413 with a stable error code).

**Why it happens:**
The Express/multer version also buffered files in memory but the monolith change removes the separate Node.js backend that could be deployed without this constraint. Developers test with small files and only hit the wall in staging/prod with real user uploads.

**Consequences:**
- Uploads > 4 MB silently fail with an opaque 413
- Magic-byte validation is bypassed (Vercel returns 413 before the handler runs)
- If frontend retries on non-2xx, the retry-only-GET rule prevents duplicate upload attempts — but user sees broken upload UX

**Prevention:**
- For files ≤ 4 MB: current `req.formData()` approach is fine
- For larger files: generate a pre-signed R2 `PutObject` URL in the route handler and return it to the client; client uploads directly to R2 (bypasses Vercel entirely):
```typescript
// route returns presigned URL, client uploads directly
const signedUrl = await getSignedUrl(r2, new PutObjectCommand({ ... }), { expiresIn: 300 });
return NextResponse.json({ uploadUrl: signedUrl, key });
```
- Document the 4.5 MB limit in CLAUDE.md for this project
- Add a client-side file size check (`file.size > 4 * 1024 * 1024`) before the upload request to give user a clear error

**Detection:**
- HTTP 413 with body `{"error":"FUNCTION_PAYLOAD_TOO_LARGE"}` (Vercel format, not your format)
- Vercel function logs show no invocation for the 413 — it's rejected at the edge layer

**Phase:** M5 (Uploads)

---

### Pitfall 12: In-memory circuit breaker isolation per Vercel instance — no shared state

**Severity:** CORRECTNESS (known limitation, requires explicit documentation)

**What goes wrong:**
The `CircuitBreaker` for Bictorys charges is a module-level singleton — correct for a single long-lived Node.js process. On Vercel, each function instance has its own module scope. If Bictorys starts returning 5xx errors, Instance A may open its circuit breaker while Instances B and C continue charging. The circuit never "opens" globally; the failure mode appears as intermittent errors (some requests succeed, some fail) instead of the intended fail-fast behavior.

**Why it happens:**
The template documents this as a known limitation. The risk is forgetting to document it in the monolith and shipping multi-instance prod without a plan.

**Consequences:**
- Circuit breaker provides no protection against Bictorys outages in multi-instance deployment
- Payment charge attempts continue to a failing upstream from most instances
- Billing for failed charge attempts may still occur

**Prevention:**
- Accept the single-instance limitation for initial projects (personal use, low concurrency)
- Document explicitly in `CLAUDE.md` under "Known Limitations"
- For high-scale projects: implement Redis-backed circuit breaker using Upstash atomic operations:
```typescript
// Redis-backed CB: use INCR + EXPIRE for failure counts, SET for circuit state
const failures = await redis.incr(`cb:bictorys:failures`);
if (failures === 1) await redis.expire(`cb:bictorys:failures`, 60);
const state = await redis.get(`cb:bictorys:state`);
if (state === 'OPEN') throw new Error('Circuit open');
```

**Detection:**
- Intermittent 500s on charge endpoint without corresponding Bictorys downtime
- Circuit breaker state resets on every cold start

**Phase:** M5 (Payments) — document at port time; defer Redis CB to per-project need

---

### Pitfall 13: Documentation drift — CLAUDE.md + README still describe Express patterns

**Severity:** CORRECTNESS (contributor confusion → security regressions)

**What goes wrong:**
CLAUDE.md currently describes the Express backend boot flow (raw-body-before-`express.json()`, `backend/src/index.ts`, `setInterval` crons with leader election, `backend/src/routes/` path structure). A new contributor (or future-you) reads these instructions and:
- Looks for `backend/src/routes/` (doesn't exist)
- Reads "mount webhooks BEFORE express.json()" and tries to recreate Express ordering in Next.js (unnecessary and confusing)
- Misses the actual invariant: "never call `await req.json()` before the webhook handler"

**Why it happens:**
Docs are not code. They don't fail CI. They decay silently every time a route is ported.

**Consequences:**
- New routes written following stale Express patterns
- Security invariants expressed in Express terms are misunderstood or bypassed
- Onboarding time increases for every future project fork

**Prevention:**
- Rewrite CLAUDE.md and README.md as M7 work, not optional polish
- The rewrite is a hard dependency for making this repo usable as a starter
- Key rewrites needed:
  - "Backend boot flow" → "App Router structure: `app/api/**` route handlers, each exports `runtime = 'nodejs'`"
  - "raw body BEFORE express.json()" → "never call `req.json()` before the webhook handler's `req.arrayBuffer()`"
  - "setInterval crons with withLease()" → "Vercel Cron scheduled route handlers at `app/api/cron/**`"
  - All `backend/src/lib/**` references → `src/lib/server/**`

**Detection:**
- CLAUDE.md mentions `express`, `backend/src/`, `setInterval`, `app.use()` anywhere after M7 complete

**Phase:** M7 (Docs) — treat as a hard deliverable, not optional cleanup

---

## Moderate Pitfalls

### Pitfall M1: `SameSite=Lax` and Server Actions — no double-submit CSRF needed for SA calls

**What goes wrong:**
Next.js Server Actions use POST and also verify `Origin === Host` automatically (built-in CSRF protection). The double-submit CSRF cookie check (`verifyCsrf`) is for Route Handlers (`app/api/` routes). If a developer pipes Server Action calls through the Route Handler pattern and forgets to attach the CSRF header, they get confusing 403s. Conversely, if they skip `verifyCsrf` on a Route Handler mutation thinking "Server Actions handle it," they have no CSRF protection.

**Prevention:**
- Route Handlers (`app/api/`) mutating state: always call `verifyCsrf(req)` at the top
- Server Actions (if used in UI): rely on Next.js built-in Origin check; do not add double-submit on top
- Keep auth route handlers as Route Handlers only — not Server Actions — to preserve full control over cookie lifecycle

**Phase:** M3+ (all mutating routes)

---

### Pitfall M2: Sentry `withSentryConfig` v9 breaking changes — `sentry` property on next.config removed

**What goes wrong:**
In `@sentry/nextjs` v9 (current in 2026), the `sentry` property on the Next.js config object is removed. Options must be passed directly to `withSentryConfig()`. If the template's `next.config.ts` uses the old pattern, the build silently ignores Sentry configuration — no source maps uploaded, no release name set, no tunnel configured.

Also: v9 no longer uses Next.js Build ID as fallback release identifier. Without an explicit `release.name` in `withSentryConfig`, error grouping in Sentry is broken (all errors land in "undefined" release).

**Prevention:**
```typescript
// next.config.ts — correct for @sentry/nextjs v9+
import { withSentryConfig } from '@sentry/nextjs';
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  silent: !process.env.CI,
});
// Do NOT add a `sentry:` key to nextConfig — it's removed in v9
```

**Phase:** M7 (Tooling)

---

### Pitfall M3: Notification `prisma.notification.create` called directly — dedup bypassed

**What goes wrong:**
`createNotification(prisma, input)` catches Prisma `P2002` (unique constraint on `dedupeKey`) to provide at-most-once delivery. Calling `prisma.notification.create()` directly skips the catch, so duplicate webhook events (Bictorys replay within the window) create duplicate notifications.

**Prevention:**
- Never call `prisma.notification.create()` in route code
- ESLint no-restricted-syntax rule targeting `prisma.notification.create` would catch it
- In code review: flag any `notification.create` not going through the wrapper

**Phase:** M4/M5 (any route that triggers notifications)

---

### Pitfall M4: `refresh` cookie path-scoping not enforced by Next.js — must be explicit

**What goes wrong:**
In Express, the refresh cookie was issued with `path: '/api/auth'` so it's only sent to refresh-related requests. In Next.js, cookie `path` is just metadata — Route Handlers receive all cookies regardless of path. The path scoping reduces the blast radius of a stolen refresh token (it can't be replayed against other `/api/*` routes), but developers must set it explicitly when issuing the cookie.

**Prevention:**
```typescript
// In setAuthCookies() — always set path on refresh cookie
cookieStore.set(`${COOKIE_PREFIX}-refresh`, refreshToken, {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60,
  path: '/api/auth', // blast-radius reduction — must be explicit
});
```

**Phase:** M3 (Auth)

---

### Pitfall M5: CVE-2025-29927 — Next.js middleware bypass via `x-middleware-subrequest`

**What goes wrong:**
Versions of Next.js below 15.2.3 / 14.2.25 are vulnerable to a CVSS 9.1 auth bypass: an attacker sends `x-middleware-subrequest: middleware` to skip all middleware execution entirely. Any auth gate placed in `middleware.ts` is bypassed without any credentials.

This project explicitly avoids auth in `middleware.ts` (uses HOF `requireAuth` in each route handler instead) — which is the correct mitigation regardless. However, if the Next.js version is not kept current, other middleware-based security features (rate limiting by IP, CORS) could be bypassed.

**Prevention:**
- Keep Next.js ≥ 15.2.3 (patch was released 2025-03-21)
- Do not place auth gates in `middleware.ts` — this project's HOF pattern is already correct
- Verify Vercel deployment target version in `package.json` engines field

**Phase:** M3 (Auth) — verify version at port start

---

## Minor Pitfalls

### Pitfall N1: `BICTORYS_API_KEY` vs `BICTORYS_PRIVATE_KEY` confusion — wrong key direction

**What goes wrong:**
`BICTORYS_API_KEY` is for charges (inbound payments), `BICTORYS_PRIVATE_KEY` is for payouts/withdrawals (outbound). Swapping them causes charge requests to fail authentication silently or withdrawal requests to be rejected.

**Prevention:** Document with explicit direction labels in `.env.example`. Code review: each file that uses one of these vars should have a comment explaining which direction it's for.

**Phase:** M5 (Payments/Withdrawals)

---

### Pitfall N2: `WITHDRAWAL_BALANCE_CHECK=0` — financial safety guard disabled without replacement

**What goes wrong:**
Setting `WITHDRAWAL_BALANCE_CHECK=0` disables the balance guard in `withdrawals/guards.ts`. If a developer does this for testing and forgets to re-enable it in prod, users can withdraw more than their balance.

**Prevention:** Add a startup assertion: if `NODE_ENV === 'production'` and `WITHDRAWAL_BALANCE_CHECK === '0'`, log a `logger.error` warning (not just `warn`). Do not block boot, but make it loud.

**Phase:** M5 (Withdrawals)

---

### Pitfall N3: Integer amounts — accidental decimals in payment/withdrawal amounts

**What goes wrong:**
FCFA amounts must be integers (no decimal subunit). If any calculation divides and produces a float (e.g., `amount * 0.9` for a fee calculation), then passes the result to Bictorys as a float, the provider rejects it or silently truncates.

**Prevention:** Add Zod validators that use `.int()` for all amount fields. Never perform floating-point arithmetic on amounts — use integer arithmetic only (`Math.floor(amount * 90 / 100)` not `amount * 0.9`).

**Phase:** M5 (Payments/Withdrawals)

---

### Pitfall N4: Admin `logAdminAction` call skipped in new admin routes

**What goes wrong:**
Every admin mutation (role change, cancel, etc.) must call `logAdminAction(prisma, {...})` to maintain the audit trail. Porting 9 admin endpoints creates 9 opportunities to miss this. The compliance gap is invisible at runtime.

**Prevention:** Add a code review checklist item: for every `POST`/`PUT`/`PATCH`/`DELETE` under `app/api/admin/`, verify `logAdminAction` is called before `return NextResponse.json(...)`. Consider wrapping admin mutations in a helper that forces the audit call.

**Phase:** M5 (Admin)

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|---------------|------------|
| M3 (Auth) | Cookie writes | Setting cookies in wrong execution context | All cookie writes in Route Handlers only |
| M3 (Auth) | DB connections | Missing `-pooler` in DATABASE_URL | Add pooled URL before first route lands |
| M3 (Auth) | Runtime | Forgetting `export const runtime = 'nodejs'` | Add to every route handler file |
| M4 (OAuth) | Cookie scoping | OAuth state/PKCE path too broad | Set `path: '/api/auth/oauth'` explicitly |
| M4 (OAuth) | email_verified | Removing the guard during port | Port test: attempt login with unverified email |
| M5 (Withdrawals) | Race condition | Advisory lock outside Serializable tx | Copy tx pattern verbatim from template |
| M5 (Payments) | Key confusion | `BICTORYS_API_KEY` vs `BICTORYS_PRIVATE_KEY` | Document direction in .env.example |
| M5 (Uploads) | Body size | Files > 4.5 MB hit Vercel limit before handler | Pre-signed URL pattern for large files |
| M5 (Admin) | Audit trail | `logAdminAction` skipped | Code review checklist |
| M6 (Webhooks) | HMAC | `req.json()` before handler | Never deserialize before `createWebhookHandler()` |
| M6 (Webhooks) | Runtime | `export const runtime = 'edge'` on webhook route | Always `nodejs` |
| M6 (Crons) | Batch size | 1 row per fire × 60s interval = backlog | Claim 100 rows per fire |
| M6 (Crons) | Timeout | 10s default cuts tx mid-batch | `maxDuration = 60`, stuck-row reset logic |
| M6 (Crons) | Secret leak | `CRON_SECRET` in error trace/log | Never log req.headers wholesale |
| M7 (Docs) | Doc drift | CLAUDE.md still describes Express | Hard rewrite — treat as deliverable |
| M7 (Tooling) | Sentry v9 | Old `sentry:` config key removed | Use `withSentryConfig` options directly |

---

## Sources

- [Vercel Functions Limitations (body size, duration)](https://vercel.com/docs/functions/limitations) — HIGH confidence
- [Vercel Cron Jobs — official docs](https://vercel.com/docs/cron-jobs) — HIGH confidence
- [Connect from Prisma to Neon — pooler setup](https://neon.com/docs/guides/prisma) — HIGH confidence
- [Deploy to Vercel | Prisma Documentation](https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel) — HIGH confidence
- [Sentry Next.js Manual Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) — HIGH confidence
- [Sentry Next.js v8 to v9 Migration](https://docs.sentry.io/platforms/javascript/guides/nextjs/migration/v8-to-v9/) — HIGH confidence
- [Next.js cookies() API Reference](https://nextjs.org/docs/app/api-reference/functions/cookies) — HIGH confidence
- [Next.js Data Security Guide](https://nextjs.org/docs/app/guides/data-security) — HIGH confidence
- [CVE-2025-29927 — Vercel postmortem](https://vercel.com/blog/postmortem-on-next-js-middleware-bypass) — HIGH confidence
- [Next.js Edge Runtime API Reference](https://nextjs.org/docs/app/api-reference/edge) — HIGH confidence
- [Prisma edge runtime incompatibility issue #24386](https://github.com/prisma/prisma/issues/24386) — MEDIUM confidence (GitHub issue, corroborated by official Prisma edge docs)
- [Vercel Cron CRON_SECRET issue #11303](https://github.com/vercel/vercel/issues/11303) — MEDIUM confidence (known issue, corroborated by official cron docs)
- [Next.js App Router webhook handler pattern — webhooks.cc](https://webhooks.cc/blog/nextjs-app-router-webhook-handler) — MEDIUM confidence (verified against official Next.js route handler docs)
