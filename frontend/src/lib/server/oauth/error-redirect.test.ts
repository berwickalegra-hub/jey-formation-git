// Tests for the OAuth error-redirect helper (Phase 2 Plan 02-00, D-06 codes).
//
// Code list is locked by CONTEXT.md; assertions here treat the UPPERCASE
// strings as a public contract because Wave 1 OAuth callback route (Plan 02-01)
// imports redirectToAuthError and Wave 1 must not have to re-derive the
// casing.
import { describe, it, expect } from 'vitest';
import {
  redirectToAuthError,
  isSameOriginNext,
  OAUTH_ERROR_CODES,
  type OAuthErrorCode,
} from './error-redirect';

describe('redirectToAuthError', () => {
  it('returns 302 redirect with /auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED', () => {
    const res = redirectToAuthError('GOOGLE_EMAIL_NOT_VERIFIED');
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(location!.endsWith('/auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED')).toBe(true);
  });

  it.each(OAUTH_ERROR_CODES)(
    'parametric: code=%s produces 302 with matching ?code= query param',
    (code: OAuthErrorCode) => {
      const res = redirectToAuthError(code);
      expect(res.status).toBe(302);
      const location = res.headers.get('location');
      expect(location).not.toBeNull();
      expect(location).toContain(`?code=${code}`);
    },
  );

  it('builds absolute URL when appUrl is provided', () => {
    const res = redirectToAuthError('OAUTH_GENERIC', { appUrl: 'https://app.example.com' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example.com/auth/error?code=OAUTH_GENERIC',
    );
  });
});

describe('isSameOriginNext', () => {
  const APP_URL = 'https://app.example.com';

  it('accepts a same-origin path and returns the absolute URL', () => {
    expect(isSameOriginNext('/dashboard', APP_URL)).toBe('https://app.example.com/dashboard');
  });

  it('rejects protocol-relative URL `//evil.com/oops`', () => {
    expect(isSameOriginNext('//evil.com/oops', APP_URL)).toBeNull();
  });

  it('rejects http://evil.com', () => {
    expect(isSameOriginNext('http://evil.com', APP_URL)).toBeNull();
  });

  it('rejects https://evil.com/x', () => {
    expect(isSameOriginNext('https://evil.com/x', APP_URL)).toBeNull();
  });

  it('accepts a path with a space and returns an encoded URL', () => {
    const out = isSameOriginNext('/foo bar', APP_URL);
    expect(out).not.toBeNull();
    // URL constructor encodes the space; assert it is well-formed and same origin.
    expect(out!.startsWith('https://app.example.com/foo')).toBe(true);
    expect(out!.includes('%20') || out!.includes('+')).toBe(true);
  });

  it('rejects javascript:alert(1)', () => {
    expect(isSameOriginNext('javascript:alert(1)', APP_URL)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(isSameOriginNext(null, APP_URL)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(isSameOriginNext(undefined, APP_URL)).toBeNull();
  });

  it('returns null for empty string input', () => {
    expect(isSameOriginNext('', APP_URL)).toBeNull();
  });

  it('rejects data: URI scheme', () => {
    expect(isSameOriginNext('data:text/html,<script>', APP_URL)).toBeNull();
  });

  it('rejects bare path without leading slash', () => {
    expect(isSameOriginNext('dashboard', APP_URL)).toBeNull();
  });
});
