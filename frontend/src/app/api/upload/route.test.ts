// Phase 4 Plan 04-01 — RED tests for POST /api/upload (UP-01).
//
// Wave 0 contract: these tests are intentionally RED. The `./route` module
// does not exist yet — Wave 1 (Plan 04-02 or equivalent) will create it
// and turn the suite green. RED here is the test contract — every Wave 1
// status code, error code, and side-effect is locked here.
//
// Mock strategy:
//   - `@/lib/server/upload/r2-client`: stubbed via vi.mock so the real
//     S3Client is never constructed. `mockR2Client()` from r2-mock.ts
//     supplies a `send()` that branches by command name.
//   - `@/lib/server/middleware`: mocked so requireAuth returns a happy
//     user ctx by default. Per-test mockReturnValueOnce overrides simulate
//     401.
//   - `@/lib/server/auth`: mocked so verifyCsrf returns null (pass) by
//     default; per-test override returns a 403 Response for the CSRF case.
//   - `@/lib/server/prisma`: mocked so fileUpload.create can assert calls
//     without a real DB.
//
// Env stubs: each test calls `vi.stubEnv` for UPLOAD_* and R2_* so the
// route's module-scope env reads see the right values. `vi.unstubAllEnvs`
// in afterEach prevents bleed across tests.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';
import { mockR2Client } from '@/test-utils/r2-mock';

const r2 = mockR2Client();

vi.mock('@/lib/server/upload/r2-client', () => ({
  getR2Client: vi.fn(() => r2),
  getR2Bucket: vi.fn(() => 'test-bucket'),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {
    constructor() {
      super('Storage not configured');
      this.name = 'StorageNotConfiguredError';
    }
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

interface MakeReqOpts {
  csrf?: boolean;
  auth?: boolean;
}

function makeReq(file: File | null, opts: MakeReqOpts = { csrf: true, auth: true }) {
  const fd = new FormData();
  if (file) fd.append('file', file);
  const headers = new Headers();
  if (opts.csrf !== false) headers.set('x-csrf-token', 'test-csrf');
  return new Request(new URL('http://localhost/api/upload'), {
    method: 'POST',
    body: fd,
    headers,
  });
}

describe('POST /api/upload (RED — Wave 1 will turn these green)', () => {
  it('valid jpeg uploads', async () => {
    const { POST } = await import('./route');
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    const res = await POST(makeReq(jpeg) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^user-1\/.+\.jpg$/);
    expect(prismaCreate).toHaveBeenCalled();
  });

  it('magic byte mismatch', async () => {
    const { POST } = await import('./route');
    // PDF magic bytes (0x25 0x50 0x44 0x46) wrapped in image/jpeg envelope.
    const fake = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    const res = await POST(makeReq(fake) as never);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.code).toBe('MAGIC_BYTE_MISMATCH');
  });

  it('mime not allowed', async () => {
    const { POST } = await import('./route');
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], 'a.gif', {
      type: 'image/gif',
    });
    const res = await POST(makeReq(gif) as never);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.code).toBe('INVALID_MIME');
  });

  it('file too large', async () => {
    vi.stubEnv('UPLOAD_MAX_BYTES', '10');
    const { POST } = await import('./route');
    const big = new File([new Uint8Array(50)], 'big.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(big) as never);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('FILE_TOO_LARGE');
  });

  it('storage not configured', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', '');
    const { getR2Client, StorageNotConfiguredError } =
      await import('@/lib/server/upload/r2-client');
    (getR2Client as unknown as Mock).mockImplementationOnce(() => {
      throw new StorageNotConfiguredError();
    });
    const { POST } = await import('./route');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(f) as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('missing file', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq(null) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_MISSING_FILE');
  });

  it('upload failed', async () => {
    const { getR2Client } = await import('@/lib/server/upload/r2-client');
    (getR2Client as unknown as Mock).mockReturnValueOnce({
      send: vi.fn(async () => {
        throw new Error('R2 down');
      }),
    });
    const { POST } = await import('./route');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(f) as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_FAILED');
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { POST } = await import('./route');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(f, { csrf: false, auth: true }) as never);
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    // requireAuth bails with a NextResponse — route guards via `instanceof NextResponse`.
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(f) as never);
    expect(res.status).toBe(401);
  });
});
