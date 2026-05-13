---
name: izisaas-payments-handler
description: Use when integrating Stripe, Moneroo, Bictorys, or PayTech (Card + Mobile Money) in a Node.js / Express / Next.js app — Stripe for worldwide cards (subscriptions, one-shot, hosted Checkout, inline Elements/PaymentIntent, Customer Portal), and Moneroo/Bictorys/PayTech for African markets (UEMOA, SN, CI, ML, BF, TG, BJ, CM). Covers credential storage (AES-256-GCM), checkout initialization, hosted-redirect AND inline flows, signature verification (Stripe constructEvent, Moneroo X-Moneroo-Signature, Bictorys X-Webhook-Signature / X-Secret-Key, PayTech HMAC + SHA256-of-keys), idempotent fulfillment, subscription lifecycle (cancel period-end vs immediate, reactivate, Customer Portal), apiVersion pinning, test/live key separation, currency XOF/XAF/USD/EUR with zero-decimal handling, Bictorys WAF/TLS workaround, PayTech form-encoded IPN. Drop-in TypeScript adapters for all four providers.
---

# Stripe + Bictorys + Moneroo + PayTech Handler

A complete, production-tested integration guide for accepting payments worldwide and across West & Central Africa via four hosted-checkout / inline providers:

- **Stripe** — worldwide cards (USD/EUR/GBP/XOF/XAF/...), best-in-class for recurring billing of any kind (SaaS subscriptions, memberships, donations, prepaid plans), hosted Checkout AND inline Elements/PaymentIntent.
- **Moneroo** — multi-provider hosted aggregator covering all of Africa (mobile money + card).
- **Bictorys** — UEMOA-focused mobile money + card hosted checkout.
- **PayTech** — Senegal-based aggregator for SN/CI/ML/BJ (Wave, Orange Money, Free Money, MTN, card).

The reference implementation in this skill powers a live BYOK (Bring-Your-Own-Keys) marketplace where merchants plug their own provider credentials. It handles every gotcha the docs don't mention.

## When to use

- Building a SaaS subscription, an e-commerce one-shot, a marketplace, or any payment surface that needs **cards worldwide** (Stripe) AND/OR **African mobile money** (Moneroo / Bictorys / PayTech).
- Implementing a marketplace where each merchant connects their own Stripe / Moneroo / Bictorys / PayTech keys (BYOK).
- Verifying webhooks across providers — Stripe's `constructEvent` for HMAC-SHA256 with replay window, custom HMAC verification for the African providers (the docs are incomplete; this skill has the exact algorithms).
- Implementing **subscription lifecycle**: cancel-at-period-end vs immediate, reactivation, Customer Portal, dunning on `invoice.payment_failed`.
- Implementing **inline checkout** with Stripe Elements (PaymentIntent flow) so the buyer never leaves your app.
- Diagnosing `403 Forbidden` from Bictorys with an HTML response (AWS WAF TLS fingerprint).
- Diagnosing `application/x-www-form-urlencoded` IPN bodies from PayTech (the docs imply JSON; reality is form-encoded by default).
- Diagnosing Stripe `resource_missing` after switching test/live keys (customer/product/price IDs are partitioned per environment).
- Storing API keys at rest with AES-256-GCM and supporting key rotation.

**Don't use this skill for:** in-app SDK / Direct API flows from each provider's mobile SDK (this skill covers server-side integrations + Stripe Elements). Stripe Connect / multi-party payouts are out of scope for V1.

## Quick Decision Tree

```
Use case?
├── Recurring billing (any kind) ──────► Stripe (hosted Checkout or inline Elements)
├── One-shot card, worldwide ──────────► Stripe (mode: payment) OR Bictorys card
├── One-shot mobile money, UEMOA ──────► Bictorys MoMo (SN/CI) → PayTech (ML/BJ) → Moneroo (BF/TG)
├── Mobile money, CEMAC (XAF) ─────────► Moneroo (only one with XAF MoMo)
└── Other African MoMo countries ──────► Moneroo
```

