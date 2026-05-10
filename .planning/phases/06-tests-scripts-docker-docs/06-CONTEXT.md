# Phase 6: Tests, Scripts, Docker, Docs - Context

**Gathered:** 2026-05-10 (auto-mode; no interactive discussion)
**Status:** Ready for planning

<domain>
## Phase Boundary

Polish + verify the monolith for v1 tag. Most of the heavy lifting was already done incrementally in Phases 0–5; Phase 6 closes the audit loop:

1. **TEST-02 audit + gap-fill** — confirm every battle-tested lib in the list (`auth`, `crypto`, `webhook/handler`, `withdrawals/lock`, `outbox/dispatcher`, `oauth/google`, `notifications/createNotification`, `admin/audit`, `payments/circuit-breaker`) has Vitest unit tests. The grep currently shows 21 `*.test.ts` files under `lib/server/**` from Phases 0–5; verify coverage and add any missing.
2. **TEST-03** — ship `frontend/scripts/smoke-auth.ts` (or similar): a `tsx`-runnable script that hits `http://localhost:3000` against a running `next dev` for the auth happy path (signup → verify-email → me → logout). Exits 0 on success. Documented in README quickstart.
3. **SCRIPT-01 verify** — `frontend/scripts/make-superadmin.ts` and `seed-dev.ts` already exist (Phase 3 ADMIN-07 / D-SCRIPT-01). Confirm both import from `@/lib/server/prisma` (canonical path) and run via `tsx`. Add lightweight `*.test.ts` for `seed-dev.ts` if missing (`make-superadmin.test.ts` already exists).
4. **DOCKER-01 reconciliation** — `frontend/Dockerfile` exists with multi-stage build (`next build && next start` via standalone output). `docker-compose.yml` already drops the `backend` service (verified: 4 services — postgres, redis, minio, mailpit). The remaining work is (a) verify `docker build` succeeds end-to-end and `/api/health` responds 200 from a running container, (b) decide whether to add a top-level repo-root `Dockerfile` symlink/wrapper since ROADMAP success criterion #4 reads `docker build -t amadou-monolith .` (build context at repo root) — current path requires `-f frontend/Dockerfile`.
5. **DOC-01 (CLAUDE.md)** — already largely Next.js-monolith-shaped. Phase 6 audit: `grep -E "Express|backend/src|express\\.json|middleware-order"` should return 0 hits. Append references to the routes that landed in Phases 4–5 (uploads, webhooks, crons) to keep the "what this is" section honest.
6. **DOC-02 (README.md)** — rewrite for monolith: quickstart (`pnpm install && docker compose up -d && pnpm db:push && pnpm dev`), env reference, deploy-to-Vercel guide, route inventory pointing at `frontend/src/app/api/`, smoke-test pointer.

This phase ships ZERO new domain logic. Lean wave structure: one Wave 0 plan (TEST audit + smoke script + SCRIPT verification) and 2–3 Wave 1 plans (Docker reconciliation, CLAUDE.md cleanup, README rewrite — all parallel, no `files_modified` overlap).

</domain>

<decisions>
## Implementation Decisions

### Pre-state inventory (already shipped)

- **D-PRE-01:** `frontend/vitest.config.ts` already has `setupFiles: ['./vitest.setup.ts']` seeding `JWT_SECRET` and `ENCRYPTION_KEY` (Phase 1 D-27). **TEST-01 is satisfied** — Phase 6 confirms via cross-reference, no new work.
- **D-PRE-02:** `frontend/scripts/make-superadmin.ts` exists with companion `make-superadmin.test.ts`. `frontend/scripts/seed-dev.ts` exists. Both run via `tsx` per Phase 3 D-SCRIPT-01. **SCRIPT-01 mostly satisfied** — Phase 6 verifies imports + adds `seed-dev.test.ts` if missing.
- **D-PRE-03:** `frontend/Dockerfile` exists with two-stage Node 20 build (builder runs `pnpm build`, runtime runs the standalone server as user `app`). `docker-compose.yml` has 4 services (postgres, redis, minio, mailpit) — no `backend` service. **DOCKER-01 mostly satisfied** — Phase 6 verifies end-to-end build + run + `/api/health`.
- **D-PRE-04:** `frontend/.env.example` already has `CRON_SECRET=""` documented (Phase 0 OPS-04). **ENV-01 is satisfied** — confirm via grep, no new work.
- **D-PRE-05:** 21 `*.test.ts` files exist under `lib/server/**` from Phases 0–5; full Vitest suite is 508/508 GREEN. **TEST-02 is largely satisfied** — Phase 6 audits the 9 specifically-named libs and gap-fills any missing.

