/**
 * StorageClient — provider-agnostic interface, R2 implementation.
 *
 * The contract is narrow on purpose: putObject / getObjectStream /
 * deleteObject. Routes import the interface, not the R2 specifics, so
 * a future swap (S3, GCS, local FS) only changes this file.
 *
 * Implementation uses the AWS S3 client pointed at the R2 endpoint
 * (`https://<account>.r2.cloudflarestorage.com`), region "auto",
 * signature v4. Files are private by default; public exposure is via
 * the `/api/files/:key` proxy route, not direct R2 URLs.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}

export interface ObjectStreamResult {
  stream: Readable;
  contentType: string;
  contentLength: number;
}

export interface StorageClient {
  putObject(input: PutObjectInput): Promise<void>;
  getObjectStream(key: string): Promise<ObjectStreamResult | null>;
  deleteObject(key: string): Promise<void>;
}

export interface CreateStorageClientEnv {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  /** Optional public bucket URL — present means callers MAY rewrite to public URL. */
  R2_PUBLIC_URL?: string;
}

export function createStorageClient(env: CreateStorageClientEnv): StorageClient {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    throw new Error(
      'createStorageClient: missing one of R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET',
    );
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  const bucket = env.R2_BUCKET;

  return {
    async putObject(input) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    },

    async getObjectStream(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!res.Body) return null;
        return {
          stream: res.Body as Readable,
          contentType: res.ContentType ?? 'application/octet-stream',
          contentLength: typeof res.ContentLength === 'number' ? res.ContentLength : 0,
        };
      } catch (err) {
        if (err instanceof NoSuchKey) return null;
        // Some R2 edges throw a generic error with name === 'NoSuchKey'.
        if (
          typeof err === 'object' &&
          err !== null &&
          'name' in err &&
          (err as { name: string }).name === 'NoSuchKey'
        ) {
          return null;
        }
        throw err;
      }
    },

    async deleteObject(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/**
 * Lazy boot helper — returns a storage client when env is fully set,
 * or `null` when any required var is missing. Callers can use this to
 * gracefully no-op uploads in dev without R2.
 */
export function tryCreateStorageClient(): StorageClient | null {
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET
  ) {
    return null;
  }
  const env: CreateStorageClientEnv = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
  };
  if (process.env.R2_PUBLIC_URL) env.R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
  return createStorageClient(env);
}
