---
id: 05-08-vercel-json
phase: "05"
plan: 08
type: execute
wave: 1
depends_on:
  - 05-01-scaffold-cron-webhook-fixtures-tests
files_modified:
  - frontend/vercel.json
autonomous: true
task_count: 1
requirements:
  - CRON-07
must_haves:
  truths:
    - "frontend/vercel.json declares exactly 5 cron schedules"
    - "Each cron path matches /^\\/api\\/cron\\/[a-z-]+$/ and is one of the 5 canonical Phase 5 routes"
    - "Each schedule is a valid 5-field UTC cron expression"
    - "Schedules match D-12 verbatim: outbox-drain + email-queue-drain every 1m, verification-cleanup hourly, order-expiration every 5m, webhook-log-purge daily at midnight UTC"
    - "vercel-json-shape.test.ts (Wave 0) goes from RED to GREEN with this file"
  artifacts:
    - path: "frontend/vercel.json"
      provides: "Vercel Cron schedule declaration for all 5 Phase 5 cron routes"
      min_lines: 9
  key_links:
    - from: "frontend/vercel.json"
      to: "frontend/src/app/api/cron/{outbox-drain,email-queue-drain,verification-cleanup,order-expiration,webhook-log-purge}/route.ts"
      via: "each `path` field corresponds to an existing route.ts"
      pattern: "/api/cron/"
    - from: "frontend/vercel.json"
      to: "frontend/src/lib/server/observability/vercel-json-shape.test.ts"
      via: "static-shape assertions: 5 entries, valid path regex, valid cron-format schedule"
      pattern: "crons"
---

<objective>
Ship `frontend/vercel.json` declaring Vercel Cron schedules for all 5 Phase 5 cron routes. Implements CRON-07.

Purpose: Vercel reads `vercel.json` at deploy time and registers cron triggers. Without this file, the 5 cron routes (Wave 1 plans 05-03..05-07) exist but Vercel never invokes them. Per D-12, the file lives at `frontend/vercel.json` (the Vercel project root is the `frontend/` workspace).

Output: One JSON file declaring 5 cron schedules verbatim from D-12. Wave 0's `vercel-json-shape.test.ts` goes from RED to GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md
@.planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md
@CLAUDE.md

@frontend/src/lib/server/observability/vercel-json-shape.test.ts

<interfaces>
From .planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md D-12 (verbatim):
```json
{
  "crons": [
    { "path": "/api/cron/outbox-drain",         "schedule": "*/1 * * * *" },
    { "path": "/api/cron/email-queue-drain",    "schedule": "*/1 * * * *" },
    { "path": "/api/cron/verification-cleanup", "schedule": "0 * * * *"   },
    { "path": "/api/cron/order-expiration",     "schedule": "*/5 * * * *" },
    { "path": "/api/cron/webhook-log-purge",    "schedule": "0 0 * * *"   }
  ]
}
```

The Wave 0 vercel-json-shape.test.ts asserts:
- File exists
- `crons` is an array of length 5
- Each `path` matches `/^\/api\/cron\/[a-z][a-z0-9-]*$/`
- Each `schedule` matches `/^[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+$/`
- Every path corresponds to an existing `app/api/cron/<name>/route.ts` (fast-glob walk)
- The 5 paths sort to the canonical Phase 5 set
</interfaces>

<reference_patterns>
- **D-12 schema:** verbatim — do NOT add comments, trailing commas, or extra fields (vercel.json is strict JSON)
- **maxDuration NOT in vercel.json:** per D-12 + RESEARCH §9, `maxDuration` lives in each `route.ts` via `export const maxDuration = N`. Putting it here too is redundant.
- **UTC schedules:** Vercel cron is UTC-only — `0 0 * * *` fires at midnight UTC, not local time
</reference_patterns>
</context>

<sibling_plans_note>
The Wave 0 `vercel-json-shape.test.ts` was authored in plan 05-01's worktree as RED-by-design — its file-existence assertion fails because `frontend/vercel.json` does not yet exist. This plan is what turns that test GREEN. Sibling Wave 1 plans (05-02..05-07) ship cron route files at `app/api/cron/{outbox-drain,email-queue-drain,verification-cleanup,order-expiration,webhook-log-purge}/route.ts` — all 5 must exist after merge-back for the "every cron path corresponds to an existing route.ts" assertion to pass.

**IMPORTANT:** This plan's `pnpm vitest run vercel-json-shape.test.ts` will pass the file-existence + JSON-shape assertions immediately (after this plan ships vercel.json), but the "path corresponds to actual route.ts" assertion requires all 5 sibling Wave 1 plans to have shipped their route files. After merge-back of all 7 Wave 1 plans, the test runs fully GREEN.
</sibling_plans_note>

<tasks>

<task type="auto">
  <name>Task 1: Create frontend/vercel.json with 5 cron schedules</name>
  <files>
    - frontend/vercel.json (NEW)
  </files>
  <read_first>
    - .planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md D-12 (verbatim JSON)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §9 "vercel.json Schema"
    - frontend/src/lib/server/observability/vercel-json-shape.test.ts (the validation tripwire — every assertion must pass)
  </read_first>
  <action>
Create `frontend/vercel.json` — verbatim from D-12. Strict JSON (no comments, no trailing commas):

```json
{
  "crons": [
    { "path": "/api/cron/outbox-drain", "schedule": "*/1 * * * *" },
    { "path": "/api/cron/email-queue-drain", "schedule": "*/1 * * * *" },
    { "path": "/api/cron/verification-cleanup", "schedule": "0 * * * *" },
    { "path": "/api/cron/order-expiration", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/webhook-log-purge", "schedule": "0 0 * * *" }
  ]
}
```

