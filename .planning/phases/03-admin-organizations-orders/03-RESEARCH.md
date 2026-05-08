# Phase 3: Admin, Orders, Visibility — Research

**Researched:** 2026-05-08
**Domain:** Admin back-office REST endpoints + payment order creation + observability surface (outbox, email-queue, rate-limit hits)
**Confidence:** HIGH

## Summary

Phase 3 ships **eleven Route Handlers** (8 admin + 1 orders + 2 visibility-only admin) plus **one bootstrap CLI script** and **one Prisma migration** (`User.status` + `Order.idempotencyKey`). Almost all the heavy lifting already exists as protected libs: `logAdminAction`, `requireAdmin/requireSuperadmin`, `CircuitBreaker`, `createBictorysProvider`, `encodeCursor/decodeCursor`, `createEmailLimiter`. The phase is fundamentally a **wiring exercise** — each route reads input, gates with the right HOF, queries Prisma with cursor pagination, emits an `AdminAction` row for mutations, and returns the response shape Phase 1 D-05 mandates.

Three real risks: (1) the **login-route edit** for `User.status === 'SUSPENDED'` is in CLAUDE.md's protected list and requires explicit confirmation before edit; (2) `/api/admin/rate-limits` must SCAN Upstash Redis with the existing `rl:<bucket>:` prefix scheme — Upstash supports `SCAN` with `MATCH`+`COUNT` since Redis-6 compat [VERIFIED: Upstash docs]; (3) the `Idempotency-Key` column added to `Order` (D-PAY-01) must be `@unique` and indexed but **nullable** (existing rows have no key) — a bare `UPDATE Order ADD COLUMN` works because table is empty in dev/CI.

**Primary recommendation:** Lay the phase out as **3 waves**: Wave 0 — Prisma migration + capability list + paginate helper extraction; Wave 1 — admin reads (users/orders/withdrawals/audit-log/me/outbox/email-queue/rate-limits) in parallel + orders POST + login/refresh status check; Wave 2 — admin mutations (role-change, status-change, withdrawal-cancel) + make-superadmin script. Mutations come last so they can reuse the read endpoints' verification fixtures.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carry-forward (CF-01..CF-11):**
- CF-01: `export const runtime = 'nodejs'` first; wrap handler in `withRequestContext(makeRequestContext(req.headers), …)`
- CF-02: `verifyCsrf(req)` before any auth/business logic on POST/PUT/PATCH/DELETE
- CF-03: `requireAuth` / `requireAdmin('ADMIN')` / `requireAdmin('SUPERADMIN')` / `requireSuperadmin` from `middleware/index.ts` — bail with `if (auth instanceof NextResponse) return auth`
- CF-04: Body validation via Zod; on failure `400 { error: 'VALIDATION_FAILED', issues: [...] }`
- CF-05: Success `NextResponse.json({...})`; failure `NextResponse.json({ error: '<STABLE_CODE>', message: '...' }, { status })`. Frontend switches on `error`, never on `message`
- CF-06: Notifications via `createNotification(prisma, input)` only — never `prisma.notification.create`
- CF-07: Cursor pagination format = `base64(JSON.stringify({ createdAt, id }))` — reuse `notifications/cursor.ts` as-is
- CF-08: Role precedence: `USER < ADMIN < SUPERADMIN`; `MEMBER < ADMIN < OWNER`
- CF-09: Demote-last-SUPERADMIN → 409
- CF-10: Payment amounts = integer in smallest currency unit; never decimals
- CF-11: Admin mutations MUST go through `logAdminAction`

**Orders & payment provider:**
- D-PAY-01: `POST /api/orders` requires `Idempotency-Key` header. Replay → original 200. Storage: `Order.idempotencyKey @unique String?` (Prisma migration required).
- D-PAY-02: CircuitBreaker thresholds hard-coded — failureThreshold=5, windowMs=30_000, openMs=60_000. On open: 503 `PAYMENT_PROVIDER_UNAVAILABLE`. No env toggles in v1.
- D-PAY-03: Auth required — no guest checkout in v1 despite `Order.userId` being nullable (nullability stays for forks).
- D-PAY-04: Body Zod schema — `amount` (int positive), `currency` (3-char, default `'XOF'`), `customerEmail/Phone/Name` optional (default to authed user profile), `metadata` optional record.

**Admin ACL:**
- D-ADMIN-01: `PATCH /api/admin/withdrawals/:id/cancel` is **SUPERADMIN-only** (financial-sensitive). ADMIN → 403.
- D-ADMIN-02: New `User.status` enum (`"ACTIVE" | "SUSPENDED"`, default `"ACTIVE"`). `PATCH /api/admin/users/:id/status` — ADMIN can SUSPEND; only SUPERADMIN can restore to ACTIVE. **Login + refresh routes MUST refuse `SUSPENDED` users with `403 ACCOUNT_SUSPENDED`** (this requires editing protected files — surface confirm-before-edit).
- D-ADMIN-03: Admin reads see PII (email/phone) — ADMIN role suffices; no extra `VIEW_PII` audit event.
- D-ADMIN-04: `GET /api/admin/me` returns `{ role, can: ['users:read', 'users:status', 'withdrawals:cancel', …] }` — capability list computed from role.
- D-ADMIN-05: All admin endpoints rate-limited to 100 req/min per admin userId via `rate-limit-store.ts`. 429 → `TOO_MANY_REQUESTS`.

**Pagination + search (D-LIST-01..05):**
- D-LIST-01: Cursor pagination — reuse `notifications/cursor.ts`. Response: `{ items: T[], nextCursor: string | null }`.
- D-LIST-02: `?q=` on `/api/admin/users` → case-insensitive `contains` on `email`+`name` (Prisma `mode: 'insensitive'`). Sanitize: max 200 chars.
- D-LIST-03: Per-resource filters listed verbatim in CONTEXT.md.
- D-LIST-04: `?limit=N` → `min(50, parseInt(limit) || 20)`. Default 20, max 50.
- D-LIST-05: Empty result → `200 { items: [], nextCursor: null }`. Never 404 on listings.

**Audit log (D-AUDIT-01..02):**
- Filters: `?actor`, `?action`, `?targetType`, `?since`, `?until`. Cursor paginated.
- `metadata` (Json) is **free per action** — no registry.

**Visibility (D-OBS-01..03):**
- D-OBS-01: `GET /api/admin/outbox` — full `OutboxEvent` rows. Cursor + filters `?status` (PENDING|PROCESSING|SENT|DEAD per schema), `?type=` (matches `kind` field — naming caveat below).
- D-OBS-02: `GET /api/admin/email-queue` — `EmailJob` rows with `body` truncated to 200 chars (return as `bodyPreview`). Cursor + `?status`.
- D-OBS-03: `GET /api/admin/rate-limits` — read-only summary across known buckets (login, signup, forgot, reset, verify, pin) with `{ bucket, totalKeys, top10: [{ key, hits, expiresAt }] }`. No reset capability in v1. No cursor (bounded summary).

