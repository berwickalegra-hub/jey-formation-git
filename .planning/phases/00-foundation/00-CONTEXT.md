# Phase 0: Foundation - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 0 lands the cross-cutting infrastructure that every subsequent phase depends on. By the end of this phase the starter has:

1. A `DATABASE_URL` convention that survives Vercel concurrent invocations (Neon `-pooler` host with `?pgbouncer=true&connection_limit=1&pool_timeout=15`) and a `DIRECT_URL` for migrations
2. A guarantee that no API route ever runs on edge runtime (Prisma + bcrypt + Buffer would silently break)
3. Sentry capturing unhandled route errors via `onRequestError`
4. `CRON_SECRET` documented in `.env.example` so Phase 5 cron auth can light up
5. `experimental.instrumentationHook` removed from `next.config.ts` if present (deprecated since Next 15)
6. Per-request structured logging with `X-Request-Id` propagation (incident triage 10× faster)
7. `@vercel/otel` registered in `instrumentation.ts` for distributed traces beyond Sentry

This phase does NOT add any new HTTP route. It modifies infrastructure files and existing routes (`health`, `readyz`) to carry the new contract.

</domain>

<decisions>
## Implementation Decisions

### Database connection (OPS-01)

- **D-01:** `.env.example` must include both `DATABASE_URL` (pooler URL — `<host>-pooler.<region>.aws.neon.tech` with `?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`) and `DIRECT_URL` (non-pooler URL for migrations). Without both, `prisma migrate deploy` exhausts the pooler. This is the standard Neon + Vercel pattern.
- **D-02:** `prisma/schema.prisma` must declare `directUrl = env("DIRECT_URL")` in the datasource block so migrations use the unpooled connection.
- **D-03:** A short comment in `.env.example` explains WHY both are needed — without rationale, devs delete `DIRECT_URL` and get cryptic migration timeouts months later.

### runtime='nodejs' enforcement (OPS-02)

- **D-04:** Every file under `frontend/src/app/api/**/route.ts` must export `runtime = 'nodejs'` as the first non-import statement.
- **D-05:** Enforcement = **CI grep guard via Vitest test**. A small test file (`frontend/src/lib/server/__tests__/runtime-enforcement.test.ts` or similar) walks `app/api/**/route.ts` files and asserts each one contains `export const runtime = 'nodejs'`. Runs as part of `pnpm test`. Reasoning: simpler than a custom ESLint plugin (one file, no plugin maintenance), more reliable than a naming convention or code-review checklist (impossible to forget), runs in CI without extra wiring. Catches both missing and `runtime = 'edge'` accidents.
- **D-06:** Both existing route files (`api/health/route.ts`, `api/readyz/route.ts`) are updated to carry the export. The test runs green at end of phase.

### Sentry error capture (OPS-03)

- **D-07:** `frontend/instrumentation.ts` must `export { onRequestError } from '@sentry/nextjs'` in addition to whatever Sentry init it already does. Without this export, Next.js 15+ does not auto-capture unhandled route errors. Discovered late = incidents go dark in prod.
- **D-08:** A deliberate "throw test" route under `app/api/_debug/throw/route.ts` (gated behind `NODE_ENV !== 'production'`) lets us verify the wiring on demand. Acceptable to add only if it's strictly dev-gated.

### CRON_SECRET (OPS-04)

- **D-09:** `.env.example` adds `CRON_SECRET=""` with a comment: `# Generate with: openssl rand -base64 32. Required for Vercel Cron routes (Phase 5).`
- **D-10:** **Single shared secret** across all 5 cron routes — not per-job secrets. Per-job secrets would multiply env complexity and rotation toil for marginal blast-radius reduction. Re-evaluate per project if a specific cron is exposed beyond the starter's bounds.

### Deprecated config removal (OPS-05)

