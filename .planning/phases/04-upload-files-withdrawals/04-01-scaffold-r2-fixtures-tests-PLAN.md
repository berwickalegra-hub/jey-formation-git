---
phase: 04-upload-files-withdrawals
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - frontend/src/lib/server/upload/r2-client.ts
  - frontend/src/test-utils/r2-mock.ts
  - frontend/src/test-utils/admin-fixtures.ts
  - frontend/src/app/api/upload/route.test.ts
  - frontend/src/app/api/files/[...key]/route.test.ts
  - frontend/src/app/api/withdrawals/route.test.ts
  - frontend/src/lib/server/observability/env-shape.test.ts
  - frontend/.env.example
autonomous: true
requirements:
  - UP-01
  - UP-02
  - WD-01
  - WD-02
  - WD-03
  - WD-04
must_haves:
  truths:
    - "RED test files exist for all 3 new routes — failing on missing source modules"
    - "Mock R2 client returns typed Put/Get responses, supports NoSuchKey throw"
    - "seedActiveUserWithPin + seedWithdrawal helpers are callable from withdrawal route tests"
    - ".env.example contains the verbatim FINANCIAL-SAFETY warning block — env-shape.test.ts asserts it"
    - "getR2Client throws StorageNotConfiguredError when any of R2_ACCOUNT_ID/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY is missing or empty"
  artifacts:
    - path: "frontend/src/lib/server/upload/r2-client.ts"
      provides: "getR2Client + getR2Bucket + StorageNotConfiguredError + __resetR2Singleton"
      exports: ["getR2Client", "getR2Bucket", "StorageNotConfiguredError", "__resetR2Singleton"]
    - path: "frontend/src/test-utils/r2-mock.ts"
      provides: "mockR2Client factory"
      exports: ["mockR2Client"]
    - path: "frontend/src/test-utils/admin-fixtures.ts"
      provides: "seedActiveUserWithPin + seedWithdrawal helpers"
      contains: "seedActiveUserWithPin"
    - path: "frontend/src/app/api/upload/route.test.ts"
      provides: "≥9 RED scenarios for UP-01"
      min_lines: 120
    - path: "frontend/src/app/api/files/[...key]/route.test.ts"
      provides: "≥6 RED scenarios for UP-02"
      min_lines: 80
    - path: "frontend/src/app/api/withdrawals/route.test.ts"
      provides: "≥10 RED scenarios for WD-01..04 incl. table-driven 8-codes"
      min_lines: 200
  key_links:
    - from: "frontend/src/lib/server/upload/r2-client.ts"
      to: "process.env.R2_ACCOUNT_ID/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY (+ optional R2_ENDPOINT)"
      via: "module-scope readers with `?? ''` empty-as-absent"
      pattern: "R2_ACCOUNT_ID"
    - from: "frontend/.env.example"
      to: "frontend/src/lib/server/observability/env-shape.test.ts"
      via: "static-text assertion of WITHDRAWAL_BALANCE_CHECK warning"
      pattern: "FINANCIAL-SAFETY WARNING"
---

<objective>
Wave 0 scaffolding: ship RED test files for all 3 routes, the R2 lazy-init lib, supporting fixtures, and `.env.example` env blocks for upload + withdrawal policies. Provides the test contract Wave 1 routes implement against.

Purpose: Tests-first establishes the exact behavioral contract (status codes, stable error codes, response shapes) so Wave 1 routes are simple "make the tests green" work. The R2 client + fixtures eliminate scavenger-hunt work for Wave 1 executors.

Output: 1 lib module (`r2-client.ts`), 1 mock factory (`r2-mock.ts`), extension to `admin-fixtures.ts`, 3 RED test files, 2 `.env.example` blocks, 1 env-shape assertion.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/04-upload-files-withdrawals/04-CONTEXT.md
@.planning/phases/04-upload-files-withdrawals/04-RESEARCH.md
@.planning/phases/04-upload-files-withdrawals/04-VALIDATION.md
@CLAUDE.md

@frontend/src/lib/server/payments/provider-singleton.ts
@frontend/src/lib/server/upload/sniff.ts
@frontend/src/lib/server/withdrawals/lock.ts
@frontend/src/lib/server/withdrawals/balance.ts
@frontend/src/lib/server/withdrawals/guards.ts
@frontend/src/lib/server/auth/pin.ts
@frontend/src/test-utils/admin-fixtures.ts
@frontend/src/lib/server/observability/env-shape.test.ts
@frontend/.env.example
@frontend/prisma/schema.prisma

<interfaces>
<!-- Key contracts. Wave 1 executors should use these directly — no codebase exploration needed. -->

From frontend/src/lib/server/payments/provider-singleton.ts (verified pattern to mirror):
```typescript
export class PaymentProviderUnconfiguredError extends Error { /* typed error */ }
let _provider: BictorysProviderHandle | null = null;
export function getProvider(): BictorysProviderHandle {
  if (_provider) return _provider;
  const url = process.env.BICTORYS_API_URL ?? '';
  // ... if any empty → throw PaymentProviderUnconfiguredError()
}
export function __resetProviderSingleton(): void { _provider = null; }
```

