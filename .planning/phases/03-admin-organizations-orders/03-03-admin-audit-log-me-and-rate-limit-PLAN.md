---
phase: 03-admin-organizations-orders
plan: 03
type: execute
wave: 1
depends_on: [01]
files_modified:
  - frontend/src/app/api/admin/audit-log/route.ts
  - frontend/src/app/api/admin/me/route.ts
autonomous: true
requirements: [ADMIN-04, ADMIN-05]
must_haves:
  truths:
    - GET /api/admin/audit-log returns paginated AdminAction rows for ADMIN role
    - GET /api/admin/audit-log filters by ?actor, ?action, ?targetType, ?since, ?until
    - GET /api/admin/me returns { admin: { id, email, role }, can: string[] } with capability list per role
    - SUPERADMIN /me capability list includes 'users:role' and 'withdrawals:cancel' (ADMIN list does not)
    - Both routes export `runtime = 'nodejs'`, wrap in withRequestContext, apply enforceAdminRateLimit
  artifacts:
    - path: frontend/src/app/api/admin/audit-log/route.ts
      provides: GET admin audit-log listing
      exports: ['runtime', 'GET']
    - path: frontend/src/app/api/admin/me/route.ts
      provides: Admin probe + capability list
      exports: ['runtime', 'GET']
  key_links:
    - from: frontend/src/app/api/admin/audit-log/route.ts
      to: frontend/prisma/schema.prisma
      via: prisma.adminAction.findMany with [actorId, createdAt] index
      pattern: 'adminAction\\.findMany'
    - from: frontend/src/app/api/admin/me/route.ts
      to: capability-by-role table
      via: CAPABILITIES_BY_ROLE constant
      pattern: 'CAPABILITIES_BY_ROLE'
---

<objective>
Wave 1 — implement the two thin admin endpoints: audit-log read and `/me` capability probe. The audit-log endpoint reuses the Wave 0 paginate helper; the `/me` endpoint emits a static capability list keyed by role.

Purpose: Cover ADMIN-04 (audit-log listing) and ADMIN-05 (admin probe). The capability list is what front-ends use to render conditional UI — defining it now keeps later UI work unambiguous.

Output: 2 route files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-admin-organizations-orders/03-CONTEXT.md
@.planning/phases/03-admin-organizations-orders/03-RESEARCH.md
@frontend/src/app/api/admin/users/route.ts
@frontend/src/lib/server/pagination/paginate.ts
@frontend/src/lib/server/middleware/rate-limit-by-userid.ts
@frontend/src/lib/server/middleware/index.ts
@frontend/prisma/schema.prisma

<interfaces>
From frontend/prisma/schema.prisma — AdminAction model (lines 65-80):
```prisma
model AdminAction {
  id         String   @id @default(cuid())
  actorId    String
  action     String
  targetType String?
  targetId   String?
  metadata   Json?
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())
  @@index([actorId, createdAt])
  @@index([action, createdAt])
  @@index([targetType, targetId])
}
```

From frontend/src/lib/server/middleware/index.ts:
```typescript
export interface AdminContext { admin: { id: string; email: string; role: 'ADMIN' | 'SUPERADMIN' }; ... }
export async function requireAdmin(min: 'ADMIN' | 'SUPERADMIN'): Promise<AdminContext | NextResponse>;
```

