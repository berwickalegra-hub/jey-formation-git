# Phase 0: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `00-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 00-foundation
**Areas discussed:** runtime='nodejs' enforcement, Request ID propagation, OpenTelemetry depth, Prisma migrate on deploy

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| runtime='nodejs' enforcement | Lint rule vs grep hook vs naming convention vs CI check | (delegated to Claude — "juste vois ce qu'il faut") |
| Request ID propagation | middleware.ts/proxy.ts vs per-route helper; ALS vs explicit pass | (delegated) |
| OpenTelemetry depth | Minimal `@vercel/otel` vs custom spans for Prisma/Redis/external HTTP | (delegated) |
| Prisma migrate on deploy | Auto in build step vs manual vs release script | (delegated) |

**User's choice:** "juste vois ce qu'il faut" (decide what's needed). All four delegated to Claude with reasoning recorded inline before writing CONTEXT.md.

**Notes:** User invoked `/gsd-discuss-phase` immediately after `/gsd-new-project` finished. With no specific preference signaled and quality-over-speed declared during init, Claude picked sensible defaults that minimize per-project churn.

---

## runtime='nodejs' enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Custom ESLint rule | Errors at IDE/lint time on missing or `runtime='edge'` | |
| Pre-commit grep hook | git hook that scans staged route files | |
| CI grep check (Vitest test) | Test that walks `app/api/**/route.ts` and asserts the export | ✓ |
| Naming convention only | Rely on a route template + code review | |

**Selected:** CI grep check via a small Vitest test under `frontend/src/lib/server/__tests__/` (or co-located). Runs as part of `pnpm test`, can't be skipped, no plugin maintenance, catches both missing and `runtime='edge'` accidents.

**Rejected reasoning:**
- ESLint custom rule: maintenance overhead for a starter; Vitest test gives the same guarantee with less plumbing.
- Pre-commit hook: bypassed by `--no-verify`; CI gate is more reliable.
- Naming convention only: trivially forgotten; the OPS-02 requirement explicitly says "lint rule or naming convention" but in practice naming alone fails.

---

## Request ID propagation

| Option | Description | Selected |
|--------|-------------|----------|
| middleware.ts edge generation + ALS | Generate in middleware, propagate via ALS | |
| proxy.ts (Next 16 rename) edge + ALS | Same as above but using new file name | |
| Per-route helper + AsyncLocalStorage | First line of every route calls a helper that sets up ALS | ✓ |
| Per-route helper + explicit logger arg | Same generation point but pass `requestId` explicitly to logger calls | |
| Trust client-provided + server fallback | Read inbound `X-Request-Id`, fall back to UUID if absent | (folded into selected) |

**Selected:** Per-route helper + AsyncLocalStorage, with the helper reading inbound `X-Request-Id` and generating a UUID v7-or-v4 fallback. Logger gets a wrapper module that injects the request ID from ALS.

**Rejected reasoning:**
- Edge middleware/proxy: the architecture research recommends NOT adding a `middleware.ts` / `proxy.ts` file in v1 (HOF guards in route handlers are the unified pattern). Adding one just for request ID splits the pattern and adds a Next.js 15→16 rename concern.
- Explicit logger arg: contaminates every call site; ALS is the standard mechanism for cross-cutting context like request IDs.

**Notes:** `lib/server/logger.ts` is in the CLAUDE.md "do not modify" list. Wrap, don't modify — wrapper module reads from ALS and forwards to the existing logger.

---

## OpenTelemetry depth

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal `@vercel/otel` only | One-line register call in instrumentation.ts | ✓ |
| Custom spans for Prisma + Redis | Wrap DB calls and Redis ops in custom spans | |
| Custom spans for everything | Above + external HTTP (Bictorys, Resend, R2) | |

**Selected:** Minimal `@vercel/otel` init only. Auto-instrumentation from Next.js 16 + Vercel covers HTTP server, fetch, and baseline ops. Custom spans are per-project concerns.

**Rejected reasoning:**
- Custom spans now: bloats the starter without proving ROI. Each project knows its own bottlenecks better than a generic starter does. Easy to add per-project later (instrumentation.ts is extension-friendly).

---

## Prisma migrate on deploy

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-run in Vercel build step | `package.json` `build` script invokes `prisma migrate deploy` | |
| Manual via documented procedure | Operator runs `pnpm db:migrate:deploy` before triggering Vercel deploy | ✓ |
| Separate release script gated on env | Build script runs migrate only if `RUN_MIGRATIONS_ON_BUILD=1` | |

**Selected:** Manual via documented procedure. Starter does NOT add `migrate deploy` to the `build` script. The procedure (run before Vercel deploy with `DIRECT_URL` set to prod) is documented in CLAUDE.md/README during Phase 6 (DOC-01/DOC-02).

**Rejected reasoning:**
- Auto in build step: long migrations (table-locking) clash with Vercel deploys spinning up new function instances against the in-progress schema. Documented foot-gun.
- Env-gated release script: solves nothing the manual procedure doesn't already solve, but adds a config knob to misuse.

**Notes:** Per-project can opt into auto-migrate if their migration shape is safe (additive, no long locks). The starter stays conservative.

---

## Claude's Discretion

The following decisions were not surfaced as gray areas because the answer is mechanical or already prescribed by research:

- `CRON_SECRET` strategy — single shared secret across all 5 cron routes (multi is over-engineering for v1)
- `DIRECT_URL` — included in `.env.example` for migrations (standard Neon Vercel pattern)
- Logger format — JSON in prod, pretty in dev (existing pino default; not modified by Phase 0)
- `experimental.instrumentationHook` removal — implementation verifies presence in `next.config.ts` and removes if found (no decision; just mechanical)
- UUID generator — `crypto.randomUUID()` (Node 20+ built-in) is sufficient

## Deferred Ideas

- Custom OTel spans for Prisma/Redis/Bictorys/Resend/R2 — per project, documented v2.
- Per-cron CRON_SECRET — revisit if exposure model changes per project.
- ESLint custom rule — fallback if CI grep guard becomes brittle.
- Auto `prisma migrate deploy` in build step — per project, documented foot-gun.
- Throw-test debug route — optional in plan; can be skipped if planner finds it awkward.
- Logger migration to native OTel logging API — defer.
