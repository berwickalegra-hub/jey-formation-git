/**
 * StorageClient — provider-agnostic interface, Cloudinary implementation.
 *
 * The contract is narrow on purpose: putObject / deleteObject. Routes import
 * the interface, not the Cloudinary specifics, so a future swap (S3, R2, GCS,
 * local FS) only changes this file.
 *
 * Implementation uses the official `cloudinary` SDK (v2 namespace) and routes
 * uploads through `uploader.upload_stream`. Files are public-by-default via
 * Cloudinary's `secure_url` — no proxy route is needed for the starter (a
 * future fork that wants private files adds Cloudinary signed-delivery + a
 * proxy route back).
 *
 * NOTE on field naming: `key` in this interface and in the `FileUpload`
 * Prisma model stores Cloudinary's `public_id` (formerly R2 object key —
 * same semantics: a unique opaque string the storage backend addresses by).
 * Field name preserved for forward-compatibility with non-Cloudinary
 * providers; no schema migration was needed for the swap.
 */
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}

export interface PutObjectResult {
  /** Storage-addressable identifier (Cloudinary public_id). */
  key: string;
  /** Public CDN URL (Cloudinary secure_url). */
  url: string;
  /** Stored byte length (Cloudinary `bytes`). */
  bytes: number;
}

export interface StorageClient {
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  deleteObject(key: string): Promise<void>;
}

export interface CreateStorageClientEnv {
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  /** Optional upload preset — unsigned uploads or named transformation config. */
  CLOUDINARY_UPLOAD_PRESET?: string;
}

export function createStorageClient(env: CreateStorageClientEnv): StorageClient {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error(
      'createStorageClient: missing one of CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET',
    );
  }

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  const uploadPreset = env.CLOUDINARY_UPLOAD_PRESET;

  return {
    async putObject(input) {
      const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: input.key,
            resource_type: 'auto',
            ...(uploadPreset ? { upload_preset: uploadPreset } : {}),
          },
          (err, res) => {
            if (err) return reject(err);
            if (!res) return reject(new Error('Cloudinary upload returned no response'));
            resolve(res);
          },
        );
        stream.end(body);
      });

      return {
        key: result.public_id,
        url: result.secure_url,
        bytes: typeof result.bytes === 'number' ? result.bytes : body.length,
      };
    },

    async deleteObject(key) {
      await cloudinary.uploader.destroy(key, { resource_type: 'image', invalidate: true });
    },
  };
}

/**
 * Lazy boot helper — returns a storage client when env is fully set,
 * or `null` when any required var is missing. Callers can use this to
 * gracefully no-op uploads in dev without Cloudinary.
 */
export function tryCreateStorageClient(): StorageClient | null {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return null;
  }
  const env: CreateStorageClientEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  if (process.env.CLOUDINARY_UPLOAD_PRESET) {
    env.CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;
  }
  return createStorageClient(env);
}
