# Phase 4: Upload, Files, Withdrawals - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase ships the **money + file path**: authenticated users can (1) upload images, (2) fetch their own files via a proxy, and (3) request withdrawals against a race-free balance check. All three routes consume infrastructure already shipped in earlier phases — `upload/sniff.ts` (Phase 0), `withdrawals/{lock,balance,guards}.ts` (Phase 0 lib port), Phase 2 PIN, Phase 3 admin audit/middleware/Prisma columns.

**In scope:**
- `POST /api/upload` — multipart form upload, magic-byte validated, R2-stored
- `GET /api/files/[...key]` — proxy/stream from R2 with auth gate
- `POST /api/withdrawals` — race-free request with advisory-lock + Serializable tx
- `GET /api/withdrawals` — list user's own withdrawals, paginated
- `.env.example` updates for all new env vars

**Explicitly out of scope (deferred):**
- Public file sharing (signed URLs, opt-in `isPublic` flag) — adds attack surface, not needed for v1
- DB-fallback storage when R2 absent — phase ships 503 instead
- Streaming uploads / chunked / multipart parts > 10 MB — basic single-file flow only
- Withdrawal admin operations (approve/reject) — already shipped Phase 3 (`POST /api/admin/withdrawals/[id]/cancel`)
- Bictorys payout webhook — Phase 5 scope
- Image transformations (resize, format conversion) — out of scope for monolith starter

</domain>

<decisions>
## Implementation Decisions

### Upload Policy (D-UP)

- **D-UP-01:** `UPLOAD_ALLOWED_MIME` default = `image/jpeg,image/png,image/webp` (images only). `sniff.ts` already verifies all three magic-byte signatures. Forks add PDF/video by editing one env var; new MIME types must extend `sniff.ts` SNIFFERS map.
- **D-UP-02:** `UPLOAD_MAX_BYTES` default = `10485760` (10 MB). Vercel Route Handlers can stream past the 4.5 MB body-size limit via `req.formData()` + `File.arrayBuffer()`. Forks needing larger uploads override env.
- **D-UP-03:** When `R2_*` envs are missing → return 503 `{ code: "STORAGE_NOT_CONFIGURED" }`. NO DB fallback. Keeps the `FileUpload` schema clean (no Bytes column), forces real storage in prod, dev forks can spin up Minio (already in `docker-compose.yml`).
- **D-UP-04:** Magic-byte sniff happens AFTER size check, BEFORE any DB write. If `sniff.ts` doesn't have a sniffer for a configured MIME (e.g., user adds `text/csv` to `UPLOAD_ALLOWED_MIME`), log `warn` at boot but allow the upload — the operator opted in to that risk per `sniff.ts` docs.
- **D-UP-05:** Stable error codes for `POST /api/upload`: `STORAGE_NOT_CONFIGURED` (503), `UPLOAD_MISSING_FILE` (400), `FILE_TOO_LARGE` (413), `INVALID_MIME` (415), `MAGIC_BYTE_MISMATCH` (415), `UPLOAD_FAILED` (502 — R2 returned non-2xx). Frontend switches on `code`, not message.

### File Access + Caching (D-FILE)

