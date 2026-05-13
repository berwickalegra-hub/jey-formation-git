# amadou-monolith

Headless full-stack starter for the Next.js 16 + Prisma 5 + Neon + Upstash + R2 + Resend + Bictorys + Sentry stack. Single deployable Next.js app — no separate backend service. Third-party providers (R2, Resend, Bictorys, Google OAuth, Sentry, Upstash) are env-gated and inert without their vars; the app boots and `/api/auth` works with just `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, and `CRON_SECRET`. The app ships only logic — no UI components, no pages — every fork designs its own UX.

See [.planning/PROJECT.md](.planning/PROJECT.md) for the project vision and [STATUS.md](STATUS.md) for the port progress.

## Beginner workflow (PRD → Banani → ship)

**The magic phrase.** Open this project in Claude Code and type exactly:

```
Lis WORKFLOW.md et dis-moi ce que je dois faire pour démarrer mon projet.
```

(English: *"Read WORKFLOW.md and tell me what to do to start my project."*)

The AI will read [WORKFLOW.md](WORKFLOW.md) + [CLAUDE.md](CLAUDE.md), figure out where you are, and guide you through the 4 steps (write your PRD → select screens in Banani → `/import-banani` reconciles design ↔ backend → `/gsd-execute-phase` ships the code).

Prerequisite: install **Get Shit Done (GSD)** before opening the starter in Claude Code (the `/gsd-*` commands are GSD-native; only `/import-banani` is shipped by this starter).

## Quickstart

The starter is **cloud-only by design** — no local containers, no daemons to install. You need a Postgres database (free tier on [Neon](https://neon.tech) is the canonical choice) and that's it.

```bash
gh repo create my-project --template=<your-org>/amadou-monolith --private --clone
cd my-project
cp .env.example .env.local         # fill DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, CRON_SECRET at minimum
pnpm install
pnpm db:migrate:deploy             # apply versioned migrations against your Neon DB
pnpm dev                           # http://localhost:3000
# in another terminal, after first signup:
pnpm db:make-superadmin you@example.com
pnpm smoke:auth                    # verify auth happy path end-to-end
```

To get `DATABASE_URL` + `DIRECT_URL`: create a free project at https://neon.tech, then copy two strings from the dashboard — the **`-pooler`** host as `DATABASE_URL` (with `?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`) and the non-pooled host as `DIRECT_URL`. Examples live in `.env.example`.

## Stack

- **App:** Next.js 16 (App Router) + React 19 + TypeScript — full-stack via `app/api/<resource>/route.ts` + Server Actions; no separate Express service
- **Database:** Prisma 5 (Postgres / Neon serverless via `-pooler` URL + `DIRECT_URL` for migrations)
- **Infra (all optional, env-gated):** Upstash Redis (rate limit + leader election + outbox), Cloudflare R2 / S3 (storage), Resend (email), Bictorys (payments), Google OAuth via `arctic`
- **Auth:** cookie + CSRF + JWT (15min access / 7d refresh / 7d csrf)
- **Observability:** Sentry via `@sentry/nextjs` (`instrumentation.ts` + `sentry.{client,server,edge}.config.ts`) — env-gated no-op without `SENTRY_DSN`; `@vercel/otel` for distributed traces
- **Tooling:** pnpm workspace (single package at `frontend/`), Vitest, ESLint 9 flat config, Prettier, Node 20+

## Required env vars (boot)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooler URL (`?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`) |
| `DIRECT_URL` | Direct (non-pooled) Neon URL for `prisma migrate` |
| `JWT_SECRET` | ≥32 chars, generate with `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | 32 bytes base64, generate with `openssl rand -base64 32` |
| `CRON_SECRET` | Bearer token required by `/api/cron/*` handlers; `openssl rand -base64 32` |
| `APP_URL` | Used for email link generation and OAuth redirect base; default `http://localhost:3000` |

Optional groups (set the vars to enable; absent = inert):

