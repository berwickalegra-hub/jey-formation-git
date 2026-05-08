---
phase: 03-admin-organizations-orders
plan: 06
type: execute
wave: 2
depends_on: [01, 02]
files_modified:
  - frontend/src/app/api/admin/users/[id]/role/route.ts
  - frontend/src/app/api/admin/users/[id]/status/route.ts
  - frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts
autonomous: true
requirements: [ADMIN-01, ADMIN-03, ADMIN-06]
must_haves:
  truths:
    - PATCH /api/admin/users/[id]/role by SUPERADMIN → 200 + AdminAction row with action='user.role_change'
    - PATCH /api/admin/users/[id]/role by ADMIN → 403 ADMIN_REQUIRED
    - PATCH /api/admin/users/[id]/role demoting last SUPERADMIN → 409 LAST_SUPERADMIN
    - PATCH /api/admin/users/[id]/status by ADMIN can SUSPEND → 200 + AdminAction action='user.suspend'
    - PATCH /api/admin/users/[id]/status restore (SUSPENDED → ACTIVE) by ADMIN → 403 RESTORE_REQUIRES_SUPERADMIN
    - PATCH /api/admin/users/[id]/status restore by SUPERADMIN → 200 + AdminAction action='user.restore'
    - POST /api/admin/withdrawals/[id]/cancel by ADMIN → 403 ADMIN_REQUIRED
    - POST /api/admin/withdrawals/[id]/cancel by SUPERADMIN on PENDING/PROCESSING withdrawal → 200 + status=CANCELLED + AdminAction action='withdrawal.cancel'
    - POST /api/admin/withdrawals/[id]/cancel on already-COMPLETED/FAILED/CANCELLED → 409 WITHDRAWAL_NOT_CANCELLABLE
    - All three routes export `runtime = 'nodejs'`, call `verifyCsrf` BEFORE auth, wrap in withRequestContext, write AdminAction inside the same Prisma transaction as the mutation
  artifacts:
    - path: frontend/src/app/api/admin/users/[id]/role/route.ts
      provides: PATCH user role (SUPERADMIN-only)
      exports: ['runtime', 'PATCH']
    - path: frontend/src/app/api/admin/users/[id]/status/route.ts
      provides: PATCH user status (ADMIN suspend, SUPERADMIN restore)
      exports: ['runtime', 'PATCH']
    - path: frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts
      provides: POST cancel withdrawal (SUPERADMIN-only)
      exports: ['runtime', 'POST']
  key_links:
    - from: frontend/src/app/api/admin/users/[id]/role/route.ts
      to: frontend/src/lib/server/admin/audit.ts
      via: logAdminAction(tx, { action: 'user.role_change', metadata: { from, to } }) — INSIDE the prisma.$transaction
      pattern: 'logAdminAction.*user\\.role_change'
    - from: frontend/src/app/api/admin/users/[id]/role/route.ts
      to: 'prisma.$transaction'
      via: count(SUPERADMIN) + update inside same tx (CF-09 atomic guard)
      pattern: 'prisma.\\$transaction'
    - from: frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts
      to: 'CANCELLABLE_STATUSES'
      via: 'PENDING|PROCESSING' allowed; otherwise 409
      pattern: 'WITHDRAWAL_NOT_CANCELLABLE'
---

<objective>
Wave 2 — implement the three admin mutations: role change, status change, withdrawal cancel. Each runs the same shape: verifyCsrf → require(Admin|Superadmin) → Zod parse → Prisma transaction (read+update+logAdminAction in one atomic block) → response. The role-change route additionally enforces the last-SUPERADMIN guard atomically inside the same tx (CF-09 + Pitfall 1).

Purpose: Cover the mutating side of ADMIN-01 (role) + ADMIN-03 (cancel) + the new D-ADMIN-02 status field, with ADMIN-06 (every mutation writes AdminAction) enforced transitively.

Output: 3 mutation route files. The withdrawals/route.test.ts cancel-related tests (left RED in Plan 03-02) become GREEN here.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-admin-organizations-orders/03-CONTEXT.md
@.planning/phases/03-admin-organizations-orders/03-RESEARCH.md
@frontend/src/lib/server/admin/audit.ts
@frontend/src/lib/server/middleware/index.ts
@frontend/src/lib/server/auth.ts
@frontend/src/app/api/notifications/route.ts
@frontend/src/app/api/admin/users/route.ts
@frontend/prisma/schema.prisma
@CLAUDE.md

