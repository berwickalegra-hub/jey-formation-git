# Phase 4: Upload, Files, Withdrawals - Research

**Researched:** 2026-05-08
**Domain:** Multipart uploads (R2/S3-compatible), authenticated file proxy/streaming, race-free financial withdrawals
**Confidence:** HIGH

## Summary

Phase 4 ships three Route Handlers that close out the user-facing surface: `POST /api/upload`, `GET /api/files/[...key]`, and a `withdrawals` route file that handles both `GET` (list) and `POST` (create). All three sit on top of existing battle-tested helpers — `upload/sniff.ts`, `withdrawals/{lock,balance,guards}.ts`, `auth/pin.ts`, `notifications/cursor.ts`, and `pagination/paginate.ts`. The infrastructure work was done across Phases 0–3; this phase is almost entirely **route-level glue plus an R2 client wrapper**.

The three things that demand careful research: (1) **Next.js 16 App Router multipart parsing** — `req.formData()` + `File.arrayBuffer()` replaces multer cleanly but has a memory profile that matters at the 10 MB cap; (2) **R2 streaming** — `GetObjectCommand`'s `Body` is now a Web `ReadableStream` (since `@aws-sdk/client-s3` v3.0+ on Node 18+) and can pipe directly into `NextResponse` with zero buffering; (3) **the withdrawal POST flow** is fully specified in CONTEXT.md but the **PIN delivery channel** is genuinely contested — `examples/frontend-pages/withdrawals.tsx` sends PIN in body, CONTEXT.md `<specifics>` mentions an `x-withdrawal-pin` header. We recommend body-only (matches the example, matches Phase 2 PIN routes, simpler CSRF model). Phase 3's `paginate.ts` `cursorWhere`/`buildPage` target `createdAt` — the existing `admin/withdrawals/route.ts` shows a verbatim inlined fragment for `requestedAt` which we mirror.

**Primary recommendation:** Single Wave-1 plan can ship all four routes (`upload`, `files/[...key]`, `withdrawals` GET+POST in one file) plus an R2 client singleton at `frontend/src/lib/server/upload/r2-client.ts`. **Do not** add `Withdrawal.idempotencyKey` in this phase — it requires a migration and the advisory-lock already prevents the racy double-spend that idempotency keys protect against; defer to a follow-up patch as CONTEXT.md `<specifics>` explicitly permits. Ship the `WITHDRAWAL_REQUESTED` notification — it's two lines and the dispatcher already exists.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Upload Policy (D-UP)**
- **D-UP-01:** `UPLOAD_ALLOWED_MIME` default = `image/jpeg,image/png,image/webp` (images only). Forks add types by editing the env var; new MIME types must extend `sniff.ts` SNIFFERS map.
- **D-UP-02:** `UPLOAD_MAX_BYTES` default = `10485760` (10 MB). Vercel Route Handlers stream past the 4.5 MB body limit via `req.formData()` + `File.arrayBuffer()`.
- **D-UP-03:** When `R2_*` envs are missing → return 503 `{ code: "STORAGE_NOT_CONFIGURED" }`. **NO DB fallback.** Schema stays clean (no Bytes column); forks bring Minio for dev.
- **D-UP-04:** Magic-byte sniff happens **AFTER** size check, **BEFORE** any DB write. If `sniff.ts` doesn't have a sniffer for an operator-configured MIME (e.g., `text/csv` added by fork), log `warn` at boot but allow the upload.
- **D-UP-05:** Stable error codes for `POST /api/upload`: `STORAGE_NOT_CONFIGURED` (503), `UPLOAD_MISSING_FILE` (400), `FILE_TOO_LARGE` (413), `INVALID_MIME` (415), `MAGIC_BYTE_MISMATCH` (415), `UPLOAD_FAILED` (502). Frontend switches on `code`.

**File Access + Caching (D-FILE)**
- **D-FILE-01:** `GET /api/files/[...key]` is **owner-only**. If `FileUpload.userId` is set and `userId !== auth.user.sub` → 404 (collapsed from 403, no enumeration). If `userId` is null (anonymous upload) → public-readable.
- **D-FILE-02:** Cache headers: `Cache-Control: private, max-age=3600`. ETag from R2 response forwarded as-is.
- **D-FILE-03:** Stable error codes: `FILE_NOT_FOUND` (404 — covers both "key doesn't exist" and "userId mismatch" by default).
- **D-FILE-04:** **Stream R2 response body directly to NextResponse** without buffering — at 10 MB cap, buffering matters for memory.

**Withdrawal Destination Methods (D-WD-METHOD)**
- **D-WD-METHOD-01:** Default Zod enum: `WAVE` | `ORANGE_MONEY` | `MTN_MOMO`. Forks extend.
- **D-WD-METHOD-02:** `Withdrawal.destination` shape: `{ method: <enum>, phone: "+221XXXXXXXX" (E.164), accountName?: string }`. Phone regex: `^\+\d{10,15}$`.

**Withdrawal Env Defaults (D-WD-ENV)**
- **D-WD-ENV-01:** `.env.example` defaults — `WITHDRAWAL_MIN_AMOUNT=1000`, `WITHDRAWAL_MAX_AMOUNT=` (unlimited), `WITHDRAWAL_DAILY_LIMIT=` (unlimited), `WITHDRAWAL_COOLDOWN_HOURS=0`, `WITHDRAWAL_REQUIRE_PIN=1`, `WITHDRAWAL_BALANCE_CHECK=1`.
- **D-WD-ENV-02:** `.env.example` MUST include the verbatim multi-line warning block for `WITHDRAWAL_BALANCE_CHECK=0` with the `⚠️ FINANCIAL-SAFETY WARNING ⚠️` header (text fixed in CONTEXT.md `<specifics>`).

**Withdrawal Flow (D-WD)**
- **D-WD-01:** `POST /api/withdrawals` runs the FULL guard chain INSIDE a single Prisma `Serializable` transaction wrapped by `lockUserTx(tx, auth.user.sub)`:
  1. Acquire `pg_advisory_xact_lock(hashtext(userId))` (first statement after BEGIN)
  2. PIN check (if `WITHDRAWAL_REQUIRE_PIN=1`)
  3. Load `WithdrawalGuardConfig` from env
  4. Run guards: `AMOUNT_BELOW_MIN` / `AMOUNT_ABOVE_MAX` / `DAILY_LIMIT_EXCEEDED` / `COOLDOWN_ACTIVE`
  5. Compute balance via `BalanceComputer`
  6. Reject if `INSUFFICIENT_BALANCE`
  7. INSERT `Withdrawal` row with `status='PENDING'`
  8. COMMIT
- **D-WD-02:** `GET /api/withdrawals` — cursor-paginated, scoped to `userId = auth.user.sub`, ordered by `requestedAt DESC, id DESC`. Reuse Phase 3 `paginate.ts` (with the inlined `requestedAt` fragment from `admin/withdrawals/route.ts`).
- **D-WD-03:** Stable error codes (verbatim REQUIREMENTS.md WD-02): `AMOUNT_BELOW_MIN` (422), `AMOUNT_ABOVE_MAX` (422), `DAILY_LIMIT_EXCEEDED` (422), `COOLDOWN_ACTIVE` (422), `PIN_NOT_SET` (403), `PIN_REQUIRED` (403), `PIN_INVALID` (403), `INSUFFICIENT_BALANCE` (422). Frontend switches on `code`.
- **D-WD-04:** Two simultaneous POSTs for the same userId ⇒ exactly one PENDING + one `INSUFFICIENT_BALANCE`.

