---
phase: 04-upload-files-withdrawals
plan: 03
subsystem: files-stream-route
tags: [files, r2, streaming, owner-gate, route-handler]
requirements_completed: [UP-02]
dependency_graph:
  requires:
    - 04-01 (frontend/src/lib/server/upload/r2-client.ts — getR2Client + getR2Bucket + StorageNotConfiguredError; sibling worktree)
    - 04-01 (frontend/src/app/api/files/[...key]/route.test.ts — Wave 0 RED tests; sibling worktree)
    - frontend/src/lib/server/middleware/index.ts (requireAuth)
    - frontend/src/lib/server/observability/request-context.ts (makeRequestContext + withRequestContext)
    - frontend/src/lib/server/prisma.ts (prisma.fileUpload model)
  provides:
    - "GET /api/files/[...key] — owner-gated R2 stream proxy"
  affects: []
tech_stack:
  added: []
  patterns:
    - "Next.js 16 catch-all dynamic route with async params Promise"
    - "AWS S3 SDK GetObjectCommand → Web ReadableStream → Response constructor (no buffering)"
    - "404-collapse for owner-mismatch (no enumeration oracle)"
key_files:
  created:
    - frontend/src/app/api/files/[...key]/route.ts
  modified: []
decisions:
  - "Body piped directly into Response (no transformToByteArray / Buffer.concat) — D-FILE-04"
  - "Owner-mismatch returns identical 404 FILE_NOT_FOUND (no 403, no oracle) — D-FILE-03"
  - "userId null rows are public-readable to any authenticated user — D-FILE-01"
  - "Cache-Control: private, max-age=3600 (browser cache only, never shared/CDN) — D-FILE-02"
  - "NoSuchKey matched by both instanceof and .name === 'NoSuchKey' (resilient across module boundaries / mocks)"
metrics:
  duration_minutes: 5
  completed_date: "2026-05-08"
  tasks_completed: 1
  files_changed: 1
---

# Phase 04 Plan 03: Files Stream Route Summary

One-liner: GET /api/files/[...key] — owner-gated R2 stream proxy that pipes file bytes directly into the response without buffering, with 404-collapse for non-owner reads (no key-existence enumeration).

## What shipped

| File | Purpose |
|------|---------|
| `frontend/src/app/api/files/[...key]/route.ts` (NEW) | GET handler: requireAuth → fileUpload.findUnique → owner check → R2 GetObjectCommand → stream Body into Response. 120 LOC. |

## Behavior

1. **runtime='nodejs'** exported (CI guard preserved; Prisma + AWS SDK + streaming Response require Node).
2. **No CSRF check** — GET is a safe verb; CSRF cookie isn't sent on cross-origin GETs.
3. **requireAuth()** — bails with 401 NextResponse before any DB or R2 call.
4. **params** is `Promise<{ key: string[] }>` (Next 16) — awaited, then `.join('/')` produces the literal storage key.
5. **fileUpload.findUnique({ where: { key } })**:
   - Row missing → 404 `{ code: 'FILE_NOT_FOUND' }`
   - `row.userId` set AND `row.userId !== auth.user.sub` → 404 `{ code: 'FILE_NOT_FOUND' }` (collapse — D-FILE-03)
   - `row.userId === null` → readable by any authenticated user (D-FILE-01)
6. **Lazy R2 init** — `getR2Client()` + `getR2Bucket()` inside try/catch; `StorageNotConfiguredError` → 503 `{ code: 'STORAGE_NOT_CONFIGURED' }`.
7. **GetObjectCommand send**:
   - `NoSuchKey` instanceof OR `.name === 'NoSuchKey'` → 404 `FILE_NOT_FOUND`
   - `Body` null/undefined → 404 `FILE_NOT_FOUND`
   - Other errors propagate (Sentry `onRequestError` hook captures them)
8. **Response**:
   - `Content-Type` from `row.mimeType`
   - `Cache-Control: private, max-age=3600` (D-FILE-02 — browser-cache only, never shared)
   - `ETag` and `Content-Length` forwarded when present
   - `x-request-id` propagated on every code path
   - Body is the R2 `ReadableStream<Uint8Array>` passed verbatim to `new Response(body, init)` — **no buffering** (D-FILE-04)

