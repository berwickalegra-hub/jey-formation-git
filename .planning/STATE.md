# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-07)

**Core value:** Cloning this repo and filling `.env` produces a working Next.js app on Vercel with the same security invariants and feature parity as `amadou-template` — auth, payments, admin, webhooks, crons all wired, headless and ready to graft a UI on top.
**Current focus:** Phase 0: Foundation

## Current Position

Phase: 0 of 8 (Phase 0: Foundation)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-05-07 — Roadmap created; 56 v1 requirements mapped to 8 phases (Phase 0–7)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Phase 0 prepended (per research SUMMARY.md recommendation) — Neon pooler URL + runtime=nodejs lint + Sentry onRequestError + CRON_SECRET + OTel + request ID must all land before any route handler runs
- Roadmap: M5 split into Phase 3 (admin/orgs/orders) and Phase 4 (upload/files/withdrawals) — 1,247 lines; financial-critical withdrawal work isolated from standard CRUD; PIN dependency (Phase 2 → Phase 4) enforced by ordering
- Roadmap: OBS-01/02/03 (admin observability endpoints) placed in Phase 3 alongside admin routes — they are admin endpoints; data may be empty until Phase 5 ships but the schema is already present
- Roadmap: OBS-04 (request ID) and OBS-05 (OTel) placed in Phase 0 — hardest to retrofit later; 15–20 LOC; every route benefits immediately
- Roadmap: Phase 7 is a gate-only phase (no new requirements) — lint/typecheck/test must all pass before v1 tag

### Pending Todos

None yet.

### Blockers/Concerns

- **Neon URL conflict resolved:** Use `-pooler` hostname with `?pgbouncer=true&connection_limit=1` (PITFALLS.md wins over STACK.md for serverless). Validate connection count on Neon dashboard at Phase 1 start.
- **M5-B upload > 4 MB:** If any fork needs > 4.5 MB uploads, presigned R2 PUT pattern must be researched before writing the upload route in Phase 4. Flag at plan time.
- **Cron batch sizing:** 100 rows/fire is the recommendation. If email-drain timeouts at 100, reduce to 50 and increase `maxDuration`. Validate in Phase 5.
- **Magic links deferred:** Research summary flagged magic links as a scope decision. Confirmed out of v1 scope (content + internal profiles can add per-project).

## Session Continuity

Last session: 2026-05-07
Stopped at: Roadmap created — ROADMAP.md written, STATE.md written, REQUIREMENTS.md traceability updated
Resume file: None
