# Phase 1: Auth Routes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 01-auth-routes
**Areas presented:** Tuning defaults, Password policy, Email templates, Test strategy

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Tuning defaults | Verification code TTL, lockout threshold + duration, rate limits for forgot/reset/resend/verify | (delegated — "a toi de voir") |
| Password policy | Minimum length, complexity, HIBP, expiry | (delegated) |
| Email templates | FR / EN / both / per-project; template engine | (delegated) |
| Test strategy | Mock Prisma vs real Postgres vs both; setup-files placement | (delegated) |

**User's choice:** "a toi de voir" (your call). All four delegated to Claude with reasoning recorded inline before writing CONTEXT.md.

**Notes:** Same delegation pattern as Phase 0. With "quality over speed" stated at init and no specific project waiting, picked NIST-aligned defaults that minimize per-project churn.

---

## Tuning defaults

| Question | Selected | Rejected |
|----------|----------|----------|
| Verification code TTL | **15 min** | 10 min (too tight for spam folder retrieval), 1 h (too long an attack window) |
| Failed-login lockout threshold | **5 failures** | 3 (false-positive risk on user typos), 10 (too lenient — gives brute-forcer 10 free guesses) |
| Lockout duration | **15 min** | 1 h (UX hurt), permanent (CS support load) |
| Forgot-password rate limit | **3 / hour per email** | 1 / hour (genuine users locked out), 10 / hour (enumeration spam tolerated) |
| Reset-password code attempts | **5 / 15 min** | 3 (typo risk), 10 (brute-forcing the code becomes feasible) |
| Resend verification | **3 / hour** | 1 / hour (UX hurt for users with email-delivery issues) |
| Verify-email retries | **5 / 15 min** | matches reset pattern |

All values surface as env vars; defaults baked into `.env.example`.

## Password policy

| Question | Selected | Rejected |
|----------|----------|----------|
| Minimum length | **10 chars** | 8 (too short for 2026 standards), 12 (UX hurt without security gain at this length) |
| Complexity rules | **None** (NIST 800-63B) | Required mixed case + digit + symbol (NIST explicitly recommends against — reduces entropy) |
| Banned-password list | **~100-entry embedded list** | None (too lenient), 1M-entry list (deps + bundle size cost) |
| HIBP haveibeenpwned check | **Opt-in via env, default OFF** | Always on (external API dep), never (loses defense-in-depth) |
| Password expiry | **None** (NIST 800-63B) | 90-day rotation (forces predictable patterns) |

## Email templates

| Question | Selected | Rejected |
|----------|----------|----------|
| Default language | **English** | French-only (template was Sénégal-focused, but starter targets multi-region), bilingual (i18n machinery overkill for v1) |
| Override pattern | **Edit `templates.ts` in fork** | Locale-file system (`templates.fr.ts`), env-driven locale switch (overkill for personal starter) |
| Template engine | **Plain HTML strings** | MJML, React Email (heavyweight for v1; per-project can swap) |

## Test strategy

| Question | Selected | Rejected |
|----------|----------|----------|
| Auth route unit tests | **Mock Prisma** | Hit real DB per-test (slow, brittle) |
| Integration tests | **Defer** to Phase 4+ | Spin Postgres in CI now (no Phase 1 invariants need it) |
| Vitest setup-files for env fixtures | **Move to Phase 1** | Keep in Phase 6 (auth tests can't run without JWT_SECRET / ENCRYPTION_KEY fixtures) |
| Test file location | **Co-located** (`route.test.ts` next to `route.ts`) | `__tests__/` directory (project convention is co-located per CONVENTIONS.md) |

**Cross-phase impact:** Phase 6 TEST-01 narrows to test-suite expansion + smoke E2E; the Vitest env-fixture surface lands in Phase 1 since auth tests require it. Roadmap traceability adjusted via D-27.

---

## Claude's Discretion (not surfaced as gray areas)

- Banned-passwords file location — `lib/server/auth/banned-passwords.ts` recommended; planner picks based on cohesion
- Whether `useUser` React hook ships in this phase — NO (per-project frontend concern)
- Coverage thresholds — no minimum bar; reasonable coverage of 4 invariants per route
- Whether to mock `next/headers` cookies globally in vitest.setup.ts — let planner decide based on test count

## Deferred Ideas

- Magic-link login → AUTH-V2-01
- Passkeys / WebAuthn → AUTH-V2-02
- 2FA / TOTP → out of scope (anti-feature)
- DB-backed session table for revocation → tokenVersion bump suffices in v1
- Real-Postgres integration tests for auth → Phase 4 surface
- i18n machinery for email templates → fork-edit is the override
- Brute-force prevention beyond per-email limits → Vercel + Cloudflare per-project
