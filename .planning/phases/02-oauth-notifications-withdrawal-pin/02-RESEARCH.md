# Phase 2: OAuth, Notifications, Withdrawal PIN — Research

**Researched:** 2026-05-08
**Domain:** OAuth 2.0 + OIDC (Google), notification CRUD, PIN credential management
**Confidence:** HIGH

## Summary

Phase 2 ships three independent capability slices on top of the Phase 1 auth foundation:

1. **Google OAuth sign-in** — two route handlers (`/start`, `/callback`) wrapping the already-shipped `tryCreateGoogleProvider()` from `frontend/src/lib/server/oauth/google.ts`. The lib helper exposes `arctic@3.7.0`'s `Google` client + `decodeIdToken()`. Routes must implement the state/PKCE cookie dance, redirect flow, find-or-create user logic with email-based account linking, and reuse `setAuthCookies` + `setCsrfCookie` from `auth.ts` so OAuth and email/password sessions are byte-identical downstream.

2. **In-app notifications API** — five GET/PATCH endpoints over the existing `Notification` + `NotificationPreferences` Prisma models. Cursor pagination on the existing `[userId, createdAt]` index, idempotent mark-read via `updateMany`, JSON-blob preferences with opt-out-by-default semantics. All flows compose `requireAuth` + (mutations only) `verifyCsrf`. Notification creation MUST go through `createNotification(prisma, …)` — the Phase 0 invariant.

3. **Withdrawal PIN** — `POST` (set/change) and `DELETE` on `/api/auth/withdrawal-pin`. PIN bcrypt-hashed at cost 12 stored on `User.withdrawalPinHash` (column already in schema). Reuses `lockout.ts` Redis sliding-window primitives keyed on `pin:${userId}`.

**Primary recommendation:** Plan as **3 parallel-eligible plans behind a single Wave 0 of shared helpers** (request-context wrapping, error-redirect helper, Zod schemas). All three sub-systems touch independent route paths and Prisma models — they can run in parallel after Wave 0 lands. Total: roughly 8 new route files, ~5 new lib helpers, ~12 test files. Every route handler MUST be `runtime='nodejs'` (Phase 0 enforcement test will fail otherwise).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**OAuth — account-linking & provisioning:**
- **D-01:** Auto-link silently when Google email matches an existing email/password user. Create an `OAuthAccount` row linked to the existing `User`, then issue the standard 3 cookies. Justified because Google's `email_verified === true` is enforced at the callback (rejected otherwise).
- **D-02:** `emailVerifiedAt = now()` on first OAuth sign-in for a brand-new user. Google's `email_verified` claim is the same proof we'd issue our own 8-char Crockford code to validate.
- **D-03:** Send a welcome notification on first OAuth account creation. Use `welcomeNotification(userId, email)` from `frontend/src/lib/server/notifications/templates.ts` and dispatch through `createNotification(prisma, …)`. `dedupeKey = welcome:${userId}` guarantees at-most-once.
- **D-04:** Do NOT request `offline_access` and do NOT store Google's refresh token. `OAuthAccount.refreshToken` stays `null`.
- **D-05:** Refuse `email_verified !== true` from Google. Redirect to `/auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED`.
- **D-06:** Error redirect codes: `GOOGLE_EMAIL_NOT_VERIFIED`, `OAUTH_STATE_MISMATCH`, `OAUTH_CODE_EXCHANGE_FAILED`, `OAUTH_PROVIDER_DISABLED`, `OAUTH_GENERIC`.

**Notifications — list API contract:**
- **D-07:** Cursor-based pagination on `GET /api/notifications`. Cursor is `base64(JSON.stringify({ createdAt, id }))`. Response shape: `{ items: Notification[], nextCursor: string | null }`.
- **D-08:** Page size: `?limit=20` default, `50` maximum. `Math.min(50, parseInt(limit) || 20)`.
- **D-09:** Single filter param: `?unread=true`. Maps to `where: { userId, readAt: null }` and uses the `@@index([userId, readAt])`.
- **D-10:** `NotificationPreferences.prefs` is an open-ended JSON map: `{ [eventType: string]: { email: boolean, inApp: boolean } }`. Missing event type ⇒ both channels enabled (opt-out, not opt-in). NEVER close to an enum.

**Notifications — mark-as-read shape:**
- **D-11:** Single endpoint: `PATCH /api/notifications` with body `{ ids: string[] | 'all' }`. Requires `verifyCsrf` + `requireAuth`. Body validated with Zod.
- **D-12:** Idempotent — `200 { updated: 0, unreadCount: ... }` if all IDs already read.
- **D-13:** Silent ignore on cross-tenant IDs. The `where` includes `userId: ctx.userId`; passing another user's id matches nothing. Do NOT 403/404.
- **D-14:** Return `{ updated: <count>, unreadCount: <freshCount> }`. Saves the round-trip.

**Withdrawal PIN — Claude's discretion (adopted as defaults):**
- **CD-01:** PIN bcrypt cost = 12 (same as password).
- **CD-02:** Shared lockout primitive (lockout.ts) but **separate counter key** `pin:${userId}` — different blast radius from login.
- **CD-03:** PIN change requires `currentPin` in body. Zod: `{ currentPin: z.string().regex(/^\d{4,6}$/), newPin: z.string().regex(/^\d{4,6}$/) }`. Wrong `currentPin` returns `400 PIN_INVALID` (bcrypt-compare unconditionally).
- **CD-04:** PIN reset = out of scope for Phase 2. Forgot-PIN path = log in → `DELETE` → `POST` again.

**Carry-over from prior phases (locked):**
- All Phase 0 conventions: `runtime='nodejs'`, `withRequestContext`, `instrumentation.ts` boot order, `server-only` import.
- Phase 1 D-01..D-28: route handler boilerplate, CSRF on mutations, `requireAuth` on authed reads, Zod validation, stable error codes.
- D-Phase1-21: cookie attributes — `httpOnly: true, secure: NODE_ENV==='production', sameSite: 'lax'`, `<COOKIE_PREFIX>-*` naming. OAuth state/PKCE cookies use `path: '/api/auth/oauth'` and `maxAge: 5 * 60`.
- D-Phase1-25: Mock Prisma in unit tests via `frontend/src/test-utils/prisma-mock.ts`; mock cookies via `frontend/src/test-utils/mock-cookies.ts`. Co-located `route.test.ts`.

### Claude's Discretion

- OAuth state cookie name: `<COOKIE_PREFIX>-oauth-state` and `<COOKIE_PREFIX>-oauth-pkce`.
- OAuth `?next=` param: optional, echoed via state cookie, validated same-origin (`new URL(next, APP_URL).origin === APP_URL`).
- Notifications response: `Notification.createdAt` as ISO 8601 string.
- Page size enforcement: server-side clamp, never 400 on `limit=51`.

### Deferred Ideas (OUT OF SCOPE)