**Bootstrap script (D-SCRIPT-01):**
- `frontend/scripts/make-superadmin.ts` runnable via `tsx`. CLI: `pnpm db:make-superadmin <email>`.
- Resolve user; if missing → exit 1 with `Error: user <email> not found. Sign up first.`
- Update role to `SUPERADMIN`; idempotent.
- Log `AdminAction { actorId: self, action: 'BOOTSTRAP_SUPERADMIN', metadata: { via: 'cli-script' } }`.
- Root `package.json` already has `db:make-superadmin` → `pnpm --filter frontend exec tsx scripts/make-superadmin.ts` [VERIFIED: package.json line 24-28 in root].

### Claude's Discretion

- Endpoint URL shapes within `/api/admin/*` (e.g., `/api/admin/users/[id]/role` vs `/role-change`) — pick conventional REST.
- File organization under `frontend/src/app/api/admin/` (subdirectories vs flat) — recommend grouping by resource.
- Test fixtures and helpers — reuse Phase 1/2 patterns.
- Whether to extract a small `paginate.ts` helper from `cursor.ts` to share across admin listings.

### Deferred Ideas (OUT OF SCOPE)

- Organizations routes (ORG-01..06) — deferred indefinitely; Prisma models + `requireOrgRole` middleware kept as opt-in plumbing.
- Reset capability for `/api/admin/rate-limits` — admin cannot clear lockout in v1 (defer `DELETE /api/admin/rate-limits/:bucket/:key` to v2).
- Per-action metadata schema enforcement (free-form in v1).
- CircuitBreaker env-toggles (hard-coded in v1).
- Richer `User.status` states beyond `ACTIVE | SUSPENDED`.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | Search users, view detail, change role (only SUPERADMIN; refuse last-SUPERADMIN demotion → 409) | Endpoint Inventory §1 + Pattern: Last-SUPERADMIN guard §Pitfalls; `requireSuperadmin` already shipped |
| ADMIN-02 | List/filter orders | Endpoint Inventory §2; Prisma `Order` model with `status`, `createdAt` indices already present |
| ADMIN-03 | List/filter withdrawals + manual cancel | Endpoint Inventory §3; D-ADMIN-01 cancel = SUPERADMIN |
| ADMIN-04 | List/filter audit log (paginated) | Endpoint Inventory §4; reuse `notifications/cursor.ts`; `AdminAction` indices `[action, createdAt]` and `[targetType, targetId]` already exist [VERIFIED: schema.prisma:77-79] |
| ADMIN-05 | `GET /api/admin/me` returns admin probe + capability list | Endpoint Inventory §5; D-ADMIN-04 |
| ADMIN-06 | Every admin mutation calls `logAdminAction` | `audit.ts` shipped — call inside same Prisma tx as mutation |
| ADMIN-07 | `pnpm db:make-superadmin <email>` script | Bootstrap Script §; `tsx` already in deps [VERIFIED: frontend/package.json line 67] |
| PAY-01 | Authenticated user creates Order via PaymentProvider with circuit breaker | Endpoint Inventory §6; `createBictorysProvider` + `CircuitBreaker` shipped |
| OBS-01 | List OutboxEvent rows | Endpoint Inventory §7 (note `OutboxEvent.kind` not `type`; route accepts `?type=` and maps to `kind`) |
| OBS-02 | List EmailJob rows | Endpoint Inventory §8 |
| OBS-03 | Show current rate-limit hit counters from Redis | Endpoint Inventory §9; SCAN over `rl:<bucket>:*` keys |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 | App Router Route Handlers | Framework — already wired [VERIFIED: package.json] |
| Prisma | 5.22.0 | ORM + migrations | Already wired; `findMany` cursor-pagination idiomatic [VERIFIED] |
| zod | 3.23.8 | Body + query Zod validation | Phase 1 D-04 standard; latest stable on npm is 4.4.3 but project uses 3 — DO NOT upgrade in this phase [VERIFIED: npm view zod version → 4.4.3, but frontend/package.json pins ^3.23.8] |
| @upstash/redis | 1.34.3 | SCAN over rate-limit key buckets | Already wired; latest 1.38.0 on npm but bumping is out of scope [VERIFIED: npm view @upstash/redis version → 1.38.0] |
| tsx | 4.19.2 | Run `make-superadmin.ts` CLI | Already in devDeps [VERIFIED] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @prisma/client | 5.22.0 | DB queries | Every endpoint |
| jose | 5.9.6 | (No new use this phase) | Existing token plumbing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Cursor pagination | Offset/limit | Offset is O(N) on deep pages; cursor is what Phase 2 already uses — consistency wins |
| Redis SCAN for `/api/admin/rate-limits` | KEYS command | KEYS blocks the server; SCAN is non-blocking and supported by Upstash [VERIFIED: docs] |
| New audit table for VIEW_PII | Skip per D-ADMIN-03 | User decision — reads of PII are not audited (admins are trusted; logAdminAction is for mutations only) |

**Installation:** No new packages required. The phase wires existing libs. The only schema delta is the migration in Wave 0.

**Version verification (2026-05-08):**
- `npm view @upstash/redis version` → 1.38.0 (frontend pinned 1.34.3; SCAN is supported in both)
- `npm view zod version` → 4.4.3 (frontend pinned 3.23.8 — keep on v3 for the phase)
- `npm view tsx version` → 4.21.0 (frontend pinned 4.19.2)
- `npm view next version` → 16.2.6 (frontend pinned 16.1.6)

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/app/api/
├── admin/
│   ├── me/route.ts                       # GET (D-ADMIN-04 capability probe)
│   ├── users/
│   │   ├── route.ts                      # GET list (search, filter)
│   │   └── [id]/
│   │       ├── route.ts                  # GET detail
│   │       ├── role/route.ts             # PATCH (SUPERADMIN only)
│   │       └── status/route.ts           # PATCH (ADMIN suspend / SUPERADMIN restore)
│   ├── orders/route.ts                   # GET list
│   ├── withdrawals/
│   │   ├── route.ts                      # GET list
│   │   └── [id]/cancel/route.ts          # POST (SUPERADMIN only, manual cancel)
│   ├── audit-log/route.ts                # GET list
│   ├── outbox/route.ts                   # GET list (OBS-01)
│   ├── email-queue/route.ts              # GET list (OBS-02)
│   └── rate-limits/route.ts              # GET summary (OBS-03)
└── orders/route.ts                       # POST create (PAY-01)

frontend/src/lib/server/
└── pagination/
    └── paginate.ts                       # NEW — extract list-helper that wraps cursor.ts
                                          # for use in 7 admin listings (DRY)

