/**
 * AES-256-GCM credentials encryption.
 *
 * Master key in env: BYOK_ENCRYPTION_KEY = base64-encoded 32 random bytes.
 *   $ node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * For key rotation, set BYOK_ENCRYPTION_KEY_V2 and bump CURRENT_KEY_VERSION.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const CURRENT_KEY_VERSION = 1;

export type EncryptedPayload = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  algorithm: typeof ALGORITHM;
  keyVersion: number;
};

function resolveKeyEnvVar(version: number): string {
  return version === 1 ? 'BYOK_ENCRYPTION_KEY' : `BYOK_ENCRYPTION_KEY_V${version}`;
}

function getKey(version: number = CURRENT_KEY_VERSION): Buffer {
  const envName = resolveKeyEnvVar(version);
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(
      `Missing env var ${envName}. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_LENGTH) {
    throw new Error(`${envName} must decode to exactly ${KEY_LENGTH} bytes (got ${buf.length}).`);
  }
  return buf;
}

export function encryptCredentials<T extends Record<string, unknown>>(
  plaintext: T,
): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    nonce: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    algorithm: ALGORITHM,
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptCredentials<T = Record<string, unknown>>(payload: EncryptedPayload): T {
  if (payload.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported algorithm: ${payload.algorithm}`);
  }
  const key = getKey(payload.keyVersion);
  const iv = Buffer.from(payload.nonce, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('base64');
}
