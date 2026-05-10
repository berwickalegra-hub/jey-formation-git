---
id: 06-03-readme-rewrite-and-roadmap-fix
phase: "06"
plan: 03
type: execute
wave: 2
depends_on: ["01"]
files_modified:
  - README.md
  - .planning/ROADMAP.md
autonomous: true
task_count: 1
requirements:
  - DOC-02
must_haves:
  truths:
    - "README.md ships the 7-section outline from RESEARCH §'README.md Section Outline': ① What this is, ② Quickstart, ③ Env reference, ④ Route inventory, ⑤ Smoke test, ⑥ Deploy to Vercel, ⑦ What's NOT shipped"
    - "README.md quickstart command sequence: cp .env.example .env.local + pnpm install + docker compose up -d + pnpm db:migrate:deploy + pnpm dev + pnpm smoke:auth (post-Phase-6 form)"
    - "README.md route inventory points at frontend/src/app/api/ explicitly"
    - "README.md mentions pnpm smoke:auth and CRON_SECRET (asserted by readme-shape.test.ts from plan 06-01)"
    - "README.md voice matches STATUS.md — terse, technical, no marketing copy, no emojis"
    - ".planning/ROADMAP.md Phase 6 success criterion #4 docker command updated to `docker build -f frontend/Dockerfile -t amadou-monolith .`"
    - "Zero errant Express/backend/src/express.json refs (allow only the historical-context negation phrasing — same convention as CLAUDE.md tripwire)"
    - "readme-shape.test.ts (from plan 06-01) goes from RED to GREEN against the rewritten README"
  artifacts:
    - path: "README.md"
      provides: "Public-facing project entry — quickstart, env ref, route inventory, deploy guide, scope-boundaries"
      min_lines: 200
    - path: ".planning/ROADMAP.md"
      provides: "Phase 6 success criterion #4 reads `docker build -f frontend/Dockerfile -t amadou-monolith .` (the -f flag was missing pre-rewrite)"
      min_lines: 140
  key_links:
    - from: "README.md `## Quickstart`"
      to: "frontend/.env.example + frontend/scripts/smoke-auth.ts (Phase 6 plan 06-01)"
      via: "command sequence references both files"
      pattern: "pnpm smoke:auth"
    - from: "README.md `## Route Inventory`"
      to: "frontend/src/app/api/**/route.ts (40 routes across auth/admin/cron/etc.)"
      via: "manual table grouped by area; counts derived from `find frontend/src/app/api -name route.ts | wc -l`"
      pattern: "frontend/src/app/api"
    - from: "README.md `## Deploy to Vercel`"
      to: "frontend/vercel.json (Phase 5) + frontend/instrumentation.ts (Phase 0)"
      via: "narrative pointer to existing files; no duplication of contents"
      pattern: "vercel.json"
    - from: ".planning/ROADMAP.md Phase 6 line ~123"
      to: "frontend/Dockerfile"
      via: "command flag fix — `-f frontend/Dockerfile` makes the build invocation correct"
      pattern: "-f frontend/Dockerfile"
---

<objective>
Single-task full rewrite of `README.md` to the 7-section outline from RESEARCH §"README.md Section Outline" + a 1-line fix to `.planning/ROADMAP.md` Phase 6 success criterion #4 (the `docker build` command needs the `-f frontend/Dockerfile` flag because the Dockerfile lives at `frontend/Dockerfile`, not repo root).

Purpose: The current README.md still reads as an "in-progress port" (`> Status: in-progress port from amadou-template...`) and references Prisma 7 + lists target routes that have all shipped. Operators cloning the template need a state-of-art, post-Phase-5 README — quickstart that works, route inventory pointing at the actual files, deploy guide, and a clear "what's NOT shipped" boundary. The voice matches `STATUS.md`: terse, technical, no marketing.

The ROADMAP fix is a single-line edit but lives alongside the README rewrite because both files concern the same Docker doc surface (RESEARCH §"Docker Build Verification Recipe" recommends bundling them).