| Provider          | Currency           | MoMo Coverage              | Subscription | Card | Hosted page | Inline (Elements) | Auth                             |
| ----------------- | ------------------ | -------------------------- | ------------ | ---- | ----------- | ----------------- | -------------------------------- |
| **Stripe**        | USD/EUR/XOF/XAF/...| —                          | ✓ first-class| ✓    | ✓ (Checkout)| ✓ (Elements / PI) | `Authorization: Bearer sk_*`     |
| **Moneroo**       | XOF/XAF/USD/EUR    | All Africa MoMo + card     | —            | ✓    | ✓           | —                 | `Authorization: Bearer <key>`    |
| **Bictorys MoMo** | XOF                | UEMOA strict (6 countries) | —            | —    | ✓           | —                 | `X-Api-Key` header               |
| **Bictorys Card** | XOF/XAF            | —                          | —            | ✓    | ✓ (worldwide buyer) | —          | `X-Api-Key` header               |
| **PayTech**       | XOF                | SN, CI, ML, BJ (partial)   | —            | ✓    | ✓           | —                 | `API_KEY` + `API_SECRET` headers |

**Default routing for V1**:
- **Subscriptions** → Stripe (only adapter here with first-class recurring billing).
- **One-shot card** → Stripe for international buyers, Bictorys card if your merchant entity is UEMOA-registered and you want lower fees on local cards.
- **Mobile money** → Bictorys for SN/CI, PayTech for ML/BJ, Moneroo for BF/TG and CEMAC. The country-based router lives in your `getMobileProviderForCountry()` helper.

## Architecture (5-minute version)

```
┌─────────┐   1. POST /checkout    ┌─────────────┐
│ Frontend│ ─────────────────────► │  Your API   │
└─────────┘ ◄─────────────────────  └──────┬──────┘
            5. { checkoutUrl }            │
                                          │ 2. decrypt creds
                                          │ 3. insert pending payment row
                                          │ 4. call adapter.initiatePayment()
                                          │
                                   ┌──────▼──────┐
                                   │   Provider  │ (Stripe / Moneroo / Bictorys / PayTech)
                                   └──────┬──────┘
                                          │ 6. user redirected to hosted page
                                          │ 7. user pays
                                          │ 8. provider POSTs IPN / webhook
                                          ▼
                                   ┌─────────────┐
                                   │  Your API   │
                                   │  /webhooks  │  ─► verify signature
                                   └──────┬──────┘     ─► dedup eventId
                                          │            ─► amount tampering check
                                          │            ─► UPDATE row + grant entitlement
                                          ▼
                                   ┌─────────────┐
                                   │  Database   │
                                   └─────────────┘
```

**Key invariants (all four providers):**

1. Insert `payments` (or `subscriptions` for recurring) row with `status='pending'` BEFORE calling the provider. The webhook may arrive before the HTTP response.
2. Pass your row's UUID as the provider's reference field: `metadata.{...,order_id}` (Stripe Checkout / PaymentIntent), `paymentReference` (Bictorys), `metadata.paymentId` (Moneroo), `ref_command` + `custom_field` (PayTech).
3. The webhook returns the provider's transaction ID. Store both your UUID and theirs:
   - **Stripe**: `cs_…` (Checkout Session), `pi_…` (PaymentIntent), `sub_…` (Subscription), `in_…` (Invoice).
   - **Moneroo**: `id` from the response.
   - **Bictorys**: `paymentReference` echoed.
   - **PayTech**: `token`.
4. Verify the signature with `crypto.timingSafeEqual` over the **raw body** for Moneroo and Bictorys; use `stripe.webhooks.constructEvent` for Stripe (it does the timing-safe HMAC + replay-window check internally); PayTech's signature is field-based so the raw body isn't needed for the signature itself but IS needed for dedup.
5. Dedup webhooks via Stripe's native `event.id` (Stripe sends a stable id) OR `synthetic-${sha256(rawBody).slice(0,32)}` for the African providers.
6. Re-query the provider's API for defense-in-depth before granting entitlement:
   - **Stripe**: usually unnecessary — `constructEvent` with the webhook secret is a true signature; re-query only if the secret is shared more widely than the API key.
   - **Moneroo**: recommended (HMAC over raw body is safe but the live API call is cheap insurance).
   - **PayTech**: supported by the adapter, recommended whenever your account is in the SHA256-of-keys signing mode (echo of `sha256(apiKey)` + `sha256(apiSecret)` is a shared-secret echo, not a true signature — re-query closes the gap if the keys ever leak). Optional but encouraged in HMAC mode.
   - **Bictorys**: skip — their WAF blocks server-IP follow-up calls.

## Implementation Checklist

Follow this order. Each step links to a reference file.

