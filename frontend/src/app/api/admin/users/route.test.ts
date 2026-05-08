// Wave 0 RED scaffold for ADMIN-01 (users list + role/status mutations).
//
// These describe the exact request/response inventory from RESEARCH.md
// "Endpoint Inventory §1" + CF-09 (last-SUPERADMIN guard) +
// D-ADMIN-02/03/05.
//
// NOTE: route handlers don't exist yet — Wave 1/2 plans implement them.
// Using `it.todo` here so this scaffold:
//   1. Exists on disk (Wave 0 acceptance criterion)
//   2. Vitest discovers the file and prints todos (RED state surfaced)
//   3. Typecheck stays green (no broken `./route` imports)
//
// As Wave 1/2 plans implement each endpoint they MUST convert these
// `it.todo`s into real `it` blocks driving the named behaviour.
import { describe, it } from 'vitest';

describe('/api/admin/users [Wave 1] — list', () => {
  it.todo('GET returns paginated users for ADMIN');
  it.todo('GET applies q search case-insensitive');
  it.todo('GET filters by status and role');
  it.todo('rate limits admin per-userId after 100/min');
});

describe('/api/admin/users/[id]/role [Wave 2] — role change', () => {
  it.todo('PATCH role change SUPERADMIN succeeds and writes AdminAction');
  it.todo('PATCH role change requires SUPERADMIN (ADMIN gets 403 ADMIN_REQUIRED)');
  it.todo('PATCH refuses to demote the last SUPERADMIN with 409 LAST_SUPERADMIN');
});

describe('/api/admin/users/[id]/status [Wave 2] — suspend / restore', () => {
  it.todo('PATCH ADMIN can suspend an ACTIVE user');
  it.todo('PATCH only SUPERADMIN can restore a SUSPENDED user (ADMIN gets 403)');
  it.todo('PATCH writes AdminAction with from/to status metadata');
});
