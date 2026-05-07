// Source: RESEARCH.md Pattern 19 — D-15/D-16 email template factories.
// English by default (per D-15) — fork-edit to localize.
// Plain HTML (per D-16) — no MJML / React Email; per-project may swap.
//
// Phase 5's email-queue cron consumes outbox `email.*` events and calls these
// factories to produce the EmailJob row. Phase 1 just defines the factories
// and emits the outbox events.
import 'server-only';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface VerificationEmailArgs {
  code: string;
  email: string;
}

export interface ResetPasswordEmailArgs {
  code: string;
  email: string;
}

export function verificationEmail(args: VerificationEmailArgs): EmailTemplate {
  return {
    subject: 'Verify your email',
    html: `<p>Hi,</p><p>Your verification code is <strong>${args.code}</strong>.</p><p>It expires in 15 minutes. If you did not request this, ignore this email.</p>`,
    text: `Your verification code is ${args.code}. It expires in 15 minutes. If you did not request this, ignore this email.`,
  };
}

export function resetPasswordEmail(
  args: ResetPasswordEmailArgs,
): EmailTemplate {
  return {
    subject: 'Reset your password',
    html: `<p>Hi,</p><p>Your password reset code is <strong>${args.code}</strong>.</p><p>It expires in 15 minutes. If you did not request this, ignore this email.</p>`,
    text: `Your password reset code is ${args.code}. It expires in 15 minutes. If you did not request this, ignore this email.`,
  };
}
