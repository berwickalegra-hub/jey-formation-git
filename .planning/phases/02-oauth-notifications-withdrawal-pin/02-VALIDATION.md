---
phase: 02
slug: oauth-notifications-withdrawal-pin
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 |
| **Config file** | `frontend/vitest.config.ts` (passWithNoTests, setupFiles=[./vitest.setup.ts], `server-only` aliased to empty stub) |
| **Quick run command** | `pnpm --filter frontend exec vitest run <changed-file.test.ts>` |
| **Full suite command** | `pnpm --filter frontend test` |
| **Estimated runtime** | ~30 seconds full suite (single-route < 5 s) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter frontend exec vitest run <changed-route>/route.test.ts`
- **After every plan wave:** Run `pnpm --filter frontend test` (includes `runtime-enforcement.test.ts` walk over `app/api/**/route.ts`)
- **Before `/gsd-verify-work`:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` (all four exit 0 — per CLAUDE.md)
- **Max feedback latency:** 5 seconds per task; 30 seconds per wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-W0-01 | 00 | 0 | OAUTH-03 | T-02-OAUTH-OPEN-REDIRECT | All five D-06 codes build `Location: /auth/error?code=<UPPERCASE>` URL; `?next=` rejected if not same-origin | unit | `pnpm --filter frontend exec vitest run src/lib/server/oauth/error-redirect.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-02 | 00 | 0 | NOTIF-01 | — | Cursor `{createdAt, id}` round-trips encode → decode losslessly | unit | `pnpm --filter frontend exec vitest run src/lib/server/notifications/cursor.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-03 | 00 | 0 | NOTIF-04 | — | Deep-merge of prefs JSON: overwrite scalars, additive nested keys, missing keys remain enabled (opt-out) | unit | `pnpm --filter frontend exec vitest run src/lib/server/notifications/prefs-merge.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-04 | 00 | 0 | PIN-01 | T-02-PIN-BRUTE | `bcrypt.hash(pin, 12)` and `bcrypt.compare` round-trip; cost matches `auth.ts` | unit | `pnpm --filter frontend exec vitest run src/lib/server/auth/pin.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-01 | 01 | 1 | OAUTH-01 | T-02-OAUTH-STATE-REPLAY | `GET /start` issues state + PKCE-verifier cookies (path `/api/auth/oauth`, maxAge 300, httpOnly) and 302 to Google authorize URL | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/oauth/google/start/route.test.ts` | ❌ W1 | ⬜ pending |
| 02-01-02 | 01 | 1 | OAUTH-01 | — | Returns 404 silently when `tryCreateGoogleProvider()` undefined (env missing) | unit | same file | ❌ W1 | ⬜ pending |
| 02-01-03 | 01 | 1 | OAUTH-02 | T-02-OAUTH-STATE-REPLAY | Callback rejects state mismatch → 302 `/auth/error?code=OAUTH_STATE_MISMATCH` | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/oauth/google/callback/route.test.ts` | ❌ W1 | ⬜ pending |
| 02-01-04 | 01 | 1 | OAUTH-02 | T-02-OAUTH-UNVERIFIED-EMAIL | Callback rejects `email_verified=false` → `?code=GOOGLE_EMAIL_NOT_VERIFIED` (no cookies issued) | unit | same file | ❌ W1 | ⬜ pending |
| 02-01-05 | 01 | 1 | OAUTH-02 | — | Callback links to existing email/password user (D-01) — creates `OAuthAccount` row, no new `User`, name/avatar untouched | unit | same file | ❌ W1 | ⬜ pending |
| 02-01-06 | 01 | 1 | OAUTH-02 | — | Callback creates brand-new user (D-02): `emailVerifiedAt` set, name/avatar populated, welcome notif inserted via `createNotification` | unit | same file | ❌ W1 | ⬜ pending |
| 02-01-07 | 01 | 1 | OAUTH-02 | — | Callback issues 3 standard cookies on success (mirrors `verify-email`) | unit | same file | ❌ W1 | ⬜ pending |
| 02-01-08 | 01 | 1 | OAUTH-02 / NOTIF-05 | — | Welcome path goes through `createNotification(...)` (no direct `prisma.notification.create`) | static | grep + unit assertion in callback test | ❌ W1 | ⬜ pending |
| 02-02-01 | 02 | 1 | NOTIF-01 | — | `GET /api/notifications` returns paginated `{items, nextCursor}`; `nextCursor` null at end | unit | `pnpm --filter frontend exec vitest run src/app/api/notifications/route.test.ts` | ❌ W1 | ⬜ pending |
| 02-02-02 | 02 | 1 | NOTIF-01 | — | `?unread=true` filter applies `readAt: null`; `?limit=` clamped to [1, 50] | unit | same file | ❌ W1 | ⬜ pending |
| 02-02-03 | 02 | 1 | NOTIF-02 | T-02-NOTIF-CROSS-TENANT | `PATCH` with `{ ids: [id] }` → `updated: 1` and unread count decremented; cross-tenant IDs silently ignored (`updated: 0`) | unit | same file | ❌ W1 | ⬜ pending |
| 02-02-04 | 02 | 1 | NOTIF-02 | — | `PATCH` with `{ ids: 'all' }` → marks all unread for `userId` | unit | same file | ❌ W1 | ⬜ pending |
| 02-02-05 | 02 | 1 | NOTIF-02 | T-02-CSRF-MISSING | `PATCH` without `x-csrf-token` header → 403 (verifyCsrf bail) | unit | same file | ❌ W1 | ⬜ pending |
| 02-02-06 | 02 | 1 | NOTIF-03 | — | `GET /api/notifications/count` returns `{count: <n>}` | unit | `pnpm --filter frontend exec vitest run src/app/api/notifications/count/route.test.ts` | ❌ W1 | ⬜ pending |
| 02-02-07 | 02 | 1 | NOTIF-04 | — | `GET /prefs` returns `{prefs: {}}` (defaults) for users with no row | unit | `pnpm --filter frontend exec vitest run src/app/api/notifications/prefs/route.test.ts` | ❌ W1 | ⬜ pending |
| 02-02-08 | 02 | 1 | NOTIF-04 | — | `PATCH /prefs` deep-merges and persists; missing event types remain enabled (opt-out semantics) | unit | same file | ❌ W1 | ⬜ pending |
| 02-03-01 | 03 | 1 | PIN-01 | T-02-PIN-BRUTE | `POST /api/auth/withdrawal-pin` with no existing hash → sets bcrypt hash on `User.withdrawalPinHash` | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/withdrawal-pin/route.test.ts` | ❌ W1 | ⬜ pending |
| 02-03-02 | 03 | 1 | PIN-01 | T-02-PIN-BRUTE | `POST` with existing hash + correct `currentPin` → updates hash; `recordSuccess` clears lockout | unit | same file | ❌ W1 | ⬜ pending |
| 02-03-03 | 03 | 1 | PIN-01 | T-02-PIN-TIMING | `POST` with existing hash + wrong `currentPin` → 400 `PIN_INVALID`; `recordFailure` increments; bcrypt compare runs even on path mismatch | unit | same file | ❌ W1 | ⬜ pending |
| 02-03-04 | 03 | 1 | PIN-01 | T-02-PIN-BRUTE | `POST` while locked-out → 423 `LOCKED_OUT` (no bcrypt compare runs) | unit | same file | ❌ W1 | ⬜ pending |
| 02-03-05 | 03 | 1 | PIN-01 | — | `DELETE` clears `withdrawalPinHash` to null | unit | same file | ❌ W1 | ⬜ pending |
| 02-03-06 | 03 | 1 | PIN-01 | T-02-CSRF-MISSING | All three (POST set, POST change, DELETE) require auth + CSRF (verifyCsrf 403 without header) | unit | same file | ❌ W1 | ⬜ pending |
| 02-INV-01 | (all) | 1 | Phase 0 invariant | — | All new route files export `runtime='nodejs'` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/src/lib/server/oauth/error-redirect.ts` + `error-redirect.test.ts` — D-06 codes → `/auth/error?code=` URL builder; same-origin `?next=` validation
- [ ] `frontend/src/lib/server/notifications/cursor.ts` + `cursor.test.ts` — encode/decode `{ createdAt, id }` cursor (D-07); round-trip test
- [ ] `frontend/src/lib/server/notifications/prefs-merge.ts` + `prefs-merge.test.ts` — deep-merge JSON map (D-10); pure-function test (overwrite + additive + nested toggles)
- [ ] `frontend/src/lib/server/auth/pin.ts` + `pin.test.ts` — `bcrypt.hash(pin, 12)` + `bcrypt.compare`; centralizes cost-12 pairing with `auth.ts`
- [x] No new framework install — Vitest already configured for node + server-only stub
- [x] No vitest.setup.ts changes — JWT_SECRET / ENCRYPTION_KEY fixtures from Phase 1 sufficient

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end Google OAuth handshake against real Google authorization server | OAUTH-01 / OAUTH-02 | Requires real Google OAuth client + browser redirect; cannot stub OAuth server in unit test | Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` in `.env.local`, hit `GET /api/auth/oauth/google/start` from browser, complete consent, confirm cookies issued and welcome notification appears |
| Production cookie `Secure` flag propagation | OAUTH-02 | `NODE_ENV=production` only path | Deploy to Vercel preview, inspect response cookies for `Secure` attribute |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (4 helpers above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5 s per task, < 30 s per wave
- [ ] `nyquist_compliant: true` set in frontmatter (after planner consumption)

**Approval:** pending
