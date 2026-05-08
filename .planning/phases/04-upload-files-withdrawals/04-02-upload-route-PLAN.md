---
phase: 04-upload-files-withdrawals
plan: 02
type: execute
wave: 1
depends_on:
  - 04-01
files_modified:
  - frontend/src/app/api/upload/route.ts
autonomous: true
requirements:
  - UP-01
must_haves:
  truths:
    - "Authenticated user can POST a JPEG and receive 201 + key"
    - "POST with PDF magic bytes declared as image/jpeg returns 415 MAGIC_BYTE_MISMATCH"
    - "POST with MIME outside UPLOAD_ALLOWED_MIME returns 415 INVALID_MIME"
    - "POST with file > UPLOAD_MAX_BYTES returns 413 FILE_TOO_LARGE"
    - "POST without R2 creds returns 503 STORAGE_NOT_CONFIGURED"
    - "POST without CSRF returns 403; without auth returns 401"
  artifacts:
    - path: "frontend/src/app/api/upload/route.ts"
      provides: "POST /api/upload — multipart upload with magic-byte sniff + R2 PUT + DB record"
      exports: ["POST", "runtime"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/upload/route.ts"
      to: "frontend/src/lib/server/upload/sniff.ts"
      via: "verifyMagicBytes(buf, file.type)"
      pattern: "verifyMagicBytes"
    - from: "frontend/src/app/api/upload/route.ts"
      to: "frontend/src/lib/server/upload/r2-client.ts"
      via: "getR2Client()"
      pattern: "getR2Client"
    - from: "frontend/src/app/api/upload/route.ts"
      to: "prisma.fileUpload"
      via: "create({ data: { userId, key, filename, mimeType, sizeBytes } })"
      pattern: "prisma\\.fileUpload\\.create"
---

<objective>
Ship `POST /api/upload`: multipart form upload, size + MIME + magic-byte gates, R2 PUT, DB record. Implements UP-01.

Purpose: The money path requires file uploads (KYC docs, profile photos) that cannot be trivially spoofed. This route is the single authenticated entry point for binary content into R2 and is the contract every fork extends.

Output: One route handler file that turns the Wave 0 RED tests GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/04-upload-files-withdrawals/04-CONTEXT.md
@.planning/phases/04-upload-files-withdrawals/04-RESEARCH.md
@.planning/phases/04-upload-files-withdrawals/04-VALIDATION.md
@CLAUDE.md

@frontend/src/lib/server/upload/sniff.ts
@frontend/src/lib/server/upload/r2-client.ts
@frontend/src/lib/server/middleware/index.ts
@frontend/src/lib/server/auth.ts
@frontend/src/lib/server/observability/request-context.ts
@frontend/src/app/api/upload/route.test.ts

<interfaces>
From frontend/src/lib/server/upload/sniff.ts:
```typescript
export function verifyMagicBytes(
  buf: Buffer,
  declaredMime: string,
): { match: boolean; sniffed: boolean };
// sniffed=false → no sniffer for this MIME → log warn + allow (per docs)
```

From frontend/src/lib/server/upload/r2-client.ts (just shipped Wave 0):
```typescript
export function getR2Client(): S3Client;
export function getR2Bucket(): string;
export class StorageNotConfiguredError extends Error;
```

From @aws-sdk/client-s3:
```typescript
new PutObjectCommand({ Bucket, Key, Body: Buffer, ContentType, ContentLength });
// .send() returns { ETag, ... } or throws on network/4xx/5xx
```

Verified Prisma model:
```prisma
model FileUpload {
  id        String   @id @default(cuid())
  userId    String?
  key       String   @unique
  filename  String
  mimeType  String
  sizeBytes Int
  createdAt DateTime @default(now())
}
```
</interfaces>

<reference_patterns>
- Mutating route shape: `verifyCsrf → requireAuth → withRequestContext → handler` (Phase 3 admin routes)
- Reference: `frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` — same `csrf+auth` opening; copy that opening style
- Magic-byte sniff happens AFTER size + MIME pass (D-UP-04 — read bytes only after gates)
</reference_patterns>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement POST /api/upload route handler</name>
  <files>
    - frontend/src/app/api/upload/route.ts (NEW)
  </files>
  <read_first>
    - frontend/src/app/api/upload/route.test.ts (the contract — every test must pass)
    - frontend/src/lib/server/upload/sniff.ts (verifyMagicBytes signature)
    - frontend/src/lib/server/upload/r2-client.ts (getR2Client + getR2Bucket + StorageNotConfiguredError)
    - frontend/src/lib/server/middleware/index.ts (requireAuth signature)
    - frontend/src/lib/server/auth.ts (verifyCsrf signature)
    - frontend/src/lib/server/observability/request-context.ts (makeRequestContext + withRequestContext)
    - .planning/phases/04-upload-files-withdrawals/04-RESEARCH.md Pattern 1 (verbatim implementation reference)
  </read_first>
  <behavior>
    1. `runtime = 'nodejs'` exported (CI-enforced by runtime-enforcement.test.ts)
    2. CSRF check first — bail with returned NextResponse if not null
    3. Auth check second — bail with returned NextResponse if instanceof NextResponse
    4. Lazy-init R2; catch StorageNotConfiguredError → 503 STORAGE_NOT_CONFIGURED
    5. Parse formData; if `file` field is missing/not a File → 400 UPLOAD_MISSING_FILE
    6. Size check: file.size > UPLOAD_MAX_BYTES → 413 FILE_TOO_LARGE
    7. MIME allowlist check: file.type not in UPLOAD_ALLOWED_MIME → 415 INVALID_MIME
    8. Read bytes via file.arrayBuffer(); verifyMagicBytes; if sniffed && !match → 415 MAGIC_BYTE_MISMATCH
    9. Compute key: `${auth.user.sub}/${randomUUID()}.${ext}` (D-UP key naming locked by RESEARCH important_notes)
    10. R2 PUT via PutObjectCommand; on throw → 502 UPLOAD_FAILED
    11. prisma.fileUpload.create with userId, key, filename, mimeType, sizeBytes; return 201 with row + x-request-id header
  </behavior>
  <action>
Create `frontend/src/app/api/upload/route.ts` exactly per RESEARCH Pattern 1. Verbatim skeleton:

```typescript
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { verifyMagicBytes } from '@/lib/server/upload/sniff';
import {
  getR2Client,
  getR2Bucket,
  StorageNotConfiguredError,
} from '@/lib/server/upload/r2-client';
import { prisma } from '@/lib/server/prisma';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    // Read env at handler-call time (Pitfall 5 — never module-top, supports vi.stubEnv)
    const allowedMime = (process.env.UPLOAD_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const maxBytes = Number.parseInt(process.env.UPLOAD_MAX_BYTES ?? '10485760', 10);

    let r2;
    let bucket: string;
    try {
      r2 = getR2Client();
      bucket = getR2Bucket();
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        return NextResponse.json(
          { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw e;
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { code: 'UPLOAD_MISSING_FILE', message: 'file field is required' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (file.size > maxBytes) {
      return NextResponse.json(
        { code: 'FILE_TOO_LARGE', message: `Max ${maxBytes} bytes` },
        { status: 413, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (!allowedMime.includes(file.type)) {
      return NextResponse.json(
        { code: 'INVALID_MIME', message: `MIME ${file.type} not allowed` },
        { status: 415, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // Read bytes only AFTER size + MIME gates (D-UP-04)
    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const { match, sniffed } = verifyMagicBytes(buf, file.type);
    if (sniffed && !match) {
      return NextResponse.json(
        { code: 'MAGIC_BYTE_MISMATCH', message: 'File bytes do not match declared MIME' },
        { status: 415, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    // sniffed=false → operator opted into a MIME we don't sniff; allow (per sniff.ts docs)

    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    const key = `${auth.user.sub}/${randomUUID()}.${ext}`;

    try {
      await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buf,
          ContentType: file.type,
          ContentLength: file.size,
        }),
      );
    } catch {
      return NextResponse.json(
        { code: 'UPLOAD_FAILED', message: 'Storage write failed' },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const row = await prisma.fileUpload.create({
      data: {
        userId: auth.user.sub,
        key,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      },
      select: {
        id: true,
        key: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });

    return NextResponse.json(row, {
      status: 201,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}
```

**Critical:**
- Do NOT add `runtime = 'edge'` — fail CI guaranteed
- Do NOT call `req.formData()` more than once
- Do NOT compute key from `file.name` directly — `randomUUID()` prevents collisions and path-traversal via filename
- Do NOT modify any of: `sniff.ts`, `r2-client.ts` (just-shipped Wave 0), `middleware/index.ts`, `auth.ts`
- `verifyCsrf(req)` returns `NextResponse | null` — bail when truthy
- `requireAuth()` (no args — current monolith signature; verify by reading `middleware/index.ts`) returns `Context | NextResponse`
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/upload/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "verifyCsrf(req)" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "requireAuth" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "verifyMagicBytes" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "PutObjectCommand" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "STORAGE_NOT_CONFIGURED" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "MAGIC_BYTE_MISMATCH" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "UPLOAD_FAILED" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "INVALID_MIME" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "FILE_TOO_LARGE" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "UPLOAD_MISSING_FILE" frontend/src/app/api/upload/route.ts` returns 1
    - `grep -c "randomUUID" frontend/src/app/api/upload/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts` exits 0 (all 9 tests GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
    - No protected file modified (`git diff --name-only` lists only `frontend/src/app/api/upload/route.ts`)
  </acceptance_criteria>
  <done>POST /api/upload returns 201 with key on valid JPEG; all 9 RED tests now GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client→API | Untrusted multipart body — File.type, File.name, file bytes all attacker-controlled |
| API→R2 | Server-issued PutObjectCommand with derived key; bucket access scoped by R2 IAM |
| API→DB | prisma.fileUpload.create receives sanitized fields only |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-02-01 | T (Tampering) | client-supplied `File.type` | mitigate | `verifyMagicBytes(buf, file.type)` enforces actual byte signatures match declared MIME. CF-13 + sniff.ts check after MIME allowlist. |
| T-04-02-02 | I (Information disclosure) | path traversal via `file.name` in R2 key | mitigate | Key built from `randomUUID()`, NOT from `file.name`. Only the extension is taken (and lowercased). Filename is stored as-is in DB but never injected into the storage path. |
| T-04-02-03 | D (DoS) | unbounded body size | mitigate | `file.size > UPLOAD_MAX_BYTES` checked BEFORE `arrayBuffer()` allocates bytes. Default 10 MB cap. |
| T-04-02-04 | I | R2 credential leak in error response | mitigate | `StorageNotConfiguredError` message has no creds; route returns generic `{ code: 'STORAGE_NOT_CONFIGURED' }` with no env values. R2 send-throw → generic UPLOAD_FAILED, no SDK error detail forwarded. |
| T-04-02-05 | T | XSS via uploaded text/csv when operator extends UPLOAD_ALLOWED_MIME | accept | sniff.ts logs `warn` at boot for un-sniffable MIMEs (per docs). Operator opted in. Documented in `.env.example` UPLOAD_ALLOWED_MIME comment. |
| T-04-02-06 | E | unauthenticated upload | mitigate | `requireAuth()` returns `NextResponse(401)` on missing/invalid cookie; route bails before any state mutation. |
| T-04-02-07 | S (Spoofing) | CSRF via cross-origin POST | mitigate | `verifyCsrf(req)` (Phase 1 helper) checks `x-csrf-token` header echoes `<prefix>-csrf` cookie; bail before formData parse. |
| T-04-02-08 | I | DB row contains attacker-controlled `filename` | accept | `filename` stored as-is for display only; sanitize at render time per CONVENTIONS. No SQL injection (Prisma parameterizes); no direct interpolation into HTML in API. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/upload/route.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0 (route exports `runtime='nodejs'`)
- `pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals` shows upload tests green, others still RED (Wave 1 sibling plans pending)
- No protected file modified
</verification>

<success_criteria>
- `POST /api/upload` route handler shipped with 9 distinct error/success branches per VALIDATION.md
- Magic-byte sniff via `verifyMagicBytes` — never trusts `File.type` alone (CF-13)
- R2 lazy-init via `getR2Client()`; 503 on missing creds (no env values leaked)
- Key naming `{userId}/{cuid}.{ext}` per RESEARCH important_notes
- All 9 Wave 0 RED tests for upload now GREEN
</success_criteria>

<output>
After completion, create `.planning/phases/04-upload-files-withdrawals/04-02-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (9 of 9 from upload.test.ts)
- Any deviation from RESEARCH Pattern 1 (e.g., requireAuth signature differs from sample)
- Open follow-ups (e.g., live R2 smoke deferred to Phase 4 HUMAN-UAT)
</output>
