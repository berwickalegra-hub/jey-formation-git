---
phase: "05"
plan: 08
subsystem: vercel-cron-config
tags: [cron, vercel, config, phase-05]
requires:
  - 05-01-scaffold-cron-webhook-fixtures-tests (Wave 0 vercel-json-shape.test.ts is the validation tripwire)
provides:
  - "frontend/vercel.json declaring 5 Phase 5 cron schedules (CRON-07)"
affects:
  - "Vercel deploy: Vercel reads vercel.json at build time and registers cron triggers for the 5 cron routes"
tech-stack:
  added: []
  patterns:
    - "Vercel Cron declarative config (UTC schedules, strict JSON, no maxDuration field)"
key-files:
  created:
    - frontend/vercel.json
  modified: []
decisions:
  - "Path: frontend/vercel.json (Vercel project root is the frontend/ workspace per pnpm-workspace setup) — D-12 verbatim"
  - "No maxDuration in vercel.json: per-route export const maxDuration = N in each route.ts (D-12 + RESEARCH §9)"
  - "Strict JSON only — no comments, no trailing commas (Vercel rejects malformed config at build time)"
metrics:
  duration: "~2 minutes"
  completed: 2026-05-08
  tasks_completed: 1
  files_created: 1
  files_modified: 0
requirements:
  - CRON-07
---

# Phase 05 Plan 08: vercel.json Summary

Shipped `frontend/vercel.json` with verbatim D-12 cron schema declaring all 5 Phase 5 cron schedules, turning the Wave 0 `vercel-json-shape.test.ts` shape assertions from RED to GREEN.

## What was built

A single 9-line strict-JSON file at `frontend/vercel.json` declaring the canonical Phase 5 cron schedule set:

| Path                              | Schedule        | Cadence                |
| --------------------------------- | --------------- | ---------------------- |
| `/api/cron/outbox-drain`          | `*/1 * * * *`   | every minute           |
| `/api/cron/email-queue-drain`     | `*/1 * * * *`   | every minute           |
| `/api/cron/verification-cleanup`  | `0 * * * *`     | hourly (top of hour)   |
| `/api/cron/order-expiration`      | `*/5 * * * *`   | every 5 minutes        |
| `/api/cron/webhook-log-purge`     | `0 0 * * *`     | daily at 00:00 UTC     |

All schedules are UTC (Vercel cron is UTC-only). The 5 paths and 5 schedules match CONTEXT.md D-12 byte-for-byte.

## Acceptance criteria — all GREEN

- File `frontend/vercel.json` exists (9 lines, 1 trailing newline)
- `node -e "JSON.parse(...)"` exits 0 (strict JSON, parses cleanly)
- `crons` array length = 5
- All 5 canonical paths present (each `grep -c` returns 1)
- 2 entries with `*/1 * * * *` (outbox-drain + email-queue-drain)
- 1 entry with `0 * * * *` (verification-cleanup)
- 1 entry with `*/5 * * * *` (order-expiration)
- 1 entry with `0 0 * * *` (webhook-log-purge)
- 0 `maxDuration` occurrences (per-route export only, never in vercel.json)

## Test status (worktree-isolated)

Per the plan's `<sibling_plans_note>`, this worktree contains ONLY `frontend/vercel.json` — neither the Wave 0 `vercel-json-shape.test.ts` (ships in 05-01's worktree) nor the 5 sibling cron `route.ts` files (ship in 05-03..05-07's worktrees) are present here. As a result:

- **Shape assertions** (file exists, `crons.length === 5`, path regex, schedule regex, canonical-path set): will go GREEN immediately at merge-back when 05-01's test file lands alongside this vercel.json.
- **"Every path corresponds to an existing route.ts" assertion**: GREEN only after all 5 sibling Wave 1 plans (05-03..05-07) have merged back. In any single-plan isolated worktree, this assertion is expected to be RED — by design, not a defect of this plan.

The orchestrator should run `pnpm --filter frontend exec vitest run src/lib/server/observability/vercel-json-shape.test.ts` after the full Wave 1 merge-back to confirm the test runs fully GREEN.

## Decisions Made

1. **Verbatim D-12 schema** — copied byte-for-byte from CONTEXT.md D-12. No deviations, no comments, no trailing commas, no extra fields. Vercel rejects non-strict JSON at build time.
2. **No `maxDuration` in vercel.json** — per D-12 + RESEARCH §9, per-route timeout lives in each `route.ts` via `export const maxDuration = N`. Duplicating it here would create a consistency hazard.
3. **File location: `frontend/vercel.json`** (NOT repo-root). The Vercel project root is the `frontend/` pnpm workspace (where `package.json` declares the Next.js app). Putting it at repo root would make Vercel ignore it.
4. **UTC-explicit schedules** — `0 0 * * *` deliberately fires at midnight UTC (not local time). Operators reading the file should not assume timezone-local interpretation.

## Deviations from Plan

None — plan executed exactly as written. Strict-JSON output verbatim from D-12.

## Threat coverage (from plan threat_model)

- **T-05-08-01 (malformed JSON breaks deploy)** — mitigated: file parses cleanly via `node -e "JSON.parse(...)"`; Wave 0 test parses + validates at CI time.
- **T-05-08-02 (secret values in vercel.json)** — accepted: file declares schedules + paths only; CRON_SECRET stays in Vercel project env vars, never committed.
- **T-05-08-03 (path that doesn't exist becomes a silently-skipped cron)** — mitigated by Wave 0 `vercel-json-shape.test.ts` "every path corresponds to an existing route.ts" assertion (CI catches typos at merge-back).
- **T-05-08-04 (misconfigured every-minute schedule overloads)** — accepted: `*/1 * * * *` schedules are deliberate per D-12; explicit + human-readable for PR review.

## Phase-level next step

After merge-back of all 7 Phase 5 Wave 1 plans:

1. Orchestrator runs `pnpm --filter frontend run build` to confirm Vercel accepts the file at deploy time (validates cron format).
2. Orchestrator runs `pnpm --filter frontend exec vitest run src/lib/server/observability/vercel-json-shape.test.ts` to confirm full-GREEN status (including "every path corresponds to an existing route.ts").
3. Phase 5 closeout — all 5 cron routes are then live on Vercel deploy.

## Self-Check: PASSED

- FOUND: `frontend/vercel.json` (9 lines, valid JSON, 5 crons)
- FOUND: commit `f01a2f0` (`feat(05-08): add vercel.json with 5 Phase 5 cron schedules`)
- All 13 acceptance-criteria grep/parse checks return expected counts
- 0 protected files modified