<interfaces>
From frontend/src/lib/server/admin/audit.ts (PROTECTED — call only):
```typescript
export interface AdminActionInput {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Json;
  ip?: string;
  userAgent?: string;
}
export type AuditClient = Pick<PrismaClient, 'adminAction'>;
export async function logAdminAction(prisma: AuditClient, input: AdminActionInput): Promise<void>;
```

From frontend/src/lib/server/middleware/index.ts:
```typescript
export interface AdminContext { admin: { id: string; email: string; role: 'ADMIN' | 'SUPERADMIN' } }
export async function requireAdmin(min: 'ADMIN' | 'SUPERADMIN'): Promise<AdminContext | NextResponse>;
export async function requireSuperadmin(): Promise<AdminContext | NextResponse>;
```

From frontend/src/lib/server/auth.ts:
```typescript
export function verifyCsrf(req: NextRequest): NextResponse | null;
```

AdminAction.metadata shapes per RESEARCH.md "AdminAction metadata shapes" table (lines 671-677):
- user.role_change: `{ from: <oldRole>, to: <newRole> }`
- user.suspend: `{ from: 'ACTIVE', to: 'SUSPENDED', reason?: string }`
- user.restore: `{ from: 'SUSPENDED', to: 'ACTIVE', reason?: string }`
- withdrawal.cancel: `{ withdrawalId, amount, currency, reason: string, previousStatus }`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: PATCH /api/admin/users/[id]/role (SUPERADMIN, last-superadmin guard)</name>
  <files>frontend/src/app/api/admin/users/[id]/role/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/users/route.test.ts (Wave 0 RED scaffolding — covers role tests)
    - frontend/src/lib/server/middleware/index.ts (`requireSuperadmin`)
    - frontend/src/lib/server/admin/audit.ts (`logAdminAction` signature; `AuditClient = Pick<PrismaClient, 'adminAction'>` — so the tx can be passed directly)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Pattern 2" (lines 238-322) — full template
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Pitfall 1: Demote-last-SUPERADMIN race condition"
    - .planning/phases/03-admin-organizations-orders/03-CONTEXT.md CF-08, CF-09, CF-11
  </read_first>
  <behavior>
    - PATCH `/api/admin/users/[id]/role` body `{ role: 'USER' | 'ADMIN' | 'SUPERADMIN' }`. SUPERADMIN-only.
    - Atomically inside `prisma.$transaction(async tx => ...)`:
      1. `tx.user.findUnique({ where: { id } })` — if missing → return `NOT_FOUND` discriminator
      2. If `target.role === 'SUPERADMIN' && newRole !== 'SUPERADMIN'` → `tx.user.count({ where: { role: 'SUPERADMIN' } })`; if `<= 1` → return `LAST_SUPERADMIN` discriminator
      3. `tx.user.update({ where: { id }, data: { role: newRole } })`
      4. `logAdminAction(tx, { actorId: auth.admin.id, action: 'user.role_change', targetType: 'User', targetId: id, metadata: { from: target.role, to: newRole } })`
    - Map discriminators to responses:
      - `NOT_FOUND` → 404 `{ error: 'USER_NOT_FOUND' }`
      - `LAST_SUPERADMIN` → 409 `{ error: 'LAST_SUPERADMIN', message: 'Refuse to demote the last SUPERADMIN.' }`
      - `OK` → 200 `{ user: { id, role } }`
    - Body-parse failure → 400 `{ error: 'VALIDATION_FAILED', message: 'Invalid request body' }`
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/users/[id]/role/route.ts` verbatim from RESEARCH.md Pattern 2 (lines 238-322), with two adaptations:

    1. Wrap the entire handler body in `withRequestContext(makeRequestContext(req.headers), async () => { ... })` (the Pattern 2 example already does this — confirm the wrapper is present).
    2. Apply `enforceAdminRateLimit(auth.admin.id)` AFTER the `requireSuperadmin` gate (consistent with Plan 03-02/03/04 pattern):
    ```typescript
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;
    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;
    ```

    Make the role-change tests in `users/route.test.ts` GREEN (they were Wave 0 RED placeholders):
    - `it('PATCH role by SUPERADMIN → 200 + AdminAction row')`: seed 2 SUPERADMINs (one is the actor, the other is demoted to ADMIN); assert response 200, target user's role is now ADMIN, an `AdminAction` exists with `action='user.role_change', metadata={from:'SUPERADMIN', to:'ADMIN'}`.
    - `it('PATCH role by ADMIN → 403 ADMIN_REQUIRED')`: ADMIN cookie attempts to change another user's role → 403.
    - `it('PATCH role demoting last SUPERADMIN → 409 LAST_SUPERADMIN')`: only one SUPERADMIN in DB; that SUPERADMIN attempts to demote themselves to ADMIN → 409 + role unchanged + NO AdminAction row written.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/users/route.test.ts -t "role"</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/users/[id]/role/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/users/[id]/role/route.ts` returns 1
    - `grep -c "verifyCsrf" frontend/src/app/api/admin/users/[id]/role/route.ts` returns 1
    - `grep -c "requireSuperadmin" frontend/src/app/api/admin/users/[id]/role/route.ts` returns 1
    - `grep -c "prisma.\$transaction" frontend/src/app/api/admin/users/[id]/role/route.ts` returns 1
    - `grep -c "logAdminAction" frontend/src/app/api/admin/users/[id]/role/route.ts` returns 1
    - `grep -c "user.role_change" frontend/src/app/api/admin/users/[id]/role/route.ts` returns 1
    - `grep -c "LAST_SUPERADMIN" frontend/src/app/api/admin/users/[id]/role/route.ts` returns ≥1
    - `pnpm --filter frontend exec vitest run src/app/api/admin/users/route.test.ts -t "role"` exits 0
  </acceptance_criteria>
  <done>Role-change endpoint with last-SUPERADMIN guard implemented; tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: PATCH /api/admin/users/[id]/status (ADMIN suspend, SUPERADMIN restore)</name>
  <files>frontend/src/app/api/admin/users/[id]/status/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/users/route.test.ts (Wave 0 RED scaffolding — status tests)
    - frontend/src/app/api/admin/users/[id]/role/route.ts (Task 1 reference — same shape)
    - frontend/src/lib/server/middleware/index.ts (note: `requireAdmin('ADMIN')` returns AdminContext where role is `'ADMIN' | 'SUPERADMIN'` — branch on `auth.admin.role` for the restore-permission gate)
    - .planning/phases/03-admin-organizations-orders/03-CONTEXT.md D-ADMIN-02 + RESEARCH.md "Endpoint Inventory" §1d
  </read_first>
  <behavior>
    - PATCH `/api/admin/users/[id]/status` body `{ status: 'ACTIVE' | 'SUSPENDED', reason?: string }`. ADMIN role gates the route; the inner restore-only branch additionally requires SUPERADMIN.
    - Logic:
      1. CSRF + `requireAdmin('ADMIN')` + `enforceAdminRateLimit`
      2. Zod parse body
      3. Inside `prisma.$transaction`:
         - Find target user
         - If missing → NOT_FOUND
         - Compute transition: `target.status -> body.status`
         - **If transition is SUSPENDED → ACTIVE (restore) AND `auth.admin.role !== 'SUPERADMIN'`** → return `RESTORE_REQUIRES_SUPERADMIN`
         - If transition is no-op (same status) → return target user unchanged WITHOUT writing AdminAction (idempotent)
         - Else: update + logAdminAction with `action='user.suspend'` for ACTIVE→SUSPENDED, `action='user.restore'` for SUSPENDED→ACTIVE; metadata `{ from, to, ...(reason ? { reason } : {}) }`
      4. Map discriminators:
         - NOT_FOUND → 404 USER_NOT_FOUND
         - RESTORE_REQUIRES_SUPERADMIN → 403 `{ error: 'RESTORE_REQUIRES_SUPERADMIN', message: 'Only a SUPERADMIN can restore a suspended account.' }`
         - OK → 200 `{ user }`
    - Self-suspension: allowed (consistent with Open Question 2 about role self-demotion). Audit log records `actorId === targetId`.
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/users/[id]/status/route.ts`. Concrete Zod + transaction:

    ```typescript
    const Body = z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED']),
      reason: z.string().min(1).max(500).optional(),
    });

    // ... inside the wrapped handler, after csrf + requireAdmin('ADMIN') + rate-limit:

    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, status: true, email: true, name: true, role: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      // Idempotent no-op
      if (target.status === parsed.data.status) {
        return { kind: 'OK' as const, user: { id: target.id, status: target.status } };
      }

      // SUSPENDED -> ACTIVE = restore. Only SUPERADMIN allowed.
      const isRestore = target.status === 'SUSPENDED' && parsed.data.status === 'ACTIVE';
      if (isRestore && auth.admin.role !== 'SUPERADMIN') {
        return { kind: 'RESTORE_REQUIRES_SUPERADMIN' as const };
      }

      const updated = await tx.user.update({
        where: { id },
        data: { status: parsed.data.status },
        select: { id: true, status: true },
      });

      await logAdminAction(tx, {
        actorId: auth.admin.id,
        action: isRestore ? 'user.restore' : 'user.suspend',
        targetType: 'User',
        targetId: id,
        metadata: {
          from: target.status,
          to: parsed.data.status,
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        },
      });

      return { kind: 'OK' as const, user: updated };
    });
    ```

    Make the status tests in `users/route.test.ts` GREEN:
    - ACTIVE → SUSPENDED by ADMIN → 200 + AdminAction `user.suspend`
    - SUSPENDED → ACTIVE by ADMIN → 403 RESTORE_REQUIRES_SUPERADMIN + status unchanged + NO AdminAction
    - SUSPENDED → ACTIVE by SUPERADMIN → 200 + AdminAction `user.restore`
    - Idempotent same-status PATCH → 200 + NO AdminAction (assert AdminAction count unchanged)
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/users/route.test.ts -t "status"</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/users/[id]/status/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/users/[id]/status/route.ts` returns 1
    - `grep -c "verifyCsrf" frontend/src/app/api/admin/users/[id]/status/route.ts` returns 1
    - `grep -c "requireAdmin\('ADMIN'\)" frontend/src/app/api/admin/users/[id]/status/route.ts` returns 1
    - `grep -c "RESTORE_REQUIRES_SUPERADMIN" frontend/src/app/api/admin/users/[id]/status/route.ts` returns ≥1
    - `grep -c "user.suspend" frontend/src/app/api/admin/users/[id]/status/route.ts` returns 1
    - `grep -c "user.restore" frontend/src/app/api/admin/users/[id]/status/route.ts` returns 1
    - `grep -c "logAdminAction" frontend/src/app/api/admin/users/[id]/status/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/admin/users/route.test.ts -t "status"` exits 0
  </acceptance_criteria>
  <done>Status-change endpoint with role-aware restore gate implemented; tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: POST /api/admin/withdrawals/[id]/cancel (SUPERADMIN-only manual cancel)</name>
  <files>frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/withdrawals/route.test.ts (Wave 0 RED scaffolding — cancel tests)
    - frontend/src/app/api/admin/users/[id]/role/route.ts (Task 1 reference — same shape)
    - frontend/prisma/schema.prisma — Withdrawal model (note: status enum values are PENDING|PROCESSING|COMPLETED|FAILED|CANCELLED)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Endpoint Inventory" §3b + D-ADMIN-01
  </read_first>
  <behavior>
    - POST `/api/admin/withdrawals/[id]/cancel` body `{ reason: string }` (required, 1..500 chars). SUPERADMIN-only.
    - Cancellable statuses: `PENDING`, `PROCESSING`. Other statuses (COMPLETED/FAILED/CANCELLED) → 409 WITHDRAWAL_NOT_CANCELLABLE.
    - Inside `prisma.$transaction`:
      1. Find withdrawal
      2. If missing → NOT_FOUND
      3. If `!['PENDING', 'PROCESSING'].includes(w.status)` → NOT_CANCELLABLE
      4. Update `status='CANCELLED'`, `failureReason=<the cancel reason>`, `processedAt=now()`, `completedAt=now()`
      5. logAdminAction with `action='withdrawal.cancel', targetType='Withdrawal', targetId=id, metadata={ withdrawalId: id, amount, currency, reason, previousStatus }`
    - Map:
      - NOT_FOUND → 404 `{ error: 'WITHDRAWAL_NOT_FOUND' }`
      - NOT_CANCELLABLE → 409 `{ error: 'WITHDRAWAL_NOT_CANCELLABLE', message: 'Withdrawal is not in a cancellable state.' }`
      - OK → 200 `{ withdrawal }`
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts`:

    ```typescript
    export const runtime = 'nodejs';

    import 'server-only';
    import { NextResponse, type NextRequest } from 'next/server';
    import { z } from 'zod';
    import { verifyCsrf } from '@/lib/server/auth';
    import { requireSuperadmin } from '@/lib/server/middleware';
    import { prisma } from '@/lib/server/prisma';
    import { logAdminAction } from '@/lib/server/admin/audit';
    import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
    import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

    const Body = z.object({ reason: z.string().min(1).max(500) });
    const CANCELLABLE = new Set(['PENDING', 'PROCESSING']);

    export async function POST(
      req: NextRequest,
      ctx: { params: Promise<{ id: string }> },
    ): Promise<NextResponse> {
      const reqCtx = makeRequestContext(req.headers);
      return withRequestContext(reqCtx, async () => {
        const csrfFail = verifyCsrf(req);
        if (csrfFail) return csrfFail;

        const auth = await requireSuperadmin();
        if (auth instanceof NextResponse) return auth;

        const limited = await enforceAdminRateLimit(auth.admin.id);
        if (limited) return limited;

        const { id } = await ctx.params;
        const parsed = Body.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
          return NextResponse.json({ error: 'VALIDATION_FAILED', message: 'Invalid request body' }, { status: 400 });
        }

        const result = await prisma.$transaction(async (tx) => {
          const w = await tx.withdrawal.findUnique({ where: { id } });
          if (!w) return { kind: 'NOT_FOUND' as const };
          if (!CANCELLABLE.has(w.status)) return { kind: 'NOT_CANCELLABLE' as const };

          const now = new Date();
          const updated = await tx.withdrawal.update({
            where: { id },
            data: {
              status: 'CANCELLED',
              failureReason: parsed.data.reason,
              processedAt: w.processedAt ?? now,
              completedAt: now,
            },
          });

          await logAdminAction(tx, {
            actorId: auth.admin.id,
            action: 'withdrawal.cancel',
            targetType: 'Withdrawal',
            targetId: id,
            metadata: {
              withdrawalId: id,
              amount: w.amount,
              currency: w.currency,
              reason: parsed.data.reason,
              previousStatus: w.status,
            },
          });

          return { kind: 'OK' as const, withdrawal: updated };
        });

        if (result.kind === 'NOT_FOUND') {
          return NextResponse.json({ error: 'WITHDRAWAL_NOT_FOUND' }, { status: 404 });
        }
        if (result.kind === 'NOT_CANCELLABLE') {
          return NextResponse.json(
            { error: 'WITHDRAWAL_NOT_CANCELLABLE', message: 'Withdrawal is not in a cancellable state.' },
            { status: 409 },
          );
        }
        return NextResponse.json({ withdrawal: result.withdrawal }, { status: 200 });
      });
    }
    ```

    Make the cancel tests in `withdrawals/route.test.ts` GREEN (Plan 03-02 left them RED):
    - ADMIN cancel attempt → 403 ADMIN_REQUIRED (from `requireSuperadmin`)
    - SUPERADMIN cancel on PENDING → 200 + status=CANCELLED + AdminAction action='withdrawal.cancel' + metadata.previousStatus='PENDING'
    - SUPERADMIN cancel on COMPLETED → 409 WITHDRAWAL_NOT_CANCELLABLE + no DB change + no AdminAction
    - SUPERADMIN cancel on missing id → 404 WITHDRAWAL_NOT_FOUND
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/withdrawals/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` returns 1
    - `grep -c "verifyCsrf" frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` returns 1
    - `grep -c "requireSuperadmin" frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` returns 1
    - `grep -c "withdrawal.cancel" frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` returns 1
    - `grep -c "WITHDRAWAL_NOT_CANCELLABLE" frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` returns 1
    - `grep -c "logAdminAction" frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/admin/withdrawals/route.test.ts` exits 0 (BOTH list AND cancel tests now green)
  </acceptance_criteria>
  <done>Withdrawal-cancel endpoint implemented; ALL withdrawal route tests now green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → admin mutations | Cookie session crossing into role/status/withdrawal-status mutation |