- GitHub / Apple OAuth providers (Phase 6+).
- Server-Sent Events / push notifications (in-app + outbox-driven email only).
- Notification retention / cleanup cron (Phase 5).
- `?type=` and `?since=` filters on notifications list.
- Forgot-PIN flow (CD-04).
- OAuth session linking from settings page (no settings page yet).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OAUTH-01 | `GET /start` issues state+PKCE cookies + 302 to Google | `arctic` `Google.createAuthorizationURL(state, codeVerifier, scopes)` + `generateState()` + `generateCodeVerifier()` (verified in `node_modules/arctic/dist/oauth2.d.ts:15-16`). Pattern in OAuth Start Sequence below. |
| OAUTH-02 | Callback validates state, exchanges code, refuses unverified email, finds-or-creates user, issues 3 cookies | `Google.validateAuthorizationCode(code, codeVerifier)` returns `OAuth2Tokens`; ID token at `tokens.idToken()` per arctic v3 API. `decodeIdToken()` already in `oauth/google.ts`. Find-or-create via Prisma `OAuthAccount.findUnique({ where: { provider_providerAccountId } })` then fallback to `User.findUnique({ where: { email } })` for D-01 linking. |
| OAUTH-03 | Errors land on `/auth/error?code=…` | Mapping table per D-06. Stable codes consumed by `examples/frontend-pages/auth-error.tsx` (which currently uses lowercase keys — note discrepancy below). |
| NOTIF-01 | List notifications (paginated, filter unread) | Cursor pagination per D-07/08/09. Schema's `[userId, createdAt]` and `[userId, readAt]` indexes ready. |
| NOTIF-02 | Mark single + bulk as read | `PATCH` per D-11 with `updateMany` per D-12. |
| NOTIF-03 | Fetch unread count | `prisma.notification.count({ where: { userId, readAt: null } })` — uses `[userId, readAt]` index. |
| NOTIF-04 | Read/update preferences | `GET` + `PATCH` `/api/notifications/prefs`. Open JSON map per D-10; deep-merge on PATCH. |
| NOTIF-05 | Creation goes through `createNotification` (P2002 dedup) | Already shipped in `frontend/src/lib/server/notifications/index.ts`. OAuth callback welcome notif uses it; Phase 2 doesn't add a new dispatcher. |
| PIN-01 | Set/change/delete withdrawal PIN | `POST` + `DELETE` `/api/auth/withdrawal-pin`. Reuse `bcrypt.hash(pin, 12)` matching `auth.ts:137`. |

## Standard Stack

### Core (already installed — verified in `frontend/package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `arctic` | 3.7.0 [VERIFIED: `npm view arctic version` → 3.7.0; matches package.json] | OAuth 2.0 + PKCE client | Lightweight, no session-cookie management, complements existing JWT auth |
| `next` | 16.2.6 [VERIFIED: `npm view next version` → 16.2.6] | App Router runtime | Pinned in package.json; `cookies()` API is async |
| `bcryptjs` | 2.4.3 (registry latest 3.0.3) [VERIFIED: `npm view bcryptjs version`] | PIN hashing at cost 12 | Same as password hashing in `auth.ts:137` — keep alignment |
| `jose` | 5.9.6 | JWT signing (existing) | Used by `auth.ts` — no Phase 2 changes |
| `zod` | 3.23.8 (registry latest 4.4.3) [VERIFIED: `npm view zod version`] | Body validation | Pinned at v3 — keep this; Phase 2 adds NEW schemas, not migrations |
| `@prisma/client` | 5.22.0 | ORM | All new endpoints query existing models |
| `vitest` | 2.1.8 | Unit tests | Per Phase 1 D-25 |
| `vitest-mock-extended` | 2.0.2 | `mockDeep<PrismaClient>` | Used by `frontend/src/test-utils/prisma-mock.ts` |

### Supporting (already in repo, no install needed)

| Library / Module | Purpose | When to Use |
|---|---|---|
| `frontend/src/lib/server/oauth/google.ts` | `tryCreateGoogleProvider()` + `decodeIdToken()` | Both OAuth route handlers |
| `frontend/src/lib/server/auth.ts` | `setAuthCookies`, `setCsrfCookie`, `verifyCsrf`, `createAccessToken`, `createRefreshToken`, `hashPassword`, `verifyPassword` | OAuth callback success branch + PIN hashing |
| `frontend/src/lib/server/middleware/index.ts` | `requireAuth` (returns `AuthContext \| NextResponse`) | All authed reads + PIN endpoints + notifications |
| `frontend/src/lib/server/auth/lockout.ts` | `isLockedOut` / `recordFailure` / `recordSuccess` keyed on a string | PIN brute-force guard via `pin:${userId}` key (CD-02) |
| `frontend/src/lib/server/notifications/index.ts` | `createNotification(prisma, input)` | Welcome notif on first OAuth signup |
| `frontend/src/lib/server/notifications/templates.ts` | `welcomeNotification(userId, email)` | Direct call from OAuth callback |
| `frontend/src/lib/server/zod-helpers.ts` | `zEmail`, `zCuid` | Body validation in PIN + notifications routes |
| `frontend/src/lib/server/observability/request-context.ts` | `makeRequestContext`, `withRequestContext` | Wrap every new route body |
| `frontend/src/lib/server/observability/log.ts` | Scoped `log.info`/`log.warn`/`log.error` | All routes; `log.error` on `OAUTH_GENERIC` fallback |
| `frontend/src/test-utils/prisma-mock.ts` | `prismaMock` + `vi.mock('@/lib/server/prisma')` | Every co-located `route.test.ts` |
| `frontend/src/test-utils/mock-cookies.ts` | `mockNextCookies()` + `__cookieStore` | Tests asserting cookie writes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `arctic` | `oslo` / `auth.js` / hand-rolled | Auth.js wants its own session cookies — would create two parallel auth systems. Hand-rolled risks PKCE bugs. `arctic` is already shipped. |
| `bcryptjs` cost 12 for PIN | `argon2` / scrypt | Native deps don't run on Vercel edge sandbox; bcryptjs runs on `runtime='nodejs'`. Argon2 would ship a binary mismatch risk. CD-01 locks bcrypt cost 12. |
| Cursor pagination (D-07) | Offset pagination | Offset shifts under live insertions — notifications keep arriving. Cursor + `[userId, createdAt]` index is index-perfect. |
| JSON map for prefs (D-10) | Strict enum + columns | Schema migration per new event type. CONTEXT.md explicitly forbids. |

**Installation:** None. Every dependency is already in `frontend/package.json`. [VERIFIED: package.json read 2026-05-08]

**Version verification:**
- `arctic@3.7.0` published 2025-09 (per npm metadata) — current. [VERIFIED: npm registry]
- `next@16.2.6` — pinned at major v16; App Router stable. [VERIFIED: npm registry]
- `bcryptjs@2.4.3` — registry has 3.0.3 (May 2025) but project pins 2.4.3. Do NOT bump in Phase 2 — out of scope.
- `zod@3.23.8` — registry has v4.4.3 (April 2026) but project pins v3. Do NOT migrate to v4; Phase 2 schemas use the v3 API.

## Architecture Patterns

### Recommended File Layout

```
frontend/src/
├── app/api/
│   ├── auth/
│   │   ├── oauth/google/start/route.ts           # OAUTH-01
│   │   ├── oauth/google/start/route.test.ts
│   │   ├── oauth/google/callback/route.ts        # OAUTH-02
│   │   ├── oauth/google/callback/route.test.ts
│   │   ├── withdrawal-pin/route.ts               # PIN-01 (POST + DELETE)
│   │   └── withdrawal-pin/route.test.ts
│   └── notifications/
│       ├── route.ts                              # NOTIF-01 (GET) + NOTIF-02 (PATCH)
│       ├── route.test.ts
│       ├── count/route.ts                        # NOTIF-03
│       ├── count/route.test.ts
│       ├── prefs/route.ts                        # NOTIF-04 (GET + PATCH)
│       └── prefs/route.test.ts
└── lib/server/
    ├── oauth/
    │   ├── google.ts                             # already shipped
    │   └── error-redirect.ts                     # NEW — D-06 helper (build /auth/error?code= URL)
    ├── notifications/
    │   ├── index.ts                              # already shipped
    │   ├── templates.ts                          # already shipped
    │   ├── cursor.ts                             # NEW — encode/decode cursor (D-07)
    │   └── prefs-merge.ts                        # NEW — deep-merge for PATCH prefs (D-10)
    └── auth/
        └── pin.ts                                # NEW — PIN hash/verify wrappers (CD-01..03)
```

### Pattern 1: Route handler boilerplate (carry-over from Phase 1)

