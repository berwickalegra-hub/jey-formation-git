---
phase: 03-admin-organizations-orders
plan: 05
type: execute
wave: 1
depends_on: [01]
files_modified:
  - frontend/src/lib/server/payments/provider-singleton.ts
  - frontend/src/app/api/orders/route.ts
autonomous: true
requirements: [PAY-01]
user_setup:
  - service: bictorys
    why: Live payment provider for POST /api/orders charge calls
    env_vars:
      - name: BICTORYS_API_URL
        source: Bictorys merchant dashboard → API settings
      - name: BICTORYS_API_KEY
        source: Bictorys merchant dashboard → API keys (charge key, NOT private/payout key)
      - name: BICTORYS_WEBHOOK_SECRET
        source: Bictorys merchant dashboard → Webhooks
      - name: PUBLIC_URL
        source: Set to deployment URL or http://localhost:3000 for dev (used to build successUrl/failureUrl)
must_haves:
  truths:
    - POST /api/orders with valid Idempotency-Key + body returns 201 { id, paymentUrl, status: 'PENDING' }
    - POST /api/orders without Idempotency-Key header returns 400 IDEMPOTENCY_KEY_REQUIRED
    - POST /api/orders replay with same Idempotency-Key returns 200 with the prior order's data (no double-charge)
    - POST /api/orders when CircuitBreaker is open returns 503 PAYMENT_PROVIDER_UNAVAILABLE with Retry-After header
    - POST /api/orders when BICTORYS_API_KEY env is missing returns 503 PAYMENT_PROVIDER_UNCONFIGURED (Pitfall 7 — lazy init)
    - POST /api/orders requires authenticated cookie session (no guest checkout in v1)
    - POST /api/orders requires CSRF (verifyCsrf before auth)
    - Order.amount stored as integer in smallest currency unit (no decimals); Zod enforces z.number().int().positive()
  artifacts:
    - path: frontend/src/lib/server/payments/provider-singleton.ts
      provides: Lazy-initialized Bictorys provider singleton + module-level CircuitBreaker (Pitfall 7 mitigation)
      exports: ['getProvider', 'breaker', 'PaymentProviderUnconfiguredError']
    - path: frontend/src/app/api/orders/route.ts
      provides: POST /api/orders — auth + CSRF + Idempotency-Key + circuit-breaker-wrapped charge
      exports: ['runtime', 'POST']
  key_links:
    - from: frontend/src/app/api/orders/route.ts
      to: frontend/src/lib/server/payments/provider-singleton.ts
      via: getProvider() (lazy) + module-level breaker
      pattern: 'provider-singleton'
    - from: frontend/src/app/api/orders/route.ts
      to: Order.idempotencyKey (Wave 0 schema delta)
      via: prisma.order.findUnique({ where: { idempotencyKey } })
      pattern: 'idempotencyKey'
    - from: frontend/src/app/api/orders/route.ts
      to: frontend/src/lib/server/payments/circuit-breaker.ts
      via: breaker.execute(() => provider.charge(...))
      pattern: 'breaker.execute'
---

<objective>
Wave 1 — implement `POST /api/orders` (PAY-01). The route is the primary user-facing endpoint of the phase: authenticated user submits an order amount + Idempotency-Key header; route creates an Order row, calls Bictorys via the existing CircuitBreaker, returns the payment URL. Replay-safe; circuit-aware; lazy-initialized so missing env returns 503 instead of crashing route load (Pitfall 7).

Purpose: Cover PAY-01 + the ROADMAP success criterion 3 ("circuit breaker trips after configured failure threshold and returns 503 with PAYMENT_PROVIDER_UNAVAILABLE").

Output: 1 helper file (provider singleton + breaker) + 1 route file.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-admin-organizations-orders/03-CONTEXT.md
@.planning/phases/03-admin-organizations-orders/03-RESEARCH.md
@frontend/src/lib/server/payments/circuit-breaker.ts
@frontend/src/lib/server/payments/provider.ts
@frontend/src/lib/server/payments/bictorys.ts
@frontend/src/lib/server/middleware/index.ts
@frontend/src/lib/server/auth.ts
@frontend/prisma/schema.prisma
@CLAUDE.md

