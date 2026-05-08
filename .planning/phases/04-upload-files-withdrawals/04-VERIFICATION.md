---
phase: 04-upload-files-withdrawals
verified: 2026-05-08T22:10:00Z
status: pass
goal_achieved: true
score: 4/4 success criteria verified
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
success_criteria:
  - id: 1
    label: "POST /api/upload magic-byte + MIME gates"
    status: pass
  - id: 2
    label: "GET /api/files/[...key] streaming proxy"
    status: pass
  - id: 3
    label: "POST /api/withdrawals race-free PIN + balance"
    status: pass
  - id: 4
    label: "WITHDRAWAL_BALANCE_CHECK documented + tested"
    status: pass
requirements_coverage:
  - id: UP-01
    plan: 04-02
    status: satisfied
  - id: UP-02
    plan: 04-03
    status: satisfied
  - id: WD-01
    plan: 04-04
    status: satisfied
  - id: WD-02
    plan: 04-04
    status: satisfied
  - id: WD-03
    plan: 04-04
    status: satisfied
  - id: WD-04
    plan: 04-04
    status: satisfied
human_verification:
  - test: "Live R2 PUT smoke (real Cloudflare R2 bucket)"
    expected: "Upload a JPEG via curl with valid R2 creds; row appears in DB; key downloadable via GET /api/files/[...key]"
    why_human: "Wave 1 tests mock the AWS SDK; only a live bucket exercises real signing + virtual-hosted endpoint behavior"
  - test: "Concurrent withdrawal POSTs against real Postgres"
    expected: "Two simultaneous POSTs for same user → exactly 1 PENDING + 1 INSUFFICIENT_BALANCE; pg_advisory_xact_lock visible in pg_locks"
    why_human: "The advisory-lock + Serializable invariant is unit-tested by mocking $transaction options, but the real Postgres lock semantics require a live DB"
  - test: "Minio local-dev override (R2_ENDPOINT)"
    expected: "Set R2_ENDPOINT=http://localhost:9000 + minioadmin creds → upload returns 201; key reachable via GET"
    why_human: "forcePathStyle:!!endpointOverride only matters against a real path-style S3 implementation"
notes:
  - "Full Vitest suite reported by user: 452/452 passing post-merge."
  - "Plan 04-01 RED→GREEN handoff had 3 mock-shape contract issues vs Plan 04-04 route impl, fixed in commit e9364a5 (test-only scaffolding; no route code changed)."
  - "Code review surfaced 3 warnings (tests use `as never`; .env.example carries duplicate WITHDRAWAL_* blocks from Phase 3 + Phase 4 with later-wins on dotenv load; post-commit createNotification catch is silent — no log.warn). All non-blocking; consistent with plan decisions."
---

# Phase 04: Upload, Files, Withdrawals — Verification Report

**Phase Goal (ROADMAP.md):** Users can upload files (magic-byte validated, R2-stored or DB-fallback), retrieve them via proxy, and request withdrawals with race-free balance enforcement.

**Verified:** 2026-05-08T22:10:00Z
**Status:** pass
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| #   | Truth                                                                                                  | Status     | Evidence                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | POST /api/upload — valid JPEG (FF D8 FF) → 201+key; .jpg+PDF magic → 415; non-allowlist MIME → 415   | ✓ VERIFIED | `frontend/src/app/api/upload/route.ts:99-106` invokes `verifyMagicBytes(buf, file.type)` after MIME allowlist gate (line 89-94); RED tests `route.test.ts:104,116` assert MAGIC_BYTE_MISMATCH/INVALID_MIME; **upload tests 9/9 GREEN**                                                  |
| 2   | GET /api/files/[...key] streams from R2; missing key → 404                                            | ✓ VERIFIED | `frontend/src/app/api/files/[...key]/route.ts:118` passes `body` (ReadableStream) directly to `new Response(...)` — no `.transformToByteArray()`; lines 53/65/91/103 emit FILE_NOT_FOUND on missing/owner-mismatch/NoSuchKey; **files tests 6/6 GREEN**                          |
| 3   | POST /api/withdrawals — PIN + balance + advisory lock → exactly 1 PENDING + 1 INSUFFICIENT_BALANCE   | ✓ VERIFIED | `frontend/src/app/api/withdrawals/route.ts:127` `await lockUserTx(tx, auth.user.sub)` is FIRST awaited statement inside `prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })` (line 173); guard returns 8 stable codes; **withdrawals tests 20/20 GREEN** |
| 4   | WITHDRAWAL_BALANCE_CHECK=0 documented with safety warning; default tested                              | ✓ VERIFIED | `.env.example:209-217` carries verbatim `⚠️  FINANCIAL-SAFETY WARNING — DO NOT CASUALLY DISABLE  ⚠️` followed by `WITHDRAWAL_BALANCE_CHECK="1"`; `env-shape.test.ts` tripwire enforces (9/9 GREEN); withdrawals route.test.ts:268,287 cover default + disabled paths             |