```typescript
// Source: frontend/src/app/api/auth/login/route.ts (Phase 1)
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

const Body = z.object({ /* ... */ });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // 1. CSRF (mutations only)
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    // 2. Auth
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    // 3. Parse + validate body
    const body = await req.json().catch(() => null);
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // 4. Domain logic
    // ...

    return NextResponse.json({ ok: true }, { status: 200, headers: { 'x-request-id': ctx.requestId } });
  });
}
```

### Pattern 2: OAuth Start Sequence (`/api/auth/oauth/google/start`)

```typescript
// Source: arctic v3 API (verified at node_modules/arctic/dist/providers/google.d.ts)
export const runtime = 'nodejs';
import 'server-only';
import { generateState, generateCodeVerifier } from 'arctic';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { tryCreateGoogleProvider } from '@/lib/server/oauth/google';

const COOKIE_PREFIX = process.env.COOKIE_PREFIX || 'app';
const OAUTH_STATE_COOKIE = `${COOKIE_PREFIX}-oauth-state`;
const OAUTH_PKCE_COOKIE  = `${COOKIE_PREFIX}-oauth-pkce`;
const OAUTH_NEXT_COOKIE  = `${COOKIE_PREFIX}-oauth-next`; // optional ?next= echo

export async function GET(req: NextRequest): Promise<NextResponse> {
  const provider = tryCreateGoogleProvider();
  if (!provider) {
    // 404 silently — provider inert (D-Phase1 env-gating pattern)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = provider.client.createAuthorizationURL(state, codeVerifier, [...provider.scopes]);

  const store = await cookies();
  const isProd = process.env.NODE_ENV === 'production';
  const opts = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/api/auth/oauth',
    maxAge: 5 * 60,
  };
  store.set(OAUTH_STATE_COOKIE, state, opts);
  store.set(OAUTH_PKCE_COOKIE, codeVerifier, opts);

  // Optional ?next= — same-origin only
  const nextParam = req.nextUrl.searchParams.get('next');
  if (nextParam) {
    try {
      const target = new URL(nextParam, process.env.APP_URL).toString();
      if (new URL(target).origin === new URL(process.env.APP_URL!).origin) {
        store.set(OAUTH_NEXT_COOKIE, target, opts);
      }
    } catch { /* ignore malformed */ }
  }

  return NextResponse.redirect(url.toString(), 302);
}
```

### Pattern 3: OAuth Callback Sequence (`/api/auth/oauth/google/callback`)

```typescript
// Sequence: state check → code exchange → ID-token decode → email_verified gate
//           → find-or-create user (D-01 linking) → issue 3 cookies → optional welcome notif (D-03)
//           → consume oauth-next cookie → redirect home (or to next)
export const runtime = 'nodejs';
import 'server-only';
import { OAuth2RequestError } from 'arctic';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { tryCreateGoogleProvider, decodeIdToken } from '@/lib/server/oauth/google';
import { setAuthCookies, setCsrfCookie, createAccessToken, createRefreshToken } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { createNotification } from '@/lib/server/notifications';
import { welcomeNotification } from '@/lib/server/notifications/templates';
import { redirectToAuthError } from '@/lib/server/oauth/error-redirect';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const provider = tryCreateGoogleProvider();
    if (!provider) return redirectToAuthError('OAUTH_PROVIDER_DISABLED');

    const url = req.nextUrl;
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    const store = await cookies();
    const stateCookie = store.get(`${COOKIE_PREFIX}-oauth-state`)?.value;
    const pkceCookie  = store.get(`${COOKIE_PREFIX}-oauth-pkce`)?.value;

    // Always clear ephemeral cookies (whether success or fail)
    const clearEphemerals = () => { /* set 4 cookies to '' with maxAge: 0 */ };

    if (!code || !state || !stateCookie || !pkceCookie || state !== stateCookie) {
      clearEphemerals();
      return redirectToAuthError('OAUTH_STATE_MISMATCH');
    }

    let tokens;
    try {
      tokens = await provider.client.validateAuthorizationCode(code, pkceCookie);
    } catch (err) {
      clearEphemerals();
      if (err instanceof OAuth2RequestError) {
        log.warn('oauth code exchange failed', { code: err.code, description: err.description });
        return redirectToAuthError('OAUTH_CODE_EXCHANGE_FAILED');
      }
      log.error('oauth unexpected error', { err: String(err) });
      return redirectToAuthError('OAUTH_GENERIC');
    }

    // arctic v3: tokens.idToken() returns the raw JWT string
    const idToken = tokens.idToken();
    const claims = decodeIdToken(idToken);

    if (claims.email_verified !== true) {
      clearEphemerals();
      return redirectToAuthError('GOOGLE_EMAIL_NOT_VERIFIED');
    }

    // Find-or-create with D-01 linking
    let userId: string;
    let isNewUser = false;
    const existingByProvider = await prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: claims.sub } },
      select: { userId: true },
    });
    if (existingByProvider) {
      userId = existingByProvider.userId;
    } else {
      const existingByEmail = await prisma.user.findUnique({
        where: { email: claims.email.toLowerCase() },
        select: { id: true, emailVerifiedAt: true },
      });
      if (existingByEmail) {
        // D-01 silent linking
        await prisma.oAuthAccount.create({
          data: { userId: existingByEmail.id, provider: 'google', providerAccountId: claims.sub },
        });
        userId = existingByEmail.id;
      } else {
        // D-02 brand-new user; emailVerifiedAt set immediately
        const result = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              email: claims.email.toLowerCase(),
              emailVerifiedAt: new Date(),
              name: claims.name ?? null,
              avatarUrl: claims.picture ?? null,
              passwordHash: null,        // OAuth-only: no password
            },
            select: { id: true, email: true },
          });
          await tx.oAuthAccount.create({
            data: { userId: newUser.id, provider: 'google', providerAccountId: claims.sub },
          });
          return newUser;
        });
        userId = result.id;
        isNewUser = true;
      }
    }

    // Issue session cookies (same as verify-email)
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, tokenVersion: true } });
    const access = await createAccessToken({ sub: u!.id, email: u!.email, tokenVersion: u!.tokenVersion });
    const refresh = await createRefreshToken(u!.id, u!.tokenVersion);
    await setAuthCookies(access, refresh);
    await setCsrfCookie();

    // D-03: welcome notification on first OAuth account creation
    if (isNewUser) {
      await createNotification(prisma, welcomeNotification(userId, u!.email));
    }

    // Consume next cookie + clear ephemerals
    const nextUrl = store.get(`${COOKIE_PREFIX}-oauth-next`)?.value || '/';
    clearEphemerals();
    return NextResponse.redirect(new URL(nextUrl, process.env.APP_URL).toString(), 302);
  });
}
```

### Pattern 4: Notifications List with Cursor Pagination

```typescript
// Source: D-07 cursor encoding + Prisma cursor-style query.
// Index used: @@index([userId, createdAt])
const limit = Math.min(50, Number(req.nextUrl.searchParams.get('limit')) || 20);
const unread = req.nextUrl.searchParams.get('unread') === 'true';
const rawCursor = req.nextUrl.searchParams.get('cursor');

let cursorWhere: Prisma.NotificationWhereInput = {};
if (rawCursor) {
  try {
    const { createdAt, id } = JSON.parse(Buffer.from(rawCursor, 'base64').toString('utf8'));
    cursorWhere = { OR: [
      { createdAt: { lt: new Date(createdAt) } },
      { createdAt: new Date(createdAt), id: { lt: id } }, // tie-break for identical timestamps
    ]};
  } catch { /* malformed cursor → ignore, return first page */ }
}

const items = await prisma.notification.findMany({
  where: { userId: ctx.user.sub, ...(unread ? { readAt: null } : {}), ...cursorWhere },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: limit + 1, // peek one ahead to compute nextCursor
});

const hasMore = items.length > limit;
const page = items.slice(0, limit);
const last = page[page.length - 1];
const nextCursor = hasMore && last
  ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64')
  : null;

return NextResponse.json({ items: page.map(serialize), nextCursor });
```

