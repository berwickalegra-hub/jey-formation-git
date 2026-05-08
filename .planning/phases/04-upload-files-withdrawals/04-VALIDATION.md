---
phase: 4
slug: upload-files-withdrawals
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 (already configured Phase 0) |
| **Config file** | `frontend/vitest.config.ts` |
| **Quick run command** | `pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals --no-coverage` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~3–5s focused, ~30–60s full suite |

---

## Sampling Rate

- **After every task commit:** Quick run command above
- **After every plan wave:** `pnpm test` (catches cross-phase regression)
- **Before `/gsd-verify-work`:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` all green
- **Max feedback latency:** ~60s

---

## Per-Task Verification Map

> Task IDs assigned by gsd-planner. This map captures the verification command per requirement.

| Req ID | Behavior | Wave | Test Type | Automated Command | File Exists | Status |
|--------|----------|------|-----------|-------------------|-------------|--------|
| UP-01 | Valid JPEG → 201 + `key` persisted to R2 mock | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "valid jpeg uploads"` | ❌ W0 | ⬜ pending |
| UP-01 | `.jpg` filename + PDF magic → 415 `MAGIC_BYTE_MISMATCH` | 1 | unit | `pnpm --filter frontend exec vitest run -t "magic byte mismatch"` | ❌ W0 | ⬜ pending |
| UP-01 | MIME outside `UPLOAD_ALLOWED_MIME` → 415 `INVALID_MIME` | 1 | unit | `pnpm --filter frontend exec vitest run -t "mime not allowed"` | ❌ W0 | ⬜ pending |
| UP-01 | Size > `UPLOAD_MAX_BYTES` → 413 `FILE_TOO_LARGE` | 1 | unit | `pnpm --filter frontend exec vitest run -t "file too large"` | ❌ W0 | ⬜ pending |
| UP-01 | `R2_*` envs missing → 503 `STORAGE_NOT_CONFIGURED` | 1 | unit | `pnpm --filter frontend exec vitest run -t "storage not configured"` | ❌ W0 | ⬜ pending |
| UP-01 | Missing `file` field → 400 `UPLOAD_MISSING_FILE` | 1 | unit | `pnpm --filter frontend exec vitest run -t "missing file"` | ❌ W0 | ⬜ pending |
| UP-01 | R2 `send` throws → 502 `UPLOAD_FAILED` | 1 | unit | `pnpm --filter frontend exec vitest run -t "upload failed"` | ❌ W0 | ⬜ pending |
| UP-01 | No CSRF header → 403 | 1 | unit | `pnpm --filter frontend exec vitest run -t "csrf"` | ❌ W0 | ⬜ pending |
| UP-01 | No auth cookie → 401 | 1 | unit | `pnpm --filter frontend exec vitest run -t "no auth"` | ❌ W0 | ⬜ pending |
| UP-02 | Valid key + matching userId → 200 + streamed body + headers | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/files/[...key]/route.test.ts -t "owner streams"` | ❌ W0 | ⬜ pending |
| UP-02 | Key not in `FileUpload` table → 404 `FILE_NOT_FOUND` | 1 | unit | `pnpm --filter frontend exec vitest run -t "missing"` | ❌ W0 | ⬜ pending |
| UP-02 | Owner mismatch → 404 `FILE_NOT_FOUND` (no enumeration) | 1 | unit | `pnpm --filter frontend exec vitest run -t "owner mismatch"` | ❌ W0 | ⬜ pending |
| UP-02 | `R2_*` envs missing → 503 | 1 | unit | `pnpm --filter frontend exec vitest run -t "storage not configured"` | ❌ W0 | ⬜ pending |
| UP-02 | R2 `NoSuchKey` → 404 | 1 | unit | `pnpm --filter frontend exec vitest run -t "r2 nosuch"` | ❌ W0 | ⬜ pending |
| UP-02 | Anonymous-uploaded row (`userId` null) → public-readable | 1 | unit | `pnpm --filter frontend exec vitest run -t "anonymous"` | ❌ W0 | ⬜ pending |
| WD-01 | Happy path: PIN set + sufficient balance → 201 + PENDING row | 1 | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "happy path"` | ❌ W0 | ⬜ pending |
| WD-01 | Route opens Serializable tx and calls `lockUserTx` (assert via spy) | 1 | unit | `pnpm --filter frontend exec vitest run -t "advisory lock"` | ❌ W0 | ⬜ pending |
| WD-01 | Live: 2 concurrent POSTs → 1 PENDING + 1 INSUFFICIENT_BALANCE | 1 | manual-only | live-stack UAT (real Postgres) | manual-only | ⬜ pending |
| WD-02 | All 8 stable codes returned with correct status (table-driven) | 1 | unit | `pnpm --filter frontend exec vitest run -t "error codes"` | ❌ W0 | ⬜ pending |
| WD-02 | Invalid body (missing amount, bad phone, bad enum) → 400 | 1 | unit | `pnpm --filter frontend exec vitest run -t "invalid body"` | ❌ W0 | ⬜ pending |
| WD-02 | No CSRF / no auth → 403 / 401 | 1 | unit | `pnpm --filter frontend exec vitest run -t "csrf|auth"` | ❌ W0 | ⬜ pending |
| WD-03 | GET returns user's own withdrawals only, ordered `requestedAt DESC` | 1 | unit | `pnpm --filter frontend exec vitest run -t "GET own"` | ❌ W0 | ⬜ pending |
| WD-03 | Cursor pagination: limit + nextCursor null on last page | 1 | unit | `pnpm --filter frontend exec vitest run -t "GET cursor"` | ❌ W0 | ⬜ pending |
| WD-03 | GET scoped: user A request returns 0 of user B's withdrawals | 1 | unit | `pnpm --filter frontend exec vitest run -t "GET isolation"` | ❌ W0 | ⬜ pending |
| WD-04 | `BALANCE_CHECK=1` (default): excessive amount → `INSUFFICIENT_BALANCE` | 1 | unit | `pnpm --filter frontend exec vitest run -t "balance check default"` | ❌ W0 | ⬜ pending |
| WD-04 | `BALANCE_CHECK=0`: same excessive amount → 201 (skipped) | 1 | unit | `pnpm --filter frontend exec vitest run -t "balance check disabled"` | ❌ W0 | ⬜ pending |
| WD-04 | `.env.example` contains FINANCIAL-SAFETY warning verbatim | 0 | unit/static | `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts -t "withdrawal balance check warning"` | ❌ W0 (extend) | ⬜ pending |
| (runtime invariant) | Every new route exports `runtime='nodejs'` | 0 | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test scaffolding to create or extend in Wave 0:

