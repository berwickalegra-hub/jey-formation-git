---
phase: 02-oauth-notifications-withdrawal-pin
plan: 02
subsystem: notifications
tags: [notifications, api, cursor-pagination, csrf, prefs]
requires: [02-00]
provides: [NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04]
affects: []
tech-stack:
  added: []
  patterns: [keyset-pagination, double-submit-csrf, opt-out-prefs, opaque-cursor]
key-files:
  created:
    - frontend/src/app/api/notifications/route.ts
    - frontend/src/app/api/notifications/route.test.ts
    - frontend/src/app/api/notifications/count/route.ts
    - frontend/src/app/api/notifications/count/route.test.ts
    - frontend/src/app/api/notifications/prefs/route.ts
    - frontend/src/app/api/notifications/prefs/route.test.ts
  modified: []
decisions:
  - "D-13 cross-tenant silent ignore — PATCH where always scoped by userId; cross-tenant ids match 0 rows; status 200 (never 403/404 differentiate)"
  - "D-10 opt-out prefs — missing event types remain enabled; PATCH deep-merges via Wave 0 mergePrefs"
  - "D-07 opaque base64 cursor (createdAt + id composite) — survives ties via cuid lexicographic order"
metrics:
  duration: 626s
  tasks_completed: 3
  tests: 51 (35 new across 3 routes + 16 runtime-enforcement)
  files_created: 6
  completed_date: 2026-05-08
---

# Phase 02 Plan 02: Notifications Endpoints Summary

Cursor-paginated `GET /api/notifications`, idempotent mark-read `PATCH`, badge-count `GET /count`, and `GET/PATCH /prefs` shipped as 4 endpoints across 3 route files; all reuse Wave 0 helpers (`cursor.ts` + `prefs-merge.ts`) and bail-pattern middleware (`requireAuth`, `verifyCsrf`).

## What Shipped

**Endpoints:**
- `GET /api/notifications` (NOTIF-01) — `{ items: SerializedNotification[], nextCursor: string | null }`; opaque base64 cursor; `?unread=true` filter; `?limit` clamped to [1, 50] default 20; ISO 8601 serialization for `createdAt`/`readAt`
- `PATCH /api/notifications` (NOTIF-02) — `{ ids: string[] | 'all' }` → `{ updated, unreadCount }`; idempotent; cross-tenant ids match 0 rows silently (D-13); `verifyCsrf` + `requireAuth` gates
- `GET /api/notifications/count` (NOTIF-03) — `{ count }`; selective on `@@index([userId, readAt])`
- `GET /api/notifications/prefs` (NOTIF-04) — `{ prefs: NotificationPrefs }`; returns `{}` for users with no row (Wave 0 `isChannelEnabled` opt-out semantics handle the empty case)
- `PATCH /api/notifications/prefs` (NOTIF-04) — deep-merges via Wave 0 `mergePrefs` and upserts; missing event types stay enabled (D-10)

**All four route methods export `runtime = 'nodejs'`** (verified by `runtime-enforcement.test.ts` passing across all 3 new files).

## Cursor Pagination Contract

The opaque cursor is `base64(JSON({createdAt: ISO, id: cuid}))`. The route asks Prisma for `take = limit + 1`; if the result has more than `limit` rows there's another page, and `encodeCursor({ createdAt, id })` of the last visible row becomes `nextCursor`. The follow-up request decodes that cursor and adds:

```ts
OR: [
  { createdAt: { lt: cursor.createdAt } },
  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
]
```

so ties on `createdAt` (same millisecond) are disambiguated via the cuid's lexicographic order. The `@@index([userId, createdAt])` covers the query at O(limit). A malformed cursor decodes to `null` and falls back to the first page (T-02-NOTIF-CURSOR-INJECTION mitigation — Wave 0 `decodeCursor` is the parameter-typed boundary).

## D-13 Cross-tenant Silent Ignore (verified)

`PATCH` runs `prisma.notification.updateMany({ where: { id: { in: parsed.data.ids }, userId: ctx.user.sub, readAt: null }, data: { readAt: <Date> } })`. When the caller submits an id belonging to another user, the `userId` constraint silently filters it out — `count` returns 0, the response is `{ updated: 0, unreadCount: <unchanged> }`, status 200. **Never 403/404 differentiates** — that would leak id validity. Test 11 in `route.test.ts` verifies this exact contract.

## D-10 Opt-out Prefs Semantics (verified)

The prefs row stores ONLY user overrides; missing keys imply enabled. The `PATCH` flow is read-existing → `mergePrefs(existing, patch)` → upsert merged → return merged. Test 6 (`prefs/route.test.ts`) verifies that adding a new event type does not erase pre-existing untouched events; Test 9 verifies channel-level partial merge (`{ email: false }` over `{ email: true, inApp: true }` → `{ email: false, inApp: true }`). Last-write-wins on the row is the documented Pitfall 9 trade-off (T-02-NOTIF-PREFS-RACE — `accept` disposition).

## Threat Register Mitigations Applied

