---
id: 06-02-claude-md-cleanup
phase: "06"
plan: 02
type: execute
wave: 2
depends_on: ["01"]
files_modified:
  - CLAUDE.md
autonomous: true
task_count: 1
requirements:
  - DOC-01
must_haves:
  truths:
    - "CLAUDE.md line 33 'Integration tests are deferred to Phase 4...' is replaced with the smoke:auth pointer"
    - "CLAUDE.md line 54 '...drained by a Vercel Cron route (Phase 6, see STATUS.md M6)' is replaced with '/api/cron/outbox-drain'"
    - "CLAUDE.md line 66 '...once Phase 7 lands — see STATUS.md M7' is replaced with the actual script path"
    - "CLAUDE.md `## Files Claude SHOULD modify` section gains 3 new entries: lib/server/cron/, lib/server/webhook/bictorys.ts, lib/server/orders/expire.ts"
    - "Zero errant Express|backend/src|express.json|middleware-order references remain (the single 'no separate Express backend anymore' negation at line 7 STAYS)"
    - "claude-md-shape.test.ts (shipped by plan 06-01) goes GREEN against this file"
    - "No content reorganization — only the 3 line replacements + 1 appendix"
  artifacts:
    - path: "CLAUDE.md"
      provides: "Project instructions accurate for the post-Phase-5 monolith — no stale Phase-N forward-references"
      min_lines: 122
  key_links:
    - from: "CLAUDE.md `## Files Claude SHOULD modify`"
      to: "frontend/src/lib/server/cron/auth.ts (Phase 5)"
      via: "appended bullet describing the verifyCronSecret extension point"
      pattern: "lib/server/cron"
    - from: "CLAUDE.md line ~54"
      to: "frontend/src/app/api/cron/outbox-drain/route.ts (Phase 5)"
      via: "replacement text names the actual Phase 5 cron route"
      pattern: "/api/cron/outbox-drain"
    - from: "CLAUDE.md line ~66"
      to: "frontend/scripts/make-superadmin.ts (Phase 3)"
      via: "replacement text names the actual script path"
      pattern: "frontend/scripts/make-superadmin.ts"
    - from: "CLAUDE.md line ~33"
      to: "frontend/scripts/smoke-auth.ts (Phase 6 plan 06-01)"
      via: "replacement text directs operators to `pnpm smoke:auth`"
      pattern: "pnpm smoke:auth"
---

<objective>
Single-task targeted-edit pass on `CLAUDE.md` to:
1. Replace the 3 stale forward-references (lines 33, 54, 66) with current-state language pointing at shipped Phase 4/5/6 surface;
2. Append 3 new bullets to `## Files Claude SHOULD modify` covering the lib subsystems Phase 5 added (`cron/`, `webhook/bictorys.ts`, `orders/expire.ts`);
3. Confirm via grep that no stray Express references slipped in.

Purpose: CLAUDE.md is the source-of-truth project-instruction file Claude reads at the start of every session in this repo. Outdated forward-references ("Phase 6 will...", "once Phase 7 lands...") confuse future Claude instances reading post-Phase-6 — they assume work is incomplete when it has shipped. The protected-file list and architecture sections are CORRECT and STAY untouched.

Output: 1 file modified (`CLAUDE.md`); ~6 line-anchored edits totaling ~15 lines of delta. Zero behavior change in any source file.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-tests-scripts-docker-docs/06-CONTEXT.md
@.planning/phases/06-tests-scripts-docker-docs/06-RESEARCH.md
@CLAUDE.md

@frontend/src/lib/server/cron/auth.ts
@frontend/src/lib/server/webhook/bictorys.ts
@frontend/src/lib/server/orders/expire.ts
@frontend/scripts/make-superadmin.ts
@frontend/scripts/smoke-auth.ts