Output: 2 files modified — `README.md` (full rewrite, ~200-300 lines) and `.planning/ROADMAP.md` (1-line success-criterion fix).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/06-tests-scripts-docker-docs/06-CONTEXT.md
@.planning/phases/06-tests-scripts-docker-docs/06-RESEARCH.md
@README.md
@STATUS.md
@CLAUDE.md
@frontend/.env.example
@frontend/Dockerfile
@docker-compose.yml
@frontend/vercel.json
@frontend/package.json

<reference_patterns>
- **Voice/style:** Match STATUS.md — terse, technical, no marketing language, no emojis, no "we built X with Y to delight users" copy. Status.md uses single-sentence bullets and inline backtick code.
- **Quickstart command sequence (D-05 verbatim):** Per RESEARCH §"② Quickstart — 6 commands". Note `cp .env.example .env.local` (NOT `.env`) — verified consistent with vitest/dev tooling.
- **Route inventory:** Manual table grouped by area. RESEARCH §"④ Route inventory" gives the counts (40 total: Auth 10, OAuth 2, Withdrawal-PIN 1, Notifications 3, Orders 1, Withdrawals 1, Uploads 2, Webhooks 1, Crons 5, Admin 12, Health 2). The current README's API table is accurate; reuse the rows verbatim.
- **Env reference table:** RESEARCH §"③ Env reference" — single short "required to boot" table, then one-line pointers to the optional groups (R2, Resend, Bictorys, Google, Sentry, Upstash) with the inert-without-env behavior summary. Do not duplicate the full env table from CLAUDE.md / .env.example.
- **Deploy section:** RESEARCH §"⑥ Deploy to Vercel" — link out to instrumentation.ts comments rather than duplicating Sentry/OTel notes.
- **Scope boundary:** RESEARCH §"⑦ What's NOT shipped" — copy from `.planning/PROJECT.md` "Out of Scope" table verbatim.
</reference_patterns>

<sibling_plans_note>
This is a Wave 1 plan running parallel to 06-02 (CLAUDE.md cleanup) and 06-04 (STATUS.md refresh). File overlap matrix: this plan = `README.md` + `.planning/ROADMAP.md`; 06-02 = `CLAUDE.md` only; 06-04 = `STATUS.md`. ZERO overlap. Once this plan AND plan 06-02 merge back, the doc-tripwire tests from plan 06-01 (`claude-md-shape.test.ts` + `readme-shape.test.ts`) flip from RED to GREEN.
</sibling_plans_note>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rewrite README.md to 7-section outline + fix ROADMAP Phase 6 success criterion #4</name>
  <files>
    - README.md (FULL REWRITE)
    - .planning/ROADMAP.md (1-line edit)
  </files>
  <read_first>
    - README.md (current state — confirm voice/sections to preserve where verbatim copy is allowed; confirm the API table at lines ~86-189 matches the post-Phase-5 surface)
    - STATUS.md (voice/style reference)
    - .planning/PROJECT.md (Out of Scope section — copy verbatim into Section ⑦)
    - .planning/ROADMAP.md Phase 6 block (find the exact line with `docker build -t amadou-monolith .` to fix)
    - frontend/.env.example (env-key list — for cross-reference; no duplication)
    - frontend/Dockerfile (confirm location: at `frontend/Dockerfile`, not repo root)
    - frontend/vercel.json (confirm 5 cron entries — referenced from Section ⑥)
    - .planning/phases/06-tests-scripts-docker-docs/06-RESEARCH.md §"README.md Section Outline" (full skeleton)
  </read_first>
  <action>
**STEP 1: Replace `README.md` with the 7-section structure below.** Voice is terse + technical; match STATUS.md.

```markdown
# amadou-monolith

Headless full-stack starter for the Next.js 16 + Prisma 5 + Neon + Upstash + R2 + Resend + Bictorys + Sentry stack. Single deployable Next.js app — no separate backend service. Third-party providers (R2, Resend, Bictorys, Google OAuth, Sentry, Upstash) are env-gated and inert without their vars; the app boots and `/api/auth` works with just `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, and `CRON_SECRET`. The app ships only logic — no UI components, no pages — every fork designs its own UX.

