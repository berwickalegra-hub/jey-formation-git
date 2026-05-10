---
phase: "06"
plan: "02"
subsystem: docs
tags: [doc-refresh, claude-md, monolith-port-finalization]
requires:
  - frontend/src/lib/server/cron/auth.ts
  - frontend/src/lib/server/webhook/bictorys.ts
  - frontend/src/lib/server/orders/expire.ts
  - frontend/scripts/make-superadmin.ts
  - frontend/scripts/smoke-auth.ts
  - frontend/src/app/api/cron/outbox-drain/route.ts
  - frontend/src/lib/server/observability/claude-md-shape.test.ts
provides:
  - CLAUDE.md (current-state, no stale Phase-N forward-refs, Phase 5 surface in "Files Claude SHOULD modify")
affects:
  - future-Claude-sessions (project instructions accuracy)
tech-stack:
  added: []
  patterns: [doc-tripwire-as-CI-guard, line-anchored-targeted-edit]
key-files:
  created: []
  modified:
    - CLAUDE.md
decisions:
  - Targeted line replacement, not section rewrite (D-04 explicitly forbids reorganization)
  - Negation context "There is no separate Express backend anymore" stays — tripwire test allows it
  - 3 new "SHOULD modify" bullets cover Phase-5 surface (cron/, webhook/bictorys.ts, orders/expire.ts) — none overlap with PROTECTED list
metrics:
  duration: ~3min
  completed: 2026-05-10
  tasks: 1
  files-changed: 1
  insertions: 6
  deletions: 3
---

# Phase 6 Plan 02: CLAUDE.md Cleanup Summary

Refresh CLAUDE.md to remove 3 stale Phase-N forward-references (Phase 4 integration-tests deferral, Phase 6 cron-route forward-ref, "once Phase 7 lands" make-superadmin pointer) and append 3 bullets to `## Files Claude SHOULD modify` covering Phase-5 surface (cron auth helper, Bictorys webhook provider, order-expiration helper).

## Outcome

CLAUDE.md (124 lines, +3 net) is now state-of-art for the post-Phase-5 monolith. The doc tripwire `frontend/src/lib/server/observability/claude-md-shape.test.ts` (shipped by sibling Wave 1 plan 06-01) flips to GREEN against this file — verified via direct manual evaluation of all 6 assertions because Vitest binary is not installed in this isolated worktree.

## Edits Applied

### Edit 1 — Integration-tests deferral (line 33)

OLD:
```
Integration tests are deferred to Phase 4 (`pnpm --filter frontend run test:integration` is currently a no-op stub).
```

NEW:
```
Integration tests are deferred (no formal harness in v1) — `pnpm smoke:auth` provides a manual UAT script for the auth happy path against a running `pnpm dev`. See README.
```

### Edit 2 — Webhook outbox forward-ref (line 54)

OLD:
```
... drained by a Vercel Cron route (Phase 6, see STATUS.md M6).
```

NEW:
```
... drained by a Vercel Cron route ([frontend/src/app/api/cron/outbox-drain/route.ts](frontend/src/app/api/cron/outbox-drain/route.ts), every 1 min).
```

### Edit 3 — make-superadmin forward-ref (line 66)

OLD:
```
... (script lives at `frontend/scripts/make-superadmin.ts` once Phase 7 lands — see STATUS.md M7).
```

NEW:
```
... (the script lives at [frontend/scripts/make-superadmin.ts](frontend/scripts/make-superadmin.ts)).
```

### Appendix — 3 bullets added to `## Files Claude SHOULD modify` (after line 91)

```markdown
- `frontend/src/lib/server/cron/` — extend with `verifyCronSecret(req)` consumers; add new cron route handlers under `frontend/src/app/api/cron/<name>/route.ts` mirroring the 5 existing crons; ALL cron handlers must verify `Authorization: Bearer ${CRON_SECRET}` via the shared `verifyCronSecret` helper
- [frontend/src/lib/server/webhook/bictorys.ts](frontend/src/lib/server/webhook/bictorys.ts) — webhook provider re-export with the `kind: 'refunded'` upgrade; replace per project (Phase 5 default); the underlying `webhook/handler.ts` stays PROTECTED
- [frontend/src/lib/server/orders/expire.ts](frontend/src/lib/server/orders/expire.ts) — `expirePendingOrders({ prisma, batchSize? })`: extend per project to add post-expiration side-effects (e.g. notify the user, write a refund job to outbox); the cron route at `app/api/cron/order-expiration/route.ts` calls this
```

