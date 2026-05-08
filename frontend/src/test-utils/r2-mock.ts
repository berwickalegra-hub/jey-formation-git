// Phase 4 Plan 04-01 — mock R2 client factory.
//
// Wave 1 route tests (upload, files) inject this via `vi.mock('@/lib/server/upload/r2-client')`
// so the real `S3Client` never gets constructed in a test process.
//
// Branching by `cmd.constructor.name` matches the real `S3Client.send`
// dispatch shape: `send(new PutObjectCommand({...}))` and
// `send(new GetObjectCommand({...}))`. Tests can override either branch by
// passing `onPut` / `onGet` callbacks — passing a vi.fn that throws lets a
// test simulate `NoSuchKey`, R2 5xx, network failures, etc.
//
// Default `onGet` returns a tiny `ReadableStream` (3 bytes), `ETag '"abc123"'`,
// and `ContentLength 3` — enough surface for streaming tests. Default
// `onPut` returns `{ ETag: '"abc123"' }`.
import { vi, type Mock } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';

export interface MockR2Options {
  /**
   * Override for `PutObjectCommand.send`. If omitted, returns a happy
   * `{ ETag: '"abc123"' }` shape. Throw to simulate upload failure.
   */
  onPut?: Mock;
  /**
   * Override for `GetObjectCommand.send`. If omitted, returns a 3-byte
   * `ReadableStream` with `ETag '"abc123"'` and `ContentLength 3`. Throw
   * an error whose `name === 'NoSuchKey'` to simulate a missing object.
   */
  onGet?: Mock;
}

/**
 * Build a `Pick<S3Client, 'send'>` whose `send()` dispatches by command
 * class name. Inject via `vi.mock('@/lib/server/upload/r2-client', () => ({
 *   getR2Client: vi.fn(() => mockR2Client()),
 *   getR2Bucket: vi.fn(() => 'test-bucket'),
 *   StorageNotConfiguredError: class extends Error { ... },
 * }))`.
 */
export function mockR2Client(opts: MockR2Options = {}): Pick<S3Client, 'send'> {
  return {
    send: vi.fn(async (cmd: { constructor: { name: string } }) => {
      const name = cmd.constructor.name;
      if (name === 'PutObjectCommand') {
        return opts.onPut ? await opts.onPut(cmd) : { ETag: '"abc123"' };
      }
      if (name === 'GetObjectCommand') {
        if (opts.onGet) return await opts.onGet(cmd);
        return {
          Body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            },
          }),
          ETag: '"abc123"',
          ContentLength: 3,
        };
      }
      throw new Error(`Unmocked S3 command: ${name}`);
    }) as unknown as S3Client['send'],
  };
}