From frontend/src/lib/server/withdrawals/lock.ts (existing — call only):
```typescript
export type TxClient = Prisma.TransactionClient;
export async function lockUserTx(tx: TxClient, userId: string): Promise<void>;
// Issues: SELECT pg_advisory_xact_lock(hashtext($1))
```

From frontend/src/lib/server/withdrawals/guards.ts (existing — call only):
```typescript
export type WithdrawalGuardConfig = { /* min, max, cooldownHours, dailyLimit, requirePin, balanceCheck */ };
export function loadGuardConfigFromEnv(env: NodeJS.ProcessEnv): WithdrawalGuardConfig;
// **Actual export name** (per RESEARCH Sources):
export async function validateWithdrawalRequest(args: {
  prisma: Prisma.TransactionClient;
  config: WithdrawalGuardConfig;
  userId: string;
  amount: number;
  pin?: string;
  withdrawalPinHash: string | null;
  computeBalance: BalanceComputer;
  bcryptCompare: (plain: string, hash: string) => Promise<boolean>;
}): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>;
```

From frontend/src/lib/server/withdrawals/balance.ts (existing — call only):
```typescript
export type BalanceComputer = (args: { tx: Prisma.TransactionClient; userId: string }) => Promise<number>;
export function createDefaultBalanceComputer(prisma: PrismaClient): BalanceComputer;
```

From frontend/src/lib/server/upload/sniff.ts (existing — call only):
```typescript
export function verifyMagicBytes(buf: Buffer, declaredMime: string): { match: boolean; sniffed: boolean };
// sniffed=false means we don't have a sniffer for this MIME → caller MAY allow per docs
```

From frontend/src/lib/server/auth/pin.ts (existing — call only):
```typescript
export async function verifyPin(plain: string, hash: string | null): Promise<boolean>;
// timing-equalized via dummy hash when hash is null
```

From frontend/prisma/schema.prisma (verified shapes):
- `FileUpload { id, userId String?, key String @unique, filename, mimeType, sizeBytes Int, createdAt }`
- `Withdrawal { id, userId, amount Int, currency String, status, destination Json, provider, requestedAt, processedAt, completedAt, failureReason }`
</interfaces>

<reference_patterns>
- **Lazy-init lib:** `frontend/src/lib/server/payments/provider-singleton.ts` — mirror verbatim
- **Cursor pagination on `requestedAt`:** `frontend/src/app/api/admin/withdrawals/route.ts` lines 80–101 (verified by RESEARCH)
- **Test fixtures pattern:** `frontend/src/test-utils/admin-fixtures.ts` — extend, do not rewrite
- **env-shape test pattern:** `frontend/src/lib/server/observability/env-shape.test.ts` — append a `describe.it` block
</reference_patterns>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create R2 lazy-init client + mock + extend env.example</name>
  <files>
    - frontend/src/lib/server/upload/r2-client.ts (NEW)
    - frontend/src/test-utils/r2-mock.ts (NEW)
    - frontend/.env.example (APPEND ONLY — preserve existing content)
    - frontend/src/lib/server/observability/env-shape.test.ts (EXTEND)
  </files>
  <read_first>
    - frontend/src/lib/server/payments/provider-singleton.ts (mirror this shape verbatim)
    - frontend/.env.example (current content — append at end, do not rewrite)
    - frontend/src/lib/server/observability/env-shape.test.ts (existing test file — add a new `it()` block)
    - .planning/phases/04-upload-files-withdrawals/04-CONTEXT.md `<specifics>` (verbatim env blocks below)
  </read_first>
  <behavior>
    - r2-client: getR2Client() returns cached S3Client; throws StorageNotConfiguredError when any of R2_ACCOUNT_ID|R2_BUCKET|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY is missing OR empty string
    - r2-client: getR2Bucket() returns bucket string after lazy init
    - r2-client: __resetR2Singleton() clears cache for tests
    - r2-client: when R2_ENDPOINT env is set, use it; otherwise compute `https://${accountId}.r2.cloudflarestorage.com`
    - r2-mock: mockR2Client({ onPut?, onGet? }) returns Partial<S3Client> with vi.fn-backed send() that branches on cmd.constructor.name; default onGet returns Body=ReadableStream(3 bytes) + ETag '"abc123"' + ContentLength 3; default onPut returns ETag '"abc123"'; supports throwing NoSuchKey when caller specifies onGet that throws
    - env.example: appends UPLOAD_* + R2_* + WITHDRAWAL_* blocks verbatim per CONTEXT.md (including FINANCIAL-SAFETY WARNING block + R2_ENDPOINT optional comment)
    - env-shape.test.ts: a new `it("withdrawal balance check warning")` reads `frontend/.env.example` and asserts it contains the literal string `⚠️  FINANCIAL-SAFETY WARNING — DO NOT CASUALLY DISABLE  ⚠️` and the key `WITHDRAWAL_BALANCE_CHECK="1"`
  </behavior>
  <action>
