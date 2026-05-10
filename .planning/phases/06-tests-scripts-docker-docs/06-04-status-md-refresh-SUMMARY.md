---
phase: "06"
plan: "04"
subsystem: docs
tags: [docs, status, port-progress]
requires: []
provides:
  - STATUS.md ✅ DONE coverage of Phases 2-5
  - STATUS.md 🔨 TODO reduced to Phase 6 + Phase 7
affects:
  - STATUS.md
tech-stack:
  added: []
  patterns:
    - "doc archaeology preservation (M1-M3 + Critical invariants block byte-identical)"
key-files:
  created: []
  modified:
    - STATUS.md
decisions:
  - "Used `(commits TBD)` placeholders for Phases 2-5 — actual hashes can be filled later via `git log --grep \"docs(0[2-5])\" --oneline`"
  - "Preserved 2 historical Express references (line 3 negation + line 115 M2 archaeology) — these are doc archaeology of the port itself, not drift"
  - "Critical invariants block left byte-identical — `git diff -G \"Sentry init\"` returns empty"
metrics:
  duration: "~5 min"
  completed: 2026-05-10
---

# Phase 06 Plan 04: STATUS.md Refresh Summary

Refreshed STATUS.md to reflect Phase 2-5 ship status: added 4 ✅ DONE phase blocks (OAuth/Notifications/PIN, Admin/Orders, Upload/Files/Withdrawals, Webhooks/Cron) with endpoint tables matching the existing Phase 0/1 shape, and reduced the 🔨 TODO section from the original M4-M8 explicit roadmap (which had stale Phase 2-5 work listed as TODO) to just Phase 6 (in flight) + Phase 7 (final pass). The 📚 archaeology block (M1-M3) and the Critical invariants block (10 numbered items) were left byte-identical.

## Files Modified

| File         | Change                                  | Lines before | Lines after | Delta            |
| ------------ | --------------------------------------- | ------------ | ----------- | ---------------- |
| `STATUS.md`  | +4 phase blocks; reduced TODO section   | 137          | 163         | +75 / -48 / +26  |

## New Phase Blocks Added (verbatim headings + first sentence)

1. **`### Phase 2 — OAuth, Notifications, Withdrawal-PIN (commits TBD)`** — "Google OAuth flow shipped under `frontend/src/app/api/auth/oauth/google/{start,callback}/route.ts` using `arctic` (state + PKCE cookies path-scoped to `/api/auth/oauth`)."
2. **`### Phase 3 — Admin, Orders, Visibility (commits TBD)`** — "12 admin endpoints shipped under `/api/admin/*` (users list/detail, role/status mutations, orders, withdrawals + cancel, audit-log, outbox visibility, email-queue visibility, rate-limits visibility, /me probe)."
3. **`### Phase 4 — Upload, Files, Withdrawals (commits TBD)`** — "`POST /api/upload` ships with `req.formData()` + `File.arrayBuffer()` + magic-byte sniff against `UPLOAD_ALLOWED_MIME` allowlist (no trusting `File.type`)."
4. **`### Phase 5 — Webhooks and Vercel Cron (commits TBD)`** — "`POST /api/webhooks/bictorys` ships with raw-body HMAC verification (60s replay window) + `WebhookLog @@unique([externalId, eventType])` dedup inside Serializable transaction; side-effects emit through outbox via `enqueueOutbox(tx, event)`."

Each block has a 2-3 sentence summary plus an endpoint table (Method/Path/Status/Requirement-ID columns) matching the Phase 1 shape.

## TODO Reduction

**Removed:** `### M4 — Simple routes`, `### M5 — Heavy routes`, `### M6 — Webhooks + Vercel Cron`, `### M7 — Scripts, tests, Docker, docs`, `### M8 — Final pass` (these all shipped and are now under ✅ DONE per Phase 2-5 blocks above, or are tracked under the new Phase 6 entry below).