### Genuine remaining work

- **D-01:** TEST-03 ships a `frontend/scripts/smoke-auth.ts` script (NEW). Implementation: pure-`fetch` against `process.env.SMOKE_BASE_URL ?? 'http://localhost:3000'`. Sequence: signup → fetch verification code from DB (or a `/api/test/peek-code` dev-only endpoint — TBD by researcher) → POST verify-email → GET me → DELETE logout. Each step must assert HTTP status + parse JSON body. Exits 0 on full pass; 1 + descriptive log on any failure. Documented as `pnpm smoke:auth` in `package.json`. NOT run in CI (requires a live server); manual UAT only.
- **D-02:** TEST-02 audit produces a coverage report (inline in the plan SUMMARY) listing each of the 9 named libs and their corresponding test file path. Any missing test is added in this phase as a focused unit test (~30 LOC). Likely candidates for gap-fill: `oauth/google.test.ts`, `notifications/createNotification.test.ts`, `admin/audit.test.ts`, `payments/circuit-breaker.test.ts` — the others are well-covered already.
- **D-03:** DOCKER-01 reconciliation: add a tiny `Dockerfile` at REPO ROOT that wraps `frontend/Dockerfile` with a one-line FROM/COPY (or use `--file frontend/Dockerfile` in CI documentation). Recommended: keep `frontend/Dockerfile` as the canonical one and update ROADMAP success criterion #4 + README quickstart to use `docker build -f frontend/Dockerfile -t amadou-monolith .`. NO root-level Dockerfile (avoids two source-of-truth files; the planner picks the cleaner of the two).
- **D-04:** DOC-01 (CLAUDE.md) cleanup. Required additions: (a) route inventory for Phase 4 (upload/files/withdrawals) and Phase 5 (webhook + 5 crons + vercel.json); (b) update `Files Claude SHOULD modify` to include the new `lib/server/cron/`, `lib/server/webhook/bictorys.ts` re-export, `lib/server/orders/expire.ts`; (c) any stray Express references purged. NO content reorganization — preserve the existing structure (it's already Next.js-shaped).
- **D-05:** DOC-02 (README.md) rewrite from scratch. Sections: ① What this is (monolith starter, link to PROJECT.md), ② Quickstart (clone → install → docker compose up → db:push → dev), ③ Env reference (table linking to `.env.example` blocks), ④ Route inventory (auto-generated table from `app/api/**/route.ts`), ⑤ Smoke test (`pnpm smoke:auth`), ⑥ Deploy to Vercel (env mapping, cron schedules in `vercel.json`, instrumentation gotchas), ⑦ "What's NOT shipped" boundary list (links to PROJECT.md "Out of Scope" section).
- **D-06:** Wave structure: ONE Wave 0 plan (audit + smoke script + script-tests + DOCKER verify) ships first; THREE Wave 1 plans run in parallel (CLAUDE.md cleanup, README rewrite, root-level Docker tweaks if any). Mirrors the lean Phases 4–5 pattern but with smaller scope.

### Claude's Discretion

- Specific gap-fill test names / scope (researcher resolves).
- Whether the smoke script peeks the verification code via the DB directly (Prisma) or via a dev-only `/api/test/*` endpoint (researcher recommends).
- README.md prose style — match the existing `STATUS.md` voice (terse, technical, no marketing).
- Whether to add a `pnpm test:smoke` shortcut alongside `pnpm smoke:auth` (planner decides).
- Sentry/OTel notes in the deploy guide (link out to existing instrumentation.ts comments rather than duplicating).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — vision + boundaries
- `.planning/REQUIREMENTS.md` — TEST-01..03, SCRIPT-01, DOCKER-01, DOC-01..02, ENV-01 acceptance criteria
- `.planning/ROADMAP.md` Phase 6 block — goal + 5 success criteria
- `./CLAUDE.md` — current state of project instructions; DOC-01 rewrites this
- `README.md` — current state (likely stale Express-era content); DOC-02 rewrites this
- `STATUS.md` — port roadmap voice / style reference

### Existing assets to verify or extend
- `frontend/vitest.config.ts` — TEST-01 already satisfied
- `frontend/vitest.setup.ts` — JWT_SECRET / ENCRYPTION_KEY fixtures
- `frontend/scripts/make-superadmin.ts` + `make-superadmin.test.ts` — SCRIPT-01 already shipped
- `frontend/scripts/seed-dev.ts` — needs companion test if missing
- `frontend/Dockerfile` — multi-stage; verify end-to-end
- `docker-compose.yml` — 4 services, no `backend` (already correct)
- `frontend/.env.example` — ENV-01 already satisfied (CRON_SECRET present)
- 21 existing `*.test.ts` files under `frontend/src/lib/server/**` — TEST-02 audit input

### v1 tagging dependencies
- Phase 7 (Final Pass) depends on this phase. After Phase 6 lands, `/gsd-execute-phase 7` runs `pnpm format && pnpm lint && pnpm typecheck && pnpm test` + a deploy preview + tags v1.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Smoke-test fixture pattern** — Phase 1 already wrote unit tests using `vitest.setup.ts` to seed env vars. The smoke script reuses the same env-loader pattern but against a running server.
- **`make-superadmin.test.ts`** — model `seed-dev.test.ts` after this if missing.
- **`runtime-enforcement.test.ts`** at `frontend/src/lib/server/observability/` — Phase 0's CI grep guard. Phase 6 should mirror this pattern for any new "doc-shape" tripwire (e.g., assert CLAUDE.md has no Express references).
- **`vercel-json-shape.test.ts`** at `frontend/src/lib/server/observability/` — Phase 5's tripwire. Phase 6 may add a similar `claude-md-shape.test.ts` or `readme-shape.test.ts` to lock the doc audit (no Express, no backend/src references) as a CI guard rather than a one-time fix.

### Established Patterns
- **Single Vitest config** at `frontend/vitest.config.ts` covers `src/**/*.test.ts` AND `scripts/**/*.test.ts`. Smoke tests do NOT live here (they require a running server) — they run separately via `pnpm smoke:auth`.
- **`tsx`-runnable scripts** under `frontend/scripts/`. All import from `@/lib/server/prisma` (or relative if `@/` doesn't resolve in tsx runs — researcher verifies).
- **Multi-stage Docker build** with standalone Next output. Runtime stage uses `tini` + non-root user. No changes likely needed; Phase 6 verifies.

### Integration Points
- **`scripts/smoke-auth.ts` ↔ deployed app:** the script must accept `SMOKE_BASE_URL` env override so it can target preview deployments (Phase 7 final-pass uses this).
- **`README.md` ↔ `STATUS.md`:** README is the public-facing entry; STATUS.md tracks the in-flight port. Distinct voices, distinct lifetimes — README points at STATUS.md briefly but doesn't duplicate it.
- **`CLAUDE.md` ↔ Phase 4/5 deliverables:** "Files Claude SHOULD modify" must include the routes that landed in Phases 4–5 so future fork forks don't accidentally treat them as off-limits.

</code_context>

<specifics>
## Specific Ideas

- **Auto-mode constraint:** Phase 6 was planned without a discuss-phase session. Decisions above are derived from REQUIREMENTS.md, ROADMAP.md, the live codebase pre-state, and Phase 4/5 patterns. Surface any meaningful disagreement in the plan-checker pass; otherwise treat them as locked.
- **Doc-rewrite voice:** match `STATUS.md` — terse, technical, no marketing language, no emojis, no "we built X with Y to delight users" copy.
- **Smoke test environment:** the test script must self-detect missing env (e.g., DATABASE_URL, JWT_SECRET) and print a friendly "you need to `cp .env.example .env.local && pnpm dev`" message before failing. This is operator-friendly, not test-suite output.
- **Phase 6 success = green button for Phase 7:** Phase 7 is a gate-only phase. Phase 6 should leave the repo in a state where `pnpm format && pnpm lint && pnpm typecheck && pnpm test` is the only path Phase 7 needs to validate.

</specifics>

<deferred>
## Deferred Ideas

- Playwright / Cypress E2E browser tests — out-of-scope per PROJECT.md "Frontend test framework" boundary (Vitest covers lib only).
- CI workflow files (`.github/workflows/*.yml`) — out-of-scope; Phase 7 may add minimal lint+test workflow if needed for the v1 tag.
- Bootstrap CLI / public OSS distribution — explicit non-goal per PROJECT.md.
- Auto-generated route inventory in README from AST scan — manual list is fine for v1; automation is a per-fork concern.
- API reference docs (e.g., OpenAPI / Swagger) — explicit non-goal; the route handlers are the contract.
- v2 features (PAY-01, ADMIN-01 follow-ups) — these are separate v1.x or v2 milestones, not Phase 6 scope.

</deferred>

---

*Phase: 06-tests-scripts-docker-docs*
*Context gathered: 2026-05-10 (auto-mode)*