- [ ] **1. Set up credential storage** — generate `BYOK_ENCRYPTION_KEY`, create `payment_connections` table → see [`references/encryption.md`](references/encryption.md)
- [ ] **2. Create database schema** — `payments` table with all fields, plus per-provider columns where needed (e.g. `stripeCustomerId`, `stripeSubscriptionId`) → see [`references/database.md`](references/database.md)
- [ ] **3. Add Stripe adapter** — copy [`examples/stripe.ts`](examples/stripe.ts), pin `apiVersion`, mirror test/live key columns → see [`references/stripe.md`](references/stripe.md)
- [ ] **4. Add Moneroo adapter** — copy [`examples/moneroo.ts`](examples/moneroo.ts), set Zod schema → see [`references/moneroo.md`](references/moneroo.md)
- [ ] **5. Add Bictorys adapter** — copy [`examples/bictorys.ts`](examples/bictorys.ts), keep the `curl` workaround unchanged → see [`references/bictorys.md`](references/bictorys.md)
- [ ] **6. Add PayTech adapter** — copy [`examples/paytech.ts`](examples/paytech.ts), wire form-encoded body parsing for the IPN → see [`references/paytech.md`](references/paytech.md)
- [ ] **7. Wire Express raw-body middleware** — required for HMAC over raw bytes (Stripe also needs `express.raw({type:'application/json'})` on the webhook route specifically) → see [`references/webhooks.md`](references/webhooks.md)
- [ ] **8. Add checkout route** — copy [`examples/checkout-route.ts`](examples/checkout-route.ts) and route by `provider` → orchestrates: validate → decrypt → insert pending → call provider → respond
- [ ] **9. Add webhook receiver** — copy [`examples/webhook-handler.ts`](examples/webhook-handler.ts) → verify signature per provider → dedup → re-query (Moneroo/PayTech) → grant entitlement
- [ ] **10. Test sandbox first** — Stripe: separate sandbox via `sk_test_`/`pk_test_`/`whsec_test_`. Moneroo: separate sandbox keys. Bictorys: `test_` prefix routes to `api.test.bictorys.com`. PayTech: same URL, toggle via `env: "test"` field in body (sandbox keys requested separately from PayTech support).
- [ ] **11. Configure webhook URLs** in each provider dashboard: `https://your.api/webhooks/{provider}/{connectionId}`
- [ ] **12. For Stripe: register the events you handle** (checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted) and pin the `apiVersion` on the webhook endpoint to match your client.
- [ ] **13. For PayTech: enable HMAC mode in the dashboard** if available (more secure than the default SHA256-of-keys echo).
- [ ] **14. Smoke test** — small amount end-to-end on each provider, verify entitlement granted exactly once even if webhook is replayed.

## Critical Gotchas (read this section, then re-read it)

### Stripe: pin the `apiVersion` explicitly

```ts
new Stripe(secretKey, { apiVersion: "2025-11-17.clover" });
```

If you don't pin, Stripe applies the default for your account (the version it had at creation time). When Stripe rotates the default, your code breaks invisibly. Pinning makes upgrades intentional. The adapter's `STRIPE_API_VERSION` constant is the single source of truth — bump it on purpose, run your test suite, deploy.

Common breakage on upgrades: Invoice's `subscription` field moved to `parent.subscription_details.subscription` in 2025-x. The adapter's `getInvoiceSubscriptionId(invoice)` helper handles both shapes.

### Stripe: test and live data are fully partitioned

A `cus_…`, `prod_…`, `price_…`, `sub_…` created in test mode does NOT exist when authenticating with `sk_live_`. Common pitfall: dev environment writes `stripeCustomerId` for a user, prod inherits the row (e.g. via DB clone), prod tries to retrieve the customer with a live key → `resource_missing`.

**Mitigation pattern**: mirror every Stripe ID with a `*Test` companion column (`stripeCustomerId` + `stripeCustomerIdTest`, `stripeProductId` + `stripeProductIdTest`, etc.). Pick the right column based on which key set is active. The adapter's `getOrCreateCustomer` returns `testLiveMismatch: true` on `resource_missing` — clear and retry.

### Stripe: `invoice.paid` and `checkout.session.completed` order is unstable

For a brand-new subscription paid via Stripe-hosted Checkout, the two events fire in undefined order. Make every handler **independently idempotent**: hash the `event.id` for dedup, guard your DB UPDATE with `WHERE status = 'pending'`, and re-run safely.

For inline-PaymentIntent subscriptions, `invoice.paid` lands first; activation should hinge on `invoice.paid` with `billing_reason === "subscription_create"`.

### Stripe: redirects fire before webhooks

`success_url` is **not** authoritative. The buyer can replay the URL, and the redirect can land before the webhook. Use `verifySession` only for UX hints ("your order is being processed"). Wait for the webhook (`checkout.session.completed` or `invoice.paid`) before granting entitlement.

