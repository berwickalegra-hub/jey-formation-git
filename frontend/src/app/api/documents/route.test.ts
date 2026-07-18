import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireOrgRole: vi.fn(),
}));
vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  uploadBuffer: vi.fn(),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {},
}));
vi.mock('@/lib/server/upload/sniff', () => ({
  verifyMagicBytes: vi.fn(),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { uploadBuffer } from '@/lib/server/upload/cloudinary-client';
import { verifyMagicBytes } from '@/lib/server/upload/sniff';
import { GET, POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockUploadBuffer = vi.mocked(uploadBuffer);
const mockVerifyMagicBytes = vi.mocked(verifyMagicBytes);

const org = { id: 'org-1', slug: 'ma-formation' };
const orgCtx = {
  user: { sub: 'user-1', email: 'me@example.com' },
  orgMember: { organizationId: 'org-1', userId: 'user-1', role: 'ADMIN' },
};

function makeGet(qs = ''): NextRequest {
  return new NextRequest(`http://test/api/documents${qs}`, { method: 'GET' });
}

// application/pdf magic bytes: %PDF-
const PDF_HEADER = Buffer.from('%PDF-1.4\n');

function makePostForm(opts: {
  file?: File | null;
  title?: string;
  description?: string;
  csrf?: 'match' | 'missing';
}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = {};
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  const form = new FormData();
  if (opts.file !== null) {
    form.set('file', opts.file ?? new File([PDF_HEADER], 'guide.pdf', { type: 'application/pdf' }));
  }
  if (opts.title !== undefined) form.set('title', opts.title);
  if (opts.description !== undefined) form.set('description', opts.description);
  return new NextRequest('http://test/api/documents', { method: 'POST', headers, body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  mockRequireOrgRole.mockResolvedValue(orgCtx as never);
  mockVerifyMagicBytes.mockReturnValue({ match: true, sniffed: true });
});

describe('GET /api/documents', () => {
  it('404 when no community is seeded', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
  });

  it('org-role gate failure is returned as-is (e.g. 404 non-member)', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    mockRequireOrgRole.mockResolvedValueOnce(
      NextResponse.json({ error: 'Organization not found' }, { status: 404 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  it('scopes findMany by organizationId and returns a paginated page', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    prismaMock.document.findMany.mockResolvedValue([
      { id: 'd1', createdAt: new Date('2026-01-02'), title: 'Doc 1' },
      { id: 'd2', createdAt: new Date('2026-01-01'), title: 'Doc 2' },
    ] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();

    const arg = prismaMock.document.findMany.mock.calls[0]?.[0];
    expect(arg?.where?.organizationId).toBe('org-1');
  });
});

describe('POST /api/documents', () => {
  it('missing CSRF → 403', async () => {
    const res = await POST(makePostForm({ title: 'Doc', csrf: 'missing' }));
    expect(res.status).toBe(403);
  });

  it('404 when no community is seeded', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const res = await POST(makePostForm({ title: 'Doc' }));
    expect(res.status).toBe(404);
  });

  it('org-role gate failure (e.g. MEMBER trying to upload) is returned as-is', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    mockRequireOrgRole.mockResolvedValueOnce(
      NextResponse.json({ error: 'ORG_ROLE_INSUFFICIENT' }, { status: 403 }),
    );
    const res = await POST(makePostForm({ title: 'Doc' }));
    expect(res.status).toBe(403);
  });

  it('missing title → 400 VALIDATION_FAILED', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    const res = await POST(makePostForm({ title: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('non-PDF mime → 415 INVALID_MIME', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    const res = await POST(
      makePostForm({
        title: 'Doc',
        file: new File(['hello'], 'note.txt', { type: 'text/plain' }),
      }),
    );
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe('INVALID_MIME');
  });

  it('magic-byte mismatch → 415 MAGIC_BYTE_MISMATCH', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    mockVerifyMagicBytes.mockReturnValue({ match: false, sniffed: true });
    const res = await POST(makePostForm({ title: 'Doc' }));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe('MAGIC_BYTE_MISMATCH');
  });

  it('success → uploads then creates a Document row scoped to the community', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(org as never);
    mockUploadBuffer.mockResolvedValue({
      publicId: 'documents/org-1/abc',
      secureUrl: 'https://cdn.example/doc.pdf',
      bytes: 1234,
    });
    prismaMock.document.create.mockResolvedValue({ id: 'doc-1' } as never);

    const res = await POST(makePostForm({ title: 'Guide complet', description: 'Un guide' }));
    expect(res.status).toBe(201);

    const arg = prismaMock.document.create.mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      organizationId: 'org-1',
      uploadedById: 'user-1',
      title: 'Guide complet',
      description: 'Un guide',
      fileUrl: 'https://cdn.example/doc.pdf',
      fileType: 'application/pdf',
      fileSizeBytes: 1234,
    });
  });
});