<reference_patterns>
- **Targeted-edit philosophy:** D-04 in CONTEXT explicitly says "NO content reorganization — preserve the existing structure (it's already Next.js-shaped)". This plan is line-replacement, not section rewrite.
- **Line numbers are approximate** — the file is ~122 lines and may have drifted by a few lines from the RESEARCH-time snapshot. Use `grep -n` to find the actual current line before editing.
- **Negation context for "Express":** the line "There is no separate Express backend anymore — server logic lives under..." (around line 7) is HISTORICAL CONTEXT and stays. The claude-md-shape.test.ts tripwire (plan 06-01 task 3) explicitly allows this single negation.
- **Phase 4/5 routes already mentioned:** Per RESEARCH §"CLAUDE.md Cleanup Pattern" the High-level architecture section already references webhook (line 54), withdrawals (line 56), cron (line 60). NO new architecture content needed.
</reference_patterns>

<sibling_plans_note>
This is a Wave 1 plan running parallel to 06-03 (README rewrite) and 06-04 (STATUS.md refresh). File overlap matrix: this plan = `CLAUDE.md` only; 06-03 = `README.md` + `.planning/ROADMAP.md`; 06-04 = `STATUS.md`. ZERO overlap. All 3 plans run fully parallel and merge back independently. Once both this plan AND plan 06-03 merge back, the doc-tripwire tests from plan 06-01 (`claude-md-shape.test.ts` + `readme-shape.test.ts`) flip from RED to GREEN.
</sibling_plans_note>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Apply 3 line replacements + 1 appendix to CLAUDE.md</name>
  <files>
    - CLAUDE.md (EDIT)
  </files>
  <read_first>
    - CLAUDE.md (full file — ~122 lines; confirm exact line numbers for the 3 replacement targets, which may have drifted slightly)
    - .planning/phases/06-tests-scripts-docker-docs/06-RESEARCH.md §"CLAUDE.md Cleanup Pattern" (verbatim replacement strings)
    - frontend/src/lib/server/cron/auth.ts (confirm the export shape — `verifyCronSecret(req): NextResponse | null`)
    - frontend/src/lib/server/webhook/bictorys.ts (confirm export — `bictorysWebhookProvider`)
    - frontend/src/lib/server/orders/expire.ts (confirm export — `expirePendingOrders({ prisma })`)
  </read_first>
  <action>
**STEP 1: Locate the 3 replacement targets via grep (line numbers may have drifted):**

```bash
grep -n "Integration tests are deferred to Phase 4" CLAUDE.md
grep -n "drained by a Vercel Cron route (Phase 6" CLAUDE.md
grep -n "once Phase 7 lands" CLAUDE.md
```

Each grep should return exactly 1 line. Use those line numbers in the Edit calls below. If any grep returns 0 results, the line has already been edited or refactored — STOP and document in the SUMMARY (do not invent new content).

**STEP 2: Replace 3 stale forward-references.**

**Edit 1** — replace the integration-tests deferral line:

OLD (one line, around line 33):
```
Integration tests are deferred to Phase 4 (`pnpm --filter frontend run test:integration` is currently a no-op stub).
```

NEW:
```
Integration tests are deferred (no formal harness in v1) — `pnpm smoke:auth` provides a manual UAT script for the auth happy path against a running `pnpm dev`. See README.
```

**Edit 2** — replace the webhook outbox forward-reference:

OLD (one line, around line 54, inside the `**Webhook idempotency + outbox:**` paragraph):
```
... drained by a Vercel Cron route (Phase 6, see STATUS.md M6).
```

NEW:
```
... drained by a Vercel Cron route ([frontend/src/app/api/cron/outbox-drain/route.ts](frontend/src/app/api/cron/outbox-drain/route.ts), every 1 min).
```

**Edit 3** — replace the make-superadmin forward-reference:

OLD (one line, around line 66, end of the `**Admin back-office**` paragraph):
```
... Bootstrap the first SUPERADMIN with `pnpm db:make-superadmin <email>` (script lives at `frontend/scripts/make-superadmin.ts` once Phase 7 lands — see STATUS.md M7).
```

NEW:
```
... Bootstrap the first SUPERADMIN with `pnpm db:make-superadmin <email>` (the script lives at [frontend/scripts/make-superadmin.ts](frontend/scripts/make-superadmin.ts)).
```

**STEP 3: Append 3 bullets to `## Files Claude SHOULD modify` section.**