frontend/scripts/
└── make-superadmin.ts                    # NEW (ADMIN-07)
```

### Pattern 1: Admin-Read Listing Handler (the canonical shape — applies to 7 of the 11 endpoints)
**What:** Cursor-paginated list with optional filters, gated by `requireAdmin('ADMIN')`.
**When to use:** Every `GET /api/admin/<resource>` listing.
**Example:**
```typescript
// frontend/src/app/api/admin/users/route.ts
// Source: frontend/src/app/api/notifications/route.ts (Phase 2 cursor pattern)
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { encodeCursor, decodeCursor } from '@/lib/server/notifications/cursor';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const q = (url.searchParams.get('q') ?? '').slice(0, 200).trim();
    const status = url.searchParams.get('status'); // ACTIVE | SUSPENDED
    const role = url.searchParams.get('role');     // USER | ADMIN | SUPERADMIN
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.UserWhereInput = {
      ...(q ? { OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { name:  { contains: q, mode: 'insensitive' } },
      ]} : {}),
      ...(status ? { status } : {}),
      ...(role ? { role } : {}),
      ...(cursor ? { OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ]} : {}),
    };

    const rows = await prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, email: true, name: true, avatarUrl: true,
                role: true, status: true, emailVerifiedAt: true, createdAt: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;

    return NextResponse.json(
      { items: page, nextCursor },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

### Pattern 2: Admin-Mutation Handler (role/status/cancel)
**What:** CSRF + auth gate + Zod body + Prisma transaction wrapping mutation + `logAdminAction`.
**When to use:** Every `PATCH/POST` under `/api/admin/*` that mutates state.
**Example:**
```typescript
// frontend/src/app/api/admin/users/[id]/role/route.ts — ADMIN-01
// Source: composition of middleware/index.ts requireSuperadmin + admin/audit.ts logAdminAction
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({ role: z.enum(['USER', 'ADMIN', 'SUPERADMIN']) });

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400 },
      );
    }

    // Last-SUPERADMIN guard (CF-09): atomic — count + update inside same tx
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      // Demote-last-SUPERADMIN check
      if (target.role === 'SUPERADMIN' && parsed.data.role !== 'SUPERADMIN') {
        const remaining = await tx.user.count({ where: { role: 'SUPERADMIN' } });
        if (remaining <= 1) return { kind: 'LAST_SUPERADMIN' as const };
      }

      const updated = await tx.user.update({
        where: { id },
        data: { role: parsed.data.role },
        select: { id: true, role: true },
      });

      await logAdminAction(tx, {
        actorId: auth.admin.id,
        action: 'user.role_change',
        targetType: 'User',
        targetId: id,
        metadata: { from: target.role, to: parsed.data.role },
      });

      return { kind: 'OK' as const, user: updated };
    });

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
    }
    if (result.kind === 'LAST_SUPERADMIN') {
      return NextResponse.json(
        { error: 'LAST_SUPERADMIN', message: 'Refuse to demote the last SUPERADMIN.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ user: result.user }, { status: 200 });
  });
}
```

### Pattern 3: `POST /api/orders` (PAY-01) wrapped by CircuitBreaker
**What:** Auth + CSRF + Idempotency-Key replay + circuit-breaker-wrapped charge call.
**Example:**
```typescript
// frontend/src/app/api/orders/route.ts — PAY-01
// Source: payments/circuit-breaker.ts + payments/bictorys.ts.charge()
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { CircuitBreaker, CircuitOpenError } from '@/lib/server/payments/circuit-breaker';
import { createBictorysProvider } from '@/lib/server/payments/bictorys';

const Body = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('XOF'),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  customerName: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Module-level singletons — single-instance only (CLAUDE.md)
const breaker = new CircuitBreaker({
  name: 'bictorys.charge',
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 60_000,
});
const provider = createBictorysProvider({
  BICTORYS_API_URL: process.env.BICTORYS_API_URL!,
  BICTORYS_API_KEY: process.env.BICTORYS_API_KEY!,
  BICTORYS_WEBHOOK_SECRET: process.env.BICTORYS_WEBHOOK_SECRET!,
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfFail = verifyCsrf(req);
  if (csrfFail) return csrfFail;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const idemKey = req.headers.get('idempotency-key') ?? '';
  if (!idemKey) {
    return NextResponse.json(
      { error: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header required' },
      { status: 400 },
    );
  }

  // Replay: existing key → return prior order
  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: idemKey },
  });
  if (existing) {
    return NextResponse.json(
      { id: existing.id, paymentUrl: existing.paymentUrl, status: existing.status },
      { status: 200 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  }

  // Create PENDING Order first (so we have a stable externalRef)
  const order = await prisma.order.create({
    data: {
      userId: auth.user.sub,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      provider: 'bictorys',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      idempotencyKey: idemKey,
      customerEmail: parsed.data.customerEmail ?? auth.user.email,
      ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
    },
  });

  // Wrap provider call in circuit breaker
  try {
    const result = await breaker.execute(() => provider.charge({
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      customer: {
        email: parsed.data.customerEmail ?? auth.user.email,
        ...(parsed.data.customerPhone ? { phone: parsed.data.customerPhone } : {}),
        ...(parsed.data.customerName ? { name: parsed.data.customerName } : {}),
      },
      successUrl: `${process.env.PUBLIC_URL}/orders/${order.id}/success`,
      failureUrl: `${process.env.PUBLIC_URL}/orders/${order.id}/failed`,
      externalRef: order.id,
    }));

    await prisma.order.update({
      where: { id: order.id },
      data: { providerChargeId: result.providerChargeId, paymentUrl: result.paymentUrl },
    });

    return NextResponse.json(
      { id: order.id, paymentUrl: result.paymentUrl, status: 'PENDING' },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      // Mark order FAILED so retries with same Idempotency-Key replay correctly
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'FAILED' },
      });
      return NextResponse.json(
        {
          error: 'PAYMENT_PROVIDER_UNAVAILABLE',
          message: 'Payment provider temporarily unavailable. Try again shortly.',
        },
        {
          status: 503,
          headers: { 'Retry-After': String(Math.max(1, Math.ceil((err.retryAt.getTime() - Date.now()) / 1000))) },
        },
      );
    }
    // Real provider failure (HTTP error) — provider already counted by breaker
    await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } });
    return NextResponse.json({ error: 'PAYMENT_FAILED', message: (err as Error).message }, { status: 502 });
  }
}
```

### Pattern 4: `/api/admin/rate-limits` SCAN over Upstash
**What:** Iterate `rl:<bucket>:*` keys with `redis.scan(cursor, { match, count })`, group by bucket, return summary.
**Source:** [CITED: https://upstash.com/docs/redis/sdks/ts/commands/generic/scan]
```typescript
// frontend/src/app/api/admin/rate-limits/route.ts — OBS-03
// Bucket prefixes (verified from existing routes):
const BUCKETS = ['auth:login', 'auth:signup', 'auth:verify', 'auth:forgot', 'auth:reset', 'auth:pin'];

async function scanBucket(redis: Redis, bucket: string) {
  const prefix = `rl:${bucket}:`;
  let cursor = '0';
  const keys: string[] = [];
  do {
    const [next, batch] = await redis.scan(cursor, { match: `${prefix}*`, count: 200 });
    cursor = String(next);
    keys.push(...batch);
    if (keys.length > 1000) break; // safety cap
  } while (cursor !== '0');

  // Read top-10 by hits via mget (counter values stored at each key)
  const hits = keys.length > 0 ? await redis.mget<number[]>(...keys) : [];
  const ttls = await Promise.all(keys.map((k) => redis.ttl(k)));

  const ranked = keys
    .map((key, i) => ({ key, hits: Number(hits[i] ?? 0), ttl: ttls[i] ?? -1 }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 10)
    .map((r) => ({
      key: r.key.replace(prefix, ''), // strip prefix for the response
      hits: r.hits,
      expiresAt: r.ttl > 0 ? new Date(Date.now() + r.ttl * 1000).toISOString() : null,
    }));

  return { bucket, totalKeys: keys.length, top10: ranked };
}
```
[VERIFIED: Upstash @upstash/redis 1.34.3+ supports `scan(cursor, { match, count, type })` — return shape `[nextCursor: string, keys: string[]]`]

### Anti-Patterns to Avoid
- **DO NOT call `KEYS rl:*`** — blocks Redis. Use `SCAN` with COUNT.
- **DO NOT mutate `Order` outside a tx for the success-leg of POST /api/orders** — circuit breaker raise still leaves the row, idempotency replay works.
- **DO NOT call `prisma.adminAction.create` directly** — always go through `logAdminAction(tx, ...)` so future enrichment (ip, userAgent) is centralized.
- **DO NOT issue `429` from per-userId admin rate-limit using `bucketKey('e:'+email)`** — for admin endpoints, use `userId` directly (build a separate bucket prefix `rl:admin:<userId>` outside `createEmailLimiter`, or call the store directly).
- **DO NOT store the request body's idempotency-key in plaintext audit metadata** — fine for `Order.idempotencyKey` column but never log it back via `logAdminAction.metadata`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cursor pagination | Custom encoder | `notifications/cursor.ts` `encodeCursor`/`decodeCursor` | Already format-locked; tested |
| Admin role gate | `if (user.role === 'ADMIN')` | `requireAdmin('ADMIN')` from `middleware/index.ts` | Re-reads role from DB so in-flight role change takes effect immediately |
| Org role gate | Bespoke 404 logic | `requireOrgRole(min, paramName)` | Returns 404 not 403 to non-members; CLAUDE.md invariant |
| Audit-log writes | `prisma.adminAction.create` | `logAdminAction(tx, ...)` | CF-11 — centralizes shape; never miss `ip`/`userAgent` |
| Circuit breaker | Custom retry logic | `CircuitBreaker` class | State machine + half-open probe + single-flight already correct |
| Bictorys HTTP call | Re-implement charge POST | `createBictorysProvider(...).charge(...)` | WAF retry logic (3× exp backoff on 403 with body=='Forbidden') is in there |
| Per-email rate limit | Custom Redis counter | `createEmailLimiter` | Already wired; fail-closed via `AUTH_RATE_LIMIT_FAIL_CLOSED=1` |
| Cursor over `OrderEvent.kind` field | Custom JSON cursor | reuse `notifications/cursor.ts` | Same `(createdAt, id)` shape works |

**Key insight:** Phase 3 is **not** about writing new infrastructure — it's about composing 6 existing libs (audit, middleware, payments provider/breaker, cursor, rate-limit-store, prisma) into 11 thin route files. Resist the urge to abstract — each handler stays under ~120 LOC.

## Runtime State Inventory

> Phase 3 is greenfield route additions + a Prisma migration; not a rename/refactor. **Section omitted** per agent instructions (no rename/migration of existing string literals across services).

## Common Pitfalls

### Pitfall 1: Demote-last-SUPERADMIN race condition
**What goes wrong:** Two SUPERADMINs simultaneously demote each other; both `count > 1` checks pass, both updates succeed, zero SUPERADMINs remain.
**Why it happens:** Read-modify-write spans two separate Prisma queries without serialization.
**How to avoid:** Run count + update inside `prisma.$transaction(async tx => …)` (Pattern 2 above). For belt-and-braces, use isolation level `Serializable` if Prisma adapter supports it — but a simple tx is sufficient because the COUNT+UPDATE pair is logically atomic at the row level when only one SUPERADMIN can be the "current" admin user being demoted.
**Warning signs:** Test with two concurrent `PATCH /api/admin/users/<id>/role` calls in CI — at least one MUST 409.

### Pitfall 2: Login-route edit breaks Phase 1 invariants
**What goes wrong:** Adding the `User.status === 'SUSPENDED'` check to `frontend/src/app/api/auth/login/route.ts` is mandatory per D-ADMIN-02, but that file is in CLAUDE.md's "Files Claude SHOULD NOT modify" list.
**Why it happens:** Auth routes have battle-tested invariants (D-24 enumeration resistance ordering, lockout+bcrypt sequencing). A naive insertion can re-introduce timing-attack windows.
**How to avoid:** Insert the suspended check at **step 7.5** — AFTER `verifyPassword` returns `ok`, BEFORE `recordSuccess`. Place it between the existing emailVerifiedAt check (step 7) and cookie issuance (step 8) so a suspended user's failed-attempt counter is NOT cleared (their valid password is still credentials-valid; they're just blocked from sessions).
**Confirmation gate:** Per CLAUDE.md, surface to the user: *"I am about to modify login route because of D-ADMIN-02 — confirm?"* before opening the file.
**Same logic for `/api/auth/refresh/route.ts`** — re-check `User.status` on every refresh so already-issued tokens for suspended users 401 on next refresh.

### Pitfall 3: `Idempotency-Key` storage on already-failed orders
**What goes wrong:** Replay returns a `FAILED` Order with empty `paymentUrl`, frontend tries to redirect, user sees blank page.
**Why it happens:** D-PAY-01 specifies "replay returns original 200" — but if circuit-breaker tripped on the first call, the original was 503 not 200. We must replay the **outcome**, not the row.
**How to avoid:** When the first call trips the breaker, mark the Order `FAILED` (Pattern 3). On replay, if `existing.status === 'FAILED'`, return 503 with the same `PAYMENT_PROVIDER_UNAVAILABLE` shape. Only `PENDING` and `PAID` orders return 200/201 with `paymentUrl`.
**Warning signs:** Manual test — POST with same key while breaker is open; second POST should NOT receive a 200.

### Pitfall 4: `OutboxEvent` field naming mismatch
**What goes wrong:** D-OBS-01 lists filter `?type=` and response field `type` — but the actual Prisma model has `kind`, not `type` [VERIFIED: schema.prisma:235].
**Why it happens:** Schema was named for outbox dispatcher's switch on `event.kind`; CONTEXT.md uses generic English.
**How to avoid:** Either (a) name the query param `?kind=` and response field `kind` (consistent with schema), or (b) accept `?type=` as input but map to `kind` in the where clause and serialize as `type` in the response. Plan should pick **(a)** — saves three lines per call site, matches the dispatcher's vocabulary, and the admin UI can label it "Type" without renaming the wire field.
**Warning signs:** Frontend admin page references `event.type` and gets `undefined`.

### Pitfall 5: Per-userId admin rate limit reuses email-limiter incorrectly
**What goes wrong:** D-ADMIN-05 says rate-limit each admin endpoint to 100/min per userId. `createEmailLimiter` keys on `e:<email>` or falls back to `ip:<ip>` — neither is per-userId.
**Why it happens:** The existing limiter was built for unauthenticated routes (login/signup) where email is the abuse vector.
**How to avoid:** Either (a) build a tiny `rate-limit-by-userid.ts` helper that takes a `userId` directly and uses `RedisRateLimitStore` with prefix `rl:admin:userid:` (recommended — keeps `createEmailLimiter` semantically clean), or (b) invoke `createEmailLimiter` with the userId masquerading as an email by passing `userId` as the second arg (works but obscures intent).
**Warning signs:** Two admins on the same office IP burn each other's quota.

### Pitfall 6: SCAN cap on `/api/admin/rate-limits`
**What goes wrong:** A bucket has 50K keys (DDoS in progress); SCAN iterates forever; the admin endpoint times out.
**Why it happens:** Upstash SCAN COUNT is a hint, not a hard limit. Without an outer cap, the loop runs until cursor=='0'.
**How to avoid:** Hard-cap at 1000 keys per bucket (as in Pattern 4 above). Add `truncated: true` flag to the response when the cap is hit so the UI can warn "showing first 1000 of N+ keys".
**Warning signs:** `/api/admin/rate-limits` p99 latency > 5s under high lockout volume.

### Pitfall 7: `createBictorysProvider` env validation crashes route module load
**What goes wrong:** Module-level call to `createBictorysProvider({...})` inside `route.ts` throws at import time when `BICTORYS_API_KEY` is missing. The whole route module fails to load — every Order POST returns 500 with no useful error.
**Why it happens:** The factory throws synchronously when env keys are absent [VERIFIED: bictorys.ts:165-171].
**How to avoid:** Either (a) wrap the singleton in a getter that lazy-initializes and returns a 503 `PAYMENT_PROVIDER_UNCONFIGURED` when env is absent, or (b) at the top of `POST` check `if (!process.env.BICTORYS_API_KEY) return 503 PAYMENT_PROVIDER_UNCONFIGURED`. Pattern (a) is cleaner.
**Warning signs:** Local dev without `.env` filled — every test fails 500 not 503.

## Code Examples

### Example: `make-superadmin` script (ADMIN-07)
```typescript
// frontend/scripts/make-superadmin.ts — D-SCRIPT-01
// Source: package.json line 25 already wires `db:make-superadmin` → tsx invocation
import { prisma } from '../src/lib/server/prisma';
import { logAdminAction } from '../src/lib/server/admin/audit';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: pnpm db:make-superadmin <email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Error: user ${email} not found. Sign up first.`);
    process.exit(1);
  }

  if (user.role === 'SUPERADMIN') {
    console.log(`User ${email} is already SUPERADMIN — no-op.`);
    process.exit(0);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { role: 'SUPERADMIN' },
    });
    await logAdminAction(tx, {
      actorId: user.id, // self-promotion — synthetic actor per D-SCRIPT-01
      action: 'BOOTSTRAP_SUPERADMIN',
      targetType: 'User',
      targetId: user.id,
      metadata: { via: 'cli-script', previousRole: user.role },
    });
  });

  console.log(`✓ Promoted ${email} (id=${user.id}) to SUPERADMIN.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Example: `GET /api/admin/me` capability list (D-ADMIN-04)
```typescript
// frontend/src/app/api/admin/me/route.ts — ADMIN-05
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';

const CAPABILITIES_BY_ROLE: Record<'ADMIN' | 'SUPERADMIN', string[]> = {
  ADMIN: [
    'users:read', 'users:status:suspend',
    'orders:read', 'withdrawals:read',
    'audit-log:read', 'outbox:read', 'email-queue:read', 'rate-limits:read',
  ],
  SUPERADMIN: [
    'users:read', 'users:role',
    'users:status:suspend', 'users:status:restore',
    'orders:read',
    'withdrawals:read', 'withdrawals:cancel',
    'audit-log:read', 'outbox:read', 'email-queue:read', 'rate-limits:read',
  ],
};

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin('ADMIN');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    admin: { id: auth.admin.id, email: auth.admin.email, role: auth.admin.role },
    can: CAPABILITIES_BY_ROLE[auth.admin.role],
  });
}
```

### Example: Endpoint Inventory (definitive)

| # | Method | Path | Auth | Body / Query | Success | Error codes |
|---|--------|------|------|---------------|---------|-------------|
| 1a | GET | `/api/admin/users` | ADMIN | q (≤200), status, role, cursor, limit (1-50, def 20) | 200 `{ items: User[], nextCursor }` | TOO_MANY_REQUESTS(429), ADMIN_REQUIRED(403) |
| 1b | GET | `/api/admin/users/[id]` | ADMIN | — | 200 `{ user }` | USER_NOT_FOUND(404) |
| 1c | PATCH | `/api/admin/users/[id]/role` | SUPERADMIN | `{ role: USER\|ADMIN\|SUPERADMIN }` | 200 `{ user }` | LAST_SUPERADMIN(409), VALIDATION_FAILED(400) |
| 1d | PATCH | `/api/admin/users/[id]/status` | ADMIN (suspend) / SUPERADMIN (restore) | `{ status: ACTIVE\|SUSPENDED, reason? }` | 200 `{ user }` | RESTORE_REQUIRES_SUPERADMIN(403) |
| 2 | GET | `/api/admin/orders` | ADMIN | status, since, until, cursor, limit | 200 `{ items: Order[], nextCursor }` | — |
| 3a | GET | `/api/admin/withdrawals` | ADMIN | status, since, until, cursor, limit | 200 `{ items, nextCursor }` | — |
| 3b | POST | `/api/admin/withdrawals/[id]/cancel` | SUPERADMIN | `{ reason: string }` | 200 `{ withdrawal }` | WITHDRAWAL_NOT_FOUND(404), WITHDRAWAL_NOT_CANCELLABLE(409) |
| 4 | GET | `/api/admin/audit-log` | ADMIN | actor, action, targetType, since, until, cursor, limit | 200 `{ items: AdminAction[], nextCursor }` | — |
| 5 | GET | `/api/admin/me` | ADMIN | — | 200 `{ admin, can: string[] }` | — |
| 6 | POST | `/api/orders` | requireAuth | `Idempotency-Key` header + body (D-PAY-04) | 201 `{ id, paymentUrl, status }` (or 200 on replay) | IDEMPOTENCY_KEY_REQUIRED(400), PAYMENT_PROVIDER_UNAVAILABLE(503), PAYMENT_FAILED(502), VALIDATION_FAILED(400) |
| 7 | GET | `/api/admin/outbox` | ADMIN | status (PENDING\|PROCESSING\|SENT\|DEAD), kind, cursor, limit | 200 `{ items, nextCursor }` | — |
| 8 | GET | `/api/admin/email-queue` | ADMIN | status (PENDING\|SENT\|FAILED\|DEAD), cursor, limit | 200 `{ items: EmailJobSummary[], nextCursor }` (where `body` → `bodyPreview ≤200`) | — |
| 9 | GET | `/api/admin/rate-limits` | ADMIN | — | 200 `{ buckets: BucketSummary[] }` | — |

### Example: AdminAction metadata shapes (per mutation)

| Mutation | `action` | `targetType` | `metadata` |
|----------|----------|--------------|------------|
| Role change | `user.role_change` | `User` | `{ from: <oldRole>, to: <newRole> }` |
| Status SUSPEND | `user.suspend` | `User` | `{ from: 'ACTIVE', to: 'SUSPENDED', reason?: string }` |
| Status RESTORE | `user.restore` | `User` | `{ from: 'SUSPENDED', to: 'ACTIVE', reason?: string }` |
| Withdrawal cancel | `withdrawal.cancel` | `Withdrawal` | `{ withdrawalId, amount, currency, reason: string, previousStatus }` |
| Bootstrap SUPERADMIN | `BOOTSTRAP_SUPERADMIN` | `User` | `{ via: 'cli-script', previousRole }` |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express middleware chains | HOF gates (`requireAdmin`) returning `Context \| NextResponse` | M2 port (2026-05) | Simpler types; route files self-contained |
| Offset/limit pagination | `(createdAt, id)` cursor base64 | Phase 2 (D-07) | O(1) vs O(N) on deep pages |
| `prisma.adminAction.create` | `logAdminAction(prisma, ...)` | M2 port | Centralized shape (ip/userAgent enrichment) |
| Polling Redis with `KEYS` | `SCAN` with cursor | Standard Redis 6+ practice [VERIFIED: Upstash docs] | Non-blocking |

**Deprecated/outdated:** None — the phase is wiring fresh routes, not rewriting old ones.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Existing rate-limit buckets are `auth:login`, `auth:signup`, `auth:verify`, `auth:forgot`, `auth:reset`, `auth:pin` — verified by grep [VERIFIED] | Pattern 4 | None — verified |
| A2 | Lockout uses keys `auth:lockout:<email>` and `auth:lockout-count:<email>` (not under `rl:` prefix) | Pattern 4 | If wrong: `/api/admin/rate-limits` would miss lockout state — recommend showing both `rl:*` and `auth:lockout*` separately. **VERIFIED via lockout.ts:42** — confirmed `auth:lockout:` key prefix without `rl:` |
| A3 | `Order` table is empty in dev/CI when migration adds `idempotencyKey @unique` | Stack | Production migration for forks with existing data needs backfill — out of scope for v1 |
| A4 | Provider env (`BICTORYS_API_URL` etc.) lives in `.env.example` from Phase 0 | Pitfall 7 | If env names changed, route module load crashes — Plan should grep for `BICTORYS_*` vars before writing route |

**No `[ASSUMED]` claims remain** — all critical claims are verified against the codebase or Upstash documentation.

## Open Questions

1. **Should admin reads carry their own request-context wrapping?**
   - What we know: All Phase 1/2 routes use `withRequestContext`.
   - What's unclear: Pattern 1 above wraps every handler — confirm with planner that the per-route wrap (vs a shared HOF) is acceptable or extract a helper.
   - Recommendation: Keep per-route wrap; it's already idiomatic. Defer DRY refactor to a future cleanup pass.

2. **`PATCH /api/admin/users/[id]/role` self-demotion — should it be allowed?**
   - What we know: D-ADMIN-01 silent on this; CF-09 only forbids last-SUPERADMIN demotion.
   - What's unclear: A SUPERADMIN demoting themselves to ADMIN is technically allowed by current rules (provided another SUPERADMIN exists).
   - Recommendation: Allow it (matches CONTEXT.md); document in audit metadata via `actorId === targetId`.

3. **`/api/admin/rate-limits` — should it include the lockout keys (`auth:lockout:*`)?**
   - What we know: D-OBS-03 lists buckets `login, signup, forgot-password, reset-password, resend-verification, verify-email, pin`.
   - What's unclear: Lockout keys are not under `rl:` prefix; they're separate.
   - Recommendation: Include them as a 7th synthetic bucket called `lockout` (scan `auth:lockout:*`) — admin needs to see who's locked out. Plan can confirm with user.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (Neon) | All routes (Prisma) | Inherited from Phase 0 | — | — |
| Upstash Redis | `/api/admin/rate-limits` (OBS-03), `auth:lockout:*` reads | Optional — `redis` is `null` when env absent | — | When `redis === null`: return `{ buckets: [], note: 'redis not configured' }` |
| Bictorys API | `POST /api/orders` | Optional — `BICTORYS_API_KEY` may be absent in dev | — | Lazy-init the provider; return 503 `PAYMENT_PROVIDER_UNCONFIGURED` if env missing (Pitfall 7) |
| `tsx` | `make-superadmin.ts` script | ✓ | 4.19.2 | — [VERIFIED: frontend/package.json] |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Redis (graceful degrade for OBS-03), Bictorys (graceful 503 for PAY-01 in dev).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 [VERIFIED: frontend/package.json] |
| Config file | `frontend/vitest.config.ts` (already exists from Phase 0) |
| Quick run command | `pnpm --filter frontend exec vitest run src/app/api/admin/<resource>/route.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ADMIN-01 | `GET /api/admin/users?q=test` paginated; ADMIN can read | unit | `pnpm --filter frontend exec vitest run src/app/api/admin/users/route.test.ts` | ❌ Wave 0 |
| ADMIN-01 | `PATCH .../role` by SUPERADMIN → 200 + AdminAction row | unit | `pnpm --filter frontend exec vitest run -t "role change SUPERADMIN"` | ❌ Wave 1 |
| ADMIN-01 | `PATCH .../role` by ADMIN → 403 `ADMIN_REQUIRED` | unit | same suite, name `"role change requires SUPERADMIN"` | ❌ Wave 1 |
| ADMIN-01 / CF-09 | Demote last SUPERADMIN → 409 `LAST_SUPERADMIN` | unit | `vitest run -t "last SUPERADMIN"` | ❌ Wave 1 |
| ADMIN-02 | `GET /api/admin/orders` filterable | unit | `vitest run src/app/api/admin/orders/route.test.ts` | ❌ Wave 0 |
| ADMIN-03 | `GET /api/admin/withdrawals` + `POST .../cancel` (SUPERADMIN) | unit | `vitest run src/app/api/admin/withdrawals/...` | ❌ Wave 0 |
| ADMIN-04 | `GET /api/admin/audit-log` paginated, filterable | unit | `vitest run src/app/api/admin/audit-log/route.test.ts` | ❌ Wave 0 |
| ADMIN-05 | `GET /api/admin/me` returns role + capability list | unit | `vitest run src/app/api/admin/me/route.test.ts` | ❌ Wave 0 |
| ADMIN-06 | Every mutation writes AdminAction (covered transitively in 01/03 cancel tests) | unit assertion | `vitest run -t "logAdminAction"` | ❌ Wave 1 |
| ADMIN-07 | `pnpm db:make-superadmin <email>` exit 0 on existing user | unit | `vitest run scripts/make-superadmin.test.ts` | ❌ Wave 2 |
| ADMIN-07 | Same script exit non-zero with clear message on missing email | unit | same suite, name `"missing user exits 1"` | ❌ Wave 2 |
| PAY-01 | `POST /api/orders` valid → 201 + paymentUrl | unit | `vitest run src/app/api/orders/route.test.ts` | ❌ Wave 0 |
| PAY-01 | Replay with same Idempotency-Key → 200 with original | unit | same suite, name `"replays returns prior order"` | ❌ Wave 1 |
| PAY-01 | Circuit open → 503 PAYMENT_PROVIDER_UNAVAILABLE | unit | same suite, name `"circuit open returns 503"` | ❌ Wave 1 |
| OBS-01 | `GET /api/admin/outbox` paginated, status filter | unit | `vitest run src/app/api/admin/outbox/route.test.ts` | ❌ Wave 0 |
| OBS-02 | `GET /api/admin/email-queue` returns `bodyPreview` ≤200 chars | unit | `vitest run src/app/api/admin/email-queue/route.test.ts` | ❌ Wave 0 |
| OBS-03 | `GET /api/admin/rate-limits` returns bucket summary from Redis (mocked) | unit | `vitest run src/app/api/admin/rate-limits/route.test.ts` | ❌ Wave 0 |
| (D-ADMIN-02) | Login refuses SUSPENDED user → 403 ACCOUNT_SUSPENDED | unit | `vitest run src/app/api/auth/login/route.test.ts -t "SUSPENDED"` | ⚠️ ADD test to existing |
| (runtime invariant) | Every new admin route exports `runtime='nodejs'` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ✅ Already exists |

