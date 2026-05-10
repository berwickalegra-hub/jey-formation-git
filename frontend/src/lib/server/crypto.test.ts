// TEST-02 — companion unit test for `crypto.ts` (PROTECTED lib).
//
// Asserts:
//   1. encrypt/decrypt round-trips a known plaintext under the test fixture key
//      seeded by vitest.setup.ts.
//   2. decrypt rejects malformed payloads (wrong shape — not 3 colon parts).
//   3. decrypt rejects ciphertext when ENCRYPTION_KEY is rotated (auth-tag fails).
//
// PROTECTED: this test does NOT modify `crypto.ts`. The file is on the
// "Files Claude must NOT modify" list (CLAUDE.md). Any drift between this
// test and the source is the test's problem, not the source's.
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateKey } from './crypto';

// Generate a fresh 32-byte key for these tests rather than relying on the
// seeded ENCRYPTION_KEY in vitest.setup.ts (which is a placeholder string,
// not necessarily the canonical 32-byte length the lib enforces).
const TEST_KEY = generateKey();

describe('crypto round-trip (TEST-02)', () => {
  it('round-trips a known plaintext under the test fixture key', () => {
    const ciphertext = encrypt('hello world', TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toBe('hello world');
  });

  it('produces three colon-separated base64 segments (iv:tag:data)', () => {
    const ciphertext = encrypt('payload-x', TEST_KEY);
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(3);
    // Each segment is non-empty base64.
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('rejects malformed ciphertext (wrong segment count)', () => {
    expect(() => decrypt('not-a-valid-payload', TEST_KEY)).toThrow();
    expect(() => decrypt('a:b', TEST_KEY)).toThrow();
    expect(() => decrypt('a:b:c:d', TEST_KEY)).toThrow();
  });

  it('rejects ciphertext when the decryption key is rotated', () => {
    const ciphertext = encrypt('secret', TEST_KEY);
    // Generate a different valid 32-byte key and try to decrypt.
    const wrongKey = generateKey();
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });
});
