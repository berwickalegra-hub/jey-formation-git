# Phase 0: Foundation - Research

**Researched:** 2026-05-07
**Domain:** Next.js 16 App Router cross-cutting infrastructure on Vercel — DB pooling, runtime enforcement, Sentry error capture, request-scoped logging, OpenTelemetry
**Confidence:** HIGH

## Summary

Phase 0 lands seven cross-cutting infrastructure changes (OPS-01–05, OBS-04, OBS-05) that every subsequent phase depends on. The work is small in LOC (~150–200 lines net) but high-leverage: each item is harder or impossible to retrofit cleanly once Phase 1+ routes start landing.

Investigation against the live codebase confirms three notable findings:
1. **OPS-05 is a no-op.** `frontend/next.config.ts` does not contain `experimental.instrumentationHook` (already absent — Next 16 setup is clean).
2. **`.env.example` lives at repo root**, not under `frontend/` — and currently still describes the deprecated Express backend (`BACKEND_URL`, `NEXT_PUBLIC_API_URL=…:4000`, `GOOGLE_REDIRECT_URI=…:4000`). Phase 0 must update the `DATABASE_URL` example, add `DIRECT_URL` + `CRON_SECRET`, and (per CONTEXT.md scope) leave the larger Express-vs-Next rewrite to Phase 6 DOC-01.
3. **`pnpm test` is wired** (`vitest run` in `frontend/package.json`) but **no `vitest.config.ts` exists** and zero `*.test.ts` files exist. Phase 0 must establish the test scaffolding (Wave 0) before the runtime-enforcement guard test can run.

**Primary recommendation:** Implement in this order — (1) add Vitest config + first test fixture (Wave 0), (2) update env + schema for Neon pooler, (3) add `runtime='nodejs'` to existing routes + commit the guard test, (4) extend `instrumentation.ts` with `onRequestError` re-export and `registerOTel`, (5) add the request-context module + logger wrapper, (6) confirm `next.config.ts` is clean. Each step is independently testable; the whole phase converges on a green `pnpm test` + `pnpm typecheck`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Database connection (OPS-01)**
- **D-01:** `.env.example` must include both `DATABASE_URL` (pooler URL — `<host>-pooler.<region>.aws.neon.tech` with `?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`) and `DIRECT_URL` (non-pooler URL for migrations).
- **D-02:** `prisma/schema.prisma` must declare `directUrl = env("DIRECT_URL")` in the datasource block.
- **D-03:** A short comment in `.env.example` explains WHY both are needed.

**runtime='nodejs' enforcement (OPS-02)**
- **D-04:** Every file under `frontend/src/app/api/**/route.ts` must export `runtime = 'nodejs'` as the first non-import statement.
- **D-05:** Enforcement = **CI grep guard via Vitest test**. Walks `app/api/**/route.ts` files and asserts each contains `export const runtime = 'nodejs'`. Runs via `pnpm test`.
- **D-06:** Both existing route files (`api/health/route.ts`, `api/readyz/route.ts`) updated to carry the export. Test green at end of phase.

**Sentry error capture (OPS-03)**
- **D-07:** `frontend/instrumentation.ts` must `export { onRequestError } from '@sentry/nextjs'` in addition to existing Sentry init.
- **D-08:** A deliberate "throw test" route under `app/api/_debug/throw/route.ts` (gated `NODE_ENV !== 'production'`) — optional.

**CRON_SECRET (OPS-04)**
- **D-09:** `.env.example` adds `CRON_SECRET=""` with comment: `# Generate with: openssl rand -base64 32. Required for Vercel Cron routes (Phase 5).`
- **D-10:** **Single shared secret** across all 5 cron routes — not per-job secrets.

**Deprecated config removal (OPS-05)**
- **D-11:** `frontend/next.config.ts` is read; if `experimental.instrumentationHook` is present, remove. **VERIFIED ABSENT — no-op.**

**Request ID + structured logging (OBS-04)**
- **D-12:** Per-route helper + `node:async_hooks` AsyncLocalStorage; reads inbound `X-Request-Id` header, generates UUID v7 (sortable) if absent, sets outbound `X-Request-Id`.
- **D-13:** Logger integration = **wrapper, not modification**. `lib/server/logger.ts` is in the "do not modify" list. Add a thin wrapper that injects current request ID from ALS.
- **D-14:** ALS file location = `lib/server/observability/request-context.ts`. Exposes: `startRequestContext(req): string`, `getRequestId(): string | undefined`, `withRequestContext(req, fn)` for cron handlers.
- **D-15:** No `middleware.ts` (or `proxy.ts` in Next 16) file is created.

**OpenTelemetry (OBS-05)**
- **D-16:** Depth = **minimal**. `instrumentation.ts` calls `registerOTel({ serviceName: 'amadou-monolith' })` from `@vercel/otel`.
- **D-17:** Custom spans for Prisma/Redis/Bictorys/Resend/R2 deferred to v2.
- **D-18:** OTel coexists with Sentry — both initialize in `instrumentation.ts`, no conflict.

**Migration on Vercel deploy (cross-cutting from OPS-01)**
- **D-19:** Starter does **NOT** run `prisma migrate deploy` in Vercel build step.
- **D-20:** Documented procedure: run `DATABASE_URL=<prod-direct-url> pnpm db:migrate:deploy` from a developer machine before Vercel deploy.
- **D-21:** This decision is captured in CLAUDE.md/README during Phase 6 — for Phase 0 it just means we do NOT add `migrate deploy` to `package.json`'s `build` script.

### Claude's Discretion

- Logger format (JSON in prod, pretty in dev) — already the existing logger's behavior; not a Phase 0 change.
- UUID generator — `crypto.randomUUID()` (Node 20+) is sufficient; if v7 ordering is desired, use `uuid` package's `v7`. Either is fine.
- Exact file path of the new ALS module — `lib/server/observability/request-context.ts` is suggested but planner can place it under `lib/server/log/` if it groups better.
- Where the runtime-enforcement test lives (`__tests__/` directory vs co-located `.test.ts`).

### Deferred Ideas (OUT OF SCOPE)