**1. Create `frontend/src/lib/server/upload/r2-client.ts`** — mirror `payments/provider-singleton.ts` verbatim with these adaptations:

```typescript
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
  const endpointOverride = process.env.R2_ENDPOINT ?? '';

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageNotConfiguredError();
  }

  _client = new S3Client({
    region: 'auto',
    endpoint: endpointOverride || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: !!endpointOverride, // Minio needs path-style; R2 prefers virtual-hosted
  });
  _bucket = bucket;
  return _client;
}

export function getR2Bucket(): string {
  if (!_bucket) getR2Client();
  return _bucket as string;
}

/** @internal */
export function __resetR2Singleton(): void {
  _client = null;
  _bucket = null;
}
```

**2. Create `frontend/src/test-utils/r2-mock.ts`**:

```typescript
import { vi, type Mock } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';

export interface MockR2Options {
  onPut?: Mock;
  onGet?: Mock;
}

export function mockR2Client(opts: MockR2Options = {}): Pick<S3Client, 'send'> {
  return {
    send: vi.fn(async (cmd: { constructor: { name: string } }) => {
      const name = cmd.constructor.name;
      if (name === 'PutObjectCommand') {
        return opts.onPut ? await opts.onPut(cmd) : { ETag: '"abc123"' };
      }
      if (name === 'GetObjectCommand') {
        if (opts.onGet) return await opts.onGet(cmd);
        return {
          Body: new ReadableStream({
            start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); },
          }),
          ETag: '"abc123"',
          ContentLength: 3,
        };
      }
      throw new Error(`Unmocked S3 command: ${name}`);
    }) as unknown as S3Client['send'],
  };
}
```

**3. APPEND to `frontend/.env.example`** — do NOT rewrite or reorder existing keys. Append at end:

```ini
# ---------------------------------------------------------------------------
# Upload policy — applied by POST /api/upload
# ---------------------------------------------------------------------------
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
# Optional: override R2 endpoint (e.g. http://localhost:9000 for local Minio).
# Leave empty in prod — defaults to https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com.
R2_ENDPOINT=""

# ---------------------------------------------------------------------------
# Withdrawal policy
# ---------------------------------------------------------------------------
WITHDRAWAL_MIN_AMOUNT="1000"          # smallest currency unit; XOF default → ~1.50 USD
WITHDRAWAL_MAX_AMOUNT=""               # empty = unlimited
WITHDRAWAL_DAILY_LIMIT=""              # empty = unlimited (sum of today's amounts)
WITHDRAWAL_COOLDOWN_HOURS="0"          # 0 = no cooldown between requests
WITHDRAWAL_REQUIRE_PIN="1"             # 1 = require PIN in body on POST

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

**4. EXTEND `frontend/src/lib/server/observability/env-shape.test.ts`** — add a new `describe`/`it` (do not delete existing tests):

```typescript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

