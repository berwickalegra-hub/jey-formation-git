// Wave 0 RED scaffold for OBS-03 (rate-limit visibility).
// D-OBS-03: bucket summary across known prefixes (login/signup/forgot/
// reset/verify/pin). Pitfall 6: hard-cap at 1000 keys per bucket and emit
// `truncated: true` so a runaway bucket doesn't OOM the response.
// See sibling users/route.test.ts header for the it.todo rationale.
import { describe, it } from 'vitest';

describe('/api/admin/rate-limits [Wave 1]', () => {
  it.todo('GET returns bucket summary across known prefixes');
  it.todo('GET hard-caps at 1000 keys per bucket and emits truncated:true');
  it.todo('GET uses Redis SCAN (not KEYS) for non-blocking enumeration');
  it.todo('GET returns top10 [{ key, hits, expiresAt }] per bucket');
});