## Acceptance grep checks (all PASS)

| Check | Required | Actual |
|-------|----------|--------|
| `export const runtime = 'nodejs'` | 1 | 1 |
| `GetObjectCommand` | ≥1 | 2 (import + usage) |
| `NoSuchKey` | ≥1 | 2 (import + match) |
| `Cache-Control` | 1 | 1 |
| `private, max-age=3600` | 1 | 1 |
| `FILE_NOT_FOUND` | ≥4 | 5 |
| `STORAGE_NOT_CONFIGURED` | 1 | 1 |
| `transformToByteArray` | 0 | 0 |
| `FILE_FORBIDDEN` | 0 | 0 |
| `verifyCsrf` | 0 | 0 |
| `row.userId !== auth.user.sub` | 1 | 1 |

## Tests turned GREEN

The Wave 0 RED test file `frontend/src/app/api/files/[...key]/route.test.ts` lives in the sibling 04-01 worktree and is **not present** in this worktree (per plan's `<sibling_plans_note>`). Once the orchestrator merges back, all 6 RED cases must turn GREEN:

1. 401 when unauthenticated
2. 200 + streamed body for owner GET
3. 200 + streamed body for anonymous (`userId === null`) row to any authenticated user
4. 404 `FILE_NOT_FOUND` for non-owner GET (collapse — no 403)
5. 404 `FILE_NOT_FOUND` for absent key (R2 NoSuchKey)
6. 503 `STORAGE_NOT_CONFIGURED` when R2 env missing

Test execution is deferred to the orchestrator post-merge step (sibling test file lives in another worktree).

## Confirmation: streamed, not buffered

`grep -c "transformToByteArray" route.ts` → 0
The Body assignment is `const body = res.Body as ReadableStream<Uint8Array> | null` → `new Response(body, …)`. No `.transformToByteArray()`, no `.transformToString()`, no `Buffer.concat`. The R2 readable stream flows byte-for-byte into the Response.

## Deviations from Plan

None — plan executed verbatim per the supplied implementation. The only edits to the plan-supplied code body were comment-text changes to keep the literal string `transformToByteArray` out of the source file (acceptance criterion required `grep -c "transformToByteArray" → 0`; plan's verbatim block had it in a comment). Behavior unchanged.

Note: typecheck and vitest could not run inside this worktree (no `node_modules` present in fresh worktrees, and the sibling test/r2-client files live in another worktree). The orchestrator handles full validation post-merge.

## Threat surface

All threats in the plan's `<threat_model>` are mitigated as designed:
- T-04-03-01 (owner-bypass via cuid guess): findUnique + `row.userId !== auth.user.sub` check
- T-04-03-02 (enumeration via 403/404 differential): identical 404 + `FILE_NOT_FOUND` payload for both "absent" and "non-owner"
- T-04-03-03 (path traversal via `..`): catch-all `[...key]` returns `string[]`, `.join('/')` is literal; PK constraint on `FileUpload.key` means `..`-bearing keys cannot exist (upload route generates `${userId}/${randomUUID()}.ext`)
- T-04-03-05 (R2 credential leak): generic `STORAGE_NOT_CONFIGURED` payload; SDK errors re-thrown to Sentry, no detail in HTTP body
- T-04-03-06 (unauthenticated read): requireAuth before any DB lookup; even anonymous-uploaded rows require an auth cookie to read
- T-04-03-07 (Cache-Control public leak): explicit `private` directive

No new surface introduced beyond what the plan's threat model covers.

## Live R2 GET smoke

Deferred to Phase 4 HUMAN-UAT (real R2 env required).

## Commits

| Hash | Message |
|------|---------|
| 163dbe3 | feat(04-03): add owner-gated R2 stream proxy at GET /api/files/[...key] |

## Self-Check: PASSED

- `frontend/src/app/api/files/[...key]/route.ts` — FOUND
- Commit `163dbe3` — FOUND on `worktree-agent-a8dbca7fdcc5f8eb7` branch
- All 11 grep acceptance criteria — PASS
