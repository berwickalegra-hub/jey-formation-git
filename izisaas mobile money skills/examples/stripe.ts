/**
 * Stripe adapter — drop-in.
 * https://docs.stripe.com/api
 *
 * Stripe is the worldwide-card / international payments leader. This adapter covers
 * the four shapes you'll actually use:
 *
 *   1. Hosted Checkout (mode: "subscription") — recurring billing via Stripe-hosted page
 *   2. Hosted Checkout (mode: "payment")      — one-shot card via Stripe-hosted page
 *   3. PaymentIntent (inline, Elements)        — in-app card form, no redirect
 *   4. Subscription lifecycle helpers          — cancel (immediate / period-end), reactivate
 *
 * Plus: webhook verification via `stripe.webhooks.constructEvent` (Stripe's signed-payload
 * algorithm — do not roll your own HMAC), customer reuse, and product/price sync.
 *
 * Usage:
 *   import { stripeAdapter, stripeCredentialsSchema } from "./stripe";
 *   const credentials = stripeCredentialsSchema.parse(input);
 *   const result = await stripeAdapter.initiateCheckout(params, credentials);
 *   if (result.ok) redirect(result.checkoutUrl);
 */

import Stripe from 'stripe';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// API version pinning — DO NOT DEFAULT
// ─────────────────────────────────────────────────────────────────────────
//
// Stripe rolls out breaking changes via dated API versions. If you don't pin,
// Stripe applies the version your account was created with — invisible to you,
// brittle when Stripe rotates. Always pin explicitly.
//
// Update this value (and run your test suite) when you intentionally upgrade.
// As of writing, recent stable: "2025-11-17.clover". Check Stripe dashboard
// → Developers → API versions for the current default.
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-11-17.clover';

// ─────────────────────────────────────────────────────────────────────────
// Credentials schema
// ─────────────────────────────────────────────────────────────────────────
//
// Stripe issues four key types per environment:
//   - sk_test_ / sk_live_           (server-side secret)
//   - pk_test_ / pk_live_           (client-side publishable, safe in browser)
//   - whsec_                         (webhook signing secret)
//   - rk_test_ / rk_live_           (restricted, scoped server-side)
//
// The adapter only needs `secretKey` (sk_*) and `webhookSecret` (whsec_*).
// `publishableKey` is included for completeness — pass it to the frontend.

export const stripeCredentialsSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .regex(/^sk_(test|live)_/, 'Stripe secret key must start with sk_test_ or sk_live_'),
  webhookSecret: z
    .string()
    .trim()
    .regex(/^whsec_/, 'Stripe webhook secret must start with whsec_')
    .optional(),
  publishableKey: z
    .string()
    .trim()
    .regex(/^pk_(test|live)_/, 'Stripe publishable key must start with pk_test_ or pk_live_')
    .optional(),
});

export type StripeCredentials = z.infer<typeof stripeCredentialsSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────

/**
 * Currencies that come up most. Stripe accepts ~135. Zero-decimal currencies
 * (XOF, XAF, JPY, KRW, …) take amounts as integer units; everything else takes
 * cents (or equivalent fractional units). Be careful when converting.
 */
export type StripeCurrency = 'usd' | 'eur' | 'gbp' | 'xof' | 'xaf' | string;

const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

/**
 * Convert a decimal amount (e.g. "12.50" USD) to Stripe's expected integer
 * representation. For zero-decimal currencies, returns the integer as-is.
 */
export function toStripeAmount(amountMajor: number, currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(c)) return Math.round(amountMajor);
  return Math.round(amountMajor * 100);
}

/**
 * Convert a Stripe integer amount back to a decimal major unit.
 */
export function fromStripeAmount(amountStripe: number, currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(c)) return amountStripe;
  return amountStripe / 100;
}

// ─────────────────────────────────────────────────────────────────────────
// Hosted Checkout — params + result
// ─────────────────────────────────────────────────────────────────────────

