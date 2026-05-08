// Phase 2 Plan 02-00 — withdrawal-PIN bcrypt helper.
//
// Wave 1 PIN routes (Plan 02-03, /api/auth/withdrawal-pin) call hashPin to
// store the user's 4-6 digit PIN, verifyPin to gate withdrawal POSTs, and
// alwaysCompareDummy on the "no current hash" branch of POST so the caller
// can't probe `withdrawalPinHash IS NULL` via timing.
//
// CD-01 (bcrypt cost 12): mirrors auth.ts:137 hashPassword. A different cost
// would let an attacker tell "this user has a PIN" from "this user does not"
// by measuring the verify time. The floor is enforced by a unit test reading
// the bcrypt header.
//
// CD-03 (constant-time path equalisation): the change-PIN route has three
// branches:
//   1. existing hash + correct currentPin → bcrypt.compare(plain, real)
//   2. existing hash + wrong currentPin → bcrypt.compare(plain, real)
//   3. NO existing hash + currentPin sent → must still spend ~250ms
// Branch 3 calls alwaysCompareDummy. The boolean result is irrelevant; the
// branch returns the standard PIN_INVALID error so the wire response is
// indistinguishable from branch 2.
import 'server-only';
import bcrypt from 'bcryptjs';

/** CD-01: PIN bcrypt cost matches password hashing (auth.ts:137). */
export const PIN_BCRYPT_COST = 12;

/**
 * Pre-computed cost-12 bcrypt hash for `alwaysCompareDummy`. The plaintext
 * used to mint this is `'amadou-pin-dummy'` and is irrelevant to callers —
 * we only need a syntactically valid bcrypt string so `bcrypt.compare` runs
 * the work factor. See CD-03 above and the matching dummy-bcrypt.ts pattern
 * in this directory.
 *
 * If the hash is ever rotated, regenerate via:
 *   node -e "const b=require('bcryptjs'); b.hash('any', 12).then(console.log)"
 */
const DUMMY_HASH = '$2a$12$D/kxqEezQRyx1cld8ic6d.cNU4N4tsQPVsBpVXZBTGnA3pBA9bqcy';

/**
 * Hash a plain-text PIN at cost 12.
 *
 * Throws on empty/non-string input as a defense-in-depth — the route layer's
 * Zod schema is the primary gate. Without this guard a `null as any` from
 * upstream would produce a useless hash that `verifyPin` would silently
 * accept on the next call.
 */
export async function hashPin(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('hashPin: plain must be a non-empty string');
  }
  return bcrypt.hash(plain, PIN_BCRYPT_COST);
}

/** Compare a plain-text PIN against a stored bcrypt hash. */
export async function verifyPin(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Constant-time dummy compare for the "no current hash" path (CD-03).
 *
 * Always returns false; always spends ~250ms on cost-12 hardware. Callers
 * MUST `await` this and MUST NOT branch on the boolean — the timing IS the
 * point. Using it lets the change-PIN handler's three branches all complete
 * in roughly the same wall-clock time, denying an attacker an oracle for
 * "does this user have a PIN set yet?".
 */
export async function alwaysCompareDummy(plain: string): Promise<boolean> {
  return bcrypt.compare(plain, DUMMY_HASH);
}