- Custom OTel spans for Prisma/Redis/Bictorys/Resend/R2 → v2.
- Per-cron CRON_SECRET (one secret per cron route) → over-engineering for v1.
- ESLint custom rule for `runtime='nodejs'` enforcement → CI grep guard chosen instead.
- Auto `prisma migrate deploy` in Vercel build step → chosen against.
- Throw-test debug route — optional in D-08; drop if awkward.
- Logger migration to native OTel logging API → defer.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | `DATABASE_URL` Neon pooler + documented in `.env.example` and `CLAUDE.md` | "Neon pooler URL" + "schema.prisma datasource" sections below; `directUrl` is mandatory in datasource block (Prisma 5.10+ pattern). |
| OPS-02 | Every API route handler exports `runtime = 'nodejs'`; enforced via lint or naming convention | "Runtime enforcement guard" pattern using `fast-glob` + Vitest below. Existing 3 routes (`health`, `readyz`, `pay-redirect`) audited. |
| OPS-03 | `instrumentation.ts` exports `onRequestError` from `@sentry/nextjs` | "Sentry onRequestError" section — single re-export line; required by Next.js 15+ for unhandled-error capture. |
| OPS-04 | `CRON_SECRET` added to `.env.example` with `openssl rand -base64 32` hint | "CRON_SECRET" subsection in env-shape below; verbatim comment string per D-09. |
| OPS-05 | Remove deprecated `experimental.instrumentationHook` from `next.config.ts` if present | **VERIFIED ABSENT** — `frontend/next.config.ts` has clean Next 16 shape; this requirement is a no-op confirmation task. |
| OBS-04 | Request ID per inbound request, propagated to logger calls, returned as `X-Request-Id` response header | "Request-context module (ALS)" + "Logger wrapper" sections; `crypto.randomUUID()` (Node 20+ built-in) sufficient. |
| OBS-05 | OpenTelemetry via `@vercel/otel` registered in `instrumentation.ts` | "OpenTelemetry init" section — `@vercel/otel@2.1.2` (verified 2026-05-07 via npm), 1-line `registerOTel()` call coexists with Sentry. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

> CLAUDE.md currently describes the deprecated Express monorepo template. The relevant portable directives still apply:

