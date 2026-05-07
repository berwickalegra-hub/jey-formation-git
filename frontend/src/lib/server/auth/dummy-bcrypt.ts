// Source: RESEARCH.md Pattern 3 — D-22/D-23/D-24 enumeration resistance.
//
// When a user does NOT exist (signup with new email; login with unknown email;
// forgot-password with unknown email), perform a bcrypt compare against a
// fixed hash so the no-user branch takes ~the same time as the real-user
// branch. bcrypt.compare is the dominant cost of the real path.
//
// Cost MUST match auth.ts:137 hashPassword cost factor (12). If hashPassword
// changes, regenerate this hash with:
//   node -e "console.log(require('bcryptjs').hashSync('any', 12))"
//
// Pitfall 4: a cost-10 dummy against a cost-12 real hash leaks user existence
// via timing (~3× difference). The unit test asserts '$2a$12$' is present in
// this source.
import 'server-only';
import bcrypt from 'bcryptjs';

const DUMMY_HASH = '$2a$12$VF9ClkoMyXG/Vo4HsE85aemUaLzVNKPe/uSbyx4SxbEgDgcUkfJeu';

/**
 * Run a bcrypt compare against a fixed cost-12 hash so the no-user code path
 * takes roughly as long as the real-user path. The boolean result is irrelevant
 * (always false) — the timing is the point.
 *
 * Always `await` this. Never short-circuit (e.g. `if (!user) return 401` before
 * the dummy compute) — that defeats the purpose.
 */
export async function dummyBcryptCompare(plaintext: string): Promise<void> {
  await bcrypt.compare(plaintext, DUMMY_HASH);
}