Locate the section header `## Files Claude SHOULD modify (project surface)` (around line 83) and the existing bullet list. After the existing last bullet (the `[frontend/src/app/](frontend/src/app/)` line, around line 91), insert these 3 new bullets BEFORE the closing of that section:

```markdown
- `frontend/src/lib/server/cron/` — extend with `verifyCronSecret(req)` consumers; add new cron route handlers under `frontend/src/app/api/cron/<name>/route.ts` mirroring the 5 existing crons; ALL cron handlers must verify `Authorization: Bearer ${CRON_SECRET}` via the shared `verifyCronSecret` helper
- [frontend/src/lib/server/webhook/bictorys.ts](frontend/src/lib/server/webhook/bictorys.ts) — webhook provider re-export with the `kind: 'refunded'` upgrade; replace per project (Phase 5 default); the underlying `webhook/handler.ts` stays PROTECTED
- [frontend/src/lib/server/orders/expire.ts](frontend/src/lib/server/orders/expire.ts) — `expirePendingOrders({ prisma, batchSize? })`: extend per project to add post-expiration side-effects (e.g. notify the user, write a refund job to outbox); the cron route at `app/api/cron/order-expiration/route.ts` calls this
```

**STEP 4: Verify with grep (do these AFTER the edits land):**

```bash
# The 3 stale references must be GONE:
! grep -q "Integration tests are deferred to Phase 4" CLAUDE.md
! grep -q "Phase 6, see STATUS.md M6" CLAUDE.md
! grep -q "once Phase 7 lands" CLAUDE.md

# The 3 new references must be present:
grep -q "pnpm smoke:auth" CLAUDE.md
grep -q "/api/cron/outbox-drain" CLAUDE.md
grep -q "frontend/scripts/make-superadmin.ts" CLAUDE.md

# The 3 new bullet entries must be present:
grep -q "lib/server/cron/" CLAUDE.md
grep -q "webhook/bictorys.ts" CLAUDE.md
grep -q "orders/expire.ts" CLAUDE.md

# The negation reference at the top STAYS (line 7):
grep -q "no separate Express backend" CLAUDE.md

# Errant Express references must be ZERO:
test "$(grep -cE '\bExpress\b' CLAUDE.md)" -eq 1   # exactly the negation reference, no others
! grep -qE 'backend/src' CLAUDE.md
! grep -qE 'express\.json\(' CLAUDE.md
! grep -qE 'middleware-order' CLAUDE.md
```

All 13 of these greps must pass. If any fail, fix the edits and re-verify.