describe('env.example phase 4 additions', () => {
  it('contains the verbatim WITHDRAWAL_BALANCE_CHECK FINANCIAL-SAFETY warning', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const envExamplePath = resolve(here, '../../../../.env.example');
    const text = readFileSync(envExamplePath, 'utf8');
    expect(text).toContain('⚠️  FINANCIAL-SAFETY WARNING — DO NOT CASUALLY DISABLE  ⚠️');
    expect(text).toContain('WITHDRAWAL_BALANCE_CHECK="1"');
    expect(text).toContain('UPLOAD_ALLOWED_MIME="image/jpeg,image/png,image/webp"');
    expect(text).toContain('UPLOAD_MAX_BYTES="10485760"');
    expect(text).toMatch(/R2_ACCOUNT_ID=""/);
    expect(text).toContain('R2_ENDPOINT=""');
    expect(text).toContain('WITHDRAWAL_MIN_AMOUNT="1000"');
    expect(text).toContain('WITHDRAWAL_REQUIRE_PIN="1"');
  });
});
```

**Path resolution note:** the test file lives at `frontend/src/lib/server/observability/env-shape.test.ts` (4 levels deep from `frontend/`); `../../../../.env.example` is correct. Verify with the existing test imports — match its path style.

**5. DO NOT add R2_* keys to `frontend/src/lib/server/env.ts`** (Pitfall 6: empty-string Zod rejection). The lazy-init in r2-client.ts handles `?? ''` directly.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/lib/server/upload/r2-client.ts` exists
    - `frontend/src/lib/server/upload/r2-client.ts` contains `export class StorageNotConfiguredError`
    - `frontend/src/lib/server/upload/r2-client.ts` contains `export function getR2Client`
    - `frontend/src/lib/server/upload/r2-client.ts` contains `export function getR2Bucket`
    - `frontend/src/lib/server/upload/r2-client.ts` contains `__resetR2Singleton`
    - `frontend/src/lib/server/upload/r2-client.ts` contains `process.env.R2_ENDPOINT`
    - File `frontend/src/test-utils/r2-mock.ts` exists, exports `mockR2Client`
    - `grep -c "FINANCIAL-SAFETY WARNING" frontend/.env.example` returns ≥ 1
    - `grep -c "UPLOAD_ALLOWED_MIME" frontend/.env.example` returns ≥ 1
    - `grep -c "R2_ENDPOINT" frontend/.env.example` returns ≥ 1
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts` exits 0
    - `grep -c "R2_ACCOUNT_ID" frontend/src/lib/server/env.ts` returns 0 (NOT added to env schema — Pitfall 6)
  </acceptance_criteria>
  <done>R2 lazy-init shipped, mock factory ready, env.example carries verbatim blocks, env-shape test green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend admin-fixtures with withdrawal + PIN seed helpers</name>
  <files>
    - frontend/src/test-utils/admin-fixtures.ts (EXTEND — append helpers; do not rewrite existing)
  </files>
  <read_first>
    - frontend/src/test-utils/admin-fixtures.ts (current content; preserve `buildUser`, `seedActiveUser`, etc.)
    - frontend/prisma/schema.prisma — `Withdrawal` + `User.withdrawalPinHash` shape
    - frontend/src/lib/server/auth/pin.ts (verifyPin uses bcryptjs hashes)
  </read_first>
  <behavior>
    - seedActiveUserWithPin(plainPin): returns user record with withdrawalPinHash = bcrypt hash of plainPin (cost ≤ 4 for test speed). Reuses seedActiveUser shape; does NOT modify it.
    - seedWithdrawal({ userId, amount?, status?, requestedAt?, currency?, destination? }): inserts a Withdrawal row with sensible defaults: amount=1000, currency='XOF', status='PENDING', requestedAt=new Date(), destination={ method: 'WAVE', phone: '+221770000001' }. Returns the full row.
    - Both helpers usable from `app/api/withdrawals/route.test.ts`.
  </behavior>
  <action>
APPEND to `frontend/src/test-utils/admin-fixtures.ts` — do not rewrite. Adopt the same import + style conventions used in the file:

```typescript
import bcrypt from 'bcryptjs';
import type { Prisma, Withdrawal } from '@prisma/client';
// (use existing prisma import in the file; if absent, import from '@/lib/server/prisma')

export async function seedActiveUserWithPin(plainPin: string, overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  // bcrypt cost 4 → fast in tests; production PINs use auth/pin.ts default
  const hash = await bcrypt.hash(plainPin, 4);
  return seedActiveUser({ ...overrides, withdrawalPinHash: hash });
}

export type SeedWithdrawalInput = {
  userId: string;
  amount?: number;
  status?: Withdrawal['status'];
  requestedAt?: Date;
  currency?: string;
  destination?: Prisma.InputJsonValue;
  provider?: string;
};