| route → DB transaction | Read-modify-write requiring atomicity for last-SUPERADMIN guard |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-06-01 | Elevation of Privilege | ADMIN attempts to PATCH role | mitigate | `requireSuperadmin` gates the route; ADMIN gets 403. Verification: users/route.test.ts asserts 403 ADMIN_REQUIRED. |
| T-03-06-02 | Denial of Service | Last-SUPERADMIN race (Pitfall 1) | mitigate | COUNT + UPDATE inside same `prisma.$transaction`. Verification: grep `prisma.\$transaction` returns 1 in role/route.ts. |
| T-03-06-03 | Repudiation | Audit-log tampering (admin deletes own AdminAction row) | mitigate | No DELETE endpoint exists for AdminAction; the schema has no DELETE handler shipped. Verification: `find frontend/src/app/api/admin/audit-log -name "route.ts" | xargs grep -l "DELETE"` returns nothing. |
| T-03-06-04 | Tampering (mass-assignment) | Body includes extra fields (e.g., `tokenVersion`) | mitigate | Zod `enum` for role; Zod `enum` + optional reason for status. Both Body schemas reject extra keys when used with `safeParse` (default Zod behavior is strip, so unknown fields are dropped — verified safe). |
| T-03-06-05 | Tampering (CSRF) | Cross-site PATCH | mitigate | `verifyCsrf(req)` BEFORE auth on every route. Verification: grep returns 1 in each of the 3 files. |
| T-03-06-06 | Information Disclosure | Reason field leaked through audit metadata | accept | Reason is operator-supplied free text; admins are trusted to not paste secrets. Documented in CONTEXT.md D-AUDIT-02 caveat. |
| T-03-06-07 | Repudiation (financial) | Withdrawal cancel reason left blank | mitigate | Zod requires `reason: z.string().min(1).max(500)`. Verification: grep `min(1)` returns 1 in withdrawals/cancel/route.ts. |
| T-03-06-08 | Tampering (idempotent suspend) | Repeated PATCH status with same value pollutes audit log | mitigate | Idempotent no-op short-circuits BEFORE writing AdminAction (verified in Task 2 action block: `if (target.status === parsed.data.status) return OK without logAdminAction`). |
| T-03-06-09 | Information Disclosure | last-SUPERADMIN guard reveals SUPERADMIN count | accept | Error message says "last SUPERADMIN" — confirms there is exactly one. This is acceptable; the error is only returned to authenticated SUPERADMINs, who can already query the count. |
</threat_model>

