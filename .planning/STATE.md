---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 5 context gathered
last_updated: "2026-05-08T22:20:02.555Z"
last_activity: 2026-05-08
progress:
  total_phases: 8
  completed_phases: 4
  total_plans: 21
  completed_plans: 25
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-07)

**Core value:** Cloning this repo and filling `.env` produces a working Next.js app on Vercel with the same security invariants and feature parity as `amadou-template` — auth, payments, admin, webhooks, crons all wired, headless and ready to graft a UI on top.
**Current focus:** Phase 04 — upload-files-withdrawals

## Current Position

Phase: 5
Plan: Not started
Status: Executing Phase 04
Last activity: 2026-05-08

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 20
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 0 | 5 | - | - |
| 02 | 4 | - | - |
| 03 | 7 | - | - |
| 04 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 00-foundation P01 | 3 | 3 tasks | 4 files |
| Phase 00-foundation P02 | 4min | 4 tasks tasks | 4 files files |
| Phase 00-foundation P03 | 2min | 3 tasks | 3 files |
| Phase 00-foundation P04 | 4min | 2 tasks | 2 files |
| Phase 00 P05 | 5min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Phase 0 prepended (per research SUMMARY.md recommendation) — Neon pooler URL + runtime=nodejs lint + Sentry onRequestError + CRON_SECRET + OTel + request ID must all land before any route handler runs
- Roadmap: M5 split into Phase 3 (admin/orgs/orders) and Phase 4 (upload/files/withdrawals) — 1,247 lines; financial-critical withdrawal work isolated from standard CRUD; PIN dependency (Phase 2 → Phase 4) enforced by ordering
- Roadmap: OBS-01/02/03 (admin observability endpoints) placed in Phase 3 alongside admin routes — they are admin endpoints; data may be empty until Phase 5 ships but the schema is already present
- Roadmap: OBS-04 (request ID) and OBS-05 (OTel) placed in Phase 0 — hardest to retrofit later; 15–20 LOC; every route benefits immediately
- Roadmap: Phase 7 is a gate-only phase (no new requirements) — lint/typecheck/test must all pass before v1 tag
- [Phase 00-foundation]: Plan 00-01: Added passWithNoTests:true to vitest.config.ts so Wave 0 ships a runnable Vitest config before Wave 1 plans write the first test files (zero-tests exit 0)
- [Phase 00-foundation]: Plan 00-01: @vercel/otel pulled its OTel SDK peer deps transitively; explicit @opentelemetry/* installs deferred (only add if Plan 03 dev-boot fails per RESEARCH.md Pitfall 5)
- [Phase 00-foundation]: Plan 00-02: Fixed broken Neon -pooler hostname regex in plan-supplied env-shape.test.ts (Rule 1 deviation) — single region segment, not two; aligned with plan key_links pattern
- [Phase 00-foundation]: Plan 00-02: Used import.meta.url + fileURLToPath for Vitest test path resolution so tests work under both ESM and CJS module systems
- [Phase 00-foundation]: Plan 00-03: Applied RESEARCH.md Example 1 verbatim — registerOTel call placed AFTER Sentry dynamic imports inside register() (Pitfall 6), onRequestError re-exported at top level for Next.js 15+ unhandled route-error capture, instrumentation.ts kept lean at 17 lines
- [Phase 00-foundation]: Adopted RESEARCH.md Pattern 3 verbatim for runtime-enforcement.test.ts (parametric fast-glob walk over app/api/**/route.ts); regex tolerant of single/double quotes per CONVENTIONS.md (no quote-style mandate)
- [Phase 00]: Phase 0 Plan 05 OBS-04: ALS-backed request-context module + thin log wrapper. Inbound X-Request-Id is validated against /^[0-9a-f-]{8,64}$/i (defense-in-depth log poisoning). Wrapper does NOT modify lib/server/logger.ts (D-13 wrap-not-modify). Vitest aliased 'server-only' → empty stub so server modules are unit-testable in plain Node.

### Pending Todos

None yet.

### Blockers/Concerns

- **Neon URL conflict resolved:** Use `-pooler` hostname with `?pgbouncer=true&connection_limit=1` (PITFALLS.md wins over STACK.md for serverless). Validate connection count on Neon dashboard at Phase 1 start.
- **M5-B upload > 4 MB:** If any fork needs > 4.5 MB uploads, presigned R2 PUT pattern must be researched before writing the upload route in Phase 4. Flag at plan time.
- **Cron batch sizing:** 100 rows/fire is the recommendation. If email-drain timeouts at 100, reduce to 50 and increase `maxDuration`. Validate in Phase 5.
- **Magic links deferred:** Research summary flagged magic links as a scope decision. Confirmed out of v1 scope (content + internal profiles can add per-project).

## Session Continuity

Last session: 2026-05-08T22:20:02.550Z
Stopped at: Phase 5 context gathered
Resume file: .planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md
