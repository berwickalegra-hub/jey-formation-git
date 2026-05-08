// PAY-01 Wave 1 tests for POST /api/orders.
//
// Bootstrap (mirrors notifications/route.test.ts):
//   - prisma-mock first (auto-hoists vi.mock for '@/lib/server/prisma')
//   - mockNextCookies() for next/headers async cookies()
//   - vi.mock('@/lib/server/middleware') so requireAuth is per-test controllable
//   - vi.mock('@/lib/server/payments/provider-singleton') so getProvider()
//     returns a stub PaymentProvider instead of trying to read BICTORYS_* env
//
// Coverage maps to plan acceptance + Wave 0 scaffolds:
//   happy path:     creates Order + returns 201 + paymentUrl, persists with idempotencyKey
//   idempotency:    replay same key → prior 200 row; missing key → 400
//   circuit:        CircuitOpenError → 503 PAYMENT_PROVIDER_UNAVAILABLE + Retry-After + Order FAILED
//   config guard:   BICTORYS env missing → 503 PAYMENT_PROVIDER_UNCONFIGURED (Pitfall 7)
//   validation:     non-int amount + negative amount → 400 VALIDATION_FAILED
//   auth:           requireAuth bails → 401 (D-PAY-03 — no guest checkout in v1)
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/server/payments/provider-singleton', () => ({
  getProvider: vi.fn(),
  // Use the real CircuitBreaker so its state machine runs, but expose a
  // mockable `execute` per-test via spies on the returned object.
  breaker: { execute: vi.fn() },
  PaymentProviderUnconfiguredError: class PaymentProviderUnconfiguredError extends Error {
    constructor() {
      super('Payment provider not configured');
      this.name = 'PaymentProviderUnconfiguredError';
    }
  },
  __resetProviderSingleton: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import {
  getProvider,
  breaker,
  PaymentProviderUnconfiguredError,
} from '@/lib/server/payments/provider-singleton';
import { CircuitOpenError } from '@/lib/server/payments/circuit-breaker';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetProvider = vi.mocked(getProvider);
const mockExecute = vi.mocked(breaker.execute);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

interface MakePostOpts {
  idempotencyKey?: string | null;
  csrf?: 'match' | 'missing';
}

function makePost(body: unknown, opts: MakePostOpts = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  if (opts.idempotencyKey !== null && opts.idempotencyKey !== undefined) {
    headers['idempotency-key'] = opts.idempotencyKey;
  }
  return body === undefined
    ? new NextRequest('http://test/api/orders', { method: 'POST', headers })
    : new NextRequest('http://test/api/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
}

function seededOrder(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order_seed_1',
    userId: 'user-1',
    amount: 1000,
    currency: 'XOF',
    status: 'PENDING',
    customerEmail: 'me@example.com',
    customerPhone: null,
    customerName: null,
    metadata: null,
    idempotencyKey: 'idem-key-1',
    provider: 'bictorys',
    providerChargeId: null,
    paymentUrl: null,
    paymentMethod: null,
    commissionAmount: null,
    netAmount: null,
    expiresAt: new Date('2026-05-09T12:00:00Z'),
    paidAt: null,
    createdAt: new Date('2026-05-08T12:00:00Z'),
    updatedAt: new Date('2026-05-08T12:00:00Z'),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default — env present so getProvider() succeeds, requireAuth returns user.
  process.env.BICTORYS_API_URL = 'https://api.test.bictorys.local';
  process.env.BICTORYS_API_KEY = 'test-key';
  process.env.BICTORYS_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.PUBLIC_URL = 'http://localhost:3000';

  mockRequireAuth.mockResolvedValue(authedCtx);
  mockGetProvider.mockReturnValue({
    name: 'bictorys',
    charge: vi.fn(async () => ({
      providerChargeId: 'bictorys_charge_test_1',
      paymentUrl: 'https://checkout.test/bictorys/pay/test',
      status: 'PENDING' as const,
    })),
  } as never);
  // Default execute = identity around the provided fn (real-call path).
  mockExecute.mockImplementation(async (fn) => fn());
});

describe('POST /api/orders [Wave 1] — happy path', () => {
  it('POST creates an Order and returns 201 + paymentUrl', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null as never);
    prismaMock.order.create.mockResolvedValue(seededOrder() as never);
    prismaMock.order.update.mockResolvedValue(
      seededOrder({
        providerChargeId: 'bictorys_charge_test_1',
        paymentUrl: 'https://checkout.test/bictorys/pay/test',
      }) as never,
    );

    const res = await POST(
      makePost({ amount: 1000, currency: 'XOF' }, { idempotencyKey: 'idem-key-1' }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'order_seed_1',
      paymentUrl: 'https://checkout.test/bictorys/pay/test',
      status: 'PENDING',
    });
    expect(prismaMock.order.create).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it('POST persists Order with idempotencyKey, providerChargeId, paymentUrl set', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null as never);
    prismaMock.order.create.mockResolvedValue(seededOrder() as never);
    prismaMock.order.update.mockResolvedValue(seededOrder() as never);

    await POST(
      makePost(
        { amount: 5000, currency: 'XOF', metadata: { source: 'web' } },
        { idempotencyKey: 'unique-idem-1' },
      ),
    );

    // create call carries idempotencyKey + amount + currency + metadata
    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({
      userId: 'user-1',
      amount: 5000,
      currency: 'XOF',
      provider: 'bictorys',
      status: 'PENDING',
      idempotencyKey: 'unique-idem-1',
      metadata: { source: 'web' },
    });

    // update call carries providerChargeId + paymentUrl from the (mocked) charge
    expect(prismaMock.order.update).toHaveBeenCalledOnce();
    const updateArgs = prismaMock.order.update.mock.calls[0]?.[0];
    expect(updateArgs?.data).toMatchObject({
      providerChargeId: 'bictorys_charge_test_1',
      paymentUrl: 'https://checkout.test/bictorys/pay/test',
    });
  });
});