| Threat ID | Verified by |
|-----------|-------------|
| T-02-NOTIF-CROSS-TENANT | route.test.ts Test 11 (cross-tenant ids → updated:0, status 200) + every Prisma `where` includes `userId: auth.user.sub` (4 occurrences in route.ts, 1 in count, 4 in prefs) |
| T-02-CSRF-MISSING | route.test.ts Test 8 + prefs/route.test.ts Test 4 (missing header → 403, no Prisma calls) |
| T-02-NOTIF-CURSOR-INJECTION | Wave 0 `decodeCursor` returns null on malformed input → first-page fallback; cursor consumed only as typed input to Prisma `where` |
| T-02-NOTIF-LIMIT-DOS | route.test.ts Test 6 (`?limit=999` → take=51 (50+1)); `?limit=foo`/`-5`/`0` → take=21 (20+1) |
| T-02-NOTIF-PREFS-INJECT | prefs/route.test.ts Test 7 (`{ email: 'true' }` → 400 VALIDATION_FAILED, no upsert) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] exactOptionalPropertyTypes violations in test helpers**
- **Found during:** Verification (`pnpm typecheck`)
- **Issue:** Initial `makePatch()` helpers used `body: body === undefined ? undefined : JSON.stringify(body)`, which Next's `RequestInit` rejects under `exactOptionalPropertyTypes: true` (project tsconfig sets this strictly).
- **Fix:** Two-branch construction matching `verify-email/route.test.ts` (the closest existing pattern): one literal without `body`, one with `body: JSON.stringify(...)`. Same outcome, satisfies the strict type.
- **Files modified:** `route.test.ts`, `prefs/route.test.ts`
- **Commit:** ee5f2d7

**2. [Rule 1 - Bug] Prisma OR[i] union narrowing in cursor test**
- **Found during:** Verification (`pnpm typecheck`)
- **Issue:** `args?.where?.OR?.[0]?.createdAt?.lt` — Prisma generates `createdAt: DateTime | DateTimeFilter<...>` and `id: string | StringFilter<...>` for the recursive `WhereInput`, so `.lt` access fails type-narrowing.
- **Fix:** Cast each branch to `{ lt?: Date }` / `{ lt?: string }` after asserting the `OR` array shape — keeps the assertion semantics identical.
- **Files modified:** `route.test.ts`
- **Commit:** ee5f2d7

**3. [Rule 1 - Bug] mergePrefs argument shape mismatch in prefs route**
- **Found during:** Verification (`pnpm typecheck`)
- **Issue:** Zod under `exactOptionalPropertyTypes: true` infers `email?: boolean | undefined`, while `NotificationPrefs.ChannelPrefs` (Wave 0) uses `email?: boolean`. Structurally identical, nominally distinct.
- **Fix:** Cast `parsed.data.prefs as NotificationPrefs` at the call site, with a comment explaining the equivalence. Keeps Wave 0 helpers untouched.
- **Files modified:** `prefs/route.ts`
- **Commit:** ee5f2d7

All three deviations fall under Rule 1 (auto-fix bugs that prevent task completion — typecheck failure blocks CI). No deviations from the documented `<action>` block; only TypeScript-strictness adapter shims.

## Verification Results

```
✓ src/app/api/notifications/route.test.ts          (17 tests)
✓ src/app/api/notifications/count/route.test.ts    ( 5 tests)
✓ src/app/api/notifications/prefs/route.test.ts    (13 tests)
✓ src/lib/server/observability/runtime-enforcement (16 tests, all 3 new routes detected)
─────────────────────────────────────────────────────────────
  Test Files  4 passed (4)
       Tests  51 passed (51)

✓ pnpm typecheck   exit 0
✓ pnpm lint        exit 0
```

## Commits

| Hash    | Message                                                                  |
|---------|--------------------------------------------------------------------------|
| 1bb2555 | test(02-02): add failing tests for GET/PATCH /api/notifications          |
| 3817b69 | feat(02-02): implement GET/PATCH /api/notifications (NOTIF-01, NOTIF-02) |
| 2b831b3 | test(02-02): add failing tests for GET /api/notifications/count          |
| 3774e9a | feat(02-02): implement GET /api/notifications/count (NOTIF-03)           |
| 461068d | test(02-02): add failing tests for GET/PATCH /api/notifications/prefs    |
| f4ca429 | feat(02-02): implement GET/PATCH /api/notifications/prefs (NOTIF-04)     |
| ee5f2d7 | fix(02-02): satisfy exactOptionalPropertyTypes + Prisma narrowing        |

## Self-Check: PASSED

- frontend/src/app/api/notifications/route.ts — FOUND
- frontend/src/app/api/notifications/route.test.ts — FOUND
- frontend/src/app/api/notifications/count/route.ts — FOUND
- frontend/src/app/api/notifications/count/route.test.ts — FOUND
- frontend/src/app/api/notifications/prefs/route.ts — FOUND
- frontend/src/app/api/notifications/prefs/route.test.ts — FOUND
- Commit 1bb2555 — FOUND
- Commit 3817b69 — FOUND
- Commit 2b831b3 — FOUND
- Commit 3774e9a — FOUND
- Commit 461068d — FOUND
- Commit f4ca429 — FOUND
- Commit ee5f2d7 — FOUND