export type InitiateCheckoutParams = {
  /** "subscription" for recurring, "payment" for one-shot. */
  mode: 'subscription' | 'payment';
  /** Pre-existing Stripe price ID (subscription mode REQUIRES this). */
  priceId?: string;
  /** For "payment" mode: amount + currency are required if priceId is omitted. */
  amount?: number;
  currency?: StripeCurrency;
  /** Used as the line-item description when amount/currency is passed inline. */
  description?: string;
  /** Reuse an existing customer if known, otherwise pass `customerEmail`. */
  customerId?: string;
  customerEmail?: string;
  customerName?: string;
  /** Stripe will redirect here after success / cancel. */
  successUrl: string; // e.g. "https://app.example.com/paid?session_id={CHECKOUT_SESSION_ID}"
  cancelUrl: string;
  /** Sent back in the webhook on `checkout.session.completed`. */
  metadata?: Record<string, string>;
  /** Promotion code allowance (Stripe coupons). */
  allowPromotionCodes?: boolean;
  /** Optional trial period for subscriptions. */
  trialPeriodDays?: number;
};

export type InitiateCheckoutResult =
  | {
      ok: true;
      providerTransactionId: string; // Stripe Checkout session id (cs_…)
      checkoutUrl: string; // Stripe-hosted page URL
      status: 'pending';
    }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────
// Inline PaymentIntent (Stripe Elements) — params + result
// ─────────────────────────────────────────────────────────────────────────

export type InitiatePaymentIntentParams = {
  amount: number;
  currency: StripeCurrency;
  description?: string;
  customerId?: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
  /** When true, returns a Subscription whose latest invoice exposes a PaymentIntent. */
  recurringPriceId?: string;
};

export type InitiatePaymentIntentResult =
  | {
      ok: true;
      providerTransactionId: string; // PaymentIntent id (pi_…) OR Subscription id (sub_…)
      clientSecret: string; // pass this to the browser → stripe.confirmCardPayment(clientSecret)
      mode: 'payment_intent' | 'subscription';
      subscriptionId?: string; // present only in subscription mode
      status: 'pending';
    }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────
// Internal: client factory (singleton per credentials object)
// ─────────────────────────────────────────────────────────────────────────

const clientCache = new WeakMap<StripeCredentials, Stripe>();

function clientFor(creds: StripeCredentials): Stripe {
  let client = clientCache.get(creds);
  if (!client) {
    client = new Stripe(creds.secretKey, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
    });
    clientCache.set(creds, client);
  }
  return client;
}

// ─────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────

