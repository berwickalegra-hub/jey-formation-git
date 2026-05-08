// OAUTH-02 + OAUTH-03 — GET /api/auth/oauth/google/callback
//
// Sequence (from RESEARCH.md Pattern 3):
//   1. Provider env check         → OAUTH_PROVIDER_DISABLED
//   2. Read state + PKCE + next cookies (cleared on every exit branch)
//   3. State match strict equality → OAUTH_STATE_MISMATCH on any failure
//   4. validateAuthorizationCode(code, codeVerifier)
//      - OAuth2RequestError       → OAUTH_CODE_EXCHANGE_FAILED
//      - other thrown errors      → OAUTH_GENERIC + log.error
//   5. decodeIdToken(tokens.idToken()) — Pitfall 1: idToken is a METHOD, not a property
//   6. claims.email_verified !== true → GOOGLE_EMAIL_NOT_VERIFIED (CRITICAL — D-05)
//   7. Find-or-create:
//      a. OAuthAccount.findUnique({ provider_providerAccountId }) — returning user
//      b. else User.findUnique({ email }) — D-01 silent linking; leave User.name/avatarUrl untouched
//      c. else $transaction → User + OAuthAccount; isNewUser = true
//   8. setAuthCookies(access, refresh) + setCsrfCookie() — same as verify-email
//   9. If isNewUser: createNotification(prisma, welcomeNotification(userId, email)) — NOTIF-05 invariant
//   10. Consume app-oauth-next cookie (re-validate same-origin); fall back to APP_URL
//   11. Clear ephemeral cookies; 302 redirect
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { OAuth2RequestError } from 'arctic';
import { cookies } from 'next/headers';
import { tryCreateGoogleProvider, decodeIdToken } from '@/lib/server/oauth/google';
import { redirectToAuthError, isSameOriginNext } from '@/lib/server/oauth/error-redirect';
import {
  setAuthCookies,
  setCsrfCookie,
  createAccessToken,
  createRefreshToken,
} from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { createNotification } from '@/lib/server/notifications';
import { welcomeNotification } from '@/lib/server/notifications/templates';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

const COOKIE_PREFIX = process.env.COOKIE_PREFIX || 'app';
const OAUTH_STATE_COOKIE = `${COOKIE_PREFIX}-oauth-state`;
const OAUTH_PKCE_COOKIE = `${COOKIE_PREFIX}-oauth-pkce`;
const OAUTH_NEXT_COOKIE = `${COOKIE_PREFIX}-oauth-next`;

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