<interfaces>
From frontend/src/lib/server/payments/circuit-breaker.ts (PROTECTED — instantiate only):
```typescript
export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  windowMs: number;
  cooldownMs: number; // ← NOTE: prop is named `cooldownMs`, NOT `openMs`. Read the file to confirm before constructing.
}
export class CircuitBreaker {
  constructor(opts: CircuitBreakerOptions);
  execute<T>(fn: () => Promise<T>): Promise<T>; // throws CircuitOpenError when open
}
export class CircuitOpenError extends Error { retryAt: Date }
```

From frontend/src/lib/server/payments/provider.ts:
```typescript
export interface ChargeCustomer { email: string; phone?: string; name?: string }
export interface ChargeInput {
  amount: number;          // smallest currency unit
  currency: string;
  customer: ChargeCustomer;
  successUrl: string;
  failureUrl: string;
  externalRef: string;
}
export interface ChargeResult {
  providerChargeId: string;
  paymentUrl: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
}
export interface PaymentProvider {
  charge(input: ChargeInput): Promise<ChargeResult>;
  // (other methods)
}
```

From frontend/src/lib/server/payments/bictorys.ts:
```typescript
export interface BictorysEnv {
  BICTORYS_API_URL: string;
  BICTORYS_API_KEY: string;
  BICTORYS_WEBHOOK_SECRET: string;
}
export function createBictorysProvider(env: BictorysEnv): BictorysProviderHandle; // throws synchronously when keys missing
```

From frontend/src/lib/server/middleware/index.ts:
```typescript
export interface AuthContext { user: { sub: string; email: string }; ... }
export async function requireAuth(authHeader?: string | null): Promise<AuthContext | NextResponse>;
```

