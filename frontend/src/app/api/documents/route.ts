// GET /api/documents — cursor-paginated list, any community member.
// POST /api/documents — coach/admin upload (PDF), reuses the Cloudinary
// pipeline from /api/upload (magic-byte sniff already supports application/pdf).
export const runtime = 'nodejs';

import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { requireCommunityRole } from '@/lib/server/community/current';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { StorageNotConfiguredError, uploadBuffer } from '@/lib/server/upload/cloudinary-client';
import { verifyMagicBytes } from '@/lib/server/upload/sniff';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const gate = await requireCommunityRole(prisma, 'MEMBER', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org } = gate;

    const limit = clampLimit(req.nextUrl.searchParams.get('limit'));
    const cursor = decodeCursor(req.nextUrl.searchParams.get('cursor'));
    const rows = await prisma.document.findMany({
      where: { organizationId: org.id, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    return NextResponse.json(buildPage(rows, limit), {
      status: 200,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const gate = await requireCommunityRole(prisma, 'ADMIN', req.headers.get('authorization'));
    if (gate instanceof NextResponse) return gate;
    const { org, ctx: auth } = gate;

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { error: 'STORAGE_NOT_CONFIGURED' },
        { status: 503, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    const title = form.get('title');
    if (!(file instanceof File) || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'file and title are required' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const description = form.get('description');

    const maxBytes = Number.parseInt(process.env.UPLOAD_MAX_BYTES ?? '10485760', 10);
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: 'FILE_TOO_LARGE' },
        { status: 413, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // Documents are PDF-only for v1 — matches the reference UI's file-icon
    // differentiation and keeps the surface small.
    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'INVALID_MIME', message: 'Only application/pdf is accepted' },
        { status: 415, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const { match, sniffed } = verifyMagicBytes(buf, file.type);
    if (sniffed && !match) {
      return NextResponse.json(
        { error: 'MAGIC_BYTE_MISMATCH' },
        { status: 415, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    let uploaded;
    try {
      uploaded = await uploadBuffer(`documents/${org.id}/${randomUUID()}`, buf, file.type);
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        return NextResponse.json(
          { error: 'STORAGE_NOT_CONFIGURED' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      return NextResponse.json(
        { error: 'UPLOAD_FAILED' },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const doc = await prisma.document.create({
      data: {
        organizationId: org.id,
        uploadedById: auth.user.sub,
        title: title.trim(),
        description:
          typeof description === 'string' && description.trim() ? description.trim() : null,
        fileUrl: uploaded.secureUrl,
        fileType: file.type,
        fileSizeBytes: uploaded.bytes,
      },
    });

    return NextResponse.json(doc, { status: 201, headers: { 'x-request-id': ctx.requestId } });
  });
}
