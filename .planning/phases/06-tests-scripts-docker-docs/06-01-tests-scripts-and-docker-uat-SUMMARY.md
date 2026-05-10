---
phase: "06"
plan: 01
subsystem: tests-scripts-docker-docs
tags: [test, smoke, doc-tripwire, docker]
requires:
  - frontend/vitest.config.ts (TEST-01 — already shipped)
  - frontend/.env.example → repo-root .env.example (ENV-01 — already shipped)
  - frontend/Dockerfile (DOCKER-01 — already shipped)
  - frontend/scripts/make-superadmin.{ts,test.ts} (SCRIPT-01 reference pattern)
provides:
  - 7 TEST-02 gap-fill unit tests under frontend/src/lib/server/**
  - 2 doc tripwires under frontend/src/lib/server/observability/
  - frontend/scripts/smoke-auth.ts + pnpm smoke:auth (TEST-03)
  - frontend/scripts/seed-dev.ts refactored (export main + CLI guard) + companion seed-dev.test.ts (SCRIPT-01)
affects: []
tech-stack:
  added: []  # zero new deps — vitest 2.1.8, vitest-mock-extended 2.0.2, tsx 4.19.2, prisma 5.22 already pinned
  patterns:
    - mockDeep<PrismaClient>() for prisma-using libs (audit, dispatcher, createNotification, seed-dev)
    - vi.useFakeTimers + vi.setSystemTime for circuit-breaker state-machine cooldown transitions
    - vi.stubEnv-equivalent (process.env mutation in beforeEach/afterEach) for oauth/google env-guard
    - import.meta.url + fileURLToPath for portable doc-tripwire path resolution (5 levels up to repo root)
    - export main(args, deps?) + CLI guard `if (import.meta.url === ...)` mirroring make-superadmin.ts:85-92
key-files:
  created:
    - frontend/src/lib/server/crypto.test.ts
    - frontend/src/lib/server/withdrawals/lock.test.ts
    - frontend/src/lib/server/outbox/dispatcher.test.ts
    - frontend/src/lib/server/oauth/google.test.ts
    - frontend/src/lib/server/notifications/createNotification.test.ts
    - frontend/src/lib/server/admin/audit.test.ts
    - frontend/src/lib/server/payments/circuit-breaker.test.ts
    - frontend/src/lib/server/observability/claude-md-shape.test.ts
    - frontend/src/lib/server/observability/readme-shape.test.ts
    - frontend/scripts/smoke-auth.ts
    - frontend/scripts/seed-dev.test.ts
  modified:
    - frontend/scripts/seed-dev.ts (refactored — export main + CLI guard)
    - frontend/package.json (added smoke:auth script)
    - package.json (added root-proxy smoke:auth script)
decisions:
  - Used generateKey() in crypto.test.ts rather than the seeded ENCRYPTION_KEY fixture (the fixture decodes to 33 bytes, not 32 — see Deviations §1)
  - readme-shape.test.ts splits assertions into two describe blocks: current-state (5 GREEN today) and post-Wave-2 target (1 RED-by-design until plan 06-03 ships)
  - Docker UAT (T-05) deferred — docker not installed on this host; recipe is documented for Phase 7 final-pass UAT
metrics:
  duration: "7m 26s"
  task_count: 5
  task_completed: 4  # T-05 deferred per docker_uat_handling
  test_files_added: 10
  test_cases_added: 35 + 4 + 12 = 51 (7 lib + seed-dev + 2 doc tripwires)
  full_suite: "558 passed / 1 RED-by-design (readme-shape post-Wave-2 assertion)"
  completed_date: "2026-05-10"
---

# Phase 6 Plan 01: Tests, Scripts, and Docker UAT — Summary

**One-liner:** Shipped 7 TEST-02 gap-fill unit tests for PROTECTED libs (35 cases GREEN), 2 doc tripwires (DOC-01 + DOC-02 lock-in), the smoke-auth.ts script wired as `pnpm smoke:auth` at both root and frontend, and the seed-dev.ts refactor + companion test (SCRIPT-01) — all without modifying any of the 7 PROTECTED source libs. Docker UAT (T-05) deferred to Phase 7 HUMAN-UAT because docker is not installed on this host; recipe is preserved verbatim below for the operator.

## Status by Task

| Task | Name | Status | Notes |
|------|------|--------|-------|
| T-01 | 7 TEST-02 gap-fill unit tests | **complete** | All 35 cases GREEN; commit `4a490e9` |
| T-02 | smoke-auth.ts + pnpm wire-up + seed-dev.test.ts | **complete** | Wired in both package.json files; commit `47b7d4a` |
| T-03 | seed-dev.ts refactor (folded into T-02 commit) | **complete** | Exports `main(args, deps?)` + CLI guard; 4/4 cases GREEN |
| T-04 | claude-md-shape + readme-shape doc tripwires | **complete** | claude-md-shape: 6/6 GREEN; readme-shape: 5/6 GREEN + 1 RED-by-design until Wave 2; commit `010a726` |
| T-05 | Docker UAT — `docker build` + `/api/health` probe | **deferred** | docker not installed on host; recipe documented below for Phase 7 |

## Files Created (11) / Modified (3)

### Created (NEW)

7 TEST-02 gap-fill unit tests under `frontend/src/lib/server/**`:

- `frontend/src/lib/server/crypto.test.ts` (4 cases) — round-trip + 3-segment shape + reject malformed + reject rotated key
- `frontend/src/lib/server/withdrawals/lock.test.ts` (3 cases) — `pg_advisory_xact_lock(hashtext($1))` SQL emission + verbatim userId binding + error propagation
- `frontend/src/lib/server/outbox/dispatcher.test.ts` (6 cases) — claim contract + SENT path + PENDING-with-backoff path + DEAD ceiling + race-skip + empty-candidates short-circuit
- `frontend/src/lib/server/oauth/google.test.ts` (7 cases) — env-guard for each of 3 GOOGLE_* vars + happy-path handle shape + decodeIdToken claims extraction (incl. `email_verified=false` faithful return) + malformed-token rejection
- `frontend/src/lib/server/notifications/createNotification.test.ts` (4 cases) — happy create + P2002→null + non-P2002 rethrow + optional `data` payload forwarding
- `frontend/src/lib/server/admin/audit.test.ts` (3 cases) — full-fields write + null defaults + tx-shaped client acceptance
- `frontend/src/lib/server/payments/circuit-breaker.test.ts` (8 cases) — full state machine via fake timers (CLOSED→OPEN→HALF_OPEN→CLOSED + HALF_OPEN→OPEN re-trip + reset() + retryAt())

2 doc tripwires under `frontend/src/lib/server/observability/`:

- `frontend/src/lib/server/observability/claude-md-shape.test.ts` (6 cases, **all GREEN today**) — exists + zero errant Express + zero backend/src + zero express.json() + zero middleware-order + Phase-4–5 surface mentions
- `frontend/src/lib/server/observability/readme-shape.test.ts` (6 cases, **5 GREEN + 1 RED-by-design**) — exists + quickstart sequence + route-inventory pointer + CRON_SECRET mention + Express negation tolerance + (post-Wave-2) `pnpm smoke:auth` mention

Smoke + script test:

- `frontend/scripts/smoke-auth.ts` (162 LOC) — TEST-03 manual UAT script
- `frontend/scripts/seed-dev.test.ts` (4 cases, GREEN) — SCRIPT-01 companion test

### Modified

- `frontend/scripts/seed-dev.ts` — refactored to export `main(args, deps?)` and use the CLI guard pattern from `make-superadmin.ts:85-92`. The shape change is minimal (move `new PrismaClient()` into `deps.prisma ?? new ...` and replace top-level `await main()` with `if (import.meta.url === ...)`).
- `frontend/package.json` — added `"smoke:auth": "tsx --env-file=.env.local scripts/smoke-auth.ts"`
- `package.json` (repo root) — added `"smoke:auth": "pnpm --filter frontend run smoke:auth"` (orchestrator proxy mirroring the existing `pnpm dev`/`pnpm test` pattern)

## Test Suite Status

```
Test Files  1 failed | 65 passed (66)
     Tests  1 failed | 558 passed (559)
```

The single failure is **expected** per the doc_tripwire_caveat in the executor prompt: `readme-shape.test.ts > post-Wave-2 target shape > mentions pnpm smoke:auth`. This assertion locks in the README rewrite gate that plan 06-03 will satisfy. After 06-03 merge-back the suite goes fully GREEN.

Pre-Phase-6 baseline (per RESEARCH.md): 508 GREEN. After this plan: 558 GREEN (+50 cases across 10 new test files — 7 lib + seed-dev + 2 doc tripwires).

Confirmation: zero modifications to any of the 7 PROTECTED libs (`crypto.ts`, `withdrawals/lock.ts`, `outbox/dispatcher.ts`, `oauth/google.ts`, `notifications/index.ts`, `admin/audit.ts`, `payments/circuit-breaker.ts`):

```
$ git diff --stat <PROTECTED-libs>
(empty)
```

## Cross-references (no work) — TEST-01 + ENV-01

These requirements were already satisfied by Phase 0 OPS-04 + Phase 1 D-27 deliverables. Confirmed in this worktree:

**TEST-01 evidence:**

```
frontend/vitest.config.ts:19    setupFiles: ['./vitest.setup.ts'],
frontend/vitest.setup.ts:13     process.env.JWT_SECRET ||= 'vitest-fixture-jwt-secret-with-enough-entropy-for-tests';
frontend/vitest.setup.ts:14     process.env.ENCRYPTION_KEY ||= 'aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n';
```

**ENV-01 evidence (note: `.env.example` lives at REPO ROOT, not under `frontend/`):**

```
.env.example:16                                       # Vercel Cron auth shared secret. Generate with: openssl rand -base64 32
.env.example:18                                       CRON_SECRET=""
frontend/src/lib/server/observability/env-shape.test.ts:41   it('declares CRON_SECRET with empty default + openssl hint', () => {
frontend/src/lib/server/observability/env-shape.test.ts:42     expect(src).toMatch(/^CRON_SECRET=""/m);
```

`git diff --stat frontend/vitest.config.ts frontend/vitest.setup.ts .env.example` returns empty — zero modifications.

## Deviations from Plan

### 1. [Rule 1 — Bug] crypto.test.ts uses generateKey() rather than the seeded ENCRYPTION_KEY fixture

**Found during:** T-01 first run.

**Issue:** The seeded `ENCRYPTION_KEY` in `frontend/vitest.setup.ts:14` is the placeholder `aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n`, which decodes to 33 bytes — `crypto.ts` requires exactly 32. The 3 round-trip tests failed with `Encryption key must decode to 32 bytes (got 33)`.

**Fix:** Replaced `const TEST_KEY = process.env.ENCRYPTION_KEY!` with `const TEST_KEY = generateKey()` — uses the lib's own `generateKey()` helper to produce a real 32-byte base64 key per test run. This is a more honest test (it doesn't rely on the fixture being well-formed) and removes coupling to the setup file.

**Files modified:** `frontend/src/lib/server/crypto.test.ts` only.

**Commit:** `4a490e9` (final state).

**Note for future:** If a follow-up plan wants to make `vitest.setup.ts` fixture a true 32-byte base64 (so it can decrypt real test fixtures), the change is `process.env.ENCRYPTION_KEY ||= '/* exact 32 byte base64 */'`. This was NOT done here — `vitest.setup.ts` is on the "Files Claude must NOT modify" list anyway, and the workaround is cleaner.

