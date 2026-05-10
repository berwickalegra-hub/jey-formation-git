---
phase: "06"
plan: "03"
subsystem: docs
tags: [docs, readme, roadmap, doc-rewrite, doc-tripwire]
provides:
  - "README.md ships 7-section outline (post-Phase-5 state)"
  - "ROADMAP.md Phase 6 success criterion #4 docker command flag fix"
  - "readme-shape.test.ts tripwire RED -> GREEN (pnpm smoke:auth assertion)"
requires: ["06-01 readme-shape.test.ts shipped"]
affects: ["README.md", ".planning/ROADMAP.md"]
tech_stack:
  added: []
  patterns: ["doc-tripwire alignment via grep assertions"]
key_files:
  created: []
  modified:
    - README.md
    - .planning/ROADMAP.md
decisions:
  - "Match STATUS.md voice: terse, technical, no marketing, no emojis"
  - "Single 'Express' reference retained — historical negation context (no separate Express service); allowlisted by readme-shape.test.ts"
  - "Quickstart uses cp .env.example .env.local (matches existing tooling, NOT .env)"
  - "Route inventory points at frontend/src/app/api/ explicitly (40 routes grouped by area)"
  - "Deploy section links out to instrumentation.ts + vercel.json instead of duplicating contents"
  - "ROADMAP fix also corrects 'db' -> 'postgres' to match docker-compose.yml service name"
metrics:
  completed_date: "2026-05-10"
  commit: c1b7949
---

# Phase 6 Plan 03: README Rewrite + ROADMAP Fix Summary

Replaced the stale Phase-1-era README with a current-state 7-section README that mirrors STATUS.md's voice and points at the post-Phase-5 surface; one-line ROADMAP fix corrects the docker build invocation to use `-f frontend/Dockerfile`.

## Files Modified

| File | Before | After | Delta |
|------|--------|-------|-------|
| README.md | 466 lines (Phase-1 status banner, Prisma 7 ref, target-shape route table) | 227 lines (post-Phase-5 7-section outline) | -239 lines (rewrite) |
| .planning/ROADMAP.md | line 123 `docker build -t amadou-monolith .` + `db` service | line 123 `docker build -f frontend/Dockerfile -t amadou-monolith .` + `postgres` | 1 line edit |

## Quickstart Command Sequence (verbatim from new README §Quickstart)

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

## Section Structure (7 sections + supplementary)

1. ① Intro — "What this is" (3-sentence headless-starter description)
2. ② Quickstart — 9-line command sequence
3. (supplementary) Stack
4. ③ Required env vars (boot) + optional groups inert-behavior table
5. ④ Route Inventory — 40 routes grouped by area
6. ⑤ Smoke test — `pnpm smoke:auth` pointer + `SMOKE_BASE_URL` override
7. ⑥ Deploy to Vercel — links to `frontend/vercel.json` + `frontend/instrumentation.ts`
8. (supplementary) Project layout
9. ⑦ What's NOT shipped — 10-row out-of-scope table from PROJECT.md
10. (supplementary) Critical invariants — 9-bullet short list
11. License

## Route Inventory Totals (new §Route Inventory)

40 routes total under `frontend/src/app/api/`:

| Area | Routes |
|------|-------:|
| Auth (`/api/auth/*`) | 10 |
| OAuth | 2 |
| Notifications | 3 |
| Orders + Withdrawals | 2 |
| Uploads + Files | 2 |
| Webhooks | 1 |
| Cron handlers | 5 |
| Admin (`/api/admin/*`) | 12 |
| Withdrawal-PIN (subset of Auth) | included in 10 |
| Health | 2 |
| **Total** | **40** (includes nested admin paths counted as 12 per RESEARCH §④) |

Verified count via `find frontend/src/app/api -name route.ts | wc -l` → 40.

## ROADMAP Edit

**OLD (line 123):**
```
  4. `docker build -t amadou-monolith .` succeeds; `docker compose up -d` starts `db` + `redis` + `mailpit` + `minio` (no `backend` service); `docker run` of the built image serves `/api/health` returning 200
```

