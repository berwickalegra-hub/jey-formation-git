# Phase 6: Validation Strategy

**Status:** authored 2026-05-10; mirrors `06-RESEARCH.md` § "Validation Architecture (Nyquist)"

The complete validation strategy lives in [06-RESEARCH.md](06-RESEARCH.md) under the "Validation Architecture (Nyquist)" heading. This file is a structured pointer for the Nyquist artifact gate.

## Test framework

Same as Phase 5 — Vitest at `frontend/vitest.config.ts` with `setupFiles: ['./vitest.setup.ts']` (TEST-01 already satisfied).

## Phase requirements → test map

| Req ID | Behavior verified | Test file |
|--------|-------------------|-----------|
| TEST-01 | `vitest.config.ts` exports `setupFiles` seeding `JWT_SECRET` + `ENCRYPTION_KEY` | already shipped — Phase 1 D-27 |
| TEST-02 | Each named lib has companion unit test | 7 NEW gap-fill tests (Wave 0) |
| TEST-03 | Auth happy-path smoke against `localhost:3000` exits 0 | `frontend/scripts/smoke-auth.ts` (NEW) |
| SCRIPT-01 | `make-superadmin.ts` + `seed-dev.ts` runnable via `tsx`, import from `@/lib/server/prisma` | existing `make-superadmin.test.ts` + NEW `seed-dev.test.ts` |
| DOCKER-01 | `docker build -f frontend/Dockerfile -t amadou-monolith .` succeeds; `/api/health` 200 from container | manual UAT recipe in 06-RESEARCH §"Docker Build Verification Recipe" |
| DOC-01 | `CLAUDE.md` has zero Express/`backend/src`/`express.json` references | `claude-md-shape.test.ts` (NEW grep tripwire) |
| DOC-02 | `README.md` has working quickstart + route inventory pointing at `frontend/src/app/api/` | `readme-shape.test.ts` (NEW grep tripwire) |
| ENV-01 | `CRON_SECRET` documented in `.env.example` | already shipped — Phase 0 OPS-04; covered by `env-shape.test.ts` |

## Sampling rate

- **Per task commit:** quick run on the affected test file
- **Per wave merge:** full Vitest suite (`pnpm test`)
- **Phase gate:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` all green
- **Manual UAT (deferred to Phase 7):** `pnpm smoke:auth` against a running `pnpm dev`; `docker build` + `docker run` + `/api/health` curl

## Coverage assertion

Every requirement ID in `phase_req_ids` (`TEST-01..03, SCRIPT-01, DOCKER-01, DOC-01, DOC-02, ENV-01`) has at least one row in the table above. Plan-checker enforces this by cross-referencing PLAN frontmatter `requirements` fields.

## Doc tripwire pattern

Phase 0 introduced `runtime-enforcement.test.ts` (CI guard for `runtime='nodejs'`); Phase 5 added `vercel-json-shape.test.ts`. Phase 6 follows the same pattern for `claude-md-shape.test.ts` and `readme-shape.test.ts` — read the doc, regex-assert no Express references, regex-assert quickstart command exists. This locks the doc audit as a CI guard, not a one-time fix.

---

*Phase: 06-tests-scripts-docker-docs*
*Validation strategy authored: 2026-05-10*