**Critical:**
- File path is `frontend/vercel.json` (NOT repo-root `vercel.json` — Vercel project root is the `frontend/` workspace per the existing pnpm-workspace setup).
- Strict JSON only — no `//` comments, no trailing commas. Vercel rejects malformed JSON at build time.
- Do NOT add `maxDuration` per route here — those live in each `route.ts` via `export const maxDuration = N` (D-12 + RESEARCH §9).
- Do NOT add additional cron paths — exactly 5, matching the Phase 5 routes. Forks add their own crons by extending this file.
- Schedules are UTC. `0 * * * *` fires at the top of every UTC hour. `0 0 * * *` fires at midnight UTC.
- Cron format: `minute hour day-of-month month day-of-week`. `*/5 * * * *` = every 5 minutes; `*/1 * * * *` = every minute.

After writing, verify with `node -e "console.log(JSON.parse(require('fs').readFileSync('frontend/vercel.json','utf8')).crons.length)"` — should print `5`.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/lib/server/observability/vercel-json-shape.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/vercel.json` exists
    - File parses as valid JSON: `node -e "JSON.parse(require('fs').readFileSync('frontend/vercel.json','utf8'))"` exits 0
    - `grep -c '"crons":' frontend/vercel.json` returns 1
    - `grep -c '/api/cron/outbox-drain' frontend/vercel.json` returns 1
    - `grep -c '/api/cron/email-queue-drain' frontend/vercel.json` returns 1
    - `grep -c '/api/cron/verification-cleanup' frontend/vercel.json` returns 1
    - `grep -c '/api/cron/order-expiration' frontend/vercel.json` returns 1
    - `grep -c '/api/cron/webhook-log-purge' frontend/vercel.json` returns 1
    - `grep -c '"\\*/1 \\* \\* \\* \\*"' frontend/vercel.json` returns 2 (outbox-drain + email-queue-drain)
    - `grep -c '"0 \\* \\* \\* \\*"' frontend/vercel.json` returns 1 (verification-cleanup hourly)
    - `grep -c '"\\*/5 \\* \\* \\* \\*"' frontend/vercel.json` returns 1 (order-expiration)
    - `grep -c '"0 0 \\* \\* \\*"' frontend/vercel.json` returns 1 (webhook-log-purge daily)
    - `grep -c "maxDuration" frontend/vercel.json` returns 0 (per-route export; not duplicated here)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/vercel-json-shape.test.ts` exits 0 — at minimum the "exists", "5 entries", "schedule regex", and "canonical paths" assertions pass. The "every path corresponds to an existing route.ts" assertion passes only if all 5 sibling Wave 1 cron route files have been merged back. If running in this plan's isolated worktree before merge-back, that single assertion may still fail — record this in the SUMMARY.md.
  </acceptance_criteria>
  <done>frontend/vercel.json shipped with 5 verbatim D-12 cron entries; vercel-json-shape.test.ts shape assertions GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer→repo | vercel.json is checked into git; no secrets — declarative config only |
| Vercel→cron | The schedules trigger HTTP POSTs that go through `verifyCronSecret` (separate plan 05-01) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-08-01 | T (Tampering) | malformed JSON breaks deploy | mitigate | `vercel-json-shape.test.ts` parses + validates at CI time; `next build` rejects malformed config. |
| T-05-08-02 | I (Information disclosure) | secret values in vercel.json | accept | The file declares schedules + paths only. CRON_SECRET lives in env vars (Vercel project settings), never in vercel.json. |
| T-05-08-03 | E (Elevation of privilege) | adding a path that doesn't exist creates an invalid cron Vercel silently skips | mitigate | The "every path corresponds to an existing route.ts" assertion in vercel-json-shape.test.ts catches typos at CI time. |
| T-05-08-04 | D (DoS) | misconfigured `* * * * *` (every minute, not every hour) overloads cron capacity | accept | Operator review at PR time; schedules are explicit and human-readable. The `*/1 * * * *` schedules are deliberate per D-12. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/lib/server/observability/vercel-json-shape.test.ts` exits 0 (after all sibling plans merged back; isolated-worktree run may fail the "route.ts exists" assertion)
- `node -e "JSON.parse(require('fs').readFileSync('frontend/vercel.json','utf8'))"` exits 0
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0 (no TS impact — JSON file)
- `pnpm --filter frontend run build` accepts the file (verifies Vercel-style cron format)
- No protected file modified
</verification>

<success_criteria>
- frontend/vercel.json shipped with verbatim D-12 schema
- 5 cron entries, each path matching an existing Wave 1 route after merge-back
- vercel-json-shape.test.ts (Wave 0) goes from RED to GREEN once all sibling Wave 1 plans land
- No `maxDuration` field (per-route export only)
- Strict JSON — parses without errors
</success_criteria>

<output>
After completion, create `.planning/phases/05-webhooks-and-vercel-cron/05-08-SUMMARY.md`:
- File created (1)
- Worktree-isolated test status: vercel-json-shape.test.ts shape assertions GREEN; "route.ts exists" assertion may be RED depending on merge-back order — note explicitly
- Confirms verbatim D-12 schedules (no maxDuration, no comments, strict JSON)
- Phase-level next step: orchestrator runs `pnpm --filter frontend run build` post-merge to confirm Vercel accepts the file at deploy time
</output>
</content>
</invoke>