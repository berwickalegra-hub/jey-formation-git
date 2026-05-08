# Phase 3: Admin, Orders, Visibility — Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers three things:

1. **Admin back-office** — 8 endpoints under `/api/admin/*` covering users (search/detail/role/status), orders (filter), withdrawals (filter + manual cancel), audit-log (paginated/filterable), and `/api/admin/me` (capability probe). Every mutation MUST go through `logAdminAction`.

2. **Payment orders** — `POST /api/orders` creates an Order via the Bictorys `PaymentProvider` interface, guarded by an in-memory CircuitBreaker. Returns the payment URL on success, 503 with `PAYMENT_PROVIDER_UNAVAILABLE` on circuit open.

3. **Visibility / observability for back-office** — `GET /api/admin/outbox`, `/api/admin/email-queue`, `/api/admin/rate-limits` expose internal state to admins for incident response. Read-only in v1.

**Bootstrap script** — `pnpm db:make-superadmin <email>` script at `frontend/scripts/make-superadmin.ts` for the first SUPERADMIN.

**NOT in this phase (deferred):**
- Organizations / multi-tenancy routes — Prisma models + `requireOrgRole` middleware are kept as opt-in plumbing per CLAUDE.md "Multi-tenancy is opt-in"; the 8 `/api/organizations/*` route handlers are NOT shipped in v1. ORG-01..06 moved to PROJECT.md `Out of Scope`.

</domain>

<decisions>
## Implementation Decisions

### Carry-forward from prior phases (LOCKED, do not re-decide)

- **CF-01 (Phase 1 D-01):** Every route file: `export const runtime = 'nodejs'` first; handler wraps body in `withRequestContext(makeRequestContext(req.headers), async () => { ... })` so logs auto-attach `requestId`/`userId`/`route`.
- **CF-02 (Phase 1 D-02):** Mutating routes (POST/PUT/PATCH/DELETE) call `verifyCsrf(req)` from `frontend/src/lib/server/middleware/index.ts` BEFORE auth/business logic. Bail with `if (csrf instanceof NextResponse) return csrf`.
- **CF-03 (Phase 1 D-03 + middleware):** Authenticated routes use `requireAuth(req)`; admin routes use `requireAdmin(req)` / `requireSuperadmin(req)` from `middleware/index.ts`. Pattern: `if (auth instanceof NextResponse) return auth;`.
- **CF-04 (Phase 1 D-04):** Body validation via Zod at the top of each route. On failure: `400 { error: 'VALIDATION_FAILED', issues: [...] }` using `frontend/src/lib/server/zod-helpers.ts`. Never raw Zod issues.
- **CF-05 (Phase 1 D-05):** Response shape — success `NextResponse.json({...})`; failure `NextResponse.json({ error: '<STABLE_CODE>', message: '<user-facing>' }, { status })`. Frontend switches on `error`, never on `message`.
- **CF-06 (Phase 2 D-NOTIF-05):** Notification dispatchers MUST go through `createNotification(prisma, input)` — never `prisma.notification.create` directly.
- **CF-07 (Phase 2 D-07):** Cursor pagination format = `base64(JSON.stringify({ createdAt, id }))`. Reuse `frontend/src/lib/server/notifications/cursor.ts` as-is.
- **CF-08 (CLAUDE.md):** Role precedence — `USER < ADMIN < SUPERADMIN` (only SUPERADMIN can change roles); `MEMBER < ADMIN < OWNER` (org-level, but no org routes shipped this phase).
- **CF-09 (CLAUDE.md):** Demote-last-SUPERADMIN → 409. Refuse to demote the last SUPERADMIN to avoid locking org out.
- **CF-10 (CLAUDE.md):** Payment amounts = integer in smallest currency unit. XOF/FCFA = no decimals. NEVER store decimals.
- **CF-11 (CLAUDE.md):** Admin mutations MUST go through `logAdminAction(prisma, {...})`. Bypass = unaudited action = compliance regression.

---

