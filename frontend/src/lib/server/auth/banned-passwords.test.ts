import { describe, it, expect } from 'vitest';
import { isBanned } from './banned-passwords';

describe('isBanned', () => {
  it('returns true for "password"', () => {
    expect(isBanned('password')).toBe(true);
  });

  it('returns true for "PASSWORD" (case-insensitive)', () => {
    expect(isBanned('PASSWORD')).toBe(true);
  });

  it('returns true for "Password123" (mixed-case)', () => {
    expect(isBanned('Password123')).toBe(true);
  });

  it('returns false for a strong-ish password', () => {
    expect(isBanned('Tr0ub4dor&3-x9z')).toBe(false);
  });

  it('returns false for an entry that is a substring of a banned word', () => {
    // Substring matching would be a bug — "letmein" is banned, but "ipasswordi"
    // (which contains "password") must NOT be flagged.
    expect(isBanned('ipasswordi')).toBe(false);
  });

  it('returns false for empty string (not in list)', () => {
    expect(isBanned('')).toBe(false);
  });
});

describe('banned-passwords list size', () => {
  it('has at least 50 entries (D-12 — meaningful coverage)', async () => {
    // Re-import the source file so we can grep it for the BANNED set.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'banned-passwords.ts'), 'utf8');
    // Count lines that look like a banned entry (single-quoted string, comma-terminated).
    const matches = src.match(/^\s*'[^']+',\s*$/gm) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(50);
  });
});
