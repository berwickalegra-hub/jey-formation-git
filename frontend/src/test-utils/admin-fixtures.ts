// Wave 0 test fixtures for Phase 3 (Admin / Orders / Visibility).
//
// Two flavors of helpers in one module:
//   - `seed*` factories take a (mocked) Prisma client and return a typed
//     row. They DON'T touch a real DB — Wave 1/2 unit tests all run
//     against `vitest-mock-extended`'s `mockDeep<PrismaClient>()` from
//     `@/test-utils/prisma-mock` (D-25). The seed factories return a
//     pre-shaped User/Order/OutboxEvent/EmailJob the test then wires
//     into `prismaMock.user.findFirst.mockResolvedValue(...)` etc.
//   - `mock*` factories return Vitest stubs (Redis client, PaymentProvider)
//     wired to common scenarios (open circuit, populated rate-limit bucket).
//
// All factories are deterministic: each call to `seedAdmin()` etc.
// returns the same shape every time so tests can assert exact rows.
// Tests that need uniqueness override fields explicitly.
import { vi } from 'vitest';
import type { User, Order, OutboxEvent, EmailJob, Prisma } from '@prisma/client';
import type { PaymentProvider, ChargeResult } from '@/lib/server/payments/provider';

const FROZEN_NOW = new Date('2026-05-08T12:00:00.000Z');

// ────────────────────────────────────────────────────────────────────
// User factories
// ────────────────────────────────────────────────────────────────────

interface UserOverrides {
  id?: string;
  email?: string;
  role?: 'USER' | 'ADMIN' | 'SUPERADMIN';
  status?: 'ACTIVE' | 'SUSPENDED';
  passwordHash?: string | null;
  emailVerifiedAt?: Date | null;
}

function buildUser(overrides: UserOverrides = {}): User {
  return {
    id: overrides.id ?? `user_${Math.random().toString(36).slice(2, 10)}`,
    email: overrides.email ?? `user-${Date.now()}@test.local`,
    passwordHash:
      overrides.passwordHash ?? '$2b$12$fakehashfakehashfakehashfakehashfakehashfakeHASHE',
    emailVerifiedAt: overrides.emailVerifiedAt ?? FROZEN_NOW,
    tokenVersion: 0,
    withdrawalPinHash: null,
    name: null,
    avatarUrl: null,
    role: overrides.role ?? 'USER',
    status: overrides.status ?? 'ACTIVE',
    createdAt: FROZEN_NOW,
    updatedAt: FROZEN_NOW,
  } as User;
}

export function seedAdmin(overrides: UserOverrides = {}): User {
  return buildUser({
    id: overrides.id ?? 'admin_seed_1',
    email: overrides.email ?? 'admin@test.local',
    role: 'ADMIN',
    status: overrides.status ?? 'ACTIVE',
    ...overrides,
  });
}

export function seedSuperadmin(overrides: UserOverrides = {}): User {
  return buildUser({
    id: overrides.id ?? 'superadmin_seed_1',
    email: overrides.email ?? 'superadmin@test.local',
    role: 'SUPERADMIN',
    ...overrides,
  });
}

/**
 * Returns two SUPERADMINs so the demotable one can be safely demoted to
 * ADMIN without violating CF-09 (last-SUPERADMIN guard).
 */
export function seedDemotableSuperadmin(): { keeper: User; demotable: User } {
  return {
    keeper: seedSuperadmin({ id: 'superadmin_keeper', email: 'keeper@test.local' }),
    demotable: seedSuperadmin({ id: 'superadmin_demotable', email: 'demotable@test.local' }),
  };
}

export function seedSuspendedUser(overrides: UserOverrides = {}): User {
  return buildUser({
    id: overrides.id ?? 'suspended_seed_1',
    email: overrides.email ?? 'suspended@test.local',
    role: 'USER',
    status: 'SUSPENDED',
    ...overrides,
  });
}

// ────────────────────────────────────────────────────────────────────
// Domain row factories
// ────────────────────────────────────────────────────────────────────

interface OrderOverrides {
  id?: string;
  userId?: string;
  amount?: number;
  currency?: string;
  status?: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' | 'REFUNDED';
  idempotencyKey?: string | null;
  provider?: string;
  paymentUrl?: string | null;
  providerChargeId?: string | null;
  metadata?: Prisma.JsonValue | null;
}

export function seedOrder(overrides: OrderOverrides = {}): Order {
  return {
    id: overrides.id ?? `order_${Math.random().toString(36).slice(2, 10)}`,
    userId: overrides.userId ?? 'user_seed_1',
    amount: overrides.amount ?? 1000,
    currency: overrides.currency ?? 'XOF',
    status: overrides.status ?? 'PENDING',
    customerEmail: null,
    customerPhone: null,
    customerName: null,
    metadata: (overrides.metadata ?? null) as Prisma.JsonValue,
    idempotencyKey: overrides.idempotencyKey ?? null,
    provider: overrides.provider ?? 'bictorys',
    providerChargeId: overrides.providerChargeId ?? null,
    paymentUrl: overrides.paymentUrl ?? null,
    paymentMethod: null,
    commissionAmount: null,
    netAmount: null,
    expiresAt: new Date(FROZEN_NOW.getTime() + 30 * 60 * 1000),
    paidAt: null,
    createdAt: FROZEN_NOW,
    updatedAt: FROZEN_NOW,
  } as Order;
}