**Score:** 4/4 success criteria verified

---

## Required Artifacts

| Artifact                                              | Expected                                                          | Status     | Details                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `frontend/src/lib/server/upload/r2-client.ts`        | Lazy-init S3Client + StorageNotConfiguredError + bucket accessor | ✓ VERIFIED | 108 LOC; `getR2Client/getR2Bucket/__resetR2Singleton` exported; R2_ENDPOINT honored |
| `frontend/src/test-utils/r2-mock.ts`                 | mockR2Client factory                                              | ✓ VERIFIED | Branches by `cmd.constructor.name`; default ETag/ContentLength provided           |
| `frontend/src/test-utils/admin-fixtures.ts`          | seedActiveUserWithPin + seedWithdrawal (extended)                 | ✓ VERIFIED | bcrypt cost 4 (test-speed knob); pure factory pattern (deviation from plan documented) |
| `frontend/.env.example` → `/.env.example` (root)      | UPLOAD_* + R2_* + WITHDRAWAL_* + FINANCIAL-SAFETY warning         | ✓ VERIFIED | Lines 178-217; warning at 211; env-shape.test.ts tripwire enforces                 |
| `frontend/src/app/api/upload/route.ts`                | POST handler — multipart + magic-byte + R2 PUT + DB row          | ✓ VERIFIED | 153 LOC; runtime='nodejs'; randomUUID-based key; all 9 error branches present     |
| `frontend/src/app/api/files/[...key]/route.ts`       | GET catch-all — owner-gated R2 stream proxy                       | ✓ VERIFIED | 120 LOC; runtime='nodejs'; Cache-Control: private,max-age=3600; ETag forwarded   |
| `frontend/src/app/api/withdrawals/route.ts`          | POST + GET — race-free + cursor-paginated own-list                | ✓ VERIFIED | 289 LOC; both POST + GET exported; lockUserTx FIRST inside Serializable tx        |
| 3 RED→GREEN test files                                | 9 + 6 + 20 = 35 scenarios                                         | ✓ VERIFIED | All 35 GREEN per fresh `vitest run` (1.16s)                                        |

---

## Key Link Verification

| From                          | To                                              | Via                                                  | Status   | Details                                                                            |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| upload/route.ts               | upload/sniff.ts                                 | `verifyMagicBytes(buf, file.type)`                   | ✓ WIRED  | route.ts:100 — invoked after MIME allowlist (D-UP-04)                              |
| upload/route.ts               | upload/r2-client.ts                             | `getR2Client() + getR2Bucket()`                      | ✓ WIRED  | route.ts:61-62; StorageNotConfiguredError handled at 64-71 → 503                  |
| upload/route.ts               | prisma.fileUpload                               | `create({ data: { userId, key, filename, ... } })` | ✓ WIRED  | route.ts:130-147 — only after R2 PUT succeeds                                      |
| files/[...key]/route.ts       | prisma.fileUpload                               | `findUnique({ where: { key } })`                     | ✓ WIRED  | route.ts:49-52 — owner gate at 62-67 collapses to 404                              |
| files/[...key]/route.ts       | upload/r2-client.ts                             | `getR2Client + getR2Bucket`                          | ✓ WIRED  | route.ts:71-82                                                                      |
| files/[...key]/route.ts       | Web ReadableStream → Response                   | `new Response(body, { status: 200, headers })`       | ✓ WIRED  | route.ts:118 — no `.transformToByteArray()` (Pitfall 3 verified absent)            |
| withdrawals/route.ts          | withdrawals/lock.ts                             | `lockUserTx(tx, auth.user.sub)` (FIRST in tx)        | ✓ WIRED  | route.ts:127 — first awaited statement inside `$transaction` body                |
| withdrawals/route.ts          | withdrawals/guards.ts                           | `validateWithdrawalRequest({ prisma: tx, ... })`     | ✓ WIRED  | route.ts:134-143 — uses tx (not prisma) so reads share snapshot + lock            |
| withdrawals/route.ts          | Prisma.TransactionIsolationLevel.Serializable   | `$transaction(fn, { isolationLevel })`               | ✓ WIRED  | route.ts:173 — Prisma enum (not string literal)                                    |
| withdrawals/route.ts          | notifications/index.ts                          | `createNotification(prisma, { dedupeKey: 'withdrawal-requested:${id}' })` | ✓ WIRED  | route.ts:189-200 — POST-COMMIT (Pitfall 4); try/catch at 188 + 201               |

