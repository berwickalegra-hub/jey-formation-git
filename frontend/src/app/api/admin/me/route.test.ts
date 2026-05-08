// Wave 0 RED scaffold for ADMIN-05 (admin probe + capability list).
// D-ADMIN-04: GET returns { role, can: ['users:read', 'users:status', ...] }.
// See sibling users/route.test.ts header for the it.todo rationale.
import { describe, it } from 'vitest';

describe('/api/admin/me [Wave 1]', () => {
  it.todo('GET returns role + capability list for ADMIN');
  it.todo('GET returns broader capability list for SUPERADMIN including users:role and withdrawals:cancel');
  it.todo('GET 401 when no auth cookie present');
  it.todo('GET 403 when authenticated as USER (non-admin)');
});
