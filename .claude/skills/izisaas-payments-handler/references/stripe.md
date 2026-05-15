# Stripe Reference

Source of truth: https://docs.stripe.com/api

Stripe is the worldwide-card payments leader and supports cards in ~135 currencies including XOF/XAF for African issuers (with a Stripe-Atlas-or-equivalent merchant entity). It is the default fallback for any non-mobile-money payment in this skill.

This reference covers the four shapes the adapter exposes:

1. **Hosted Checkout** — fully Stripe-hosted page (subscription or one-shot).
2. **Inline PaymentIntent** — embed Stripe Elements in your own UI, no redirect.
3. **Subscription lifecycle** — cancel (period-end vs immediate), reactivate, Customer Portal.
4. **Webhook handling** — signed-event verification + the events you actually care about.

The adapter is `examples/stripe.ts`. Open it alongside this doc.

## Endpoints (the ones you'll use)

| Purpose                     | SDK call                                         | REST endpoint                              |
| --------------------------- | ------------------------------------------------ | ------------------------------------------ |
| Create Checkout session     | `stripe.checkout.sessions.create()`              | `POST /v1/checkout/sessions`               |
| Retrieve Checkout session   | `stripe.checkout.sessions.retrieve(id)`          | `GET  /v1/checkout/sessions/:id`           |
| Create PaymentIntent        | `stripe.paymentIntents.create()`                 | `POST /v1/payment_intents`                 |
| Retrieve PaymentIntent      | `stripe.paymentIntents.retrieve(id)`             | `GET  /v1/payment_intents/:id`             |
| Create / get customer       | `stripe.customers.create()` / `.list({ email })` | `POST /v1/customers`                       |
| Cancel subscription         | `stripe.subscriptions.update(id, …)`             | `POST /v1/subscriptions/:id`               |
| Subscription Customer Portal| `stripe.billingPortal.sessions.create()`         | `POST /v1/billing_portal/sessions`         |
| Sync product / price        | `stripe.products.create()` / `stripe.prices.create()` | `POST /v1/products`, `POST /v1/prices` |
| Webhook verify              | `stripe.webhooks.constructEvent()`               | (no HTTP — signature check only)           |

## Authentication

```http
Authorization: Bearer sk_live_…
Stripe-Version: 2025-11-17.clover
```

The Stripe SDK adds both headers automatically once you instantiate the client. Don't roll your own auth — there are signed retries and idempotency-key plumbing you'll miss.

### Pin the API version

```ts
new Stripe(secretKey, { apiVersion: "2025-11-17.clover" });
```

If you don't pin, Stripe uses the version your account was created with. That's fine until they rotate the default — then your code breaks invisibly. Pinning makes upgrades intentional. Each pin moves an upgrade from "surprise" to "scheduled work."

