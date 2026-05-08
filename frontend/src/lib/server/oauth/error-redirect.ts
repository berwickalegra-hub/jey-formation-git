// Phase 2 Plan 02-00 — OAuth error redirect helper.
//
// Wave 1 OAuth callback (Plan 02-01) imports redirectToAuthError() to bail out
// of failed code-exchange / unverified-email / state-mismatch paths to a
// frontend `/auth/error?code=<CODE>` page. The five UPPERCASE codes here are
// the D-06 contract (CONTEXT.md, locked) — never lowercase, never re-aliased.
//
// `isSameOriginNext` is the OAuth `?next=` validator. Pitfall 10 in
// 02-RESEARCH.md documents the `//evil.com` open-redirect bypass: a permissive
// validator that only checks `startsWith('/')` accepts protocol-relative URLs
// because the URL constructor parses `//evil.com` as `https://evil.com`. We
// reject `//`, any explicit scheme, and any post-resolve cross-origin result.
import 'server-only';
import { NextResponse } from 'next/server';

export type OAuthErrorCode =
  | 'GOOGLE_EMAIL_NOT_VERIFIED'
  | 'OAUTH_STATE_MISMATCH'
  | 'OAUTH_CODE_EXCHANGE_FAILED'
  | 'OAUTH_PROVIDER_DISABLED'
  | 'OAUTH_GENERIC';

export const OAUTH_ERROR_CODES: readonly OAuthErrorCode[] = [
  'GOOGLE_EMAIL_NOT_VERIFIED',
  'OAUTH_STATE_MISMATCH',
  'OAUTH_CODE_EXCHANGE_FAILED',
  'OAUTH_PROVIDER_DISABLED',
  'OAUTH_GENERIC',
] as const;

interface RedirectOpts {
  /** When provided, the Location header is an absolute URL. When omitted, a relative path is used. */
  appUrl?: string;
}

/**
 * Build a 302 redirect to `/auth/error?code=<CODE>`.
 *
 * The frontend reference page lives at examples/frontend-pages/auth-error.tsx
 * and switches on `code` (UPPERCASE). Status is locked at 302 so the browser
 * issues a fresh GET — 307/308 would replay the OAuth callback's GET, which
 * is fine but `Location` semantics are clearer with 302 for "go away, here is
 * the new URL".
 *
 * `NextResponse.redirect` requires an absolute URL, so when `opts.appUrl` is
 * not supplied we read `process.env.APP_URL` and fall back to `http://localhost`
 * (test/dev only). The Wave 1 OAuth callback always has APP_URL set in prod
 * (it is required by env validation), so this fallback is never hit at
 * runtime.
 */
export function redirectToAuthError(code: OAuthErrorCode, opts: RedirectOpts = {}): NextResponse {
  const path = `/auth/error?code=${encodeURIComponent(code)}`;
  const base = opts.appUrl ?? process.env.APP_URL ?? 'http://localhost';
  const target = new URL(path, base).toString();
  return NextResponse.redirect(target, 302);
}

/**
 * Same-origin guard for OAuth `?next=` parameter (Pitfall 10).
 *
 * Rejects:
 *  - null/undefined/empty
 *  - protocol-relative URLs (`//evil.com/...`) — the well-known bypass
 *  - explicit scheme (`http://`, `https://`, `javascript:`, `data:`, ...)
 *  - bare paths without a leading `/`
 *  - any path whose resolved origin differs from APP_URL's origin
 *
 * Returns the absolute URL string on success, or `null` on rejection so the
 * caller can fall back to a safe default (typically `/`). NEVER return the
 * raw input — always return the URL constructor's normalised form so any
 * upstream path-traversal (`/foo/../..`) is collapsed before redirect.
 */
export function isSameOriginNext(next: string | null | undefined, appUrl: string): string | null {
  if (next === null || next === undefined || next === '') return null;
  // Protocol-relative URL — the classic open-redirect bypass.
  if (next.startsWith('//')) return null;
  // Any explicit URL with scheme://host (http, https, ws, ftp, ...)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(next)) return null;
  // Any other URI scheme without // (javascript:, data:, mailto:, ...)
  if (/^[a-z][a-z0-9+.-]*:/i.test(next)) return null;
  // Must be a server-relative path.
  if (!next.startsWith('/')) return null;

  try {
    const base = new URL(appUrl);
    const resolved = new URL(next, appUrl);
    if (resolved.origin !== base.origin) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}