### 2. T-04 in PLAN.md (cross-reference verification) folded into this SUMMARY

The plan listed 5 tasks but T-04 was a "no-modification cross-reference" task that produces only documentation. Per the docker_uat_handling override, T-05 (Docker UAT) is deferred. So actual atomic commits are:

- T-01 → commit `4a490e9`
- T-02 + T-03 (seed-dev test depends on seed-dev.ts refactor — atomic) → commit `47b7d4a`
- T-04 (doc tripwires per the prompt's task list) → commit `010a726`
- T-04 (PLAN.md's cross-reference task) → recorded above as "Cross-references (no work)"
- T-05 → deferred (see HUMAN-UAT section below)

This matches the prompt's `<objective>` task list (5 tasks: T-01 lib tests, T-02 smoke + seed-dev test, T-03 seed-dev refactor, T-04 doc tripwires, T-05 Docker UAT). The PLAN.md numbering is slightly different (the cross-reference task vs. the doc tripwires task) but the atoms ship are identical.

### 3. seed-dev.test.ts has 4 cases (the 3 from research + 1 extra)

PLAN.md called for 3 seed-dev test cases. I shipped 4 — the extra case (`marks the unverified seed user with emailVerifiedAt=null`) covers the `skipVerify: true` branch which is half the seed data's surface. Pure additive — no risk.

## Authentication Gates

None encountered.

## Docker UAT (T-05) — DEFERRED to Phase 7 HUMAN-UAT

**Reason:** `which docker` returns "not found" on this host. Per `docker_uat_handling` in the executor prompt, the plan's Docker recipe is preserved as documentation for the operator to run when they have a Docker environment.

**Verified state (no `docker build` run):**

- `frontend/Dockerfile` exists (Phase 5 D-PRE-03 ships it; multi-stage Node 20 with `tini` + non-root `app` user)
- `docker-compose.yml` exists with 4 services (`postgres`, `redis`, `minio`, `mailpit`) — **NO `backend` service** ✓
- `.dockerignore` exists at repo root (Pitfall 2 from RESEARCH already addressed)

**HUMAN-UAT Recipe** — operator runs at repo root when they have docker installed:

```bash
# 1. Build the image (build context is REPO ROOT — Dockerfile copies pnpm-workspace.yaml + frontend/)
docker build -f frontend/Dockerfile -t amadou-monolith .
# Expected: "Successfully tagged amadou-monolith:latest" exit 0
# Capture: build duration, image size from `docker images amadou-monolith`

# 2. Boot infra (Postgres + Redis only — minio + mailpit are optional for /api/health probe)
docker compose up -d postgres redis
# Wait until `docker compose ps` shows both healthy

# 3. Apply schema host-side (db:push is faster than running migrations from inside the container)
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amadou_dev' pnpm db:push
# Expected: Prisma reports schema in sync; exit 0

# 4. Run the built image (macOS/Windows — host.docker.internal is auto-resolved)
docker run --rm -d --name amadou-smoke -p 3000:3000 \
  -e DATABASE_URL='postgresql://postgres:postgres@host.docker.internal:5432/amadou_dev' \
  -e JWT_SECRET='vitest-fixture-jwt-secret-with-enough-entropy-for-tests' \
  -e ENCRYPTION_KEY='aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n' \
  amadou-monolith
# (On Linux: replace host.docker.internal with --add-host=host.docker.internal:host-gateway
#  or use the docker-compose network's `postgres` hostname.)

# 5. Probe /api/health
curl -fsS http://localhost:3000/api/health
# Expected: {"ok":true,"time":"2026-..."} 200

# 6. Cleanup
docker stop amadou-smoke
docker compose down

# 7. Sanity check — confirm 4 services + minio-init, no backend
docker compose config --services
# Expected: postgres / redis / minio / mailpit / minio-init (5 entries; NO backend)
```

**What to record in the operator's UAT log:**

- `docker build` exit code, duration, `docker images amadou-monolith` size
- `docker run` container ID + any logs from `docker logs amadou-smoke`
- `/api/health` response body verbatim
- `docker compose config --services` list (must NOT contain "backend")

If `docker build` fails, the failure is a Phase 5 regression (Dockerfile worked at the end of Phase 5); plan 06-01 itself does NOT modify the Dockerfile.

## Threat Flags

None — this plan ships ZERO new domain logic. All test/script/doc artifacts inherit the security stance of Phases 0–5. The smoke script's surface (timestamped `.test`-TLD email + `finally{}` cleanup) is documented in the plan threat model T-06-01-01 (accepted) and T-06-01-04 (accepted — dev-only DB peek). Both stances are unchanged.

## v1.x Followups (deferred per RESEARCH.md §"TEST-02 Coverage Audit")

- `frontend/src/lib/server/auth.test.ts` — direct cookie-issuance + verifyCsrf happy-path. Adjacent coverage in `auth/{dummy-bcrypt,lockout,refresh-lock,pin,email-templates,hibp,banned-passwords}.test.ts` is substantial; deferred for v1.x or Phase 7 polish.
- `frontend/src/lib/server/webhook/handler.test.ts` — direct Serializable-tx + raw-body invariants. `webhook/bictorys.test.ts` covers the integration; deferred for v1.x.

## Self-Check: PASSED

**Created files exist:**

- `frontend/src/lib/server/crypto.test.ts` — FOUND
- `frontend/src/lib/server/withdrawals/lock.test.ts` — FOUND
- `frontend/src/lib/server/outbox/dispatcher.test.ts` — FOUND
- `frontend/src/lib/server/oauth/google.test.ts` — FOUND
- `frontend/src/lib/server/notifications/createNotification.test.ts` — FOUND
- `frontend/src/lib/server/admin/audit.test.ts` — FOUND
- `frontend/src/lib/server/payments/circuit-breaker.test.ts` — FOUND
- `frontend/src/lib/server/observability/claude-md-shape.test.ts` — FOUND
- `frontend/src/lib/server/observability/readme-shape.test.ts` — FOUND
- `frontend/scripts/smoke-auth.ts` — FOUND
- `frontend/scripts/seed-dev.test.ts` — FOUND

**Modified files exist (refactored / edited):**

- `frontend/scripts/seed-dev.ts` — FOUND (refactored)
- `frontend/package.json` — FOUND (smoke:auth added)
- `package.json` — FOUND (smoke:auth proxy added)

**Commits exist:**

- `4a490e9` — FOUND (`test(06-01): add 7 TEST-02 gap-fill unit tests for PROTECTED libs`)
- `47b7d4a` — FOUND (`feat(06-01): smoke-auth.ts + seed-dev refactor + companion test + pnpm wire-up`)
- `010a726` — FOUND (`test(06-01): add CLAUDE.md + README.md doc tripwires (DOC-01 + DOC-02)`)

**No PROTECTED file modified:** Confirmed via `git diff --stat` returning empty for all 7 PROTECTED libs.

---

*Plan: 06-01-tests-scripts-and-docker-uat*
*Phase: 06-tests-scripts-docker-docs*
*Completed: 2026-05-10*
