# Feature Landscape

**Domain:** Personal full-stack Next.js 16 monolith starter — SaaS, fintech/marketplace, content, internal tools
**Researched:** 2026-05-07
**Overall confidence:** MEDIUM-HIGH (ecosystem well-documented; anti-feature reasoning is inference + pattern analysis)

---

## Already Shipped — Table Stakes (Confirm Only)

These are validated in the template surface. Do not re-research or re-implement.

| Feature | Target Profiles | Status |
|---------|----------------|--------|
| Email/password auth (enumeration-resistant signup, 8-char code verify) | All | Shipped |
| Google OAuth 2.0 + PKCE via `arctic` | All | Shipped |
| Access JWT (15m) + refresh JWT (7d, path-scoped) + CSRF double-submit | All | Shipped |
| Per-email rate limits (10/15m login, 5/h signup) + global IP limiter | All | Shipped |
| Withdrawal advisory-lock + Serializable tx (race-free) | Fintech | Shipped |
| Withdrawal PIN (set/verify/delete) | Fintech | Shipped |
| Withdrawal guards: amount limits, daily cap, cooldown, KYC hooks | Fintech | Shipped |
| Bictorys payment + PaymentProvider interface + circuit breaker | SaaS/Fintech | Shipped |
| Webhook handler: raw-body HMAC, Serializable tx, idempotency dedup | All | Shipped |
| Outbox: atomic claim, 5-attempt backoff, DEAD state | All | Shipped |
| R2 file uploads: magic-byte mime sniff, proxy fallback | Content/SaaS | Shipped |
| Notifications: createNotification with dedup key, prefs | All | Shipped |
| Email queue: Resend, queue drain cron, Mailpit local dev | All | Shipped |
| Organizations + OrganizationMember (OWNER/ADMIN/MEMBER) | SaaS/Internal | Shipped |
| Admin back-office: users, orders, withdrawals, audit-log, role mgmt | All | Shipped |
| AdminAction audit log (logAdminAction on every mutation) | All | Shipped |
| Sentry (env-gated no-op, boots first in instrumentation.ts) | All | Shipped |
| /api/health (liveness) + /api/readyz (DB+Redis probe, 503 on fail) | All | Shipped |
| 5 Vercel cron routes: outbox-drain, email-drain, verify-cleanup, order-expiration, webhook-log-purge | All | Shipped |
| Redis rate-limit store (MemoryStore fallback in dev) | All | Shipped |
| Prisma 5 schema: User, OAuthAccount, VerificationCode, AdminAction, Organization, OrganizationMember, Order, Withdrawal, FileUpload, Notification, EmailJob, OutboxEvent, WebhookLog | All | Shipped |

---

## Table Stakes — Missing from Template

Features that 2026 peers (supastarter, makerkit, shipfast) ship or that the target profiles will demand, which the current template surface does not cover.

### 1. Email Magic Links

**Why expected:** In 2026, email+password is no longer a safe default UX assumption. Magic links are the standard passwordless fallback when passkeys aren't enrolled. Supastarter and makerkit both ship them. Consumer (content) and internal tools profiles benefit most — users log in infrequently and don't want password managers.

**What to add:** `POST /api/auth/magic-link` issues a one-use signed token (HMAC, 15min TTL, stored in VerificationCode table), `GET /api/auth/magic-link/verify` exchanges it for auth cookies. Fits the existing VerificationCode model with a new `type: MAGIC_LINK` discriminator.

**Complexity:** Low — uses existing crypto + VerificationCode infrastructure.

| Profile | Criticality |
|---------|------------|
| SaaS | Medium (users have accounts, password expected) |
| Fintech | Low (PIN + strong auth preferred) |
| Content | High (infrequent logins, frictionless UX matters) |
| Internal | High (admin/ops users hate password resets) |

**Confidence:** MEDIUM — inferred from 2026 pattern analysis; not verified against a single authoritative spec.

---

### 2. Passkeys / WebAuthn Registration + Login

**Why expected:** Passkeys are mainstream in 2026 (confirmed by multiple sources including Auth.js passkey provider, corbado, nblocks). FIDO2/WebAuthn is now the strongest available second factor and primary auth method. SaaS and fintech products are increasingly expected to offer it.

**Practical 2026 pattern:** Register passkey post-login as "upgrade to passkey", then allow passkey-first login. Magic link as fallback for unenrolled devices.

**What to add:** `POST /api/auth/passkey/register` (challenge + verification), `POST /api/auth/passkey/authenticate`. Add `PasskeyCredential` model (credentialId, publicKey, counter, userId).

