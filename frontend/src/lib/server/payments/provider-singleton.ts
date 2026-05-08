// Lazy-initialized Bictorys provider + module-level CircuitBreaker (D-PAY-02 + Pitfall 7).
//
// Why lazy?
//   `createBictorysProvider({...})` throws synchronously if any of
//   BICTORYS_API_URL / BICTORYS_API_KEY / BICTORYS_WEBHOOK_SECRET is missing
//   (see bictorys.ts:165-171). Calling it at module top-level inside a route
//   would crash the route-module on import — every POST /api/orders would
//   then return 500 with no useful error.
//
//   This module instead exposes `getProvider()` which constructs the provider
//   on first call, caches it for subsequent calls, and throws a typed
//   `PaymentProviderUnconfiguredError` if env is missing. The route catches
//   that error and returns a clean 503 PAYMENT_PROVIDER_UNCONFIGURED.
//
// Why a single shared CircuitBreaker?
//   The breaker holds in-memory failure-counter state. Re-instantiating it
//   per request would defeat its purpose. Sharing it at module scope is by
//   design — see CLAUDE.md "single-instance only" note for the in-memory
//   breaker. For multi-pod deployments swap for a Redis-backed variant.
//
// CircuitBreakerOptions: the `cooldownMs` property name is verified against
// circuit-breaker.ts:27 ("OPEN→HALF_OPEN cooldown in ms. Default 60 000.").
// Earlier docs sometimes called this `openMs`; the actual exported option is
// `cooldownMs`.
import 'server-only';
import {
  createBictorysProvider,
  type BictorysProviderHandle,
} from '@/lib/server/payments/bictorys';
import { CircuitBreaker } from '@/lib/server/payments/circuit-breaker';

/**
 * Thrown by `getProvider()` when BICTORYS_API_URL, BICTORYS_API_KEY, or
 * BICTORYS_WEBHOOK_SECRET is missing/empty. The orders route should catch
 * this `instanceof` and return 503 PAYMENT_PROVIDER_UNCONFIGURED.
 */
export class PaymentProviderUnconfiguredError extends Error {
  constructor() {
    super(
      'Payment provider not configured (BICTORYS_API_URL/_API_KEY/_WEBHOOK_SECRET missing or empty)',
    );
    this.name = 'PaymentProviderUnconfiguredError';
  }
}

let _provider: BictorysProviderHandle | null = null;

/**
 * Lazy-init singleton accessor. First call reads `process.env`, constructs
 * the Bictorys provider, and caches the handle. Subsequent calls reuse the
 * cached instance. Throws `PaymentProviderUnconfiguredError` if any required
 * env var is missing — the route translates that to 503.
 */
export function getProvider(): BictorysProviderHandle {
  if (_provider) return _provider;

  const url = process.env.BICTORYS_API_URL ?? '';
  const key = process.env.BICTORYS_API_KEY ?? '';
  const webhookSecret = process.env.BICTORYS_WEBHOOK_SECRET ?? '';

  if (!url || !key || !webhookSecret) {
    throw new PaymentProviderUnconfiguredError();
  }

  _provider = createBictorysProvider({
    BICTORYS_API_URL: url,
    BICTORYS_API_KEY: key,
    BICTORYS_WEBHOOK_SECRET: webhookSecret,
  });
  return _provider;
}

/**
 * Module-level CircuitBreaker — single-instance only per CLAUDE.md.
 * D-PAY-02 hard-codes the thresholds:
 *   - failureThreshold = 5 failures within
 *   - windowMs = 30 000 (30s rolling window)
 *   - cooldownMs = 60 000 (open → half-open delay)
 */
export const breaker = new CircuitBreaker({
  name: 'bictorys.charge',
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 60_000,
});

/**
 * Test-only escape hatch — clears the cached provider so a test can mutate
 * `process.env.BICTORYS_*` and re-trigger lazy init. Never call this from
 * application code.
 *
 * @internal
 */
export function __resetProviderSingleton(): void {
  _provider = null;
}