### Stripe: zero-decimal currencies

```
USD, EUR, GBP, …  → unit_amount in CENTS:        $29.99 → 2999
JPY, KRW, XOF,    → unit_amount in INTEGER UNITS: 5000 XOF → 5000
XAF, VND, …
```

The adapter ships `toStripeAmount(amount, currency)` and `fromStripeAmount(amount, currency)` for the conversion. Common bug: hard-coding `* 100` and silently overcharging XOF buyers 100x.

### Stripe: webhook raw body trick

Stripe signs the bytes, not the parsed JSON. In Express:

```ts
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }), // ← essential, only on this route
  handler,
);
```

In Next.js App Router:

```ts
export const runtime = "nodejs";
export async function POST(req: Request) {
  const rawBody = await req.text();             // ← .text() not .json()
  const sig = req.headers.get("stripe-signature")!;
  const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
}
```

Don't reach for HMAC manually — `constructEvent` does timing-safe verification + a 5-minute timestamp tolerance against replay.

### Bictorys WAF blocks Node `fetch`

Bictorys sits behind AWS ALB + WAF Bot Control. Node's `undici` (default `fetch`) has a JA3/JA4 TLS fingerprint that the WAF flags. You'll get **`403 Forbidden`** with an HTML body and no useful error. **Fix: spawn `curl` as a subprocess** with minimal args. Don't add `-s`, `-A`, `--noproxy`, `Accept`, `User-Agent` — any of those changes the fingerprint enough to be flagged again. See `examples/bictorys.ts`.

### Bictorys is case-sensitive on `ErrorRedirectUrl`

The Direct API docs spell it `errorRedirectUrl` (camelCase). Reality: depending on the endpoint version, the WAF or backend rejects camelCase. **Send both: `errorRedirectUrl` AND `ErrorRedirectUrl` in the JSON body.** Yes both. Both.

### Bictorys `country` is hardcoded to the merchant's country

Even if the buyer is in another country, `country: "SN"` (or whatever the merchant is in) goes both at the body root AND inside `customerObject`. The card hosted page works worldwide regardless.

### Moneroo customer.first_name / last_name are required

Moneroo will silently 400 if you only send `customer.email`. Always split a single name into first/last (fallback `"-"` for last if missing). And make sure `customer.email` is present — if your auth flow allows nameless or emailless members, gate the checkout earlier.

### PayTech: the IPN body is `application/x-www-form-urlencoded` by default

The PayTech docs imply JSON. Reality: most accounts ship IPNs as form-encoded data, and `item_price` arrives as a string (`"5000"`) instead of a number. Your handler MUST sniff the `Content-Type` and branch on it:

```ts
const ct = request.headers.get("content-type") || "";
const body = ct.includes("application/x-www-form-urlencoded")
  ? Object.fromEntries((await request.formData()).entries())
  : await request.json();
const price = parseInt(body.item_price as string, 10);
```

### PayTech: two custom auth headers, both required

PayTech does NOT use `Authorization: Bearer ...`. It uses **two custom headers, both uppercase with underscore**: `API_KEY` and `API_SECRET`. Sending only `API_KEY` returns a confusing 401 with no useful message.

### PayTech: signature verification has TWO methods, both must be supported

The dashboard's HMAC toggle controls whether `hmac_compute` is sent. Older / un-toggled accounts only ship `api_key_sha256` and `api_secret_sha256` — a shared-secret echo, not a true signature. Your verifier must accept either:

```ts
// Method 1 (preferred, only if hmac_compute is in payload):
//   message  = `${item_price}|${ref_command}|${apiKey}`
//   expected = HMAC_SHA256_hex(message, apiSecret)
//   compare timing-safe vs payload.hmac_compute

// Method 2 (always present):
//   sha256(apiKey)    === payload.api_key_sha256
//   sha256(apiSecret) === payload.api_secret_sha256
```

See `examples/paytech.ts:verifyPaytechIPN` for the full implementation.

### PayTech: `item_price` concatenation gotcha for HMAC

The HMAC message uses the literal `item_price` field as it appears in the payload. When form-encoded, that's `"5000"` (string). When JSON, that's `5000` (number). Coerce to string consistently before building the HMAC message. Otherwise `String(5000)` ≠ `"5000"` checks will silently pass, but a value of `5000.00` from a buggy gateway will fail.

### PayTech: fees are 3%, absorbed by the merchant

