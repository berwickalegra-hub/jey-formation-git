// Wave 0 RED scaffold for ADMIN-03 (withdrawals list + manual cancel).
// D-ADMIN-01: cancel is SUPERADMIN-only — financial-sensitive.
// See sibling users/route.test.ts header for the it.todo rationale.
import { describe, it } from 'vitest';

describe('/api/admin/withdrawals [Wave 1] — list', () => {
  it.todo('GET returns paginated withdrawals for ADMIN');
});

describe('/api/admin/withdrawals/[id]/cancel [Wave 2] — manual cancel', () => {
  it.todo('POST [id]/cancel by ADMIN returns 403 ADMIN_REQUIRED');
  it.todo('POST [id]/cancel by SUPERADMIN succeeds + writes AdminAction with action="withdrawal.cancel"');
  it.todo('withdrawal cancel uses pg_advisory_xact_lock(hashtext(userId)) inside the same Serializable tx');
});
