---
phase: 03-admin-organizations-orders
plan: 04
type: execute
wave: 1
depends_on: [01]
files_modified:
  - frontend/src/app/api/admin/outbox/route.ts
  - frontend/src/app/api/admin/email-queue/route.ts
  - frontend/src/app/api/admin/rate-limits/route.ts
autonomous: true
requirements: [OBS-01, OBS-02, OBS-03]
must_haves:
  truths:
    - GET /api/admin/outbox returns paginated OutboxEvent rows filterable by ?status (PENDING|SENT|FAILED|DEAD) and ?kind
    - GET /api/admin/email-queue returns EmailJob rows with `body` truncated to ≤200 chars as `bodyPreview` (PII protection)
    - GET /api/admin/rate-limits returns bucket summary across known prefixes (auth:login, auth:signup, auth:verify, auth:forgot, auth:reset, auth:pin, lockout)
    - rate-limits SCAN hard-caps at 1000 keys per bucket and emits `truncated: true` when capped
    - rate-limits gracefully degrades to `{ buckets: [], note: 'redis not configured' }` when redis === null
    - All three routes export `runtime = 'nodejs'`, wrap in withRequestContext, apply enforceAdminRateLimit
  artifacts:
    - path: frontend/src/app/api/admin/outbox/route.ts
      provides: OBS-01 — outbox visibility
      exports: ['runtime', 'GET']
    - path: frontend/src/app/api/admin/email-queue/route.ts
      provides: OBS-02 — email-queue visibility with PII truncation
      exports: ['runtime', 'GET']
    - path: frontend/src/app/api/admin/rate-limits/route.ts
      provides: OBS-03 — rate-limit summary from Upstash
      exports: ['runtime', 'GET']
  key_links:
    - from: frontend/src/app/api/admin/outbox/route.ts
      to: frontend/prisma/schema.prisma
      via: prisma.outboxEvent.findMany filtered by `kind` field (NOT `type` — Pitfall 4)
      pattern: 'outboxEvent.findMany'
    - from: frontend/src/app/api/admin/email-queue/route.ts
      to: bodyPreview truncation
      via: 'body.slice(0, 200)' transformation in select
      pattern: 'bodyPreview'
    - from: frontend/src/app/api/admin/rate-limits/route.ts
      to: '@/lib/server/redis'
      via: redis.scan(cursor, { match, count }) loop with 1000-key cap
      pattern: 'redis\\.scan'
---

<objective>
Wave 1 — implement the three "visibility" admin endpoints (OBS-01..03). These give admins read-only insight into the outbox queue, email queue, and current Redis rate-limit hit counters during incident response. Read-only by design; no reset capability in v1.

Purpose: Land the back-office observability surface that ROADMAP success criterion 2 requires (`GET /api/admin/outbox` and `GET /api/admin/email-queue` return filterable lists; `GET /api/admin/rate-limits` returns current hit counters from Redis).

Output: 3 route files implementing the visibility surface.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-admin-organizations-orders/03-CONTEXT.md
@.planning/phases/03-admin-organizations-orders/03-RESEARCH.md
@frontend/src/app/api/admin/users/route.ts
@frontend/src/lib/server/redis.ts
@frontend/src/lib/server/auth/lockout.ts
@frontend/src/lib/server/middleware/rate-limit-by-email.ts
@frontend/src/lib/server/pagination/paginate.ts
@frontend/src/lib/server/middleware/rate-limit-by-userid.ts
@frontend/prisma/schema.prisma

<interfaces>
From frontend/prisma/schema.prisma:
```prisma
model OutboxEvent {
  id          String    @id @default(cuid())
  kind        String   // ← NOT `type`. Pitfall 4.
  payload     Json
  status      String    @default("PENDING") // PENDING | SENT | FAILED | DEAD
  attempts    Int       @default(0)
  lastError   String?
  scheduledAt DateTime
  sentAt      DateTime?
  createdAt   DateTime  @default(now())
}

model EmailJob {
  id          String    @id @default(cuid())
  to          String
  subject     String
  html        String   // ← truncate to bodyPreview ≤200 chars in admin response
  text        String?
  status      String    @default("PENDING") // PENDING | SENT | FAILED | DEAD
  attempts    Int       @default(0)
  lastError   String?
  scheduledAt DateTime
  sentAt      DateTime?
  createdAt   DateTime  @default(now())
}
```