<verification>
- All 3 mutation route files exist with `runtime = 'nodejs'`
- `pnpm --filter frontend exec vitest run src/app/api/admin/users/ src/app/api/admin/withdrawals/` all green (including the previously-RED cancel tests)
- `pnpm typecheck && pnpm lint` exit 0
- runtime-enforcement.test.ts still green
- `pnpm test` (full suite) exits 0
</verification>

<success_criteria>
- SUPERADMIN can change role; ADMIN gets 403; last-SUPERADMIN demotion blocked atomically with 409
- ADMIN can suspend a user; only SUPERADMIN can restore
- SUPERADMIN can cancel PENDING/PROCESSING withdrawals; ADMIN gets 403; non-cancellable status returns 409
- Every successful mutation writes exactly one `AdminAction` row inside the same Prisma transaction (CF-11 / ADMIN-06)
- Idempotent re-PATCH of the same status writes NO AdminAction
</success_criteria>

<output>
After completion, create `.planning/phases/03-admin-organizations-orders/03-06-SUMMARY.md` documenting:
- 3 mutation routes created
- Three AdminAction shapes verified in tests (`user.role_change`, `user.suspend`/`user.restore`, `withdrawal.cancel`)
- Confirmation that the previously-RED cancel tests in withdrawals/route.test.ts are now green
</output>