### Pattern 5: Mark-Read Idempotent updateMany

```typescript
// Source: D-11/D-12/D-13/D-14
const Body = z.object({
  ids: z.union([z.array(z.string().min(1)).min(1), z.literal('all')]),
});

// 'all' → updateMany without id filter
const where = parsed.data.ids === 'all'
  ? { userId: ctx.user.sub, readAt: null }
  : { userId: ctx.user.sub, readAt: null, id: { in: parsed.data.ids } };

const r = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
const unreadCount = await prisma.notification.count({ where: { userId: ctx.user.sub, readAt: null } });

return NextResponse.json({ updated: r.count, unreadCount }); // D-14
```

### Pattern 6: PIN Set / Change / Delete

```typescript
// POST /api/auth/withdrawal-pin — set OR change
// Body shape depends on whether withdrawalPinHash is null:
//   - null  → { newPin: '\d{4,6}' }                 (set)
//   - !null → { currentPin: '\d{4,6}', newPin }      (change, CD-03)
const PinDigits = z.string().regex(/^\d{4,6}$/);
const SetBody = z.object({ newPin: PinDigits });
const ChangeBody = z.object({ currentPin: PinDigits, newPin: PinDigits });

const user = await prisma.user.findUnique({
  where: { id: ctx.user.sub },
  select: { withdrawalPinHash: true },
});

if (user?.withdrawalPinHash) {
  // Lockout check first (CD-02): pin:${userId}
  if (await isLockedOut(`pin:${ctx.user.sub}`)) {
    return NextResponse.json({ error: 'LOCKED_OUT' }, { status: 423 });
  }
  const parsed = ChangeBody.safeParse(body);
  if (!parsed.success) {
    // currentPin missing or malformed → PIN_REQUIRED
    return NextResponse.json({ error: 'PIN_REQUIRED' }, { status: 400 });
  }
  const ok = await bcrypt.compare(parsed.data.currentPin, user.withdrawalPinHash);
  if (!ok) {
    await recordFailure(`pin:${ctx.user.sub}`);
    return NextResponse.json({ error: 'PIN_INVALID' }, { status: 400 });
  }
  await recordSuccess(`pin:${ctx.user.sub}`);
  await prisma.user.update({
    where: { id: ctx.user.sub },
    data: { withdrawalPinHash: await bcrypt.hash(parsed.data.newPin, 12) },
  });
} else {
  const parsed = SetBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  await prisma.user.update({
    where: { id: ctx.user.sub },
    data: { withdrawalPinHash: await bcrypt.hash(parsed.data.newPin, 12) },
  });
}
return NextResponse.json({ ok: true });

// DELETE /api/auth/withdrawal-pin — clear hash to null
await prisma.user.update({ where: { id: ctx.user.sub }, data: { withdrawalPinHash: null } });
```

### Anti-Patterns to Avoid

- **Calling `prisma.notification.create` directly** — bypasses the `P2002` dedup catch in `createNotification`. NOTIF-05 invariant. CLAUDE.md explicitly forbids.
- **Storing the OAuth `state` in a long-lived cookie or in localStorage** — must be httpOnly + 5-min TTL + path-scoped to `/api/auth/oauth` per OAUTH-01.
- **Setting OAuth state cookie at root path `/`** — leaks to non-OAuth routes. Path MUST be `/api/auth/oauth`.
- **Reading raw `?error=` codes lowercase in the route while the page expects them lowercase** — see Pitfall 4 below: CONTEXT.md D-06 uses UPPERCASE codes (`GOOGLE_EMAIL_NOT_VERIFIED`) but `examples/frontend-pages/auth-error.tsx` ships with lowercase keys (`oauth_email_unverified`). Must be reconciled at planning.
- **Returning 403 / 404 on cross-tenant notification IDs** — leaks ID validity. D-13: silent ignore via `userId` in `where`.
- **Conditioning OAuth code-exchange on a JSON request body** — the callback is a `GET` redirect from Google; use `req.nextUrl.searchParams`.
- **Letting bcrypt cost differ between password and PIN** — CD-01 locks both at 12. Different costs leak existence-of-PIN via timing.
- **Not clearing OAuth ephemeral cookies on every callback exit path** — orphaned state/PKCE cookies pollute subsequent attempts; clear on every branch (success, state mismatch, code exchange failure, email unverified).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth 2.0 + PKCE flow | Hand-rolled state/PKCE generation, code-exchange POST | `arctic` `Google` class + `generateState` + `generateCodeVerifier` | Already shipped, peer-reviewed, handles edge cases (PKCE format, scope encoding) |
| ID token decode + verify | `jose` decodeJwt + JWKS fetch | Existing `decodeIdToken()` in `oauth/google.ts` (signature already validated by arctic during code exchange) | Avoids extra deps; arctic handles signature |
| Rate-limit / lockout for PIN | Per-route Redis counters | `frontend/src/lib/server/auth/lockout.ts` (already shipped, Redis + memory fallback) | Two implementations diverge under load; reuse |
| Cursor encoding | URL-encoded query string of timestamps | `Buffer.from(JSON.stringify(...)).toString('base64')` round-trip | Stable, opaque to clients, handles tie-breaking on identical timestamps |
| CSRF double-submit check | Per-route header compare | `verifyCsrf(req)` from `auth.ts:192` | timingSafeEqual-protected, returns ready-to-bail NextResponse |
| Notification creation + dedup | Direct `prisma.notification.create` + try/catch | `createNotification(prisma, input)` from `notifications/index.ts` | NOTIF-05 invariant; P2002 dedup is the at-most-once gate |

**Key insight:** Phase 2 is mostly an *integration* phase — every primitive it needs already exists in the repo or in a peer-reviewed library. The risk is in **wiring order** (state cookie path scope, ephemeral-cookie cleanup, find-or-create transaction boundary, lockout key naming), not in building new crypto/protocol code.

## Common Pitfalls

### Pitfall 1: arctic v3 ID-token retrieval
**What goes wrong:** Code expects `tokens.id_token` (snake_case) or `tokens.idToken` (property), but arctic v3 exposes it as a method `tokens.idToken()`.
**Why it happens:** arctic v2 used a property; v3 uses a method. The test under [VERIFIED: `node_modules/arctic/dist/oauth2.d.ts` shows `class OAuth2Tokens`] confirms method-style.
**How to avoid:** Always call `tokens.idToken()` not `tokens.idToken`. Catch the missing-token case explicitly.
**Warning sign:** Type error "This expression is not callable" or "Property 'id_token' does not exist".

### Pitfall 2: Async `cookies()` in Next.js 16
**What goes wrong:** `cookies().get('x')` without `await` throws at runtime in Next 15+.
**Why it happens:** `next/headers` `cookies()` became async in Next 15.
**How to avoid:** `const store = await cookies(); const v = store.get('x')?.value;` — same pattern as `auth.ts:58`.
**Warning sign:** `TypeError: store.get is not a function` or runtime errors only in production.

### Pitfall 3: OAuth state cookie path mismatch
**What goes wrong:** state cookie set with `path: '/'` is sent on every request — but more importantly, if it's set at `/api/auth/oauth/google/start` with `path: '/api/auth/oauth/google/start'`, the callback at `/callback` won't receive it.
**Why it happens:** Path scope must include both routes. Both `start` and `callback` live under `/api/auth/oauth`.
**How to avoid:** Always set `path: '/api/auth/oauth'` per OAUTH-01 and CONTEXT.md D-Phase1-21.
**Warning sign:** State mismatch on every callback (state cookie reads as `undefined`).