If you want to receive the full `gross` amount in your wallet, charge the buyer `gross / (1 - 0.03)`. Most apps just absorb the fee and charge the buyer the gross amount, accepting that the wallet credit will be ~3% lower. The skill's adapter does NOT auto-adjust — pass the amount you want PayTech to charge the buyer. Add a 5% tolerance in your amount-tampering check on the IPN to absorb fee variance.

### PayTech: `ipn_url` should always be HTTPS and public

A common defensive pattern is to rewrite `http://` → `https://` before submission and use ngrok / Cloudflare Tunnel in dev. Whether PayTech rejects HTTP / localhost outright at submission time varies by account — don't rely on it. Always use HTTPS in prod. Bictorys's WAF, by contrast, **does** reject bodies containing localhost-looking values; that one is a hard reject.

### Webhook header conventions differ per provider

| Provider    | Signature header(s)                                       | Algorithm                                                                   |
| ----------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Stripe      | `Stripe-Signature` (timestamp + scheme + signature)       | Use `stripe.webhooks.constructEvent` — handles HMAC-SHA256 + 5-min replay tolerance internally |
| Moneroo     | `X-Moneroo-Signature`                                     | `hex(HMAC_SHA256(rawBody, webhookSecret))`                                  |
| Bictorys    | `X-Webhook-Signature` + `X-Webhook-Timestamp` (HMAC mode) | `hex(HMAC_SHA256(\`${ts}.${rawBody}\`, ws))`                                |
| Bictorys    | `X-Secret-Key` (legacy / fallback mode)                   | constant-time string compare with secret                                    |
| PayTech (1) | `hmac_compute` IN BODY (not header) — HMAC mode           | `hex(HMAC_SHA256(\`${item_price}\|${ref_command}\|${apiKey}\`, apiSecret))` |
| PayTech (2) | `api_key_sha256` + `api_secret_sha256` IN BODY — fallback | `sha256(apiKey)` and `sha256(apiSecret)` echo                               |

Bictorys ships with the static `X-Secret-Key` mode by default. HMAC mode must be explicitly turned on in the dashboard. **Support both.** The HMAC timestamp tolerance is ±5 minutes and timestamps may arrive in seconds OR milliseconds — auto-detect: if `parseInt(ts) < 10_000_000_000` it's seconds, multiply by 1000.

PayTech ships with the SHA256-of-keys mode by default; HMAC mode is a dashboard toggle. **Support both.**

### Raw body capture is non-negotiable for Moneroo and Bictorys

Express's `express.json()` parses and discards the bytes. HMAC over `JSON.stringify(req.body)` will fail because field ordering and whitespace differ. Capture the buffer:

```ts
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);
```

For PayTech the verification doesn't operate on the raw body (the HMAC message is constructed from named fields), but you still want the raw body for dedup hashing. Capture it the same way.

### Idempotency

Provider webhooks fire 2-5 times in normal operation and indefinitely on retry. Implement these layers:

1. **Event-level dedup**: hash the raw body, store `synthetic-${sha256.slice(0,32)}` in a 24h TTL table, ignore replays.
2. **Status-level idempotency**: `UPDATE payments SET status='completed' WHERE id=? AND status='pending'`. The `WHERE` clause is the safety net.
3. **Fulfillment guard**: re-fetch the record being fulfilled (order, entitlement, ticket, credits, etc.) and only grant if not already in the target state.

This applies identically to all three providers.

### Amount tampering

The webhook payload includes the amount field (`data.amount` Moneroo, `amount` Bictorys, `item_price` PayTech). Compare to the `payments` row inserted at checkout. If they diverge:

- **Moneroo / Bictorys**: refuse the webhook (log it, do NOT grant). They settle in full.
- **PayTech**: allow ±5% tolerance for fee variance, refuse anything outside that window.

## Currency choice

Hardcoded mapping (UEMOA/CEMAC are the only relevant zones for these providers):

```ts
const currency: "XOF" | "XAF" = merchant.country === "CM" ? "XAF" : "XOF";
```

| Provider      | XOF | XAF | Other           |
| ------------- | --- | --- | --------------- |
| Stripe        | ✓   | ✓   | USD, EUR, GBP + ~135 others (zero-decimal handling required) |
| Moneroo       | ✓   | ✓   | USD, EUR (card) |
| Bictorys MoMo | ✓   | —   | —               |
| Bictorys Card | ✓   | ✓   | —               |
| PayTech       | ✓   | —   | —               |