From frontend/src/lib/server/redis.ts:
```typescript
// Returns null when UPSTASH_REDIS_REST_URL/_TOKEN are absent. Callers must handle null.
export const redis: Redis | null;
```

From @upstash/redis 1.34.3:
```typescript
redis.scan(cursor: string | number, opts: { match?: string; count?: number; type?: string }): Promise<[nextCursor: string, keys: string[]]>;
redis.mget<T>(...keys: string[]): Promise<T[]>;
redis.ttl(key: string): Promise<number>;
```

Verified key prefixes (RESEARCH.md A1 + A2):
- `rl:auth:login:`, `rl:auth:signup:`, `rl:auth:verify:`, `rl:auth:forgot:`, `rl:auth:reset:`, `rl:auth:pin:`
- `auth:lockout:`, `auth:lockout-count:` (NOT under `rl:` prefix — synthetic 7th bucket per Open Question 3)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: GET /api/admin/outbox (OBS-01)</name>
  <files>frontend/src/app/api/admin/outbox/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/outbox/route.test.ts (Wave 0 RED scaffolding — note: must filter by `kind`, not `type` — Pitfall 4)
    - frontend/src/app/api/admin/users/route.ts (Plan 03-02 reference — wrapper pattern)
    - frontend/prisma/schema.prisma — OutboxEvent model (lines 233-245)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Pitfall 4: OutboxEvent field naming mismatch" + "Endpoint Inventory" §7
  </read_first>
  <behavior>
    - GET `/api/admin/outbox` accepts `?status=PENDING|SENT|FAILED|DEAD`, `?kind=<string>`, `?cursor`, `?limit=1..50`. Returns `200 { items: OutboxEvent[], nextCursor }`. ADMIN role suffices.
    - Filter `?kind` is exact match (e.g., `?kind=notification.payment_received`). Per Pitfall 4 we standardize on `kind` everywhere — query param + response field both named `kind`.
    - Field select: full row — `id, kind, payload, status, attempts, lastError, scheduledAt, sentAt, createdAt`. The `payload` JSON may be large but admins triaging "why didn't this side-effect run" need it.
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/outbox/route.ts` mirroring Plan 03-02 Task 2's wrapper exactly, except:
    - Replace `prisma.order.findMany` with `prisma.outboxEvent.findMany`
    - Replace the `?status` filter (status enum) and add `?kind` filter
    - Use the same `parseDate` helper inline if `?since`/`?until` were specified — but they are NOT in the §7 inventory; only `?status` and `?kind`. Skip date filters in this route.
    - Field select per `<behavior>` (full row).
    - Use `cursorWhere` + `buildPage` from the Wave 0 helper.

    Concrete `where`:
    ```typescript
    const where: Prisma.OutboxEventWhereInput = {
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
      ...cursorWhere(cursor),
    };
    ```

    Make the Wave 0 RED tests GREEN — assertions:
    - ADMIN seeds 5 OutboxEvent rows (mix of PENDING / SENT / FAILED / DEAD), GET returns all 5 sorted createdAt DESC
    - `?status=PENDING` returns only PENDING rows
    - `?kind=email.payment_confirmation` returns only that kind
    - `?limit=2` + `?cursor=...` paginates
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/outbox/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/outbox/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/outbox/route.ts` returns 1
    - `grep -c "requireAdmin\('ADMIN'\)" frontend/src/app/api/admin/outbox/route.ts` returns 1
    - `grep -c "enforceAdminRateLimit" frontend/src/app/api/admin/outbox/route.ts` returns 1
    - `grep -c "outboxEvent.findMany" frontend/src/app/api/admin/outbox/route.ts` returns 1
    - `grep -c "kind" frontend/src/app/api/admin/outbox/route.ts` returns ≥2 (filter + select)
    - `grep -c "type" frontend/src/app/api/admin/outbox/route.ts` returns 0 (Pitfall 4 — must NOT use `type` as field name)
    - `pnpm --filter frontend exec vitest run src/app/api/admin/outbox/route.test.ts` exits 0
  </acceptance_criteria>
  <done>Outbox visibility endpoint implemented; tests green; `kind` is the only field name used (no `type` aliasing).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GET /api/admin/email-queue (OBS-02 with bodyPreview truncation)</name>
  <files>frontend/src/app/api/admin/email-queue/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/email-queue/route.test.ts (Wave 0 RED scaffolding — assert ≤200 char preview)
    - frontend/src/app/api/admin/outbox/route.ts (Task 1 reference — wrapper pattern)
    - frontend/prisma/schema.prisma — EmailJob model (lines 180-194)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Endpoint Inventory" §8 + D-OBS-02
  </read_first>
  <behavior>
    - GET `/api/admin/email-queue` accepts `?status=PENDING|SENT|FAILED|DEAD`, `?cursor`, `?limit=1..50`. Returns `200 { items: EmailJobSummary[], nextCursor }`. ADMIN role suffices.
    - **PII protection (D-OBS-02):** select only `id, to, subject, status, attempts, lastError, scheduledAt, sentAt, createdAt`. Do NOT select `html` or `text` from Prisma. Instead, fetch `html` separately, then truncate it post-query as `bodyPreview = (html ?? '').slice(0, 200)`. Each item shape: `{ id, to, subject, bodyPreview, status, attempts, lastError, scheduledAt, sentAt, createdAt }`.
    - Empty result → `200 { items: [], nextCursor: null }`.
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/email-queue/route.ts`. Concrete query + transformation:
    ```typescript
    const rows = await prisma.emailJob.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, to: true, subject: true, html: true,
        status: true, attempts: true, lastError: true,
        scheduledAt: true, sentAt: true, createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map(({ html, ...rest }) => ({
      ...rest,
      bodyPreview: (html ?? '').slice(0, 200),
    }));
    const last = sliced[sliced.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;

    return NextResponse.json({ items, nextCursor }, { headers: { 'x-request-id': ctx.requestId } });
    ```
    Import `encodeCursor` from `@/lib/server/pagination/paginate`.

    Make the Wave 0 RED test GREEN — seed an EmailJob with `html` of 1000 chars; assert response item has `bodyPreview` of exactly 200 chars and no `html` or `text` field at all.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/email-queue/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/email-queue/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/email-queue/route.ts` returns 1
    - `grep -c "bodyPreview" frontend/src/app/api/admin/email-queue/route.ts` returns ≥2 (transformation + spread)
    - `grep -c "slice(0, 200)" frontend/src/app/api/admin/email-queue/route.ts` returns 1
    - `grep -c "emailJob.findMany" frontend/src/app/api/admin/email-queue/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/admin/email-queue/route.test.ts` exits 0
  </acceptance_criteria>
  <done>Email-queue visibility endpoint implemented with PII truncation; tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: GET /api/admin/rate-limits (OBS-03 SCAN over Upstash)</name>
  <files>frontend/src/app/api/admin/rate-limits/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/rate-limits/route.test.ts (Wave 0 RED scaffolding — uses mockRedis fixture)
    - frontend/src/lib/server/redis.ts (the `redis: Redis | null` export contract)
    - frontend/src/lib/server/auth/lockout.ts (lines 6-7, 42, 74-75 — confirms `auth:lockout:*` and `auth:lockout-count:*` prefixes)
    - frontend/src/lib/server/middleware/rate-limit-by-email.ts (line 71 — `bucketKey` builds keys under `rl:<bucket>:` prefix)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Pattern 4" (lines 458-494) + "Pitfall 6: SCAN cap" + Open Question 3 (recommended: include lockout as 7th bucket)
  </read_first>
  <behavior>
    - GET `/api/admin/rate-limits` returns `200 { buckets: BucketSummary[] }` where each `BucketSummary = { bucket: string, totalKeys: number, top10: Array<{ key, hits, expiresAt: string | null }>, truncated?: boolean }`.
    - 7 buckets: `auth:login`, `auth:signup`, `auth:verify`, `auth:forgot`, `auth:reset`, `auth:pin`, `lockout`. The first 6 SCAN with prefix `rl:<bucket>:`. The `lockout` bucket SCANs with prefix `auth:lockout:` (NOT `auth:lockout-count:` — those are accompanying counters that decay together; admin sees the lock flag itself).
    - Hard-cap: 1000 keys per bucket. When the cap is hit, set `truncated: true` and stop SCANning that bucket.
    - When `redis === null` (Upstash env absent): return `200 { buckets: [], note: 'redis not configured' }`. Do NOT throw.
    - ADMIN role suffices. Apply `enforceAdminRateLimit`.
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/rate-limits/route.ts` based on RESEARCH.md Pattern 4 (lines 458-494), extended with the 7th lockout bucket and the redis-null branch:

    ```typescript
    export const runtime = 'nodejs';

    import 'server-only';
    import { NextResponse, type NextRequest } from 'next/server';
    import { requireAdmin } from '@/lib/server/middleware';
    import { redis } from '@/lib/server/redis';
    import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
    import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

    type Bucket = { bucket: string; prefix: string };

    const BUCKETS: Bucket[] = [
      { bucket: 'auth:login',   prefix: 'rl:auth:login:' },
      { bucket: 'auth:signup',  prefix: 'rl:auth:signup:' },
      { bucket: 'auth:verify',  prefix: 'rl:auth:verify:' },
      { bucket: 'auth:forgot',  prefix: 'rl:auth:forgot:' },
      { bucket: 'auth:reset',   prefix: 'rl:auth:reset:' },
      { bucket: 'auth:pin',     prefix: 'rl:auth:pin:' },
      { bucket: 'lockout',      prefix: 'auth:lockout:' }, // Open Question 3 recommendation
    ];

    const HARD_CAP = 1000;

    type Top10 = Array<{ key: string; hits: number; expiresAt: string | null }>;

    async function scanBucket(redisClient: NonNullable<typeof redis>, b: Bucket): Promise<{
      bucket: string; totalKeys: number; top10: Top10; truncated?: boolean;
    }> {
      let cursor: string = '0';
      const keys: string[] = [];
      let truncated = false;
      do {
        const res = await redisClient.scan(cursor, { match: `${b.prefix}*`, count: 200 });
        cursor = String(res[0]);
        keys.push(...res[1]);
        if (keys.length >= HARD_CAP) {
          truncated = true;
          break;
        }
      } while (cursor !== '0');

      const trimmed = keys.slice(0, HARD_CAP);
      const hits = trimmed.length > 0
        ? await redisClient.mget<(number | string | null)[]>(...trimmed)
        : [];
      const ttls = await Promise.all(trimmed.map((k) => redisClient.ttl(k)));

      const top10: Top10 = trimmed
        .map((key, i) => ({
          key,
          hits: Number(hits[i] ?? 0),
          ttl: ttls[i] ?? -1,
        }))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 10)
        .map((r) => ({
          key: r.key.replace(b.prefix, ''),
          hits: r.hits,
          expiresAt: r.ttl > 0 ? new Date(Date.now() + r.ttl * 1000).toISOString() : null,
        }));

      return {
        bucket: b.bucket,
        totalKeys: trimmed.length,
        top10,
        ...(truncated ? { truncated: true } : {}),
      };
    }

    export async function GET(req: NextRequest): Promise<NextResponse> {
      const ctx = makeRequestContext(req.headers);
      return withRequestContext(ctx, async () => {
        const auth = await requireAdmin('ADMIN');
        if (auth instanceof NextResponse) return auth;
        const limited = await enforceAdminRateLimit(auth.admin.id);
        if (limited) return limited;

        if (!redis) {
          return NextResponse.json(
            { buckets: [], note: 'redis not configured' },
            { headers: { 'x-request-id': ctx.requestId } },
          );
        }

        const buckets = await Promise.all(BUCKETS.map((b) => scanBucket(redis, b)));
        return NextResponse.json({ buckets }, { headers: { 'x-request-id': ctx.requestId } });
      });
    }
    ```

    Make the Wave 0 RED tests GREEN using `mockRedis()` fixture from Wave 0:
    - Mock returns `scan` with 1500 matching keys → assert `truncated: true` and `totalKeys: 1000`
    - Mock returns 5 keys with hits `[10, 50, 3, 100, 25]` → assert top10 sorted DESC, hits 100 first
    - Mock returns 0 keys for some buckets → those buckets have `totalKeys: 0, top10: []`
    - When `vi.mock('@/lib/server/redis', () => ({ redis: null }))` → response is `{ buckets: [], note: 'redis not configured' }`
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/rate-limits/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/rate-limits/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/rate-limits/route.ts` returns 1
    - `grep -c "redisClient.scan" frontend/src/app/api/admin/rate-limits/route.ts` returns 1
    - `grep -c "HARD_CAP = 1000" frontend/src/app/api/admin/rate-limits/route.ts` returns 1
    - `grep -c "auth:lockout:" frontend/src/app/api/admin/rate-limits/route.ts` returns 1
    - `grep -c "redis not configured" frontend/src/app/api/admin/rate-limits/route.ts` returns 1
    - `grep -c "truncated: true" frontend/src/app/api/admin/rate-limits/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/admin/rate-limits/route.test.ts` exits 0
  </acceptance_criteria>
  <done>Rate-limit visibility endpoint implemented with 7 buckets + 1000-key cap + redis-null fallback; tests green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → admin visibility GETs | Cookie session reading internal queue + Redis state |