---

## Behavioral Spot-Checks

| Behavior                              | Command                                                                                                              | Result                                              | Status |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| Phase 4 route tests pass              | `pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals`                | 35/35 passed in 1.16s                              | ✓ PASS |
| env-shape tripwire still green        | `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts`                              | 9/9 passed                                         | ✓ PASS |
| runtime-enforcement (no regression)   | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts`                    | 35/35 passed (covers all 3 new routes)              | ✓ PASS |
| Full suite (per user note)            | `pnpm test`                                                                                                          | 452/452 passed                                     | ✓ PASS |
| FINANCIAL-SAFETY warning literal      | `grep -c "FINANCIAL-SAFETY WARNING — DO NOT CASUALLY DISABLE" .env.example`                                          | 1 match (line 211)                                  | ✓ PASS |
| `transformToByteArray` absent (Pitfall 3) | `grep -c "transformToByteArray" frontend/src/app/api/files/[...key]/route.ts`                                    | 0 matches                                           | ✓ PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description (REQUIREMENTS.md)                                                                                                                                                  | Status      | Evidence                                                                                                                          |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| UP-01       | 04-02       | POST /api/upload with formData + arrayBuffer + magic-byte validation against UPLOAD_ALLOWED_MIME (no trusting file.mimetype); R2-stored                                       | ✓ SATISFIED | route.ts:73-100 (formData/arrayBuffer/MIME/sniff); route.ts:114-122 (R2 PUT)                                                     |
| UP-02       | 04-03       | GET /api/files/[...key] proxies R2/S3 stream when configured; 404 on missing                                                                                                  | ✓ SATISFIED | route.ts:86-98 (R2 GET + NoSuchKey→404); route.ts:118 (stream pipe). DB-fallback path is documented in plan as deferred (R2 required) |
| WD-01       | 04-04       | POST /api/withdrawals — Serializable Prisma tx + pg_advisory_xact_lock(hashtext(userId)) — race-free                                                                          | ✓ SATISFIED | route.ts:120-174; lockUserTx is first awaited statement (verified by `it('advisory lock')` test)                                  |
| WD-02       | 04-04       | Stable error codes (8 codes); frontend switches on code, never on translated message                                                                                          | ✓ SATISFIED | All 8 codes covered by `it.each(codeTable)` (route.test.ts:196); guards.ts returns `{ code, status, message }`; route forwards verbatim |
| WD-03       | 04-04       | Authenticated user can list their own withdrawals (filtered by user)                                                                                                          | ✓ SATISFIED | route.ts:233-289 GET handler scoped via `where: { userId: auth.user.sub }`; cursor pagination on requestedAt + id              |
| WD-04       | 04-04       | Balance check enabled by default (WITHDRAWAL_BALANCE_CHECK=1); disabling documented as financial-safety risk                                                                   | ✓ SATISFIED | .env.example:209-217 carries warning + default `="1"`; route.ts:116 reads at call-time; tests 268+287 cover both paths           |

**Orphans (REQUIREMENTS.md → Phase 4 mapping):** 6 IDs claimed by plans, 6 mapped to Phase 4 in REQUIREMENTS.md traceability table — no orphans.

---

## Anti-Patterns Found

| File                                          | Line | Pattern                                                | Severity   | Impact                                                                                                       |
| --------------------------------------------- | ---- | ------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------- |
| frontend/src/app/api/withdrawals/route.ts     | 201-205 | Empty `catch {}` swallows createNotification errors    | ℹ️ Info    | Plan accepts this (Pitfall 4 + comment notes "small correctness gap"); reviewer flagged as warning. Consider `log.warn` in a future cleanup phase but non-blocking; dedupeKey makes retries idempotent. |
| .env.example                                   | 80-88 vs 203-217 | Duplicate WITHDRAWAL_* declarations (Phase 3 + Phase 4 blocks; later-wins on dotenv load) | ℹ️ Info    | Documented deviation in 04-01 SUMMARY decisions; env-shape test asserts the Phase 4 values. Consider consolidation in a docs cleanup pass. |
| 3 RED test files                              | various | `as never` casts on Request/Response args              | ℹ️ Info    | Test scaffolding only; reviewer flagged as warning. Non-blocking — type-system limitation around Next.js NextRequest mocks. |

No 🛑 blockers found. All ⚠️/ℹ️ items are explicit plan-level decisions or test-scaffolding concerns.

---

## Human Verification Required

### 1. Live R2 PUT smoke

**Test:** Configure real Cloudflare R2 creds in `.env`, then `curl -X POST -F "file=@photo.jpg" -H "x-csrf-token: $CSRF" -b "app-access=$JWT" http://localhost:3000/api/upload`
**Expected:** 201 + `{ id, key: "<userId>/<uuid>.jpg", ... }`; key downloadable via `GET /api/files/<userId>/<uuid>.jpg`
**Why human:** Wave 1 tests mock the AWS SDK; only a live bucket exercises real SigV4 signing + virtual-hosted endpoint behavior.