### Orders & payment provider

- **D-PAY-01:** `POST /api/orders` requires `Idempotency-Key` HTTP header. On replay with same key → return original 200 response (no double-charge). Store on `Order.idempotencyKey @unique String?` (new Prisma column, requires migration). Pattern: Stripe-grade safety.
- **D-PAY-02:** CircuitBreaker thresholds (in-memory, single-instance — already in `frontend/src/lib/server/payments/circuit-breaker.ts`):
  - `failureThreshold = 5` failures
  - `windowMs = 30000` (30s rolling window)
  - `openMs = 60000` (60s open state before half-open)
  - When open, `POST /api/orders` returns `503 { error: 'PAYMENT_PROVIDER_UNAVAILABLE', message: '...' }` immediately
  - Hard-coded values in v1 (no env toggles); CLAUDE.md acknowledges "single-instance limitation, replace with Redis-backed variant per project if multi-pod".
- **D-PAY-03:** Auth required for `POST /api/orders` in v1. No guest checkout (despite `Order.userId` being nullable in schema — that nullability stays for forks that need it, but the v1 route refuses without cookies). Add `requireAuth` gate at top of handler.
- **D-PAY-04:** Body Zod schema:
  ```ts
  z.object({
    amount: z.number().int().positive(),                   // smallest currency unit
    currency: z.string().length(3).optional().default('XOF'),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().optional(),
    customerName: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),            // app-specific
  })
  ```
  All fields optional except `amount`. `customerEmail/Phone/Name` default to the authenticated user's profile if absent.

### Admin ACL

- **D-ADMIN-01:** `PATCH /api/admin/withdrawals/:id/cancel` — **SUPERADMIN-only** (financial-sensitive). ADMIN attempting → 403.
- **D-ADMIN-02:** Add `User.status` enum field (Prisma migration required):
  ```prisma
  status String @default("ACTIVE") // "ACTIVE" | "SUSPENDED"
  ```
  - `PATCH /api/admin/users/:id/status` body `{ status: "ACTIVE" | "SUSPENDED" }`. ADMIN can set `SUSPENDED`; only SUPERADMIN can restore from `SUSPENDED` → `ACTIVE`.
  - **CRITICAL — `frontend/src/app/api/auth/login/route.ts` is in CLAUDE.md "Files Claude SHOULD NOT modify" list.** Login MUST refuse with `403 { error: 'ACCOUNT_SUSPENDED' }` when `User.status === 'SUSPENDED'`. Surface this to the user as "I am about to modify login route because of D-ADMIN-02 — confirm?" before editing.
  - Refresh route also needs the same check (already-issued tokens of suspended users get 401 next refresh).
- **D-ADMIN-03:** All admin listings (users, orders, withdrawals, audit-log) — **ADMIN role suffices** to see PII (email, phone, withdrawal destinations). No SUPERADMIN-gating for read paths. No additional `VIEW_PII` audit event.
- **D-ADMIN-04:** `GET /api/admin/me` returns `{ role: 'ADMIN' | 'SUPERADMIN', can: ['users:read', 'users:status', 'withdrawals:cancel', ...] }` — capability list computed from role. Front uses to render conditional UI.
- **D-ADMIN-05:** Rate-limit ALL admin endpoints to 100 req/min per admin userId. Use the existing `lib/server/rate-limit-store.ts`. Returns `429 { error: 'TOO_MANY_REQUESTS' }`.

### Pagination + search (cross-cutting for all admin listings)