Bictorys mobile money is **UEMOA only** (XOF, 6 countries). PayTech is XOF only (no XAF). Moneroo covers both XOF and XAF. Stripe is the fallback for non-CFA / international customers.

## Country → provider matrix

```ts
// UEMOA (XOF)
const BICTORYS_MOMO_COUNTRIES = ["BJ", "BF", "CI", "ML", "SN", "TG"]; // 6 countries
const PAYTECH_MOMO_COUNTRIES = ["SN", "CI", "ML", "BJ"]; // 4 countries (no BF, no TG)

// Default routing per country (mobile money):
//   SN, CI         → Bictorys (broader operator support, deeper integration)
//   ML, BJ         → PayTech  (Bictorys covers them too, PayTech often has better fees on Wave)
//   BF, TG         → Moneroo  (neither Bictorys nor PayTech mobile money covers BF; TG is partial)
//   CEMAC (CM, …)  → Moneroo  (only XAF support)
//   Anywhere else  → Moneroo
//
// Card (worldwide buyer):
//   Default → Bictorys card (lowest friction, supports XOF/XAF/EUR-equivalent)
//   Fallback → Moneroo card or Stripe
```

The actual routing should be admin-configurable in your DB so a country can be flipped without a code change. Schema example: a `payment_provider_configs` table keyed by country with `mobileProvider`, `cardProvider`, `activeOperators`, `isActive`. See `references/database.md`.

## Process (each new integration follows this exactly)

### 1. Generate the master encryption key once per environment

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store as `BYOK_ENCRYPTION_KEY` in your secret manager. Never commit. See [`references/encryption.md`](references/encryption.md).

### 2. Persist a connection

The merchant gives you their key(s). Validate with Zod, encrypt with AES-256-GCM, save:

```ts
// Moneroo: single secret key
await db.insert(paymentConnections).values({
  merchantId,
  provider: "moneroo",
  credentialsEncrypted: encryptCredentials(
    monerooCredentialsSchema.parse(input),
  ),
});

// Bictorys: api key + (optional) webhook secret
await db.insert(paymentConnections).values({
  merchantId,
  provider: "bictorys",
  credentialsEncrypted: encryptCredentials(
    bictorysCredentialsSchema.parse(input),
  ),
});

// PayTech: two keys (API_KEY and API_SECRET)
await db.insert(paymentConnections).values({
  merchantId,
  provider: "paytech",
  credentialsEncrypted: encryptCredentials(
    paytechCredentialsSchema.parse(input),
  ),
});
```

### 3. Verify the keys work (before charging real customers)

Each adapter exports a `probeKey(credentials)` helper. It hits a known-bad endpoint to assert that 401/403 is returned (= key shape is valid even if endpoint is fake).

```ts
const probe = await paytechAdapter.probeKey(credentials);
if (!probe.ok) return res.status(400).json({ error: probe.error });
```

### 4. Initiate checkout

```ts
const adapter =
  provider === "moneroo"
    ? monerooAdapter
    : provider === "bictorys"
      ? bictorysAdapter
      : paytechAdapter;

const result = await adapter.initiatePayment(
  {
    amount,
    currency,
    reference: paymentRow.id,
    returnUrl,
    cancelUrl,
    customerEmail,
    customerName,
    customerPhone,
    metadata: {
      paymentId: paymentRow.id,
      paymentMode: "card" /* or "mobile_money" */,
    },
    // PayTech-only fields:
    ...(provider === "paytech" && {
      itemName: "Order #1234", // shown at the top of the hosted page — your domain label
      ipnUrl: `${baseUrl}/webhooks/paytech/${connection.id}`,
      // targetPayment is optional — usually omit and let PayTech show all operators.
    }),
  },
  decryptedCredentials,
);
if (!result.ok) return res.status(400).json({ error: result.error });
return res.json({ checkoutUrl: result.checkoutUrl });
```

### 5. Receive webhook

```ts
router.post("/webhooks/byok/:connectionId", async (req, res) => {
  const conn = await db.query.paymentConnections.findFirst({
    where: eq(id, req.params.connectionId),
  });
  if (!conn) return res.status(404).end();

  const credentials = decryptCredentials(conn.credentialsEncrypted);

  // PayTech ships form-encoded by default → branch
  let body: any;
  let rawBody: Buffer;
  if (conn.provider === "paytech") {
    rawBody = (req as any).rawBody;
    const ct = req.headers["content-type"] || "";
    body = ct.includes("application/x-www-form-urlencoded")
      ? Object.fromEntries(new URLSearchParams(rawBody.toString("utf-8")))
      : JSON.parse(rawBody.toString("utf-8"));
  } else {
    rawBody = (req as any).rawBody;
    body = req.body;
  }

  const verified = verifyWebhookSignature(
    conn.provider,
    req,
    rawBody,
    body,
    credentials,
  );
  if (!verified.ok) return res.status(401).json({ error: verified.error });
  // ... dedup, re-query (Moneroo/PayTech), fulfill
  res.json({ received: true });
});
```