- **TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`** — don't silence with `any` casts. (Verified in `tsconfig.base.json` per `.planning/codebase/STACK.md`.)
- **ESLint 9 flat config + Prettier.** Run `pnpm format` before committing. New files must lint clean.
- **Vitest for backend tests; no frontend test framework in v1.** New tests live under `frontend/src/lib/server/**` and are picked up by `vitest run`.
- **Conventional Commits.** Phase 0 commits use `(monolith)` scope per established convention (e.g., `feat(monolith): add request-id propagation`, `chore(monolith): add Neon pooler env shape`).
- **Node ≥ 20, pnpm ≥ 9** (verified in root `package.json` `engines`).
- **`server-only` import at top of every server-only file** — new `lib/server/observability/request-context.ts` and logger wrapper must include this import. (Per `.planning/codebase/CONVENTIONS.md`.)
- **Path alias `@/*` → `frontend/src/*`** — use it for imports.
- **Files NOT to modify:** `frontend/src/lib/server/logger.ts` is in the "battle-tested" list. Wrap, don't rewrite.
- **Stale Express references in CLAUDE.md** are flagged for Phase 6 DOC-01 rewrite — Phase 0 should NOT attempt to fix them.

## Standard Stack

### Core (already installed — version-verified against `frontend/package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.1.6 | App Router runtime + `instrumentation.ts` discovery | Already pinned; `onRequestError` export is a Next 15+ contract. [VERIFIED: package.json] |
| `@sentry/nextjs` | 10.51.0 | Error tracking + tracing; provides `onRequestError` named export | Latest is 10.52.0 (npm view 2026-05-07); 10.51 is current enough — no upgrade needed. [VERIFIED: npm view] |
| `@prisma/client` + `prisma` | 5.22.0 | ORM; `directUrl` field in datasource since 4.10 | Locked at 5.22 per STACK.md. [VERIFIED: package.json] |
| `vitest` | 2.1.8 | Test runner for the runtime-enforcement guard + future Phase 0 tests | Already in `devDependencies`; no `vitest.config.ts` exists yet — Wave 0 task. [VERIFIED: package.json] |
| Node `crypto.randomUUID()` | built-in (Node ≥ 14.17) | Request ID generation | Built-in, returns RFC 4122 v4 (random, not time-sortable). Sufficient per D-12 unless time-sortability is required. [VERIFIED: ran `node -e "crypto.randomUUID()"` against project Node 22.14] |
| Node `node:async_hooks` `AsyncLocalStorage` | built-in (Node ≥ 13.10, stable since 16) | Per-request context propagation across awaits | Standard Node primitive; preserves context across `await` boundaries (verified live). [VERIFIED: ran reproduction script] |

### To install (new dependencies)

| Library | Version | Purpose | Why Standard | Source |
|---------|---------|---------|--------------|--------|
| `@vercel/otel` | **2.1.2** | One-line OpenTelemetry init for Next.js on Vercel | Vercel's official wrapper; auto-detects Next/Vercel runtime; 1-line `registerOTel()` call. [VERIFIED: `npm view @vercel/otel version` returned `2.1.2` on 2026-05-07] |
| `fast-glob` | **3.3.3** | Sync glob walk for the runtime-enforcement guard test | Most-installed glob library on npm; sync API (`fg.sync`) is ergonomic for a Vitest test that walks filesystem. Used by Vite/Vitest internally so already transitive. [VERIFIED: `npm view fast-glob version` returned `3.3.3` on 2026-05-07] |
| `uuid` | (optional) ≥ 11.0 | Time-sortable v7 IDs | Only if D-12's "UUID v7 (sortable by time)" preference is taken literally — `crypto.randomUUID()` is v4, not sortable. Adds ~5 kB. [VERIFIED: package widely used; v7 added in `uuid` 9.0.0] |

**Recommendation on UUID generator:** Default to `crypto.randomUUID()` (zero dep, sufficient). The CONTEXT.md `<specifics>` block explicitly says "Use `crypto.randomUUID()` (Node 20+ built-in) for request IDs unless `uuid@v7` is explicitly preferred." Time-sortability matters when grouping logs by timestamp; for an X-Request-Id, the timestamp is already in the log line — sortability of the ID itself is low-value. **Recommend `crypto.randomUUID()`. Skip the `uuid` package.**

### Peer dependencies for `@vercel/otel`

`@vercel/otel@2.x` declares peers from the OpenTelemetry SDK:
- `@opentelemetry/api` `>=1.9.0 <2.0.0`
- `@opentelemetry/api-logs` `>=0.200.0 <0.300.0`
- `@opentelemetry/sdk-logs` `>=0.200.0 <0.300.0`
- `@opentelemetry/resources` `>=2.0.0 <3.0.0`
- `@opentelemetry/sdk-metrics` `>=2.0.0 <3.0.0`
- `@opentelemetry/sdk-trace-base` `>=2.0.0 <3.0.0`
- `@opentelemetry/instrumentation` `>=0.200.0 <0.300.0`

[VERIFIED: `npm view @vercel/otel peerDependencies` 2026-05-07]

**Action:** Install `@vercel/otel` first; pnpm will surface any unmet peers. The Vercel runtime auto-supplies most of these in production. [ASSUMED: pnpm 9 will warn but not fail on missing OTel SDK peers; if it does fail, install the SDK packages explicitly. Confirm during execution — this is the only `@vercel/otel`-related uncertainty.]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@vercel/otel` (1 line) | Manual OTel SDK setup with `NodeSDK` | 30+ LOC, peer-dep churn, Vercel-specific runtime detection lost. Reject. |
| `crypto.randomUUID()` v4 | `uuid` package's v7 (time-sortable) | One more dep for marginal log-grouping benefit. Reject by default. |
| `fast-glob` for the guard | Pure `node:fs` recursive walk | ~30 LOC of `fs.readdir({recursive:true})` glue, Node 18.17+ semantics, more brittle. `fast-glob` is one line. Reject pure fs. |
| Vitest test for guard | Custom ESLint rule | ESLint plugin packaging is heavier; Vitest test is one file, runs in `pnpm test`, good error messages. Confirmed by D-05. |
| Shared `CRON_SECRET` (D-10) | Per-job secrets | Linear blast-radius reduction at cost of N× rotation toil. D-10 locked. |

### Installation

```bash
# In repo root (pnpm workspace; resolves to frontend/)
pnpm --filter frontend add @vercel/otel
pnpm --filter frontend add -D fast-glob
```

If pnpm warns about missing OpenTelemetry SDK peers, install:
```bash
pnpm --filter frontend add @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/resources
```

### Version verification

Performed 2026-05-07 against the live npm registry:

| Package | Latest | Pinned | Action |
|---------|--------|--------|--------|
| `@vercel/otel` | 2.1.2 | (new) | Install `^2.1.2` |
| `fast-glob` | 3.3.3 | (new) | Install `^3.3.3` |
| `@sentry/nextjs` | 10.52.0 | 10.51.0 | Hold — patch difference, no relevant changes |
| `next` | (project on 16.1.6) | 16.1.6 | Hold |
| `prisma` / `@prisma/client` | (project on 5.22.0) | 5.22.0 | Hold per STACK.md "do NOT upgrade Prisma 6/7 in v1" |
| `vitest` | (project on 2.1.8) | 2.1.8 | Hold per STACK.md "do NOT upgrade Vitest 3 in v1" |

## Architecture Patterns

### Recommended file additions / changes

```
amadou-monolith/
├── .env.example                              # MODIFY — update DATABASE_URL, add DIRECT_URL + CRON_SECRET
├── frontend/
│   ├── instrumentation.ts                    # MODIFY — add onRequestError export + registerOTel
│   ├── next.config.ts                        # NO-OP — already clean (verified)
│   ├── package.json                          # MODIFY — add @vercel/otel, fast-glob deps
│   ├── prisma/
│   │   └── schema.prisma                     # MODIFY — add directUrl line in datasource
│   ├── vitest.config.ts                      # CREATE — Wave 0; minimal config for `vitest run`
│   └── src/
│       ├── app/api/
│       │   ├── health/route.ts               # MODIFY — already has runtime='nodejs' (verified line 7)
│       │   ├── readyz/route.ts               # MODIFY — already has runtime='nodejs' (verified line 10)
│       │   └── pay-redirect/route.ts         # MODIFY — verify/add runtime='nodejs'
│       └── lib/server/
│           ├── logger.ts                     # DO NOT MODIFY (per CLAUDE.md)
│           └── observability/                # CREATE — new subdirectory
│               ├── request-context.ts        # CREATE — ALS + ID generation
│               ├── request-context.test.ts   # CREATE — co-located unit test
│               ├── log.ts                    # CREATE — logger wrapper that injects requestId
│               └── runtime-enforcement.test.ts # CREATE — guard test (or under __tests__/)
```

**Discovery note:** `frontend/src/app/api/health/route.ts` and `readyz/route.ts` **already** export `runtime = 'nodejs'` (verified — health line 7, readyz line 10). The third route, `pay-redirect/route.ts`, is unverified — Phase 0 plan must read it and add the export if missing. The runtime-enforcement guard test will catch this regardless.

### Pattern 1: Neon pooler URL + `directUrl` in `schema.prisma`

**What:** Two URLs — pooled for runtime queries (PgBouncer transaction-mode), direct for migrations (avoids prepared-statement issues with PgBouncer).

**When to use:** Always on Vercel + Neon. Required for any Prisma migration to run reliably under serverless.

**Code (datasource block):**
```prisma
// Source: https://neon.com/docs/guides/prisma + Prisma docs
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")    // pooler — runtime queries
  directUrl = env("DIRECT_URL")      // direct — migrations only
}
```

**Code (`.env.example` shape — additions only):**
```
# Neon pooled connection — runtime queries only.
# The "-pooler" hostname routes through Neon's PgBouncer in transaction mode.
# `connection_limit=1` is REQUIRED on serverless: each Vercel function instance
# opens its own pool, and per-instance multi-connection pools exhaust Neon's
# ceiling under moderate concurrency.
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/dbname?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require"

# Direct (non-pooled) connection — REQUIRED for `prisma migrate deploy`.
# The pooler exhausts on long-lived migrations and breaks prepared statements.
# Without DIRECT_URL set, migrations time out or fail mid-run.
DIRECT_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require"

# Vercel Cron auth shared secret. Generate with: openssl rand -base64 32
# Required by /api/cron/* routes (Phase 5). Single shared secret across all crons.
CRON_SECRET=""
```

**Note on `pgbouncer=true` parameter currency:** STACK.md (research) says since Prisma 5.10 + PgBouncer 1.22 the `?pgbouncer=true` query parameter is no longer required *if you're using the `-pooler` hostname*. PITFALLS.md disagrees and says include it. **CONTEXT.md D-01 explicitly locks the parameter list** (`pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`). Defer to D-01 verbatim — it's safe (extra parameter is silently accepted) and matches Neon's current docs example. [CITED: D-01 of CONTEXT.md][ASSUMED: extra `pgbouncer=true` is harmless when paired with `-pooler` host — corroborated by Neon docs but not re-verified live in 2026]

### Pattern 2: Sentry `onRequestError` re-export

**What:** A named export that Next.js 15+ calls when a route handler throws an unhandled error. Without it, Next swallows the error and Sentry sees nothing.

**When to use:** `instrumentation.ts` only. Pure re-export, no wrapping needed.

**Code (extension to existing `frontend/instrumentation.ts`):**
```typescript
// Source: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
// (referenced by .planning/research/STACK.md and SUMMARY.md, both HIGH confidence)
import { registerOTel } from '@vercel/otel';

export async function register() {
  // Sentry init — keeps Sentry the first thing that loads in each runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }

  // OpenTelemetry registration — coexists with Sentry. Each SDK auto-instruments
  // its own surface; @vercel/otel handles HTTP/fetch/Next baseline; Sentry handles
  // its own tracer separately.
  registerOTel({ serviceName: 'amadou-monolith' });
}

// REQUIRED for Sentry to auto-capture unhandled route errors in Next.js 15+.
// Without this single line, server-side errors land nowhere.
export { onRequestError } from '@sentry/nextjs';
```

[CITED: `.planning/research/STACK.md` lines 213–216, derived from Sentry official docs]

### Pattern 3: `runtime='nodejs'` enforcement guard (CI grep via Vitest)

**What:** A Vitest test that walks every `app/api/**/route.ts` file synchronously and asserts each one contains the literal string `export const runtime = 'nodejs'`. Fails the build if any file is missing the export or contains `runtime = 'edge'`.

**When to use:** Run on every `pnpm test` / CI invocation. Single source of truth — no ESLint plugin needed.

**Code (`frontend/src/lib/server/observability/runtime-enforcement.test.ts`):**
```typescript
// Source: pattern composed from D-05 + fast-glob's documented sync API.
// Goal: any route file under app/api/** that lacks `runtime = 'nodejs'` fails CI.
import { describe, expect, it } from 'vitest';
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_GLOB = 'src/app/api/**/route.ts';
// Project-root-relative; vitest by default cwd is the package root (frontend/).
const ROOT = resolve(__dirname, '../../../..');