export const stripeAdapter = {
  /**
   * Create a hosted Checkout session. Stripe returns a URL — redirect the buyer.
   *
   * Quirk: in subscription mode, `subscription_data.metadata` is what lands on the
   * Subscription object; `metadata` at the session root only lives on the Checkout
   * Session. If you need to recover state in `customer.subscription.*` webhooks,
   * put it in `subscription_data.metadata`.
   */
  async initiateCheckout(
    params: InitiateCheckoutParams,
    credentials: StripeCredentials,
  ): Promise<InitiateCheckoutResult> {
    const stripe = clientFor(credentials);

    // Build line items
    let line_items: Stripe.Checkout.SessionCreateParams.LineItem[];
    if (params.priceId) {
      line_items = [{ price: params.priceId, quantity: 1 }];
    } else if (params.amount && params.currency) {
      if (params.mode === 'subscription') {
        return {
          ok: false,
          error:
            "subscription mode requires a priceId (Stripe doesn't allow ad-hoc recurring prices)",
        };
      }
      line_items = [
        {
          price_data: {
            currency: params.currency,
            unit_amount: toStripeAmount(params.amount, params.currency),
            product_data: { name: params.description ?? 'Order' },
          },
          quantity: 1,
        },
      ];
    } else {
      return { ok: false, error: 'Either priceId or (amount + currency) is required' };
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: params.mode,
      line_items,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata ?? {},
      allow_promotion_codes: params.allowPromotionCodes ?? false,
      ...(params.customerId
        ? { customer: params.customerId }
        : params.customerEmail
          ? { customer_email: params.customerEmail }
          : {}),
      ...(params.mode === 'subscription'
        ? {
            subscription_data: {
              metadata: params.metadata ?? {},
              ...(params.trialPeriodDays ? { trial_period_days: params.trialPeriodDays } : {}),
            },
          }
        : {}),
    };

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
      };
    }

    if (!session.url) {
      return { ok: false, error: 'Stripe did not return a checkout URL' };
    }

    return {
      ok: true,
      providerTransactionId: session.id,
      checkoutUrl: session.url,
      status: 'pending',
    };
  },

  /**
   * Create an inline PaymentIntent (one-shot) OR an "incomplete" Subscription
   * whose latest invoice exposes a PaymentIntent. Either way you return
   * `clientSecret` to the frontend, which calls `stripe.confirmCardPayment()`.
   *
   * Use this for in-app card forms (Stripe Elements) when you don't want a redirect.
   *
   * Activation flow:
   *   - One-shot:    PaymentIntent → `payment_intent.succeeded` webhook
   *   - Subscription: Subscription (incomplete) → invoice.paid webhook
   *
   * Don't grant entitlement until the webhook lands.
   */
  async initiatePaymentIntent(
    params: InitiatePaymentIntentParams,
    credentials: StripeCredentials,
  ): Promise<InitiatePaymentIntentResult> {
    const stripe = clientFor(credentials);

    // Resolve / create customer up front — required for off-session reuse.
    let customerId = params.customerId;
    if (!customerId && params.customerEmail) {
      const customerResult = await stripeAdapter.getOrCreateCustomer(
        { email: params.customerEmail },
        credentials,
      );
      if (!customerResult.ok) return { ok: false, error: customerResult.error };
      customerId = customerResult.customerId;
    }

    // ── Subscription mode (recurring inline) ──
    if (params.recurringPriceId) {
      if (!customerId) {
        return { ok: false, error: 'Subscription mode requires customerId or customerEmail' };
      }
      try {
        const sub = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: params.recurringPriceId, quantity: 1 }],
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          expand: ['latest_invoice.payment_intent'],
          metadata: params.metadata ?? {},
        });
        const invoice = sub.latest_invoice as Stripe.Invoice | null;
        const intent = invoice
          ? ((invoice as unknown as { payment_intent?: Stripe.PaymentIntent }).payment_intent ??
            null)
          : null;
        if (!intent?.client_secret) {
          return { ok: false, error: 'Subscription created without a confirmable PaymentIntent' };
        }
        return {
          ok: true,
          providerTransactionId: intent.id,
          clientSecret: intent.client_secret,
          mode: 'subscription',
          subscriptionId: sub.id,
          status: 'pending',
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
        };
      }
    }

    // ── One-shot mode ──
    try {
      const pi = await stripe.paymentIntents.create({
        amount: toStripeAmount(params.amount, params.currency),
        currency: params.currency,
        ...(customerId ? { customer: customerId } : {}),
        description: params.description,
        metadata: params.metadata ?? {},
        automatic_payment_methods: { enabled: true },
      });
      if (!pi.client_secret) {
        return { ok: false, error: 'PaymentIntent created without a client_secret' };
      }
      return {
        ok: true,
        providerTransactionId: pi.id,
        clientSecret: pi.client_secret,
        mode: 'payment_intent',
        status: 'pending',
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
      };
    }
  },

  /**
   * Verify a Checkout Session after the buyer is redirected to your success_url.
   *
   * IMPORTANT: this is a UX defense, not the source of truth. Stripe redirects
   * fire BEFORE the webhook lands sometimes (and the buyer can replay the URL).
   * Wait for the webhook to grant entitlement; use this method only to render
   * "your order is being processed" / "your payment was confirmed" hint.
   */
  async verifySession(
    sessionId: string,
    credentials: StripeCredentials,
  ): Promise<{
    status: 'paid' | 'unpaid' | 'no_payment_required' | 'pending';
    amount?: number;
    currency?: string;
    customerId?: string;
    subscriptionId?: string;
    metadata?: Record<string, string>;
    raw: Stripe.Checkout.Session;
  } | null> {
    const stripe = clientFor(credentials);
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent', 'subscription'],
      });
    } catch {
      return null;
    }

    const status: 'paid' | 'unpaid' | 'no_payment_required' | 'pending' =
      session.payment_status === 'paid'
        ? 'paid'
        : session.payment_status === 'no_payment_required'
          ? 'no_payment_required'
          : session.status === 'complete'
            ? 'paid'
            : 'pending';

    return {
      status,
      amount: typeof session.amount_total === 'number' ? session.amount_total : undefined,
      currency: session.currency ?? undefined,
      customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      subscriptionId:
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id,
      metadata: (session.metadata as Record<string, string>) ?? undefined,
      raw: session,
    };
  },

  /**
   * Get an existing Stripe customer by ID (preferred) or by email (fallback),
   * or create one. Stores the email + a metadata bag for traceability.
   *
   * Quirk: passing a `cus_…` from a TEST key while authenticating with a LIVE key
   * (or vice versa) returns `resource_missing`. The caller should clear the stale
   * ID in their DB and retry — the adapter just reports the failure.
   */
  async getOrCreateCustomer(
    params: { id?: string; email: string; name?: string; metadata?: Record<string, string> },
    credentials: StripeCredentials,
  ): Promise<
    | { ok: true; customerId: string; created: boolean }
    | { ok: false; error: string; testLiveMismatch?: boolean }
  > {
    const stripe = clientFor(credentials);

    if (params.id) {
      try {
        const c = await stripe.customers.retrieve(params.id);
        if (!(c as Stripe.Customer | Stripe.DeletedCustomer).deleted) {
          return { ok: true, customerId: params.id, created: false };
        }
      } catch (err) {
        if (err instanceof Stripe.errors.StripeError && err.code === 'resource_missing') {
          // test/live mismatch — let the caller handle the cleanup
          return {
            ok: false,
            error: `Stripe customer ${params.id} not found (likely test/live mismatch)`,
            testLiveMismatch: true,
          };
        }
        // any other error: fall through to email-based lookup
      }
    }

    // Email lookup
    try {
      const list = await stripe.customers.list({ email: params.email, limit: 1 });
      if (list.data.length > 0) {
        return { ok: true, customerId: list.data[0]!.id, created: false };
      }
    } catch (err) {
      // network errors etc. — fall through to create
    }

    try {
      const customer = await stripe.customers.create({
        email: params.email,
        name: params.name,
        metadata: params.metadata ?? {},
      });
      return { ok: true, customerId: customer.id, created: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
      };
    }
  },

  /**
   * Cancel a subscription. Two modes:
   *   - immediately = false (default): sets `cancel_at_period_end: true`. The
   *     buyer keeps access until the current period ends. Stripe fires
   *     `customer.subscription.updated` now and `customer.subscription.deleted`
   *     at period end.
   *   - immediately = true: cancel right now. Stripe fires
   *     `customer.subscription.deleted` immediately.
   */
  async cancelSubscription(
    subscriptionId: string,
    credentials: StripeCredentials,
    options: { immediately?: boolean } = {},
  ): Promise<{ ok: true; subscription: Stripe.Subscription } | { ok: false; error: string }> {
    const stripe = clientFor(credentials);
    try {
      const sub = options.immediately
        ? await stripe.subscriptions.cancel(subscriptionId)
        : await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
          });
      return { ok: true, subscription: sub };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
      };
    }
  },

  /**
   * Undo a `cancel_at_period_end: true` flag (only works before the period ends).
   * After the subscription is fully canceled, this fails — you'd have to create
   * a new subscription instead.
   */
  async reactivateSubscription(
    subscriptionId: string,
    credentials: StripeCredentials,
  ): Promise<{ ok: true; subscription: Stripe.Subscription } | { ok: false; error: string }> {
    const stripe = clientFor(credentials);
    try {
      const sub = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });
      return { ok: true, subscription: sub };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
      };
    }
  },

  /**
   * Generate a Customer Portal session — Stripe-hosted UI where the user can
   * update card, view invoices, switch plan, cancel. Eliminates 90% of UI work.
   *
   * Pre-requisite: configure the portal once at https://dashboard.stripe.com/settings/billing/portal
   * (allowed actions, products visible, etc.).
   */
  async createPortalSession(
    params: { customerId: string; returnUrl: string },
    credentials: StripeCredentials,
  ): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    const stripe = clientFor(credentials);
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: params.customerId,
        return_url: params.returnUrl,
      });
      return { ok: true, url: portal.url };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
      };
    }
  },

  /**
   * Idempotent product + price upsert from your DB.
   *
   * The function:
   *   1. If you pass `productId`, retrieves it; if alive, updates name/description/metadata.
   *      If deleted or missing, creates a new product.
   *   2. If you pass `priceId`, retrieves it; if it matches the requested terms
   *      (active, same unit_amount, same recurring interval), reuses it. Otherwise
   *      archives the old price and creates a new one (Stripe prices are immutable).
   *   3. Returns the resolved {productId, priceId} so the caller can persist them.
   *
   * Use this in admin tooling to "sync" your DB plans into Stripe.
   */
  async syncProductAndPrice(
    params: {
      productId?: string;
      priceId?: string;
      name: string;
      description?: string;
      metadata?: Record<string, string>;
      amount: number; // major unit (e.g. 9.99 USD or 5000 XOF)
      currency: StripeCurrency;
      /** Omit for one-time-only products. */
      recurring?: {
        interval: 'day' | 'week' | 'month' | 'year';
        intervalCount?: number;
      };
      /** Hosted thumbnail (max 8). */
      images?: string[];
    },
    credentials: StripeCredentials,
  ): Promise<
    | {
        ok: true;
        productId: string;
        priceId: string;
        created: { product: boolean; price: boolean };
      }
    | { ok: false; error: string }
  > {
    const stripe = clientFor(credentials);
    let productId = params.productId;
    let createdProduct = false;

    // ── Product ──
    if (productId) {
      try {
        const p = await stripe.products.retrieve(productId);
        if ((p as Stripe.Product | Stripe.DeletedProduct).deleted) {
          throw new Error('deleted');
        }
        await stripe.products.update(productId, {
          name: params.name,
          description: params.description,
          images: params.images,
          metadata: params.metadata ?? {},
        });
      } catch {
        productId = undefined; // fall through to create
      }
    }
    if (!productId) {
      try {
        const p = await stripe.products.create({
          name: params.name,
          description: params.description,
          images: params.images,
          metadata: params.metadata ?? {},
        });
        productId = p.id;
        createdProduct = true;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
        };
      }
    }

    // ── Price ──
    const targetUnitAmount = toStripeAmount(params.amount, params.currency);
    const targetCurrency = params.currency.toLowerCase();
    let priceId = params.priceId;
    let createdPrice = false;

    if (priceId) {
      try {
        const p = await stripe.prices.retrieve(priceId);
        const matches =
          p.active &&
          p.product === productId &&
          p.unit_amount === targetUnitAmount &&
          p.currency === targetCurrency &&
          (params.recurring
            ? p.recurring?.interval === params.recurring.interval &&
              (p.recurring?.interval_count ?? 1) === (params.recurring.intervalCount ?? 1)
            : !p.recurring);
        if (matches) {
          return {
            ok: true,
            productId,
            priceId,
            created: { product: createdProduct, price: false },
          };
        }
        // Mismatch: archive the old price (you can't update price on Stripe).
        await stripe.prices.update(priceId, { active: false });
      } catch {
        // fall through and create new
      }
    }

    try {
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: targetUnitAmount,
        currency: targetCurrency,
        ...(params.recurring
          ? {
              recurring: {
                interval: params.recurring.interval,
                interval_count: params.recurring.intervalCount ?? 1,
              },
            }
          : {}),
        metadata: params.metadata ?? {},
      });
      priceId = newPrice.id;
      createdPrice = true;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
      };
    }

    return {
      ok: true,
      productId,
      priceId,
      created: { product: createdProduct, price: createdPrice },
    };
  },

  /**
   * Probe key validity. Hits a cheap account-level endpoint; 401/403 = bad key.
   */
  async probeKey(
    credentials: StripeCredentials,
  ): Promise<{ ok: boolean; error?: string; mode?: 'test' | 'live' }> {
    const stripe = clientFor(credentials);
    try {
      // Lightweight call. Throws on bad key.
      await stripe.balance.retrieve();
      const mode = credentials.secretKey.startsWith('sk_live_') ? 'live' : 'test';
      return { ok: true, mode };
    } catch (err) {
      if (
        err instanceof Stripe.errors.StripeAuthenticationError ||
        (err instanceof Stripe.errors.StripeError &&
          (err.statusCode === 401 || err.statusCode === 403))
      ) {
        return { ok: false, error: 'Invalid Stripe secret key' };
      }
      return {
        ok: false,
        error: err instanceof Stripe.errors.StripeError ? err.message : String(err),
      };
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Webhook verification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verify a Stripe webhook payload. Use the `Stripe-Signature` header value and
 * the **raw request body string** (NOT the parsed JSON — Stripe signs the bytes).
 *
 * Throws on invalid signature; returns the typed Event on success.
 *
 * Express:
 *   app.post("/webhooks/stripe",
 *     express.raw({ type: "application/json" }),  // ← ESSENTIAL
 *     async (req, res) => {
 *       const sig = req.headers["stripe-signature"] as string;
 *       const event = verifyStripeWebhook(req.body, sig, credentials);
 *       …
 *     });
 *
 * Next.js App Router (route.ts):
 *   export const runtime = "nodejs";
 *   export async function POST(req: Request) {
 *     const rawBody = await req.text();
 *     const sig = req.headers.get("stripe-signature")!;
 *     const event = verifyStripeWebhook(rawBody, sig, credentials);
 *     …
 *   }
 */
export function verifyStripeWebhook(
  rawBody: string | Buffer,
  signature: string,
  credentials: StripeCredentials,
): Stripe.Event {
  if (!credentials.webhookSecret) {
    throw new Error('Stripe webhookSecret is not configured');
  }
  const stripe = clientFor(credentials);
  // constructEvent does the timing-safe HMAC-SHA256 + replay-window check internally.
  // Stripe's tolerance for the timestamp is 5 minutes by default.
  return stripe.webhooks.constructEvent(rawBody, signature, credentials.webhookSecret);
}

// ─────────────────────────────────────────────────────────────────────────
// Event normalization (events you actually care about)
// ─────────────────────────────────────────────────────────────────────────

export type NormalizedStripeEvent =
  | {
      kind: 'checkout.completed';
      sessionId: string;
      mode: 'payment' | 'subscription' | 'setup';
      customerId?: string;
      subscriptionId?: string;
      paymentIntentId?: string;
      amount?: number;
      currency?: string;
      metadata?: Record<string, string>;
      paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
    }
  | {
      kind: 'payment.succeeded';
      paymentIntentId: string;
      customerId?: string;
      amount?: number;
      currency?: string;
      metadata?: Record<string, string>;
    }
  | {
      kind: 'payment.failed';
      paymentIntentId: string;
      lastError?: string;
      metadata?: Record<string, string>;
    }
  | {
      kind: 'subscription.updated';
      subscriptionId: string;
      customerId?: string;
      status: Stripe.Subscription.Status;
      cancelAtPeriodEnd: boolean;
      currentPeriodEnd?: number; // unix seconds
      metadata?: Record<string, string>;
    }
  | {
      kind: 'subscription.deleted';
      subscriptionId: string;
      customerId?: string;
      metadata?: Record<string, string>;
    }
  | {
      kind: 'invoice.paid';
      invoiceId: string;
      subscriptionId?: string;
      customerId?: string;
      amount?: number;
      currency?: string;
      billingReason?: Stripe.Invoice.BillingReason;
    }
  | {
      kind: 'invoice.payment_failed';
      invoiceId: string;
      subscriptionId?: string;
      customerId?: string;
    };

/**
 * Helper to extract the subscription id from an Invoice across API versions.
 * Recent versions moved it into `parent.subscription_details.subscription`.
 * Older versions had it as `subscription` directly.
 */
export function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // New shape (post 2025-x)
  const parentSub = (
    invoice as unknown as {
      parent?: { subscription_details?: { subscription?: string | Stripe.Subscription } };
    }
  ).parent?.subscription_details?.subscription;
  if (parentSub) return typeof parentSub === 'string' ? parentSub : parentSub.id;

  // Legacy shape
  const legacy = (invoice as unknown as { subscription?: string | Stripe.Subscription })
    .subscription;
  if (legacy) return typeof legacy === 'string' ? legacy : legacy.id;

  return null;
}

export function normalizeStripeEvent(event: Stripe.Event): NormalizedStripeEvent | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      return {
        kind: 'checkout.completed',
        sessionId: s.id,
        mode: s.mode,
        customerId: typeof s.customer === 'string' ? s.customer : s.customer?.id,
        subscriptionId: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id,
        paymentIntentId:
          typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id,
        amount: s.amount_total ?? undefined,
        currency: s.currency ?? undefined,
        metadata: (s.metadata as Record<string, string>) ?? {},
        paymentStatus: (s.payment_status ?? 'unpaid') as 'paid' | 'unpaid' | 'no_payment_required',
      };
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      return {
        kind: 'payment.succeeded',
        paymentIntentId: pi.id,
        customerId: typeof pi.customer === 'string' ? pi.customer : pi.customer?.id,
        amount: pi.amount_received ?? pi.amount,
        currency: pi.currency,
        metadata: (pi.metadata as Record<string, string>) ?? {},
      };
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      return {
        kind: 'payment.failed',
        paymentIntentId: pi.id,
        lastError: pi.last_payment_error?.message,
        metadata: (pi.metadata as Record<string, string>) ?? {},
      };
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
      return {
        kind: 'subscription.updated',
        subscriptionId: sub.id,
        customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: periodEnd,
        metadata: (sub.metadata as Record<string, string>) ?? {},
      };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      return {
        kind: 'subscription.deleted',
        subscriptionId: sub.id,
        customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        metadata: (sub.metadata as Record<string, string>) ?? {},
      };
    }
    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      return {
        kind: 'invoice.paid',
        invoiceId: inv.id ?? '',
        subscriptionId: getInvoiceSubscriptionId(inv) ?? undefined,
        customerId: typeof inv.customer === 'string' ? inv.customer : inv.customer?.id,
        amount: inv.amount_paid,
        currency: inv.currency,
        billingReason: inv.billing_reason ?? undefined,
      };
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      return {
        kind: 'invoice.payment_failed',
        invoiceId: inv.id ?? '',
        subscriptionId: getInvoiceSubscriptionId(inv) ?? undefined,
        customerId: typeof inv.customer === 'string' ? inv.customer : inv.customer?.id,
      };
    }
    default:
      // Other events are perfectly valid; just nothing to act on for the common flow.
      return null;
  }
}