See [.planning/PROJECT.md](.planning/PROJECT.md) for the project vision and [STATUS.md](STATUS.md) for the port progress.

## Quickstart

```bash
gh repo create my-project --template=<your-org>/amadou-monolith --private --clone
cd my-project
cp .env.example .env.local         # fill DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, CRON_SECRET at minimum
pnpm install
docker compose up -d               # local Postgres + Redis + MinIO + Mailpit
pnpm db:migrate:deploy             # apply versioned migrations
pnpm dev                           # http://localhost:3000
# in another terminal, after first signup:
pnpm db:make-superadmin you@example.com
pnpm smoke:auth                    # verify auth happy path end-to-end
```

Local docker-compose connection string: `postgresql://postgres:postgres@localhost:5432/amadou_dev`. Production-shape Neon URL example lives in `.env.example` (the `-pooler` host with `?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`).

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

Full env reference with all flags: see [`frontend/.env.example`](frontend/.env.example).

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

To verify the Docker build locally (matches Vercel runtime closely):

```bash
docker build -f frontend/Dockerfile -t amadou-monolith .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=... -e JWT_SECRET=... -e ENCRYPTION_KEY=... \
  amadou-monolith
curl -fsS http://localhost:3000/api/health    # → {"ok":true,...}
```

The build context is the repo root because the Dockerfile copies `pnpm-workspace.yaml` and `frontend/`.

## Project layout

```
amadou-monolith/
├── frontend/                    The Next.js 16 app (full-stack)
│   ├── prisma/                  schema.prisma + migrations
│   ├── scripts/                 make-superadmin.ts, seed-dev.ts, smoke-auth.ts (run via tsx)
│   ├── Dockerfile               multi-stage Node 20 build with standalone output
│   ├── vercel.json              cron schedules (5 entries)
│   ├── .env.example             env reference
│   └── src/
│       ├── app/api/             route handlers
│       └── lib/
│           ├── api.ts           browser fetch wrapper (PROTECTED)
│           └── server/          server-only libs (auth, crypto, payments, oauth, webhook, outbox, cron, ...)
├── examples/frontend-pages/     reference UIs to copy and restyle (admin/, auth-error)
├── .planning/                   roadmap, phases, decisions (gsd workflow)
├── docker-compose.yml           Postgres + Redis + MinIO + Mailpit for local dev
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
```

**STEP 2: Edit `.planning/ROADMAP.md` Phase 6 success criterion #4.**

Locate the line via grep:
```bash
grep -n "docker build -t amadou-monolith" .planning/ROADMAP.md
```

