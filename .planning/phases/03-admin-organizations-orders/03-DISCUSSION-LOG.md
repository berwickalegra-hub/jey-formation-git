# Phase 3: Admin, Orders, Visibility — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 03-admin-organizations-orders (directory) / Admin, Orders, Visibility (post-org-removal title)
**Areas discussed:** Org membership flow (zone 1, dropped), Orders & circuit breaker (zone 2), Admin ACL granularity (zone 3), Pagination + search (zone 4), Audit log + visibility (zone 5)

---

## Pre-discussion scope reduction

User indicated mid-discussion that organizations are out of scope for the boilerplate. Decision recorded:
- **8 `/api/organizations/*` route handlers NOT shipped in v1**
- Prisma models `Organization` + `OrganizationMember` and `requireOrgRole` middleware kept as opt-in plumbing
- `ORG-01..06` requirements moved from active phase to PROJECT.md `Out of Scope` section
- ROADMAP.md Phase 3 retitled "Admin, Orders, Visibility" with reduced requirement list (11 IDs from 17)
- Committed: `64c7207 docs(03): drop organizations from phase 3 scope (deferred opt-in)`

Zone 1 questions (org invitation flow, ownership transfer, etc.) were therefore not asked.

---

## Zone 2 — Orders & Circuit Breaker

| Q | Question | Options Presented | Selected |
|---|----------|-------------------|----------|
| Q2.1 | Idempotence of `POST /api/orders` | (1) `Idempotency-Key` header obligatoire + `Order.idempotencyKey @unique` (Stripe pattern) — RECOMMENDED / (2) IK optional / (3) No IK, UI debouncer only | (1) ✓ |
| Q2.2 | IK storage + TTL | (1) Prisma column durable — RECOMMENDED / (2) Redis only with 24h TTL / (3) Both | (1) ✓ |
| Q2.3 | CircuitBreaker thresholds | (1) failureThreshold=5 / windowMs=30000 / openMs=60000 — RECOMMENDED / (2) 10/60000/30000 (laxer) / (3) Configurable via env with (1) defaults | (1) ✓ |
| Q2.4 | Guest checkout (Order.userId nullable) | (1) Auth required v1 — RECOMMENDED / (2) Guest allowed / (3) Auth-default with env opt-in | (1) ✓ |
| Q2.5 | Body shape | (1) `{ amount, currency?, customerEmail?, customerPhone?, customerName?, metadata? }` — RECOMMENDED / (2) Strict required currency + nested customerContact / (3) Discuss | (1) ✓ |

**User's choice:** `defaults` (all recommended)
**Notes:** Stripe-grade idempotency was the deciding factor for Q2.1+Q2.2. Hard-coded breaker thresholds (Q2.3 option 1) preferred over env-toggle proliferation in v1.

---

## Zone 3 — Admin ACL granularity

| Q | Question | Options Presented | Selected |
|---|----------|-------------------|----------|
| Q3.1 | `PATCH /api/admin/withdrawals/:id/cancel` ACL | (1) SUPERADMIN-only — RECOMMENDED (financial-sensitive) / (2) ADMIN suffices | (1) ✓ |
| Q3.2 | User status flag (ban/unban) | (1) No status flag in v1 / (2) Add `User.status = ACTIVE \| SUSPENDED` + endpoint, ADMIN can suspend, SUPERADMIN restores — RECOMMENDED / (3) Defer to later phase | (2) ✓ |
| Q3.3 | Listings PII gating | (1) ADMIN sees PII — RECOMMENDED / (2) ADMIN sees summary, SUPERADMIN sees PII / (3) Audit each PII view | (1) ✓ |
| Q3.4 | `/api/admin/me` shape | (1) `{ role, can: [...] }` — RECOMMENDED / (2) `{ role }` only / (3) Use `/api/auth/me` instead | (1) ✓ |
| Q3.5 | Rate-limit on admin endpoints | (1) None / (2) 100 req/min per admin userId — RECOMMENDED / (3) Per-endpoint custom | (2) ✓ |

**User's choice:** `defaults` (all recommended)
**Notes:** Q3.2 introduces a Prisma migration for `User.status` and requires modifying the PROTECTED `frontend/src/app/api/auth/login/route.ts` to refuse logins when status === SUSPENDED. CONTEXT.md flags this for explicit user-confirmation before the planner edits the protected file.

---

## Zone 4 — Pagination + search

| Q | Question | Options Presented | Selected |
|---|----------|-------------------|----------|
| Q4.1 | Pagination model | (1) Cursor-based (reuse `notifications/cursor.ts`) — RECOMMENDED / (2) Offset+limit / (3) Hybrid | (1) ✓ |
| Q4.2 | `?q=...` on `/api/admin/users` | (1) `LIKE '%q%'` on email + name (case-insensitive) — RECOMMENDED / (2) Postgres FTS / (3) Exact email match | (1) ✓ |
| Q4.3 | Filters + sort | (1) Simple per-resource + `createdAt DESC` — RECOMMENDED / (2) Rich multi-key + configurable sort / (3) Minimal | (1) ✓ |
| Q4.4 | Page size | (1) Default 20 / max 50 (matches Phase 2) — RECOMMENDED / (2) Default 50 / max 100 / (3) Configurable via env | (1) ✓ |
| Q4.5 | Empty result | (1) `200 { items: [], nextCursor: null }` — RECOMMENDED / (2) `404 NO_RESULTS` | (1) ✓ |

**User's choice:** `defaults` (all recommended)
**Notes:** Consistency with Phase 2 notifications drives all 5 picks — single cursor format, single page-size convention, single empty-listing shape.

---

## Zone 5 — Audit log + visibility

| Q | Question | Options Presented | Selected |
|---|----------|-------------------|----------|
| Q5.1 | Audit-log filters | (1) `?actor` + `?action` + `?targetType` + `?since` + `?until` — RECOMMENDED / (2) (1) + `?targetId` + `?ip` / (3) Minimal `?actor` + `?since` | (1) ✓ |
| Q5.2 | `AdminAction.metadata` shape | (1) Free per-action — RECOMMENDED / (2) Schema-enforced registry / (3) Always full diff before/after | (1) ✓ |
| Q5.3 | `/api/admin/outbox` columns | (1) All `OutboxEvent` fields — RECOMMENDED / (2) Public fields only (mask payload) / (3) Status summary only | (1) ✓ |
| Q5.4 | `/api/admin/email-queue` body field | (1) All fields, body truncated to 200 chars — RECOMMENDED / (2) Full body / (3) Status summary | (1) ✓ |
| Q5.5 | `/api/admin/rate-limits` capability | (1) Read-only summary v1 — RECOMMENDED / (2) Full Redis dump / (3) Summary + reset endpoint | (1) ✓ |

**User's choice:** `defaults` (all recommended)
**Notes:** Read-only visibility in v1 is the conservative starting point. Reset capability deferred to a future phase (captured in CONTEXT.md `<deferred>`).

---

## Claude's Discretion

The following were not discussed and Claude has flexibility:
- URL shapes within `/api/admin/*` (REST conventions)
- File organization under `frontend/src/app/api/admin/` (subdirs vs flat)
- Test fixtures and helpers (reuse Phase 1/2 patterns)
- Whether to extract a small `paginate.ts` helper from cursor.ts to share across admin listings

## Deferred Ideas

- Organizations routes (ORG-01..06) — kept as opt-in plumbing
- `DELETE /api/admin/rate-limits/:bucket/:key` reset endpoint
- Per-action metadata schema enforcement
- CircuitBreaker env-toggle configuration
- Richer `User.status` states (PENDING_DELETION, etc.)