async function clearEphemeralCookies(): Promise<void> {
  const store = await cookies();
  const expireOpts = {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax' as const,
    path: '/api/auth/oauth',
    maxAge: 0,
  };
  store.set(OAUTH_STATE_COOKIE, '', expireOpts);
  store.set(OAUTH_PKCE_COOKIE, '', expireOpts);
  store.set(OAUTH_NEXT_COOKIE, '', expireOpts);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const appUrl = process.env.APP_URL ?? '';
    const redirectOpts = appUrl ? { appUrl } : {};

    const provider = tryCreateGoogleProvider();
    if (!provider) {
      await clearEphemeralCookies();
      return redirectToAuthError('OAUTH_PROVIDER_DISABLED', redirectOpts);
    }

    const url = req.nextUrl;
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const store = await cookies();
    const stateCookie = store.get(OAUTH_STATE_COOKIE)?.value;
    const pkceCookie = store.get(OAUTH_PKCE_COOKIE)?.value;
    const nextCookie = store.get(OAUTH_NEXT_COOKIE)?.value;

    if (!code || !state || !stateCookie || !pkceCookie || state !== stateCookie) {
      await clearEphemeralCookies();
      return redirectToAuthError('OAUTH_STATE_MISMATCH', redirectOpts);
    }

    let tokens: { idToken: () => string };
    try {
      tokens = (await provider.client.validateAuthorizationCode(code, pkceCookie)) as {
        idToken: () => string;
      };
    } catch (err) {
      await clearEphemeralCookies();
      if (err instanceof OAuth2RequestError) {
        log.warn('oauth.callback: code exchange failed', {
          code: err.code,
          description: err.description,
        });
        return redirectToAuthError('OAUTH_CODE_EXCHANGE_FAILED', redirectOpts);
      }
      log.error('oauth.callback: unexpected error', { err: String(err) });
      return redirectToAuthError('OAUTH_GENERIC', redirectOpts);
    }

    // Pitfall 1: idToken is a METHOD, not a property.
    const idToken = tokens.idToken();
    const claims = decodeIdToken(idToken);

    if (claims.email_verified !== true) {
      await clearEphemeralCookies();
      log.warn('oauth.callback: email_verified=false rejected', { sub: claims.sub });
      return redirectToAuthError('GOOGLE_EMAIL_NOT_VERIFIED', redirectOpts);
    }

    // ───── Find-or-create ─────────────────────────────────────────────────
    let userId: string;
    let isNewUser = false;
    const existingByProvider = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: { provider: 'google', providerAccountId: claims.sub },
      },
      select: { userId: true },
    });
    if (existingByProvider) {
      userId = existingByProvider.userId;
    } else {
      const normalizedEmail = claims.email.toLowerCase();
      const existingByEmail = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (existingByEmail) {
        // D-01 silent linking — leave User.name/avatarUrl untouched
        // (T-02-OAUTH-NAME-OVERWRITE mitigation).
        await prisma.oAuthAccount.create({
          data: {
            userId: existingByEmail.id,
            provider: 'google',
            providerAccountId: claims.sub,
          },
        });
        userId = existingByEmail.id;
      } else {
        // D-02 create path — User + OAuthAccount in a single $transaction
        const created = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              email: normalizedEmail,
              emailVerifiedAt: new Date(),
              name: claims.name ?? null,
              avatarUrl: claims.picture ?? null,
              passwordHash: null,
            },
            select: { id: true },
          });
          await tx.oAuthAccount.create({
            data: {
              userId: newUser.id,
              provider: 'google',
              providerAccountId: claims.sub,
            },
          });
          return newUser;
        });
        userId = created.id;
        isNewUser = true;
      }
    }

    // ───── Issue session cookies (mirrors verify-email/route.ts) ──────────
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, tokenVersion: true },
    });
    if (!u) {
      // Defensive — should never happen since we just created/linked.
      await clearEphemeralCookies();
      log.error('oauth.callback: user disappeared after create', { userId });
      return redirectToAuthError('OAUTH_GENERIC', redirectOpts);
    }
    const access = await createAccessToken({
      sub: u.id,
      email: u.email,
      tokenVersion: u.tokenVersion,
    });
    const refresh = await createRefreshToken(u.id, u.tokenVersion);
    await setAuthCookies(access, refresh);
    await setCsrfCookie();

    // D-03: welcome notification on first OAuth account creation.
    // NOTIF-05 invariant — go through createNotification (never prisma.notification.create directly).
    if (isNewUser) {
      await createNotification(prisma, welcomeNotification(u.id, u.email));
    }

    // Consume next cookie (defense-in-depth re-validation against same-origin).
    let target: string;
    if (nextCookie && appUrl) {
      // The cookie value is an absolute URL set by /start; extract pathname+search,
      // then re-validate via isSameOriginNext for defense-in-depth.
      let pathOnly: string | null = null;
      try {
        if (nextCookie.startsWith('/')) {
          pathOnly = nextCookie;
        } else {
          const parsed = new URL(nextCookie);
          pathOnly = `${parsed.pathname}${parsed.search}`;
        }
      } catch {
        pathOnly = null;
      }
      const validated = pathOnly ? isSameOriginNext(pathOnly, appUrl) : null;
      target = validated ?? appUrl;
    } else {
      target = appUrl || '/';
    }

    await clearEphemeralCookies();
    log.info('oauth.callback: success', { userId: u.id, isNewUser });
    return NextResponse.redirect(target, 302);
  });
}