### Pitfall 4: auth-error page key casing mismatch
**What goes wrong:** CONTEXT.md D-06 prescribes UPPERCASE codes (`GOOGLE_EMAIL_NOT_VERIFIED`, `OAUTH_STATE_MISMATCH`, etc.) but `examples/frontend-pages/auth-error.tsx` ships with lowercase keys (`oauth_email_unverified`, `oauth_state_mismatch`). The error page is a downstream consumer.
**Why it happens:** Contract drift between the existing example page and Phase 2 decisions.
**How to avoid:** **Planner should issue an error-redirect helper that emits the UPPERCASE codes per D-06 and flag the auth-error.tsx mismatch as a follow-up doc fix**. Phase 2 owns the protocol; the example page is reference UI marked "EXAMPLE — copy this into your project's app router and customize".
**Warning sign:** Manual smoke test loads `/auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED` and the page shows the generic fallback message because no UPPERCASE key matches.

### Pitfall 5: `OAuthAccount.findUnique` compound key syntax
**What goes wrong:** Prisma compound-unique queries require a specific shape: `where: { provider_providerAccountId: { provider, providerAccountId } }` — not `where: { provider, providerAccountId }`.
**Why it happens:** Prisma generates a synthetic field name from the unique constraint composite (`@@unique([provider, providerAccountId])`).
**How to avoid:** Use the underscore-joined synthesis. Verify in `node_modules/.prisma/client/index.d.ts` if uncertain.
**Warning sign:** Type error "Object literal may only specify known properties, and 'provider' does not exist".

### Pitfall 6: Welcome notification race on retried OAuth callback
**What goes wrong:** OAuth callbacks can be replayed (browser back-button, refresh during slow code exchange). A naive `prisma.notification.create` would write duplicates.
**Why it happens:** Google's authorization codes are usually single-use, but the local Prisma writes happen before the redirect — a retry is plausible.
**How to avoid:** Always go through `createNotification(prisma, welcomeNotification(userId, email))`. The `dedupeKey: 'welcome:${userId}'` (from templates.ts) catches `P2002` and returns null silently. NOTIF-05 invariant.
**Warning sign:** A user reports two welcome rows in their notification list after first sign-in.

### Pitfall 7: PIN lockout key namespace collision with login
**What goes wrong:** Reusing `lockout.ts` with the user's email as key would couple PIN failures and login failures. CD-02 explicitly says they must NOT share a counter.
**Why it happens:** `lockout.ts` is keyed on a string — caller decides namespace.
**How to avoid:** Always pass `pin:${userId}` to `isLockedOut`/`recordFailure`/`recordSuccess`. The `lockout.ts` internal `memKey()` does `email.trim().toLowerCase()` — note that for PIN we're passing a synthetic key, not an email. Adding `pin:` prefix avoids accidental collision when `userId` happens to look like a UUID.
**Warning sign:** Login attempts triggering PIN lockout, or vice versa, in integration tests.

### Pitfall 8: Empty `ids` array in mark-read PATCH
**What goes wrong:** Body `{ ids: [] }` with naive `where: { id: { in: [] } }` returns `count: 0` correctly but a misuse of `'all'` semantics could match nothing.
**Why it happens:** Zod `z.array(...).min(1)` rejects empty arrays at validation; `'all'` is a literal branch.
**How to avoid:** Use `z.union([z.array(z.string()).min(1), z.literal('all')])` per Pattern 5.
**Warning sign:** PATCH with `[]` returns 400 (intended) or `updated: 0` (also acceptable per D-12 idempotency, but the spec wants explicit validation).

### Pitfall 9: NotificationPreferences upsert race
**What goes wrong:** Two concurrent PATCH /prefs requests with `findUnique → merge → update` can lose one update (last-write-wins).
**Why it happens:** Read-modify-write across two queries.
**How to avoid:** Use `prisma.notificationPreferences.upsert({ where: { userId }, create: { userId, prefs: merged }, update: { prefs: merged } })` and accept last-write-wins as the documented semantic — preferences are user-controlled, no integrity boundary. Don't escalate to a Serializable tx; not worth the cost.
**Warning sign:** None visible; document as known semantic.

### Pitfall 10: Same-origin `?next=` validator bypassed by trailing slash quirks
**What goes wrong:** `new URL('/foo', APP_URL).origin` always equals `APP_URL`'s origin; an attacker passes `next=//evil.com/path`, which `new URL()` parses as `https://evil.com/path` — bypassing the same-origin check.
**Why it happens:** `//` (protocol-relative) is treated as host-changing by URL parsing.
**How to avoid:** Reject `next` strings that start with `//`, `http://`, or `https://` (protocol-prefix or protocol-relative). Only accept paths starting with `/` followed by a non-`/` character. Re-construct via `new URL(path, APP_URL)` and assert `.origin === APP_URL_origin`.
**Warning sign:** Open-redirect class CVE in audit.

## Code Examples

### Example A: arctic v3 happy-path code exchange

```typescript
// Source: arctic v3 README + frontend/node_modules/arctic/dist/providers/google.d.ts
import { Google, generateState, generateCodeVerifier, OAuth2RequestError } from 'arctic';

const client = new Google(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const state = generateState();
const codeVerifier = generateCodeVerifier();
const url = client.createAuthorizationURL(state, codeVerifier, ['openid', 'email', 'profile']);
// → https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=...

try {
  const tokens = await client.validateAuthorizationCode(code, codeVerifier);
  const idToken = tokens.idToken();   // string (raw JWT)
  const accessToken = tokens.accessToken();
  // Use decodeIdToken from frontend/src/lib/server/oauth/google.ts:72 to unpack claims
} catch (err) {
  if (err instanceof OAuth2RequestError) {
    // err.code, err.description from Google
  }
}
```

### Example B: Existing `setAuthCookies` reuse (already shipped — DO NOT modify)

```typescript
// Source: frontend/src/lib/server/auth.ts:57-76 (verified read 2026-05-08)
await setAuthCookies(accessToken, refreshToken);
// Sets app-token (path /, 15min) + app-refresh (path /api/auth, 7d).
await setCsrfCookie();
// Sets app-csrf (path /, 7d, NOT httpOnly — readable from JS).
```

### Example C: Co-located route test bootstrapping (Phase 1 pattern)