**Complexity:** Medium — requires `@simplewebauthn/server` (server) + `@simplewebauthn/browser` (client). Well-documented pattern. Does NOT conflict with existing auth model; passkeys are a parallel credential type, same cookie issuance at the end.

**Risk:** WebAuthn challenge must be stored server-side (Redis or DB) per attempt. Replay attack prevention is inherent in the counter check. Do NOT store private keys — only public key + credential ID + counter.

| Profile | Criticality |
|---------|------------|
| SaaS | Medium-High (enterprise customers ask for it) |
| Fintech | High (strong auth = lower fraud liability) |
| Content | Low (UX complexity not worth it for casual users) |
| Internal | Medium (nice to have for admin users) |

**Confidence:** MEDIUM-HIGH — passkey mainstream adoption confirmed by multiple 2026 sources.

---

### 3. Simple Env-Based Feature Flags

**Why expected:** Every non-trivial SaaS and internal tool eventually needs feature gating (beta features, gradual rollouts, kill switches). The 2026 pattern for starters is to ship a minimal env-based flag layer — not LaunchDarkly — with hooks for upgrading to PostHog/Statsig later.

**What to add:** `lib/server/flags.ts` — a typed config object reading from `FEATURE_FLAGS` env var (JSON) or individual `FEATURE_*=1` vars. Provide `isFlagEnabled(flag, context?)` helper. No DB, no UI, no external dependency. The flag layer can be evaluated in route handlers and passed to the client via a `/api/flags` endpoint (authenticated) for client-side gating.

**Complexity:** Very low — 30-50 lines, zero new dependencies.

| Profile | Criticality |
|---------|------------|
| SaaS | High (beta features, tier-gated access) |
| Fintech | Medium (kill switches for payment methods) |
| Content | Low (mostly just show/hide features) |
| Internal | High (gradual rollouts to internal users) |

**Confidence:** HIGH — env-based flags are universally accepted as the minimal viable approach before a managed platform is justified.

---

### 4. Admin Outbox / Queue Visibility Endpoints

**Why expected:** The outbox is already implemented but is a black box to operators. When a payment webhook fails silently or an email never goes out, operators have no way to inspect the queue state without raw DB access. Mature starters expose queue visibility in their admin surface.

**What to add:** Two admin-gated endpoints (no UI required — headless):
- `GET /api/admin/outbox` — list OutboxEvent rows (filter by status: PENDING/DEAD/PROCESSED, type, date range, pagination)
- `GET /api/admin/email-queue` — list EmailJob rows (filter by status, recipient, date range)

These sit directly behind `requireAdmin` and `logAdminAction`. No new models needed — the tables already exist.

**Complexity:** Low — standard Prisma queries, same pattern as existing admin endpoints.

| Profile | Criticality |
|---------|------------|
| SaaS | High (email delivery is SLA-critical) |
| Fintech | High (payment side-effects must be traceable) |
| Content | Medium |
| Internal | Medium |

**Confidence:** HIGH — the existing models make this zero-cost to expose; the operational value is disproportionate to the implementation effort.

---

### 5. Admin Rate-Limit Hit Counter / Visibility

**Why expected:** Redis-backed rate limiting fires 429s but the admin has no visibility into who's hitting limits. For fintech and SaaS, repeated limit hits can indicate bot attacks, broken clients, or misconfigured integrations — all worth surfacing.

**What to add:** Increment a Redis counter `rl:hits:{route}:{date}` on every 429 response (non-invasive middleware hook). Expose `GET /api/admin/rate-limit-stats` returning per-route daily hit counts. Ephemeral (TTL 7d), no DB writes.

**Complexity:** Low — one middleware hook + one admin route. Uses existing Redis singleton.

| Profile | Criticality |
|---------|------------|
| SaaS | Medium |
| Fintech | High (bot/abuse detection) |
| Content | Low |
| Internal | Low |

**Confidence:** MEDIUM — pattern derived from operational best practices; no single authoritative source. Flagged as LOW-risk to implement but verify the Redis key design doesn't conflict with existing rate-limit store.

---

### 6. Structured Request Logging (Request ID Propagation)

**Why expected:** Next.js 15+ ships `instrumentation.ts` with OpenTelemetry hooks built in. Sentry captures exceptions but not structured request traces. For debugging production issues, a request ID that propagates from the route handler through all log lines (outbox, notifications, DB errors) is table stakes in 2026.