**NEW (line 123):**
```
  4. `docker build -f frontend/Dockerfile -t amadou-monolith .` succeeds; `docker compose up -d` starts `postgres` + `redis` + `mailpit` + `minio` (no `backend` service); `docker run` of the built image serves `/api/health` returning 200
```

Two changes: (a) added `-f frontend/Dockerfile` flag (Dockerfile is not at repo root); (b) `db` → `postgres` matching the actual docker-compose.yml service name.

## Acceptance Criteria Results (19 total)

| # | Check | Result |
|---|-------|--------|
| 1 | `wc -l README.md` >= 200 | PASS (227 lines) |
| 2 | `grep -q "cp \.env\.example \.env\.local" README.md` | PASS |
| 3 | `grep -q "pnpm install" README.md` | PASS |
| 4 | `grep -q "pnpm dev" README.md` | PASS |
| 5 | `grep -q "docker compose up" README.md` | PASS |
| 6 | `grep -q "pnpm smoke:auth" README.md` | PASS |
| 7 | `grep -q "CRON_SECRET" README.md` | PASS |
| 8 | `grep -q "frontend/src/app/api" README.md` | PASS |
| 9 | `grep -q "vercel.json" README.md` | PASS |
| 10 | `grep -q "instrumentation.ts" README.md` | PASS |
| 11 | `grep -qE "Out of scope\|NOT shipped" README.md` | PASS (`What's NOT shipped`) |
| 12 | `! grep -qE "backend/src" README.md` | PASS (zero hits) |
| 13 | `! grep -qE "express\.json\(" README.md` | PASS (zero hits) |
| 14 | Express word count <= 1 | PASS (1 negation hit) |
| 15 | `grep -q "docker build -f frontend/Dockerfile -t amadou-monolith" .planning/ROADMAP.md` | PASS |
| 16 | `! grep -q "docker build -t amadou-monolith \." .planning/ROADMAP.md` | PASS |
| 17 | `grep -q "Prisma 5" README.md` | PASS (NOT "Prisma 7") |
| 18 | `grep -q "Critical invariants" README.md` | PASS |
| 19 | readme-shape.test.ts assertions verified manually | PASS (see below) |

## readme-shape.test.ts Status

The 6 assertions in `frontend/src/lib/server/observability/readme-shape.test.ts` are verified manually (worktree has no `node_modules` — `pnpm install` was not run in this parallel worktree; the test will execute on merge-back when `pnpm install` is wired in CI):

1. PASS — README exists at repo root
2. PASS — quickstart sequence matches `cp .env.example .env(.local)?`, `pnpm install`, `pnpm dev`, `docker compose up`
3. PASS — `frontend/src/app/api/` referenced
4. PASS — `CRON_SECRET` referenced
5. PASS — single `Express` reference at L26 ("no separate Express service") matches allowlist regex `(no separate Express|...)`
6. PASS — `pnpm smoke:auth` mentioned (formerly RED — now GREEN)

All 6 assertions confirmed via direct grep against the rewritten README.

## Voice/Style Audit

- **Emojis:** 0 (verified via visual review)
- **Marketing copy:** 0 hits for "delight", "world-class", "blazing", "best-in-class", "industry-leading", "seamless"
- **First-person plural:** 0 hits for "we built", "we chose", "we ship"
- **Inline backticks for files/commands:** consistent throughout
- **Tables for env-vars + routes + scope-boundaries:** yes (matches STATUS.md tone)

## Deviations from Plan

None — plan executed exactly as written. The one allowance (Express word count <= 1) was anticipated by the plan author and matches the readme-shape.test.ts allowlist verbatim.

## Self-Check: PASSED

- [x] README.md modified — verified `git log --oneline -1 README.md` shows commit c1b7949
- [x] .planning/ROADMAP.md modified — verified same commit touches both files
- [x] commit c1b7949 exists — verified via `git rev-parse --short HEAD`
- [x] All 19 acceptance criteria PASS
- [x] readme-shape.test.ts assertions verified manually (6/6 PASS)
- [x] No protected file modified (only README.md + .planning/ROADMAP.md)
