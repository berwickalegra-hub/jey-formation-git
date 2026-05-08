// Tests for the withdrawal-PIN helper.
//
// Critical invariants under test:
//  - bcrypt cost === 12 (matches auth.ts:137 hashPassword) (CD-01)
//  - alwaysCompareDummy actually runs bcrypt.compare (real time spent) (CD-03)
//  - hashPin rejects empty string (defense-in-depth; route Zod is the primary gate)
import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, alwaysCompareDummy, PIN_BCRYPT_COST } from './pin';

describe('hashPin', () => {
  it('produces a cost-12 bcrypt hash (header $2a$12$ or $2b$12$)', async () => {
    const hash = await hashPin('1234');
    expect(typeof hash).toBe('string');
    expect(hash.startsWith('$2')).toBe(true);
    // bcrypt header layout: $<algo>$<cost>$<salt+hash>
    const parts = hash.split('$');
    // parts: ['', '2a' | '2b', '12', '<salt+hash>']
    expect(parts[2]).toBe('12');
  }, 10_000);

  it('rejects empty string (defense in depth)', async () => {
    await expect(hashPin('')).rejects.toThrow();
  });

  it('rejects non-string input via type-narrowing throw', async () => {
    // We're explicit about validation behavior — the route layer should also
    // catch this with Zod, but exporting hashPin without runtime validation
    // would let a `null as any` slip through and produce a useless hash.
    // @ts-expect-error — deliberately wrong type to exercise runtime guard
    await expect(hashPin(null)).rejects.toThrow();
  });
});

describe('verifyPin', () => {
  it('returns true when plain matches the hash', async () => {
    const hash = await hashPin('1234');
    expect(await verifyPin('1234', hash)).toBe(true);
  }, 10_000);

  it('returns false when plain does not match', async () => {
    const hash = await hashPin('1234');
    expect(await verifyPin('9999', hash)).toBe(false);
  }, 10_000);
});

describe('PIN_BCRYPT_COST constant', () => {
  it('equals 12 (matches auth.ts hashPassword cost)', () => {
    expect(PIN_BCRYPT_COST).toBe(12);
  });
});

describe('alwaysCompareDummy (CD-03 timing equalisation)', () => {
  it('returns false (the fake hash never matches an arbitrary input)', async () => {
    expect(await alwaysCompareDummy('1234')).toBe(false);
  }, 10_000);

  it('actually runs bcrypt.compare — takes a non-trivial amount of time (>= 50ms)', async () => {
    const start = Date.now();
    await alwaysCompareDummy('any-input');
    const elapsed = Date.now() - start;
    // Cost-12 bcrypt on modern hardware is ~150-300ms. Allow 50ms floor for
    // very fast CI hardware; the assertion only proves bcrypt actually ran
    // (a no-op `return false` would complete in < 1ms).
    expect(elapsed).toBeGreaterThanOrEqual(50);
  }, 10_000);
});