**CRITICAL — DO NOT:**
- Reorganize sections, reorder bullets, change heading levels, change tone
- Add new sections (the file is the right shape; only the 3 stale lines + 1 appendix are wrong)
- Modify the `## Files Claude must NOT modify` list (this is current; the test in plan 06-01 verifies)
- Modify the `## Critical invariants` list (this is current and load-bearing)
- Touch the High-level architecture section (Phase 4/5 already mentioned per RESEARCH)
- Add or remove links from any other section
  </action>
  <verify>
    <automated>! grep -q "Integration tests are deferred to Phase 4" CLAUDE.md && ! grep -q "Phase 6, see STATUS.md M6" CLAUDE.md && ! grep -q "once Phase 7 lands" CLAUDE.md && grep -q "pnpm smoke:auth" CLAUDE.md && grep -q "/api/cron/outbox-drain" CLAUDE.md && grep -q "frontend/scripts/make-superadmin.ts" CLAUDE.md && grep -q "lib/server/cron/" CLAUDE.md && grep -q "webhook/bictorys.ts" CLAUDE.md && grep -q "orders/expire.ts" CLAUDE.md && grep -q "no separate Express backend" CLAUDE.md</automated>
  </verify>
  <acceptance_criteria>
    - `! grep -q "Integration tests are deferred to Phase 4" CLAUDE.md` exits 0 (stale ref removed)
    - `! grep -q "Phase 6, see STATUS.md M6" CLAUDE.md` exits 0 (stale ref removed)
    - `! grep -q "once Phase 7 lands" CLAUDE.md` exits 0 (stale ref removed)
    - `grep -q "pnpm smoke:auth" CLAUDE.md` exits 0 (Edit 1 replacement landed)
    - `grep -q "/api/cron/outbox-drain" CLAUDE.md` exits 0 (Edit 2 replacement landed)
    - `grep -q "frontend/scripts/make-superadmin.ts" CLAUDE.md` exits 0 (Edit 3 replacement landed)
    - `grep -q "lib/server/cron/" CLAUDE.md` exits 0 (appendix bullet 1)
    - `grep -q "webhook/bictorys.ts" CLAUDE.md` exits 0 (appendix bullet 2)
    - `grep -q "orders/expire.ts" CLAUDE.md` exits 0 (appendix bullet 3)
    - `grep -q "no separate Express backend" CLAUDE.md` exits 0 (negation context preserved)
    - `! grep -qE "backend/src" CLAUDE.md` exits 0 (no errant `backend/src` paths)
    - `! grep -qE "express\.json\(" CLAUDE.md` exits 0 (no Express middleware refs)
    - `! grep -qE "middleware-order" CLAUDE.md` exits 0 (no Express ordering refs)
    - `wc -l CLAUDE.md` >= 120 (file size sanity — appendix added 3 lines, replacements were 1-for-1)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/claude-md-shape.test.ts` exits 0 (tripwire from plan 06-01 GREEN against the post-edit file)
  </acceptance_criteria>
  <done>CLAUDE.md has 3 line-anchored replacements + 1 appendix bullet block; claude-md-shape.test.ts (shipped by plan 06-01) is GREEN; no other section touched.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer→repo | CLAUDE.md is checked into git; project instructions only — no secrets, no executable code |
| future Claude→CLAUDE.md | Every new session in this repo reads CLAUDE.md as project instructions; stale forward-references are a soft-correctness risk (Claude assumes work is incomplete when it has shipped) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-02-01 | T (Tampering) | accidental rewrite of the protected-file list | mitigate | Acceptance criteria explicitly checks the negation-context line stays + lists the appendix bullets to add (not "rewrite section X"); planner-checker compares git diff line count to expected delta |
| T-06-02-02 | I (Information disclosure) | leaking phase-internal todos into CLAUDE.md | accept | The replacements remove "Phase X, see STATUS.md MN" forward-refs; the file becomes more state-of-art, less roadmap-leak |
| T-06-02-03 | E (Elevation of privilege) | adding a new bullet to "Files Claude SHOULD modify" that incorrectly includes a PROTECTED file | mitigate | The 3 appendix bullets are explicitly NEW Phase 5 surfaces (cron/, webhook/bictorys.ts, orders/expire.ts) — none overlap with the existing PROTECTED list (auth.ts, crypto.ts, webhook/handler.ts, etc.) |
</threat_model>

<verification>
- All 13 grep assertions in Task 1 STEP 4 pass
- `pnpm --filter frontend exec vitest run src/lib/server/observability/claude-md-shape.test.ts` exits 0 (tripwire GREEN against the edited file)
- `pnpm format:check` passes (markdown is unaffected)
- `git diff --stat CLAUDE.md` shows ~6-15 lines changed (3 single-line replacements + 3-bullet appendix; total ~15 line delta)
- No other file modified: `git status --porcelain` shows only `M CLAUDE.md`
</verification>

<success_criteria>
- 3 stale forward-references replaced with current-state pointers
- 3 new bullets appended to `## Files Claude SHOULD modify` covering Phase 5 surface
- Zero errant Express/backend/src/express.json/middleware-order references
- Single negation context preserved (the line at ~7)
- claude-md-shape.test.ts (from plan 06-01) GREEN
- No other section reorganized; protected-file list unchanged; critical invariants unchanged
</success_criteria>

<output>
After completion, create `.planning/phases/06-tests-scripts-docker-docs/06-02-SUMMARY.md`:
- File modified: `CLAUDE.md`
- Line-anchored before/after pairs for the 3 replacements (record the line numbers used)
- Appendix bullet block (verbatim text added)
- Result of all 13 grep verifications (PASS/FAIL each)
- claude-md-shape.test.ts result (assumes plan 06-01 has merged back; if running this plan first, document RED status and note the test will GREEN after 06-01 merge)
- Total line count diff (`wc -l CLAUDE.md` before/after)
</output>
</content>
