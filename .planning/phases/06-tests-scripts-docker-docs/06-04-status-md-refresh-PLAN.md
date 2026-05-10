---
id: 06-04-status-md-refresh
phase: "06"
plan: 04
type: execute
wave: 1
depends_on: []
files_modified:
  - STATUS.md
autonomous: true
task_count: 1
requirements:
  - DOC-02
must_haves:
  truths:
    - "STATUS.md ✅ DONE section adds Phase 2-5 entries with the same shape used for Phase 0/1 (heading, bullets, endpoint table where relevant)"
    - "STATUS.md 🔨 TODO section is reduced to Phase 6 (in flight) + Phase 7 (final pass) — earlier M4-M7 entries are removed since they shipped"
    - "STATUS.md preserves the historical 📚 'Earlier scaffold work' section (M1-M3 archaeology)"
    - "STATUS.md Critical invariants list stays IDENTICAL — these are load-bearing reminders that don't change phase-to-phase"
    - "STATUS.md voice stays terse, technical, no marketing — matches the existing Phase 0/1 entries verbatim"
    - "Zero errant Express|backend/src|express.json|middleware-order references introduced (the existing 'no separate Express backend' top-line stays)"
  artifacts:
    - path: "STATUS.md"
      provides: "Live port progress doc — accurate as of post-Phase-5 ship + Phase 6 in flight"
      min_lines: 100
  key_links:
    - from: "STATUS.md ✅ DONE"
      to: "frontend/src/app/api/{auth,oauth,notifications,withdrawal-pin,upload,files,withdrawals,admin,orders,webhooks,cron}/* (Phases 2-5)"
      via: "endpoint tables with Method/Path/Status/Requirement-ID columns"
      pattern: "✓"
    - from: "STATUS.md 🔨 TODO"
      to: ".planning/phases/06-tests-scripts-docker-docs/ + .planning/phases/07-final-pass/"
      via: "Phase 6 + Phase 7 entries pointing at the .planning/ tree"
      pattern: "Phase 6\\|Phase 7"
---

<objective>
Single-task targeted refresh of `STATUS.md` to:
1. Add ✅ DONE entries for Phases 2-5 (matching the existing Phase 0/Phase 1 shape — heading, bullets, endpoint table where applicable);
2. Reduce the 🔨 TODO section from "M4-M7 explicit roadmap" to just "Phase 6 (in flight) + Phase 7 (final pass)" — the M4-M5-M6 entries shipped and live as ✅ DONE now;
3. Preserve the 📚 "Earlier scaffold work" archaeology section unchanged (M1-M3 history);
4. Preserve the "Critical invariants (never compromise)" section verbatim — those are project-lifetime invariants, not phase progress.

Purpose: STATUS.md is the live port-progress doc — the source of truth for "what's done vs what's left". After Phases 2-5 shipped, the file is stale: it still lists Phases 2-5 work as TODO under "M4 — Simple routes / M5 — Heavy routes / M6 — Webhooks + Vercel Cron" headings. Future Claude sessions and the user reading this file post-Phase-5 need accurate state.

This is the smallest of the 3 Wave 1 doc plans — single file, single section append + single section reduction. No tripwire test (per RESEARCH "STATUS.md is internal port-progress doc, not a public-facing contract; the doc-tripwire pattern only covers CLAUDE.md + README.md").

Output: 1 file modified (`STATUS.md`); ~50-80 lines of delta — additions for Phases 2-5 ✅, removals from 🔨 TODO M4-M6 entries.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@STATUS.md
@CLAUDE.md
@.planning/phases/02-oauth-notifications-pin/
@.planning/phases/03-admin-orders-visibility/
@.planning/phases/04-upload-files-withdrawals/
@.planning/phases/05-webhooks-and-vercel-cron/

