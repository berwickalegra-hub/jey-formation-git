/**
 * POST /api/upload — authenticated multipart file upload.
 *
 * Pipeline (D-UP-04 ordering — gates BEFORE byte read):
 *   1. CSRF (verifyCsrf) → bail 403 on mismatch
 *   2. Auth (requireAuth) → bail 401 on missing/invalid session
 *   3. R2 lazy-init → 503 STORAGE_NOT_CONFIGURED on missing creds
 *   4. formData parse → 400 UPLOAD_MISSING_FILE if no `file` field
 *   5. Size cap (UPLOAD_MAX_BYTES) → 413 FILE_TOO_LARGE
 *   6. MIME allowlist (UPLOAD_ALLOWED_MIME) → 415 INVALID_MIME
 *   7. Magic-byte sniff (verifyMagicBytes) → 415 MAGIC_BYTE_MISMATCH if sniffed && !match
 *   8. R2 PutObjectCommand → 502 UPLOAD_FAILED on throw
 *   9. prisma.fileUpload.create → 201 with row + x-request-id header
 *
 * Key naming: `{userId}/{cuid}.{ext}` — random UUID prevents collisions and
 * blocks path-traversal via attacker-controlled filename (T-04-02-02).
 *
 * Env is read at handler-call time (never module-top) so vi.stubEnv works in
 * tests and the route picks up env changes without restart.
 */
export const runtime = 'nodejs';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { StorageNotConfiguredError, getR2Bucket, getR2Client } from '@/lib/server/upload/r2-client';
import { verifyMagicBytes } from '@/lib/server/upload/sniff';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    // Read env at handler-call time so vi.stubEnv works and operators can flip
    // limits without redeploy. Never hoist these to module top.
    const allowedMime = (process.env.UPLOAD_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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

    // Read bytes only AFTER size + MIME gates (D-UP-04 — never allocate before
    // the cheap rejections fire).
    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const { match, sniffed } = verifyMagicBytes(buf, file.type);
    if (sniffed && !match) {
      return NextResponse.json(
        { code: 'MAGIC_BYTE_MISMATCH', message: 'File bytes do not match declared MIME' },
        { status: 415, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    // sniffed=false → operator allowed a MIME we don't sniff (e.g. text/csv).
    // sniff.ts logs a warn at boot for those; we accept here per its docs.

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
