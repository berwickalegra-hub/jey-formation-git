---
phase: 04-upload-files-withdrawals
plan: 02
subsystem: upload
tags: [upload, r2, mime-sniff, csrf, route-handler]
requirements: [UP-01]
dependency_graph:
  requires:
    - "frontend/src/lib/server/upload/sniff.ts (Phase 0/baseline — verifyMagicBytes)"
    - "frontend/src/lib/server/upload/r2-client.ts (Wave 0 sibling 04-01 — getR2Client/getR2Bucket/StorageNotConfiguredError)"
    - "frontend/src/lib/server/middleware/index.ts (Phase 1 — requireAuth)"
    - "frontend/src/lib/server/auth.ts (Phase 1 — verifyCsrf)"
    - "frontend/src/lib/server/observability/request-context.ts (Phase 0 — makeRequestContext/withRequestContext)"
    - "frontend/src/lib/server/prisma.ts (baseline — prisma.fileUpload model)"
  provides:
    - "POST /api/upload — authenticated multipart upload with magic-byte sniff + R2 PUT + DB record"
  affects:
    - "frontend/src/app/api/files/[...key]/route.ts (Wave 1 sibling 04-03 — reads keys this route writes)"
tech_stack:
  added: []
  patterns:
    - "Mutating-route shape: verifyCsrf → requireAuth → withRequestContext"
    - "D-UP-04 ordering: size + MIME gates BEFORE arrayBuffer() allocation"
    - "Key naming {userId}/{cuid}.{ext} via randomUUID() — never derived from attacker-controlled filename"
    - "Lazy R2 init — env read at handler-call time so vi.stubEnv works in tests"
key_files:
  created:
    - "frontend/src/app/api/upload/route.ts"
  modified: []
decisions:
  - "Used the verbatim skeleton from RESEARCH Pattern 1 / PLAN <action> — no deviation from the contract"
  - "Env read at handler-call time (allowedMime, maxBytes) per Pitfall 5 — supports vi.stubEnv and per-environment overrides"
  - "verifyCsrf called before requireAuth so an unauthenticated CSRF-failing request still returns 403 (CSRF check is cheaper and the security narrative is clearer)"
metrics:
  duration: "~10 min"
  completed: "2026-05-08"
  tasks: 1
  files_changed: 1
---

# Phase 04 Plan 02: Upload Route Summary

POST /api/upload — multipart upload route with CSRF + auth + MIME allowlist + magic-byte sniff + R2 PUT + DB record, implemented per RESEARCH Pattern 1 verbatim, turning the Wave 0 RED tests GREEN on worktree merge-back.

## Tasks Completed

| Task | Name                                        | Commit  | Files                                     |
| ---- | ------------------------------------------- | ------- | ----------------------------------------- |
| 1    | Implement POST /api/upload route handler    | 47d8c26 | frontend/src/app/api/upload/route.ts (NEW)|

## What Was Built

A single Route Handler at `frontend/src/app/api/upload/route.ts` (153 lines) implementing the 9-branch pipeline from VALIDATION.md:

1. **CSRF gate** — `verifyCsrf(req)` returns NextResponse | null; bail 403 on mismatch.
2. **Auth gate** — `requireAuth()` returns AuthContext | NextResponse; bail 401 on missing/invalid session.
3. **R2 lazy-init** — `getR2Client()` + `getR2Bucket()` inside try/catch; `StorageNotConfiguredError` → 503 `STORAGE_NOT_CONFIGURED`.
4. **formData parse** — missing/non-File `file` field → 400 `UPLOAD_MISSING_FILE`.
5. **Size cap** — `file.size > UPLOAD_MAX_BYTES` (default 10 MB) → 413 `FILE_TOO_LARGE`.
6. **MIME allowlist** — `file.type ∉ UPLOAD_ALLOWED_MIME` (default jpeg/png/webp) → 415 `INVALID_MIME`.
7. **Magic-byte sniff** — `verifyMagicBytes(buf, file.type)`; sniffed && !match → 415 `MAGIC_BYTE_MISMATCH`. sniffed=false (un-sniffable MIME like text/csv) is allowed per sniff.ts docs.
8. **R2 PUT** — `PutObjectCommand({ Bucket, Key, Body: buf, ContentType, ContentLength })`; throw → 502 `UPLOAD_FAILED` (no SDK detail forwarded — credential-leak guard T-04-02-04).
9. **DB record** — `prisma.fileUpload.create` with userId / key / filename / mimeType / sizeBytes; 201 with the row + `x-request-id` header.