<reference_patterns>
- **Existing Phase 0/Phase 1 entry shape:** STATUS.md lines 7-39 — each phase block has `### Phase N — Name (commit \`HASH\`)`, a 2-3 line summary paragraph, and an endpoint table where applicable (Phase 1 has 9 rows). Replicate this shape for Phases 2-5.
- **Commit hash placeholders:** Use `(commits TBD post-execute)` for any phase that is still in flight at write time. The user can later run `git log --grep "Phase N" --oneline | head -1` to fill the actual hash and edit STATUS.md again. DO NOT invent hashes.
- **Voice:** Terse + technical, mirroring the existing Phase 0/1 entries. Bullets are sentence-fragment style ("All 9 auth routes shipped under..."). No marketing.
- **Critical invariants section is FROZEN:** Lines 125-136 of the current STATUS.md list 10 numbered invariants. These are load-bearing — do not edit, reorder, or rewrite.
</reference_patterns>

<sibling_plans_note>
This is a Wave 1 plan running parallel to 06-02 (CLAUDE.md cleanup) and 06-03 (README rewrite). File overlap matrix: this plan = `STATUS.md` only; 06-02 = `CLAUDE.md`; 06-03 = `README.md` + `.planning/ROADMAP.md`. ZERO overlap. All 3 Wave 1 plans run fully parallel and merge back independently.
</sibling_plans_note>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Refresh STATUS.md ✅ DONE for Phases 2-5 + reduce 🔨 TODO to Phase 6/7</name>
  <files>
    - STATUS.md (EDIT)
  </files>
  <read_first>
    - STATUS.md (full file — confirm current shape; the file is ~137 lines)
    - .planning/ROADMAP.md (Phase 2-5 goals + success criteria — paraphrase into the STATUS bullets)
    - .planning/REQUIREMENTS.md (requirement IDs for each phase — used in endpoint tables)
    - `ls .planning/phases/02-*/`, `ls .planning/phases/03-*/`, `ls .planning/phases/04-*/`, `ls .planning/phases/05-*/` (confirm each phase has SUMMARY files indicating shipped status)
    - `git log --oneline --grep="^docs(0[2-5])"` (recent commits to anchor the "shipped" claim)
  </read_first>
  <action>
**STEP 1: Locate the current section markers via grep:**

```bash
grep -n "^## ✅ DONE" STATUS.md
grep -n "^### Phase 1" STATUS.md
grep -n "^### Doc + tooling cleanup" STATUS.md
grep -n "^## 📚 Earlier scaffold work" STATUS.md
grep -n "^## 🔨 TODO" STATUS.md
grep -n "^### M4 — Simple routes" STATUS.md
grep -n "^### M5 — Heavy routes" STATUS.md
grep -n "^### M6 — Webhooks" STATUS.md
grep -n "^### M7 — Scripts" STATUS.md
grep -n "^### M8 — Final pass" STATUS.md
grep -n "^## Critical invariants" STATUS.md
```

Use those line numbers when applying edits. The line numbers below are approximate snapshots from the read step.

**STEP 2: Insert 4 new phase blocks BETWEEN the existing Phase 1 entry and the "Doc + tooling cleanup" subsection (currently around line 32).**

Insert this block AFTER the Phase 1 entry (which ends at the line beginning "Lib helpers: ...140/140 tests pass...") and BEFORE the `### Doc + tooling cleanup` heading:

