---
phase: 04-upload-files-withdrawals
plan: 03
type: execute
wave: 1
depends_on:
  - 04-01
files_modified:
  - frontend/src/app/api/files/[...key]/route.ts
autonomous: true
requirements:
  - UP-02
must_haves:
  truths:
    - "Owner of a FileUpload row can stream the file body via GET /api/files/{key}"
    - "Non-owner request collapses to 404 FILE_NOT_FOUND (no key existence enumeration)"
    - "Anonymous-uploaded rows (userId null) are publicly readable to any authenticated user"
    - "R2 NoSuchKey returns 404; missing creds returns 503; default cache is private, max-age=3600 with ETag forwarded"
  artifacts:
    - path: "frontend/src/app/api/files/[...key]/route.ts"
      provides: "GET /api/files/[...key] — owner-gated R2 stream proxy"
      exports: ["GET", "runtime"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/files/[...key]/route.ts"
      to: "prisma.fileUpload.findUnique({ where: { key } })"
      via: "owner gate on FileUpload.userId"
      pattern: "fileUpload\\.findUnique"
    - from: "frontend/src/app/api/files/[...key]/route.ts"
      to: "frontend/src/lib/server/upload/r2-client.ts"
      via: "getR2Client + getR2Bucket"
      pattern: "GetObjectCommand"
    - from: "frontend/src/app/api/files/[...key]/route.ts"
      to: "Web ReadableStream → Response constructor"
      via: "direct stream pipe (no transformToByteArray)"
      pattern: "new (Response|NextResponse)\\(.*Body"
---

<objective>
Ship `GET /api/files/[...key]`: owner-gated R2 stream proxy. Implements UP-02. Streams file bytes from R2 directly into the response without buffering.

Purpose: Without this route, uploaded files are inaccessible — uploads alone are useless. Owner-only by default keeps the contract narrow; forks enable public sharing by editing this single rule (D-FILE-01).

Output: One catch-all route handler that turns the Wave 0 RED files-test cases GREEN.
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

@frontend/src/lib/server/upload/r2-client.ts
@frontend/src/lib/server/middleware/index.ts
@frontend/src/lib/server/observability/request-context.ts
@frontend/src/app/api/files/[...key]/route.test.ts

<interfaces>
From frontend/src/lib/server/upload/r2-client.ts:
```typescript
export function getR2Client(): S3Client;
export function getR2Bucket(): string;
export class StorageNotConfiguredError extends Error;
```

From @aws-sdk/client-s3 v3.1044.0:
```typescript
import { GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
new GetObjectCommand({ Bucket, Key });
// .send() resolves { Body: ReadableStream<Uint8Array>, ETag, ContentLength, ... }
// .send() throws NoSuchKey when key absent in bucket
```
**Important:** `Body` is a Web `ReadableStream` on Node 18+ (we are on Node ≥20 per CLAUDE.md engines). Pass directly to `new Response(body, init)` — do NOT call `.transformToByteArray()` (Pitfall 3 — breaks streaming).

Verified Prisma model:
```prisma
model FileUpload { userId String? @optional ... key String @unique mimeType String filename String }
```
</interfaces>

<reference_patterns>
- Catch-all route signature for Next.js 16 App Router: `export async function GET(req, { params }: { params: Promise<{ key: string[] }> })`
  — params is a Promise in Next 16 (must `await`)
- D-FILE-03 — collapse 403 to 404 on owner-mismatch (no enumeration oracle)
- D-FILE-02 — `Cache-Control: private, max-age=3600` (browser cache, no CDN)
- D-FILE-04 — stream directly; do not buffer
- Reference: RESEARCH Pattern 3 (verbatim implementation reference)
</reference_patterns>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement GET /api/files/[...key] streaming route</name>
  <files>
    - frontend/src/app/api/files/[...key]/route.ts (NEW)
  </files>
  <read_first>
    - frontend/src/app/api/files/[...key]/route.test.ts (the contract — all 6 tests must pass)
    - frontend/src/lib/server/upload/r2-client.ts (getR2Client + getR2Bucket + StorageNotConfiguredError)
    - frontend/src/lib/server/middleware/index.ts (requireAuth signature — note: GET, no CSRF)
    - frontend/src/lib/server/observability/request-context.ts (makeRequestContext + withRequestContext)
    - .planning/phases/04-upload-files-withdrawals/04-RESEARCH.md Pattern 3 (verbatim)
  </read_first>
  <behavior>
    1. `runtime = 'nodejs'` exported (CI guard)
    2. NO CSRF check (GET is safe)
    3. requireAuth() — bail with NextResponse on 401
    4. params is Promise<{ key: string[] }> — await + join('/')
    5. Lookup FileUpload by key:
       - Not found → 404 FILE_NOT_FOUND
       - Owner mismatch (row.userId !== null && row.userId !== auth.user.sub) → 404 FILE_NOT_FOUND (collapse, do NOT 403)
       - userId null → public-readable for any auth user (D-FILE-01)
    6. Lazy R2 init; StorageNotConfiguredError → 503 STORAGE_NOT_CONFIGURED
    7. R2 GetObjectCommand:
       - Throws NoSuchKey → 404 FILE_NOT_FOUND
       - Body null/undefined → 404 FILE_NOT_FOUND
    8. Build Response: Content-Type from row.mimeType; Cache-Control: private, max-age=3600; ETag forwarded; Content-Length forwarded; pass body ReadableStream directly to Response constructor (no buffering)
  </behavior>
  <action>
Create `frontend/src/app/api/files/[...key]/route.ts` per RESEARCH Pattern 3. Verbatim:

```typescript
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import { requireAuth } from '@/lib/server/middleware';
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { key: keyParts } = await params;
    const key = keyParts.join('/');

    const row = await prisma.fileUpload.findUnique({
      where: { key },
      select: { userId: true, mimeType: true, filename: true },
    });
    if (!row) {
      return NextResponse.json(
        { code: 'FILE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // D-FILE-01: owner-only when userId is set; userId null = public-readable
    // D-FILE-03: collapse owner-mismatch to 404 (no key enumeration oracle)
    if (row.userId && row.userId !== auth.user.sub) {
      return NextResponse.json(
        { code: 'FILE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    let r2;
    let bucket: string;
    try {
      r2 = getR2Client();
      bucket = getR2Bucket();
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        return NextResponse.json(
          { code: 'STORAGE_NOT_CONFIGURED' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw e;
    }

    let res;
    try {
      res = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string })?.name === 'NoSuchKey') {
        return NextResponse.json(
          { code: 'FILE_NOT_FOUND' },
          { status: 404, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw e;
    }

    const body = res.Body as ReadableStream<Uint8Array> | null;
    if (!body) {
      return NextResponse.json(
        { code: 'FILE_NOT_FOUND' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const headers = new Headers({
      'Content-Type': row.mimeType,
      'Cache-Control': 'private, max-age=3600',
      'x-request-id': ctx.requestId,
    });
    if (res.ETag) headers.set('ETag', res.ETag);
    if (res.ContentLength != null) headers.set('Content-Length', String(res.ContentLength));

    // D-FILE-04: stream directly — do NOT call body.transformToByteArray() or Buffer.concat
    return new Response(body, { status: 200, headers });
  });
}
```

**Critical:**
- Do NOT add CSRF check — GET is safe and CSRF cookie isn't sent on cross-origin GETs
- Do NOT call `.transformToByteArray()`, `.transformToString()`, or any buffering helper on `res.Body` — defeats streaming (Pitfall 3)
- Do NOT issue 403 on owner-mismatch — must be 404 to avoid enumeration (D-FILE-03)
- Do NOT match `NoSuchKey` solely by `instanceof` — also fall back to `.name === 'NoSuchKey'` because the SDK's class identity can be lost across module boundaries / mocks (the test mocks throw a generic Error with `name='NoSuchKey'`)
- Do NOT modify any of: `r2-client.ts`, `middleware/index.ts`, `auth.ts`, `prisma.ts`
- The catch-all directory name `[...key]` must be preserved exactly (square brackets, three dots) — Next.js routing relies on it
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run "src/app/api/files/[...key]/route.test.ts"</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/files/[...key]/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" "frontend/src/app/api/files/[...key]/route.ts"` returns 1
    - `grep -c "GetObjectCommand" "frontend/src/app/api/files/[...key]/route.ts"` returns 1
    - `grep -c "NoSuchKey" "frontend/src/app/api/files/[...key]/route.ts"` returns ≥ 1
    - `grep -c "Cache-Control" "frontend/src/app/api/files/[...key]/route.ts"` returns 1
    - `grep -c "private, max-age=3600" "frontend/src/app/api/files/[...key]/route.ts"` returns 1
    - `grep -c "FILE_NOT_FOUND" "frontend/src/app/api/files/[...key]/route.ts"` returns ≥ 4 (missing, owner-mismatch, NoSuchKey, body-null)
    - `grep -c "STORAGE_NOT_CONFIGURED" "frontend/src/app/api/files/[...key]/route.ts"` returns 1
    - `grep -c "transformToByteArray" "frontend/src/app/api/files/[...key]/route.ts"` returns 0 (must NOT buffer)
    - `grep -c "FILE_FORBIDDEN" "frontend/src/app/api/files/[...key]/route.ts"` returns 0 (D-FILE-03 — collapse to 404)
    - `grep -c "verifyCsrf" "frontend/src/app/api/files/[...key]/route.ts"` returns 0 (GET — no CSRF)
    - `grep -c "row.userId !== auth.user.sub" "frontend/src/app/api/files/[...key]/route.ts"` returns 1
    - `pnpm --filter frontend exec vitest run "src/app/api/files/[...key]/route.test.ts"` exits 0 (all 6 tests GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
    - `git diff --name-only` lists only `frontend/src/app/api/files/[...key]/route.ts`
  </acceptance_criteria>
  <done>GET /api/files/[...key] streams owner files; all 6 RED tests now GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client→API | Path segments in URL are attacker-controlled — `[...key]` joins them into the lookup key |
| API→DB | findUnique on key (PK lookup, no user-supplied SQL fragments) |
| API→R2 | Server-issued GetObjectCommand with the exact DB-stored key |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-03-01 | I (Information disclosure) | owner-bypass via cuid guess | mitigate | `prisma.fileUpload.findUnique` followed by `row.userId !== auth.user.sub` check; even if attacker guesses a key, the route returns 404 unless they own it OR the row is anonymous (`userId === null`). |
| T-04-03-02 | I | key existence enumeration via 403/404 differential | mitigate | D-FILE-03 — collapse 403 to 404. Both "key absent" and "owner mismatch" return identical 404 + `FILE_NOT_FOUND` payload. No timing differential beyond a single PK lookup (parameterized). |
| T-04-03-03 | T (Tampering) | path traversal via `..` in URL segments | mitigate | Next.js catch-all `[...key]` returns segments as `string[]`; `.join('/')` produces the literal storage key. PK constraint on `FileUpload.key` means only previously-stored keys ever match — `..`-bearing keys cannot exist (upload route generates `${userId}/${randomUUID()}.ext`). |
| T-04-03-04 | D (DoS) | unbounded streaming amplifies traffic costs | accept | Streaming is required by D-FILE-04. Per-user rate limiting on this route is out of scope for Phase 4 (already considered; Phase 6+ if needed). R2 egress costs are operator-monitored. |
| T-04-03-05 | I | R2 credential leak in error response | mitigate | StorageNotConfiguredError → generic `{ code: 'STORAGE_NOT_CONFIGURED' }`; SDK errors caught + re-thrown to `onRequestError` (Phase 0 Sentry hook) — no SDK error detail in HTTP body. |
| T-04-03-06 | E (Elevation of privilege) | unauthenticated read | mitigate | `requireAuth()` returns 401 before any DB lookup. Even anonymous-uploaded rows require an auth cookie to read (gate is at requireAuth, not at row lookup). |
| T-04-03-07 | I | Cache-Control public leak via shared cache | mitigate | `Cache-Control: private, max-age=3600` (D-FILE-02) — explicit `private` directive prevents shared/CDN caching. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run "src/app/api/files/[...key]/route.test.ts"` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
- No `transformToByteArray` / `Buffer.concat` calls on R2 Body
- 403/404 collapsed for non-existent keys AND non-owner reads (no enumeration oracle)
- No protected file modified
</verification>

<success_criteria>
- `GET /api/files/[...key]` ships with R2 streaming (no buffering)
- Owner-only by default; anonymous uploads (userId null) public-readable to any auth user
- All 6 Wave 0 RED file-route tests GREEN
- Cache-Control: private, max-age=3600 + ETag forwarding verified by tests
</success_criteria>

<output>
After completion, create `.planning/phases/04-upload-files-withdrawals/04-03-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (6 of 6)
- Confirmation that Body is streamed (no `transformToByteArray` in handler)
- Live R2 GET smoke deferred to Phase 4 HUMAN-UAT
</output>
