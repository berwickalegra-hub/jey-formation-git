/**
 * Checkout initiation route — orchestrates BYOK payments.
 *
 * Mount at: POST /checkout/byok
 *
 * Flow:
 *   1. Validate input (Zod)
 *   2. Look up the merchant's connection
 *   3. Decrypt credentials
 *   4. Insert pending payments row (BEFORE provider call — webhook may arrive first)
 *   5. Call provider.initiatePayment()
 *   6. Update row with providerTransactionId or mark failed
 *   7. Respond { checkoutUrl } — frontend redirects user
 *
 * Replace `db`, table imports, and auth middleware with your stack.
 */

import express, { type Request, type Response } from 'express';
import { z } from 'zod';

import { decryptCredentials, type EncryptedPayload } from './encryption';
import { monerooAdapter, type MonerooCredentials } from './moneroo';
import { bictorysAdapter, type BictorysCredentials } from './bictorys';
import { paytechAdapter, type PaytechCredentials } from './paytech';
import { stripeAdapter, type StripeCredentials } from './stripe';

declare const db: any;
declare const paymentConnections: any;
declare const payments: any;
declare const eq: (col: any, val: any) => any;
declare const and: (col: any, val: any) => any;

// Replace with your auth middleware
declare function requireAuth(req: Request, res: Response, next: () => void): void;
type AuthedRequest = Request & {
  user: { id: string; email: string; name?: string; phone?: string };
};

// ─────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────