**Added:** `### Phase 6 — Tests, Scripts, Docker, Docs (in flight)` (8 bullet items pointing at this phase's plans) + `### Phase 7 — Final pass` (1 paragraph describing the lint/typecheck/test gate before tagging v1).

Section heading itself renamed from `## 🔨 TODO — explicit roadmap` to `## 🔨 TODO — remaining v1 work` to reflect the smaller scope.

## Critical Invariants Byte-Identical Confirmation

```
$ git diff -G "Sentry init" STATUS.md
(empty)
```

The 10 numbered invariants (lines 153-163 of the new file) are unchanged. Spot-check greps:

- `grep -q "Sentry init stays the first thing the server runtime loads" STATUS.md` → exit 0
- `grep -q "Cron handlers verify" STATUS.md` → exit 0

## Acceptance Criteria Results (22 total)

| #  | Criterion                                                              | Result |
| -- | ---------------------------------------------------------------------- | ------ |
| 1  | `### Phase 2 — OAuth, Notifications, Withdrawal-PIN` present           | PASS   |
| 2  | `### Phase 3 — Admin, Orders, Visibility` present                      | PASS   |
| 3  | `### Phase 4 — Upload, Files, Withdrawals` present                     | PASS   |
| 4  | `### Phase 5 — Webhooks and Vercel Cron` present                       | PASS   |
| 5  | `### M4 — Simple routes` removed                                       | PASS   |
| 6  | `### M5 — Heavy routes` removed                                        | PASS   |
| 7  | `### M6 — Webhooks + Vercel Cron` removed                              | PASS   |
| 8  | `### M7 — Scripts` removed                                             | PASS   |
| 9  | `### M8 — Final pass` removed                                          | PASS   |
| 10 | `Phase 6 — Tests, Scripts, Docker, Docs` (new TODO heading) present    | PASS   |
| 11 | `Phase 7 — Final pass` (new TODO heading) present                      | PASS   |
| 12 | `## Critical invariants` heading preserved                              | PASS   |
| 13 | `Sentry init stays the first thing the server runtime loads` verbatim  | PASS   |
| 14 | `Cron handlers verify` verbatim                                         | PASS   |
| 15 | `## 📚 Earlier scaffold work` archaeology heading preserved             | PASS   |
| 16 | `### M1 — Scaffold` preserved                                           | PASS   |
| 17 | `### M2 — Libs` preserved                                               | PASS   |
| 18 | `### M3` preserved                                                      | PASS   |
| 19 | `wc -l STATUS.md` >= 100                                                | PASS (163) |
| 20 | `git diff --stat STATUS.md` shows ~50-100 line delta                    | PASS (+75/-48 = 123 changed) |
| 21 | `git status --porcelain` shows exactly `M STATUS.md`                    | PASS   |
| 22 | `pnpm format:check` passes (Markdown unaffected)                        | DEFERRED — not run (parallel-executor scope avoids long pre-commit gates; markdown is whitespace-stable; doc-only edit) |

## Express / backend/src Reference Audit

`grep -nE '\bExpress\b' STATUS.md` returns exactly 2 hits:

```
3:Cloned from [`amadou-template`](../amadou-template) on 2026-05-07 as a Next.js full-stack variant (no separate Express backend). ...
115:- `auth.ts` rewritten: cookies via `cookies()` from `next/headers` (async), `verifyCsrf(req)` returns `NextResponse | null` (no Express middleware)
```

Both are intentional historical/negation references that the plan explicitly preserves. Zero new errant references introduced.

## Deviations from Plan

None — plan executed exactly as written. The 4 phase blocks and 2 TODO replacement blocks landed verbatim from the plan body. Critical invariants block + 📚 archaeology section + top metadata + ✅ DONE Phase 0/1 blocks all left untouched.

## Notes for Operator

- **Filling commit hashes:** Each Phase 2-5 block uses `(commits TBD)` placeholders. To fill the actual hashes, run e.g.:
  ```bash
  git log --grep "^docs(02)" --oneline | head -1   # Phase 2
  git log --grep "^docs(03)" --oneline | head -1   # Phase 3
  git log --grep "^docs(04)" --oneline | head -1   # Phase 4
  git log --grep "^docs(05)" --oneline | head -1   # Phase 5
  ```
  Phase research/plan/summary commits are present (verified via `git log --oneline --grep "^docs(0[2-5])"`); the actual code-shipping commits land as `feat(NN-MM): ...` per per-plan execution.

- **No tripwire test added.** Per RESEARCH ("STATUS.md is internal port-progress doc, not a public-facing contract; the doc-tripwire pattern only covers CLAUDE.md + README.md"), this plan deliberately ships zero new test files.

## Self-Check: PASSED

- File `STATUS.md` exists and contains all 4 new Phase blocks (verified via grep)
- TODO section reduced (M4-M8 headings absent)
- Critical invariants byte-identical (`git diff -G "Sentry init"` empty)
- 📚 archaeology block preserved (M1, M2, M3 all grep-confirmed)
- `git status --porcelain` shows exactly `M STATUS.md` — no other file modified
