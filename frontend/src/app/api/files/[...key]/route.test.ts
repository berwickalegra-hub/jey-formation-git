// Phase 4 Plan 04-01 — RED tests for GET /api/files/[...key] (UP-02).
//
// Wave 0 contract: these tests are intentionally RED. The `./route` module
// does not exist yet — Wave 1 will create it.
//
// Mock strategy:
//   - `@/lib/server/upload/r2-client`: shared `mockR2Client()` instance;
//     specific tests override `getR2Client` per call to inject NoSuchKey
//     errors or a freshly-failing client.
//   - `@/lib/server/middleware`: requireAuth happy ctx by default.
//   - `@/lib/server/prisma`: stubbed `fileUpload.findUnique` so tests can
//     control the DB-side answer (owner / mismatch / missing / null userId).
//
// Auth + ownership matrix:
//   - Owner-match → 200 + Cache-Control private + ETag forwarded
//   - Owner-mismatch → 404 FILE_NOT_FOUND (collapsed; never FILE_FORBIDDEN
//     to deny existence enumeration per D-FILE-01 / D-FILE-03)
//   - userId === null (anonymous upload) → public-readable, 200
//   - Key not in DB → 404 FILE_NOT_FOUND
//   - R2 NoSuchKey → 404 (DB row exists, R2 doesn't — treat as not found)
//   - R2 unconfigured → 503
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
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

const findUnique = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: { fileUpload: { findUnique } },
}));

beforeEach(() => {
  vi.stubEnv('R2_ACCOUNT_ID', 'acct');
  vi.stubEnv('R2_BUCKET', 'bucket');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function makeReq(keyPath: string) {
  return new Request(`http://localhost/api/files/${keyPath}`);
}

function makeParams(keySegments: string[]) {
  return { params: Promise.resolve({ key: keySegments }) };
}

describe('GET /api/files/[...key] (RED — Wave 1 will turn these green)', () => {
  it('owner streams', async () => {
    findUnique.mockResolvedValueOnce({
      userId: 'user-1',
      mimeType: 'image/jpeg',
      filename: 'a.jpg',
      key: 'user-1/x.jpg',
    });
    const { GET } = await import('./route');
    const res = await GET(makeReq('user-1/x.jpg') as never, makeParams(['user-1', 'x.jpg']));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('ETag')).toBe('"abc123"');
  });

  it('missing returns 404', async () => {
    findUnique.mockResolvedValueOnce(null);
    const { GET } = await import('./route');
    const res = await GET(makeReq('does-not-exist') as never, makeParams(['does-not-exist']));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('FILE_NOT_FOUND');
  });

  it('owner mismatch returns 404 (no enumeration)', async () => {
    // D-FILE-03 explicit: mismatch must collapse to FILE_NOT_FOUND so an
    // attacker can't probe "does this key exist" by checking 403 vs 404.
    findUnique.mockResolvedValueOnce({
      userId: 'user-2',
      mimeType: 'image/jpeg',
      filename: 'a.jpg',
      key: 'user-2/x.jpg',
    });
    const { GET } = await import('./route');
    const res = await GET(makeReq('user-2/x.jpg') as never, makeParams(['user-2', 'x.jpg']));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('FILE_NOT_FOUND');
  });

  it('storage not configured returns 503', async () => {
    findUnique.mockResolvedValueOnce({
      userId: 'user-1',
      mimeType: 'image/jpeg',
      filename: 'a.jpg',
      key: 'user-1/x.jpg',
    });
    vi.stubEnv('R2_ACCOUNT_ID', '');
    const { getR2Client, StorageNotConfiguredError } =
      await import('@/lib/server/upload/r2-client');
    (getR2Client as unknown as Mock).mockImplementationOnce(() => {
      throw new StorageNotConfiguredError();
    });
    const { GET } = await import('./route');
    const res = await GET(makeReq('user-1/x.jpg') as never, makeParams(['user-1', 'x.jpg']));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('r2 nosuch returns 404', async () => {
    findUnique.mockResolvedValueOnce({
      userId: 'user-1',
      mimeType: 'image/jpeg',
      filename: 'a.jpg',
      key: 'user-1/x.jpg',
    });
    // S3 surfaces NoSuchKey via `error.name === 'NoSuchKey'`. The route MUST
    // match by `name`, not the constructor — the AWS SDK serializes errors
    // through DOM-like Error objects whose prototype isn't preserved.
    const noSuch = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    const failingR2 = mockR2Client({
      onGet: vi.fn(async () => {
        throw noSuch;
      }),
    });
    const { getR2Client } = await import('@/lib/server/upload/r2-client');
    (getR2Client as unknown as Mock).mockReturnValueOnce(failingR2);
    const { GET } = await import('./route');
    const res = await GET(makeReq('user-1/x.jpg') as never, makeParams(['user-1', 'x.jpg']));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('FILE_NOT_FOUND');
  });

  it('anonymous public-readable', async () => {
    // FileUpload.userId === null → upload was anonymous; route returns the
    // bytes regardless of which authenticated user requests them. Per
    // D-FILE-01, this is the intentional fallback path.
    findUnique.mockResolvedValueOnce({
      userId: null,
      mimeType: 'image/jpeg',
      filename: 'a.jpg',
      key: 'public/a.jpg',
    });
    const { GET } = await import('./route');
    const res = await GET(makeReq('public/a.jpg') as never, makeParams(['public', 'a.jpg']));
    expect(res.status).toBe(200);
  });
});