See [`examples/webhook-handler.ts`](examples/webhook-handler.ts) for the full implementation.

## Best practices

- **Test in sandbox first** — Bictorys keys with `test_` prefix automatically route to `api.test.bictorys.com`. Moneroo uses one URL but distinguishes by key. PayTech uses one URL and toggles via the `env: "test" | "prod"` field in the body — request sandbox keys from PayTech support if your dashboard doesn't show them.
- **One connection per provider per merchant** — don't allow multiple Moneroo accounts on the same merchant. Causes webhook ambiguity.
- **Log webhook bodies in dev only** — they contain customer email/phone, treat as PII.
- **Show the merchant their webhook URL** in your UI: `https://your.api/webhooks/byok/<connectionId>` — they paste it into the provider dashboard themselves.
- **Build a health monitoring view** — track last successful webhook per connection per provider, alert if no webhook received in 24h.
- **Refunds**: All three providers support refunds via API but UX is poor. For V1, do refunds manually from each dashboard, then mark the row `status='refunded'` in your DB once the IPN/webhook arrives.

## Reference index

- [`references/stripe.md`](references/stripe.md) — Full Stripe reference: hosted Checkout (subscription + payment), inline PaymentIntent (Elements), subscription lifecycle (cancel period-end vs immediate, reactivate), Customer Portal, product/price sync, webhook events you actually care about, `apiVersion` pinning, test/live key partitioning, zero-decimal currency handling.
- [`references/moneroo.md`](references/moneroo.md) — Full Moneroo API: endpoints, request/response shapes, status mapping, webhook payload.
- [`references/bictorys.md`](references/bictorys.md) — Full Bictorys API: hosted Checkout, mobile money + card unified flow, the `payment_category` query trick, error redirect URL casing, WAF workaround details.
- [`references/paytech.md`](references/paytech.md) — Full PayTech API: endpoints, custom auth headers, IPN content-type quirk, dual signature verification (HMAC + SHA256-of-keys), country/operator coverage.
- [`references/webhooks.md`](references/webhooks.md) — Signature verification for all four providers, raw-body capture, dedup table, replay protection.
- [`references/encryption.md`](references/encryption.md) — AES-256-GCM, key rotation via `keyVersion`, key generation command.
- [`references/database.md`](references/database.md) — Drizzle and plain-SQL schemas for `payment_connections` and `payments` tables.

## Examples (drop-in code)

- [`examples/stripe.ts`](examples/stripe.ts) — Stripe adapter: hosted Checkout, inline PaymentIntent, subscription lifecycle, Customer Portal, product/price sync, `verifyStripeWebhook`, `normalizeStripeEvent` (~700 lines).
- [`examples/moneroo.ts`](examples/moneroo.ts) — Moneroo adapter (~250 lines, ready to paste).
- [`examples/bictorys.ts`](examples/bictorys.ts) — Bictorys adapter with `curl` subprocess + retry logic (~400 lines).
- [`examples/paytech.ts`](examples/paytech.ts) — PayTech adapter with dual signature verification (~440 lines).
- [`examples/encryption.ts`](examples/encryption.ts) — AES-256-GCM helpers with key rotation (~80 lines).
- [`examples/webhook-handler.ts`](examples/webhook-handler.ts) — Express route handling all four providers (~250 lines).
- [`examples/checkout-route.ts`](examples/checkout-route.ts) — Express checkout initiation with all guards (~300 lines).
- [`examples/schema.sql`](examples/schema.sql) — Plain SQL DDL for stacks not using Drizzle.

## Common mistakes & fixes

