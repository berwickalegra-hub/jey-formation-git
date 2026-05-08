# Phase 2: OAuth, Notifications, Withdrawal PIN — Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Three independent sub-systems, each delivering one logical capability:

1. **Google OAuth sign-in** (OAUTH-01..03) — `GET /api/auth/oauth/google/start` + `GET /api/auth/oauth/google/callback`. Issues the same 3-cookie session as email/password login (so downstream code is provider-agnostic). Inert without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`.
2. **In-app notifications API** (NOTIF-01..05) — `GET /api/notifications` (cursor-paginated, optionally `?unread=true`), `PATCH /api/notifications` (mark single/bulk/all as read), `GET /api/notifications/count` (unread badge), `GET /api/notifications/prefs` + `PATCH /api/notifications/prefs` (per-channel toggles).
3. **Withdrawal PIN management** (PIN-01) — `POST /api/auth/withdrawal-pin` (set / change), `DELETE /api/auth/withdrawal-pin` (remove). Hashed PIN stored in `User.withdrawalPinHash` (column already exists). Phase 4 withdrawals will gate on this.

**Out of scope:** OAuth providers other than Google (GitHub, Apple — Phase 6+ if needed); push notifications / SSE delivery (in-app + outbox-driven email only); PIN-protected withdrawal flow itself (Phase 4); notification retention / cleanup cron (Phase 5 cron drain).

</domain>

<decisions>
## Implementation Decisions

### OAuth — account-linking & provisioning

- **D-01:** **Auto-link silently when Google email matches an existing email/password user.** Create an `OAuthAccount` row linked to the existing `User`, then issue the standard 3 cookies. Justified because Google's `email_verified === true` is enforced at the callback (rejected otherwise), so the email is already proof-of-control. Same default as NextAuth, Stripe, Vercel. No "settings page" exists yet to require explicit linking; refusing here would create a dead-end for users who forgot they had a password account.
- **D-02:** **`emailVerifiedAt = now()` on first OAuth sign-in for a brand-new user.** Google's `email_verified` claim is the same proof we'd issue our own 8-char Crockford code to validate. Re-prompting our code adds friction with zero security gain. Standard industry behaviour.
- **D-03:** **Send a welcome notification on first OAuth account creation.** Use the existing `welcomeNotification(userId, email)` template from `frontend/src/lib/server/notifications/templates.ts` and dispatch through `createNotification(prisma, ...)` (NOT direct prisma write — see D-NOTIF-05). `dedupeKey = welcome:${userId}` guarantees at-most-once even if the OAuth callback retries.
- **D-04:** **Do NOT request `offline_access` and do NOT store Google's refresh token.** This is a sign-in flow, not a Google-API client; we re-issue our own access JWT via `/api/auth/refresh`. `OAuthAccount.refreshToken` stays `null`. If a future feature needs to call Google APIs off-session (Calendar/Drive), the column can be populated later (encrypt with `ENCRYPTION_KEY` at write time) — no migration needed.
- **D-05:** **Refuse `email_verified !== true` from Google.** Redirect to `/auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED`. This is the canonical anti-hijack invariant: an attacker creating an unverified Google account with the victim's email could otherwise auto-link via D-01.
- **D-06:** **Error redirect codes** (downstream agent must implement these literally so [auth-error.tsx](examples/frontend-pages/auth-error.tsx) can render messages):
  - `GOOGLE_EMAIL_NOT_VERIFIED` — Google returned `email_verified=false`
  - `OAUTH_STATE_MISMATCH` — state cookie missing or doesn't match callback `state`
  - `OAUTH_CODE_EXCHANGE_FAILED` — `arctic` raised an OAuth2RequestError
  - `OAUTH_PROVIDER_DISABLED` — `tryCreateGoogleProvider()` returned `undefined` at runtime (env missing)
  - `OAUTH_GENERIC` — fallback for anything else (log full error server-side via `logger.error`)

### Notifications — list API contract

- **D-07:** **Cursor-based pagination on `GET /api/notifications`.** Cursor is `base64(JSON.stringify({ createdAt, id }))` for tie-breaking on identical timestamps. Stable under live insertions (notifications keep arriving), no offset-shift bugs. Schema's `@@index([userId, createdAt])` is already optimised for this query. Response shape: `{ items: Notification[], nextCursor: string | null }`. `nextCursor === null` ⇒ no more items.
- **D-08:** **Page size: `?limit=20` default, `50` maximum.** `min(50, parseInt(limit) || 20)`. Standard for infinite-scroll lists (Twitter, GitHub).
- **D-09:** **Single filter param: `?unread=true`.** Maps to `where: { userId, readAt: null }` and uses the `@@index([userId, readAt])` cleanly. `?type` and `?since` are NOT in v1 — easy to add later (would need `[userId, type, createdAt]` index). Don't preemptively add filter complexity.
- **D-10:** **`NotificationPreferences.prefs` is an open-ended JSON map: `{ [eventType: string]: { email: boolean, inApp: boolean } }`.** The schema already declares `prefs Json @default("{}")`. The library applies defaults: missing event type ⇒ both channels enabled (safe default — opt-out, not opt-in). Adding a new event type never requires a migration. The downstream agent must NOT close this to an enum.

### Notifications — mark-as-read shape

- **D-11:** **Single endpoint: `PATCH /api/notifications` with body `{ ids: string[] | 'all' }`.** PATCH = partial update of the collection. Single-item case is just `{ ids: [id] }`. `{ ids: 'all' }` marks every unread notification for `ctx.userId`. Mutating endpoint ⇒ requires `verifyCsrf` + `requireAuth`. Body validated with Zod.
- **D-12:** **Idempotent — `200 { updated: 0, unreadCount: ... }` if all IDs already read.** Implementation: `prisma.notification.updateMany({ where: { id: { in: ids }, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } })` returns `{ count }`. The frontend can spam mark-read without surfacing errors.
- **D-13:** **Silent ignore on cross-tenant IDs.** The `where` clause includes `userId: ctx.userId`, so passing another user's notification id simply matches nothing — `count` remains 0. Do NOT 403/404 — that would leak existence of valid IDs in other accounts (enumeration).
- **D-14:** **Return `{ updated: <count>, unreadCount: <freshCount> }`.** Saves the round-trip to `GET /api/notifications/count` after every mark-read. The `COUNT(*) WHERE userId AND readAt IS NULL` is selective on the existing `[userId, readAt]` index.

### Claude's Discretion — Withdrawal PIN

PIN security model not deep-dived during discussion. The downstream agents (researcher + planner) should adopt these defaults; flag any deviation in RESEARCH.md.

- **CD-01:** **PIN bcrypt cost = 12 (same as password).** 4-6 digit PINs have low entropy (6 digits = ~20 bits) — bcrypt cost 12 is the minimum that makes brute-force pricey. Lower costs (e.g. 10) save ~70ms per verify but expose the hash to offline crack via cheap GPUs.
- **CD-02:** **Shared lockout with login** — reuse `frontend/src/lib/server/auth/lockout.ts` (Redis sliding-window) keyed on `pin:${userId}`. Threshold = `AUTH_LOCKOUT_THRESHOLD` (5), duration = `AUTH_LOCKOUT_DURATION_MIN` (15 min). PIN failures shouldn't share the same counter as login because withdrawing != signing in (different blast radius).
- **CD-03:** **PIN change requires `currentPin` in body.** Zod schema: `{ currentPin: z.string().regex(/^\d{4,6}$/), newPin: z.string().regex(/^\d{4,6}$/) }`. Without `currentPin`, return `400 PIN_REQUIRED`. With wrong `currentPin`, return `400 PIN_INVALID` (stable code; do NOT leak via timing — bcrypt-compare unconditionally).
- **CD-04:** **PIN reset = out of scope for Phase 2.** If a user forgets their PIN, the path is "log in with email/password (or OAuth) → DELETE /api/auth/withdrawal-pin → POST a new one". No "forgot PIN" flow — Phase 4 withdrawals can refuse on `withdrawalPinHash IS NULL` and the user re-creates one. Document in 02-RESEARCH.md as a known gap to revisit if support tickets demand otherwise.

### Carry-over from prior phases (locked, do not re-discuss)

- All Phase 0 conventions: `runtime='nodejs'`, `withRequestContext`, `instrumentation.ts` boot order, `server-only` import.
- **D-Phase1-01 → D-Phase1-05:** route handler boilerplate, CSRF on mutations, `requireAuth` on authed reads, Zod validation, stable error codes. Apply unchanged.
- **D-Phase1-21:** cookie attributes — every cookie set in this phase MUST use `httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax'`, with the same `<COOKIE_PREFIX>-*` naming. OAuth state/PKCE cookies use `path: '/api/auth/oauth'` and `maxAge: 5 * 60` per OAUTH-01.
- **D-Phase1-17:** ALL emails go through the **outbox** (`enqueueOutbox(tx, event)` inside the same Prisma tx), never `resend.emails.send()` directly. The outbox dispatcher cron drains in Phase 5 — Phase 2 email events stay queued until then. This is fine: in-app notifications work in real time; emails are async by design.
- **D-Phase1-25:** Mock Prisma in unit tests. Co-located `route.test.ts`. Use `frontend/src/test-utils/prisma-mock.ts` and `frontend/src/test-utils/mock-cookies.ts`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` §"Phase 2: OAuth, Notifications, Withdrawal PIN" — goal + 4 success criteria + requirement IDs
- `.planning/REQUIREMENTS.md` §"OAuth", §"Withdrawal PIN", §"Notifications" — OAUTH-01..03, NOTIF-01..05, PIN-01

### Existing scaffolding the phase must build on top of
- `frontend/src/lib/server/oauth/google.ts` — `tryCreateGoogleProvider()`, env-gated arctic Google client. Already implements the env-gated boot pattern.
- `frontend/src/lib/server/oauth/index.ts` — barrel export
- `frontend/src/lib/server/notifications/index.ts` — `createNotification(prisma, input)` with `P2002` dedup catch (NOTIF-05 invariant)
- `frontend/src/lib/server/notifications/templates.ts` — `welcomeNotification`, `paymentReceived` factory pattern
- `frontend/src/lib/server/outbox/index.ts` + `frontend/src/lib/server/outbox/dispatcher.ts` — outbox enqueue + drain (drain runs in Phase 5)
- `frontend/src/lib/server/outbox/types.ts` — `OutboxEvent` discriminated union; emails added in Phase 1 (`email.verification_code`, `email.password_reset`)
- `frontend/src/lib/server/auth.ts` — `setAuthCookies`, `setCsrfCookie`, `clearAuthCookies`. **Do NOT modify.** OAuth callback uses these unchanged.
- `frontend/src/lib/server/auth/lockout.ts` — Redis sliding-window for shared PIN lockout (CD-02)
- `frontend/src/lib/server/middleware/index.ts` — `requireAuth`, `verifyCsrf` HOFs

### Prisma models (already in schema)
- `frontend/prisma/schema.prisma` §`model OAuthAccount` — `[provider, providerAccountId]` unique + `userId` FK
- `frontend/prisma/schema.prisma` §`model Notification` — `dedupeKey @unique`, `[userId, readAt]`, `[userId, createdAt]` indexes
- `frontend/prisma/schema.prisma` §`model NotificationPreferences` — `prefs Json @default("{}")` per D-10
- `frontend/prisma/schema.prisma` §`model User.withdrawalPinHash` — already nullable, ready to use

### Prior decisions referenced
- `.planning/phases/00-foundation/00-CONTEXT.md` — Phase 0 boot decisions
- `.planning/phases/01-auth-routes/01-CONTEXT.md` — D-01..D-28 (boilerplate, CSRF, zod, error codes, cookies, outbox, test pattern)

### Frontend reference page (do not modify in Phase 2)
- `examples/frontend-pages/auth-error.tsx` — must accept `?code=` matching D-06 codes; downstream UI phases consume

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tryCreateGoogleProvider()` — already env-gated (returns undefined when env missing). The route handler imports it once at module-load and 404s when undefined. No new env-gate logic needed.
- `createNotification(prisma, input)` — handles `P2002` for at-most-once dedup. Welcome notif (D-03) calls this directly. The downstream agent should NOT add an alternative path.
- `setAuthCookies` + `setCsrfCookie` — OAuth callback success branch calls these the same way `verify-email` does. Cookies are identical (no provider-specific shape).
- `frontend/src/lib/server/auth/lockout.ts` — Redis sliding-window with memory fallback. PIN lockout (CD-02) uses the same primitive keyed on `pin:${userId}`.
- `frontend/src/lib/server/zod-helpers.ts` — shared error formatter; OAuth callback / notifications / PIN routes all use this for `400 VALIDATION_FAILED`.

