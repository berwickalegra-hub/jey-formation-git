# Phase 4: Upload, Files, Withdrawals - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 04-upload-files-withdrawals
**Areas discussed:** Upload policy (MIME, size, R2 fallback), File access control + caching
**Areas defaulted (not interactively discussed):** Withdrawal destination methods, Withdrawal env defaults + balance-check warning

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Upload policy (MIME, size, R2 fallback) | `UPLOAD_ALLOWED_MIME`, `UPLOAD_MAX_BYTES`, R2-fallback strategy | ✓ |
| File access control + caching | Owner-only vs public; Cache-Control header policy | ✓ |
| Withdrawal destination methods | Default mobile money whitelist for Bictorys | (defaulted) |
| Withdrawal env defaults + balance-check warning | Min/max/daily/cooldown/pin defaults + WITHDRAWAL_BALANCE_CHECK warning tone | (defaulted) |

---

## Upload Policy

### Q1: Default `UPLOAD_ALLOWED_MIME` for new forks?

| Option | Description | Selected |
|--------|-------------|----------|
| Images only (Recommended) | `image/jpeg, image/png, image/webp` — sniff.ts already verifies all 3 | ✓ |
| Images + PDF | Adds `application/pdf` (sniffable) | |
| Images + PDF + video (mp4) | Adds `video/mp4`; needs streaming for big files | |

**User's choice:** Images only (Recommended)

### Q2: Default `UPLOAD_MAX_BYTES`?

| Option | Description | Selected |
|--------|-------------|----------|
| 10 MB (Recommended) | Enough for high-res images + small PDFs; streams past Vercel's 4.5 MB limit | ✓ |
| 5 MB | Conservative, closer to Vercel default | |
| 25 MB | Generous, watch egress + storage bill | |

**User's choice:** 10 MB (Recommended)

### Q3: DB fallback when R2/S3 envs are absent?

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse with 503 (Recommended) | 503 STORAGE_NOT_CONFIGURED; clean schema; forks bring Minio for dev | ✓ |
| Add `body Bytes?` to FileUpload | 1-line schema add; OK for tiny avatars only | |
| New `FileBlob` model | Clean separation but more complex | |

**User's choice:** Refuse with 503 (Recommended)

---

## File Access Control + Caching

### Q1: Who can fetch a file via `GET /api/files/[...key]`?

| Option | Description | Selected |
|--------|-------------|----------|
| Owner-only (Recommended) | Only userId who uploaded can fetch; anonymous uploads = public-readable | ✓ |
| Public-by-key | Anyone with URL can read; relies on cuid being unguessable | |
| Per-row `isPublic` flag | Owner-only by default with shareable opt-in | |

**User's choice:** Owner-only (Recommended)

### Q2: Cache-Control headers for `/api/files/[...key]`?

| Option | Description | Selected |
|--------|-------------|----------|
| private + max-age=3600 (Recommended) | Browser-only cache 1 hour; pairs with owner-only access | ✓ |
| public + immutable + 1y | Aggressive caching; only safe if access is public | |
| no-cache | Always revalidate; safest but costs egress | |

**User's choice:** private + max-age=3600 (Recommended)

---

## Defaulted Areas (not interactively discussed)

### Withdrawal Destination Methods

User chose to skip discussion. Applied recommended defaults:
- **D-WD-METHOD-01:** Default Zod enum = `WAVE`, `ORANGE_MONEY`, `MTN_MOMO` (Bictorys' three best-supported west-african rails). Forks extend the enum to add `FREE_MONEY`, `MOOV_MONEY`, `MPESA`, etc.
- **D-WD-METHOD-02:** `Withdrawal.destination` shape = `{ method: <enum>, phone: "+221XXXXXXXX", accountName?: string }`; phone validated against `^\+\d{10,15}$`.

### Withdrawal Env Defaults + Balance-Check Warning

User chose to skip discussion. Applied recommended defaults:
- **D-WD-ENV-01:** `.env.example` defaults — `WITHDRAWAL_MIN_AMOUNT=1000` (~1.50 USD floor in XOF), `WITHDRAWAL_MAX_AMOUNT=` (unlimited), `WITHDRAWAL_DAILY_LIMIT=` (unlimited), `WITHDRAWAL_COOLDOWN_HOURS=0`, `WITHDRAWAL_REQUIRE_PIN=1`, `WITHDRAWAL_BALANCE_CHECK=1`.
- **D-WD-ENV-02:** Prominent multi-line warning block for `WITHDRAWAL_BALANCE_CHECK=0` with `⚠️ FINANCIAL-SAFETY WARNING ⚠️` header. Verbatim wording captured in `04-CONTEXT.md` `<specifics>`.

---

## Claude's Discretion

- Exact Zod schema shapes per route (must match the documented `code` table)
- R2 client wrapper convention (use `@aws-sdk/client-s3`; cache singleton; lazy-init like Phase 3 PaymentProvider)
- Whether to extract `frontend/src/lib/server/upload/store.ts` for R2 abstraction (planner may decide)
- Test file organization (one `route.test.ts` per route; reuse Phase 3 admin-fixtures patterns)
- Whether to fold the **Withdrawal idempotency-key** column into Phase 4 or defer to a follow-up patch (recommended in `<specifics>` but planner can decide based on phase budget)
- Whether to ship a `WITHDRAWAL_REQUESTED` notification dispatcher call in this phase (cheap, recommended in `<specifics>`)

---

## Deferred Ideas

- Public file sharing / signed URLs / `isPublic` flag — adds attack surface, defer until needed
- DB-fallback storage — chose 503 contract instead; defer indefinitely
- Streaming / chunked / resumable uploads — out of scope for v1
- Server-side image transformations — out of scope for headless monolith
- Bictorys payout webhook handler — Phase 5
- Withdrawal idempotency-key column — recommended but expands scope; planner may defer
- Public file route variant (`/api/files/public/[...key]`) — defer until a fork needs it