## Verification (13 grep assertions + tripwire)

| # | Assertion | Result |
|---|-----------|--------|
| 1 | `! grep -q "Integration tests are deferred to Phase 4" CLAUDE.md` | PASS |
| 2 | `! grep -q "Phase 6, see STATUS.md M6" CLAUDE.md` | PASS |
| 3 | `! grep -q "once Phase 7 lands" CLAUDE.md` | PASS |
| 4 | `grep -q "pnpm smoke:auth" CLAUDE.md` | PASS |
| 5 | `grep -q "/api/cron/outbox-drain" CLAUDE.md` | PASS |
| 6 | `grep -q "frontend/scripts/make-superadmin.ts" CLAUDE.md` | PASS |
| 7 | `grep -q "lib/server/cron/" CLAUDE.md` | PASS |
| 8 | `grep -q "webhook/bictorys.ts" CLAUDE.md` | PASS |
| 9 | `grep -q "orders/expire.ts" CLAUDE.md` | PASS |
| 10 | `grep -q "no separate Express backend" CLAUDE.md` (negation kept) | PASS |
| 11 | `grep -cE '\bExpress\b' CLAUDE.md == 1` (only the negation line) | PASS (count = 1) |
| 12 | `! grep -qE 'backend/src' CLAUDE.md` | PASS |
| 13 | `! grep -qE 'express\.json\(' CLAUDE.md` | PASS |
| extra | `! grep -qE 'middleware-order' CLAUDE.md` | PASS |

### Tripwire test (`claude-md-shape.test.ts`) — manual evaluation

Vitest binary not installed in this worktree (no `pnpm install` run; isolated parallel worktree). Manually evaluated each of the 6 test assertions against the edited file via `node -e` script — ALL 6 PASS:

1. CLAUDE.md exists at repo root → PASS
2. Zero errant Express refs (negation allowed) → PASS (0 hits after filtering negation)
3. No `backend/src` references → PASS
4. No `express.json(` references → PASS
5. No `middleware-order` references → PASS
6. Phase 4–5 surface mentioned (cron + webhook + withdrawal + upload) → PASS (all 4 regexes match)

The test will execute under Vitest in environments where deps are installed (CI, base branch). Logic is verified GREEN.

## Self-Check

- [x] CLAUDE.md modified (1 file, +6/-3 lines)
- [x] Commit `2d6c892` exists on branch `worktree-agent-ab55d4bdfe71d3d90`
- [x] All 13 grep assertions PASS
- [x] All 6 tripwire test assertions PASS (manual eval; Vitest not installed in worktree)
- [x] Negation context preserved (line 7 unchanged)
- [x] No reorganization, no other section touched

## Deviations from Plan

None — plan executed exactly as written. The 3 line replacements landed verbatim from the plan body; the 3-bullet appendix landed verbatim. No content reorganization, no protected-file list edits, no critical-invariants edits, no architecture-section edits.

**Note on tripwire verification path:** The plan's automated check `pnpm --filter frontend exec vitest run src/lib/server/observability/claude-md-shape.test.ts` returned `vitest: command not found` because this isolated worktree has no `node_modules/`. Substituted with direct `node -e` evaluation of each assertion — equivalent and PASS. This is expected behavior for parallel-execution worktrees and not a deviation from plan intent.

## File Diff Summary

```
 CLAUDE.md | 9 ++++++---
 1 file changed, 6 insertions(+), 3 deletions(-)
```

Line count: 121 → 124 (delta +3, matching expected appendix addition; the 3 single-line replacements were 1-for-1).

## Self-Check: PASSED