### Established Patterns
- **Env-gated providers** — same pattern as Bictorys / R2 / Resend / OAuth Google: feature 404s at the route layer when env is absent. Phase 2 follows this for the OAuth callback (`OAUTH_PROVIDER_DISABLED` → `/auth/error?code=...`).
- **Outbox for async work** — emails go through `enqueueOutbox` inside the same Prisma tx. Phase 2 OAuth welcome flow doesn't need to email (D-03 is in-app only); Phase 2 notification preferences endpoint doesn't trigger emails directly.
- **`runtime='nodejs'` enforcement** — the runtime-enforcement test in `frontend/src/lib/server/observability/runtime-enforcement.test.ts` will FAIL if any Phase 2 route forgets the export. Downstream agent: add `export const runtime = 'nodejs'` as line 1 of every new route.
- **Co-located route tests** — `route.test.ts` next to `route.ts`. Mock Prisma via `frontend/src/test-utils/prisma-mock.ts`. Mock `cookies()` via `frontend/src/test-utils/mock-cookies.ts`.

### Integration Points
- **OAuth callback ↔ existing auth cookie issuance** — the success branch of `oauth/google/callback/route.ts` calls `setAuthCookies(...)` from `lib/server/auth.ts`. Identical to `verify-email/route.ts` lines 139-146.
- **Notifications list ↔ existing pagination/auth pattern** — uses `requireAuth` for the user-scoped query. No CSRF on GET.
- **Mark-as-read ↔ outbox** — D-14 adds `unreadCount` to the response. No outbox event needed (in-app state change only).
- **PIN endpoints ↔ withdrawal route (Phase 4)** — Phase 4 withdrawals will read `User.withdrawalPinHash`. Phase 2 only manages the column; nothing else changes.