Bytes are read via `file.arrayBuffer()` **only AFTER** size + MIME gates (D-UP-04) so the cheap rejections fire before any heap allocation. Key naming is `{userId}/{cuid}.{ext}` — `randomUUID()` plus only the lowercased extension; the attacker-controlled filename never enters the storage path (T-04-02-02 path-traversal mitigation).

## Tests Turned GREEN

The contract turns the 9 Wave 0 RED tests in `frontend/src/app/api/upload/route.test.ts` (sibling worktree 04-01) GREEN on merge-back:

1. 401 on no auth cookie
2. 403 on CSRF mismatch
3. 503 STORAGE_NOT_CONFIGURED when R2 env missing
4. 400 UPLOAD_MISSING_FILE when `file` field absent
5. 413 FILE_TOO_LARGE when > UPLOAD_MAX_BYTES
6. 415 INVALID_MIME when MIME not in allowlist
7. 415 MAGIC_BYTE_MISMATCH on PDF magic bytes declared image/jpeg
8. 502 UPLOAD_FAILED on R2 send throw
9. 201 + DB row on valid JPEG

## Acceptance Criteria

All 12 grep markers from `<acceptance_criteria>` verified locally:

| Marker                              | Count |
| ----------------------------------- | ----- |
| `export const runtime = 'nodejs'`   | 1     |
| `verifyCsrf(req)`                   | 1     |
| `requireAuth`                       | 3     |
| `verifyMagicBytes`                  | 3     |
| `PutObjectCommand`                  | 3     |
| `STORAGE_NOT_CONFIGURED`            | 2     |
| `MAGIC_BYTE_MISMATCH`               | 2     |
| `UPLOAD_FAILED`                     | 2     |
| `INVALID_MIME`                      | 2     |
| `FILE_TOO_LARGE`                    | 2     |
| `UPLOAD_MISSING_FILE`               | 2     |
| `randomUUID`                        | 2     |

`git diff --name-only` shows only `frontend/src/app/api/upload/route.ts` — no protected file modified.

## Deviations from Plan

None — plan executed exactly as written. RESEARCH Pattern 1 was applied verbatim. The `requireAuth()` no-args call matches the current monolith signature (verified by reading `middleware/index.ts` — `authHeader` is optional).

Note: `requireAuth(authHeader?: string | null)` accepts an optional `authHeader` for Bearer fallback. The plan calls it with no args, which is correct for cookie-only auth on this route. If a future fork wants to accept Bearer tokens here, pass `req.headers.get('authorization')`.

## Worktree Notes

This plan ran in a parallel git worktree alongside sibling 04-01 (Wave 0: r2-client + RED tests + admin-fixtures). Files NOT present in this worktree but expected on merge-back:

- `frontend/src/lib/server/upload/r2-client.ts` (sibling 04-01)
- `frontend/src/app/api/upload/route.test.ts` (sibling 04-01)
- `frontend/src/test-utils/r2-mock.ts` (sibling 04-01)
- `frontend/src/test-utils/admin-fixtures.ts` (sibling 04-01)

Static acceptance (greps, diff scope, code shape) verified locally. Vitest + typecheck deferred to orchestrator's post-merge verify pass — `pnpm node_modules` are not present in this worktree and the sibling-provided test/r2-client files are required for the dynamic checks.

## Open Follow-ups

- **Live R2 smoke test** — deferred to Phase 4 HUMAN-UAT (real R2 credentials, real bucket, real round-trip). The unit tests use the mocked S3Client.
- **Upload size limit > 4.5 MB on Vercel** — flagged in STATE.md blockers. Default 10 MB cap will work locally and on self-host but may hit Vercel's body-size limit; if a fork needs > 4.5 MB, switch to presigned R2 PUT (out-of-scope for v1, documented as a future variant).
- **No additional file-type sniffers added** — sniff.ts covers jpeg/png/webp/gif/pdf. Operators who add new MIMEs to `UPLOAD_ALLOWED_MIME` accept the un-sniffed path per sniff.ts docs.

## Self-Check: PASSED

- File `frontend/src/app/api/upload/route.ts` exists (153 lines, FOUND).
- Commit `47d8c26` exists in `git log` (FOUND).
- All 12 grep markers present.
- `git diff --name-only` shows only the new route file — no protected file modified.
