// Lazy-initialized R2 / S3-compatible client + bucket accessor (Phase 4 Plan
// 04-01, mirrors `payments/provider-singleton.ts`).
//
// Why lazy?
//   `new S3Client({...})` itself doesn't throw on missing creds — R2 calls
//   would only fail at request time. Worse, our route should return a clean
//   503 STORAGE_NOT_CONFIGURED instead of a generic 500. By gating
//   construction on the four required envs (R2_ACCOUNT_ID, R2_BUCKET,
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY), we throw a typed
//   `StorageNotConfiguredError` synchronously on first use. Routes catch
//   `instanceof` and translate to 503.
//
//   Additionally, this avoids reading `process.env` at module top-level —
//   which would lock in stale values for tests that mutate the env.
//
// Why a separate `_bucket` cache?
//   `getR2Bucket()` lets routes read the configured bucket without paying
//   another env-read; it triggers `getR2Client()` lazily if the client
//   hasn't been built yet, so a single missing-env throw site is preserved.
//
// Pitfall 6 (env.ts Zod rejection): R2_* keys are deliberately NOT added
// to `frontend/src/lib/server/env.ts`'s Zod schema. The schema rejects
// empty strings, which would refuse to boot the whole app whenever R2 is
// unconfigured (dev / CI). Lazy-init handles `?? ''` empty-as-absent
// directly — see acceptance criterion 11 in the plan.
import 'server-only';
import { S3Client } from '@aws-sdk/client-s3';

/**
 * Thrown by `getR2Client()` when any of `R2_ACCOUNT_ID`, `R2_BUCKET`,
 * `R2_ACCESS_KEY_ID`, or `R2_SECRET_ACCESS_KEY` is missing/empty. The
 * upload + files routes catch this `instanceof` and return 503
 * `{ code: 'STORAGE_NOT_CONFIGURED' }`. The error message intentionally
 * avoids echoing any env values — only names — so a stack trace surfaced
 * via Sentry never leaks a partial credential.
 */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Storage not configured (R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY missing or empty)',
    );
    this.name = 'StorageNotConfiguredError';
  }
}

let _client: S3Client | null = null;
let _bucket: string | null = null;

/**
 * Lazy-init singleton accessor for the R2 / S3-compatible client. First
 * call reads `process.env`, constructs the client, and caches both the
 * client and the bucket name. Subsequent calls reuse the cached instance.
 *
 * When `R2_ENDPOINT` is set (e.g., `http://localhost:9000` for Minio),
 * we use it AND enable `forcePathStyle` (Minio requires path-style;
 * R2 prefers virtual-hosted, so we stick to virtual-hosted in prod).
 *
 * Throws `StorageNotConfiguredError` if any of the four required envs
 * is missing or empty. The route translates that to 503.
 */
export function getR2Client(): S3Client {
  if (_client) return _client;

  const accountId = process.env.R2_ACCOUNT_ID ?? '';
  const bucket = process.env.R2_BUCKET ?? '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';
  const endpointOverride = process.env.R2_ENDPOINT ?? '';

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageNotConfiguredError();
  }

  _client = new S3Client({
    region: 'auto',
    endpoint: endpointOverride || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // Minio (used for local dev via docker-compose) requires path-style;
    // Cloudflare R2 prefers virtual-hosted. Use the override flag as the
    // signal — endpoint overrides only happen for non-prod targets.
    forcePathStyle: !!endpointOverride,
  });
  _bucket = bucket;
  return _client;
}

/**
 * Return the configured R2 bucket name. Triggers `getR2Client()` lazily
 * if it hasn't been called yet, so the StorageNotConfiguredError throw
 * happens exactly once per uninit'd request.
 */
export function getR2Bucket(): string {
  if (!_bucket) getR2Client();
  return _bucket as string;
}

/**
 * Test-only escape hatch — clears the cached client + bucket so a test can
 * mutate `process.env.R2_*` and re-trigger lazy init. Never call this from
 * application code.
 *
 * @internal
 */
export function __resetR2Singleton(): void {
  _client = null;
  _bucket = null;
}