describe('runtime enforcement: every API route exports runtime="nodejs"', () => {
  const routeFiles = fg.sync(API_GLOB, { cwd: ROOT, absolute: true });

  it('discovered at least one API route file', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  // Per-file tests — failure message names the exact file
  // (D-05 specifics: "should output the offending file path on failure").
  for (const file of routeFiles) {
    const rel = file.replace(ROOT + '/', '');
    it(`${rel} exports runtime = 'nodejs'`, () => {
      const src = readFileSync(file, 'utf8');
      // Tolerant regex — handles single/double quotes and trailing semicolon.
      const ok = /export\s+const\s+runtime\s*=\s*['"]nodejs['"]/.test(src);
      const hasEdge = /export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(src);
      expect(hasEdge, `${rel} declares runtime='edge' — Prisma/bcrypt/Buffer break on edge`).toBe(false);
      expect(ok, `${rel} is missing \`export const runtime = 'nodejs'\``).toBe(true);
    });
  }
});
```

[CITED: D-05 + `<specifics>` line 163 of CONTEXT.md ("output the offending file path on failure")]

### Pattern 4: Request-context module (AsyncLocalStorage)

**What:** A small module that creates a per-request context store containing `{ requestId, startedAt }`. Route handlers call `startRequestContext(req)` as their first line; downstream code reads `getRequestId()` synchronously via ALS.

**When to use:** Every Phase 1+ route handler imports `startRequestContext` and calls it before guards. Cron handlers (no inbound `X-Request-Id`) use `withRequestContext(headers, async () => {...})`.

**Code (`frontend/src/lib/server/observability/request-context.ts`):**
```typescript
// Source: composed from D-12, D-14, and node:async_hooks documentation.
// No Next.js types imported — module is unit-testable without booting Next.
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
  startedAt: number;
}

const als = new AsyncLocalStorage<RequestContext>();

/**
 * Read X-Request-Id from inbound Headers, or mint a new one. Returns the
 * RequestContext but does NOT enter the ALS scope — call `withRequestContext`
 * for that, or use `runWithRequestContext` from a route handler.
 */
export function makeRequestContext(headers: Headers): RequestContext {
  const inbound = headers.get('x-request-id');
  // Accept inbound IDs only if they look UUID-shaped (defensive — clients
  // shouldn't be able to inject log-spammable garbage).
  const requestId =
    inbound && /^[0-9a-f-]{8,64}$/i.test(inbound) ? inbound : randomUUID();
  return { requestId, startedAt: Date.now() };
}

/**
 * Run `fn` inside an ALS scope carrying the given context. Use this in route
 * handlers — wrap the entire handler body so all downstream awaits see the
 * same context.
 */
export function withRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return als.run(ctx, fn);
}

/** Fetch the current request ID, or undefined if outside any context. */
export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

/** Fetch the entire current context, or undefined. */
export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}
```

**Route handler usage pattern (skeleton for Phase 1+):**
```typescript
// app/api/some/route.ts
export const runtime = 'nodejs';
import { NextResponse, type NextRequest } from 'next/server';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function POST(req: NextRequest) {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // ... guards, business logic ...
    const res = NextResponse.json({ ok: true });
    res.headers.set('x-request-id', ctx.requestId);
    return res;
  });
}
```

[CITED: D-12, D-14, D-15 of CONTEXT.md][VERIFIED: ALS preserves context across `await` on Node 22.14, ran live test]

### Pattern 5: Logger wrapper (does NOT modify `lib/server/logger.ts`)

**What:** A thin wrapper that imports `createLogger` from the existing logger and decorates every emit with the current `requestId` from ALS.

**When to use:** All new code uses the wrapper. Existing call sites can migrate gradually.

**Code (`frontend/src/lib/server/observability/log.ts`):**
```typescript
// Source: composed from D-13 + the existing createLogger signature in
// frontend/src/lib/server/logger.ts (read-only here; not modified).
import 'server-only';
import { createLogger, type CreateLoggerOptions, type Logger } from '@/lib/server/logger';
import { getRequestId } from './request-context';

/**
 * Wraps the existing logger so every log line picks up the current request ID
 * from AsyncLocalStorage. The base logger is created lazily so callers can
 * still pass options if they want a non-default config.
 */