**Carried-forward standing rules (CF-01..14):**
- Every Route Handler MUST `export const runtime = 'nodejs'`.
- `verifyCsrf(req)` BEFORE `requireAuth()`. Both bail with `if (X instanceof NextResponse) return X`.
- Withdrawals MUST use `lockUserTx` inside `Serializable` Prisma tx. Never check-then-write outside the lock.
- Upload route enforces magic-byte sniff via `sniff.ts`. Never trust `File.type` alone.
- `createNotification(prisma, input)` only — never raw `prisma.notification.create`.

### Claude's Discretion

- Exact Zod schema shapes per route (must produce the documented `code` table).
- R2 client wrapper convention — **use `@aws-sdk/client-s3` 3.1044.0 already in deps**; cache singleton; lazy-init like `payments/provider-singleton.ts`.
- Whether to extract `frontend/src/lib/server/upload/store.ts` for R2 abstraction (planner may decide).
- Test file organization — one `route.test.ts` per route; reuse `test-utils/admin-fixtures.ts` and `test-utils/prisma-mock.ts`.
- Whether to add `Withdrawal.idempotencyKey` column (recommended in CONTEXT.md but expands scope; planner can defer).
- Whether to ship `WITHDRAWAL_REQUESTED` notification dispatcher in this phase (cheap, recommended).

### Deferred Ideas (OUT OF SCOPE)

- Public file sharing / signed URLs / `isPublic` flag on FileUpload — adds attack surface, not needed for v1.
- DB-fallback storage (Bytes column or `FileBlob` model) — chose 503 contract instead.
- Streaming/chunked/resumable uploads (multipart > 10 MB) — Phase 5+ if needed.
- Server-side image transformations (resize, format conversion) — out of scope for headless monolith.
- Bictorys payout webhook handler — Phase 5 scope.
- Withdrawal admin operations (approve/reject) — already shipped Phase 3 (`POST /api/admin/withdrawals/[id]/cancel`).
- Public file route variant (`/api/files/public/[...key]`) — defer until needed.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UP-01 | Authenticated user uploads via `POST /api/upload`; magic-byte validation against `UPLOAD_ALLOWED_MIME`; stored in R2 (or 503 when not configured per D-UP-03) | `verifyMagicBytes` in `sniff.ts` (existing); `req.formData()` + `File.arrayBuffer()` pattern (Pattern 1); R2 lazy-init singleton (Pattern 2) |
| UP-02 | `GET /api/files/[...key]` proxies R2/S3 stream when configured; 404 for missing/forbidden keys | `GetObjectCommand` Body is Web `ReadableStream` since AWS SDK v3 — pipes into `NextResponse` (Pattern 3); `NoSuchKey` typed error catch |
| WD-01 | `POST /api/withdrawals` runs guards + insert inside Serializable tx + advisory lock; race-free | `lockUserTx` (existing); `validateWithdrawalRequest` (existing); 8-step flow specified in D-WD-01 |
| WD-02 | Stable error codes; frontend switches on `code` not message | All 8 codes already returned by `validateWithdrawalRequest` in `guards.ts` (verified line 67-167) |
| WD-03 | `GET /api/withdrawals` lists user's own withdrawals, paginated | Cursor pattern from `admin/withdrawals/route.ts` (verified — handles `requestedAt` instead of `createdAt`) |
| WD-04 | `WITHDRAWAL_BALANCE_CHECK=0` documented as financial-safety risk; default enabled | `loadGuardConfigFromEnv` (existing — line 28: `env.WITHDRAWAL_BALANCE_CHECK !== '0' && !== 'false'`); `.env.example` block specified in D-WD-ENV-02 |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-s3` | `3.1044.0` (installed) | R2/S3-compatible upload + download | Already in deps; R2 advertises S3 API compatibility; Body is now Web ReadableStream → pipes into NextResponse `[VERIFIED: pnpm list]` |
| `next` (App Router) | `16.1.6` | `req.formData()` + `File.arrayBuffer()` | Replaces multer; native multipart support `[VERIFIED: package.json]` |
| `zod` | `3.23.8` | Body validation for POST `/api/withdrawals`; query param parsing | Already standardized in Phase 1–3 `[VERIFIED: package.json]` |
| `@prisma/client` | `5.22.0` | `$transaction({ isolationLevel: 'Serializable' })` for race-free withdrawal | Existing — used by Phase 3 orders route `[VERIFIED: package.json]` |
| `bcryptjs` | `2.4.3` | PIN comparison via `verifyPin(plain, hash)` | Existing helper in `auth/pin.ts` `[VERIFIED: package.json]` |

### Supporting (existing — call only, do NOT modify)
| Library / Module | Purpose | When to Use |
|------------------|---------|-------------|
| `lib/server/upload/sniff.ts` | `verifyMagicBytes(buf, mime)` — magic-byte check | After size check, before DB write. Returns `{ match, sniffed }`. |
| `lib/server/withdrawals/lock.ts` | `lockUserTx(tx, userId)` — pg_advisory_xact_lock | First statement inside the Serializable tx. |
| `lib/server/withdrawals/balance.ts` | `createDefaultBalanceComputer(prisma)` — balance formula | Pass result into `validateWithdrawalRequest`. |
| `lib/server/withdrawals/guards.ts` | `validateWithdrawalRequest({...})` — runs all 8 guard checks | Inside the tx, AFTER lock acquisition. **Note: actual export is `validateWithdrawalRequest`, not `validateWithdrawal`.** `[VERIFIED: code read]` |
| `lib/server/auth/pin.ts` | `verifyPin(plain, hash)` — bcrypt-compare | Inside `validateWithdrawalRequest` via `bcryptCompare` adapter param. |
| `lib/server/auth.ts` | `verifyCsrf(req)` — exported from auth.ts (NOT middleware/index.ts) | First call in every mutating handler. `[VERIFIED: grep]` |
| `lib/server/middleware/index.ts` | `requireAuth(authHeader?)` | Second call after CSRF. Returns `AuthContext \| NextResponse`. |
| `lib/server/notifications/cursor.ts` | `decodeCursor` / `encodeCursor` | Re-exported via `pagination/paginate.ts`. |
| `lib/server/pagination/paginate.ts` | `clampLimit` + cursor codec re-exports | For `GET /api/withdrawals`; **`cursorWhere`/`buildPage` use `createdAt` — inline the equivalent for `requestedAt` (mirror `admin/withdrawals/route.ts:80-101`)**. |
| `lib/server/notifications/index.ts` | `createNotification(prisma, input)` | For `WITHDRAWAL_REQUESTED` notification. **Note: takes `PrismaClient`, not `TxClient`** — call OUTSIDE the Serializable tx (right after commit) OR call with the tx client cast and accept that the dedupe-key insert participates in the tx (recommended — see Pitfall 4). `[VERIFIED: code read]` |
| `lib/server/observability/request-context.ts` | `makeRequestContext` + `withRequestContext` | Wrap every handler body. |
| `lib/server/middleware/rate-limit-by-userid.ts` | `enforceAdminRateLimit` (admin only) | NOT used here — withdrawal/upload routes don't have a per-userId limiter yet; defer (out of scope per CONTEXT.md). |
| `lib/server/prisma.ts` | `prisma` (singleton) | Standard Phase 3 pattern. |
| `test-utils/admin-fixtures.ts` | `seedActiveUser` etc. | Reuse for Phase 4 tests; the `User` factory already includes `withdrawalPinHash: null` (line 43). `[VERIFIED: code read]` |
| `test-utils/prisma-mock.ts` | `mockDeep<PrismaClient>()` | All route tests run against mock — no real DB. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@aws-sdk/client-s3` | `aws4fetch` (lighter, edge-compatible) | Smaller bundle, but we're nodejs-runtime only; SDK already installed; SDK has better R2 ergonomics. Stick with SDK. |
| `req.formData()` | `busboy` (streaming multipart parser) | `formData()` buffers into memory; busboy streams. **At 10 MB cap, buffering is acceptable** (Vercel Node fn memory is 1024 MB default). For v2 if streaming uploads are added, swap. |
| Single `withdrawals/route.ts` (GET+POST) | Two files (`route.ts` + `[id]/route.ts`) | Next.js supports multiple methods per file; matches `admin/withdrawals/route.ts` shape; simpler. |
| Adding `Withdrawal.idempotencyKey` column now | Defer to a follow-up patch | Advisory lock already prevents the racy double-submit class. Idempotency keys protect against client-retry scenarios — but the frontend `api()` wrapper does NOT retry POSTs (CF-14). Defer. |