```typescript
// Source: frontend/src/app/api/auth/verify-email/route.test.ts (read 2026-05-08)
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

mockNextCookies();              // MUST be at module top — vi.mock auto-hoists
import { POST } from './route'; // import after mock setup

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
});
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 [VERIFIED: package.json read 2026-05-08] |
| Config file | `frontend/vitest.config.ts` (already exists with `passWithNoTests: true`, `setupFiles: ['./vitest.setup.ts']`, `server-only` aliased to empty stub) |
| Quick run command | `pnpm --filter frontend exec vitest run src/app/api/<route>/route.test.ts` |
| Full suite command | `pnpm --filter frontend test` |
| Phase gate | `pnpm format && pnpm lint && pnpm typecheck && pnpm test` (per CLAUDE.md "Before committing") |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OAUTH-01 | `GET /start` issues state+PKCE cookies (path `/api/auth/oauth`, maxAge 300) and 302 to Google | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/oauth/google/start/route.test.ts` | ❌ Wave 1 |
| OAUTH-01 | Returns 404 when `tryCreateGoogleProvider()` undefined (env missing) | unit | same file, `it('returns 404 when env missing')` | ❌ Wave 1 |
| OAUTH-02 | Callback rejects state mismatch → redirect `?code=OAUTH_STATE_MISMATCH` | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/oauth/google/callback/route.test.ts` | ❌ Wave 1 |
| OAUTH-02 | Callback rejects `email_verified=false` → `?code=GOOGLE_EMAIL_NOT_VERIFIED` | unit | same file | ❌ Wave 1 |
| OAUTH-02 | Callback links existing email/password user (D-01) — creates `OAuthAccount` row, no new `User` | unit | same file | ❌ Wave 1 |
| OAUTH-02 | Callback creates brand-new user (D-02) — `emailVerifiedAt` set, welcome notif inserted (D-03) | unit | same file | ❌ Wave 1 |
| OAUTH-02 | Callback issues 3 cookies on success (mirrors verify-email) | unit | same file | ❌ Wave 1 |
| OAUTH-03 | All five error codes from D-06 result in `Location: /auth/error?code=<UPPERCASE>` | unit | error-redirect.test.ts in `lib/server/oauth/` | ❌ Wave 1 |
| NOTIF-01 | `GET /api/notifications` returns paginated `{ items, nextCursor }`; `nextCursor` null at end | unit | `pnpm --filter frontend exec vitest run src/app/api/notifications/route.test.ts` | ❌ Wave 1 |
| NOTIF-01 | `?unread=true` filter applies `readAt: null`; `?limit=` clamped to [1, 50] | unit | same file | ❌ Wave 1 |
| NOTIF-01 | Cursor round-trips: encode → query → decode | unit | `lib/server/notifications/cursor.test.ts` | ❌ Wave 0 (helper test) |
| NOTIF-02 | `PATCH /api/notifications` with `{ ids: [id] }` → `updated: 1` and `unreadCount` decremented | unit | same route.test.ts | ❌ Wave 1 |
| NOTIF-02 | `PATCH` with `{ ids: 'all' }` → marks all unread for user | unit | same | ❌ Wave 1 |
| NOTIF-02 | `PATCH` ignores cross-tenant IDs silently (D-13) — `updated: 0` | unit | same | ❌ Wave 1 |
| NOTIF-02 | `PATCH` requires `verifyCsrf` (returns 403 without `x-csrf-token` header) | unit | same | ❌ Wave 1 |
| NOTIF-03 | `GET /api/notifications/count` returns `{ count: <n> }`; uses `[userId, readAt]` index | unit | `pnpm --filter frontend exec vitest run src/app/api/notifications/count/route.test.ts` | ❌ Wave 1 |
| NOTIF-04 | `GET /api/notifications/prefs` returns `{ prefs: {} }` for users with no row (defaults applied) | unit | `pnpm --filter frontend exec vitest run src/app/api/notifications/prefs/route.test.ts` | ❌ Wave 1 |
| NOTIF-04 | `PATCH` deep-merges and persists; missing event types remain enabled (opt-out semantics) | unit | same | ❌ Wave 1 |
| NOTIF-05 | Welcome path goes through `createNotification` (no direct `prisma.notification.create`) | static | grep test in `oauth/callback/route.test.ts` source check | ❌ Wave 1 |
| PIN-01 | `POST /api/auth/withdrawal-pin` with no existing hash → sets bcrypt hash on `User.withdrawalPinHash` | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/withdrawal-pin/route.test.ts` | ❌ Wave 1 |
| PIN-01 | `POST` with existing hash + correct `currentPin` → updates hash; recordSuccess clears lockout | unit | same | ❌ Wave 1 |
| PIN-01 | `POST` with existing hash + wrong `currentPin` → `400 PIN_INVALID`; recordFailure increments | unit | same | ❌ Wave 1 |
| PIN-01 | `POST` while locked-out → `423 LOCKED_OUT` (no bcrypt compare runs) | unit | same | ❌ Wave 1 |
| PIN-01 | `DELETE` clears `withdrawalPinHash` to null | unit | same | ❌ Wave 1 |
| PIN-01 | All three (POST, POST-change, DELETE) require auth + CSRF | unit | same | ❌ Wave 1 |
| Phase 0 invariant | All new route files export `runtime='nodejs'` | unit | `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ✅ already exists |

### Sampling Rate

- **Per task commit:** `pnpm --filter frontend exec vitest run src/app/api/<changed-route>/route.test.ts` (single file, < 5 s)
- **Per wave merge:** `pnpm --filter frontend test` (full Vitest suite, includes runtime-enforcement walk over `app/api/**/route.ts`)
- **Phase gate:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` from repo root — all four exit 0 before `/gsd-verify-work` (per CLAUDE.md)

### Wave 0 Gaps

- [ ] `frontend/src/lib/server/oauth/error-redirect.ts` + `error-redirect.test.ts` — D-06 codes → `/auth/error?code=` URL builder. Pure unit-testable helper; lands in Wave 0 so callback handler can import.
- [ ] `frontend/src/lib/server/notifications/cursor.ts` + `cursor.test.ts` — encode/decode `{ createdAt, id }` cursor (D-07). Round-trip test.
- [ ] `frontend/src/lib/server/notifications/prefs-merge.ts` + `prefs-merge.test.ts` — deep-merge JSON map (D-10). Pure-function test (handles overwrite, additive keys, nested toggles).
- [ ] `frontend/src/lib/server/auth/pin.ts` + `pin.test.ts` — wraps `bcrypt.hash(pin, 12)` and `bcrypt.compare`; centralizes the cost-12 pairing with `auth.ts` `hashPassword`.
- [ ] No new framework install — Vitest config already supports node env + server-only stub.
- [ ] No vitest.setup.ts changes — JWT_SECRET / ENCRYPTION_KEY fixtures from Phase 1 are sufficient.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | OAuth 2.0 + PKCE via `arctic`; bcrypt (cost 12) for PIN; reuse JWT/refresh from Phase 1 |
| V3 Session Management | yes | Reuse `setAuthCookies`/`setCsrfCookie` (httpOnly, Secure-in-prod, SameSite=Lax, path-scoped refresh) from `auth.ts` |
| V4 Access Control | yes | `requireAuth` HOF on every authed route; `userId` in every Prisma `where` (notifications, PIN) |
| V5 Input Validation | yes | Zod schemas: `z.string().regex(/^\d{4,6}$/)` for PIN, `z.union([z.array(...), z.literal('all')])` for mark-read, `zEmail` from `zod-helpers.ts` |
| V6 Cryptography | yes | bcryptjs cost 12 for PIN (matches password hashing). State + PKCE generated by arctic (cryptographically random per spec). Never hand-roll. |
| V7 Error Handling | yes | Stable error codes: `OAUTH_STATE_MISMATCH`, `OAUTH_CODE_EXCHANGE_FAILED`, `GOOGLE_EMAIL_NOT_VERIFIED`, `OAUTH_PROVIDER_DISABLED`, `OAUTH_GENERIC`, `PIN_REQUIRED`, `PIN_INVALID`, `LOCKED_OUT`, `VALIDATION_FAILED` |
| V8 Data Protection | yes | OAuth state + PKCE in httpOnly cookies path-scoped to `/api/auth/oauth`, 5-min TTL. PIN never logged (bcrypt-hash-only at rest). |
| V13 API & Web Service | yes | CSRF on all PATCH/POST/DELETE (per CLAUDE.md invariant); GETs are CSRF-exempt; runtime='nodejs' enforced |