- **D-FILE-01:** `GET /api/files/[...key]` is **owner-only**. Look up `FileUpload` by key; if `userId` is set and `userId !== auth.user.sub` → 403 `{ code: "FILE_FORBIDDEN" }`. If `userId` is null (anonymous upload) → public-readable. Forks needing public-by-key sharing edit this rule and document the threat model.
- **D-FILE-02:** Cache headers: `Cache-Control: private, max-age=3600`. Browser caches 1 hour, no shared/CDN caches. ETag from R2 response forwarded as-is. Pairs naturally with owner-only access.
- **D-FILE-03:** Stable error codes: `FILE_NOT_FOUND` (404 — key doesn't exist OR userId mismatch leaks nothing about the key), `FILE_FORBIDDEN` (403 — only when route author chooses to distinguish from 404 for an anonymous-upload edge case; default = collapse to 404 to avoid existence enumeration).
- **D-FILE-04:** Streaming response — pipe R2's response body directly to `NextResponse` without buffering. For files at the 10 MB cap this matters for memory bound.

### Withdrawal Destination Methods (D-WD-METHOD) — *defaulted, not discussed*

- **D-WD-METHOD-01:** Default Zod enum for `Withdrawal.destination.method`: `WAVE`, `ORANGE_MONEY`, `MTN_MOMO`. Matches Bictorys' three best-supported west-african rails at v1. Forks extend the enum (add `FREE_MONEY`, `MOOV_MONEY`, `MPESA`, etc.) by editing the schema in one place.
- **D-WD-METHOD-02:** `Withdrawal.destination` shape: `{ method: <enum>, phone: "+221XXXXXXXX" (E.164), accountName?: string }`. Phone validation: regex `^\+\d{10,15}$`. Accountname optional (some providers populate it on payout).

### Withdrawal Env Defaults (D-WD-ENV) — *defaulted, not discussed*

- **D-WD-ENV-01:** `.env.example` defaults:
  - `WITHDRAWAL_MIN_AMOUNT=1000` (≈ 1.50 USD in XOF — meaningful floor)
  - `WITHDRAWAL_MAX_AMOUNT=` (empty = unlimited)
  - `WITHDRAWAL_DAILY_LIMIT=` (empty = unlimited)
  - `WITHDRAWAL_COOLDOWN_HOURS=0` (no cooldown by default)
  - `WITHDRAWAL_REQUIRE_PIN=1` (PIN required by default; gates the route)
  - `WITHDRAWAL_BALANCE_CHECK=1` (check enabled by default)
- **D-WD-ENV-02:** `.env.example` warning block for `WITHDRAWAL_BALANCE_CHECK=0` — prominent multi-line comment with `⚠️ FINANCIAL-SAFETY WARNING ⚠️` header. Verbatim wording in `<specifics>` below.

### Withdrawal Flow (D-WD) — *locked from prior phases / CLAUDE.md / REQUIREMENTS.md*

- **D-WD-01:** `POST /api/withdrawals` runs the FULL guard chain INSIDE a single Prisma `Serializable` transaction wrapped by `lockUserTx(tx, auth.user.sub)`:
  1. Acquire `pg_advisory_xact_lock(hashtext(userId))` — first statement after `BEGIN`
  2. PIN check (if `WITHDRAWAL_REQUIRE_PIN=1`)
  3. Load `WithdrawalGuardConfig` from env (`loadGuardConfigFromEnv`)
  4. Run guards: `AMOUNT_BELOW_MIN` / `AMOUNT_ABOVE_MAX` / `DAILY_LIMIT_EXCEEDED` / `COOLDOWN_ACTIVE`
  5. Compute balance via `BalanceComputer` (default formula in `withdrawals/balance.ts`)
  6. Reject if `INSUFFICIENT_BALANCE`
  7. INSERT `Withdrawal` row with `status='PENDING'`
  8. COMMIT
- **D-WD-02:** `GET /api/withdrawals` — cursor-paginated list, scoped to `userId = auth.user.sub`, ordered by `requestedAt DESC`. Reuse the Phase 3 `paginate.ts` helper.
- **D-WD-03:** Stable error codes (verbatim from REQUIREMENTS.md WD-02): `AMOUNT_BELOW_MIN`, `AMOUNT_ABOVE_MAX`, `DAILY_LIMIT_EXCEEDED`, `COOLDOWN_ACTIVE`, `PIN_NOT_SET`, `PIN_REQUIRED`, `PIN_INVALID`, `INSUFFICIENT_BALANCE`. Each maps to a 4xx HTTP status; frontend switches on `code`.
- **D-WD-04:** Concurrent POST contract — two simultaneous requests for the same userId end with exactly one PENDING row + one `INSUFFICIENT_BALANCE` (per ROADMAP success criterion 3). The advisory lock makes this deterministic.

### Standing Rules (locked from earlier phases)

- **CF-01..11** (carried from Phase 1–3 CONTEXT.md): runtime='nodejs', `verifyCsrf` BEFORE auth, `requireAuth(req)` with `instanceof NextResponse` bail, Zod validation, stable error code response shape, cursor pagination format, `withRequestContext` wrapping, `createNotification` only (never raw `prisma.notification.create`).
- **CF-12 (CLAUDE.md):** All withdrawal mutations MUST call `lockUserTx` inside a `Serializable` Prisma transaction. Never check then write outside the lock.
- **CF-13 (CLAUDE.md):** Upload route enforces magic-byte sniff against `UPLOAD_ALLOWED_MIME` via `sniff.ts`. Never trust `File.type` alone.
- **CF-14 (CLAUDE.md):** Frontend `api()` does NOT auto-retry POST/PUT/PATCH/DELETE. Withdrawal POST especially — duplicate would be a financial bug.

### Claude's Discretion

- Exact Zod schema shapes (route author decides — must match the `code` table above)
- R2 client wrapper (use `@aws-sdk/client-s3` already in deps; convention for retries/timeouts)
- Whether to write a small `frontend/src/lib/server/upload/store.ts` to abstract R2 vs future providers
- Test file organization (one route.test.ts per route; reuse Phase 3 admin-fixtures patterns where useful)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level invariants
- `CLAUDE.md` — Withdrawals advisory-lock invariant, runtime=nodejs invariant, integer-amounts invariant, frontend api() no-retry-on-mutating-verbs, magic-byte upload invariant
- `README.md` — endpoint contract, env vars list
- `.planning/REQUIREMENTS.md` — UP-01, UP-02, WD-01, WD-02, WD-03, WD-04 acceptance criteria
- `.planning/PROJECT.md` — port roadmap and goal

### Existing code agents must read (do NOT modify, call only)
- `frontend/src/lib/server/upload/sniff.ts` — magic-byte sniffer; lists supported MIMEs
- `frontend/src/lib/server/withdrawals/lock.ts` — `lockUserTx`, `TxClient` type
- `frontend/src/lib/server/withdrawals/balance.ts` — `BalanceComputer`, `createDefaultBalanceComputer`
- `frontend/src/lib/server/withdrawals/guards.ts` — `WithdrawalGuardConfig`, `loadGuardConfigFromEnv`, `validateWithdrawal`
- `frontend/src/lib/server/auth/pin.ts` — `verifyPin`, dummy-hash PIN comparison helper (Phase 2)
- `frontend/src/lib/server/middleware/index.ts` — `verifyCsrf`, `requireAuth`
- `frontend/src/lib/server/notifications/cursor.ts` — cursor encode/decode (Phase 2)
- `frontend/src/lib/server/pagination/paginate.ts` — `clampLimit`, `cursorWhere`, `buildPage` (Phase 3 Wave 0)
- `frontend/prisma/schema.prisma` — `FileUpload` (existing — no schema delta needed), `Withdrawal` (existing — destination Json shape)

### Reference UX shapes (do NOT copy into frontend/src/app/)
- `examples/frontend-pages/withdrawals.tsx` — page shape for withdrawals UX

### Prior phase context (for consistency)
- `.planning/phases/01-auth-routes/01-CONTEXT.md` — auth + cookies + CSRF decisions (CF-01..05)
- `.planning/phases/02-oauth-notifications-withdrawal-pin/02-CONTEXT.md` — PIN + notification + cursor decisions (CF-06..09)
- `.planning/phases/03-admin-organizations-orders/03-CONTEXT.md` — admin + paginate helper + error code patterns (CF-10..11)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `upload/sniff.ts` — sniffs jpeg/png/webp from magic bytes; warn-and-pass for un-sniffable MIMEs the operator added
- `withdrawals/lock.ts` — `lockUserTx(tx, userId)` is the ONLY way to acquire the advisory lock; do not write raw SQL
- `withdrawals/balance.ts` — `createDefaultBalanceComputer(prisma)` returns a `BalanceComputer`. Default formula: `sum(PAID Orders.netAmount or amount) − sum(non-cancelled Withdrawals.amount)`. Forks override.
- `withdrawals/guards.ts` — `validateWithdrawal({ tx, userId, amount, pinPlain, config, balanceComputer })` returns `{ ok: true } | { ok: false, status, code, message }`. Plumbs all WD-02 codes.
- `notifications/cursor.ts` + `pagination/paginate.ts` — cursor pagination shape already standardized
- `auth/pin.ts` — `verifyPin(plain, hash)` includes dummy-hash for no-PIN users (timing-safe)
- `@aws-sdk/client-s3` already in `frontend/package.json` deps — used for R2

### Established Patterns
- Mutating route shape: `verifyCsrf → requireAuth → Zod → withRequestContext → handler → response with stable code`
- Cursor pagination shape: `?cursor=base64(JSON({createdAt|requestedAt, id}))&limit=20`
- 503 lazy-init pattern (Phase 3 PaymentProvider singleton): mirror it for R2 — `getR2Client()` returns cached instance OR throws `StorageNotConfiguredError` → handler returns 503
- `loadGuardConfigFromEnv(process.env)` loads `WITHDRAWAL_*` vars at module top of the route file (per-process cache OK; envs don't change at runtime)

### Integration Points
- Webhook handler (`webhook/handler.ts`) is shipped Phase 2; it does NOT touch this phase's routes — Phase 5 will wire `bictorys` webhook to update Withdrawal status from PROCESSING/COMPLETED/FAILED
- Admin routes (Phase 3) read `Withdrawal` rows but don't mutate them outside the cancel route — no conflict with new POST /api/withdrawals
- Notification dispatcher (Phase 2) — Phase 4 should send a notification on successful withdrawal request via `createNotification(prisma, { kind: 'WITHDRAWAL_REQUESTED', userId, payload: { amount, currency } })` (Claude's discretion on whether to ship in this phase or defer)

</code_context>

<specifics>
## Specific Ideas

### Verbatim `.env.example` block for upload policy

```ini
# Upload policy — applied by POST /api/upload
# Comma-separated MIME whitelist. Magic bytes verified by sniff.ts;
# extending this list to a MIME without a sniffer logs a boot warning
# and trusts the client (XSS risk on text-ish formats — your call).
UPLOAD_ALLOWED_MIME="image/jpeg,image/png,image/webp"

# Max single-file size in bytes (10 MB default). Vercel Route Handlers
# can stream past the platform 4.5 MB body limit via req.formData() +
# File.arrayBuffer(), but bigger files = bigger Vercel + R2 bills.
UPLOAD_MAX_BYTES="10485760"

# R2 / S3-compatible storage. Required for /api/upload — route returns
# 503 STORAGE_NOT_CONFIGURED when these are absent (no DB fallback).
# Local dev: bring up `docker compose up -d` and use Minio creds.
R2_ACCOUNT_ID=""
R2_BUCKET=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
```

### Verbatim `.env.example` block for withdrawals

```ini
# Withdrawal policy
WITHDRAWAL_MIN_AMOUNT="1000"          # smallest currency unit; XOF default → ~1.50 USD
WITHDRAWAL_MAX_AMOUNT=""               # empty = unlimited
WITHDRAWAL_DAILY_LIMIT=""              # empty = unlimited (sum of today's amounts)
WITHDRAWAL_COOLDOWN_HOURS="0"          # 0 = no cooldown between requests
WITHDRAWAL_REQUIRE_PIN="1"             # 1 = require x-withdrawal-pin header on POST

# WITHDRAWAL_BALANCE_CHECK
# Default: 1 (balance check enabled — withdrawals must not exceed balance)
# ⚠️  FINANCIAL-SAFETY WARNING — DO NOT CASUALLY DISABLE  ⚠️
# Set to 0 ONLY if you have an alternative ledger that gates withdrawals
# upstream of this route (e.g., your own balance-tracking microservice).
# Disabling on a real-money project = users can withdraw money they don't
# have. This is a compliance regression. Document the alternative ledger
# in your fork's CLAUDE.md or README before flipping this.
WITHDRAWAL_BALANCE_CHECK="1"
```

### Idempotency for POST /api/withdrawals

Mirror Phase 3 `POST /api/orders` pattern: optional `Idempotency-Key` header, stored on `Withdrawal.idempotencyKey String? @unique` (NEW SCHEMA COLUMN — additive, like `Order.idempotencyKey` from Phase 3). Replay returns the prior PENDING row with the same `id`. **This is a recommended add — defer to planner if it expands phase scope too much.**

### Notification on successful withdrawal request

Send `createNotification(prisma, { kind: 'WITHDRAWAL_REQUESTED', userId, payload: { amount, currency } })` inside the same Serializable tx as the INSERT, using the Phase 2 dispatcher pattern. Optional but cheap.

</specifics>

<deferred>
## Deferred Ideas

- **Public file sharing / signed URLs** — `isPublic` flag on FileUpload, or short-lived `?sig=…` URLs. Adds attack surface (URL leak = read access). Defer until a fork actually needs sharing.
- **DB-fallback storage** — Bytes column on FileUpload OR new FileBlob model. Defer indefinitely; refusing-503 is the cleaner contract.
- **Streaming/chunked uploads** — multipart parts > 10 MB, resumable uploads. Phase 5+ if needed.
- **Image transformations** — server-side resize, format conversion. Out of scope for headless monolith.
- **Bictorys payout webhook handler** — Phase 5 (`/api/webhooks/bictorys` already in scope there).
- **Withdrawal idempotency-key column** — Recommended add per `<specifics>`, but adds a migration. Planner can fold it in or defer.
- **Public file route variant** (e.g., `/api/files/public/[...key]`) — adds a second route. Defer until needed.

</deferred>

---

*Phase: 04-upload-files-withdrawals*
*Context gathered: 2026-05-08*