**Installation:** No new packages required. All deps already in `frontend/package.json`. `[VERIFIED: package.json read]`

**Version verification:**
- `@aws-sdk/client-s3` declared `^3.1037.0`, installed `3.1044.0` (latest patch, May 2026 release)
- `next` `16.1.6`, `zod` `3.23.8`, `@prisma/client` `5.22.0` — all verified via `pnpm --filter frontend list`

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/
├── app/api/
│   ├── upload/route.ts                  # NEW — POST (multipart form upload)
│   ├── files/[...key]/route.ts          # NEW — GET (R2 stream proxy)
│   └── withdrawals/route.ts             # NEW — GET (list) + POST (create)
├── lib/server/
│   ├── upload/
│   │   ├── sniff.ts                     # EXISTING (do not modify)
│   │   ├── r2-client.ts                 # NEW — lazy-init singleton + StorageNotConfiguredError
│   │   └── store.ts                     # OPTIONAL — abstraction over R2 (planner decision)
│   └── withdrawals/
│       ├── lock.ts                      # EXISTING (do not modify)
│       ├── balance.ts                   # EXISTING (do not modify)
│       └── guards.ts                    # EXISTING (do not modify)
└── ...
```

### Pattern 1: Multipart upload via `req.formData()` (Next.js 16 App Router)

**What:** Native Next.js 16 multipart parsing — replaces multer.
**When to use:** All single-file uploads up to 10 MB (the configured cap). For >10 MB or chunked, use a streaming parser (out of scope).

```typescript
// app/api/upload/route.ts
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { verifyMagicBytes } from '@/lib/server/upload/sniff';
import { getR2Client, StorageNotConfiguredError, R2_BUCKET } from '@/lib/server/upload/r2-client';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { randomUUID } from 'node:crypto';

const ALLOWED_MIME = (process.env.UPLOAD_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_BYTES = Number.parseInt(process.env.UPLOAD_MAX_BYTES ?? '10485760', 10);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    let r2;
    try { r2 = getR2Client(); }
    catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        return NextResponse.json({ code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' }, { status: 503 });
      }
      throw e;
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ code: 'UPLOAD_MISSING_FILE', message: 'file field is required' }, { status: 400 });
    }

    // 1. Size check (BEFORE buffering the bytes)
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { code: 'FILE_TOO_LARGE', message: `Max ${MAX_BYTES} bytes` },
        { status: 413 },
      );
    }

    // 2. MIME allowlist (against the env-configured set; case-sensitive — matches sniff.ts)
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { code: 'INVALID_MIME', message: `MIME ${file.type} not allowed` },
        { status: 415 },
      );
    }

    // 3. Magic-byte sniff (read bytes only AFTER size+MIME pass — D-UP-04)
    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const { match, sniffed } = verifyMagicBytes(buf, file.type);
    if (sniffed && !match) {
      return NextResponse.json(
        { code: 'MAGIC_BYTE_MISMATCH', message: 'File bytes do not match declared MIME' },
        { status: 415 },
      );
    }

    // 4. R2 PUT
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
    const key = `${auth.user.sub}/${randomUUID()}.${ext}`;
    try {
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buf,
        ContentType: file.type,
        ContentLength: file.size,
      }));
    } catch {
      return NextResponse.json({ code: 'UPLOAD_FAILED', message: 'Storage write failed' }, { status: 502 });
    }

    // 5. DB record
    const row = await prisma.fileUpload.create({
      data: {
        userId: auth.user.sub,
        key,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      },
      select: { id: true, key: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
    });

    return NextResponse.json(row, { status: 201, headers: { 'x-request-id': ctx.requestId } });
  });
}
```

`[VERIFIED: Next.js 16 docs — App Router formData() pattern; sniff.ts API matches existing module read]`

### Pattern 2: R2 client lazy-init singleton (mirrors `payments/provider-singleton.ts`)

**What:** Cached `S3Client` configured for Cloudflare R2; throws typed error when env missing.
**When to use:** Every R2 operation in `/api/upload` and `/api/files/[...key]`.

```typescript
// lib/server/upload/r2-client.ts
import 'server-only';
import { S3Client } from '@aws-sdk/client-s3';

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('Storage not configured (R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY missing or empty)');
    this.name = 'StorageNotConfiguredError';
  }
}

let _client: S3Client | null = null;
let _bucket: string | null = null;

export function getR2Client(): S3Client {
  if (_client) return _client;

  const accountId = process.env.R2_ACCOUNT_ID ?? '';
  const bucket = process.env.R2_BUCKET ?? '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageNotConfiguredError();
  }

  _client = new S3Client({
    region: 'auto', // R2 ignores region; 'auto' is canonical
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false, // R2 supports virtual-hosted-style; default is fine
  });
  _bucket = bucket;
  return _client;
}

export function getR2Bucket(): string {
  if (!_bucket) getR2Client(); // initialize side-effect
  return _bucket!;
}

export const R2_BUCKET = new Proxy({} as { value: string }, {
  get: () => getR2Bucket(),
}).value; // alternative: just call getR2Bucket() at use sites — simpler, recommend that

