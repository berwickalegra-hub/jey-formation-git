// Wave 0 RED scaffold for ADMIN-07 (make-superadmin CLI script).
//
// D-SCRIPT-01:
//   - Resolves User by email; missing → exit 1 with clear stderr message
//     ("Error: user <email> not found. Sign up first.")
//   - Promotes existing user to SUPERADMIN (idempotent)
//   - Logs AdminAction { actorId: self, action: 'BOOTSTRAP_SUPERADMIN',
//                        metadata: { via: 'cli-script' } }
//
// The current shipped script (frontend/scripts/make-superadmin.ts) does
// the role flip but DOES NOT log the AdminAction yet — Wave 2 plan will
// extend it. These tests describe the contract Wave 2 must satisfy.
//
// See sibling src/app/api/admin/users/route.test.ts header for the it.todo
// rationale (vitest discovers todos as pending; typecheck stays green
// because we don't import the script entry point until Wave 2 wires
// dependency-injectable internals).
import { describe, it } from 'vitest';

describe('scripts/make-superadmin [Wave 2]', () => {
  it.todo('promotes existing user to SUPERADMIN and writes BOOTSTRAP_SUPERADMIN AdminAction');
  it.todo('missing user exits 1 with clear stderr message');
  it.todo('already-SUPERADMIN is a no-op (idempotent) and logs "already SUPERADMIN"');
  it.todo('AdminAction.metadata includes { via: "cli-script" }');
});