- [ ] `frontend/src/app/api/upload/route.test.ts` — covers UP-01 (≥9 cases per matrix above)
- [ ] `frontend/src/app/api/files/[...key]/route.test.ts` — covers UP-02 (≥6 cases)
- [ ] `frontend/src/app/api/withdrawals/route.test.ts` — covers WD-01..04 (≥10 cases including table-driven 8-codes test)
- [ ] `frontend/src/test-utils/r2-mock.ts` — `mockR2Client({ onPut?, onGet? })` factory for `@aws-sdk/client-s3` `S3Client` (vi.fn-backed `send()` returning typed responses; supports `NoSuchKey` throw simulation)
- [ ] `frontend/src/test-utils/withdrawal-fixtures.ts` (or extend `admin-fixtures.ts`) — `seedWithdrawal({ userId, amount, status, requestedAt })`, `seedActiveUserWithPin(plainPin)`
- [ ] `frontend/src/lib/server/upload/r2-client.ts` — lazy-init module mirroring `payments/provider-singleton.ts`: `getR2Client()` returns cached `S3Client` OR throws `StorageNotConfiguredError` when any of `R2_ACCOUNT_ID|R2_BUCKET|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY` missing
- [ ] `frontend/.env.example` — append upload + withdrawal blocks (verbatim from CONTEXT.md `<specifics>`)
- [ ] `frontend/src/lib/server/observability/env-shape.test.ts` — extend with assertion that `.env.example` contains the FINANCIAL-SAFETY warning string + WITHDRAWAL_BALANCE_CHECK key

Framework install: **none** — Vitest already configured from Phase 0.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real R2 PUT/GET roundtrip with sandbox creds | UP-01, UP-02 | Live API call requires R2 / Minio + creds; not part of unit suite | (1) `docker compose up -d` (Minio); (2) Set `R2_*` envs to Minio creds; (3) `curl -F file=@avatar.jpg http://localhost:3000/api/upload -H "x-csrf-token: $CSRF" --cookie "$COOKIES"` → 201 + key; (4) `curl http://localhost:3000/api/files/$KEY --cookie "$COOKIES"` → 200 + bytes match |
| 2 concurrent POST /api/withdrawals → 1 PENDING + 1 INSUFFICIENT_BALANCE | WD-01, WD-04 | Advisory-lock + Serializable tx behavior under real concurrency only verifiable against real Postgres (not the mocked Prisma client used in unit tests) | (1) Ensure local Postgres running; (2) Seed user with PIN + balance=1500 (1 successful order); (3) Run 2 concurrent `curl -X POST /api/withdrawals -d '{"amount":1000,...}'` (via `& wait` or `xargs -P 2`); (4) Assert: HTTP 201 + HTTP 422; (5) Query `SELECT count(*) FROM "Withdrawal" WHERE "userId"=...` → exactly 1 |
| `WITHDRAWAL_BALANCE_CHECK=0` smoke against real DB | WD-04 | Unit test mocks env, but operator must verify the .env.example warning is conspicuous in the actual file | (1) Read `frontend/.env.example`; (2) Confirm the multi-line `⚠️ FINANCIAL-SAFETY WARNING ⚠️` block is present and visually obvious; (3) Set `WITHDRAWAL_BALANCE_CHECK=0` in `.env`; (4) POST a withdrawal exceeding the user's balance → 201 (route skipped the check, as intended) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (3 new test files + 2 fixture files + 1 lib file + .env.example block + env-shape extension)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