export async function seedWithdrawal(input: SeedWithdrawalInput): Promise<Withdrawal> {
  return prisma.withdrawal.create({
    data: {
      userId: input.userId,
      amount: input.amount ?? 1000,
      currency: input.currency ?? 'XOF',
      status: input.status ?? 'PENDING',
      destination: input.destination ?? { method: 'WAVE', phone: '+221770000001' },
      provider: input.provider ?? 'bictorys',
      ...(input.requestedAt ? { requestedAt: input.requestedAt } : {}),
    },
  });
}
```

If `seedActiveUser` is not exported from this file (verify by reading), use the closest existing seed helper (e.g., `buildUser` + `prisma.user.create`) and follow that pattern. If neither exists, define a minimal `seedActiveUser` mirroring `buildUser({ status: 'ACTIVE' })` then `prisma.user.create`. Do not break any existing exports.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec tsc -p tsconfig.json --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export async function seedActiveUserWithPin" frontend/src/test-utils/admin-fixtures.ts` returns 1
    - `grep -c "export async function seedWithdrawal" frontend/src/test-utils/admin-fixtures.ts` returns 1
    - `grep -c "bcrypt.hash(plainPin, 4)" frontend/src/test-utils/admin-fixtures.ts` returns 1
    - All previous exports in admin-fixtures.ts preserved (diff shows only additions)
    - `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
  </acceptance_criteria>
  <done>Fixtures extended; tests in next task can call both helpers without errors.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Write 3 RED test files (upload, files, withdrawals)</name>
  <files>
    - frontend/src/app/api/upload/route.test.ts (NEW)
    - frontend/src/app/api/files/[...key]/route.test.ts (NEW)
    - frontend/src/app/api/withdrawals/route.test.ts (NEW)
  </files>
  <read_first>
    - frontend/src/test-utils/r2-mock.ts (just-created)
    - frontend/src/test-utils/admin-fixtures.ts (just-extended)
    - frontend/src/test-utils/prisma-mock.ts (existing pattern)
    - frontend/src/test-utils/mock-cookies.ts (existing CSRF + auth cookie pattern)
    - .planning/phases/04-upload-files-withdrawals/04-VALIDATION.md (per-test names — match `-t "..."` filters)
    - .planning/phases/04-upload-files-withdrawals/04-RESEARCH.md Pattern 1, 3, 4, 5 + Examples 1, 2
  </read_first>
  <behavior>
    UPLOAD route.test.ts (≥9 cases — match exact `-t` strings from VALIDATION.md):
    - "valid jpeg uploads" — 0xFF 0xD8 0xFF magic + image/jpeg → 201, body has `key`, prisma.fileUpload.create called
    - "magic byte mismatch" — declared image/jpeg but PDF magic (0x25 0x50 0x44 0x46) → 415 + code MAGIC_BYTE_MISMATCH
    - "mime not allowed" — declared image/gif (not in default allowlist) → 415 + INVALID_MIME
    - "file too large" — file.size > UPLOAD_MAX_BYTES → 413 + FILE_TOO_LARGE
    - "storage not configured" — R2_* envs unset → 503 + STORAGE_NOT_CONFIGURED
    - "missing file" — empty FormData → 400 + UPLOAD_MISSING_FILE
    - "upload failed" — mockR2Client onPut throws → 502 + UPLOAD_FAILED
    - "csrf" — no x-csrf-token header → 403
    - "no auth" — no auth cookie → 401

    FILES route.test.ts (≥6 cases):
    - "owner streams" — authenticated user matches FileUpload.userId → 200 + Content-Type, Cache-Control: private, max-age=3600, ETag forwarded
    - "missing" — key not in DB → 404 + FILE_NOT_FOUND
    - "owner mismatch" — auth user != FileUpload.userId → 404 (collapse to FILE_NOT_FOUND)
    - "storage not configured" — R2_* unset → 503
    - "r2 nosuch" — onGet throws NoSuchKey → 404
    - "anonymous" — FileUpload.userId is null → public-readable (200) for any auth user

    WITHDRAWALS route.test.ts (≥10 cases):
    - "happy path" — PIN set, balance sufficient → 201 + status PENDING + withdrawalId
    - "advisory lock" — assert lockUserTx is called as first statement inside tx (spy on lockUserTx, assert tx.callOrder)
    - "error codes" — table-driven over all 8 codes (PIN_NOT_SET, PIN_REQUIRED, PIN_INVALID, AMOUNT_BELOW_MIN, AMOUNT_ABOVE_MAX, DAILY_LIMIT_EXCEEDED, COOLDOWN_ACTIVE, INSUFFICIENT_BALANCE) — each with the exact HTTP status returned by validateWithdrawalRequest
    - "invalid body" — missing amount → 400 + INVALID_BODY; bad phone (+0) → 400; bad enum → 400
    - "csrf|auth" — no CSRF header → 403; no auth cookie → 401
    - "GET own" — returns user's withdrawals ordered requestedAt DESC
    - "GET cursor" — limit=2 with seed 3 rows → first call returns 2 + nextCursor, second call (with cursor) returns 1 + nextCursor null
    - "GET isolation" — seed user A 2 + user B 3 → GET as user A returns 2
    - "balance check default" — WITHDRAWAL_BALANCE_CHECK unset, amount > balance → INSUFFICIENT_BALANCE
    - "balance check disabled" — WITHDRAWAL_BALANCE_CHECK=0, same excessive amount → 201
  </behavior>
  <action>
**File 1: `frontend/src/app/api/upload/route.test.ts`** — RED skeleton. The route module does not yet exist (Wave 1 will create it). Use dynamic `await import('./route')` inside each test; the missing module causes RED. Mock `@/lib/server/upload/r2-client.ts` via `vi.mock` and inject the mock R2 client.

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockR2Client } from '@/test-utils/r2-mock';

const r2 = mockR2Client();

vi.mock('@/lib/server/upload/r2-client', () => ({
  getR2Client: vi.fn(() => r2),
  getR2Bucket: vi.fn(() => 'test-bucket'),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {
    constructor() { super('Storage not configured'); this.name = 'StorageNotConfiguredError'; }
  },
}));

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

const prismaCreate = vi.fn(async (args: unknown) => ({
  id: 'fu-1',
  key: (args as { data: { key: string } }).data.key,
  filename: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 4,
  createdAt: new Date(),
}));
vi.mock('@/lib/server/prisma', () => ({
  prisma: { fileUpload: { create: prismaCreate } },
}));

beforeEach(() => {
  vi.stubEnv('UPLOAD_ALLOWED_MIME', 'image/jpeg,image/png,image/webp');
  vi.stubEnv('UPLOAD_MAX_BYTES', '10485760');
  vi.stubEnv('R2_ACCOUNT_ID', 'acct');
  vi.stubEnv('R2_BUCKET', 'bucket');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function makeReq(file: File | null, opts: { csrf?: boolean; auth?: boolean } = { csrf: true, auth: true }) {
  const fd = new FormData();
  if (file) fd.append('file', file);
  const headers = new Headers();
  if (opts.csrf !== false) headers.set('x-csrf-token', 'test-csrf');
  // cookie injection if your auth mock honors it
  return new Request(new URL('http://localhost/api/upload'), { method: 'POST', body: fd, headers });
}

describe('POST /api/upload', () => {
  it('valid jpeg uploads', async () => {
    const { POST } = await import('./route');
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'photo.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(jpeg) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^user-1\/.+\.jpg$/);
    expect(prismaCreate).toHaveBeenCalled();
  });

  it('magic byte mismatch', async () => {
    const { POST } = await import('./route');
    // PDF magic 0x25 0x50 0x44 0x46 in a .jpg file with image/jpeg type
    const fake = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'photo.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(fake) as never);
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe('MAGIC_BYTE_MISMATCH');
  });

  it('mime not allowed', async () => {
    const { POST } = await import('./route');
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], 'a.gif', { type: 'image/gif' });
    const res = await POST(makeReq(gif) as never);
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe('INVALID_MIME');
  });

  it('file too large', async () => {
    vi.stubEnv('UPLOAD_MAX_BYTES', '10');
    const { POST } = await import('./route');
    const big = new File([new Uint8Array(50)], 'big.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(big) as never);
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('FILE_TOO_LARGE');
  });

  it('storage not configured', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', '');
    const { getR2Client, StorageNotConfiguredError } = await import('@/lib/server/upload/r2-client');
    (getR2Client as Mock).mockImplementationOnce(() => { throw new StorageNotConfiguredError(); });
    const { POST } = await import('./route');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(f) as never);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('missing file', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq(null) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('UPLOAD_MISSING_FILE');
  });

  it('upload failed', async () => {
    const { getR2Client } = await import('@/lib/server/upload/r2-client');
    (getR2Client as Mock).mockReturnValueOnce({
      send: vi.fn(async () => { throw new Error('R2 down'); }),
    });
    const { POST } = await import('./route');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(f) as never);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('UPLOAD_FAILED');
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { POST } = await import('./route');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(f, { csrf: false, auth: true }) as never);
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    (requireAuth as Mock).mockReturnValueOnce(new Response(null, { status: 401 }));
    const { POST } = await import('./route');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(f) as never);
    expect(res.status).toBe(401);
  });
});
```