</code_context>

<specifics>
## Specific Ideas

- **OAuth state cookie name** — use `<COOKIE_PREFIX>-oauth-state` and `<COOKIE_PREFIX>-oauth-pkce` to keep the namespacing consistent.
- **OAuth callback `?next=` param** — accept an optional `next` URL parameter on `/start` (echoed via state cookie) so post-login redirect lands on the originating page. Validate it's same-origin (`new URL(next, APP_URL).origin === APP_URL`) — never redirect to an external URL even if signed.
- **Notifications response timestamp format** — return `Notification.createdAt` as ISO 8601 string (matches the rest of the API; no Unix-ms cleverness).
- **Page size enforcement happens server-side, not client-side** — `Math.min(50, parseInt(query.limit) || 20)`. Returning 400 on `limit=51` would be hostile to legacy clients.

</specifics>

<deferred>
## Deferred Ideas

- **GitHub / Apple OAuth providers** — Phase 6 if needed. The `oauth/` lib directory is structured to accept additional `provider.ts` files alongside `google.ts`.
- **Server-Sent Events for live notifications** — out of scope for v1. In-app polling is fine for the starter; a future "realtime" phase can add SSE on top of the same data model.
- **Notification retention / cleanup cron** — Phase 5 cron `notifications-cleanup` could prune `readAt > 90 days old`. Not implemented in Phase 2.
- **`?type=` and `?since=` filters on notifications list** — easy to add later if a project needs them; would require an additional `[userId, type, createdAt]` index.
- **Forgot PIN flow** — out of scope (CD-04). User can DELETE + re-set if they forget.
- **OAuth session linking from settings page** — there is no settings page yet. When one lands, "link / unlink Google" becomes a UI on top of `OAuthAccount` rows.

</deferred>

---

*Phase: 02-oauth-notifications-withdrawal-pin*
*Context gathered: 2026-05-08*