Should return exactly 1 line (around line 123, inside Phase 6's Success Criteria block).

OLD:
```
  4. `docker build -t amadou-monolith .` succeeds; `docker compose up -d` starts `db` + `redis` + `mailpit` + `minio` (no `backend` service); `docker run` of the built image serves `/api/health` returning 200
```

NEW:
```
  4. `docker build -f frontend/Dockerfile -t amadou-monolith .` succeeds; `docker compose up -d` starts `postgres` + `redis` + `mailpit` + `minio` (no `backend` service); `docker run` of the built image serves `/api/health` returning 200
```

Two changes on this line:
- Add `-f frontend/Dockerfile` flag (Dockerfile lives at `frontend/Dockerfile`, not repo root)
- `db` → `postgres` (matches the actual service name in `docker-compose.yml`)

**STEP 3: Verify with grep:**

```bash
# README requirements (matches readme-shape.test.ts assertions):
grep -q "cp \.env\.example \.env\.local" README.md
grep -q "pnpm install" README.md
grep -q "pnpm dev" README.md
grep -q "docker compose up" README.md
grep -q "pnpm smoke:auth" README.md
grep -q "CRON_SECRET" README.md
grep -q "frontend/src/app/api" README.md

# README must NOT have errant Express references:
test "$(grep -cE '\bExpress\b' README.md)" -le 1   # at most 1 negation reference

# Backend/src must be 0:
! grep -qE 'backend/src' README.md

# express.json must be 0:
! grep -qE 'express\.json\(' README.md

# ROADMAP fix:
grep -q "docker build -f frontend/Dockerfile -t amadou-monolith" .planning/ROADMAP.md
! grep -q "docker build -t amadou-monolith \." .planning/ROADMAP.md   # the bare form is GONE
```

All 12 checks must pass. Adjust the README content if any fail (likely cause: rephrasing that drops a target keyword).

**Critical voice/style enforcement:**
- No emojis anywhere in README.md (use `! grep -P '[\x{1F300}-\x{1F9FF}]' README.md` to verify if grep supports it; otherwise rely on visual review)
- No marketing copy ("delight users", "world-class", "blazing fast", "best-in-class", "industry-leading")
- No first-person plural ("we built", "we chose") — third-person factual
- Inline backticks for filenames + commands; fenced code blocks for multi-line shell + JSON
- Tables for env-vars, route inventory, scope-boundaries

**Critical layout enforcement:**
- The 7 sections from RESEARCH (numbered ① through ⑦ in CONTEXT/RESEARCH; the README uses descriptive headings, not the circled numbers)
- Map: `# amadou-monolith` (intro = ①) → `## Quickstart` (②) → `## Required env vars (boot)` + optional groups table (③) → `## Route Inventory` (④) → `## Smoke test` (⑤) → `## Deploy to Vercel` (⑥) → `## What's NOT shipped (out of scope)` (⑦) → `## Critical invariants` (extra — supports the test) + `## License`
- "Stack" + "Project layout" sections are supplementary; place after Quickstart and after Deploy respectively
  </action>
  <verify>
    <automated>grep -q "pnpm smoke:auth" README.md && grep -q "CRON_SECRET" README.md && grep -q "frontend/src/app/api" README.md && grep -q "cp \.env\.example \.env\.local" README.md && grep -q "docker build -f frontend/Dockerfile -t amadou-monolith" .planning/ROADMAP.md && ! grep -qE 'backend/src' README.md</automated>
  </verify>
  <acceptance_criteria>
    - `wc -l README.md` >= 200 (full rewrite produces ~200-300 lines)
    - `grep -q "cp \.env\.example \.env\.local" README.md` exits 0 (quickstart command present)
    - `grep -q "pnpm install" README.md` exits 0
    - `grep -q "pnpm dev" README.md` exits 0
    - `grep -q "docker compose up" README.md` exits 0
    - `grep -q "pnpm smoke:auth" README.md` exits 0 (Section ⑤)
    - `grep -q "CRON_SECRET" README.md` exits 0 (Section ③ env table)
    - `grep -q "frontend/src/app/api" README.md` exits 0 (Section ④ route inventory)
    - `grep -q "vercel.json" README.md` exits 0 (Section ⑥ deploy)
    - `grep -q "instrumentation.ts" README.md` exits 0 (Section ⑥ Sentry/OTel link-out)
    - `grep -q "Out of scope\|NOT shipped" README.md` exits 0 (Section ⑦)
    - `! grep -qE "backend/src" README.md` exits 0 (no errant backend refs)
    - `! grep -qE "express\.json\(" README.md` exits 0 (no Express middleware refs)
    - `test "$(grep -cE '\bExpress\b' README.md)" -le 1` (at most 1 historical-context negation)
    - `grep -q "docker build -f frontend/Dockerfile -t amadou-monolith" .planning/ROADMAP.md` exits 0 (ROADMAP fix landed)
    - `! grep -q "docker build -t amadou-monolith \." .planning/ROADMAP.md` exits 0 (bare command form gone)
    - `grep -q "Prisma 5" README.md` exits 0 (NOT "Prisma 7" — the current README's stale claim corrected)
    - `grep -q "Critical invariants" README.md` exits 0 (penultimate section present)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/readme-shape.test.ts` exits 0 (tripwire from plan 06-01 GREEN)
    - `pnpm format:check` passes (Markdown is unaffected by Prettier; sanity check)
    - `git status --porcelain` shows exactly 2 files modified: `M README.md` + `M .planning/ROADMAP.md`
  </acceptance_criteria>
  <done>README.md fully rewritten to the 7-section outline; ROADMAP.md success criterion #4 docker command flag fixed; readme-shape.test.ts (from plan 06-01) GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer→repo | README.md is checked into git; public-facing project entry — no secrets |
| operator→quickstart | Following the Quickstart commands runs scripts that touch the local DB but not production |
| AI agent→README | Future Claude/Cursor sessions read README.md as bootstrap context; outdated route inventory or stale Prisma version is a soft-correctness risk |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-03-01 | I (Information disclosure) | leaking real Bictorys/Sentry/Resend env values into README example blocks | mitigate | All env examples use placeholders or shell-substitution markers (`...`); no real keys; readme-shape.test.ts doesn't enforce this directly but the absence of base64 strings in the rewrite is observable in `git diff` |
| T-06-03-02 | T (Tampering) | quickstart command sequence diverges from actual scripts | mitigate | Acceptance criteria asserts the specific command tokens (`cp .env.example .env.local`, `pnpm install`, `pnpm dev`, `docker compose up`, `pnpm smoke:auth`, `pnpm db:migrate:deploy`); planner-checker re-verifies post-write |
| T-06-03-03 | E (Elevation of privilege) | omitting the OAuth `email_verified !== true` invariant from the Critical-invariants section | mitigate | The README "Critical invariants" section explicitly enumerates 9 invariants; readme-shape.test.ts doesn't check the OAuth one specifically but `claude-md-shape.test.ts` already covers CLAUDE.md (the canonical source) |
| T-06-03-04 | T (Tampering) | accidentally introducing Prisma 7 reference (the current README has this stale claim) | mitigate | Acceptance criterion `grep -q "Prisma 5" README.md` enforces the correct version; the rewrite explicitly states "Prisma 5" |
| T-06-03-05 | I (Information disclosure) | route inventory leaking internal-only routes | accept | All 40 routes listed are public-API by design; no admin internals beyond what `requireAdmin` already gates at runtime |
</threat_model>

<verification>
- All 19 acceptance criteria pass
- `pnpm --filter frontend exec vitest run src/lib/server/observability/readme-shape.test.ts` exits 0 (tripwire from plan 06-01 GREEN — assumes plan 06-01 has merged back; if running in isolated worktree, document RED status with note that test will GREEN after plan 06-01 merge)
- `pnpm format:check` passes
- `git diff --stat README.md` shows ~250-line delta (full rewrite — most lines added; old lines removed)
- `git diff --stat .planning/ROADMAP.md` shows 1-line delta
- No protected file modified
</verification>

<success_criteria>
- README.md ships with the 7-section outline
- Quickstart sequence is current (post-Phase-6 form including `pnpm smoke:auth`)
- Route inventory points at `frontend/src/app/api/` with 40 routes grouped by area
- Env reference uses required-to-boot table + optional-group inert-behavior table
- Deploy section links to `frontend/vercel.json` + `frontend/instrumentation.ts` (no duplication)
- Out-of-scope section copies from PROJECT.md
- Voice matches STATUS.md (terse, no marketing, no emojis)
- ROADMAP Phase 6 success criterion #4 docker command flag fixed
- readme-shape.test.ts from plan 06-01 GREEN
</success_criteria>

<output>
After completion, create `.planning/phases/06-tests-scripts-docker-docs/06-03-SUMMARY.md`:
- Files modified: `README.md` (full rewrite), `.planning/ROADMAP.md` (1-line fix)
- README before/after line count + section count
- Quickstart command sequence verbatim (so reviewers can copy-paste verify)
- Route inventory totals (40 routes, broken down by area)
- ROADMAP edit before/after pair
- All 19 acceptance criteria results
- readme-shape.test.ts result (PASS/FAIL — note expected RED-until-merge-back of plan 06-01)
- Voice/style audit notes (no emojis found; no marketing language found; first-person plural absent)
</output>
</content>