| Group | Vars | Inert behavior |
|---|---|---|
| R2 / S3 storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL?` | `/api/upload` falls back to DB-stored content; `/api/files/:key` proxies through Next |
| Email (Resend) | `RESEND_API_KEY`, `EMAIL_FROM` | Email queue rows accumulate but are never sent (drained by cron when key arrives) |
| Payments (Bictorys) | `BICTORYS_API_KEY`, `BICTORYS_PRIVATE_KEY`, `BICTORYS_WEBHOOK_SECRET`, `BICTORYS_MERCHANT_SECRET_CODE` | `/api/orders` and `/api/webhooks/bictorys` 404; circuit breaker stays in CLOSED state |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | `/api/auth/oauth/google/*` 404 |
| Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE?`, ... | Silent no-op (zero perf cost) |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | In-memory rate-limit fallback with a `logger.warn` at boot — DO NOT run in production without Upstash |

Full env reference with all flags: see [`.env.example`](.env.example) at the repo root (14 sections, every key documented with defaults + impact).

## Route Inventory

40 routes under `frontend/src/app/api/`. All declare `export const runtime = 'nodejs'` (enforced by [`frontend/src/lib/server/observability/runtime-enforcement.test.ts`](frontend/src/lib/server/observability/runtime-enforcement.test.ts)).

### Auth (`/api/auth/*`) — 10 routes
| Method | Path | Auth |
|---|---|---|
| POST | `/signup` | none |
| POST | `/login` | none |
| POST | `/logout` | cookies |
| POST | `/refresh` | refresh cookie (`/api/auth` scoped) |
| GET | `/me` | access cookie |
| POST | `/verify-email` | none |
| POST | `/forgot-password` | none |
| POST | `/reset-password` | none |
| PUT | `/change-password` | access + CSRF |
| GET/POST/DELETE | `/withdrawal-pin` | access + CSRF |

### OAuth — 2 routes
| Method | Path | Auth |
|---|---|---|
| GET | `/api/auth/oauth/google/start` | none |
| GET | `/api/auth/oauth/google/callback` | state cookie |

### Notifications — 3 routes
| Method | Path | Auth |
|---|---|---|
| GET | `/api/notifications` (list) | access |
| POST | `/api/notifications` (mark-read) | access + CSRF |
| GET | `/api/notifications/count` | access |
| GET/PATCH | `/api/notifications/prefs` | access (+CSRF on PATCH) |

### Orders + Withdrawals — 2 routes
| Method | Path | Auth |
|---|---|---|
| POST | `/api/orders` | optional |
| POST/GET | `/api/withdrawals` | access (+CSRF on POST) |

### Uploads + Files — 2 routes
| Method | Path | Auth |
|---|---|---|
| POST | `/api/upload` | access + CSRF |
| GET | `/api/files/[...key]` | none (R2 proxy) |

### Webhooks — 1 route
| Method | Path | Auth |
|---|---|---|
| POST | `/api/webhooks/bictorys` | provider HMAC + 60s replay window |

### Cron handlers — 5 routes (all `Authorization: Bearer ${CRON_SECRET}`)
| Path | Schedule (`vercel.json`) |
|---|---|
| `/api/cron/outbox-drain` | every 1 min |
| `/api/cron/email-queue-drain` | every 1 min |
| `/api/cron/verification-cleanup` | hourly |
| `/api/cron/order-expiration` | every 5 min |
| `/api/cron/webhook-log-purge` | daily |

### Admin (`/api/admin/*`) — 12 routes
| Method | Path | Auth |
|---|---|---|
| GET | `/me` | ADMIN |
| GET | `/users` (list) | ADMIN |
| GET | `/users/:id` | ADMIN |
| PATCH | `/users/:id/role` | SUPERADMIN + CSRF |
| PATCH | `/users/:id/status` | ADMIN/SUPERADMIN + CSRF |
| GET | `/orders` | ADMIN |
| GET | `/withdrawals` | ADMIN |
| POST | `/withdrawals/:id/cancel` | SUPERADMIN + CSRF |
| GET | `/audit-log` | ADMIN |
| GET | `/outbox` | ADMIN |
| GET | `/email-queue` | ADMIN |
| GET | `/rate-limits` | ADMIN |

### Health — 2 routes
| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{ ok: true, time }` (liveness) |
| GET | `/api/readyz` | `{ ok, db, redis }` (readiness, 503 on failure) |

Full request/response shapes: read the route handlers under [`frontend/src/app/api/`](frontend/src/app/api/). The route handlers are the contract.

## Smoke test

`pnpm smoke:auth` runs [`frontend/scripts/smoke-auth.ts`](frontend/scripts/smoke-auth.ts) against a running `pnpm dev`. It signs up, peeks the verification code from the DB via Prisma, verifies email, calls `GET /api/auth/me`, and logs out. Exit 0 on full pass; 1 + descriptive log on any failure.

Override the target with `SMOKE_BASE_URL` for preview deployments:

```bash
SMOKE_BASE_URL=https://my-preview.vercel.app pnpm smoke:auth
```

The smoke script requires `DATABASE_URL` and `JWT_SECRET` set (it peeks the verification code directly via Prisma — no `/api/test/peek-code` endpoint). Not run in CI; manual UAT only.

## Deploy to Vercel

1. Push the repo to a Vercel project pointed at `frontend/` as the root directory (the project is a pnpm workspace; Vercel auto-detects via `pnpm-workspace.yaml`).
2. Map every required-to-boot env var in Vercel project settings (Production + Preview + Development).
3. [`frontend/vercel.json`](frontend/vercel.json) declares cron schedules — Vercel auto-registers them on deploy. No additional setup needed.
4. Sentry source-map upload runs in `next build` if `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` are set as build-time env vars.
5. Standalone output is auto-detected (`next.config.ts` enables it); no extra config.
6. Sentry / OTel init details live in [`frontend/instrumentation.ts`](frontend/instrumentation.ts) and the `sentry.*.config.ts` files — read those for hook-ordering specifics.

## Design system — fully swappable

The starter ships **no UI components** by design. What you get:

- [frontend/src/app/page.tsx](frontend/src/app/page.tsx) — `return null` placeholder; write your homepage here
- [frontend/src/app/layout.tsx](frontend/src/app/layout.tsx) — `Inter` font + `<html>/<body>` shell + 2 client contexts (`AuthProvider`, `ToastProvider`). Both contexts are **logic-only** (zero design coupling) — keep them, restyle the toasts in your own components
- [frontend/src/app/error.tsx](frontend/src/app/error.tsx) — Tailwind-styled error boundary; replace with your own
- [frontend/src/app/globals.css](frontend/src/app/globals.css) — single line `@import 'tailwindcss';` (Tailwind v4 zero-config). Drop the line + remove `@tailwindcss/postcss` from [postcss.config.mjs](frontend/postcss.config.mjs) to leave Tailwind out entirely.
- [examples/frontend-pages/](examples/frontend-pages/) — 11 reference Tailwind pages (login, signup, verify-email, forgot/reset-password, dashboard, withdrawals, payment-success/failure, auth-error, admin/{layout,users,withdrawals}). Copy and restyle, or rebuild from scratch — they consume the same `/api/*` routes either way.

**No server lib touches the DOM.** Routes return `NextResponse.json(...)` only. You can ship a plain-React UI, a shadcn/ui front, a Mantine dashboard, a SwiftUI iOS app via the same JSON contract — the backend stays unchanged.

## Bundled Claude Code skills

Forks open in Claude Code automatically pick up two design-system skills under [.claude/skills/](.claude/skills/) — they fill the "headless = no UI" gap for beginners:

| Skill | Trigger phrases | What it does |
|---|---|---|
| [`banani-design-implementation`](.claude/skills/banani-design-implementation/SKILL.md) | "build this from Banani", "use the Banani MCP", "reproduce this screen" | Pixel-perfect 1:1 reproduction of selected Banani screens via the Banani MCP. Reads `CLAUDE.md` for the project stack (no Tailwind/React assumptions), plans the work, tracks progress across sessions. |
| [`ui-ux-pro-max`](.claude/skills/ui-ux-pro-max/SKILL.md) | "design", "build", "improve", "review UI" + any of: button/modal/navbar/dashboard/landing/SaaS/glassmorphism/etc. | Searchable design intelligence: 67 styles, 96 palettes, 57 font pairings, 99 UX guidelines, 25 chart types across 13 stacks (Next.js, React, Vue, SwiftUI, Flutter…). Includes shadcn/ui MCP integration. |

Beginners can therefore go from `gh repo create --template` to a designed UI in one chat: describe the screen → either skill takes over → the API routes are already wired.

## Project layout

```
amadou-monolith/
├── frontend/                    The Next.js 16 app (full-stack)
│   ├── prisma/                  schema.prisma + migrations
│   ├── scripts/                 make-superadmin.ts, seed-dev.ts, smoke-auth.ts (run via tsx)
│   ├── vercel.json              cron schedules (5 entries)
│   ├── .env.example             env reference
│   └── src/
│       ├── app/api/             route handlers
│       └── lib/
│           ├── api.ts           browser fetch wrapper (PROTECTED)
│           └── server/          server-only libs (auth, crypto, payments, oauth, webhook, outbox, cron, ...)
├── examples/frontend-pages/     reference UIs to copy and restyle (admin/, auth-error)
├── .planning/                   roadmap, phases, decisions (gsd workflow)
├── pnpm-workspace.yaml          workspace = frontend/ only
└── package.json                 orchestrator scripts (proxy `pnpm --filter frontend ...`)
```

## What's NOT shipped (out of scope)

Mirroring [`.planning/PROJECT.md`](.planning/PROJECT.md) "Out of Scope" — copied to keep this README self-contained.

| Feature | Reason |
|---|---|
| UI components / pages | Headless by design — every fork builds its own UX |
| Multi-provider payments out of the box | `PaymentProvider` interface allows per-project swap; default ships Bictorys only |
| Long-running worker process | Vercel-first decision — all background work runs as scheduled route handlers |
| Auth.js / NextAuth migration | Custom JWT + cookies + CSRF kept for full template parity |
| Edge runtime / Cloudflare Workers compatibility | All routes are `runtime='nodejs'` |
| Public OSS distribution (docs site, npm package, CLI bootstrapper) | Personal/private use |
| Frontend test framework (Playwright / RTL) | Vitest covers `lib/server/**` only; UI tests are per-project |
| Distributed circuit breaker in v1 | Single-instance limit; deferred to v2 |
| i18n beyond FCFA defaults | Per-project concern |
| Built-in TOTP / 2FA | Passkeys (v2) supersede |

## Critical invariants

These are the rules every Claude session must respect — see [CLAUDE.md](CLAUDE.md) for the full list. The short version:

- Every Route Handler exports `runtime = 'nodejs'` (CI-enforced)
- Webhook handlers read raw body via `req.arrayBuffer()` BEFORE any JSON parse (HMAC integrity)
- Notifications go through `createNotification(prisma, input)` — never `prisma.notification.create` directly
- Withdrawals use `pg_advisory_xact_lock(hashtext(userId))` inside Serializable tx (call `withUserAdvisoryLock`)
- Webhook side-effects go to outbox via `enqueueOutbox(tx, event)` — never fire-and-forget
- Cron handlers verify `Authorization: Bearer ${CRON_SECRET}`
- OAuth callback refuses `email_verified !== true`
- Admin mutations call `logAdminAction(prisma, {...})` — bypass = compliance regression
- Frontend `api()` wrapper retries only `GET`/`HEAD` on network errors

## License

UNLICENSED — internal template.