From frontend/src/lib/server/auth.ts:
```typescript
export function verifyCsrf(req: NextRequest): NextResponse | null;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: provider-singleton.ts (lazy Bictorys + module-level CircuitBreaker)</name>
  <files>frontend/src/lib/server/payments/provider-singleton.ts</files>
  <read_first>
    - frontend/src/lib/server/payments/circuit-breaker.ts (PROTECTED — read to confirm option prop names; do NOT modify)
    - frontend/src/lib/server/payments/bictorys.ts (createBictorysProvider — note line 165-171 throws when env missing — Pitfall 7)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Pattern 3" (lines 324-456) + "Pitfall 7"
    - .planning/phases/03-admin-organizations-orders/03-CONTEXT.md D-PAY-02 (failureThreshold=5, windowMs=30_000, openMs=60_000)
  </read_first>
  <behavior>
    - `getProvider()` returns a singleton `BictorysProviderHandle`. On first call, reads env (`BICTORYS_API_URL`, `BICTORYS_API_KEY`, `BICTORYS_WEBHOOK_SECRET`); if any of those are missing OR empty string, throws `PaymentProviderUnconfiguredError`. Subsequent calls reuse the cached singleton.
    - `breaker` is a module-level `CircuitBreaker` instance with `name='bictorys.charge'`, `failureThreshold=5`, `windowMs=30_000`, `cooldownMs=60_000` (D-PAY-02 — read circuit-breaker.ts to confirm the actual property name; the option for the open→half-open delay is `cooldownMs` per the type-export verified in RESEARCH.md Pattern 3 line 351-355).
    - `PaymentProviderUnconfiguredError` is a custom Error subclass routes can `instanceof`-check.
  </behavior>
  <action>
    Create `frontend/src/lib/server/payments/provider-singleton.ts`:
    ```typescript
    import 'server-only';
    import { CircuitBreaker } from '@/lib/server/payments/circuit-breaker';
    import { createBictorysProvider, type BictorysProviderHandle } from '@/lib/server/payments/bictorys';

    export class PaymentProviderUnconfiguredError extends Error {
      constructor() {
        super('Payment provider not configured (BICTORYS_API_URL/_API_KEY/_WEBHOOK_SECRET missing)');
        this.name = 'PaymentProviderUnconfiguredError';
      }
    }

    let _provider: BictorysProviderHandle | null = null;

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

    // Module-level singleton — single-instance only per CLAUDE.md.
    // D-PAY-02 hard-codes thresholds: failureThreshold=5, windowMs=30_000, cooldownMs=60_000
    export const breaker = new CircuitBreaker({
      name: 'bictorys.charge',
      failureThreshold: 5,
      windowMs: 30_000,
      cooldownMs: 60_000,
    });

    // Test-only escape hatch — not exported as a public API.
    /** @internal — for tests to reset the singleton between cases */
    export function __resetProviderSingleton(): void {
      _provider = null;
    }
    ```

    If, after reading circuit-breaker.ts, the actual property name turns out to be `openMs` rather than `cooldownMs`, use the actual property name verbatim and note the deviation in the SUMMARY. Do not modify circuit-breaker.ts.
  </action>
  <verify>
    <automated>test -f frontend/src/lib/server/payments/provider-singleton.ts &amp;&amp; pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/lib/server/payments/provider-singleton.ts` exists
    - `grep -c "PaymentProviderUnconfiguredError" frontend/src/lib/server/payments/provider-singleton.ts` returns ≥2 (class def + throw)
    - `grep -c "failureThreshold: 5" frontend/src/lib/server/payments/provider-singleton.ts` returns 1
    - `grep -c "windowMs: 30_000" frontend/src/lib/server/payments/provider-singleton.ts` returns 1
    - `grep -cE "(cooldownMs|openMs): 60_000" frontend/src/lib/server/payments/provider-singleton.ts` returns 1 (whichever the breaker option name actually is)
    - `pnpm typecheck` exits 0
  </acceptance_criteria>
  <done>Lazy provider singleton + module-level breaker exported; typecheck green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: POST /api/orders route (auth + CSRF + Idempotency-Key + breaker)</name>
  <files>frontend/src/app/api/orders/route.ts</files>
  <read_first>
    - frontend/src/app/api/orders/route.test.ts (Wave 0 RED scaffolding — covers all 4 PAY-01 test names)
    - frontend/src/lib/server/payments/provider-singleton.ts (Task 1 just created)
    - frontend/src/lib/server/payments/circuit-breaker.ts (CircuitOpenError shape — `retryAt: Date` property)
    - frontend/src/lib/server/auth.ts (`verifyCsrf` signature)
    - frontend/src/lib/server/middleware/index.ts (`requireAuth` signature)
    - frontend/src/app/api/notifications/route.ts (Phase 2 reference — wrapper + verifyCsrf + requireAuth pattern for POST)
    - frontend/prisma/schema.prisma — Order model with new `idempotencyKey @unique` (Wave 0)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Pattern 3" (lines 324-456) — full POST template
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Pitfall 3: Idempotency-Key storage on already-failed orders"
  </read_first>
  <behavior>
    - POST `/api/orders` flow:
      1. `verifyCsrf(req)` → bail with `if (csrfFail) return csrfFail`
      2. `requireAuth()` → bail on `NextResponse`
      3. Read `Idempotency-Key` header; missing → `400 { error: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header required' }`
      4. Lookup `prisma.order.findUnique({ where: { idempotencyKey } })`. If exists:
         - `existing.status === 'PENDING' || existing.status === 'PAID'` → `200 { id, paymentUrl, status }`
         - `existing.status === 'FAILED' || 'EXPIRED' || 'REFUNDED'` → `503 { error: 'PAYMENT_PROVIDER_UNAVAILABLE', message: '...' }` per Pitfall 3 (replay outcome, not row)
      5. Parse body via Zod (D-PAY-04 schema below). Failure → `400 { error: 'VALIDATION_FAILED', issues: [...] }`
      6. Call `getProvider()`. If throws `PaymentProviderUnconfiguredError` → `503 { error: 'PAYMENT_PROVIDER_UNCONFIGURED', message: 'Payment provider not configured' }` (Pitfall 7)
      7. Create Order row PENDING with `idempotencyKey`, `expiresAt = now + 24h`, etc.
      8. Wrap `provider.charge(...)` in `breaker.execute(...)`. On success → update row with `providerChargeId, paymentUrl`, return `201 { id, paymentUrl, status: 'PENDING' }`. On `CircuitOpenError` → mark order FAILED, return `503` with `Retry-After` header. On other errors → mark FAILED, return `502 { error: 'PAYMENT_FAILED', message }`.
    - Zod body schema (D-PAY-04 verbatim):
      ```
      z.object({
        amount: z.number().int().positive(),
        currency: z.string().length(3).default('XOF'),
        customerEmail: z.string().email().optional(),
        customerPhone: z.string().optional(),
        customerName: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      ```
    - `customerEmail` defaults to `auth.user.email` if absent.
  </behavior>
  <action>
    Create `frontend/src/app/api/orders/route.ts` based on RESEARCH.md Pattern 3 (lines 324-456) verbatim, with two adaptations:

    1. Replace inline `createBictorysProvider` + `breaker` construction at module scope with imports from Task 1's `provider-singleton.ts`. Use `getProvider()` inside the handler (so unconfigured env returns 503, not crash on import).
    2. Implement Pitfall 3 — replay branch checks `existing.status` and emits the right code:
    ```typescript
    if (existing) {
      if (existing.status === 'PENDING' || existing.status === 'PAID') {
        return NextResponse.json(
          { id: existing.id, paymentUrl: existing.paymentUrl, status: existing.status },
          { status: 200 },
        );
      }
      // FAILED/EXPIRED/REFUNDED — replay the original adverse outcome
      return NextResponse.json(
        {
          error: 'PAYMENT_PROVIDER_UNAVAILABLE',
          message: 'A previous attempt with this Idempotency-Key did not complete; submit a new key to retry.',
        },
        { status: 503 },
      );
    }
    ```

    3. Wrap `getProvider()` in try/catch:
    ```typescript
    let provider: BictorysProviderHandle;
    try {
      provider = getProvider();
    } catch (err) {
      if (err instanceof PaymentProviderUnconfiguredError) {
        return NextResponse.json(
          { error: 'PAYMENT_PROVIDER_UNCONFIGURED', message: 'Payment provider not configured' },
          { status: 503 },
        );
      }
      throw err;
    }
    ```

    4. Make sure to export `runtime = 'nodejs'` first.

    5. Wrap the entire body in `withRequestContext(makeRequestContext(req.headers), async () => { ... })`.

    Make all 4 PAY-01 tests in `orders/route.test.ts` GREEN by mocking `provider-singleton`:
    - `it('POST creates an Order and returns 201 + paymentUrl')`: mock `getProvider` to return a provider whose `charge()` resolves with `{ providerChargeId: 'ch_x', paymentUrl: 'https://...' , status: 'PENDING' }`; assert 201 + Order row exists with `idempotencyKey` set
    - `it('POST replays returns prior order on same Idempotency-Key')`: seed an Order with idempotencyKey='abc' status PENDING; POST with same key → 200 + same Order id; mock charge NOT called
    - `it('POST circuit open returns 503 PAYMENT_PROVIDER_UNAVAILABLE')`: mock the breaker (or use `mockBictorysProvider({ openCircuit: true })`) so `breaker.execute` throws `CircuitOpenError`; assert 503 + Order row marked FAILED + `Retry-After` header present
    - `it('POST without BICTORYS_API_KEY returns 503 PAYMENT_PROVIDER_UNCONFIGURED')`: `delete process.env.BICTORYS_API_KEY`; call `__resetProviderSingleton()`; POST returns 503 with that exact code
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/orders/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/orders/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/orders/route.ts` returns 1
    - `grep -c "verifyCsrf" frontend/src/app/api/orders/route.ts` returns 1
    - `grep -c "requireAuth" frontend/src/app/api/orders/route.ts` returns 1
    - `grep -c "Idempotency-Key" frontend/src/app/api/orders/route.ts` returns ≥1 (or `idempotency-key` lowercase)
    - `grep -c "IDEMPOTENCY_KEY_REQUIRED" frontend/src/app/api/orders/route.ts` returns 1
    - `grep -c "PAYMENT_PROVIDER_UNAVAILABLE" frontend/src/app/api/orders/route.ts` returns ≥2 (replay-failed branch + circuit-open branch)
    - `grep -c "PAYMENT_PROVIDER_UNCONFIGURED" frontend/src/app/api/orders/route.ts` returns 1
    - `grep -c "breaker.execute" frontend/src/app/api/orders/route.ts` returns 1
    - `grep -c "Retry-After" frontend/src/app/api/orders/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/orders/route.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
  </acceptance_criteria>
  <done>POST /api/orders implemented; all 4 PAY-01 tests green; runtime-enforcement still green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → POST /api/orders | Authenticated cookie session crossing into financial-mutation |