### Sampling Rate
- **Per task commit:** `pnpm --filter frontend exec vitest run <file under change>`
- **Per wave merge:** `pnpm test` (full Vitest suite — must include the runtime-enforcement file)
- **Phase gate:** Full suite green + `pnpm typecheck && pnpm lint` before `/gsd-verify-work`

### Wave 0 Gaps

Test scaffolding to create in Wave 0:
- [ ] `frontend/src/app/api/admin/users/route.test.ts` — covers ADMIN-01 read paths + role/status/last-superadmin/suspended-restore paths
- [ ] `frontend/src/app/api/admin/orders/route.test.ts` — covers ADMIN-02 filters
- [ ] `frontend/src/app/api/admin/withdrawals/route.test.ts` — covers ADMIN-03 list + cancel
- [ ] `frontend/src/app/api/admin/audit-log/route.test.ts` — covers ADMIN-04
- [ ] `frontend/src/app/api/admin/me/route.test.ts` — covers ADMIN-05
- [ ] `frontend/src/app/api/admin/outbox/route.test.ts` — covers OBS-01
- [ ] `frontend/src/app/api/admin/email-queue/route.test.ts` — covers OBS-02
- [ ] `frontend/src/app/api/admin/rate-limits/route.test.ts` — covers OBS-03 (Upstash redis mocked)
- [ ] `frontend/src/app/api/orders/route.test.ts` — covers PAY-01 (CircuitBreaker + idempotency)
- [ ] `frontend/scripts/make-superadmin.test.ts` — covers ADMIN-07
- [ ] `frontend/src/test-utils/admin-fixtures.ts` — shared factories for `seedAdmin()`, `seedSuperadmin()`, `seedDemotableSuperadmin()` (creates 2 SUPERADMIN rows so one can be demoted)