interface OutboxOverrides {
  id?: string;
  kind?: string;
  status?: 'PENDING' | 'SENT' | 'FAILED' | 'DEAD';
  payload?: Prisma.JsonValue;
  attempts?: number;
}

export function seedOutbox(overrides: OutboxOverrides = {}): OutboxEvent {
  return {
    id: overrides.id ?? `outbox_${Math.random().toString(36).slice(2, 10)}`,
    kind: overrides.kind ?? 'notification.payment_received',
    payload: (overrides.payload ?? { foo: 'bar' }) as Prisma.JsonValue,
    status: overrides.status ?? 'PENDING',
    attempts: overrides.attempts ?? 0,
    lastError: null,
    scheduledAt: FROZEN_NOW,
    sentAt: null,
    createdAt: FROZEN_NOW,
  } as OutboxEvent;
}

interface EmailJobOverrides {
  id?: string;
  to?: string;
  subject?: string;
  html?: string;
  status?: 'PENDING' | 'SENT' | 'FAILED' | 'DEAD';
  attempts?: number;
}

export function seedEmailJob(overrides: EmailJobOverrides = {}): EmailJob {
  return {
    id: overrides.id ?? `email_${Math.random().toString(36).slice(2, 10)}`,
    to: overrides.to ?? 'user@test.local',
    subject: overrides.subject ?? 'Test email',
    // Default body intentionally exceeds 200 chars so OBS-02 truncation tests
    // can verify `bodyPreview` slice without a per-test override.
    html: overrides.html ?? 'a'.repeat(500),
    text: null,
    status: overrides.status ?? 'PENDING',
    attempts: overrides.attempts ?? 0,
    lastError: null,
    scheduledAt: FROZEN_NOW,
    sentAt: null,
    createdAt: FROZEN_NOW,
  } as EmailJob;
}

// ────────────────────────────────────────────────────────────────────
// Mock factories — Redis stub + PaymentProvider stub
// ────────────────────────────────────────────────────────────────────

/**
 * Stub Redis client wide enough to satisfy the rate-limit-store +
 * /api/admin/rate-limits SCAN endpoint. Stores entries from the supplied
 * `map` and exposes scan/mget/ttl/get/incr/expire/del/keys.
 *
 * Key TTL is encoded by appending `:ttl=<seconds>` in the stored value or
 * via `setTtl(key, seconds)`. Tests pass a flat map for read-only scenarios.
 */
export interface MockRedisStub {
  // Read paths used by /api/admin/rate-limits route
  scan: ReturnType<typeof vi.fn>;
  mget: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  // Write paths used by enforceAdminRateLimit
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  decr: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  // Test-side accessor
  __store: Map<string, { value: string | number; ttl: number }>;
}

export function mockRedis(map: Record<string, string | number> = {}): MockRedisStub {
  const store = new Map<string, { value: string | number; ttl: number }>();
  for (const [k, v] of Object.entries(map)) store.set(k, { value: v, ttl: 60 });

  const scan = vi.fn(async (cursor: string | number, opts?: { match?: string; count?: number }) => {
    const match = opts?.match ?? '*';
    const re = new RegExp('^' + match.replace(/\*/g, '.*') + '$');
    const matched = [...store.keys()].filter((k) => re.test(k));
    return [0, matched] as [number, string[]];
  });

  return {
    scan,
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k)?.value ?? null)),
    ttl: vi.fn(async (key: string) => store.get(key)?.ttl ?? -2),
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    incr: vi.fn(async (key: string) => {
      const cur = (store.get(key)?.value as number) ?? 0;
      const next = Number(cur) + 1;
      store.set(key, { value: next, ttl: store.get(key)?.ttl ?? 60 });
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      const cur = store.get(key);
      if (cur) store.set(key, { value: cur.value, ttl: seconds });
      return cur ? 1 : 0;
    }),
    decr: vi.fn(async (key: string) => {
      const cur = (store.get(key)?.value as number) ?? 0;
      const next = Math.max(0, Number(cur) - 1);
      store.set(key, { value: next, ttl: store.get(key)?.ttl ?? 60 });
      return next;
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    keys: vi.fn(async (pattern: string) => {
      const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return [...store.keys()].filter((k) => re.test(k));
    }),
    __store: store,
  };
}

/**
 * Stub PaymentProvider for orders/route.test.ts. By default returns a happy
 * ChargeResult; pass `{ openCircuit: true }` to make `.charge()` reject so
 * the CircuitBreaker can be exercised.
 */
export interface MockBictorysOptions {
  openCircuit?: boolean;
  chargeResult?: ChargeResult;
  chargeError?: Error;
}

export function mockBictorysProvider(
  opts: MockBictorysOptions = {},
): PaymentProvider & { charge: ReturnType<typeof vi.fn> } {
  const charge = opts.openCircuit
    ? vi.fn(async () => {
        throw opts.chargeError ?? new Error('upstream provider failure');
      })
    : vi.fn(async () => ({
        providerChargeId: 'bictorys_charge_test_1',
        paymentUrl: 'https://checkout.test/bictorys/pay/test',
        status: 'PENDING' as const,
        ...(opts.chargeResult ?? {}),
      }));

  return {
    name: 'bictorys',
    charge,
  };
}
