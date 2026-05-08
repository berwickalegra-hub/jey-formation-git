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

/**
 * GET /api/files/[...key] — owner-gated R2 stream proxy.
 *
 * Streams uploaded file bytes directly from R2 into the response without
 * buffering. Owner-only by default; rows with `userId === null` are public
 * to any authenticated user (D-FILE-01). Owner-mismatch collapses to 404
 * to avoid key-existence enumeration (D-FILE-03).
 *
 * Implements UP-02. Catch-all `[...key]` joins URL segments into the
 * literal storage key (Next.js routing).
 *
 * Invariants:
 *   - runtime = 'nodejs' (Prisma + AWS SDK + streaming Response body)
 *   - GET only — no CSRF check (safe verb; CSRF cookie not sent on
 *     cross-origin GETs)
 *   - Body stream piped directly into Response; never buffered (defeats
 *     streaming, blows up memory on large files)
 *   - Both "key absent" and "owner mismatch" return identical 404
 *     `FILE_NOT_FOUND` payload (no enumeration oracle)
 */
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
      // Match by class identity OR by `.name` — the SDK's class identity can
      // be lost across module boundaries / mocks, so fall back to the name
      // string emitted by R2 edges.
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

    // D-FILE-04: stream directly — do NOT buffer the R2 body (no `Buffer.concat`,
    // no SDK helpers that materialize the body into memory).
    return new Response(body, { status: 200, headers });
  });
}