```markdown
### Phase 2 — OAuth, Notifications, Withdrawal-PIN (commits TBD)

Google OAuth flow shipped under `frontend/src/app/api/auth/oauth/google/{start,callback}/route.ts` using `arctic` (state + PKCE cookies path-scoped to `/api/auth/oauth`). OAuth callback refuses `email_verified !== true`; account-linking by email; standard auth cookies issued on success. Notifications CRUD under `/api/notifications/*` (list, count, mark-read, prefs). Withdrawal-PIN under `/api/auth/withdrawal-pin` (GET/POST/DELETE). All `createNotification(prisma, input)` paths catch `P2002` for at-most-once dedup.

| Endpoint                                | Method        | Status | Requirement |
| --------------------------------------- | ------------- | ------ | ----------- |
| `/api/auth/oauth/google/start`          | GET           | ✓      | OAUTH-01    |
| `/api/auth/oauth/google/callback`       | GET           | ✓      | OAUTH-02    |
| `/api/notifications`                    | GET / POST    | ✓      | NOTIF-01-02 |
| `/api/notifications/count`              | GET           | ✓      | NOTIF-03    |
| `/api/notifications/prefs`              | GET / PATCH   | ✓      | NOTIF-04-05 |
| `/api/auth/withdrawal-pin`              | GET/POST/DEL  | ✓      | PIN-01      |

### Phase 3 — Admin, Orders, Visibility (commits TBD)

12 admin endpoints shipped under `/api/admin/*` (users list/detail, role/status mutations, orders, withdrawals + cancel, audit-log, outbox visibility, email-queue visibility, rate-limits visibility, /me probe). All admin mutations call `logAdminAction(prisma, {...})` → AdminAction row. `pnpm db:make-superadmin <email>` script lives at `frontend/scripts/make-superadmin.ts` with companion test. `POST /api/orders` ships with idempotency-key + Bictorys provider + in-memory CircuitBreaker (PAY-01).

| Endpoint                              | Method | Status | Requirement |
| ------------------------------------- | ------ | ------ | ----------- |
| `/api/admin/users` (list+detail)      | GET    | ✓      | ADMIN-01    |
| `/api/admin/users/:id/role`           | PATCH  | ✓      | ADMIN-01    |
| `/api/admin/orders`                   | GET    | ✓      | ADMIN-02    |
| `/api/admin/withdrawals`              | GET    | ✓      | ADMIN-03    |
| `/api/admin/withdrawals/:id/cancel`   | POST   | ✓      | ADMIN-03    |
| `/api/admin/audit-log`                | GET    | ✓      | ADMIN-04    |
| `/api/admin/me`                       | GET    | ✓      | ADMIN-05    |
| `/api/admin/outbox`                   | GET    | ✓      | OBS-01      |
| `/api/admin/email-queue`              | GET    | ✓      | OBS-02      |
| `/api/admin/rate-limits`              | GET    | ✓      | OBS-03      |
| `/api/orders`                         | POST   | ✓      | PAY-01      |

Multi-tenancy (Organizations) deferred per ROADMAP — Prisma models + middleware retained as opt-in plumbing.

### Phase 4 — Upload, Files, Withdrawals (commits TBD)

`POST /api/upload` ships with `req.formData()` + `File.arrayBuffer()` + magic-byte sniff against `UPLOAD_ALLOWED_MIME` allowlist (no trusting `File.type`). `GET /api/files/[...key]` proxies R2/S3 stream with owner gate + ETag forwarding; falls back to DB-stored content when R2 unconfigured. `POST /api/withdrawals` runs the 8-code guard chain (`AMOUNT_BELOW_MIN`, `AMOUNT_ABOVE_MAX`, `DAILY_LIMIT_EXCEEDED`, `COOLDOWN_ACTIVE`, `PIN_NOT_SET`, `PIN_REQUIRED`, `PIN_INVALID`, `INSUFFICIENT_BALANCE`) inside a Serializable transaction guarded by `pg_advisory_xact_lock(hashtext(userId))` — race-free per WD-01. `WITHDRAWAL_BALANCE_CHECK=1` default; disable documented as financial-safety risk.

| Endpoint                | Method | Status | Requirement   |
| ----------------------- | ------ | ------ | ------------- |
| `/api/upload`           | POST   | ✓      | UP-01         |
| `/api/files/[...key]`   | GET    | ✓      | UP-02         |
| `/api/withdrawals`      | POST   | ✓      | WD-01-02-04   |
| `/api/withdrawals`      | GET    | ✓      | WD-03         |

### Phase 5 — Webhooks and Vercel Cron (commits TBD)

`POST /api/webhooks/bictorys` ships with raw-body HMAC verification (60s replay window) + `WebhookLog @@unique([externalId, eventType])` dedup inside Serializable transaction; side-effects emit through outbox via `enqueueOutbox(tx, event)`. 5 cron route handlers under `/api/cron/<name>/route.ts`, each gated by `Authorization: Bearer ${CRON_SECRET}` (verified by `verifyCronSecret(req)` at `frontend/src/lib/server/cron/auth.ts`). `frontend/vercel.json` declares all 5 schedules.

| Endpoint                              | Schedule    | Status | Requirement |
| ------------------------------------- | ----------- | ------ | ----------- |
| `/api/webhooks/bictorys`              | (provider)  | ✓      | WH-01-02    |
| `/api/cron/outbox-drain`              | every 1 min | ✓      | CRON-01     |
| `/api/cron/email-queue-drain`         | every 1 min | ✓      | CRON-02     |
| `/api/cron/verification-cleanup`      | hourly      | ✓      | CRON-03     |
| `/api/cron/order-expiration`          | every 5 min | ✓      | CRON-04     |
| `/api/cron/webhook-log-purge`         | daily       | ✓      | CRON-05     |
| `frontend/vercel.json`                | —           | ✓      | CRON-07     |

In-memory CircuitBreaker remains single-instance per CLAUDE.md ("documented limitation"); Redis-backed swap deferred to v2.
```

**STEP 3: Reduce the 🔨 TODO section.**

Locate the section starting `## 🔨 TODO — explicit roadmap` (around line 69). The current content lists `### M4 — Simple routes`, `### M5 — Heavy routes`, `### M6 — Webhooks + Vercel Cron`, `### M7 — Scripts, tests, Docker, docs`, `### M8 — Final pass` (lines ~73-123). Phases M4-M5-M6 shipped (and are now under ✅ DONE per Step 2); M7 = Phase 6 (this in-flight phase); M8 = Phase 7.

Replace the entire block from `## 🔨 TODO — explicit roadmap` through (but not including) `## Critical invariants (never compromise)` with:

```markdown
## 🔨 TODO — remaining v1 work

The remaining work is bounded: Phase 6 (this in-flight phase — tests, scripts, Docker UAT, doc rewrites) + Phase 7 (final lint/typecheck/test gate before tagging v1).

### Phase 6 — Tests, Scripts, Docker, Docs (in flight)

- 7 TEST-02 gap-fill unit tests for PROTECTED libs (`crypto`, `withdrawals/lock`, `outbox/dispatcher`, `oauth/google`, `notifications/createNotification`, `admin/audit`, `payments/circuit-breaker`)
- `frontend/scripts/smoke-auth.ts` — TEST-03 manual UAT script wired as `pnpm smoke:auth`
- `frontend/scripts/seed-dev.ts` refactored to export `main(args, deps)` with CLI guard + companion test
- 2 doc-tripwire tests (`claude-md-shape.test.ts`, `readme-shape.test.ts`) lock the doc audits as CI guards
- DOCKER-01 manual UAT — `docker build -f frontend/Dockerfile -t amadou-monolith .` + `/api/health` probe
- DOC-01 — CLAUDE.md targeted edits (3 stale forward-references replaced + 3 appendix bullets for Phase 5 surface)
- DOC-02 — README.md full rewrite to 7-section outline (quickstart, env ref, route inventory, smoke, deploy, scope-boundary, invariants)
- ROADMAP Phase 6 success criterion #4 docker command flag fix

See `.planning/phases/06-tests-scripts-docker-docs/` for plans + summaries.

### Phase 7 — Final pass

`pnpm format && pnpm lint && pnpm typecheck && pnpm test` must all exit 0 from the repo root with no suppressed errors or `any` casts. `grep -r "runtime = 'edge'" frontend/src/app/api/` returns no matches. `grep -r "express" CLAUDE.md README.md` returns no matches (doc drift fully eliminated). Tag v1 after gate passes.

See `.planning/phases/07-final-pass/` (created when Phase 6 completes).
```

**STEP 4: Preserve the `## Critical invariants (never compromise)` section verbatim.** Do NOT touch lines 125-137 of the current file (the 10 numbered invariants). The Edit tool's "before" string for the TODO section replacement should END at the line immediately before `## Critical invariants` — not after.

**STEP 5: Verify with grep:**

```bash
# New phase blocks present:
grep -q "^### Phase 2 — OAuth, Notifications, Withdrawal-PIN" STATUS.md
grep -q "^### Phase 3 — Admin, Orders, Visibility" STATUS.md
grep -q "^### Phase 4 — Upload, Files, Withdrawals" STATUS.md
grep -q "^### Phase 5 — Webhooks and Vercel Cron" STATUS.md

# TODO section reduced (M4-M6 headings GONE):
! grep -qE "^### M4 — Simple routes" STATUS.md
! grep -qE "^### M5 — Heavy routes" STATUS.md
! grep -qE "^### M6 — Webhooks \+ Vercel Cron" STATUS.md

# New TODO entries present:
grep -q "Phase 6 — Tests, Scripts, Docker, Docs (in flight)" STATUS.md
grep -q "Phase 7 — Final pass" STATUS.md

# Critical invariants section preserved verbatim:
grep -q "^## Critical invariants" STATUS.md
grep -q "Sentry init stays the first thing the server runtime loads" STATUS.md
grep -q "Cron handlers verify" STATUS.md

# Earlier scaffold work archaeology preserved:
grep -q "^## 📚 Earlier scaffold work" STATUS.md
grep -q "^### M1 — Scaffold" STATUS.md
grep -q "^### M2 — Libs \+ middleware ported" STATUS.md
grep -q "^### M3 (partial) — Health \+ readyz routes" STATUS.md

# No errant Express references introduced:
test "$(grep -cE '\bExpress\b' STATUS.md)" -le 2   # the historical "Cloned from amadou-template (Express 5...)" + the M2 reference both stay
! grep -qE 'backend/src' STATUS.md   # the `backend/src/lib/**` reference in M2 historical block STAYS — adjust this if needed (see note below)
```

**Note on `backend/src` in STATUS.md M2:** the existing line 53 reads `All backend/src/lib/** → frontend/src/lib/server/**:` — this is HISTORICAL CONTEXT describing the port path, identical to CLAUDE.md's "no separate Express backend anymore" preservation. If the grep above fails because of this single line, that's expected — adjust the assertion to allow exactly 1 occurrence (the M2 archaeology line). Do NOT remove it; it is the doc archaeology of the port itself.

**Critical — DO NOT:**
- Touch the top metadata line (`# amadou-monolith — port status` + the `Cloned from...` paragraph)
- Touch the `## Critical invariants (never compromise)` section
- Touch the `## 📚 Earlier scaffold work` archaeology (M1-M3)
- Reorder the existing Phase 0/Phase 1 entries
- Remove the `### Doc + tooling cleanup` subsection — it is part of the ✅ DONE history
  </action>
  <verify>
    <automated>grep -q "^### Phase 2 — OAuth" STATUS.md && grep -q "^### Phase 5 — Webhooks and Vercel Cron" STATUS.md && ! grep -qE "^### M4 — Simple routes" STATUS.md && grep -q "Phase 6 — Tests, Scripts, Docker, Docs" STATUS.md && grep -q "^## Critical invariants" STATUS.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "^### Phase 2 — OAuth, Notifications, Withdrawal-PIN" STATUS.md` exits 0
    - `grep -q "^### Phase 3 — Admin, Orders, Visibility" STATUS.md` exits 0
    - `grep -q "^### Phase 4 — Upload, Files, Withdrawals" STATUS.md` exits 0
    - `grep -q "^### Phase 5 — Webhooks and Vercel Cron" STATUS.md` exits 0
    - `! grep -qE "^### M4 — Simple routes" STATUS.md` exits 0 (M4 heading removed)
    - `! grep -qE "^### M5 — Heavy routes" STATUS.md` exits 0 (M5 heading removed)
    - `! grep -qE "^### M6 — Webhooks \\+ Vercel Cron" STATUS.md` exits 0 (M6 heading removed)
    - `! grep -qE "^### M7 — Scripts" STATUS.md` exits 0 (M7 heading removed)
    - `! grep -qE "^### M8 — Final pass" STATUS.md` exits 0 (M8 heading removed)
    - `grep -q "Phase 6 — Tests, Scripts, Docker, Docs" STATUS.md` exits 0 (new TODO heading)
    - `grep -q "Phase 7 — Final pass" STATUS.md` exits 0 (new TODO heading)
    - `grep -q "^## Critical invariants" STATUS.md` exits 0 (invariants section preserved)
    - `grep -q "Sentry init stays the first thing the server runtime loads" STATUS.md` exits 0 (invariant 1 preserved verbatim)
    - `grep -q "Cron handlers verify" STATUS.md` exits 0 (invariant 10 preserved)
    - `grep -q "^## 📚 Earlier scaffold work" STATUS.md` exits 0 (archaeology preserved)
    - `grep -q "^### M1 — Scaffold" STATUS.md` exits 0
    - `grep -q "^### M2 — Libs" STATUS.md` exits 0
    - `grep -q "^### M3" STATUS.md` exits 0
    - `wc -l STATUS.md` >= 100 (sanity — phase blocks added)
    - `git diff --stat STATUS.md` shows ~50-100 line delta
    - `git status --porcelain` shows exactly `M STATUS.md` (no other file modified)
    - `pnpm format:check` passes (Markdown is unaffected)
  </acceptance_criteria>
  <done>STATUS.md ✅ DONE section adds Phase 2-5 blocks; 🔨 TODO section reduced to Phase 6/7; archaeology + invariants preserved verbatim.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer→repo | STATUS.md is checked into git; internal port-progress doc — no secrets |
| future Claude→STATUS.md | Future sessions read STATUS.md to understand "what's done"; stale TODO entries cause re-implementation attempts |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-04-01 | T (Tampering) | accidental edit to Critical invariants section | mitigate | Acceptance criteria pins specific invariant text (`grep -q "Sentry init stays the first thing"`); Edit tool's diff range explicitly stops before `## Critical invariants` |
| T-06-04-02 | T (Tampering) | losing M1-M3 archaeology | mitigate | Acceptance criteria asserts 4 specific 📚 section markers stay |
| T-06-04-03 | I (Information disclosure) | inventing commit hashes for Phase 2-5 (the actual hashes are in git log) | accept | Each new phase block uses `(commits TBD)` placeholder; user can later run `git log --grep "docs(02)" --oneline | head -1` and edit to fill the actual hash |
| T-06-04-04 | E (Elevation of privilege) | mis-tagging a Phase 5 endpoint as ✓ when it has not actually shipped | accept | Read-first step lists the SUMMARY files for each phase to verify shipped status; risk is low since the user has been working through Phase 5 |
</threat_model>

<verification>
- All 22 acceptance criteria pass
- `pnpm format:check` passes
- `git diff --stat STATUS.md` shows ~50-100 line delta
- `git status --porcelain` shows exactly `M STATUS.md`
- No protected file modified
- Critical invariants section is byte-identical to pre-edit (verifiable via `git diff -G "Sentry init"` showing no edits to that line range)
</verification>

<success_criteria>
- 4 new ✅ DONE phase blocks (Phase 2, 3, 4, 5) with the same shape as Phase 0/1
- 🔨 TODO section reduced to Phase 6 (in flight) + Phase 7 (final pass) — M4-M5-M6-M7-M8 explicit roadmap entries removed
- 📚 Earlier scaffold work (M1-M3) archaeology preserved unchanged
- Critical invariants (lines 125-137 of original file) preserved verbatim
- Voice matches existing Phase 0/1 entries
- No errant Express|backend/src refs introduced (the historical "Express 5" + M2 archaeology references stay)
</success_criteria>

<output>
After completion, create `.planning/phases/06-tests-scripts-docker-docs/06-04-SUMMARY.md`:
- File modified: `STATUS.md`
- Line count before/after
- 4 new phase blocks added (verbatim heading + first sentence of each)
- TODO reduction summary (M4-M5-M6-M7-M8 removed; Phase 6 + Phase 7 added)
- Critical invariants byte-identical confirmation (`git diff -G "Sentry init"` empty)
- All 22 acceptance criteria results (PASS/FAIL each)
- Note for the user: commit-hash placeholders `(commits TBD)` can be filled with `git log --grep "docs(0[2-5])" --oneline` when they want
</output>
</content>