**File 2: `frontend/src/app/api/files/[...key]/route.test.ts`** — same vi.mock pattern; mock prisma.fileUpload.findUnique, mock R2 GetObject. Test names per VALIDATION.md table. Cover all 6 behaviors above.

Key skeleton:
```typescript
const findUnique = vi.fn();
vi.mock('@/lib/server/prisma', () => ({ prisma: { fileUpload: { findUnique } } }));

it('owner streams', async () => {
  findUnique.mockResolvedValueOnce({ userId: 'user-1', mimeType: 'image/jpeg', filename: 'a.jpg' });
  const { GET } = await import('./route');
  const req = new Request('http://localhost/api/files/user-1/x.jpg');
  const res = await GET(req as never, { params: Promise.resolve({ key: ['user-1', 'x.jpg'] }) });
  expect(res.status).toBe(200);
  expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
  expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  expect(res.headers.get('ETag')).toBe('"abc123"');
});

it('missing → 404', async () => {
  findUnique.mockResolvedValueOnce(null);
  /* ... */
  expect(res.status).toBe(404);
  expect((await res.json()).code).toBe('FILE_NOT_FOUND');
});

it('owner mismatch returns 404 (no enumeration)', async () => {
  findUnique.mockResolvedValueOnce({ userId: 'user-2', mimeType: 'image/jpeg', filename: 'a.jpg' });
  /* ... */
  expect(res.status).toBe(404);
  expect((await res.json()).code).toBe('FILE_NOT_FOUND'); // NOT FILE_FORBIDDEN
});

it('r2 nosuch → 404', async () => {
  findUnique.mockResolvedValueOnce({ userId: 'user-1', mimeType: 'image/jpeg', filename: 'a.jpg' });
  const noSuch = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
  const r2 = mockR2Client({ onGet: vi.fn(async () => { throw noSuch; }) });
  vi.mocked((await import('@/lib/server/upload/r2-client')).getR2Client).mockReturnValueOnce(r2 as never);
  /* ... */
  expect(res.status).toBe(404);
});

it('anonymous public-readable', async () => {
  findUnique.mockResolvedValueOnce({ userId: null, mimeType: 'image/jpeg', filename: 'a.jpg' });
  /* ... */
  expect(res.status).toBe(200);
});

it('storage not configured returns 503', async () => { /* same pattern as upload */ });
```

For `NoSuchKey` import use `vi.importActual` or test the route's check by making the mock throw an error whose `name` is `'NoSuchKey'` — the route MUST match by name (verified by RESEARCH).

**File 3: `frontend/src/app/api/withdrawals/route.test.ts`** — table-driven. Mock prisma.$transaction + lockUserTx + validateWithdrawalRequest + createDefaultBalanceComputer + verifyPin + createNotification + prisma.withdrawal.{create,findMany}. Each test stubs validateWithdrawalRequest to return the relevant `{ ok: false, status, code, message }` row.