| Mistake                                  | Symptom                                                  | Fix                                                                              |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Did not pin Stripe `apiVersion`          | Sudden breakage when Stripe rotates default              | Pin `apiVersion: "<date>.<channel>"` explicitly in adapter constructor.          |
| Reused `cus_…` from test in live key context | `resource_missing`                                   | Mirror IDs in `*Test` columns, pick by env. Adapter signals `testLiveMismatch`.  |
| Hardcoded `* 100` for Stripe amounts     | Charged 100x for XOF / XAF / JPY                         | Use `toStripeAmount(amountMajor, currency)` — handles zero-decimal currencies.   |
| Used `request.json()` on Stripe webhook  | `Webhook signature verification failed`                  | `request.text()` (Next.js) or `express.raw({type:'application/json'})` (Express). |
| Granted entitlement on Stripe `success_url` | Replay attack / out-of-order webhook = double-grant   | Wait for `checkout.session.completed` / `invoice.paid` webhook.                  |
| Acted on `invoice.paid` only on first cycle | Renewals fail to extend access                        | Branch on `billing_reason === "subscription_create"` vs `"subscription_cycle"`.  |
| Used `JSON.stringify(req.body)` for HMAC | Webhook signature always fails                           | Use the raw `Buffer` captured by middleware.                                     |
| Sent `cancel_url` to Moneroo             | Moneroo ignores it (only `return_url`)                   | Encode cancel state in `return_url` query params if needed.                      |
| Used Node `fetch` for Bictorys           | `403 Forbidden` HTML response                            | Spawn `curl` subprocess.                                                         |
| Sent `errorRedirectUrl` only (camelCase) | 4xx from Bictorys, no clear error                        | Send both casings: `errorRedirectUrl` + `ErrorRedirectUrl`.                      |
| Sent `Authorization: Bearer` to PayTech  | 401 Unauthorized                                         | PayTech needs `API_KEY` + `API_SECRET` headers (uppercase).                      |
| Parsed PayTech IPN as JSON only          | All IPNs fail with `Cannot read properties of undefined` | Branch on `Content-Type` to support form-encoded bodies.                         |
| Compared PayTech HMAC with `===`         | Timing attack vector                                     | `crypto.timingSafeEqual` with length check first.                                |
| Ignored PayTech's SHA256-of-keys mode    | Default-mode IPNs all rejected as "no signature"         | Implement BOTH methods, prefer HMAC if `hmac_compute` present.                   |
| Sent decimal `item_price` to PayTech     | `success: 0`, `Invalid item_price`                       | Integer XOF only. `Math.floor()` if needed.                                      |
| `ipn_url` set to localhost               | PayTech 4xx at submission                                | Use HTTPS public URL (ngrok in dev).                                             |
| Stored API key in plaintext              | Compliance violation, security audit fail                | Use `encryptCredentials()` from `examples/encryption.ts`.                        |
| No idempotent UPDATE                     | Member granted entitlement twice on retry                | `UPDATE … WHERE id=? AND status='pending'`.                                      |
| Forgot to dedup events                   | Webhook replay creates duplicate notifications           | Hash raw body, store 24h.                                                        |
| Trusted webhook amount blindly           | Tampering risk                                           | Compare event amount to row's `amountTotal` (allow ±5% for PayTech fees).        |
| Skipped re-query                         | Webhook spoofing if HMAC ever leaks                      | `verifyPayment()` against the provider before granting (Moneroo + PayTech only). |
| Used Bictorys `country: "buyer-country"` | 400 / 422 from API                                       | Hardcode to merchant's country (`"SN"` for V1).                                  |
| Routed BF mobile money to PayTech        | "target_payment not available in country"                | BF → Moneroo. PayTech does not cover BF mobile money.                            |
| Hit PayTech with `currency: "XAF"`       | `Invalid currency`                                       | PayTech is XOF-only. Route XAF to Moneroo.                                       |

## Real-world impact

- **Production-tested at scale** — the Stripe, Moneroo and Bictorys patterns power BYOK payments on a multi-merchant African platform; the PayTech and Stripe-subscription patterns power a single-tenant production deployment covering SN, CI, ML, BJ.
- **Webhook replay storm survived** — providers periodically retry every webhook of the past hour (Stripe up to 3 days). The dedup + idempotent UPDATE means zero double-grants.
- **Stripe test/live mismatch incident resolved** — a DB clone copied test `cus_…` IDs into prod; `resource_missing` flooded Sentry. The adapter's `testLiveMismatch` flag let the recovery path wipe stale IDs and re-create on first charge.
- **WAF incident resolved in production** — the `curl` workaround was the result of a 2-day debugging session against `403 Forbidden` HTML responses.
- **PayTech form-encoded IPN handled correctly** — most accounts ship IPNs as `application/x-www-form-urlencoded`, not JSON. Sniffing `Content-Type` before parsing is built into the reference implementation; `item_price` arrives as a string in that mode and must be coerced.
