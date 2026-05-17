// Source: RESEARCH.md Pattern 19 — D-15/D-16 email template factories.
// English by default (per D-15) — fork-edit to localize.
// Plain HTML (per D-16) — no MJML / React Email; per-project may swap.
//
// Phase 5's email-queue cron consumes outbox `email.*` events and calls these
// factories to produce the EmailJob row. Phase 1 just defines the factories
// and emits the outbox events.
//
// WR-03 — Defense-in-depth: ALL interpolated values in HTML strings MUST
// flow through `htmlEscape()`. The verification code is currently constrained
// to `[A-Z2-9]{8}` upstream (VERIFICATION_CODE_REGEX), so XSS is impossible
// today. But the function signature accepts `string` and future templates
// (e.g. password-changed notifications including the user's display name)
// will reuse this pattern — escape at the source so a careless add can't
// inject HTML. Plain-text body has no HTML interpretation, so no escape
// needed there.
//
// O1 audit fix — `expiresAt` is now threaded from the outbox payload so the
// rendered TTL matches `AUTH_VERIFICATION_TTL_MIN` (was hardcoded "15 minutes"
// which lied when operators tuned the env var).
import 'server-only';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface VerificationEmailArgs {
  code: string;
  email: string;
  /** Optional ISO-8601 expiry; falls back to "soon" wording when omitted. */
  expiresAt?: string;
}

export interface ResetPasswordEmailArgs {
  code: string;
  email: string;
  /** Optional ISO-8601 expiry; falls back to "soon" wording when omitted. */
  expiresAt?: string;
}

/**
 * Minimal HTML escape for template interpolation. Covers the OWASP-recommended
 * five-character set (`& < > " '`). Apply to EVERY user-controlled (or
 * potentially user-controlled) value before interpolating into an HTML
 * template string.
 */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the TTL window as "in N minutes" / "in N hours" — rounds to the
 * unit the user would actually read. Falls back to a vague "soon" when no
 * timestamp is provided or the parse fails (defensive: a malformed payload
 * should never break email rendering).
 *
 * Bias rounding toward the FLOOR so we never overstate the TTL: telling a
 * user "in 15 minutes" when 14m59s remain (and the code is about to expire)
 * leads to a frustrating retry loop. Floor it to "in 14 minutes" — they may
 * be earlier than promised, never later.
 */
function ttlWording(expiresAtIso: string | undefined): string {
  if (!expiresAtIso) return 'soon';
  const expiresMs = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresMs)) return 'soon';
  const remainingMs = expiresMs - Date.now();
  if (remainingMs <= 0) return 'soon'; // expired by the time we render; pre-cron drift
  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 1) return 'in less than a minute';
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

export function verificationEmail(args: VerificationEmailArgs): EmailTemplate {
  const code = htmlEscape(args.code);
  const ttl = ttlWording(args.expiresAt);
  return {
    subject: 'Verify your email',
    html: `<p>Hi,</p><p>Your verification code is <strong>${code}</strong>.</p><p>It expires ${ttl}. If you did not request this, ignore this email.</p>`,
    text: `Your verification code is ${args.code}. It expires ${ttl}. If you did not request this, ignore this email.`,
  };
}

export function resetPasswordEmail(args: ResetPasswordEmailArgs): EmailTemplate {
  const code = htmlEscape(args.code);
  const ttl = ttlWording(args.expiresAt);
  return {
    subject: 'Reset your password',
    html: `<p>Hi,</p><p>Your password reset code is <strong>${code}</strong>.</p><p>It expires ${ttl}. If you did not request this, ignore this email.</p>`,
    text: `Your password reset code is ${args.code}. It expires ${ttl}. If you did not request this, ignore this email.`,
  };
}