Skeleton:
```typescript
const lockSpy = vi.fn();
vi.mock('@/lib/server/withdrawals/lock', () => ({ lockUserTx: lockSpy }));

const validateMock = vi.fn();
vi.mock('@/lib/server/withdrawals/guards', () => ({
  loadGuardConfigFromEnv: vi.fn(() => ({ /* defaults */ })),
  validateWithdrawalRequest: validateMock,
}));

vi.mock('@/lib/server/withdrawals/balance', () => ({
  createDefaultBalanceComputer: vi.fn(() => async () => 5000),
}));

const createNotif = vi.fn();
vi.mock('@/lib/server/notifications', () => ({ createNotification: createNotif }));

vi.mock('@/lib/server/auth/pin', () => ({ verifyPin: vi.fn(async () => true) }));

const txCallOrder: string[] = [];
const txClient = {
  user: { findUnique: vi.fn(async () => ({ withdrawalPinHash: 'hash' })) },
  withdrawal: {
    create: vi.fn(async () => ({ id: 'w-1', status: 'PENDING', amount: 1000, currency: 'XOF', requestedAt: new Date() })),
    findMany: vi.fn(),
  },
  notification: { create: vi.fn() },
};
const $transaction = vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>, opts: unknown) => {
  // record opts for "advisory lock" test → assert isolationLevel
  return fn(txClient);
});
vi.mock('@/lib/server/prisma', () => ({
  prisma: { $transaction, withdrawal: { findMany: vi.fn() } },
}));

const codeTable: Array<[string, number]> = [
  ['PIN_NOT_SET', 422], ['PIN_REQUIRED', 422], ['PIN_INVALID', 403],
  ['AMOUNT_BELOW_MIN', 422], ['AMOUNT_ABOVE_MAX', 422],
  ['DAILY_LIMIT_EXCEEDED', 422], ['COOLDOWN_ACTIVE', 422], ['INSUFFICIENT_BALANCE', 422],
];

it.each(codeTable)('error codes: %s → %i', async (code, status) => {
  validateMock.mockResolvedValueOnce({ ok: false, status, code, message: code });
  const { POST } = await import('./route');
  const req = makePostReq({ amount: 1000, currency: 'XOF', destination: { method: 'WAVE', phone: '+221770000001' }, pin: '1234' });
  const res = await POST(req as never);
  expect(res.status).toBe(status);
  expect((await res.json()).code).toBe(code);
});

it('happy path', async () => {
  validateMock.mockResolvedValueOnce({ ok: true });
  const { POST } = await import('./route');
  const res = await POST(makePostReq({ amount: 1000, currency: 'XOF', destination: { method: 'WAVE', phone: '+221770000001' }, pin: '1234' }) as never);
  expect(res.status).toBe(201);
  expect(lockSpy).toHaveBeenCalled();
});

it('advisory lock — Serializable isolation + lockUserTx first', async () => {
  validateMock.mockResolvedValueOnce({ ok: true });
  const { POST } = await import('./route');
  await POST(makePostReq({ /* valid */ }) as never);
  const opts = $transaction.mock.calls[0]?.[1] as { isolationLevel: string };
  expect(opts.isolationLevel).toBe('Serializable');
  expect(lockSpy).toHaveBeenCalledBefore(txClient.user.findUnique);
});

it('invalid body — missing amount', async () => { /* 400 INVALID_BODY */ });
it('invalid body — bad phone', async () => { /* 400 */ });
it('invalid body — bad enum', async () => { /* 400 */ });
it('csrf missing → 403', async () => { /* mock verifyCsrf to return 403 */ });
it('no auth → 401', async () => { /* mock requireAuth to return 401 */ });

// GET tests:
const findManyTop = vi.fn();
beforeEach(() => { findManyTop.mockReset(); });
// In vi.mock for prisma, also expose prisma.withdrawal.findMany via top-level (not tx)
// to back the GET handler.

it('GET own — ordered requestedAt DESC', async () => {
  findManyTop.mockResolvedValueOnce([
    { id: 'w-2', requestedAt: new Date('2026-05-08'), userId: 'user-1', /* ... */ },
    { id: 'w-1', requestedAt: new Date('2026-05-07'), userId: 'user-1', /* ... */ },
  ]);
  const { GET } = await import('./route');
  const res = await GET(new Request('http://localhost/api/withdrawals') as never);
  const body = await res.json();
  expect(body.items[0].id).toBe('w-2');
});

it('GET cursor — paginates', async () => { /* limit=2 + 3 rows → first call slices, returns nextCursor; second decodes cursor and resolves last 1 */ });
it('GET isolation — scope by userId', async () => { /* assert findMany called with where.userId === auth user */ });

it('balance check default — INSUFFICIENT_BALANCE', async () => {
  validateMock.mockResolvedValueOnce({ ok: false, status: 422, code: 'INSUFFICIENT_BALANCE', message: 'Insufficient' });
  const { POST } = await import('./route');
  const res = await POST(makePostReq({ amount: 999_999_999, /* ... */ }) as never);
  expect((await res.json()).code).toBe('INSUFFICIENT_BALANCE');
});

it('balance check disabled — bypasses', async () => {
  vi.stubEnv('WITHDRAWAL_BALANCE_CHECK', '0');
  validateMock.mockResolvedValueOnce({ ok: true }); // route trusts loadGuardConfigFromEnv to skip
  const { POST } = await import('./route');
  const res = await POST(makePostReq({ amount: 999_999_999, /* ... */ }) as never);
  expect(res.status).toBe(201);
});

function makePostReq(body: unknown) {
  return new Request('http://localhost/api/withdrawals', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': 'test-csrf' },
    body: JSON.stringify(body),
  });
}
```

