// Wave 0 RED scaffold for OBS-01 (outbox visibility).
// Pitfall 4: schema column is `kind` (not `type`) — route MUST query/filter
// by `kind`. The CONTEXT.md spec uses `?type=` as the URL param for UX,
// and the route maps it to `where: { kind: ... }` internally.
// See sibling users/route.test.ts header for the it.todo rationale.
import { describe, it } from 'vitest';

describe('/api/admin/outbox [Wave 1]', () => {
  it.todo('GET returns paginated OutboxEvent rows');
  it.todo('GET filters by status (PENDING|SENT|FAILED|DEAD)');
  it.todo('GET filters by status and kind (not type)');
});