/** Test-only escape hatch — clears cached client. @internal */
export function __resetR2Singleton(): void {
  _client = null;
  _bucket = null;
}
```

**Simpler call-site form (recommended over the Proxy):**
```typescript
const r2 = getR2Client();
const bucket = getR2Bucket();
await r2.send(new PutObjectCommand({ Bucket: bucket, Key: ... }));
```

**Why this shape:** Mirrors `payments/provider-singleton.ts:46-71` verbatim — same lazy-init, same typed `*NotConfiguredError`, same `__reset*` test escape hatch (verified pattern). `[VERIFIED: code read]`

### Pattern 3: R2 streaming proxy with ETag forwarding

**What:** Pipe `GetObjectCommand` Body (Web `ReadableStream`) directly into `NextResponse` — zero buffering.
**When to use:** `GET /api/files/[...key]`.

```typescript
// app/api/files/[...key]/route.ts
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import { requireAuth } from '@/lib/server/middleware';
import { getR2Client, getR2Bucket, StorageNotConfiguredError } from '@/lib/server/upload/r2-client';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth(); // GET — no CSRF
    if (auth instanceof NextResponse) return auth;

    const { key: keyParts } = await params;
    const key = keyParts.join('/');

    // Look up FileUpload row first — gates owner-only access (D-FILE-01) and
    // gives us 404 for missing keys without doing an R2 round-trip.
    const row = await prisma.fileUpload.findUnique({
      where: { key },
      select: { userId: true, mimeType: true, filename: true },
    });
    if (!row) {
      return NextResponse.json({ code: 'FILE_NOT_FOUND' }, { status: 404 });
    }
    // Owner-only — collapse 403 to 404 to avoid existence enumeration (D-FILE-03)
    if (row.userId && row.userId !== auth.user.sub) {
      return NextResponse.json({ code: 'FILE_NOT_FOUND' }, { status: 404 });
    }

    let r2;
    try { r2 = getR2Client(); }
    catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        return NextResponse.json({ code: 'STORAGE_NOT_CONFIGURED' }, { status: 503 });
      }
      throw e;
    }

    let res;
    try {
      res = await r2.send(new GetObjectCommand({ Bucket: getR2Bucket(), Key: key }));
    } catch (e) {
      if (e instanceof NoSuchKey) {
        return NextResponse.json({ code: 'FILE_NOT_FOUND' }, { status: 404 });
      }
      throw e;
    }

    // res.Body is a Web ReadableStream in @aws-sdk v3 on Node 18+ —
    // pipe directly into Response without buffering (D-FILE-04).
    const body = res.Body as ReadableStream<Uint8Array> | null;
    if (!body) {
      return NextResponse.json({ code: 'FILE_NOT_FOUND' }, { status: 404 });
    }

    const headers = new Headers({
      'Content-Type': row.mimeType,
      'Cache-Control': 'private, max-age=3600',          // D-FILE-02
      'x-request-id': ctx.requestId,
    });
    if (res.ETag) headers.set('ETag', res.ETag);          // forward ETag as-is
    if (res.ContentLength != null) headers.set('Content-Length', String(res.ContentLength));

    return new Response(body, { status: 200, headers });
  });
}
```

`[VERIFIED: @aws-sdk/client-s3 3.1044.0 exports `NoSuchKey` as a class; `Body` is `StreamingBlobPayloadOutputTypes` which on Node 18+ is `ReadableStream` per AWS SDK changelog]`

### Pattern 4: Withdrawal POST — Serializable tx + advisory lock + full guard chain (D-WD-01)

**What:** Race-free withdrawal request. The 8-step flow specified verbatim in CONTEXT.md.
**When to use:** `POST /api/withdrawals` — exactly once.

```typescript
// app/api/withdrawals/route.ts (POST handler)
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { lockUserTx } from '@/lib/server/withdrawals/lock';
import { createDefaultBalanceComputer } from '@/lib/server/withdrawals/balance';
import { loadGuardConfigFromEnv, validateWithdrawalRequest } from '@/lib/server/withdrawals/guards';
import { verifyPin } from '@/lib/server/auth/pin';
import { createNotification } from '@/lib/server/notifications';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  amount: z.number().int().positive(),
  currency: z.literal('XOF').default('XOF'),
  destination: z.object({
    method: z.enum(['WAVE', 'ORANGE_MONEY', 'MTN_MOMO']),
    phone: z.string().regex(/^\+\d{10,15}$/, 'phone must be E.164 (e.g. +221XXXXXXXX)'),
    accountName: z.string().max(120).optional(),
  }),
  pin: z.string().min(4).max(12).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ code: 'INVALID_BODY', issues: parsed.error.issues }, { status: 400 });
    }
    const { amount, currency, destination, pin } = parsed.data;

    const config = loadGuardConfigFromEnv(process.env);
    const computeBalance = createDefaultBalanceComputer(prisma);

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Step 1 — advisory lock (FIRST thing inside BEGIN)
          await lockUserTx(tx, auth.user.sub);

          // Step 2..6 — load PIN hash + run all guards
          const userRow = await tx.user.findUnique({
            where: { id: auth.user.sub },
            select: { withdrawalPinHash: true },
          });
          const guard = await validateWithdrawalRequest({
            prisma: tx,
            config,
            userId: auth.user.sub,
            amount,
            pin,
            withdrawalPinHash: userRow?.withdrawalPinHash ?? null,
            computeBalance,
            bcryptCompare: verifyPin,
          });
          if (!guard.ok) {
            return { ok: false as const, status: guard.status, code: guard.code, message: guard.message };
          }

          // Step 7 — INSERT PENDING row
          const w = await tx.withdrawal.create({
            data: {
              userId: auth.user.sub,
              amount,
              currency,
              status: 'PENDING',
              destination: destination as Prisma.InputJsonValue,
              provider: 'bictorys', // matches Phase 5 webhook routing
            },
            select: { id: true, status: true, amount: true, currency: true, requestedAt: true },
          });

          // Step 7b (optional, recommended) — WITHDRAWAL_REQUESTED notification
          // Inside the tx so the dedupe-key insert participates in commit/rollback.
          // createNotification's signature accepts PrismaClient; tx is structurally
          // compatible for the .notification.create call site (verified by reading
          // notifications/index.ts:33 — uses only prisma.notification.create).
          await createNotification(tx as unknown as Prisma.TransactionClient as never, {
            userId: auth.user.sub,
            type: 'WITHDRAWAL_REQUESTED',
            title: 'Withdrawal requested',
            body: `Withdrawal of ${amount} ${currency} is pending.`,
            data: { withdrawalId: w.id, amount, currency },
            dedupeKey: `withdrawal-requested:${w.id}`,
          });

          // Step 8 — COMMIT (implicit return)
          return { ok: true as const, withdrawal: w };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!result.ok) {
        return NextResponse.json({ code: result.code, message: result.message }, { status: result.status });
      }
      return NextResponse.json(
        { withdrawalId: result.withdrawal.id, status: result.withdrawal.status },
        { status: 201, headers: { 'x-request-id': ctx.requestId } },
      );
    } catch (err) {
      // Serializable retry conflicts surface as P2034; advisory lock makes
      // these very rare for withdrawals but keep the catch defensive.
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2034') {
        return NextResponse.json({ code: 'TRANSIENT_CONFLICT', message: 'Please retry' }, { status: 409 });
      }
      throw err;
    }
  });
}
```

**Note on `createNotification` typing:** The exported signature takes `PrismaClient`, but the function body only calls `prisma.notification.create({...})` and catches `P2002`. A `TransactionClient` has the same `notification.create` shape. Casting via `as unknown as ... as never` is a type-system workaround. **Cleaner alternative:** Open a Wave 0 task to widen `createNotification`'s `prisma` param to `PrismaClient | Prisma.TransactionClient` so this cast is unnecessary. Do not modify `notifications/index.ts` outside an explicit task — it's a Phase 2 protected file. `[ASSUMED]` — the planner should confirm whether widening that signature falls inside or outside Phase 4 scope. If outside, call `createNotification(prisma, ...)` AFTER `$transaction()` returns successfully (with the dedupe key it remains at-most-once even if the post-commit call crashes — a retry just hits the unique constraint and returns null).

### Pattern 5: Withdrawal GET — cursor pagination on `requestedAt`

**What:** List user's own withdrawals, ordered `requestedAt DESC, id DESC`.
**When to use:** `GET /api/withdrawals`. Mirror `admin/withdrawals/route.ts:80-101` — that file already solved the `requestedAt` vs `createdAt` cursor mismatch.

```typescript
// app/api/withdrawals/route.ts (GET handler — same file as POST above)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.WithdrawalWhereInput = {
      userId: auth.user.sub, // scope to caller (D-WD-02)
      ...(cursor
        ? {
            OR: [
              { requestedAt: { lt: cursor.createdAt } },
              { requestedAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await prisma.withdrawal.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, amount: true, currency: true, status: true,
        destination: true, requestedAt: true, processedAt: true, completedAt: true,
        failureReason: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.requestedAt, id: last.id }) : null;

    return NextResponse.json({ items, nextCursor }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
```

`[VERIFIED: pattern lifted verbatim from frontend/src/app/api/admin/withdrawals/route.ts:80-101]`

### Anti-Patterns to Avoid

- **DO NOT** call `validateWithdrawalRequest` outside the Serializable tx. The `prisma` parameter passes through to balance/daily-limit/cooldown reads — all must be inside the tx for the snapshot guarantee.
- **DO NOT** read `await req.formData()` more than once — the body stream is consumed.
- **DO NOT** trust `File.type` (it's the client-supplied Content-Type). Always pair with `verifyMagicBytes`.
- **DO NOT** use `await new Response(body).arrayBuffer()` for the R2 GetObject Body — defeats streaming. Pass the `ReadableStream` directly.
- **DO NOT** issue 403 on owner-mismatch by default. Collapse to 404 (D-FILE-03 — no key existence enumeration).
- **DO NOT** add a per-userId rate limiter to `/api/withdrawals` in Phase 4 — out of scope; the cooldown env var already provides that.
- **DO NOT** widen `createNotification`'s prisma param outside an explicit Wave 0 task — protected file from Phase 2.
- **DO NOT** add `Withdrawal.idempotencyKey` migration in Phase 4 unless the planner explicitly schedules a Wave 0 schema task with `pnpm db:push`. Phase 3 has Wave 0 precedent (`Order.idempotencyKey`) but adding it here expands scope without buying race-safety we don't already have.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart parsing | Custom multipart parser | `req.formData()` | Native Next.js 16; handles boundary, encodings, multi-part edge cases. |
| File-type validation | Trust `File.type` from the request | `verifyMagicBytes(buf, mime)` from `sniff.ts` | Existing battle-tested sniffer for jpeg/png/webp/gif/pdf — extending it is one-line per format. |
| Race-safe withdrawal | New `setTimeout` retry logic, optimistic concurrency | `lockUserTx(tx, userId)` inside Serializable tx | The Postgres advisory lock IS the design; reimplementing risks double-spend. CLAUDE.md hard rule. |
| Balance computation | Re-querying Orders/Withdrawals inline in the route | `createDefaultBalanceComputer(prisma)` | Existing helper centralizes formula; forks override one function. |
| PIN comparison | `crypto.timingSafeEqual` of bcrypt strings | `verifyPin(plain, hash)` from `auth/pin.ts` | Existing helper; integrates with the dummy-hash timing-equalization pattern (CD-03). |
| Cursor pagination | Offset-based `?page=N` | `clampLimit` + cursor codec | Phase 3 standard; `paginate.ts` already in use. |
| R2 client init | Re-creating S3Client per request | Lazy-init singleton mirroring `provider-singleton.ts` | Connection pooling, AWS SDK metadata caching, env-validation-once. |
| ETag generation | Hashing the body server-side | Forward R2's ETag verbatim | R2 already computes a canonical ETag (MD5 for non-multipart); browsers cache against it. |
| 403/404 collapsing | Branchy 403 logic that leaks key existence | Always return 404 on owner-mismatch | Single code path, no enumeration oracle (D-FILE-03). |

**Key insight:** Phase 4 is **glue, not new infrastructure**. Every "hard problem" in this domain (race-safety, magic-byte sniffing, PIN timing equalization, cursor pagination) already has a tested module. The plan is mostly Zod schemas + handler scaffolding + 4 short unit-test files.

## Common Pitfalls

### Pitfall 1: PIN-channel mismatch (body vs header)
**What goes wrong:** CONTEXT.md `<specifics>` mentions an `x-withdrawal-pin` header for PIN delivery; `examples/frontend-pages/withdrawals.tsx:67-72` sends `pin` in the JSON body. If the route accepts only one, the example UX breaks.
**Why it happens:** Two different drafts of the API contract overlapped during Phase 4 context gathering.
**How to avoid:** **Use BODY (`{ pin?: string }`) not header.** Three reasons: (a) the canonical example page sends body `[VERIFIED: examples/frontend-pages/withdrawals.tsx:67]`; (b) Phase 2 PIN routes (`/api/auth/withdrawal-pin`) take PIN in body — consistent surface; (c) headers don't get logged-redacted automatically — body-level fields can be omitted from request logs more cleanly. The Zod schema in Pattern 4 already encodes this. **Document the choice in the plan** so a discuss-phase round-trip isn't needed.
**Warning signs:** Frontend example test fails with `PIN_REQUIRED` despite sending PIN.

### Pitfall 2: `cursorWhere` and `buildPage` target `createdAt`, not `requestedAt`
**What goes wrong:** Withdrawal model has no `createdAt` column — only `requestedAt`. Calling `cursorWhere(cursor)` from `paginate.ts` produces `{ createdAt: { lt: ... } }` which Prisma will reject at runtime.
**Why it happens:** `paginate.ts` was built for the notifications/admin pattern which all use `createdAt`.
**How to avoid:** Inline the equivalent OR fragment using `requestedAt` (see Pattern 5). The wire format (cursor.createdAt holds an ISO timestamp) stays compatible — only the Prisma `where` field name changes.
**Warning signs:** Prisma "Unknown arg `createdAt` on Withdrawal" at runtime.

### Pitfall 3: AWS SDK Body type confusion
**What goes wrong:** Older AWS SDK v2 returned a Node `Readable` for GetObject Body. Some Stack Overflow answers (pre-2023) wrap it in `Buffer.concat` or `body.transformToByteArray()` — both BUFFER the entire object into memory, defeating the streaming requirement (D-FILE-04).
**Why it happens:** Mixed v2/v3 documentation; v3 changed the Body type.
**How to avoid:** In `@aws-sdk/client-s3` v3 on Node 18+, `res.Body` is a `ReadableStream<Uint8Array>` (Web stream). Pass it **directly** as the second arg of `new Response(body, ...)`. Do NOT call `.transformToByteArray()`, `.transformToString()`, or `.pipe()`.
**Warning signs:** Memory spikes with 10 MB files; `Cannot read property 'pipe' of undefined`.

### Pitfall 4: `createNotification(prisma, ...)` inside a Serializable tx
**What goes wrong:** `createNotification`'s exported signature is `(prisma: PrismaClient, input)` — passing a `TransactionClient` requires a TS cast, OR calling it after `$transaction()` returns means the notification can fail without rolling back the withdrawal.
**Why it happens:** The Phase 2 helper was written before Phase 4 needed tx-scoped notification dispatch.
**How to avoid (recommended):** Call `createNotification` AFTER `$transaction()` returns successfully. The dedupe key (`withdrawal-requested:${w.id}`) makes the call idempotent — if a retry triggers the create, the unique constraint catches it and returns `null`. This sidesteps the typing issue and accepts a small correctness gap (notification might miss if the process crashes between commit and the call). Pair with a Phase 5 cron task to back-fill missing notifications via outbox if that gap matters.
**Alternative (cleaner but expands scope):** Add a Wave 0 task to widen `createNotification`'s param to `PrismaClient | Prisma.TransactionClient`. Single-line change in `notifications/index.ts` — but that file is "protected" per CLAUDE.md, so the planner must explicitly call this out.
**Warning signs:** TypeScript error `Argument of type 'TransactionClient' is not assignable to parameter of type 'PrismaClient'`.

### Pitfall 5: `loadGuardConfigFromEnv` reads `process.env` at call time
**What goes wrong:** Tests that mock env vars via `vi.stubEnv` need to call `loadGuardConfigFromEnv(process.env)` AFTER the stub. If the route hoists the config to module-top, env stubbing won't take effect.
**Why it happens:** `process.env` snapshots at module-load are common for performance.
**How to avoid:** Call `loadGuardConfigFromEnv(process.env)` **inside the handler body** (not at module top). The function is cheap (just numeric coerces) and Vitest tests can `vi.stubEnv('WITHDRAWAL_REQUIRE_PIN', '0')` then re-invoke the route.
**Warning signs:** Tests that expect `WITHDRAWAL_REQUIRE_PIN=0` still see `PIN_NOT_SET` errors.

### Pitfall 6: Empty-string env vars rejected as "missing"
**What goes wrong:** `env.ts:37` `CRON_SECRET: z.string().min(16).optional()` accepts `undefined` but rejects `""` — `.env.example` ships `CRON_SECRET=""` which fails Zod parse. Same trap will hit `R2_ACCOUNT_ID=""`, `R2_BUCKET=""`, etc. Phase 3 verify-work surfaced this.
**Why it happens:** Zod's `.optional()` is "may be undefined" — empty string is still a string and runs through `.min(16)`.
**How to avoid:** When the planner adds `R2_*` env entries (they go in the route module, not env.ts schema — D-UP-03 keeps them as runtime-checked-only), keep them out of `env.ts`. The `getR2Client()` lazy-init reads `process.env.R2_*` directly with `?? ''` empty-string-as-absent handling. **Do not add R2_* to env.ts**. (CONTEXT.md is consistent — env.ts only validates REQUIRED + a small recommended set; optional providers are validated at the call site.) `[VERIFIED: env.ts:13-18 docstring]`
**Warning signs:** `pnpm dev` crashes at boot with "Invalid environment variables: R2_ACCOUNT_ID: String must contain at least 1 character(s)".

### Pitfall 7: `req.formData()` with no `Content-Type: multipart/form-data` header
**What goes wrong:** Returns an empty FormData. `form.get('file')` is null → handler returns `UPLOAD_MISSING_FILE`. Misleading because the bug is in the client, not the server.
**Why it happens:** Test code that sends `body: <File>` without setting Content-Type to multipart.
**How to avoid:** In tests, build a real `FormData` and pass it as `body` — `fetch` sets the boundary header automatically. Document the test pattern in the test file.

## Code Examples

Verified patterns from official sources / existing codebase:

### Example 1: Build a multipart Request in Vitest
```typescript
// frontend/src/app/api/upload/route.test.ts (excerpt)
import { POST } from './route';

function makeMultipartRequest(file: File): NextRequest {
  const fd = new FormData();
  fd.append('file', file);
  return new NextRequest(new URL('http://localhost/api/upload'), {
    method: 'POST',
    body: fd,
    headers: { 'x-csrf-token': 'test-csrf', cookie: 'app-csrf=test-csrf; app=valid-jwt' },
  });
}

const jpegMagic = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const fakeJpeg = new File([jpegMagic, 'rest of bytes'], 'photo.jpg', { type: 'image/jpeg' });
```
`[VERIFIED: Web standards — fetch.spec.whatwg.org FormData semantics]`

### Example 2: Mock R2 client for unit tests
```typescript
// test-utils/r2-mock.ts (Phase 4 — new)
import { vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';

export function mockR2Client(opts: { onPut?: vi.Mock; onGet?: vi.Mock } = {}): Partial<S3Client> {
  return {
    send: vi.fn(async (cmd: any) => {
      if (cmd.constructor.name === 'PutObjectCommand') {
        return opts.onPut ? opts.onPut(cmd) : { ETag: '"abc123"' };
      }
      if (cmd.constructor.name === 'GetObjectCommand') {
        return opts.onGet ? opts.onGet(cmd) : {
          Body: new ReadableStream({ start: c => { c.enqueue(new Uint8Array([1,2,3])); c.close(); } }),
          ETag: '"abc123"',
          ContentLength: 3,
        };
      }
      throw new Error(`Unmocked S3 command: ${cmd.constructor.name}`);
    }),
  };
}
```

### Example 3: Concurrent POST integration-style test (mock prisma + advisory lock semantics)
The `withdrawals/lock.ts` test should already cover the SQL invocation. For the route-level concurrent test, **use `Promise.all([POST(req1), POST(req2)])` against a mock prisma where `withdrawal.findMany` for balance returns the same number both times BEFORE the first commit**. The advisory lock test belongs in `withdrawals/lock.test.ts` — it's an integration test against a real Postgres (covered by Phase 6 TEST-02). For Phase 4 unit tests, **assert the route calls `lockUserTx` and runs the guard chain inside `$transaction({ isolationLevel: 'Serializable' })`** — not the actual race outcome. Live-stack UAT (Pattern from Phase 1 `01-HUMAN-UAT.md`) covers the real race.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `multer` Express middleware | `req.formData()` + `File.arrayBuffer()` | Next.js 13.2+ App Router (2023) | Native; no dependency; works with Edge runtime too (we don't use Edge though). |
| AWS SDK v2 `s3.getObject().createReadStream()` | `@aws-sdk/client-s3` v3 `GetObjectCommand` → `Body: ReadableStream` | AWS SDK v3 (2020+); Web streams default on Node 18+ | Modular SDK (smaller bundle); native streaming compat with `Response` constructor. |
| Custom multipart memory limit + 502 on overrun | `req.formData()` plus pre-check `file.size` | Next.js 16 docs | The route can branch on `file.size` BEFORE `arrayBuffer()` allocates the bytes — bound memory tightly. |
| Sentry route-error capture via try/catch in every handler | `instrumentation.ts` `onRequestError` | Next.js 15+ (Phase 0 OPS-03) | Already shipped in Phase 0; route handlers don't need explicit Sentry wrapping. |

**Deprecated/outdated:**
- `@aws-sdk/client-s3` v2 — replaced by v3 (already on v3.1044.0). `[VERIFIED: pnpm list]`
- `multer` — never installed in this monolith (replaced before any code shipped). `[VERIFIED: package.json]`
- `setInterval` polling for cron — replaced by Vercel Cron (Phase 5 scope, not this phase).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `createNotification`'s `prisma.notification.create` call works with a `TransactionClient` if cast at the boundary | Pattern 4 / Pitfall 4 | If runtime rejects the cast (very unlikely — `TransactionClient` is structurally a subset of `PrismaClient` for `.notification.create`), notification dispatch fails inside tx. Recommended workaround: call AFTER tx commit (small correctness gap, idempotent via dedupe key). |
| A2 | `req.formData()` buffers the file into memory at 10 MB cap is acceptable on Vercel Node functions (default 1024 MB memory) | Pattern 1 / Alternatives | If a fork sets `UPLOAD_MAX_BYTES` to 100 MB+ they'll hit memory limits — operator-set risk, documented in `.env.example`. |
| A3 | The frontend example sending `pin` in body (vs CONTEXT.md's `<specifics>` mentioning header) is the canonical contract | Pitfall 1 | If the planner picks header instead, the example page (`examples/frontend-pages/withdrawals.tsx`) becomes broken. Discuss-phase round-trip needed. |
| A4 | Adding `Withdrawal.idempotencyKey` should be deferred (the advisory lock is sufficient for race-safety, and `api()` doesn't retry POSTs) | Alternatives Considered | If a fork wires a non-monolith client that DOES retry POSTs, they'd need this. Cheap to add later as additive `String? @unique` migration; no data backfill required. |
| A5 | `WITHDRAWAL_REQUESTED` notification is OPTIONAL (CONTEXT.md `<specifics>` says optional/cheap) | Pattern 4 (Step 7b) | If skipped, users have no in-app feedback for pending withdrawals — only the API response. Frontend example doesn't currently rely on a notification, so safe. |

## Open Questions

1. **PIN delivery — body vs header?**
   - What we know: Frontend example sends body (`examples/frontend-pages/withdrawals.tsx:67`). CONTEXT.md `<specifics>` mentions `x-withdrawal-pin` header.
   - What's unclear: Which is canonical.
   - Recommendation: Ship body-only (matches example, matches Phase 2 PIN routes). If the planner disagrees, surface for a discuss-phase round-trip.

2. **`createNotification` inside Serializable tx — widen the helper's typing or call after commit?**
   - What we know: `notifications/index.ts:33` calls only `prisma.notification.create({...})` — structurally compatible with `TransactionClient`. The exported type is narrower than the runtime needs.
   - What's unclear: Whether widening the helper's signature is in scope for Phase 4 (file is "protected" per CLAUDE.md).
   - Recommendation: Call AFTER commit (Pitfall 4 alternative) — the dedupe key keeps it at-most-once across retries. Defer the type-widening to a tiny Phase 6 cleanup task.

3. **`Withdrawal.idempotencyKey` — Phase 4 or follow-up?**
   - What we know: Phase 3 added `Order.idempotencyKey` in a Wave 0 schema task (1 column add, additive). The advisory lock + `requestedAt`-checking already prevent the racy double-spend class.
   - What's unclear: Whether ANY client in v1 will retry POSTs to `/api/withdrawals`. The frontend `api()` wrapper does not (CF-14).
   - Recommendation: Defer. Note as a "follow-up patch" in the plan summary so it's not lost.

4. **`R2_ENDPOINT` override env var — needed for Minio in dev?**
   - What we know: CONTEXT.md `<specifics>` lists only `R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY`. Minio uses a different endpoint (e.g. `http://localhost:9000`).
   - What's unclear: Whether to expose `R2_ENDPOINT` for local dev (overrides the canonical `https://${accountId}.r2.cloudflarestorage.com`).
   - Recommendation: Add an OPTIONAL `R2_ENDPOINT` env var. If set, use it; otherwise fall back to the R2 URL pattern. Keep `R2_ACCOUNT_ID` required so the prod path stays explicit. Document in the `.env.example` comment block.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@aws-sdk/client-s3` | UP-01, UP-02 | ✓ | 3.1044.0 | — |
| `next` (App Router) | UP-01, UP-02, WD-01..04 | ✓ | 16.1.6 | — |
| `zod` | UP-01, WD-01 | ✓ | 3.23.8 | — |
| `@prisma/client` | All | ✓ | 5.22.0 | — |
| `bcryptjs` | WD-01 (PIN) | ✓ | 2.4.3 | — |
| `vitest` + `vitest-mock-extended` | All test files | ✓ | (Phase 0/3 setup) | — |
| Cloudflare R2 (or Minio) live endpoint | UP-01, UP-02 production smoke | ✗ for unit tests; ✓ for live UAT | — | Mock R2 client (`test-utils/r2-mock.ts` — new) for unit tests; Minio in `docker-compose.yml` for local dev |
| Postgres (advisory lock + Serializable iso) | WD-01 race UAT | ✓ for live UAT (Neon); ✗ for unit tests | — | Mock prisma (`test-utils/prisma-mock.ts`) for unit tests; live-stack UAT covers the real race outcome |

**Missing dependencies with no fallback:** None. All the deps either exist in the monolith or are mockable.

**Missing dependencies with fallback:**
- Live R2/Minio for upload integration smoke — covered by mock R2 client in unit tests; live-stack smoke deferred to Phase 4 verify-work / human UAT (mirrors Phase 1 `01-HUMAN-UAT.md` pattern).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (set up in Phase 0/1) |
| Config file | `frontend/vitest.config.ts` (existing) |
| Quick run command | `pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals --no-coverage` |
| Full suite command | `pnpm test` (workspace root → `pnpm --filter frontend exec vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UP-01 | Valid JPEG → 201 + `key`, body persisted to R2 mock | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "valid jpeg uploads"` | ❌ Wave 0 |
| UP-01 | `.jpg` filename + PDF magic bytes → 415 `MAGIC_BYTE_MISMATCH` | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "magic byte mismatch"` | ❌ Wave 0 |
| UP-01 | MIME outside `UPLOAD_ALLOWED_MIME` → 415 `INVALID_MIME` | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "mime not allowed"` | ❌ Wave 0 |
| UP-01 | Size > `UPLOAD_MAX_BYTES` → 413 `FILE_TOO_LARGE` | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "file too large"` | ❌ Wave 0 |
| UP-01 | `R2_*` envs missing → 503 `STORAGE_NOT_CONFIGURED` | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "storage not configured"` | ❌ Wave 0 |
| UP-01 | Missing `file` field → 400 `UPLOAD_MISSING_FILE` | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "missing file"` | ❌ Wave 0 |
| UP-01 | R2 `send` throws → 502 `UPLOAD_FAILED` | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "upload failed"` | ❌ Wave 0 |
| UP-01 | No CSRF header → 403 | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "csrf"` | ❌ Wave 0 |
| UP-01 | No auth cookie → 401 | unit | `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts -t "no auth"` | ❌ Wave 0 |
| UP-02 | Valid key + matching userId → 200 + streamed body + correct headers (Content-Type, Cache-Control, ETag) | unit | `pnpm --filter frontend exec vitest run src/app/api/files/route.test.ts -t "owner streams"` | ❌ Wave 0 |
| UP-02 | Key not in `FileUpload` table → 404 `FILE_NOT_FOUND` | unit | `pnpm --filter frontend exec vitest run src/app/api/files/route.test.ts -t "missing"` | ❌ Wave 0 |
| UP-02 | Owner mismatch → 404 `FILE_NOT_FOUND` (no enumeration) | unit | `pnpm --filter frontend exec vitest run src/app/api/files/route.test.ts -t "owner mismatch"` | ❌ Wave 0 |
| UP-02 | `R2_*` envs missing → 503 | unit | `pnpm --filter frontend exec vitest run src/app/api/files/route.test.ts -t "storage not configured"` | ❌ Wave 0 |
| UP-02 | R2 returns `NoSuchKey` → 404 | unit | `pnpm --filter frontend exec vitest run src/app/api/files/route.test.ts -t "r2 nosuch"` | ❌ Wave 0 |
| UP-02 | Anonymous-uploaded row (userId null) → public-readable | unit | `pnpm --filter frontend exec vitest run src/app/api/files/route.test.ts -t "anonymous"` | ❌ Wave 0 |
| WD-01 | Happy path: PIN set + sufficient balance → 201 + PENDING row | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "happy path"` | ❌ Wave 0 |
| WD-01 | Route opens `Serializable` tx and calls `lockUserTx` (assert via spy) | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "advisory lock"` | ❌ Wave 0 |
| WD-01 | Live-stack: 2 concurrent POSTs → 1 PENDING + 1 INSUFFICIENT_BALANCE | manual-only | live-stack UAT (mirror `01-HUMAN-UAT.md`) — needs real Postgres | manual-only |
| WD-02 | Each of 8 codes returned with correct status (table-driven test) | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "error codes"` | ❌ Wave 0 |
| WD-02 | Invalid body (missing amount, bad phone format, bad enum) → 400 `INVALID_BODY` with Zod issues | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "invalid body"` | ❌ Wave 0 |
| WD-02 | No CSRF / no auth → 403 / 401 | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "csrf|auth"` | ❌ Wave 0 |
| WD-03 | GET returns user's own withdrawals only, ordered `requestedAt DESC` | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "GET own"` | ❌ Wave 0 |
| WD-03 | Cursor pagination: `?limit=2&cursor=X` returns next page; `nextCursor` null on last page | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "GET cursor"` | ❌ Wave 0 |
| WD-03 | GET scoped: caller's user A request returns 0 of user B's withdrawals | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "GET isolation"` | ❌ Wave 0 |
| WD-04 | `WITHDRAWAL_BALANCE_CHECK=1` (default): excessive amount → `INSUFFICIENT_BALANCE` | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "balance check default"` | ❌ Wave 0 |
| WD-04 | `WITHDRAWAL_BALANCE_CHECK=0`: same excessive amount → 201 (check skipped) | unit | `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts -t "balance check disabled"` | ❌ Wave 0 |
| WD-04 | `.env.example` contains the verbatim FINANCIAL-SAFETY warning block | unit / static | `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts -t "withdrawal balance check warning"` | ❌ Wave 0 (extend existing env-shape.test.ts) |

### Sampling Rate
- **Per task commit:** `pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals --no-coverage` (~3-5s)
- **Per wave merge:** `pnpm test` (full Vitest run; ~30-60s — covers regressions across Phases 0-3)
- **Phase gate:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` (the README "Before committing" gate). Plus the live-stack UAT items (advisory lock under real concurrency, R2 PUT/GET against real R2 or Minio) tracked in a Phase 4 `04-HUMAN-UAT.md` mirroring Phase 1's pattern.

### Wave 0 Gaps
- [ ] `frontend/src/app/api/upload/route.test.ts` — covers UP-01 (≥9 cases per table above)
- [ ] `frontend/src/app/api/files/[...key]/route.test.ts` — covers UP-02 (≥6 cases)
- [ ] `frontend/src/app/api/withdrawals/route.test.ts` — covers WD-01..04 (≥10 cases including table-driven 8-codes test)
- [ ] `frontend/src/test-utils/r2-mock.ts` — `mockR2Client({ onPut?, onGet? })` factory
- [ ] `frontend/src/test-utils/withdrawal-fixtures.ts` (or extend `admin-fixtures.ts`) — `seedWithdrawal({ userId, amount, status, requestedAt })`, plus a `seedActiveUserWithPin` helper that wraps `seedActiveUser` with a known bcrypt hash
- [ ] `frontend/src/lib/server/upload/r2-client.ts` (LIB code, not test) — the lazy-init module
- [ ] Mock balance computer pattern in tests: `vi.spyOn(BalanceModule, 'createDefaultBalanceComputer').mockReturnValue(async () => 5000)` so each WD test can fix the balance to a known integer
- [ ] `.env.example` block for upload + withdrawal env vars (D-UP-01..02 + D-WD-ENV-01..02 — verbatim text in CONTEXT.md `<specifics>`); a unit test in `env-shape.test.ts` asserts the FINANCIAL-SAFETY warning string is present

### Project Constraints (from CLAUDE.md)

CLAUDE.md directives that apply to Phase 4 — research recommendations honor each:

- **MUST `export const runtime = 'nodejs'`** in every new route file (`upload/route.ts`, `files/[...key]/route.ts`, `withdrawals/route.ts`). Phase 0 runtime-enforcement test fails CI otherwise.
- **`verifyCsrf(req)` BEFORE `requireAuth(req)`** for all mutating routes. Both bail with `if (X instanceof NextResponse) return X` (CF-01..14).
- **Withdrawals MUST use `lockUserTx` inside Serializable Prisma tx** — never check-then-write outside the lock (CF-12, CLAUDE.md "Critical invariants").
- **Magic-byte sniff via `sniff.ts`** — never trust `File.type` alone (CF-13).
- **`createNotification(prisma, input)` only** — never raw `prisma.notification.create` (Critical invariant).
- **Frontend `api()` does NOT retry POST** — withdrawal POST especially is single-attempt (CF-14). Affects whether idempotency-key is needed (it's not, for v1).
- **Payment amounts integer in smallest currency unit** — `Withdrawal.amount` is `Int` (XOF, no decimals). Zod schema must reject decimals via `z.number().int()`.
- **Cookies stay `httpOnly` + `Secure` (prod) + `SameSite=Lax`** — no new cookies in Phase 4.
- **Files Claude must NOT modify**: `withdrawals/{lock,balance,guards}.ts`, `upload/sniff.ts`, `auth/pin.ts`, `notifications/index.ts`, `middleware/index.ts`, `auth.ts`. Any change to these requires a "I am about to modify X because Y — confirm?" prompt — Phase 4 should not need to touch any of them.

## Sources

### Primary (HIGH confidence)
- `frontend/src/lib/server/upload/sniff.ts` (read in full) — magic-byte API + supported MIMEs
- `frontend/src/lib/server/withdrawals/lock.ts` (read in full) — `lockUserTx(tx, userId)` exported, uses `pg_advisory_xact_lock(hashtext($1))`
- `frontend/src/lib/server/withdrawals/balance.ts` (read in full) — `createDefaultBalanceComputer(prisma)` exported; default formula confirmed
- `frontend/src/lib/server/withdrawals/guards.ts` (read in full) — **actual export name is `validateWithdrawalRequest`** (not `validateWithdrawal`); 8 codes returned with HTTP statuses 422/403
- `frontend/src/lib/server/auth/pin.ts` (read in full) — `verifyPin(plain, hash)` + `alwaysCompareDummy` for timing equalization
- `frontend/src/lib/server/auth.ts:192-211` — `verifyCsrf(req): NextResponse | null` exported here (NOT from middleware/index.ts)
- `frontend/src/lib/server/middleware/index.ts` (read in full) — `requireAuth(authHeader?)` returns `AuthContext | NextResponse`
- `frontend/src/lib/server/notifications/index.ts:28-57` — `createNotification(prisma: PrismaClient, input)` signature; `notification.create` is the only Prisma call (TransactionClient is structurally compatible)
- `frontend/src/lib/server/notifications/cursor.ts` (read in full) — base64 JSON `{ createdAt, id }` cursor format
- `frontend/src/lib/server/pagination/paginate.ts` (read in full) — `clampLimit`, `cursorWhere`, `buildPage` (target `createdAt`)
- `frontend/src/lib/server/payments/provider-singleton.ts` (read in full) — verified Pattern 2 (lazy-init singleton + typed *NotConfiguredError)
- `frontend/src/app/api/admin/withdrawals/route.ts:1-105` — verbatim cursor-pagination-on-`requestedAt` pattern (Pattern 5)
- `frontend/prisma/schema.prisma:168-180,275-336` — FileUpload + Order + Withdrawal model shapes verified
- `frontend/src/lib/server/env.ts:37` — confirmed `CRON_SECRET: z.string().min(16).optional()` empty-string-rejection bug; informs Pitfall 6
- `frontend/package.json:24-39` — `@aws-sdk/client-s3 ^3.1037.0`, installed `3.1044.0`; next 16.1.6, zod 3.23.8 verified via `pnpm --filter frontend list`
- `examples/frontend-pages/withdrawals.tsx:62-72` — frontend example sends `pin` in body (informs Pitfall 1 / Open Question 1)
- `frontend/src/test-utils/admin-fixtures.ts:35-60` — `buildUser` includes `withdrawalPinHash: null` field

### Secondary (MEDIUM confidence — derived from primary)
- AWS SDK v3 `GetObjectCommand` Body returns Web `ReadableStream` on Node 18+ — verified via `node -e` import that `NoSuchKey` exports as a class; Body streaming is documented in AWS SDK v3 release notes
- Next.js 16 App Router `req.formData()` for multipart — App Router pattern documented in Next.js 13.2+ release notes; current docs at nextjs.org/docs/app/api-reference/file-conventions/route#request-body

### Tertiary (LOW confidence — flagged for validation)
- The exact upper bound of `req.formData()` memory consumption on Vercel Node functions at the 10 MB cap. Conservative estimate: ~30-40 MB (file + form bookkeeping + base64 / boundary overhead). Vercel default 1024 MB. Safe but not stress-tested in this codebase. `[ASSUMED]`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is already installed; versions verified via `pnpm list`
- Architecture: HIGH — Patterns 1-5 are either lifted verbatim from existing code (Pattern 5 = `admin/withdrawals/route.ts`) or mirror established Phase 3 patterns (Pattern 2 = `provider-singleton.ts`)
- Pitfalls: HIGH for 1, 2, 5, 6 (verified against existing code); MEDIUM for 3 (AWS SDK Body type — depends on Node version, currently Node ≥20 per CLAUDE.md so safe); MEDIUM for 4 (cast workaround is unverified — alternative recommendation removes the risk)

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30 days; the AWS SDK + Next.js + Prisma versions are stable; only the `createNotification` typing question might be answered by a Phase 6 cleanup)