- **D-LIST-01:** Cursor-based pagination — reuse `frontend/src/lib/server/notifications/cursor.ts` as-is. Response shape: `{ items: T[], nextCursor: string | null }`. `nextCursor === null` ⇒ no more.
- **D-LIST-02:** `?q=...` search on `/api/admin/users` → case-insensitive `LIKE '%q%'` on `email` + `name` (Prisma `contains` with `mode: 'insensitive'`). Sanitize input (max 200 chars, no SQL via Prisma).
- **D-LIST-03:** Per-resource simple filters:
  - users: `?q`, `?status` (ACTIVE/SUSPENDED), `?role` (USER/ADMIN/SUPERADMIN)
  - orders: `?status` (PENDING/PAID/EXPIRED/FAILED/REFUNDED), `?since`, `?until`
  - withdrawals: `?status` (PENDING/PROCESSING/COMPLETED/FAILED/CANCELLED), `?since`, `?until`
  - audit-log: `?actor`, `?action`, `?targetType`, `?since`, `?until`
  - Sort: always `createdAt DESC` (no configurable sort in v1).
- **D-LIST-04:** Page size: `?limit=N` with `min(50, parseInt(limit) || 20)`. Default 20, max 50. Same as Phase 2 notifications.
- **D-LIST-05:** Empty result → `200 { items: [], nextCursor: null }`. Never 404 on listing endpoint.

### Audit log

- **D-AUDIT-01:** Filters on `GET /api/admin/audit-log`: `?actor`, `?action`, `?targetType`, `?since`, `?until`. Cursor pagination per D-LIST-01. Tracks who-did-what-when for incident response.
- **D-AUDIT-02:** `AdminAction.metadata` (Json) shape is **free per action**. Each mutation decides what to log:
  - role change: `{ from: "USER", to: "ADMIN" }`
  - status change: `{ from: "ACTIVE", to: "SUSPENDED", reason?: "..." }`
  - withdrawal cancel: `{ withdrawalId, amount, reason?: "..." }`
  - No registry / no schema enforcement. Helper `logAdminAction(prisma, { actorId, action, targetType, targetId, metadata })` already exists in `frontend/src/lib/server/admin/audit.ts`.

### Visibility endpoints (outbox / email-queue / rate-limits)

- **D-OBS-01:** `GET /api/admin/outbox` returns full `OutboxEvent` rows: `{ id, type, payload, attempts, lastError, scheduledAt, processedAt, createdAt }`. Cursor-paginated. Filter `?status=pending|processed|failed` + `?type=`.
- **D-OBS-02:** `GET /api/admin/email-queue` returns `EmailJob` rows with `body` truncated to 200 chars (PII-protective). Response field `bodyPreview` (string, max 200) instead of full `body`. Cursor-paginated. Filter `?status=pending|sent|failed`.
- **D-OBS-03:** `GET /api/admin/rate-limits` returns read-only summary in v1 — for each known bucket (login, signup, forgot-password, reset-password, resend-verification, verify-email, pin), report `{ bucket, totalKeys, top10: [{ key, hits, expiresAt }] }`. No reset capability in v1 (admin cannot clear lockout for a user — defer to v2). Single endpoint, no cursor (bounded summary).

### Bootstrap script (SCRIPT-01)

- **D-SCRIPT-01:** `frontend/scripts/make-superadmin.ts` — runnable via `tsx`. CLI args: `pnpm db:make-superadmin <email>`. Behavior:
  - Resolves `User` by email; if missing → exit 1 with `Error: user <email> not found. Sign up first.`
  - Updates `user.role = 'SUPERADMIN'`. Idempotent (already-SUPERADMIN → no-op + log "already SUPERADMIN").
  - Logs an `AdminAction { actorId: <self-promoting userId>, action: 'BOOTSTRAP_SUPERADMIN' }` with metadata `{ via: 'cli-script' }`.
  - Add `db:make-superadmin` script in root `package.json` that delegates to `pnpm --filter frontend exec tsx scripts/make-superadmin.ts`.

### Claude's Discretion