Framework install: none (Vitest already configured from Phase 0).

### Required Test Fixtures

| Fixture | Builder | Purpose |
|---------|---------|---------|
| Plain ADMIN | `seedAdmin()` | Read-path access tests |
| Single SUPERADMIN | `seedSuperadmin()` | Last-SUPERADMIN demotion → 409 |
| Two SUPERADMINs | `seedDemotableSuperadmin()` | One can be safely demoted to ADMIN → 200 |
| ACTIVE + SUSPENDED user pair | `seedSuspendedUser()` | Login route 403 ACCOUNT_SUSPENDED test |
| Sample Order PENDING | `seedOrder({ status: 'PENDING' })` | Idempotency replay test |
| OutboxEvent rows | `seedOutbox({ kind, status })` | OBS-01 paging test |
| EmailJob rows | `seedEmailJob({ status, body: longString })` | OBS-02 truncation test |
| Mock Upstash Redis | `mockRedis()` | OBS-03 SCAN test |
| Mock Bictorys provider | `mockBictorysProvider({ openCircuit?: boolean })` | PAY-01 503 test |

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireAuth` (cookie+JWT, tokenVersion check) — already shipped Phase 1 |
| V3 Session Management | yes | Cookie scoping (refresh on `/api/auth` only), CSRF double-submit — Phase 1 |
| V4 Access Control | **yes — primary risk** | `requireAdmin('ADMIN')` / `requireSuperadmin`; role precedence enforced in `roleRank`; **last-SUPERADMIN guard**; admin endpoints rate-limited per userId (D-ADMIN-05) |
| V5 Input Validation | yes | Zod at route top; `?q` clamped to 200 chars; cursor decoder returns `null` on tamper |
| V6 Cryptography | yes | bcrypt for `passwordHash` (Phase 1); HMAC for webhook (Phase 5); **NO new crypto in this phase** |
| V8 Data Protection | yes | `EmailJob.body` truncated to `bodyPreview ≤200` for `/api/admin/email-queue` (PII protection); `AdminAction.metadata` is free-form but MUST NOT include passwords/tokens (route author's responsibility — flag in code review) |
| V12 Files & Resources | n/a | No file uploads in this phase (Phase 4) |

### Known Threat Patterns for Next.js Admin Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Privilege escalation via direct PATCH (skipping role check) | Elevation | `requireSuperadmin` on every role-change route; deny by default |
| Last-SUPERADMIN lockout (admin demotes themselves) | Denial of Service | 409 LAST_SUPERADMIN guard inside same Prisma transaction as the update |
| Audit-log tampering (admin deletes own AdminAction row) | Repudiation | No `DELETE /api/admin/audit-log/:id` endpoint shipped — append-only by absence; future schema-level `INSERT-only` grant if compliance demands |
| Idempotency-Key collision attack (attacker steals key, replays) | Tampering | `Idempotency-Key` is per-user (Order.userId scoped); cookie auth required so attacker also needs a session |
| Suspended user continues using already-issued JWT | Spoofing | Refresh route checks `User.status` on every refresh — token expires within 15 min and refresh is the choke-point |
| SQL injection via `?q` search | Tampering | Prisma parametric queries; `?q` is `String.contains`, never raw SQL |
| Mass-assignment on PATCH role / status | Tampering | Zod `enum` validates whitelist of valid values; only `role` field accepted |
| Information disclosure via SUSPENDED restore by ADMIN | Information Disclosure | Restoration requires SUPERADMIN — ADMIN cannot un-suspend a user they punished |
| CSRF on admin mutations | Tampering | `verifyCsrf(req)` BEFORE auth on every mutation (CF-02) |
| Rate-limit summary leaks PII | Information Disclosure | Top-10 keys are returned as bucket-relative (e.g., `e:foo@bar.com` minus the `rl:auth:login:` prefix) — admin sees emails. **This is by design** (D-ADMIN-03 — admins see PII). |
| Circuit-breaker thundering herd on probe | Denial of Service | `probeInFlight` single-flight in `CircuitBreaker` already handles this [VERIFIED: circuit-breaker.ts:82] |

## Project Constraints (from CLAUDE.md)

Directives extracted from `./CLAUDE.md` that this phase MUST honor:

- **Every Route Handler MUST `export const runtime = 'nodejs'`** — runtime-enforcement.test.ts fails CI otherwise
- **All admin mutations MUST go through `logAdminAction(prisma, {...})`** — bypass = compliance regression
- **Admin role precedence: `USER < ADMIN < SUPERADMIN`** — only SUPERADMIN can change roles. Refuse last-SUPERADMIN demotion → 409
- **Org role precedence: `MEMBER < ADMIN < OWNER`** — non-members → 404 (do NOT leak existence). Org routes deferred but `requireOrgRole` middleware must remain wired
- **Payment amounts = integer in smallest currency unit** — never decimals (Order.amount is Int)
- **`BICTORYS_API_KEY` (charges) ≠ `BICTORYS_PRIVATE_KEY` (payouts)** — distinct keys, never confused
- **CircuitBreaker is single-instance / in-memory by design** — DO NOT propose Redis-backed in this phase (deferred to v2)
- **`frontend/src/app/` ships only logic, no UI components** — reference admin pages live in `examples/frontend-pages/admin/*.tsx`; do NOT copy them into `frontend/src/app/`
- **Mutating routes pattern:** `verifyCsrf(req)` then `requireAuth/requireAdmin/requireSuperadmin`; bail with `if (X instanceof NextResponse) return X`
- **Cookies stay `httpOnly` + `Secure` (prod) + `SameSite=Lax`** — no changes this phase
- **Frontend `api()` retries only `GET`/`HEAD` on network errors** — POST /api/orders MUST NOT auto-retry
- **PROTECTED files (modify only with confirmation):**
  - `frontend/src/app/api/auth/login/route.ts` — D-ADMIN-02 requires the SUSPENDED check; surface confirm-before-edit
  - `frontend/src/app/api/auth/refresh/route.ts` — same
  - `frontend/src/lib/server/admin/audit.ts` — call only, do not modify
  - `frontend/src/lib/server/middleware/index.ts`, `middleware/require-admin.ts`, `middleware/require-org-role.ts` — call only
  - `frontend/src/lib/server/payments/circuit-breaker.ts` — instantiate only, do not modify

## Sources

### Primary (HIGH confidence)
- `frontend/src/lib/server/middleware/index.ts` — `requireAuth/requireAdmin/requireSuperadmin/requireOrgRole/optionalAuth` exact signatures and 401/403/404 shapes
- `frontend/src/lib/server/admin/audit.ts` — `logAdminAction(prisma, input)` shape: `{ actorId, action, targetType?, targetId?, metadata?, ip?, userAgent? }`
- `frontend/src/lib/server/payments/provider.ts` — `PaymentProvider.charge(input): Promise<ChargeResult>` and the `ChargeInput` shape (amount/currency/customer/successUrl/failureUrl/externalRef)
- `frontend/src/lib/server/payments/bictorys.ts` — `createBictorysProvider(env)` factory + WAF retry logic + env validation throws
- `frontend/src/lib/server/payments/circuit-breaker.ts` — `CircuitBreaker.execute(fn)` + `CircuitOpenError.retryAt`
- `frontend/src/lib/server/notifications/cursor.ts` — `encodeCursor`/`decodeCursor` reusable as-is
- `frontend/src/lib/server/middleware/rate-limit-by-email.ts` — `createEmailLimiter(deps, config)` shape; bucket prefix `rl:<bucket>:`
- `frontend/src/lib/server/auth/lockout.ts` — `auth:lockout:*` and `auth:lockout-count:*` Redis key patterns
- `frontend/src/app/api/notifications/route.ts` — canonical Phase 2 cursor-paged GET pattern
- `frontend/src/app/api/auth/login/route.ts` — exact ordering for D-ADMIN-02 SUSPENDED check insertion
- `frontend/prisma/schema.prisma` — `Order.amount Int`, `OutboxEvent.kind` (not `type`), `EmailJob.body String`, `AdminAction` indices
- `CLAUDE.md` — protected files list, role precedence, integer-amount invariant
- `STATUS.md` — confirms admin libs already shipped, only routes are missing
- `package.json` (root) — `db:make-superadmin` script wired

### Secondary (MEDIUM confidence)
- [SCAN - Upstash Documentation](https://upstash.com/docs/redis/sdks/ts/commands/generic/scan) — confirms `redis.scan(cursor, { match, count, type })` shape and behavior
- [@upstash/redis - npm](https://www.npmjs.com/package/@upstash/redis) — version 1.38.0 latest (project uses 1.34.3)
- npm view checks (2026-05-08): zod=4.4.3, tsx=4.21.0, next=16.2.6 — all stable

### Tertiary (LOW confidence)
- None — every claim is grounded in either the codebase or Upstash official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency verified in `frontend/package.json` and the `lib/server` source
- Architecture: HIGH — Pattern 1/2/3 mirror Phase 1/2 idioms verified in `app/api/notifications/route.ts` and `app/api/auth/login/route.ts`
- Pitfalls: HIGH — every pitfall references a specific file/line in the codebase or a documented invariant
- Validation Architecture: HIGH — Vitest already in place from Phase 0, mock patterns reused from Phase 1/2 tests

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30 days — stack is stable; only the @upstash/redis SCAN signature could shift in a major bump)