### 2. Concurrent withdrawal POSTs against real Postgres

**Test:** Seed user with balance=1000; fire two simultaneous `POST /api/withdrawals { amount: 800 }` via `xargs -P 2`.
**Expected:** Exactly one 201 (PENDING) + one 422 INSUFFICIENT_BALANCE; `SELECT * FROM pg_locks WHERE locktype='advisory'` shows the lock during contention.
**Why human:** Advisory-lock + Serializable invariant is unit-tested by mocking `$transaction` opts, but real Postgres lock semantics + `hashtext(userId)` collision avoidance need a live DB.

### 3. Minio local-dev override (R2_ENDPOINT)

**Test:** `docker compose up -d minio`; set `R2_ENDPOINT=http://localhost:9000` + minioadmin creds; upload + retrieve a JPEG.
**Expected:** 201 on upload; bytes round-trip identically via GET.
**Why human:** `forcePathStyle: !!endpointOverride` only matters against a real path-style S3 implementation; test mocks bypass the SDK transport layer.

---

## Gaps Summary

**No blocking gaps.**

All 4 ROADMAP success criteria verified against the actual codebase. All 6 requirement IDs (UP-01, UP-02, WD-01, WD-02, WD-03, WD-04) are satisfied with concrete file:line evidence. The advisory-lock + Serializable invariant — the financial-safety crux of this phase — is wired correctly: `lockUserTx(tx, auth.user.sub)` at withdrawals/route.ts:127 is the first awaited statement inside `prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })` at line 173.

The 3 ℹ️ info-level findings (empty createNotification catch, duplicate WITHDRAWAL_* env blocks, `as never` test casts) are all documented plan-level decisions or test-scaffolding artifacts; none affect runtime correctness. The 3 HUMAN-UAT items (live R2, concurrent Postgres POSTs, Minio override) match the Phase 1/Phase 3 pattern of deferring real-service smoke tests to dedicated UAT — they are not gaps, they are the documented mock-coverage boundary.

Phase 04 goal is achieved.

---

_Verified: 2026-05-08T22:10:00Z_
_Verifier: Claude (gsd-verifier)_