| admin route → Upstash Redis | SCAN over potentially-large keyspaces |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-04-01 | Information Disclosure | EmailJob.html contains user PII (verification codes, password reset URLs) | mitigate | `bodyPreview` truncates to 200 chars + `html` is dropped from the response shape entirely (verified: `grep -c '"html"' frontend/src/app/api/admin/email-queue/route.ts` returns 0 in the response transformation). |
| T-03-04-02 | Denial of Service | SCAN over a 50K-key bucket (DDoS in progress) | mitigate | Hard-cap at 1000 keys per bucket; `truncated: true` flag in response. Verification: grep `HARD_CAP = 1000` returns 1. (RESEARCH.md Pitfall 6) |
| T-03-04-03 | Information Disclosure | Rate-limit top-10 keys reveal user emails (e.g., `e:foo@bar.com`) | accept | D-ADMIN-03 explicitly allows ADMINs to see PII. Documented in CONTEXT.md. |
| T-03-04-04 | Tampering (field-name confusion) | Frontend expects `event.type` but schema field is `kind` | mitigate | Pitfall 4 — query param + response field both named `kind`. Verification: `grep -c "type" frontend/src/app/api/admin/outbox/route.ts` returns 0. |
| T-03-04-05 | Denial of Service | redis === null in dev crashes route on import or first call | mitigate | Explicit `if (!redis) return { buckets: [], note: 'redis not configured' }` early-return. Verification: grep returns 1. |
| T-03-04-06 | Tampering (Idempotency) | OutboxEvent.payload may contain sensitive fields | accept | Admin needs full payload to triage; `requireAdmin('ADMIN')` is sufficient gating. No further redaction in v1. |
</threat_model>

<verification>
- All 3 route files exist with `runtime = 'nodejs'`
- `pnpm --filter frontend exec vitest run src/app/api/admin/outbox/ src/app/api/admin/email-queue/ src/app/api/admin/rate-limits/` all green
- `pnpm typecheck && pnpm lint` exit 0
- runtime-enforcement.test.ts still green
</verification>

<success_criteria>
- ADMIN can view OutboxEvent rows filtered by `?status` + `?kind`
- ADMIN sees EmailJob rows with `bodyPreview ≤200 chars` (no `html` or `text` in response)
- ADMIN sees rate-limit summary across 7 buckets with 1000-key hard-cap and Redis-null graceful degradation
</success_criteria>

<output>
After completion, create `.planning/phases/03-admin-organizations-orders/03-04-SUMMARY.md` documenting:
- 3 route files created
- Bucket prefix table (7 buckets)
- Truncation observed in tests (`bodyPreview` exact length check)
</output>
