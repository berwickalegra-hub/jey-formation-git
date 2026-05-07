import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dummyBcryptCompare } from './dummy-bcrypt';

describe('dummyBcryptCompare', () => {
  it('resolves without throwing for any input', async () => {
    await expect(dummyBcryptCompare('anything')).resolves.toBeUndefined();
    await expect(dummyBcryptCompare('')).resolves.toBeUndefined();
    await expect(
      dummyBcryptCompare('a-very-long-password-string-with-symbols-!@#$%^&*'),
    ).resolves.toBeUndefined();
  });
});

describe('dummyBcryptCompare — cost factor invariant (T-1-01)', () => {
  it('source contains a cost-12 bcrypt hash literal ($2a$12$)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'dummy-bcrypt.ts'), 'utf8');
    // Cost MUST match auth.ts:137 hashPassword cost (12). A mismatch leaks user
    // existence via timing. See Pitfall 4.
    expect(src).toMatch(/\$2a\$12\$/);
  });
});
