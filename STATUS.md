# amadou-monolith — status

This repo was cloned from [`amadou-template`](../amadou-template) on 2026-05-07 as a Next.js full-stack variant (no separate Express backend).

## What's here

- `frontend/` — Next.js 16 app (App Router) — copied as-is
- `examples/frontend-pages/` — reference pages (auth, admin, withdrawals, etc.)
- `.env.example`, `docker-compose.yml`, ESLint/Prettier/TS configs — copied as-is
- `CLAUDE.md` / `README.md` — **stale**: still describe the Express backend; rewrite once port is done

## What's NOT here yet (TODO — backend port)

The entire `backend/` directory is intentionally absent. The following must be ported into `frontend/` (under `frontend/src/app/api/...` for API routes, `frontend/src/lib/...` for shared libs, `frontend/prisma/` for the schema):

| Source (in `amadou-template/`) | Target (in this repo) | Notes |
|---|---|---|
| `backend/prisma/` | `frontend/prisma/` | schema + migrations move under the Next.js package |
| `backend/src/lib/{auth,crypto,logger,redis,prisma,zod-helpers,slug,rate-limit-store}.ts` | `frontend/src/lib/server/...` | mark with `import 'server-only'` |
| `backend/src/lib/{payments,webhook,outbox,notifications,oauth,admin,withdrawals}/` | `frontend/src/lib/server/...` | same |
| `backend/src/middleware/{auth,verify-csrf,require-admin,require-org-role,rate-limit-by-email}.ts` | helpers callable from route handlers | Next.js has no Express middleware chain — wrap into `withAuth(handler)` style HOFs |
| `backend/src/routes/*.ts` | `frontend/src/app/api/.../route.ts` | each Express route → a Next.js route handler |
| `backend/scripts/{seed-dev,smoke-test,make-superadmin}.ts` | `frontend/scripts/` | runnable via `tsx` |
| Crons in `backend/src/index.ts` (`setInterval` + leader election) | **Vercel Cron + Inngest/QStash** | serverless has no long-running process — this is the biggest architectural change |
| Webhook raw-body parser before `express.json()` | Next.js route handlers receive `Request` — read `await req.text()` for HMAC then `JSON.parse` | preserves byte-identical body invariant |
| Outbox dispatcher (5s loop) | Vercel Cron every minute or Inngest scheduled function | |
| Email queue dispatcher (5s loop) | same | |

## Critical invariants to preserve when porting

1. **Sentry init must be the first thing the Next.js server runtime loads** → `frontend/instrumentation.ts` already exists; keep `Sentry.init` there before any other server module.
2. **Webhook handler must hash the raw body** for HMAC verification — never `JSON.parse` before `createHmac`.
3. **Withdrawals must use `pg_advisory_xact_lock(hashtext(userId))` inside a Serializable Prisma tx** — same as the Express version. The advisory-lock semantics are Postgres-side, so they port cleanly.
4. **Notifications must go through `createNotification(prisma, input)`** — never `prisma.notification.create` directly.
5. **Outbox `enqueueOutbox(tx, event)` runs INSIDE the same tx as the webhook handler** — never as a postCommit closure.
6. **Frontend `api()` wrapper retries only `GET`/`HEAD` on network errors** — do not extend to mutating verbs.
7. **OAuth callback must refuse `email_verified !== true`** — auto-link bypass otherwise.
8. **Admin mutations must call `logAdminAction(prisma, {...})`** — no bypass = unaudited action.
9. **Cookies must remain `httpOnly` + `Secure` (prod) + `SameSite=Lax`** — Next.js `cookies()` API supports this.

## Next steps

1. `cd amadou-monolith && git init && git add -A && git commit -m "chore: initial scaffold from amadou-template (frontend-only)"`
2. Open a port-backend session: scaffold `frontend/prisma/`, copy schema, port `lib/` first, then route handlers grouped by resource (auth → uploads → orders → withdrawals → webhooks → admin → orgs → oauth).
3. Replace cron `setInterval` with Vercel Cron (`vercel.json` + `app/api/cron/*/route.ts` gated by `CRON_SECRET`).
4. Rewrite README + CLAUDE.md once the port is functional.