From RESEARCH.md "Endpoint Inventory" §4 + §5 + the capability-list example (lines 626-639).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: GET /api/admin/audit-log (paginated, filterable)</name>
  <files>frontend/src/app/api/admin/audit-log/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/audit-log/route.test.ts (Wave 0 RED scaffolding)
    - frontend/src/app/api/admin/users/route.ts (Plan 03-02 reference — same wrapper pattern)
    - frontend/prisma/schema.prisma — AdminAction model with its 3 composite indices
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Endpoint Inventory" §4 + D-AUDIT-01
    - .planning/phases/03-admin-organizations-orders/03-CONTEXT.md D-AUDIT-02 (free-form metadata table)
  </read_first>
  <behavior>
    - GET `/api/admin/audit-log` accepts `?actor=<userId>`, `?action=<dotted-string e.g. user.role_change>`, `?targetType=<string e.g. User>`, `?since=<ISO>`, `?until=<ISO>`, `?cursor`, `?limit=1..50`. Returns `200 { items: AdminAction[], nextCursor }`. ADMIN role suffices.
    - Filter `?actor` is exact match on `actorId`. `?action` is exact match (no contains — actions are dotted-string keys, not free text). `?targetType` is exact match on the `targetType` column.
    - Field select: `id, actorId, action, targetType, targetId, metadata, ip, userAgent, createdAt` (everything; this is for incident triage — admins need full context).
    - Empty result → `200 { items: [], nextCursor: null }`.
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/audit-log/route.ts` mirroring Plan 03-02 Task 1's wrapper:
    ```typescript
    export const runtime = 'nodejs';

    import 'server-only';
    import { NextResponse, type NextRequest } from 'next/server';
    import type { Prisma } from '@prisma/client';
    import { requireAdmin } from '@/lib/server/middleware';
    import { prisma } from '@/lib/server/prisma';
    import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
    import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
    import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

    function parseDate(raw: string | null): Date | null {
      if (!raw) return null;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    export async function GET(req: NextRequest): Promise<NextResponse> {
      const ctx = makeRequestContext(req.headers);
      return withRequestContext(ctx, async () => {
        const auth = await requireAdmin('ADMIN');
        if (auth instanceof NextResponse) return auth;
        const limited = await enforceAdminRateLimit(auth.admin.id);
        if (limited) return limited;

        const url = req.nextUrl;
        const limit = clampLimit(url.searchParams.get('limit'));
        const actor = url.searchParams.get('actor');
        const action = url.searchParams.get('action');
        const targetType = url.searchParams.get('targetType');
        const since = parseDate(url.searchParams.get('since'));
        const until = parseDate(url.searchParams.get('until'));
        const cursor = decodeCursor(url.searchParams.get('cursor'));

        const where: Prisma.AdminActionWhereInput = {
          ...(actor ? { actorId: actor } : {}),
          ...(action ? { action } : {}),
          ...(targetType ? { targetType } : {}),
          ...(since || until ? { createdAt: {
            ...(since ? { gte: since } : {}),
            ...(until ? { lte: until } : {}),
          } } : {}),
          ...cursorWhere(cursor),
        };

        const rows = await prisma.adminAction.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          select: {
            id: true, actorId: true, action: true, targetType: true,
            targetId: true, metadata: true, ip: true, userAgent: true,
            createdAt: true,
          },
        });

        return NextResponse.json(buildPage(rows, limit), { headers: { 'x-request-id': ctx.requestId } });
      });
    }
    ```

    Make the Wave 0 RED tests in `audit-log/route.test.ts` GREEN with seeded AdminAction rows (e.g. via `prisma.adminAction.create` directly in the test setup — these are SEEDED in tests, not via `logAdminAction`, because we're testing the read path).
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/audit-log/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/audit-log/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/audit-log/route.ts` returns 1
    - `grep -c "requireAdmin\('ADMIN'\)" frontend/src/app/api/admin/audit-log/route.ts` returns 1
    - `grep -c "enforceAdminRateLimit" frontend/src/app/api/admin/audit-log/route.ts` returns 1
    - `grep -c "prisma.adminAction.findMany" frontend/src/app/api/admin/audit-log/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/admin/audit-log/route.test.ts` exits 0
  </acceptance_criteria>
  <done>Audit-log read endpoint implemented; tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GET /api/admin/me (capability probe)</name>
  <files>frontend/src/app/api/admin/me/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/me/route.test.ts (Wave 0 RED scaffolding)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Example: GET /api/admin/me capability list" (lines 619-648) — verbatim source
    - .planning/phases/03-admin-organizations-orders/03-CONTEXT.md D-ADMIN-04
  </read_first>
  <behavior>
    - GET `/api/admin/me` returns `200 { admin: { id, email, role }, can: string[] }`. ADMIN role suffices.
    - Capability list is computed from role:
      - ADMIN: `['users:read', 'users:status:suspend', 'orders:read', 'withdrawals:read', 'audit-log:read', 'outbox:read', 'email-queue:read', 'rate-limits:read']`
      - SUPERADMIN: `['users:read', 'users:role', 'users:status:suspend', 'users:status:restore', 'orders:read', 'withdrawals:read', 'withdrawals:cancel', 'audit-log:read', 'outbox:read', 'email-queue:read', 'rate-limits:read']`
    - Apply `enforceAdminRateLimit` so this probe respects the same 100/min/userId budget (a polling UI mustn't burn it).
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/me/route.ts` verbatim per RESEARCH.md Example (lines 619-648), with the rate-limit gate added:
    ```typescript
    export const runtime = 'nodejs';

    import 'server-only';
    import { NextResponse, type NextRequest } from 'next/server';
    import { requireAdmin } from '@/lib/server/middleware';
    import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
    import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

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

    export async function GET(req: NextRequest): Promise<NextResponse> {
      const ctx = makeRequestContext(req.headers);
      return withRequestContext(ctx, async () => {
        const auth = await requireAdmin('ADMIN');
        if (auth instanceof NextResponse) return auth;
        const limited = await enforceAdminRateLimit(auth.admin.id);
        if (limited) return limited;

        return NextResponse.json({
          admin: { id: auth.admin.id, email: auth.admin.email, role: auth.admin.role },
          can: CAPABILITIES_BY_ROLE[auth.admin.role],
        });
      });
    }
    ```

    Make the Wave 0 RED tests GREEN — assertions:
    - ADMIN cookie → `can` array is the 8-item ADMIN list (exact match)
    - SUPERADMIN cookie → `can` array contains `users:role` and `withdrawals:cancel` and `users:status:restore`
    - Unauthenticated → 401 from `requireAdmin`
    - USER (non-admin) cookie → 403 ADMIN_REQUIRED from `requireAdmin`
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/me/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/me/route.ts` exists
    - `grep -c "CAPABILITIES_BY_ROLE" frontend/src/app/api/admin/me/route.ts` returns ≥2
    - `grep -c "users:role" frontend/src/app/api/admin/me/route.ts` returns 1 (only in SUPERADMIN list)
    - `grep -c "withdrawals:cancel" frontend/src/app/api/admin/me/route.ts` returns 1 (only in SUPERADMIN list)
    - `grep -c "users:status:restore" frontend/src/app/api/admin/me/route.ts` returns 1 (only in SUPERADMIN list)
    - `pnpm --filter frontend exec vitest run src/app/api/admin/me/route.test.ts` exits 0
  </acceptance_criteria>
  <done>/me probe implemented; capability list matches D-ADMIN-04 exactly.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → audit-log GET | Cookie session crossing into compliance-critical query |
| client → /me probe | Authenticated session reading own capability list |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-03-01 | Repudiation | Audit-log read endpoint | mitigate | Read-only — no DELETE endpoint exists for AdminAction (append-only by absence). Verification: `find frontend/src/app/api/admin/audit-log -name "*.ts" | xargs grep -l "DELETE\|delete"` returns no route handlers. |
| T-03-03-02 | Information Disclosure | Audit-log metadata field is free-form | accept | D-AUDIT-02 ships free-form JSON; mutating routes (Plan 03-06) own the responsibility to NOT log secrets in metadata. Reviewed in Plan 03-06's threat model. |
| T-03-03-03 | Elevation of Privilege | /me capability list determines client UI | mitigate | Capability list is informational only; server still enforces role on every mutating route via `requireSuperadmin`. Client-side rendering never substitutes for server-side gates. |
| T-03-03-04 | Denial of Service | /me probe could be polled aggressively | mitigate | `enforceAdminRateLimit` applies 100/min/userId. Verification: grep for `enforceAdminRateLimit` returns 1 in /me/route.ts. |
</threat_model>

<verification>
- Both route files exist with `runtime = 'nodejs'`
- `pnpm --filter frontend exec vitest run src/app/api/admin/audit-log/ src/app/api/admin/me/` all green
- `pnpm typecheck && pnpm lint` exit 0
- runtime-enforcement.test.ts still green
</verification>

<success_criteria>
- ADMIN can read audit-log with all 5 filters working
- ADMIN sees the 8-item capability list; SUPERADMIN sees the 11-item list including the 3 SUPERADMIN-only capabilities
- Both routes apply per-userId rate-limiting
</success_criteria>

<output>
After completion, create `.planning/phases/03-admin-organizations-orders/03-03-SUMMARY.md` documenting:
- 2 route files created
- Capability list shape locked in (front-ends can pivot off it)
</output>
