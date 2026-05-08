// Wave 0 RED scaffold for OBS-02 (email queue visibility).
// D-OBS-02: response uses `bodyPreview` (≤200 chars) instead of full `body`
// — PII protection so admins can spot-check delivery without leaking
// reset-password links or magic codes.
// See sibling users/route.test.ts header for the it.todo rationale.
import { describe, it } from 'vitest';

describe('/api/admin/email-queue [Wave 1]', () => {
  it.todo('GET returns EmailJob rows with bodyPreview ≤200 chars (PII protection)');
  it.todo('GET filters by status (PENDING|SENT|FAILED|DEAD)');
  it.todo('GET never returns the full html body field');
});