- Endpoint URL shapes within `/api/admin/*` (e.g., `/api/admin/users/[id]/role` vs `/api/admin/users/[id]/role-change`) — pick conventional REST.
- File organization under `frontend/src/app/api/admin/` (subdirectories vs flat). Recommend grouping by resource (`admin/users/`, `admin/orders/`, etc.).
- Test fixtures and helpers — reuse Phase 1/2 patterns.
- Whether to extract a small `paginate.ts` helper from cursor.ts to share across admin listings.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `CLAUDE.md` — full project invariants (admin role precedence, audit-log mandate, role-change semantics, financial-amount integer rule, single-instance breaker note, files NOT to modify list)
- `STATUS.md` — port checkpoint (admin / payments libs already exist, routes are what's missing)
- `.planning/PROJECT.md` — Out-of-Scope section now includes Organizations routes (deferred 2026-05-08)
- `.planning/ROADMAP.md` Phase 3 section — success criteria + requirement IDs (post-org-removal)
- `.planning/REQUIREMENTS.md` — full text of ADMIN-01..07, PAY-01, OBS-01..03

### Carry-forward from prior phases
- `.planning/phases/01-auth-routes/01-CONTEXT.md` — D-01..D-14 (route shape, CSRF, response shape, stable error codes, password policy)
- `.planning/phases/02-oauth-notifications-withdrawal-pin/02-CONTEXT.md` — D-NOTIF-05, D-07 (cursor format), D-08..D-10 (notification list/filter conventions to mirror)

### Existing libs (already shipped, READ before implementing routes)
- `frontend/src/lib/server/admin/audit.ts` — `logAdminAction(...)` helper (PROTECTED — do not modify, only call)
- `frontend/src/lib/server/middleware/index.ts` — `requireAuth`, `requireAdmin`, `requireSuperadmin`, `verifyCsrf`, `optionalAuth` (PROTECTED — do not modify, only call)
- `frontend/src/lib/server/middleware/require-admin.ts` — role precedence helpers (PROTECTED)
- `frontend/src/lib/server/payments/provider.ts` — `PaymentProvider` interface contract
- `frontend/src/lib/server/payments/bictorys.ts` — Bictorys adapter (charge implementation)
- `frontend/src/lib/server/payments/circuit-breaker.ts` — `CircuitBreaker` class (PROTECTED — single-instance semantics by design)
- `frontend/src/lib/server/payments/commission.ts` — fee/commission calculation
- `frontend/src/lib/server/notifications/cursor.ts` — `encodeCursor`/`decodeCursor` to reuse for admin listings
- `frontend/src/lib/server/rate-limit-store.ts` — for D-ADMIN-05 admin rate-limiting
- `frontend/src/lib/server/zod-helpers.ts` — formatter for `VALIDATION_FAILED` issues
- `frontend/src/lib/server/auth.ts` — login/refresh hooks (PROTECTED, but D-ADMIN-02 requires modifying login to check `User.status === 'SUSPENDED'` — surface as confirm-before-edit)
- `frontend/src/lib/server/observability/request-context.ts` — `withRequestContext`, `makeRequestContext`

### Schema reference
- `frontend/prisma/schema.prisma` — `User` (will gain `status` field per D-ADMIN-02), `AdminAction`, `Order` (will gain `idempotencyKey` field per D-PAY-01), `Withdrawal`, `OutboxEvent`, `EmailJob`

### Reference for examples
- `examples/frontend-pages/admin/{layout,users,withdrawals}.tsx` — UI references for admin pages (NOT to be ported, only to confirm route shape expectations)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`logAdminAction`** (`admin/audit.ts`) — every admin mutation route already has its audit-write helper. Just call it inside the same Prisma transaction as the mutation.
- **`requireAdmin` / `requireSuperadmin`** (`middleware/index.ts`) — gate at top of admin routes; bail on `NextResponse`.
- **`CircuitBreaker`** (`payments/circuit-breaker.ts`) — already wraps charge calls. Just import + invoke; do NOT re-implement.
- **`PaymentProvider` interface + `bictorys` adapter** (`payments/provider.ts` + `payments/bictorys.ts`) — `POST /api/orders` consumes this; adapter handles the HTTP call to Bictorys.
- **`encodeCursor` / `decodeCursor`** (`notifications/cursor.ts`) — same format used for all admin listings (D-LIST-01).
- **`createEmailLimiter` / per-user rate-limit** (`middleware/rate-limit-by-email.ts` + `rate-limit-store.ts`) — D-ADMIN-05 pattern matches existing.

### Established Patterns

- **Per-route Zod schemas at top of file** (Phase 1 D-04) — applied uniformly.
- **`withRequestContext` wrap on every handler** (Phase 1 D-01) — required for log correlation.
- **Stable error codes in response body** (Phase 1 D-05) — frontend never matches on `message`.
- **`runtime='nodejs'` first export** (Phase 0 OPS-02) — CI grep guard fails build otherwise.

### Integration Points

- **Login route** (`frontend/src/app/api/auth/login/route.ts`) — D-ADMIN-02 requires adding `User.status === 'SUSPENDED'` check + `403 ACCOUNT_SUSPENDED` response. Plan must flag this as PROTECTED-FILE-EDIT and call out the change in commit msg.
- **Refresh route** — same `User.status` check on cookie refresh.
- **Prisma migration** — D-ADMIN-02 (`User.status`) + D-PAY-01 (`Order.idempotencyKey @unique`) — single migration file `prisma/migrations/<timestamp>_phase-3-admin-orders/migration.sql`. Must run `pnpm db:push` (or `pnpm db:migrate:dev` per the package.json conventions).
- **Schema-push gate** (`/gsd-execute-phase` step 5.7) will detect this and inject a `[BLOCKING]` `pnpm db:push` task into the plan.

</code_context>

<specifics>
## Specific Ideas

- **`Idempotency-Key` storage** — column on `Order` (D-PAY-01), not Redis-only. Reasoning: keeps audit-trail in DB; admins can grep "this Idempotency-Key was used twice" in `AdminAction` queries; survives Redis flush.
- **CircuitBreaker hard-coded values** (D-PAY-02) — explicit tradeoff. Forks needing different thresholds patch the constants in `payments/circuit-breaker.ts`. Avoids env-toggle proliferation in v1.
- **`User.status` defaults to `ACTIVE`** — existing rows get the default; no data backfill needed.
- **Admin rate-limit** (D-ADMIN-05) is per-userId not per-IP. Reasoning: admins often share office IPs.
- **`make-superadmin` script logs an `AdminAction`** — even though it's a CLI invocation. Establishes that "every role-change has an audit row", no exception. Use a synthetic `actorId = self` (the user being promoted is also the actor).

</specifics>

<deferred>
## Deferred Ideas

- **Organizations routes (ORG-01..06)** — deferred indefinitely. Prisma models + `requireOrgRole` middleware kept as opt-in plumbing per CLAUDE.md "Multi-tenancy is opt-in". Forks needing multi-tenancy add `organizationId?` columns and route handlers per-project. Listed in `.planning/PROJECT.md` Out-of-Scope section.
- **Reset capability for `/api/admin/rate-limits`** — admin cannot clear a lockout in v1 (D-OBS-03). Future endpoint `DELETE /api/admin/rate-limits/:bucket/:key` would let an admin restore a locked-out user's access.
- **Per-action metadata schema enforcement** — D-AUDIT-02 ships free-form metadata. A future registry could type each action's metadata shape (`metadata.role-change.from: string`).
- **CircuitBreaker env-toggles** — D-PAY-02 hard-codes thresholds. Future `PAYMENT_BREAKER_FAILURE_THRESHOLD=`/`_WINDOW_MS=`/`_OPEN_MS=` env vars when patterns emerge.
- **Status flag richer states** — D-ADMIN-02 keeps `User.status = ACTIVE | SUSPENDED`. Future could add `PENDING_DELETION`, `LOCKED_OUT_OF_BAND`, etc.

</deferred>

---

*Phase: 03-admin-organizations-orders (directory name preserved for git history; phase title is now "Admin, Orders, Visibility" per ROADMAP.md after orgs deferral)*
*Context gathered: 2026-05-08 — 5 zones discussed, all defaults accepted by user*
