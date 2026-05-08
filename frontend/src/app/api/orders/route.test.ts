// Wave 0 RED scaffold for PAY-01 (POST /api/orders).
//
// D-PAY-01..04 + Pitfall 7 (lazy-init guard for missing BICTORYS_API_KEY):
//   - Idempotency-Key header required; replay returns prior Order
//   - CircuitBreaker open → 503 PAYMENT_PROVIDER_UNAVAILABLE
//   - Missing env → 503 PAYMENT_PROVIDER_UNCONFIGURED (lazy-init guard)
//   - amount must be positive integer in smallest currency unit
//
// See sibling admin/users/route.test.ts header for the it.todo rationale.
import { describe, it } from 'vitest';

describe('POST /api/orders [Wave 1] — happy path', () => {
  it.todo('POST creates an Order and returns 201 + paymentUrl');
  it.todo('POST persists Order with idempotencyKey, providerChargeId, paymentUrl set');
});

describe('POST /api/orders [Wave 1] — idempotency', () => {
  it.todo('POST replays returns prior order on same Idempotency-Key');
  it.todo('POST 400 IDEMPOTENCY_KEY_REQUIRED when header missing');
});

describe('POST /api/orders [Wave 1] — circuit breaker', () => {
  it.todo('POST circuit open returns 503 PAYMENT_PROVIDER_UNAVAILABLE');
});

describe('POST /api/orders [Wave 1] — config guards', () => {
  it.todo('POST without BICTORYS_API_KEY returns 503 PAYMENT_PROVIDER_UNCONFIGURED');
});

describe('POST /api/orders [Wave 1] — validation', () => {
  it.todo('POST 400 VALIDATION_FAILED on non-integer amount');
  it.todo('POST 400 VALIDATION_FAILED on negative amount');
  it.todo('POST 401 when not authenticated (no guest checkout in v1 — D-PAY-03)');
});