### Known Threat Patterns for Next.js + arctic + Prisma

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account takeover via unverified Google email | Spoofing | D-05: refuse `email_verified !== true` and redirect to error page |
| OAuth state replay / CSRF on callback | Tampering | `state` cookie + match check on callback (5-min TTL, path-scoped, httpOnly) |
| Authorization code interception | Tampering | PKCE — `code_verifier` cookie matched against the SHA-256 challenge sent to Google |
| Open redirect via `?next=` | Tampering | Same-origin validation: reject `//`, `http://`, `https://` prefixes; reconstruct via `new URL(path, APP_URL)` |
| PIN brute-force | Repudiation/Tampering | bcrypt cost 12 (offline-resistant) + lockout after 5 failures (CD-02) keyed `pin:${userId}` |
| Notification ID enumeration | Information Disclosure | Cross-tenant IDs silently ignored (D-13) — no 403/404 differentiation |
| Welcome notification duplication on retry | Repudiation | `dedupeKey: welcome:${userId}` + P2002 catch in `createNotification` |
| Stored OAuth refresh tokens leaking | Information Disclosure | D-04: do NOT request `offline_access`; `OAuthAccount.refreshToken` stays null |
| Timing attack on `currentPin` compare | Information Disclosure | `bcrypt.compare` runs unconditionally even on path mismatch (CD-03) |
| Cookie scope leak (state visible to non-OAuth routes) | Information Disclosure | `path: '/api/auth/oauth'` + httpOnly + 5-min TTL |
| OAuth-only user attempting password login | Authentication Bypass | `auth.ts:108` already returns `INVALID_CREDENTIALS` when `passwordHash === null` after dummy bcrypt (verified in login/route.ts) — Phase 2 doesn't break this |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OAuth 2.0 implicit flow / no PKCE | Authorization Code + PKCE (mandatory per OAuth 2.1 draft) | 2020+ | arctic ships PKCE by default — `Google.createAuthorizationURL(state, codeVerifier, scopes)` |
| arctic v2 `tokens.idToken` property | arctic v3 `tokens.idToken()` method | arctic v3 (2024-2025) | [VERIFIED: dist/oauth2.d.ts class shape] — adjust call sites |
| Sync `cookies()` in Next.js | Async `cookies()` (must await) | Next 15 | All cookie reads/writes in Phase 2 use `const store = await cookies()` |
| Storing OAuth refresh tokens by default | Only when off-session API access is needed (D-04) | OWASP / OIDC Best Current Practice | Less attack surface; column kept nullable for future |

**Deprecated / outdated:**
- bcrypt cost 10 → use cost 12 (CD-01) — cost 10 takes ~70ms; cost 12 takes ~250ms; offline GPU brute-force economics demand 12+ for low-entropy secrets.
- offset pagination → cursor pagination for live-inserted feeds (D-07).
- `prisma.notification.create` direct calls → `createNotification(...)` wrapper (NOTIF-05 invariant).

## Project Constraints (from CLAUDE.md)

These directives have the same authority as locked CONTEXT.md decisions:

1. **Every Route Handler MUST `export const runtime = 'nodejs'`.** Phase 0 test in `frontend/src/lib/server/observability/runtime-enforcement.test.ts` walks `app/api/**/route.ts` and fails CI if any route forgets it. [VERIFIED: read 2026-05-08]
2. **Per-request observability** flows through `withRequestContext()` from `frontend/src/lib/server/observability/request-context.ts`. Every Phase 2 handler wraps its body in this for `requestId`/`userId`/`route` log auto-attachment.
3. **Cookies stay `httpOnly` + `Secure` (prod) + `SameSite=Lax`** with `<COOKIE_PREFIX>-*` naming.
4. **Notification dispatchers MUST go through `createNotification(prisma, input)`** — never `prisma.notification.create` directly (skips dedup `P2002` catch). NOTIF-05 invariant.
5. **CSRF check via `verifyCsrf(req)`** at the top of every mutating handler (POST/PATCH/PUT/DELETE) — returns NextResponse 403 to bail. CSRF GETs are exempt.
6. **Sentry init stays in `frontend/instrumentation.ts` `register()`** — Phase 2 does not touch instrumentation.
7. **Files Claude must NOT modify (battle-tested):** `auth.ts`, `crypto.ts`, `logger.ts`, `redis.ts`, `rate-limit-store.ts`, `slug.ts`, `zod-helpers.ts`, `webhook/handler.ts`, `circuit-breaker.ts`, **`oauth/google.ts`** (Phase 2 callback consumes it; route handlers in `app/api/auth/oauth/google/*` are also off-limits to refactor), `outbox/dispatcher.ts`, `audit.ts`, middleware index/admin/org-role, `request-context.ts`, `instrumentation.ts`, `lib/api.ts`. Phase 2 ADDS new route handlers and new helper modules; it does NOT modify any of the above.
8. **TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`** — no `any` casts.
9. **Conventional Commits** (likely: `feat(oauth):`, `feat(notifications):`, `feat(pin):`).
10. **Node ≥ 20, pnpm ≥ 9** — no version bumps in this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The repo's `next.config.ts` does not block `/api/auth/oauth/*` routes via redirects/rewrites. | OAuth Start/Callback patterns | Routes 404 even when env present; smoke test catches before commit. |
| A2 | `process.env.APP_URL` is set in dev/prod (used for same-origin `?next=` validation and redirects). | OAuth callback redirect | Without it the redirect URL is `undefined` — runtime crash. Planner should verify in `.env.example` (Phase 1's plan-05 documents env vars). |
| A3 | `User.withdrawalPinHash` column already exists nullable on the live DB (not just in schema.prisma). | PIN section | If a fork forgot `pnpm db:push`, POST /withdrawal-pin throws on `User.update`. Verifiable with `pnpm db:migrate:status`. |
| A4 | Adding new route folders under `app/api/auth/oauth/google/` does not collide with existing wildcard handlers. | All OAuth | None expected — `app/api/auth/` already has 9 sibling subfolders (verified). |
| A5 | Welcome notification's `dedupeKey: welcome:${userId}` (template) does not conflict with any existing notification user IDs (no rows yet — Phase 2 is first use). | OAuth callback | Trivial — fresh table. |
| A6 | The current `examples/frontend-pages/auth-error.tsx` is just a reference page (not under `frontend/src/app/`) and is NOT served by the app. The route `/auth/error` must be added by the project consuming this starter. | OAuth-03 | Phase 2 only emits the redirect; rendering is a downstream/UI concern. CONTEXT.md confirms "do not modify in Phase 2." |

**These should be confirmed at planning** — A2 (APP_URL env var) and A3 (DB schema state) are the highest-risk if wrong; A1/A4/A5/A6 are low-risk verifications.

## Open Questions

1. **Should the OAuth callback's brand-new-user creation be wrapped in a single Prisma transaction with the welcome notification?**
   - What we know: D-03 says use `createNotification` (which catches P2002). The callback already uses `prisma.$transaction` for User+OAuthAccount creation.
   - What's unclear: Should the welcome notification be inside the same tx or a separate write afterwards?
   - Recommendation: **Outside the tx** (separate write). `createNotification` is idempotent on `dedupeKey`, so a retry of the OAuth callback after partial commit is safe. Putting it inside would require passing `tx` through `createNotification`, which is doable but adds API surface.

2. **What `name` and `avatarUrl` do we set when D-01 links Google to an existing email/password user?**
   - What we know: D-01 says silent linking; D-02 says set on brand-new user.
   - What's unclear: For existing users, do we overwrite `User.name` / `User.avatarUrl` from Google's claims, or leave them as-is?
   - Recommendation: **Leave as-is** for existing users (don't surprise them with their Google avatar replacing whatever they had). Only populate on brand-new users. If a "settings: link Google" UI lands later, it can offer "import name/avatar from Google" as an explicit toggle. Flag for planner to confirm.

3. **The `examples/frontend-pages/auth-error.tsx` file uses lowercase keys (`oauth_email_unverified`); CONTEXT.md D-06 mandates UPPERCASE (`GOOGLE_EMAIL_NOT_VERIFIED`).**
   - What we know: D-06 codes are the protocol contract; the example page is "EXAMPLE — copy this into your project's app router and customize."
   - What's unclear: Should Phase 2 also patch the example page to use UPPERCASE, or is the page "downstream/out-of-scope"?
   - Recommendation: **Phase 2 emits UPPERCASE per D-06 (the contract); the example page is reference UI marked do-not-modify-in-Phase-2 per CONTEXT.md.** Leave a comment in the OAuth callback or in a follow-up doc note that the example page needs a casing update for production accuracy. Flag for planner.

4. **Is `OAUTH_GENERIC` the correct fallback code, or should we surface more granular codes for unexpected `arctic` errors (`ArcticFetchError`, `UnexpectedResponseError`)?**
   - What we know: arctic exports `OAuth2RequestError`, `ArcticFetchError`, `UnexpectedErrorResponseBodyError`, `UnexpectedResponseError`. D-06 only covers `OAUTH_CODE_EXCHANGE_FAILED` (specifically `OAuth2RequestError`) and `OAUTH_GENERIC` (everything else).
   - What's unclear: Granularity tradeoff.
   - Recommendation: **Stick with the 5 D-06 codes** (don't add more). Catch `OAuth2RequestError` → `OAUTH_CODE_EXCHANGE_FAILED`; everything else → `OAUTH_GENERIC` + `log.error` with full error. Clients shouldn't need to differentiate beyond "user can retry."

## Environment Availability

> Phase 2 is code/config-only — no new external dependencies beyond what's already in the codebase.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `arctic` (npm) | OAuth | ✓ (in package.json) | 3.7.0 [VERIFIED npm registry] | — |
| `bcryptjs` (npm) | PIN hashing | ✓ (in package.json) | 2.4.3 | — |
| `@prisma/client` (npm) | All models | ✓ (in package.json) | 5.22.0 | — |
| Postgres / Neon (runtime) | Notifications, OAuthAccount, User.withdrawalPinHash | ✓ assumed (Phase 0 verified) | — | — |
| Redis / Upstash (runtime) | PIN lockout primitives | ✓ optional | — | In-memory fallback in `lockout.ts` (logs warn) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` (env) | OAuth routes | ✗ in dev (per env-gating pattern) | — | OAuth routes 404 silently when missing — design intent |

**Missing dependencies with no fallback:** None. All Phase 2 work proceeds with what's already shipped.

**Missing dependencies with fallback:** Redis (lockout silently degrades to in-memory — fine for unit tests, OK for single-instance dev).

## Sources

### Primary (HIGH confidence)
- `frontend/package.json` — dep versions verified [read 2026-05-08]
- `frontend/src/lib/server/oauth/google.ts` — `tryCreateGoogleProvider`, `decodeIdToken`, `GoogleIdTokenClaims` type [read 2026-05-08]
- `frontend/src/lib/server/auth.ts` — `setAuthCookies`, `setCsrfCookie`, `verifyCsrf`, `createAccessToken`, `createRefreshToken` [read 2026-05-08]
- `frontend/src/lib/server/middleware/index.ts` — `requireAuth` HOF + AuthContext [read 2026-05-08]
- `frontend/src/lib/server/auth/lockout.ts` — `isLockedOut`/`recordFailure`/`recordSuccess` [read 2026-05-08]
- `frontend/src/lib/server/notifications/index.ts` + `templates.ts` — `createNotification` + `welcomeNotification` [read 2026-05-08]
- `frontend/prisma/schema.prisma` — `User.withdrawalPinHash`, `OAuthAccount`, `Notification`, `NotificationPreferences` schemas [read 2026-05-08]
- `frontend/src/app/api/auth/login/route.ts` + `verify-email/route.ts` — Phase 1 reference patterns [read 2026-05-08]
- `frontend/src/app/api/auth/verify-email/route.test.ts` — co-located test pattern [read 2026-05-08]
- `frontend/node_modules/arctic/dist/providers/google.d.ts` + `oauth2.d.ts` — arctic v3 API surface [read 2026-05-08]
- `frontend/src/test-utils/prisma-mock.ts` + `mock-cookies.ts` — test harness [read 2026-05-08]
- `frontend/vitest.config.ts` — test config (passWithNoTests, server-only alias) [read 2026-05-08]
- npm registry — `arctic@3.7.0`, `next@16.2.6`, `bcryptjs@3.0.3`, `zod@4.4.3` [VERIFIED via `npm view` 2026-05-08]
- `.planning/phases/02-oauth-notifications-withdrawal-pin/02-CONTEXT.md` — D-01..D-14 + CD-01..04 + carry-over [read 2026-05-08]
- `.planning/REQUIREMENTS.md` + `.planning/ROADMAP.md` + `.planning/STATE.md` — phase scope & traceability [read 2026-05-08]
- `CLAUDE.md` — project invariants [read 2026-05-08]

### Secondary (MEDIUM confidence)
- arctic README pattern for `Google` class usage — cross-checked with the lib's `dist/*.d.ts` types [VERIFIED]
- OWASP OAuth 2.0 Best Current Practice for state + PKCE [CITED: well-known industry consensus]

### Tertiary (LOW confidence)
- None. All claims in this RESEARCH.md are backed by either codebase reads or npm-registry checks.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all libs already in package.json, versions verified against npm.
- Architecture: **HIGH** — patterns derived from existing Phase 1 routes (login, verify-email) which are already shipped + reviewed.
- Pitfalls: **HIGH** — Pitfalls 1, 2, 3, 5, 7, 10 verified against codebase or arctic types; Pitfalls 4, 6, 8, 9 derived from explicit CONTEXT.md decisions.
- Validation Architecture: **HIGH** — Phase 1 test pattern is in-tree; Vitest config exists.
- Security Domain: **HIGH** — every threat has a named mitigation already in the codebase.

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30 days for stable Next.js + arctic combination; refresh if arctic v4 ships in the interim)

## RESEARCH COMPLETE

**Phase:** 02 - oauth-notifications-withdrawal-pin
**Confidence:** HIGH

### Key Findings
- Every dependency Phase 2 needs is already shipped — `arctic@3.7.0`, `bcryptjs`, lockout primitives, `createNotification`, `setAuthCookies`. Phase 2 is integration, not invention.
- `oauth/google.ts` exposes `tryCreateGoogleProvider()` + `decodeIdToken()` — route handlers consume them; `arctic` v3 exposes `tokens.idToken()` as a method (Pitfall 1).
- `User.withdrawalPinHash` column already exists nullable; PIN endpoints touch only this column + reuse `lockout.ts` keyed `pin:${userId}` (CD-02).
- Notifications schema has `[userId, createdAt]` + `[userId, readAt]` indexes ready for cursor pagination + unread filter (D-07/D-09).
- Documented contract drift: CONTEXT.md D-06 uses UPPERCASE error codes; `examples/frontend-pages/auth-error.tsx` ships with lowercase keys (Pitfall 4 + Open Question 3) — Phase 2 emits UPPERCASE; example page is out-of-scope per CONTEXT.md.

### File Created
`.planning/phases/02-oauth-notifications-withdrawal-pin/02-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All deps in package.json, versions verified against npm registry |
| Architecture | HIGH | Patterns derived from already-shipped Phase 1 routes |
| Pitfalls | HIGH | Verified against codebase + arctic types + CONTEXT.md decisions |
| Validation | HIGH | Test framework + co-located pattern already in-tree |
| Security | HIGH | Every threat → named existing mitigation |

### Open Questions
1. Welcome notification inside vs outside the user-creation tx (recommend: outside; `createNotification` is dedupe-idempotent).
2. Should D-01 link path overwrite `User.name`/`avatarUrl` from Google (recommend: no, leave existing values alone).
3. Reconcile UPPERCASE D-06 codes with lowercase auth-error.tsx keys (recommend: Phase 2 emits UPPERCASE; example page is out-of-scope; flag for follow-up doc fix).
4. Granularity of arctic error codes (recommend: stick with the 5 D-06 codes; `OAUTH_GENERIC` covers `ArcticFetchError`/`UnexpectedResponseError`).

### Ready for Planning
Research complete. Recommend planner structure as **Wave 0** (4 helper modules: `error-redirect`, `cursor`, `prefs-merge`, `auth/pin`) → **Wave 1** (3 parallel plans: OAuth two routes + helpers, Notifications four routes + helpers, PIN one route file with POST+DELETE). Phase test gate is `pnpm format && pnpm lint && pnpm typecheck && pnpm test` per CLAUDE.md.