When you do upgrade: read the [API changelog](https://docs.stripe.com/upgrades), update the pin, run your test suite, and deploy. Common gotchas: Invoice `subscription` field moved into `parent.subscription_details.subscription` in 2025-x. The adapter's `getInvoiceSubscriptionId(invoice)` helper handles both shapes.

### Test vs live keys

| Key prefix       | Environment | Notes                                         |
| ---------------- | ----------- | --------------------------------------------- |
| `sk_test_…`      | Sandbox     | Free, full feature set, fake cards.           |
| `sk_live_…`      | Production  | Real money. Use `4242 4242 4242 4242` ≠ live. |
| `pk_test_…`      | Sandbox     | Browser-safe, pair with `sk_test_`.           |
| `pk_live_…`      | Production  | Browser-safe, pair with `sk_live_`.           |
| `whsec_…`        | Either      | Different secret per webhook endpoint.        |
| `rk_live_…`      | Production  | Restricted, scoped key. Use for cron jobs.    |

**Critical**: customers, products, prices, subscriptions are fully partitioned between test and live. A `cus_…` created in test mode does not exist when authenticating with `sk_live_`. The adapter's `getOrCreateCustomer` returns `testLiveMismatch: true` when this happens — clear the stale ID in your DB and retry.

To support both modes side-by-side in your DB, mirror every Stripe ID with a `*Test` companion: `stripeProductId` + `stripeProductIdTest`, `stripePriceId` + `stripePriceIdTest`, etc. Pick the right column based on which key set is active for the current environment.

## 1. Hosted Checkout (subscription)

The "boring works" path for any recurring billing — SaaS subscriptions, memberships, donations, prepaid plans, content access, gym dues. Stripe runs the page, you redirect, the buyer pays, you get a webhook.

```ts
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  customer: stripeCustomerId,            // OR customer_email
  line_items: [{ price: priceId, quantity: 1 }],
  subscription_data: {
    metadata: {                          // ← ends up on the SUBSCRIPTION
      order_id: "order_abc",
      type: "subscription",
    },
    trial_period_days: 7,                 // optional
  },
  metadata: {                             // ← ends up on the CHECKOUT SESSION
    order_id: "order_abc",
  },
  allow_promotion_codes: true,           // shows coupon field on the page
  success_url: "https://app.example.com/paid?session_id={CHECKOUT_SESSION_ID}",
  cancel_url: "https://app.example.com/cancelled",
});
// → redirect the buyer to session.url
```

### Where do I put metadata?

Three different places. They have different lifetimes:

| Path                              | Visible on              | Lifetime                                     |
| --------------------------------- | ----------------------- | -------------------------------------------- |
| `metadata`                        | Checkout Session        | The session itself, ~24 h                    |
| `subscription_data.metadata`      | Subscription            | Forever (or until subscription is deleted)   |
| `payment_intent_data.metadata`    | PaymentIntent (one-shot)| Forever (PaymentIntents persist)             |

In subscription mode, write to **both** `metadata` and `subscription_data.metadata` — the first lets you correlate `checkout.session.completed`, the second lets you correlate `customer.subscription.updated` and `invoice.paid` going forward.

### Granting access

The `success_url` redirect is **not** authoritative — buyers can replay the URL, and the redirect can fire before the webhook. Use it only to render "your subscription is being set up" / "thank you, processing".

The signal of truth is the webhook chain:

```
checkout.session.completed       (mode=subscription, payment_status=paid)
    ↓
customer.subscription.created    (status=active, sometimes incomplete first)
    ↓
invoice.paid                     (billing_reason=subscription_create)
```

For first activation, `invoice.paid` with `billing_reason=subscription_create` is the cleanest grant signal. For renewals, `invoice.paid` with `billing_reason=subscription_cycle`.

## 2. Hosted Checkout (one-shot payment)

Same shape but `mode: "payment"`:

```ts
const session = await stripe.checkout.sessions.create({
  mode: "payment",
  line_items: [
    {
      price_data: {
        currency: "usd",
        unit_amount: 2999,                // $29.99 — see currency rules below
        product_data: { name: "Order #1234" },
      },
      quantity: 1,
    },
  ],
  customer_email: "buyer@example.com",
  metadata: { order_id: "order_abc" },
  success_url: "https://app.example.com/paid?session_id={CHECKOUT_SESSION_ID}",
  cancel_url: "https://app.example.com/cancelled",
});
```

### Zero-decimal vs cents currencies

```
USD, EUR, GBP, …  → unit_amount in CENTS:        $29.99 → 2999
JPY, KRW, XOF,    → unit_amount in INTEGER UNITS: ¥1500 → 1500
XAF, VND, …
```

The adapter's `toStripeAmount(amountMajor, currency)` handles the conversion. The full list of zero-decimal currencies is in the [Stripe currency docs](https://docs.stripe.com/currencies#zero-decimal); the most common ones for African markets are `XOF`, `XAF`, `JPY`, `KRW`.

**Common bug**: passing `5000` for "5000 XOF" but the currency is `usd` ⇒ Stripe charges $50. Always assert the currency before `toStripeAmount`.

## 3. Inline PaymentIntent (Stripe Elements)

When you want the card form embedded inside your app — no redirect, lower abandon. The flow:

1. Server: create a PaymentIntent, return `client_secret` to the browser.
2. Browser: render Stripe Elements, call `stripe.confirmCardPayment(clientSecret)`.
3. Server: webhook `payment_intent.succeeded` fires once the buyer's bank confirms.

```ts
// Server
const pi = await stripe.paymentIntents.create({
  amount: toStripeAmount(2999, "usd"),  // 2999 cents
  currency: "usd",
  customer: stripeCustomerId,
  description: "Order #1234",
  metadata: { order_id: "order_abc" },
  automatic_payment_methods: { enabled: true },
});
return { clientSecret: pi.client_secret };
```

```ts
// Browser (Stripe.js + Elements)
const stripe = await loadStripe(publishableKey);
const result = await stripe.confirmCardPayment(clientSecret, {
  payment_method: { card: cardElement, billing_details: { name } },
});
if (result.error) showError(result.error.message);
else if (result.paymentIntent.status === "succeeded") showSuccess();
```

### Inline subscription (recurring + Elements)

You can't pass a PaymentIntent for subscriptions directly. The trick: create the Subscription in `incomplete` state and let Stripe expose its first invoice's PaymentIntent.

```ts
const sub = await stripe.subscriptions.create({
  customer: stripeCustomerId,
  items: [{ price: priceId, quantity: 1 }],
  payment_behavior: "default_incomplete",
  payment_settings: { save_default_payment_method: "on_subscription" },
  expand: ["latest_invoice.payment_intent"],
  metadata: { order_id: "order_abc", type: "subscription" },
});
const intent = (sub.latest_invoice as Stripe.Invoice & { payment_intent: Stripe.PaymentIntent })
  .payment_intent;
return { clientSecret: intent.client_secret, subscriptionId: sub.id };
```

The browser confirms the PaymentIntent the same way; once it succeeds, Stripe auto-transitions the Subscription from `incomplete` → `active` and fires `invoice.paid` + `customer.subscription.updated`.

## 4. Customer reuse — the `getOrCreateCustomer` pattern

Always reuse Stripe customers. Every PaymentIntent, Subscription, and Checkout Session can be tied to a `cus_…` — that's how the buyer's saved cards, addresses, and tax info follow them around.

```ts
const result = await stripeAdapter.getOrCreateCustomer(
  { id: user.stripeCustomerId, email: user.email, name: user.fullName },
  credentials,
);
if (!result.ok && result.testLiveMismatch) {
  // Stale ID from the other environment. Wipe and retry.
  await db.update(users).set({ stripeCustomerId: null }).where(eq(users.id, user.id));
  const retry = await stripeAdapter.getOrCreateCustomer(
    { email: user.email, name: user.fullName },
    credentials,
  );
  if (retry.ok) await db.update(users).set({ stripeCustomerId: retry.customerId }).where(eq(users.id, user.id));
}
```

The adapter does:

1. If `id` is supplied, retrieve it. Live? Reuse.
2. Deleted? `resource_missing`? → fall through (and signal `testLiveMismatch` if that was the cause).
3. List by email. Found? Reuse the first match.
4. Otherwise create a fresh customer.

## 5. Subscription cancel & reactivate

```ts
// Cancel at period end (default — buyer keeps access until renewal date)
await stripeAdapter.cancelSubscription(subscriptionId, credentials);

// Cancel right now (refund considerations are separate — Stripe doesn't auto-refund)
await stripeAdapter.cancelSubscription(subscriptionId, credentials, { immediately: true });

// Undo a "cancel at period end" before the period actually ends
await stripeAdapter.reactivateSubscription(subscriptionId, credentials);
```

### Webhook trail

| Action                                       | Webhooks fired                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| Cancel at period end                         | `customer.subscription.updated` (cancel_at_period_end=true) NOW                |
| → time passes, period ends                   | `customer.subscription.deleted` (status=canceled) AT period end                |
| Cancel immediately                           | `customer.subscription.deleted` immediately                                    |
| Reactivate                                   | `customer.subscription.updated` (cancel_at_period_end=false)                  |

Don't revoke access on `customer.subscription.updated` with `cancel_at_period_end=true`. Wait for `.deleted`. The buyer paid for that period.

### Customer Portal — let Stripe do the UI

Configure once at https://dashboard.stripe.com/settings/billing/portal (allowed actions, products visible, branding), then:

```ts
const portal = await stripeAdapter.createPortalSession(
  { customerId, returnUrl: "https://app.example.com/account" },
  credentials,
);
redirect(portal.url);
```

Eliminates 90% of subscription-management UI work.

## 6. Webhook events — what fires when

The events the adapter normalizes are the ones you'll actually act on. Other events are valid signals but are usually not the primary trigger for fulfillment.

| Event                              | Use it for                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `checkout.session.completed`       | First confirmation that a hosted Checkout finalized.                        |
| `payment_intent.succeeded`         | Inline PaymentIntent confirmed (one-shot).                                  |
| `payment_intent.payment_failed`    | Inline PaymentIntent rejected (capture `last_payment_error.message`).       |
| `invoice.paid`                     | Subscription invoice paid — first cycle AND renewals.                       |
| `invoice.payment_failed`           | Renewal failed — start your dunning flow (email, retry, downgrade).         |
| `customer.subscription.updated`    | Plan change, cancel-at-period-end flag, status flip (active → past_due, …). |
| `customer.subscription.deleted`    | Definitive end of subscription (revoke access).                             |

### Order quirk

For a brand-new subscription paid via inline PaymentIntent, `invoice.paid` fires **before** `customer.subscription.updated` reports `status=active`. Both eventually arrive; don't assume an order. Make every handler independently idempotent.

For Checkout Sessions in subscription mode, the first `invoice.paid` is followed by `checkout.session.completed`; for some accounts the order is reversed. Same advice: idempotent handlers, no assumptions.

### Webhook verification

```ts
// Express
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }), // ← required: keep raw bytes
  (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    const event = verifyStripeWebhook(req.body, sig, credentials);
    // ... handle event
    res.json({ received: true });
  }
);

// Next.js App Router
export const runtime = "nodejs";
export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature")!;
  const event = verifyStripeWebhook(rawBody, sig, credentials);
  // ... handle event
  return Response.json({ received: true });
}
```

The Stripe SDK runs the timing-safe HMAC-SHA256 check internally, plus a 5-minute timestamp tolerance against replay. Don't reimplement.

### Idempotency

Stripe retries every webhook for up to **3 days** with exponential backoff if you don't return 2xx. Same `event.id` may arrive 5+ times. Two layers:

1. **Event-id dedup** — store `event.id` (already unique per Stripe event) in a 7-day TTL table; ignore replays.
2. **State-guarded UPDATE** — `UPDATE orders SET status='paid' WHERE id=? AND status='pending'`. The `WHERE` is the safety net.

Stripe's idempotency works **on the request side too**: pass an `Idempotency-Key` header to mutating calls (`paymentIntents.create`, `subscriptions.create`, …) so retries don't double-charge if your network blips. The SDK has a per-request option:

```ts
await stripe.paymentIntents.create({ … }, { idempotencyKey: orderUuid });
```

Use the same key (your order UUID) within a 24h window; Stripe will return the original response on retry.

## 7. Common errors

| Error code             | Likely cause                                          | Fix                                                      |
| ---------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `resource_missing`     | Test ID used with live key (or vice versa)            | Wipe stale ID, retry with email-based create.            |
| `parameter_invalid_*`  | Wrong currency for amount (e.g. decimals on XOF)      | Validate currency vs amount via `toStripeAmount`.        |
| `card_declined`        | Buyer's bank refused                                  | Show `last_payment_error.message`; let buyer retry.      |
| `invalid_request_error` `webhook_signature_invalid` | Wrong webhook secret OR raw body was parsed | Use `req.text()` / `express.raw()`, verify whsec.        |
| `rate_limit`           | More than ~100 req/sec to one account                  | Add backoff; use Idempotency-Key on retry.               |
| `idempotency_error`    | Same Idempotency-Key with different params            | Either reuse params or use a fresh key.                  |

## 8. Refunds

```ts
await stripe.refunds.create({ payment_intent: paymentIntentId });
// or for partial:
await stripe.refunds.create({ payment_intent: paymentIntentId, amount: 500 });
```

Webhook `charge.refunded` fires after. Don't forget to mark your DB row `refunded` and revoke any granted entitlement.

For subscriptions, refunding the latest invoice does NOT cancel the subscription; you must cancel separately. Order matters depending on UX: usually refund first, then cancel-immediately.

## 9. Shipping a sandbox-to-prod transition

Pre-flight checklist:

1. Replace `STRIPE_SECRET_KEY=sk_test_…` with `sk_live_…` in the secret manager.
2. Replace `STRIPE_WEBHOOK_SECRET=whsec_test_…` with the production webhook secret (each Stripe webhook endpoint has its own).
3. Re-create products and prices in live mode (test products do not promote — see `syncProductAndPrice`).
4. Wipe `stripeCustomerId` on every user (or maintain `stripeCustomerIdTest` + `stripeCustomerId` columns and pick by env).
5. Test a real $0.50 charge end-to-end before going live.
6. Verify webhooks land at the live endpoint within 1 minute.

The `stripeCredentialsSchema` enforces the prefix on the key, so a misconfigured deploy fails at boot rather than at first charge.