These tests will all FAIL until Wave 1 ships the routes. RED is the goal.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals --reporter=verbose 2>&1 | grep -E "(Tests|FAIL|test files)" | head -10</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/upload/route.test.ts` exists, contains `it('valid jpeg uploads'`, `it('magic byte mismatch'`, `it('mime not allowed'`, `it('file too large'`, `it('storage not configured'`, `it('missing file'`, `it('upload failed'`, `csrf`, `no auth`
    - File `frontend/src/app/api/files/[...key]/route.test.ts` exists, contains `owner streams`, `missing`, `owner mismatch`, `storage not configured`, `r2 nosuch`, `anonymous`
    - File `frontend/src/app/api/withdrawals/route.test.ts` exists, contains `happy path`, `advisory lock`, `error codes`, `invalid body`, `GET own`, `GET cursor`, `GET isolation`, `balance check default`, `balance check disabled`
    - All tests RED (route modules do not yet exist) — Vitest reports failing tests, NOT setup errors. `pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals` exits non-zero with "Cannot find module './route'" or equivalent (RED is correct here)
    - `grep -c "it.each(codeTable" frontend/src/app/api/withdrawals/route.test.ts` returns ≥ 1
    - No protected files modified (`git diff --name-only` lists only the 3 test files)
  </acceptance_criteria>
  <done>3 RED test files committed; Vitest fails with module-not-found, NOT with setup errors.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer→repo | `.env.example` is checked into git; secret values must remain placeholder strings only |
| test→production | Test fixtures (bcrypt cost 4, PIN seeds) must never run in production code paths |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-01-01 | I (Information disclosure) | r2-client env reads | mitigate | `getR2Client()` returns typed `StorageNotConfiguredError` with no leaked credentials in message; route translates to 503 + `{ code: 'STORAGE_NOT_CONFIGURED' }` (no env values in payload). |
| T-04-01-02 | T (Tampering) | `.env.example` warning block | mitigate | env-shape.test.ts asserts the FINANCIAL-SAFETY warning string verbatim — accidental edits/refactors that strip it fail CI. |
| T-04-01-03 | S (Spoofing) | seed fixtures (`seedActiveUserWithPin`) | accept | bcrypt cost 4 is deliberate test-speed knob; helper is `import 'server-only'` adjacent and never imported by production routes. Production PIN flows use `auth/pin.ts` defaults. |
| T-04-01-04 | I | empty-string env in env.ts | mitigate | Pitfall 6 — R2_* keys deliberately NOT added to `env.ts` Zod schema; lazy-init handles `?? ''` empty-as-absent. Acceptance criterion 11 enforces. |
| T-04-01-05 | E (Elevation of privilege) | bcrypt import in test-utils | accept | bcryptjs is already a Phase 1/2 prod dep; no new attack surface added. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/lib/server/observability/env-shape.test.ts` exits 0
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
- `pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals` exits non-zero (RED — routes not yet built)
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0 (no new routes yet — still passing)
- No file from CLAUDE.md "Files Claude must NOT modify" list was touched
</verification>

<success_criteria>
- 3 RED test files exist with all behavioral cases per VALIDATION.md `-t` strings
- `r2-client.ts` shipped with lazy-init + StorageNotConfiguredError + R2_ENDPOINT optional override
- `r2-mock.ts` factory exports `mockR2Client({ onPut?, onGet? })`
- `admin-fixtures.ts` extended with `seedActiveUserWithPin` + `seedWithdrawal` (existing exports preserved)
- `frontend/.env.example` carries verbatim UPLOAD + R2 + WITHDRAWAL blocks including FINANCIAL-SAFETY WARNING
- env-shape.test.ts assertion green
- R2_* keys NOT added to env.ts Zod schema
</success_criteria>

<output>
After completion, create `.planning/phases/04-upload-files-withdrawals/04-01-SUMMARY.md` capturing:
- Files created/modified (8 files)
- Test counts (≥9 + ≥6 + ≥10 = ≥25 RED tests)
- Wave 1 readiness signal (routes can now be built test-first)
- Any deviation from plan (e.g., if `seedActiveUser` had to be created from scratch)
</output>