**What to add:** Generate `x-request-id` header (UUID v4) in middleware if not already present. Propagate via `AsyncLocalStorage` context into all `logger.*` calls. Log `requestId`, `userId` (if authed), `route`, `duration`, `status` on every request. Pino is the standard choice (already likely used in the template's logger).

**Complexity:** Low-Medium — AsyncLocalStorage context + Pino fields. Does NOT require OpenTelemetry infrastructure.

| Profile | Criticality |
|---------|------------|
| All | Medium — debugging without it is painful at scale |

**Confidence:** HIGH — request ID propagation is a universal production best practice; Next.js 15 AsyncLocalStorage is documented.

---

## Differentiators

Features that set this starter apart from T3/supastarter/makerkit. Recommend picking at most 1-2 for v1.

### D1. OpenTelemetry Traces (Recommended — Pick This)

**Value:** Sentry captures errors. OpenTelemetry captures the *path* — DB query times, Redis latency, auth flow duration per step. Next.js has first-class OTel support via `@vercel/otel`. Vercel's observability dashboard consumes traces automatically. For fintech and SaaS, slow payment flows and long DB queries are caught before users complain.

**Why ahead of peers:** Most starters ship Sentry only. Adding OTel via `@vercel/otel` in `instrumentation.ts` (15 lines) is a disproportionate observability gain. Sentry itself can consume OTel spans since Sentry SDK v8.

**Complexity:** Low — `npm install @vercel/otel`, one `instrumentation.ts` change, env-gated. Zero change to existing routes.

**Sources (verified):** Next.js official docs confirm `instrumentation.ts` is auto-detected since Next.js 15; `@vercel/otel` is the official package. MEDIUM-HIGH confidence.

| Profile | Value |
|---------|-------|
| SaaS | High |
| Fintech | High |
| Content | Medium |
| Internal | Medium |

---

### D2. Two-Factor Auth (TOTP) — Defer to Per-Project

**Value:** TOTP (Google Authenticator / Authy) is expected in fintech. High complexity: QR code generation, recovery codes, backup codes storage, enforce-2FA gating middleware.

**Recommendation:** Do NOT ship in starter. The enforcement logic is domain-specific (some apps enforce 2FA for withdrawals only, others for all logins). Ship passkeys (D above) instead — stronger security with lower implementation surface. Per-project 2FA can be added using `otplib` as needed.

---

## Anti-Features

Features to explicitly not build, with reasons.

### AF1. Stripe as Default Payment Provider

**Why avoid:** Stripe is US/EU-centric. This starter targets FCFA/Sénégal. Shipping a parallel Stripe adapter as the default alongside Bictorys creates surface that confuses which keys to configure and which webhook to mount. The `PaymentProvider` interface already provides the escape hatch. Each project wires its own provider.

**Instead:** Document the `PaymentProvider` interface as the extension point. Provide a stub `stripe.ts` example in `lib/server/payments/` with zero production code (just the interface shape) so projects know where to plug in.

**Applies to:** All profiles — but especially important not to bias the fintech profile toward Stripe when Bictorys is the real default.

---

### AF2. i18n (Internationalization)

**Why avoid:** next-intl and similar libraries add meaningful bundle weight and routing complexity (locale prefixes, message files, pluralization rules). Every fork has different target locales and different i18n strategies. Baking in one approach locks forks into a specific URL and file structure.

**Instead:** Document the extension point (next-intl is the go-to; add a `messages/` dir and `i18n.ts` config). Do not ship any i18n config in the starter.

**Applies to:** Content apps care most; internal tools and fintech rarely need multi-locale in v1.

---

### AF3. UI Component Library / Design System

**Why avoid:** The starter is headless by design. Shipping shadcn/ui, Radix, or any Tailwind component library assumes the fork's visual language. Each project brings its own. This is already stated in PROJECT.md and validated — do not drift from it.

**Instead:** Ship only utility classes (Tailwind 4 config) and zero component primitives. Reference `examples/` dir for shapes.

---

### AF4. Managed Feature Flag Service (LaunchDarkly, PostHog, Statsig)

**Why avoid:** These require account signup, API keys, and SDK initialization that ties the starter to a specific vendor. The value only materializes at 20+ flags, which no new project has. A simple env-based flag helper covers 100% of early-stage needs and adds zero dependencies.

**Instead:** Ship the minimal env-based `flags.ts` (see Table Stakes #3 above). Document the upgrade path to PostHog/Statsig in a code comment.

---

### AF5. TOTP / 2FA Out of the Box

**Why avoid:** Enforcement semantics are project-specific. Adding mandatory 2FA middleware to the starter either (a) breaks every fork that doesn't want it, or (b) ships as opt-in with so many caveats it's effectively dead code. Recovery codes require secure storage decisions (encrypt-at-rest with ENCRYPTION_KEY). The complexity-to-value ratio for a starter is poor.

**Instead:** Passkeys (WebAuthn, see Table Stakes #2) are stronger, simpler to implement, and phishing-resistant. TOTP is per-project.

---

### AF6. Subscription / Billing Plan Enforcement

**Why avoid:** SaaS billing plans (free tier, pro tier, limits per plan) are deeply domain-specific. How you define "a plan" depends on your product model. Supastarter ships this; it's also supastarter's most-complained-about coupling. Baking plan enforcement into routes means every fork that doesn't need subscriptions carries dead code that's hard to delete cleanly.

**Instead:** The `Order` model and `PaymentProvider` interface handle one-time payments. Per-project subscription logic gets added to the User model (e.g., `subscriptionStatus`, `subscriptionTier`) as domain fields. Document this as the intended extension point.

---

### AF7. Long-Running Worker Process

**Why avoid:** Already stated as Out of Scope in PROJECT.md — Vercel-first means route handlers + crons. Adding a Node worker as "optional" creates two deployment topologies to maintain. The outbox + Vercel cron achieves the same result within the Vercel constraint.

**Instead:** Document that for high-throughput jobs (>1000/min), self-hosters should wire a BullMQ worker consuming the OutboxEvent table — and point to the `outbox/dispatcher.ts` claim contract they must honor.

---

## Per-Profile Feature Criticality Matrix

| Feature | SaaS | Fintech | Content | Internal |
|---------|------|---------|---------|----------|
| Email+password auth | High | High | Medium | High |
| Google OAuth | High | Medium | High | High |
| Magic links | Medium | Low | High | High |
| Passkeys/WebAuthn | Medium-High | High | Low | Medium |
| Env feature flags | High | Medium | Low | High |
| Admin outbox visibility | High | High | Medium | Medium |
| Admin rate-limit stats | Medium | High | Low | Low |
| Structured request ID logging | Medium | High | Low | Medium |
| OTel traces | High | High | Medium | Medium |
| Organizations/multi-tenancy | High | Low | Low | Medium |
| Withdrawals + advisory lock | Low | High | Low | Low |
| Payments + webhook idempotency | High | High | Low | Low |
| Audit log (AdminAction) | Medium | High | Low | High |
| R2 file uploads | Low | Low | High | Low |
| Email notifications | High | High | High | Medium |
| TOTP/2FA | Low | High | Low | Low |
| Stripe adapter | Low | Low | Low | Low |
| i18n | Low | Low | Medium | Low |
| Subscription plan enforcement | High | Low | Low | Low |

---

## MVP Recommendation

**For v1 starter completion (in priority order):**

1. All "Already Shipped" features confirmed working (the port from amadou-template)
2. Admin outbox visibility endpoints — zero new models, disproportionate operational value
3. Structured request ID logging — AsyncLocalStorage + Pino, low effort
4. OTel via `@vercel/otel` in instrumentation.ts — 15 lines, Vercel-native
5. Env-based feature flags — `flags.ts`, 40 lines, zero deps
6. Email magic links — medium effort, unlocks content + internal profiles

**Defer to per-project:**
- Passkeys (medium complexity, only fintech/SaaS need it in v1)
- Rate-limit hit counters (useful but not blocking)
- TOTP/2FA (per-project enforcement semantics)

---

## Sources

- supastarter feature set: https://supastarter.dev/docs/nextjs (MEDIUM confidence — marketing page, verified against feature list)
- T3 Stack 2026 positioning: https://starterpick.com/blog/t3-stack-2026 (LOW confidence — third-party analysis)
- Passkeys mainstream 2026: https://securityboulevard.com/2026/03/magic-links-passkeys-otp-and-social-login-which-passwordless-method-fits-your-application/ (MEDIUM confidence)
- Auth.js passkey provider: https://authjs.dev/getting-started/providers/passkey (HIGH confidence — official docs)
- Next.js OTel official: https://nextjs.org/docs/app/guides/open-telemetry (HIGH confidence — official docs)
- Feature flags for starters: https://designrevision.com/blog/saas-feature-flags-guide (LOW confidence — aggregate blog)
- Makerkit vs supastarter comparison: https://supastarter.dev/supastarter-vs-makerkit (LOW confidence — vendor marketing)
- Background jobs Next.js Vercel: https://github.com/vercel/next.js/discussions/33989 (MEDIUM confidence — official GH discussion)