| route → Bictorys API | Outbound HTTPS with API key in Authorization header |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-05-01 | Tampering | Idempotency-Key collision (attacker reuses victim's key) | mitigate | Replay returns ORIGINAL Order which is `userId`-scoped — even if a key collides, the response includes the original creator's order id. Authentication gate ensures attacker also needs a session. Verification: orders/route.test.ts asserts replay returns the original order, not a new one for the second user. |
| T-03-05-02 | Denial of Service | Circuit-breaker thundering herd on probe | mitigate | `probeInFlight` single-flight in CircuitBreaker (verified: circuit-breaker.ts:82). No code change required. |
| T-03-05-03 | Tampering (CSRF) | Cross-site POST forging an order | mitigate | `verifyCsrf(req)` BEFORE auth (CF-02). Verification: grep returns 1 for `verifyCsrf`. |
| T-03-05-04 | Denial of Service / Misconfiguration | Module-load crash when env absent (Pitfall 7) | mitigate | Lazy `getProvider()` + `PaymentProviderUnconfiguredError` → 503 instead of 500. Verification: orders/route.test.ts asserts 503 PAYMENT_PROVIDER_UNCONFIGURED branch. |
| T-03-05-05 | Information Disclosure (financial) | Provider error message echoed to client | mitigate | The 502 PAYMENT_FAILED branch returns `(err as Error).message` — review in code: this is provider-side error text, not internal stack trace. Acceptable for v1; route-level Sentry capture exists via `onRequestError` (OPS-03). |
| T-03-05-06 | Tampering (mass-assignment via metadata) | Client puts arbitrary keys in `metadata` | accept | D-PAY-04 explicitly allows `metadata: z.record(z.unknown())` — app-specific. Server stores it as opaque JSON; never executes. |
| T-03-05-07 | Tampering (Idempotency-Key replays a FAILED order with hidden semantics) | Frontend redirect to empty paymentUrl from failed replay | mitigate | Pitfall 3 — replay of FAILED/EXPIRED/REFUNDED returns 503 PAYMENT_PROVIDER_UNAVAILABLE, never 200 with empty paymentUrl. Verification: grep `PAYMENT_PROVIDER_UNAVAILABLE` returns ≥2. |
| T-03-05-08 | Repudiation (financial) | User claims they didn't authorize the charge | mitigate | `Order.userId` populated from `auth.user.sub`; cookie+JWT auth required; AdminAction NOT written here (Order creation is a user action, not an admin action). Future: append OrderEvent rows for audit trail (out of scope this phase). |
</threat_model>

<verification>
- `frontend/src/app/api/orders/route.ts` and `frontend/src/lib/server/payments/provider-singleton.ts` exist
- `pnpm --filter frontend exec vitest run src/app/api/orders/` all 4 PAY-01 test names pass
- `pnpm typecheck && pnpm lint` exit 0
- runtime-enforcement.test.ts still green
</verification>

<success_criteria>
- Authenticated user can POST /api/orders with valid Idempotency-Key → 201 + paymentUrl
- Replay returns prior order (200) without re-charging
- CircuitBreaker open → 503 PAYMENT_PROVIDER_UNAVAILABLE + Retry-After
- Missing BICTORYS_* env → 503 PAYMENT_PROVIDER_UNCONFIGURED (not 500)
- Order.amount stored as integer; Zod rejects decimals
</success_criteria>

<output>
After completion, create `.planning/phases/03-admin-organizations-orders/03-05-SUMMARY.md` documenting:
- 2 files created
- CircuitBreaker option name resolved (cooldownMs vs openMs)
- All 4 PAY-01 test paths confirmed green
</output>