describe('POST /api/orders [Wave 1] — idempotency', () => {
  it('POST replays returns prior order on same Idempotency-Key', async () => {
    // Existing PENDING order with same idempotency key
    prismaMock.order.findUnique.mockResolvedValue(
      seededOrder({
        id: 'order_existing',
        idempotencyKey: 'replay-key',
        paymentUrl: 'https://checkout.test/bictorys/pay/existing',
      }) as never,
    );

    const res = await POST(
      makePost({ amount: 1000, currency: 'XOF' }, { idempotencyKey: 'replay-key' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'order_existing',
      paymentUrl: 'https://checkout.test/bictorys/pay/existing',
      status: 'PENDING',
    });
    // No new charge attempted
    expect(prismaMock.order.create).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('POST replay of FAILED order returns 503 PAYMENT_PROVIDER_UNAVAILABLE (Pitfall 3)', async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      seededOrder({
        id: 'order_failed_replay',
        status: 'FAILED',
        idempotencyKey: 'failed-replay-key',
      }) as never,
    );

    const res = await POST(
      makePost({ amount: 1000, currency: 'XOF' }, { idempotencyKey: 'failed-replay-key' }),
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('POST 400 IDEMPOTENCY_KEY_REQUIRED when header missing', async () => {
    const res = await POST(makePost({ amount: 1000, currency: 'XOF' }, { idempotencyKey: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders [Wave 1] — circuit breaker', () => {
  it('POST circuit open returns 503 PAYMENT_PROVIDER_UNAVAILABLE', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null as never);
    prismaMock.order.create.mockResolvedValue(seededOrder({ id: 'order_circuit_1' }) as never);
    prismaMock.order.update.mockResolvedValue(
      seededOrder({ id: 'order_circuit_1', status: 'FAILED' }) as never,
    );

    const retryAt = new Date(Date.now() + 60_000);
    mockExecute.mockImplementationOnce(async () => {
      throw new CircuitOpenError('bictorys.charge', retryAt);
    });

    const res = await POST(
      makePost({ amount: 1000, currency: 'XOF' }, { idempotencyKey: 'circuit-key' }),
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(res.headers.get('Retry-After')).toBeTruthy();

    // Order was created PENDING then marked FAILED so subsequent replays
    // hit the Pitfall 3 branch (return 503, not 200 with empty paymentUrl).
    expect(prismaMock.order.update).toHaveBeenCalledOnce();
    const updateArgs = prismaMock.order.update.mock.calls[0]?.[0];
    expect(updateArgs?.data).toMatchObject({ status: 'FAILED' });
  });
});

describe('POST /api/orders [Wave 1] — config guards', () => {
  it('POST without BICTORYS_API_KEY returns 503 PAYMENT_PROVIDER_UNCONFIGURED', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null as never);
    // Simulate Pitfall 7 — getProvider throws because env was wiped.
    mockGetProvider.mockImplementationOnce(() => {
      throw new PaymentProviderUnconfiguredError();
    });

    const res = await POST(
      makePost({ amount: 1000, currency: 'XOF' }, { idempotencyKey: 'no-env-key' }),
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_PROVIDER_UNCONFIGURED');
    // No Order row was inserted because we bailed before create()
    expect(prismaMock.order.create).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders [Wave 1] — validation', () => {
  it('POST 400 VALIDATION_FAILED on non-integer amount', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null as never);
    const res = await POST(
      makePost({ amount: 99.5, currency: 'XOF' }, { idempotencyKey: 'val-1' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('POST 400 VALIDATION_FAILED on negative amount', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null as never);
    const res = await POST(
      makePost({ amount: -100, currency: 'XOF' }, { idempotencyKey: 'val-2' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('POST 401 when not authenticated (no guest checkout in v1 — D-PAY-03)', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(
      makePost({ amount: 1000, currency: 'XOF' }, { idempotencyKey: 'auth-1' }),
    );
    expect(res.status).toBe(401);
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders [Wave 1] — CSRF', () => {
  it('POST 403 when CSRF header missing (CF-02 — verifyCsrf before auth)', async () => {
    const res = await POST(
      makePost({ amount: 1000, currency: 'XOF' }, { idempotencyKey: 'csrf-1', csrf: 'missing' }),
    );
    expect(res.status).toBe(403);
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });
});
