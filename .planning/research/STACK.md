# Technology Stack

**Project:** amadou-monolith
**Researched:** 2026-05-07
**Mode:** Brownfield port — stack already chosen, research focused on version verification, migration risks, and Vercel-native patterns.

---

## Recommended Stack (locked versions)

### Core Framework

| Technology | Locked Version | Purpose | Rationale |
|------------|---------------|---------|-----------|
| Next.js | **16.1.6** (keep) | Full-stack App Router monolith | Already in use; 16.x is current stable. See caveats re: `experimental.cacheComponents` below. |
| React | **19.2.3** (keep) | UI layer | Peer of Next 16.1 |
| TypeScript | **5.9.3** (keep) | Type safety | Strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` enforced |
| Node.js | **≥ 20.9.0** (keep) | Runtime | Minimum for Prisma 5/6; 20.18.1 in `.nvmrc` is fine |

### ORM / Database

| Technology | Locked Version | Purpose | Rationale |
|------------|---------------|---------|-----------|
| Prisma | **5.22.0** (keep — do NOT upgrade to 6 or 7 in v1) | ORM + migrations | See "Do NOT upgrade Prisma 7" below. 5.22 is current 5.x and stable. |
| `@prisma/client` | **5.22.0** | Prisma query engine | Keep in sync with `prisma` CLI |
| PostgreSQL (Neon) | n/a | Primary database | Pooled `DATABASE_URL` works without `?pgbouncer=true` since Prisma 5.10 + PgBouncer 1.22 — no `directUrl` needed for Neon |

**Neon + Prisma 5 connection URL pattern (MEDIUM confidence — verified via Neon + Prisma official docs):**
```
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neon?sslmode=require"
```
No `?pgbouncer=true` suffix, no separate `DIRECT_URL` required on Prisma 5.10+.

### Caching / Queue

| Technology | Locked Version | Purpose | Rationale |
|------------|---------------|---------|-----------|
| `@upstash/redis` | **1.34.3** (keep) | Rate limiting, outbox, cron leases | HTTP-based; serverless-safe; no TCP pool to exhaust per invocation |

### Auth

| Technology | Locked Version | Purpose | Rationale |
|------------|---------------|---------|-----------|
| `bcryptjs` | **2.4.3** (keep) | Password hashing | Pure JS; works in Node.js runtime (not edge, but that's explicit) |
| `jose` | **5.9.6** (keep) | JWT sign/verify | Works Node.js and edge. No update needed. |
| `arctic` | **3.7.0** (keep) | OAuth2 + PKCE | Sufficient for Google; no update needed. |
| `server-only` | **0.0.1** (keep) | Guard against accidental client imports | Zero-cost compile-time guard for `lib/server/**` |

### Storage / Email / Payments

| Technology | Locked Version | Purpose | Rationale |
|------------|---------------|---------|-----------|
| `@aws-sdk/client-s3` | **3.1037.0** (keep) | R2 file uploads | Stable; R2 is S3-compatible |
| `resend` | **6.12.2** (keep) | Transactional email | No breaking changes recently |
| Bictorys | HTTP REST (no SDK) | Charges + payouts | Keep. `PaymentProvider` interface allows swaps. |

### Observability

| Technology | Locked Version | Purpose | Rationale |
|------------|---------------|---------|-----------|
| `@sentry/nextjs` | **10.51.0** (keep) | Error tracking + tracing | See Sentry 10.x setup notes below. Already wired correctly. |

### Validation / Utilities

| Technology | Locked Version | Purpose | Rationale |
|------------|---------------|---------|-----------|
| `zod` | **3.23.8** (keep) | Runtime schema validation | Stable; no upgrade needed |
| `clsx` + `tailwind-merge` | keep | CSS utility | No changes |
| Tailwind CSS | **4.0.0** (keep) | Styling | No UI components ship; Tailwind for consuming apps |

### Test / Build

| Technology | Locked Version | Purpose | Rationale |
|------------|---------------|---------|-----------|
| Vitest | **2.1.8** (keep — do NOT upgrade to 3 in v1) | Unit tests | See "Do NOT upgrade Vitest 3" below |
| `tsx` | **4.19.2** (keep) | Script runner | Works with `prisma/scripts/*.ts` |
| ESLint | **9.18.0** (keep) | Lint | Flat config in place |
| Prettier | **3.4.2** (keep) | Format | Config in place |
| Turbopack | built-in Next 16 | Dev bundler | `next dev --turbopack`; for dev only |

---

## Vercel-Native Patterns (HIGH confidence — verified against Vercel official docs)

### Route Handler Runtime Declaration

Every API route that uses Prisma, bcrypt, jose, or Node-only APIs **must** declare Node.js runtime explicitly:

```typescript
// src/app/api/auth/login/route.ts
export const runtime = 'nodejs';  // REQUIRED — Prisma + bcryptjs are Node-only
```

Omitting this on Vercel may cause routes to be attempted in edge if auto-detection fails. All 50+ API routes in this project should carry this export.

### `export const dynamic = 'force-dynamic'`

**Still valid in Next.js 16.1** for API routes that must not be statically cached. Use it on any route reading `cookies()`, `headers()`, or making external calls that must run per-request.

**Caveat (LOW risk for this project):** The `export const dynamic` config becomes incompatible only if `nextConfig.experimental.cacheComponents` (Next.js 16's PPR opt-in) is enabled. This project does NOT ship UI pages or enable `cacheComponents`, so there is no conflict. Do not enable `cacheComponents` in `next.config.ts` — it is irrelevant for a headless API monolith.

### Raw Body / Webhook Pattern

`req.arrayBuffer()` is the correct App Router idiom for preserving byte-identical body for HMAC:

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rawBody = await req.arrayBuffer();
  // Pass Buffer.from(rawBody) to HMAC verifier — never req.json() first
}
```

The existing `frontend/src/lib/server/webhook/handler.ts` already implements this correctly. Do not change it.

### FormData / File Upload (Multer Replacement)

Multer does not work in App Router. Use native Web API:

```typescript
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file') as File;
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  // magic-byte sniff buffer before writing/uploading
}
```

No external library needed. `req.formData()` is the canonical replacement.

### Vercel Cron Auth Pattern (HIGH confidence — Vercel official docs)

Vercel automatically forwards `CRON_SECRET` as `Authorization: Bearer <secret>` on every scheduled invocation. The verification pattern is:

```typescript
// src/app/api/cron/outbox-drain/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ... drain logic
}
```

**`vercel.json` schedule format (HIGH confidence):**

```json
{
  "crons": [
    { "path": "/api/cron/outbox-drain",        "schedule": "* * * * *" },
    { "path": "/api/cron/email-queue-drain",   "schedule": "* * * * *" },
    { "path": "/api/cron/order-expiration",    "schedule": "*/5 * * * *" },
    { "path": "/api/cron/verification-cleanup","schedule": "0 * * * *" },
    { "path": "/api/cron/webhook-log-purge",   "schedule": "0 0 * * *" }
  ]
}
```

Minimum Vercel free tier interval is 1 minute (`* * * * *`). The original Express `setInterval` ran outbox/email every 5 seconds — cron handlers must drain more rows per invocation to compensate (drain 100 rows per call instead of 1).

`CRON_SECRET` must be set in Vercel Environment Variables and locally in `.env`. Generate with `openssl rand -base64 32`.

### proxy.ts (formerly middleware.ts) — Next.js 16

Next.js 16 renamed `middleware.ts` → `proxy.ts`. The exported function becomes `proxy` instead of `middleware`. The runtime is Node.js only (edge is no longer supported for this file). This project does not currently ship a middleware file, so no migration is needed in v1 — just be aware when adding proxy/routing logic later.

---

## Sentry 10.x with Next.js 16 (HIGH confidence — Sentry official docs)

### What is already correct
- `instrumentation.ts` as the Sentry init entry point is the right pattern.
- `experimental.instrumentationHook` in `next.config.ts` is no longer required on Next.js 15+. Remove it if present.
- `withSentryConfig()` wrapper in `next.config.ts` handles source map upload.

### Source Map Upload for Vercel
Add to Vercel Environment Variables:
- `SENTRY_AUTH_TOKEN` — from Sentry CI integration
- `SENTRY_ORG` — Sentry org slug
- `SENTRY_PROJECT` — Sentry project slug

`withSentryConfig` auto-uploads source maps on `next build`. No manual CI step needed when deploying via Vercel git integration.

### Deprecated APIs to avoid (Sentry 8+ / applies to 10.x)
- `nextRouterInstrumentation` — removed; use `browserTracingIntegration` instead
- `startTransaction` / `span.startChild` — removed; use OpenTelemetry spans
- The existing `captureRouteError()` helper in `lib/server/sentry.ts` wraps the supported API and is fine.

### instrumentation.ts shape (Next.js 16 / Sentry 10)
```typescript
// src/instrumentation.ts
import { registerOTel } from '@vercel/otel';  // optional, only if adding OTel traces

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Required for Sentry to capture server-side errors in Next 15+
export { onRequestError } from '@sentry/nextjs';
```

The `onRequestError` export is important — without it, unhandled route errors won't be automatically captured by Sentry in Next.js 15+.

---

## Version Upgrade Decisions

### Do NOT upgrade to Prisma 6 or 7 in v1 (HIGH confidence)

**Prisma 6 breaking changes:**
- Implicit many-to-many PostgreSQL relation table changes require a migration immediately after upgrade
- `fullTextSearch` for PostgreSQL renamed to `fullTextSearchPostgres` preview flag

**Prisma 7 breaking changes (too risky for a port milestone):**
- Ships as ESM-only — requires `"type": "module"` in `package.json` and `"module": "ESNext"` in tsconfig
- Driver adapters are now **required** for all databases; cannot instantiate `PrismaClient` without one (e.g., `@prisma/adapter-pg`)
- `prisma.config.ts` required for migrations; env vars no longer auto-loaded from `.env`
- `output` field required in generator block; client no longer generated into `node_modules`
- Generated client location moves to project source code, not `node_modules/@prisma/client`

These are fundamental architectural changes. Upgrading mid-port would add significant risk with zero feature benefit. **Stay on Prisma 5.22 for v1. Prisma 7 migration is a separate milestone after v1 ships.**

### Do NOT upgrade to Vitest 3 in v1 (MEDIUM confidence)

Vitest 3 ships with Vite 6 as peer dependency. The project uses Turbopack (Next.js built-in) for dev, not Vite. There is no Vite config in this project. Vitest 2.x can run independently of Vite version for pure Node.js unit tests (the test suite covers `lib/server/**`, not browser/RSC code). Upgrading to Vitest 3 risks Vite 6 peer dep conflicts without benefit. **Stay on Vitest 2.1.8 for v1.**

### Prisma 5 `server-only` guard pattern

```typescript
// src/lib/server/prisma.ts
import 'server-only';
import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
```

The `globalThis` singleton pattern prevents multiple `PrismaClient` instances during hot-reload in `next dev`. **Required** for Next.js App Router — Prisma 5 does not auto-deduplicate instances.

---

## What to Avoid

| Pattern | Why | Instead |
|---------|-----|---------|
| `import 'express'` anywhere | Not available; would require adding Express as dep unnecessarily | Native `NextRequest` / `NextResponse` |
| `req.json()` before HMAC in webhooks | Consumes body stream; re-serialized bytes ≠ original bytes; HMAC fails | `req.arrayBuffer()` first, then `Buffer.from(...)` |
| `multer` | Does not work with App Router | `req.formData()` + native `File.arrayBuffer()` |
| `setInterval` crons | Not supported in Vercel serverless functions (process does not persist) | Vercel Cron + `/api/cron/*` route handlers gated by `CRON_SECRET` |
| `export const runtime = 'edge'` on any route using Prisma/bcryptjs | Edge runtime lacks Node.js APIs; Prisma 5 standard client is Node.js-only | `export const runtime = 'nodejs'` |
| `experimental.instrumentationHook: true` in `next.config.ts` | Deprecated since Next.js 15; causes warning | Remove it; `instrumentation.ts` is auto-discovered |
| `nextRouterInstrumentation` in Sentry config | Removed in Sentry 8+ | `browserTracingIntegration` |
| `export const dynamic = 'force-dynamic'` + `experimental.cacheComponents: true` | Incompatible in Next.js 16 | Do not enable `cacheComponents` for this headless project |
| Prisma 7 upgrade in v1 | ESM-only + required driver adapters + prisma.config.ts = full rewrite of Prisma setup | Stay on 5.22; plan Prisma 7 as a post-v1 milestone |
| `NEXT_PUBLIC_API_URL` pointing at a separate Express backend | The whole point of this project is no separate backend | All API routes are `/api/*` within the same Next.js app |
| Calling `prisma.notification.create` directly | Skips dedup P2002 catch | `createNotification(prisma, input)` |

---

## Configuration Files

### `next.config.ts` shape
```typescript
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Do NOT add experimental.cacheComponents — incompatible with force-dynamic API routes
  // Do NOT add experimental.instrumentationHook — deprecated since Next.js 15
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
```

### `vercel.json` shape (add to repo root)
```json
{
  "crons": [
    { "path": "/api/cron/outbox-drain",         "schedule": "* * * * *" },
    { "path": "/api/cron/email-queue-drain",    "schedule": "* * * * *" },
    { "path": "/api/cron/order-expiration",     "schedule": "*/5 * * * *" },
    { "path": "/api/cron/verification-cleanup", "schedule": "0 * * * *" },
    { "path": "/api/cron/webhook-log-purge",    "schedule": "0 0 * * *" }
  ]
}
```

### `.env.example` additions needed
```
# Vercel Cron auth (generate: openssl rand -base64 32)
CRON_SECRET=
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| ORM | Prisma 5.22 | Drizzle ORM | Entire schema + migration history is in Prisma; swapping mid-port is a separate project |
| ORM version | Prisma 5.22 | Prisma 7 | ESM-only + required driver adapters are breaking changes incompatible with v1 scope |
| Background jobs | Vercel Cron + route handlers | Long-running worker (Fly.io / Railway) | Contradicts Vercel-first deployment goal; crons are sufficient for the 5-minute batch cadence |
| File upload | Native `req.formData()` | Formidable | Unnecessary dep; native API is sufficient |
| Testing | Vitest 2.1.8 | Vitest 3 | Vite 6 peer dep churn; no benefit for Node-only lib tests |
| Cron auth | `Authorization: Bearer CRON_SECRET` | IP allowlist | IP allowlist is not reliable on Vercel; bearer token is Vercel's documented pattern |
| Prisma Postgres pooling | Neon pooled URL (no extra params) | `?pgbouncer=true` + `directUrl` | No longer needed since Prisma 5.10 + PgBouncer 1.22 |

---

## Sources

- Next.js 16 upgrade guide: https://nextjs.org/docs/app/guides/upgrading/version-16
- Next.js Route Segment Config: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- Next.js proxy.ts (formerly middleware): https://nextjs.org/docs/messages/middleware-to-proxy
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Vercel Cron auth: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Prisma upgrade to v6: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-6
- Prisma upgrade to v7: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
- Prisma Neon guide: https://neon.com/docs/guides/prisma
- Prisma PgBouncer (no longer requires pgbouncer=true): https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer
- Sentry Next.js manual setup: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
- Sentry Next.js source maps: https://docs.sentry.io/platforms/javascript/guides/nextjs/sourcemaps/
- Vitest 3 release notes: https://vitest.dev/blog/vitest-3
- Next.js webhook handler (arrayBuffer pattern): https://dev.to/huangyongshan46a11y/nextjs-16-webhook-handler-pattern-stripe-github-and-more-2bgh
- Next.js formData upload (multer replacement): https://medium.com/@alexandre.penombre/file-upload-with-next-js-14-app-router-6cb0e594e778