- **D-11:** `frontend/next.config.ts` is read; if `experimental.instrumentationHook` is present, it is removed. If absent (likely — Next 16 doesn't need it), no action. Plan must check, not assume.

### Request ID + structured logging (OBS-04)

- **D-12:** Request ID generation pattern = **per-route helper + `node:async_hooks` AsyncLocalStorage**. Each route handler's first line calls a small helper (e.g., `withRequestContext(req, async () => { ... })` or `const reqId = startRequestContext(req)`) that:
  1. Reads `X-Request-Id` from the inbound request header if present, else generates a UUID v7 (sortable by time)
  2. Stores `{ requestId, startedAt }` in an AsyncLocalStorage instance
  3. Sets `X-Request-Id` on the outbound response
- **D-13:** Logger integration = **wrapper, not modification**. `lib/server/logger.ts` is in the "do not modify" list. Add a thin wrapper (e.g., `lib/server/log.ts` or `lib/server/observability/log.ts`) that wraps the existing logger and injects the current request ID from ALS into every log line. Existing call sites can migrate gradually; new code uses the wrapper.
- **D-14:** ALS file location = `lib/server/observability/request-context.ts`. Exposes: `startRequestContext(req): string`, `getRequestId(): string | undefined`, `withRequestContext(req, fn)` for cron handlers (no inbound header).
- **D-15:** No `middleware.ts` (or `proxy.ts` in Next 16) file is created. The architecture research recommends keeping all guard logic in HOF route guards; introducing a middleware/proxy file just for request ID would split the pattern. ALS works correctly inside the per-route helper.

### OpenTelemetry (OBS-05)

- **D-16:** Depth = **minimal**. `instrumentation.ts` calls `registerOTel({ serviceName: 'amadou-monolith' })` from `@vercel/otel`. Auto-instrumentation from Next.js 16 + Vercel covers HTTP server, fetch, and most baseline ops. No custom spans for Prisma, Redis, or external HTTP in v1.
- **D-17:** Custom spans for Prisma/Redis/Bictorys/Resend/R2 are a **per-project concern** — listed in v2 / per-fork docs. Easy to add in a project that needs them; bloats the starter if shipped.
- **D-18:** OTel coexists with Sentry. Both initialize in `instrumentation.ts`. No conflict — Sentry uses its own SDK auto-instrumentation, `@vercel/otel` registers OTel SDK separately.

### Migration on Vercel deploy (cross-cutting, surfaced by OPS-01)

- **D-19:** Starter does **NOT** run `prisma migrate deploy` in the Vercel build step. Long migrations can lock tables mid-deploy while new function instances spin up against the in-progress schema. Documented foot-gun.
- **D-20:** Documented procedure (rewritten in Phase 6 DOC-01/DOC-02): run `DATABASE_URL=<prod-direct-url> pnpm db:migrate:deploy` from a developer machine **before** triggering the Vercel deploy. Per-project can opt into auto-migration in their Vercel build step if their migration shape is safe (additive, no long locks).
- **D-21:** This decision is captured in CLAUDE.md / README during Phase 6 — for Phase 0 it just means we do NOT add any `migrate deploy` invocation to `package.json`'s `build` script.

### Claude's Discretion

- Logger format (JSON in prod, pretty in dev) — already the existing logger's behavior; not a Phase 0 change.
- UUID generator for request IDs — `crypto.randomUUID()` (Node 20+) is sufficient; if v7 ordering is desired, use `uuid` package's `v7` function. Either is fine.
- Exact file path of the new ALS module — `lib/server/observability/request-context.ts` is suggested but planner can place it under `lib/server/log/` or similar if it groups better with the logger wrapper.
- Where the runtime-enforcement test lives (`__tests__/` directory vs co-located `.test.ts`) — co-located is the project convention per CONVENTIONS.md, but a `__tests__/` directory is acceptable for a system-level guard.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & roadmap

- `.planning/PROJECT.md` — Core Value, Constraints, Key Decisions
- `.planning/REQUIREMENTS.md` — REQ-IDs OPS-01–05, OBS-04, OBS-05 (Phase 0 scope)
- `.planning/ROADMAP.md` §"Phase 0: Foundation" — phase goal + 5 success criteria
- `STATUS.md` — port status; M3–M8 dependency notes

### Research (read before planning)

- `.planning/research/SUMMARY.md` — synthesizer's cross-cutting prescriptions; rank-ordered findings
- `.planning/research/STACK.md` — `runtime='nodejs'` mandatory, `onRequestError` export, deprecated `instrumentationHook`
- `.planning/research/ARCHITECTURE.md` — middleware.ts is redirect-only; HOF guards in route handlers; Neon pooling URL params
- `.planning/research/PITFALLS.md` — webhook HMAC silent break, Postgres connection exhaustion, CVE-2025-29927 (Next ≥ 15.2.3)
- `.planning/research/FEATURES.md` — observability-related "missing table stakes" (request ID, OTel) recommended for v1

### Codebase context

- `.planning/codebase/STACK.md` — Next.js 16.1.6, Prisma 5.22, Sentry @sentry/nextjs 10.51, currently configured
- `.planning/codebase/STRUCTURE.md` — `frontend/src/lib/server/` layout; logger location
- `.planning/codebase/CONVENTIONS.md` — TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; co-located `.test.ts`; commit message style
- `.planning/codebase/CONCERNS.md` — current gaps; `CRON_SECRET` missing from `.env.example` flagged

### Existing files Phase 0 will touch

- `frontend/instrumentation.ts` — Sentry init lives here; add `onRequestError` export + `@vercel/otel` register call
- `frontend/next.config.ts` — check for `experimental.instrumentationHook`; remove if present
- `frontend/.env.example` (or `.env.example` at repo root — verify location) — add `DIRECT_URL` and `CRON_SECRET`; update `DATABASE_URL` example to pooler form
- `frontend/prisma/schema.prisma` — add `directUrl = env("DIRECT_URL")` to `datasource db {}`
- `frontend/src/lib/server/logger.ts` — DO NOT MODIFY (per CLAUDE.md). Wrap, don't rewrite.
- `frontend/src/app/api/health/route.ts`, `frontend/src/app/api/readyz/route.ts` — add `export const runtime = 'nodejs'`

### External docs to consult during planning

- Vercel Functions runtime configuration: https://vercel.com/docs/functions/runtimes (verify mandatory `runtime='nodejs'` syntax)
- `@vercel/otel` README: https://www.npmjs.com/package/@vercel/otel (register signature)
- Sentry Next.js manual setup: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/ (`onRequestError` export contract)
- Neon serverless pooling: https://neon.tech/docs/guides/prisma (DATABASE_URL + DIRECT_URL pattern)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `frontend/instrumentation.ts` — already wired as Next register hook; Phase 0 extends it with `onRequestError` re-export and `@vercel/otel` register. Don't recreate.
- `frontend/src/lib/server/logger.ts` — centralized logger (likely pino-style). DO NOT modify (CLAUDE.md "battle-tested" list). Wrap only.
- `frontend/sentry.{client,server,edge}.config.ts` — already exist; Phase 0 doesn't touch these.
- `frontend/src/app/api/health/route.ts`, `frontend/src/app/api/readyz/route.ts` — concrete examples of route handler shape; Phase 0 retrofits the `runtime` export onto both.
- `frontend/prisma/schema.prisma` — datasource block exists; only the `directUrl` line is added.
- Conventions: `kebab-case` filenames, co-located `.test.ts`, named exports preferred (per `.planning/codebase/CONVENTIONS.md`).

### Established Patterns

- `'server-only'` import at top of every server-only file. New observability/request-context module follows this.
- Path alias `@/*` → `frontend/src/*`. Use it for imports.
- Conventional Commits with `(monolith)` scope (e.g. `feat(monolith): add request-id propagation`). Phase 0 commits use this scope.
- `lib/server/` subdirs per concern: `payments/`, `outbox/`, `withdrawals/`, etc. Add `observability/` (or `log/`) for new request-context + logger-wrapper module.
- Stable `ApiError` error codes — Phase 0 doesn't add any new error codes (no user-visible behavior changes).

### Integration Points

- Every Phase 1+ route handler will call `startRequestContext(req)` (or equivalent) as its first line. The pattern lands here. Plan should include a one-page "Route handler skeleton" snippet that subsequent phases copy.
- The runtime-enforcement test gates ALL future Phase 1–5 routes. If it fails, those PRs cannot merge. Plan must confirm the test is committed and green at end of Phase 0.
- `CRON_SECRET` env addition surfaces in Phase 5; Phase 0 only documents it.
- Sentry `onRequestError` will catch all subsequent unhandled route errors — important context when Phase 1–5 routes fail in tests/dev.

</code_context>

<specifics>
## Specific Ideas

- Use `crypto.randomUUID()` (Node 20+ built-in) for request IDs unless `uuid@v7` is explicitly preferred for time-sortability.
- Comment in `.env.example` near `DIRECT_URL` should literally say "Required for `prisma migrate deploy`. Pooler URL exhausts on long-lived migrations." — explicit rationale prevents future deletion.
- Comment in `.env.example` near `CRON_SECRET`: `# Generate with: openssl rand -base64 32. Required by /api/cron/* routes (Phase 5).`
- The runtime-enforcement test should output the offending file path on failure (not just "test failed") — incident-friendly.
- The new request-context module should NOT depend on Next.js types (only `node:async_hooks` + `Headers`) so it can be unit-tested with Vitest without booting Next.

</specifics>

<deferred>
## Deferred Ideas

- **Custom OTel spans for Prisma/Redis/Bictorys/Resend/R2** — recommended per project; documented in v2 (see PROJECT.md `OPS-V2-*`). Per-project add via `instrumentation.ts` extensions. Don't ship in starter.
- **Per-cron CRON_SECRET (one secret per cron route)** — over-engineering for v1; revisit if a specific cron route is exposed beyond the starter (e.g. publicly triggered).
- **ESLint custom rule for `runtime = 'nodejs'` enforcement** — chosen against in favor of CI grep guard. If the test ever feels brittle, revisit and ship a `gsd-eslint-plugin` package.
- **Auto `prisma migrate deploy` in Vercel build step** — chosen against. Per-project can opt in. Document the foot-gun in CLAUDE.md DOC-01 phase.
- **Throw-test debug route** (`app/api/_debug/throw`) — included as optional in D-08 but only if dev-gated. If the planner finds this awkward, drop it; Sentry test can be done manually with a curl during development.
- **Logger migration to native OTel logging API** — defer; the existing pino-style logger + ALS wrapper is sufficient for v1.

</deferred>

---

*Phase: 00-foundation*
*Context gathered: 2026-05-07*
