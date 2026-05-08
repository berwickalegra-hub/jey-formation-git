// Wave 0 RED scaffold for ADMIN-04 (audit log list + filters).
// D-AUDIT-01: filters on actor, action, targetType, since, until.
// See sibling users/route.test.ts header for the it.todo rationale.
import { describe, it } from 'vitest';

describe('/api/admin/audit-log [Wave 1]', () => {
  it.todo('GET returns paginated AdminAction items');
  it.todo('GET filters by actor, action, targetType');
  it.todo('GET filters by since/until createdAt range');
});