export function createRequestLogger(options: CreateLoggerOptions = {}): Logger {
  const base = createLogger(options);
  function decorate(ctx?: Record<string, unknown>): Record<string, unknown> {
    const requestId = getRequestId();
    if (!requestId) return ctx ?? {};
    return { ...(ctx ?? {}), requestId };
  }
  return {
    debug: (msg, ctx) => base.debug(msg, decorate(ctx)),
    info: (msg, ctx) => base.info(msg, decorate(ctx)),
    warn: (msg, ctx) => base.warn(msg, decorate(ctx)),
    error: (msg, ctx) => base.error(msg, decorate(ctx)),
  };
}

/** Default singleton — most call sites use this. */
export const log: Logger = createRequestLogger();
```

[CITED: D-13 of CONTEXT.md; logger signature read from `frontend/src/lib/server/logger.ts` lines 28–33]

### Anti-Patterns to Avoid

- **Modifying `lib/server/logger.ts` directly.** It is in the CLAUDE.md "battle-tested" list and contains shallow-redaction semantics that downstream code depends on. Wrap, don't rewrite.
- **Setting `X-Request-Id` from a `middleware.ts` (or `proxy.ts`).** D-15 forbids this. Edge runtime adds context-propagation pitfalls that are invisible in dev. ALS in route handlers is the correct boundary.
- **Calling `crypto.randomUUID()` outside Node runtime.** Edge runtime supports it but the route file must declare `runtime='nodejs'` regardless (Prisma+bcrypt invariants); this is the contract OPS-02 enforces.
- **Reading inbound `X-Request-Id` without validation.** A client could inject a long string of newlines and poison every log line. The reference module's `^[0-9a-f-]{8,64}$/i` check is defensive — keep it.
- **Adding `prisma migrate deploy` to `frontend/package.json`'s `build` script.** D-21 forbids; Pitfall 4 (research) documents the foot-gun.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OpenTelemetry init for Next on Vercel | Manual `NodeSDK` setup with HTTP/fetch instrumentations | `@vercel/otel` `registerOTel()` | One line vs ~30 LOC, Vercel-runtime detection, Next 16 fetch auto-instrumentation included |
| Per-request context propagation | Pass a `requestId` argument through every function | `node:async_hooks` `AsyncLocalStorage` | Zero-touch propagation across awaits; signature pollution avoided; Node primitive, no dep |
| UUID generation | `Math.random().toString(36)` or hand-rolled | `crypto.randomUUID()` | Built-in, RFC 4122 v4, cryptographically random, zero deps |
| Glob walk for the guard test | `fs.readdir({recursive:true})` + filter | `fast-glob` `fg.sync(...)` | One line, well-tested, handles ignores and ordering |
| Sentry error capture for routes | Try/catch wrapper in every route handler | `export { onRequestError } from '@sentry/nextjs'` | Single line in `instrumentation.ts`, captures everything Next routes emit |
| Cron auth | Custom JWT or HMAC scheme | `Authorization: Bearer ${CRON_SECRET}` + `timingSafeEqual` (Phase 5) | Vercel's documented pattern; auto-injected by Vercel Cron |

**Key insight:** Phase 0 is almost entirely "glue + remove" work. The heaviest lift is the request-context module (~50 LOC including tests) — every other change is ≤ 5 LOC. Hand-rolling any of the above wastes time and creates surface area for bugs.

## Runtime State Inventory

This phase modifies infrastructure files; no rename / refactor. Inventory categories below answered explicitly per the protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 0 does not touch any database content. Existing data (none yet — Prisma migrations not yet run on a real DB per STATE.md) is unaffected. | None. |
| Live service config | **Vercel Project Environment Variables** will need `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET` set when the project deploys. Phase 0 only documents these in `.env.example`; actual Vercel env-var injection is a Phase 6 deploy task. | Document in `.env.example`; defer Vercel UI work to Phase 6 DOC-02. |
| OS-registered state | None — Phase 0 doesn't touch Windows Task Scheduler / launchd / pm2 / systemd. | None. |
| Secrets / env vars | **Renames from old shape:** none. **Additions:** `DIRECT_URL` (new), `CRON_SECRET` (new). **Mutations:** `DATABASE_URL` example value changes from local-postgres to Neon-pooler-shape — this is a **comment/template change only**; existing `.env` files in developer machines (gitignored) are unaffected unless devs choose to update. | Phase 0 only edits `.env.example`. Real `.env` files require manual dev action; Phase 6 DOC-02 should call this out. |
| Build artifacts / installed packages | **`prisma generate` may need a re-run** after the `directUrl` line is added to `schema.prisma`. The generated `@prisma/client` will pick up the new field — running `pnpm db:push` or `pnpm db:migrate:dev` triggers regeneration automatically; otherwise `pnpm --filter frontend exec prisma generate` does it explicitly. The existing `postinstall` hook in `frontend/package.json` (`prisma generate`) re-runs on every `pnpm install`. | Plan should include an explicit "run `prisma generate` after schema edit" step or rely on the next `pnpm install` to trigger postinstall. **Verified:** `directUrl` is a runtime-relevant field in Prisma 5+, so `@prisma/client` types may change subtly. [ASSUMED: regeneration is idempotent and won't break existing imports — corroborated by Prisma docs but not validated in this session.] |

**Verified explicit nothing:** No SOPS/age/encrypted-secrets in this repo (verified via `find` for `.sops.yaml`, no hits — checked at repo root scan). No Docker registry images yet (project is pre-deploy per STATE.md). No `egg-info` / `dist/` build artifacts that would carry stale paths.

## Common Pitfalls

### Pitfall 1: `directUrl` added but `prisma generate` not re-run
**What goes wrong:** Plan adds `directUrl = env("DIRECT_URL")` to `schema.prisma`, the team commits, but neither the developer nor CI runs `prisma generate`. Subsequent migrations succeed (CLI reads schema directly) but any code that imports `Prisma` types gets stale client types. Symptoms are subtle.
**Why it happens:** Prisma's CLI reads the schema file fresh; the `@prisma/client` package is generated code that lives in `node_modules`.
**How to avoid:** The existing `postinstall` script in `frontend/package.json` (`"postinstall": "prisma generate"`) covers it on the next `pnpm install`. Explicitly run `pnpm --filter frontend exec prisma generate` as a step in Phase 0 to be safe.
**Warning signs:** TypeScript errors about Prisma types after schema edits.

### Pitfall 2: `crypto.randomUUID()` called from edge runtime
**What goes wrong:** A future route forgets `runtime='nodejs'` and reaches into `getRequestId`/`makeRequestContext`. `crypto.randomUUID()` works on edge but `AsyncLocalStorage` from `node:async_hooks` does not.
**Why it happens:** Importing `node:async_hooks` from an edge route fails at build/runtime.
**How to avoid:** The runtime-enforcement guard test catches this — every route file under `app/api/**` must declare `runtime='nodejs'`. Belt-and-braces: `import 'server-only'` at top of `request-context.ts` ensures any client bundle import fails at build time.
**Warning signs:** "Module `node:async_hooks` not supported in edge runtime" build error.

### Pitfall 3: Inbound `X-Request-Id` poisoning
**What goes wrong:** A client sends `X-Request-Id: foo\n[CRITICAL]` — every subsequent log line for that request inherits the malformed ID, polluting log search and possibly breaking JSON log parsers.
**Why it happens:** Trusting client input.
**How to avoid:** The reference module validates inbound IDs against `^[0-9a-f-]{8,64}$` and falls back to `randomUUID()` on mismatch. Do NOT relax this regex.
**Warning signs:** Log search returning malformed JSON; multi-line entries from a single request.

### Pitfall 4: AsyncLocalStorage context "lost" across `setTimeout`/`setImmediate`
**What goes wrong:** Code inside a route handler schedules background work via `setImmediate(() => log.info('done'))` — the log line lacks `requestId`.
**Why it happens:** ALS context propagates through awaits (verified) but is preserved through `setTimeout` only when the timer is created within the ALS scope. Edge cases exist with stream callbacks.
**How to avoid:** Capture `getRequestContext()` synchronously before scheduling out-of-band work, then explicitly pass it. For Phase 0, no background work is added — the pitfall is documented for Phase 1+ awareness.
**Warning signs:** Log lines missing `requestId` when one is expected.

### Pitfall 5: `@vercel/otel` peer dep missing in dev
**What goes wrong:** `pnpm install` succeeds but `pnpm dev` throws on import because OTel SDK packages aren't transitively installed.
**Why it happens:** pnpm 9 is strict about peer deps. `@vercel/otel@2.x` lists 7 OTel SDK peers.
**How to avoid:** Run `pnpm install` after adding `@vercel/otel` and check the output for `WARN  Issues with peer dependencies found`. If any are flagged, install the SDK packages explicitly. Verify `pnpm dev` boots cleanly before declaring the task done.
**Warning signs:** `Cannot find module '@opentelemetry/...'` at startup.

### Pitfall 6: Phase-0 instrumentation breaks Sentry boot order
**What goes wrong:** Adding `import { registerOTel } from '@vercel/otel'` at the top of `instrumentation.ts` before the Sentry dynamic imports might (depending on tree-shaking) alter when Sentry's auto-instrumentation patches `http`/`express`/`fetch`.
**Why it happens:** Sentry's docs emphasize that the import must be the first line of the entry file. The current `instrumentation.ts` uses a dynamic `await import('./sentry.server.config')` inside `register()`, which is correct, and the OTel import sits beside it — both run inside `register()`. No conflict expected.
**How to avoid:** Match the shape in Pattern 2 above (Sentry `await import` first inside `register()`, then `registerOTel()` call, both inside the same async function). Do not move OTel before Sentry.
**Warning signs:** Sentry loses HTTP auto-instrumentation; spans appear in OTel but errors don't appear in Sentry.

[ASSUMED: `@vercel/otel` and `@sentry/nextjs` co-loading order does not cause double-instrumentation of HTTP. The two SDKs use different mechanisms (Sentry's instrumented `http`/`express` vs OTel's `@opentelemetry/instrumentation-http`). D-18 asserts no conflict; corroborating Vercel + Sentry docs is the next verification step if a regression appears.]

## Code Examples

### Example 1: Updated `frontend/instrumentation.ts` (final shape)

```typescript
// Source: composed per Pattern 2 above + existing file at frontend/instrumentation.ts.
// CRITICAL: keep Sentry imports inside `register()` to preserve runtime-conditional
// boot. registerOTel() is safe to call from both nodejs and edge runtimes.
import { registerOTel } from '@vercel/otel';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
  registerOTel({ serviceName: 'amadou-monolith' });
}

// Required for Sentry to capture unhandled route errors (Next.js 15+).
export { onRequestError } from '@sentry/nextjs';
```

### Example 2: Updated `frontend/prisma/schema.prisma` datasource

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")  // ADDED — required for prisma migrate deploy
}
```

### Example 3: Co-located unit test for request-context module

```typescript
// frontend/src/lib/server/observability/request-context.test.ts
import { describe, expect, it } from 'vitest';
import { makeRequestContext, withRequestContext, getRequestId } from './request-context';

describe('makeRequestContext', () => {
  it('mints a UUID when no inbound header is present', () => {
    const ctx = makeRequestContext(new Headers());
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('reuses a valid inbound X-Request-Id', () => {
    const id = 'abcdef12-1234-5678-9abc-def012345678';
    const ctx = makeRequestContext(new Headers({ 'x-request-id': id }));
    expect(ctx.requestId).toBe(id);
  });

  it('rejects malformed inbound X-Request-Id and mints a fresh one', () => {
    const ctx = makeRequestContext(new Headers({ 'x-request-id': 'evil\nlog-poison' }));
    expect(ctx.requestId).not.toContain('\n');
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('withRequestContext', () => {
  it('preserves the request ID across await boundaries', async () => {
    const ctx = makeRequestContext(new Headers());
    const seen = await withRequestContext(ctx, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getRequestId();
    });
    expect(seen).toBe(ctx.requestId);
  });

  it('returns undefined outside any context', () => {
    expect(getRequestId()).toBeUndefined();
  });
});
```

### Example 4: Minimal `frontend/vitest.config.ts` (Wave 0)

```typescript
// frontend/vitest.config.ts — minimal config; default test discovery.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

[ASSUMED: Vitest 2.1.8 honours `resolve.alias` for `@/*` path resolution without an extra plugin — standard pattern, confirmed via Vitest 2.x release notes. Verify by running the test once Phase 0 is implemented.]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `experimental.instrumentationHook: true` in `next.config.js` | Auto-discovery of `instrumentation.ts` | Next.js 15.0 | Removed config flag; file is discovered automatically. Phase 0 OPS-05 confirms absent. |
| Sentry `Sentry.init()` at top-level of route files | `instrumentation.ts` + dynamic import per runtime | Sentry 8.x → 10.x | Single boot point; correct env-detection. Already in place. |
| Sentry `nextRouterInstrumentation` | `browserTracingIntegration` | Sentry 8.0 | Old API removed; project uses new pattern per `frontend/sentry.client.config.ts`. |
| `?pgbouncer=true` query param required | Optional with `-pooler` host (Prisma 5.10+ + PgBouncer 1.22+) | Prisma 5.10 (2024) | Including it is harmless; D-01 keeps it for explicitness. |
| Per-function ID propagation via call args | `AsyncLocalStorage` in Node ≥ 16 | Stable in Node 16; OTel default in 2024+ | Zero-touch propagation; standard for request-scoped context. |
| Manual OTel SDK setup | `@vercel/otel` one-liner | `@vercel/otel` 1.0 (2024); 2.x current | One-line registration; auto-instruments Next/Vercel runtime. |

**Deprecated/outdated (do not introduce):**
- `experimental.instrumentationHook` — deprecated since Next 15; absent from current `next.config.ts`.
- `nextRouterInstrumentation` — removed in Sentry 8+.
- Top-level `Sentry.init()` call from app entry — replaced by `instrumentation.ts` pattern.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 |
| Config file | `frontend/vitest.config.ts` (does NOT exist — Wave 0) |
| Quick run command | `pnpm --filter frontend exec vitest run <path>` |
| Full suite command | `pnpm test` (runs `vitest run` in frontend) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-01 | `.env.example` contains `DATABASE_URL` (with `pooler` shape) and `DIRECT_URL` and `CRON_SECRET` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts` | ❌ Wave 0 |
| OPS-01 | `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/schema-direct-url.test.ts` | ❌ Wave 0 |
| OPS-02 | Every `app/api/**/route.ts` exports `runtime = 'nodejs'`; none exports `runtime = 'edge'` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ❌ Wave 0 |
| OPS-03 | `frontend/instrumentation.ts` re-exports `onRequestError` from `@sentry/nextjs` | unit (string-assert on file) | `pnpm --filter frontend exec vitest run src/lib/server/observability/instrumentation-shape.test.ts` | ❌ Wave 0 |
| OPS-04 | `.env.example` documents `CRON_SECRET` with `openssl rand -base64 32` hint | unit (covered by OPS-01 env-shape test) | (same as OPS-01 env-shape) | ❌ Wave 0 |
| OPS-05 | `frontend/next.config.ts` does NOT contain `experimental.instrumentationHook` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/next-config-clean.test.ts` | ❌ Wave 0 |
| OBS-04 | `request-context` module mints a UUID, preserves it across awaits, rejects malformed inbound IDs | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/request-context.test.ts` | ❌ Wave 0 |
| OBS-04 | Logger wrapper injects `requestId` from ALS into log context | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/log.test.ts` | ❌ Wave 0 |
| OBS-05 | `frontend/instrumentation.ts` calls `registerOTel({ serviceName: 'amadou-monolith' })` | unit (string-assert; covered by OPS-03 instrumentation-shape test) | (same) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm --filter frontend exec vitest run <changed-test-file>` (typically < 2 s — pure file-read tests, one ALS unit test).
- **Per wave merge:** `pnpm test` (full Vitest suite — < 5 s for Phase 0 surface).
- **Phase gate:** `pnpm test && pnpm typecheck && pnpm lint` all green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `frontend/vitest.config.ts` — minimal config with `@/*` alias (currently absent — `pnpm test` runs `vitest run` but with default config; explicit config improves alias resolution and locks include patterns)
- [ ] `frontend/src/lib/server/observability/` — directory does not exist
- [ ] `frontend/src/lib/server/observability/runtime-enforcement.test.ts` — runtime guard
- [ ] `frontend/src/lib/server/observability/env-shape.test.ts` — covers OPS-01 + OPS-04
- [ ] `frontend/src/lib/server/observability/schema-direct-url.test.ts` — OPS-01 schema check
- [ ] `frontend/src/lib/server/observability/instrumentation-shape.test.ts` — OPS-03 + OBS-05
- [ ] `frontend/src/lib/server/observability/next-config-clean.test.ts` — OPS-05
- [ ] `frontend/src/lib/server/observability/request-context.test.ts` — OBS-04 ALS unit test
- [ ] `frontend/src/lib/server/observability/log.test.ts` — OBS-04 logger-wrapper unit test
- [ ] Add deps: `pnpm --filter frontend add @vercel/otel && pnpm --filter frontend add -D fast-glob`

## Security Domain

> Phase 0 is infrastructure and does not introduce auth, payments, file upload, or any user-facing input handler. Security touchpoints are limited; full ASVS coverage starts in Phase 1 (Auth).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no — deferred to Phase 1 | n/a in Phase 0 |
| V3 Session Management | no — deferred to Phase 1 | n/a in Phase 0 |
| V4 Access Control | no — deferred to Phase 1+ | n/a in Phase 0 |
| V5 Input Validation | yes (limited) | Inbound `X-Request-Id` validated against `^[0-9a-f-]{8,64}$`; otherwise minted fresh. Prevents log-line poisoning. |
| V6 Cryptography | yes (limited) | `crypto.randomUUID()` from Node built-in; never hand-rolled. |
| V8 Data Protection | yes (env hygiene) | `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET` documented in `.env.example` with empty values; real values never committed. |
| V14 Configuration | yes | OPS-02 enforces `runtime='nodejs'` (prevents Prisma/bcrypt silent failure on edge); OPS-05 confirms `experimental.instrumentationHook` absent (avoids deprecated config drift). |

### Known Threat Patterns for Phase 0 surface

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Log injection via `X-Request-Id` header | Tampering / Repudiation | Validate inbound header against strict regex; fall back to `randomUUID()`. Already in Pattern 4 reference code. |
| `CRON_SECRET` leak via error trace or wholesale header logging | Information Disclosure | Logger redaction list in existing `lib/server/logger.ts` includes `token`; ensure `CRON_SECRET` never reaches logger.info(req.headers) (Phase 5 invariant; Phase 0 only documents the var). |
| Connection exhaustion (DoS via Prisma) | Denial of Service | OPS-01 mandates `connection_limit=1` + pooler URL — caps per-instance connections. |
| Edge-runtime accidental compromise (Prisma/bcrypt undefined) | Tampering / Correctness | OPS-02 enforces `runtime='nodejs'` via CI guard test. |

## Sources

### Primary (HIGH confidence)
- `.planning/research/STACK.md` — Sentry `instrumentation.ts` shape (lines 198–216), `runtime='nodejs'` requirement (lines 87–94), `directUrl` Neon pattern, `experimental.instrumentationHook` deprecation
- `.planning/research/ARCHITECTURE.md` — App Router HOF guard composition, no-middleware-as-security-boundary, Vercel Cron auth shape
- `.planning/research/PITFALLS.md` — Pitfall 2 (`runtime='edge'` breaks Prisma), Pitfall 4 (no `migrate deploy` in build), Pitfall 9 (Neon connection exhaustion)
- `.planning/research/SUMMARY.md` — Pre-M3 prerequisite list, Phase 0 rationale
- `.planning/phases/00-foundation/00-CONTEXT.md` — locked decisions D-01 through D-21
- npm registry verification (2026-05-07): `@vercel/otel@2.1.2`, `fast-glob@3.3.3`, `@sentry/nextjs@10.52.0`
- Live Node verification (2026-05-07): `crypto.randomUUID()` available, `AsyncLocalStorage` preserves context across `await`

### Secondary (MEDIUM confidence)
- Existing `frontend/instrumentation.ts` (current shape — extends correctly per pattern)
- Existing `frontend/next.config.ts` (verified clean — no `experimental.instrumentationHook`)
- Existing `frontend/src/app/api/health/route.ts` and `readyz/route.ts` (already declare `runtime='nodejs'`)
- Existing `frontend/src/lib/server/logger.ts` (read-only; signature drives wrapper shape)

### Tertiary (LOW confidence — not relied on for prescriptive claims)
- (none — Phase 0 prescriptions all sourced from primary research files or verified via npm/live execution)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pgbouncer=true` query parameter is harmless when paired with `-pooler` host (corroborates D-01 verbatim) | Pattern 1 | Low — Neon docs explicitly accept it; if rejected, migration would fail loudly during first `db:push`. |
| A2 | pnpm 9 will auto-install `@vercel/otel` peer deps from the OTel SDK or warn but not block | Standard Stack — peer deps | Low-medium — if it blocks, plan adds an explicit `pnpm add` for SDK packages; caught at install time. |
| A3 | `@vercel/otel` and `@sentry/nextjs` co-existence does not cause double-instrumentation of HTTP | Pitfall 6 + D-18 | Medium — if double-instrumentation appears, response times may be slightly higher and span counts inflate; not a correctness regression. Plan should include a smoke test (one curl + Sentry/OTel dashboard check) before sign-off. |
| A4 | Vitest 2.1.8 honours `resolve.alias` for `@/*` without an extra plugin | Example 4 | Low — if not, switch to `vite-tsconfig-paths` (one extra dev dep). Caught immediately by first test run. |
| A5 | Running `prisma generate` after adding `directUrl` is idempotent and won't break existing imports | Runtime State Inventory | Low — `directUrl` is metadata, not a type-shape change; corroborated by Prisma docs. |
| A6 | Phase 0 commit scope `(monolith)` is the project convention | Project Constraints | Low — derived from `.planning/codebase/CONVENTIONS.md` which the canonical-refs section cites; planner can confirm with `git log` if uncertain. |

**Items needing confirmation before execution:**
- A2 (peer deps) — easy to validate during install step.
- A3 (Sentry + OTel coexistence) — validate via a smoke run after wiring; this is the most operationally meaningful assumption.

## Open Questions

1. **Should the runtime-enforcement test live co-located or under `__tests__/`?**
   - What we know: Co-located `*.test.ts` is the project convention per `.planning/codebase/CONVENTIONS.md`. The runtime-enforcement test is a *system-level* guard, not a unit test of one module.
   - What's unclear: A co-located test in `lib/server/observability/runtime-enforcement.test.ts` doesn't logically belong to that module; it tests something cross-cutting.
   - Recommendation: Place under `frontend/src/lib/server/observability/runtime-enforcement.test.ts` for now (per CONTEXT.md `<decisions>` D-05 location hint). If awkward, move to `frontend/__tests__/runtime-enforcement.test.ts` in Phase 6 cleanup. Either is acceptable per CONTEXT.md.

2. **Optional: include the `_debug/throw` route (D-08)?**
   - What we know: D-08 says optional, only if dev-gated.
   - What's unclear: Operational value vs. surface area.
   - Recommendation: **Skip in Phase 0**. Manual `curl` test of any throwing route during Phase 1 dev is sufficient. Adds clutter for marginal verification value. (Aligns with `<deferred>` block.)

3. **Should `pnpm install` be automated as part of phase finalization?**
   - What we know: Adding deps requires `pnpm install` to populate `pnpm-lock.yaml`.
   - What's unclear: Phase verification command sequence.
   - Recommendation: Include `pnpm install` as the first step in the deps-add task; CI would catch a missed install via lockfile drift.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All build/test/dev | ✓ | 22.14.0 (≥ 20 required) | — |
| pnpm | Workspace install | ✓ (declared in `packageManager`) | 9.15.0 | — |
| `@sentry/nextjs` | OPS-03 | ✓ (already installed) | 10.51.0 | — |
| `prisma` / `@prisma/client` | OPS-01 schema edit | ✓ (already installed) | 5.22.0 | — |
| `vitest` | OPS-02 / OBS-04 tests | ✓ (already installed) | 2.1.8 | — |
| `@vercel/otel` | OBS-05 | ✗ | — | Defer OTel; ship Phase 0 without OBS-05 (downgrades milestone success criteria — not recommended) |
| `fast-glob` | OPS-02 guard test | ✗ | — | Pure `node:fs` recursive walk — works but ~30 LOC of glue, brittler |
| `git` | Commit phase docs (per `commit_docs: true`) | ✓ | (system) | — |
| Live Postgres / Neon | Phase 0 schema edit only requires `prisma generate`, NOT a connection. Migrations are deferred to Phase 6 deploy procedure. | n/a for Phase 0 | n/a | n/a |

**Missing dependencies with no fallback:** None — `@vercel/otel` and `fast-glob` are both freely available on npm registry (verified 2026-05-07).

**Missing dependencies with fallback:**
- `fast-glob` could be replaced by hand-rolled recursive walk; not recommended (added engineering surface for trivial savings).
- `@vercel/otel` has no equivalent simple fallback — manual OTel SDK wiring is 30+ LOC and Vercel-non-native; do not substitute.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry on 2026-05-07
- Architecture: HIGH — patterns sourced from existing research files (HIGH confidence per their own metadata) plus live verification of ALS/UUID behavior
- Pitfalls: HIGH for items 1–5; MEDIUM for item 6 (Sentry+OTel coexistence is empirically common but not re-verified live in this session — see A3)
- Validation Architecture: HIGH — all tests describable in 1–2 LOC; no novel techniques

**Research date:** 2026-05-07
**Valid until:** 2026-06-07 (30 days — stable infra; Next.js 16.x and Sentry 10.x are mature)