const checkoutSchema = z.object({
  connectionId: z.string().min(1),
  amount: z.number().int().positive(),
  // XOF/XAF for the African providers; Stripe accepts ~135 currencies.
  // Use lowercase Stripe-style codes when going through Stripe (the adapter handles casing).
  currency: z
    .string()
    .min(3)
    .max(8)
    .default('XOF')
    .refine((v) => /^[A-Za-z]{3,4}$/.test(v), 'currency must be a 3-4 letter ISO code'),
  paymentMode: z.enum(['mobile_money', 'card']).optional(), // Bictorys only
  description: z.string().min(1).max(200),
  // PayTech-only: shown at top of hosted page (e.g. "Order #1234")
  itemName: z.string().min(1).max(120).optional(),
  // PayTech-only: restrict the hosted page to specific operators (e.g. "Wave" or "Wave,Orange Money")
  targetPayment: z.string().max(80).optional(),
  // Stripe-only: pass an existing price (`price_…`) for subscriptions or fixed-price products.
  // If omitted, Stripe one-shot uses the `amount`/`currency` from above.
  stripePriceId: z
    .string()
    .regex(/^price_/)
    .optional(),
  // Stripe-only: "subscription" creates a recurring billing; "payment" is a one-shot.
  stripeMode: z.enum(['subscription', 'payment']).optional(),
  // Stripe-only: when true, Stripe shows a coupon-code field on the hosted Checkout page.
  stripeAllowPromotionCodes: z.boolean().optional(),
  // Stripe-only: existing `cus_…` to re-attach the buyer's saved payment methods.
  stripeCustomerId: z.string().regex(/^cus_/).optional(),
  paymentType: z.string().min(1), // your domain: 'order' | 'subscription' | 'service' | etc.
  referenceId: z.string().optional(),
  referenceType: z.string().optional(),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
  // Customer info — fall back to authed user if absent
  customerEmail: z.string().email().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────

export const checkoutRouter = express.Router();

checkoutRouter.post('/checkout/byok', requireAuth, async (req: AuthedRequest, res) => {
  // 1. Validate input
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.flatten() });
  }
  const input = parsed.data;
  const userId = req.user.id;

  // 2. Look up the connection
  const conn = await db.query.paymentConnections.findFirst({
    where: and(
      eq(paymentConnections.id, input.connectionId),
      eq(paymentConnections.isEnabled, true),
    ),
  });
  if (!conn) {
    return res.status(404).json({ error: 'Payment method unavailable' });
  }

  // 3. Decrypt credentials
  // The encrypted blob shape is provider-specific (Stripe: { secretKey, webhookSecret?, publishableKey? },
  // Moneroo: { secretKey, webhookSecret? }, Bictorys: { apiKey, webhookSecret? }, PayTech: { apiKey, apiSecret }).
  // The intersection type below is just for TypeScript; at runtime, only the fields for
  // `conn.provider` are populated.
  const credentials = decryptCredentials<
    StripeCredentials & MonerooCredentials & BictorysCredentials & PaytechCredentials
  >(conn.credentialsEncrypted as EncryptedPayload);

  // 4. Insert pending payments row (BEFORE provider call)
  const paymentId = crypto.randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    payerId: userId,
    provider: conn.provider,
    paymentMode: input.paymentMode ?? null,
    amountTotal: input.amount,
    amountNet: input.amount, // adjust if you take a platform fee
    platformFee: 0,
    gatewayFee: 0,
    currency: input.currency,
    status: 'pending',
    paymentType: input.paymentType,
    referenceId: input.referenceId ?? null,
    referenceType: input.referenceType ?? null,
    customerEmail: input.customerEmail ?? req.user.email,
    customerName: input.customerName ?? req.user.name ?? null,
    customerPhone: input.customerPhone ?? req.user.phone ?? null,
    metadata: {
      paymentConnectionId: conn.id, // ← used by webhook ownership check
      ...(input.metadata ?? {}),
    },
  });

  // Append paymentId to return URL so success page can poll
  const returnUrl = appendQuery(input.returnUrl, 'paymentId', paymentId);
  const cancelUrl = appendQuery(input.cancelUrl, 'paymentId', paymentId);

  // 5. Branch by provider
  let result;
  if (conn.provider === 'moneroo') {
    result = await monerooAdapter.initiatePayment(
      {
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        reference: paymentId,
        returnUrl,
        cancelUrl, // not used by Moneroo, but kept for consistency
        customerEmail: input.customerEmail ?? req.user.email,
        customerName: input.customerName ?? req.user.name,
        customerPhone: input.customerPhone ?? req.user.phone,
        metadata: { paymentId, ...(input.metadata ?? {}) },
      },
      credentials,
    );
  } else if (conn.provider === 'bictorys') {
    if (!input.paymentMode) {
      return res.status(400).json({ error: 'paymentMode is required for Bictorys' });
    }
    result = await bictorysAdapter.initiatePayment(
      {
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        reference: paymentId,
        returnUrl,
        cancelUrl,
        customerEmail: input.customerEmail ?? req.user.email,
        customerName: input.customerName ?? req.user.name,
        customerPhone: input.customerPhone ?? req.user.phone,
        paymentMode: input.paymentMode,
        merchantCountry: (conn.config?.merchantCountry as string) || 'SN',
      },
      credentials,
    );
  } else if (conn.provider === 'stripe') {
    // Stripe accepts both subscription and one-shot payments via hosted Checkout.
    // For inline (Stripe Elements) checkout, see `stripeAdapter.initiatePaymentIntent`
    // — that flow returns a `clientSecret` instead of a `checkoutUrl`.
    const mode = input.stripeMode ?? 'payment';
    if (mode === 'subscription' && !input.stripePriceId) {
      return res.status(400).json({
        error:
          "Stripe subscription mode requires a stripePriceId (Stripe doesn't allow ad-hoc recurring prices)",
      });
    }
    result = await stripeAdapter.initiateCheckout(
      {
        mode,
        ...(input.stripePriceId ? { priceId: input.stripePriceId } : {}),
        ...(input.amount && !input.stripePriceId
          ? { amount: input.amount, currency: input.currency, description: input.description }
          : {}),
        ...(input.stripeCustomerId
          ? { customerId: input.stripeCustomerId }
          : { customerEmail: input.customerEmail ?? req.user.email }),
        ...((input.customerName ?? req.user.name)
          ? { customerName: input.customerName ?? req.user.name }
          : {}),
        // Stripe replaces {CHECKOUT_SESSION_ID} after redirect — keep it as the literal placeholder.
        successUrl: input.returnUrl.includes('{CHECKOUT_SESSION_ID}')
          ? input.returnUrl
          : appendQuery(input.returnUrl, 'session_id', '{CHECKOUT_SESSION_ID}'),
        cancelUrl: input.cancelUrl,
        metadata: { paymentId, paymentConnectionId: conn.id, ...(input.metadata ?? {}) },
        allowPromotionCodes: input.stripeAllowPromotionCodes,
      },
      credentials,
    );
  } else if (conn.provider === 'paytech') {
    // PayTech is XOF-only. Fail fast on XAF/etc to avoid a confusing 400 from PayTech.
    if (input.currency !== 'XOF') {
      return res.status(400).json({ error: 'PayTech only supports XOF — route XAF to Moneroo.' });
    }
    // PayTech needs an absolute IPN URL (HTTPS, public). Prefer a config value;
    // fallback derives from the request host.
    const baseUrl =
      (conn.config?.publicBaseUrl as string | undefined) ?? `${req.protocol}://${req.get('host')}`;
    const ipnUrl = `${baseUrl.replace(/^http:\/\//, 'https://')}/webhooks/byok/${conn.id}`;

    result = await paytechAdapter.initiatePayment(
      {
        amount: input.amount,
        currency: 'XOF',
        description: input.description,
        itemName: input.itemName ?? input.description.slice(0, 60),
        reference: paymentId,
        returnUrl,
        cancelUrl,
        ipnUrl,
        customerEmail: input.customerEmail ?? req.user.email,
        customerName: input.customerName ?? req.user.name,
        customerPhone: input.customerPhone ?? req.user.phone,
        metadata: {
          paymentId,
          paymentConnectionId: conn.id, // mirrored into custom_field for IPN routing
          ...(input.metadata ?? {}),
        },
        ...(input.targetPayment ? { targetPayment: input.targetPayment } : {}),
      },
      credentials,
    );
  } else {
    return res.status(400).json({ error: `Unsupported provider: ${conn.provider}` });
  }

  // 6. Update row with provider transaction id, or mark failed
  if (!result.ok) {
    await db
      .update(payments)
      .set({
        status: 'failed',
        failureReason: result.error,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
    return res.status(400).json({ error: result.error });
  }

  await db
    .update(payments)
    .set({
      providerTransactionId: result.providerTransactionId,
      checkoutUrl: result.checkoutUrl,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId));

  // 7. Respond
  return res.json({
    paymentId,
    provider: conn.provider,
    checkoutUrl: result.checkoutUrl,
    providerTransactionId: result.providerTransactionId,
    status: result.status,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Polling endpoint for the success page
// ─────────────────────────────────────────────────────────────────────────

checkoutRouter.get(
  '/checkout/byok/:paymentId/status',
  requireAuth,
  async (req: AuthedRequest, res) => {
    const payment = await db.query.payments.findFirst({
      where: and(eq(payments.id, req.params.paymentId), eq(payments.payerId, req.user.id)),
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    return res.json({
      id: payment.id,
      status: payment.status,
      amount: payment.amountTotal,
      currency: payment.currency,
      provider: payment.provider,
      failureReason: payment.failureReason,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function appendQuery(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}
