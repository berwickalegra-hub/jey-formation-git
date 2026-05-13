/**
 * Webhook receiver for Stripe, Moneroo, Bictorys, and PayTech.
 *
 * Mount at: POST /webhooks/byok/:connectionId
 *
 * Express setup REQUIRED before this router:
 *
 *   import express from "express";
 *   const app = express();
 *   app.use(express.json({
 *     verify: (req, _res, buf) => { (req as any).rawBody = buf; }
 *   }));
 *   app.use(webhookRouter);
 *
 * Stripe note: `stripe.webhooks.constructEvent` accepts the raw bytes captured by
 * the `verify` hook above, so you do NOT need a separate `express.raw(...)` mount
 * for the Stripe path. If you'd rather mount Stripe at a dedicated route
 * (`/webhooks/stripe`) without the JSON body parser, use `express.raw({type:'application/json'})`
 * on that route only.
 *
 * Replace `db` and the table imports with whatever ORM/driver you use.
 */

import crypto from 'node:crypto';
import express, { type Request } from 'express';
import type Stripe from 'stripe';

import { decryptCredentials, type EncryptedPayload } from './encryption';
import { monerooAdapter, parseMonerooEvent, type MonerooCredentials } from './moneroo';
import { bictorysAdapter, parseBictorysEvent, type BictorysCredentials } from './bictorys';
import {
  paytechAdapter,
  parsePaytechEvent,
  parsePaytechCustomField,
  verifyPaytechIPN,
  type PaytechCredentials,
  type PaytechIPNPayload,
} from './paytech';
import {
  stripeAdapter,
  verifyStripeWebhook,
  normalizeStripeEvent,
  type StripeCredentials,
  type NormalizedStripeEvent,
} from './stripe';

// Replace these with your real Drizzle client + tables.
declare const db: any;
declare const paymentConnections: any;
declare const payments: any;
declare const processedEvents: any;
declare const eq: (col: any, val: any) => any;
declare const and: (...args: any[]) => any;

// Replace this with your actual entitlement granter.
declare function grantEntitlement(payment: any): Promise<void>;

// ─────────────────────────────────────────────────────────────────────────
// Provider-agnostic verification
// ─────────────────────────────────────────────────────────────────────────

type VerifyResult = { ok: true } | { ok: false; error: string };

/**
 * Stripe wraps verification in a single SDK call. `constructEvent` does:
 *   - timing-safe HMAC-SHA256 over the raw bytes
 *   - 5-minute timestamp tolerance against replay
 *   - returns the typed Event on success, throws on invalid signature.
 *
 * IMPORTANT: pass the raw bytes (Buffer or string), not the parsed JSON.
 */
function verifyStripe(
  rawBody: Buffer,
  req: Request,
  credentials: StripeCredentials,
): { ok: true; event: Stripe.Event } | { ok: false; error: string } {
  const sig = req.headers['stripe-signature'] as string | undefined;
  if (!sig) return { ok: false, error: 'stripe-signature header missing' };
  try {
    const event = verifyStripeWebhook(rawBody, sig, credentials);
    return { ok: true, event };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Stripe signature invalid',
    };
  }
}

function verifyMoneroo(rawBody: Buffer, req: Request, secret: string): VerifyResult {
  const sig = req.headers['x-moneroo-signature'] as string | undefined;
  if (!sig) return { ok: false, error: 'x-moneroo-signature header missing' };
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(sig.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Moneroo signature invalid' };
  }
  return { ok: true };
}

/**
 * Parse a PayTech IPN body, supporting both content types.
 *
 * PayTech ships IPNs as `application/x-www-form-urlencoded` by default. Older /
 * un-toggled accounts may also use JSON. Sniff and branch.
 */
function parsePaytechBody(rawBody: Buffer, req: Request): PaytechIPNPayload | null {
  const ct = (req.headers['content-type'] as string | undefined) || '';
  const text = rawBody.toString('utf-8');
  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(text)) as unknown as PaytechIPNPayload;
    }
    return JSON.parse(text) as PaytechIPNPayload;
  } catch {
    return null;
  }
}

/**
 * PayTech does not put the signature in headers. Instead the body itself carries
 * either an HMAC field (`hmac_compute`) or a SHA256-of-keys echo. Either is acceptable
 * — see references/paytech.md.
 */
function verifyPaytech(body: PaytechIPNPayload, credentials: PaytechCredentials): VerifyResult {
  const result = verifyPaytechIPN(body, credentials);
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'PayTech IPN invalid' };
}

function verifyBictorys(rawBody: Buffer, req: Request, secret: string): VerifyResult {
  const sig = req.headers['x-webhook-signature'] as string | undefined;
  const ts = req.headers['x-webhook-timestamp'] as string | undefined;

  // Mode 1: HMAC
  if (sig && ts) {
    let tsNum = parseInt(ts, 10);
    if (tsNum > 0 && tsNum < 10_000_000_000) tsNum *= 1000; // sec → ms
    if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > 5 * 60_000) {
      return { ok: false, error: 'Bictorys timestamp out of ±5 min tolerance' };
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${ts}.${rawBody.toString('utf-8')}`)
      .digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: 'Bictorys HMAC signature invalid' };
    }
    return { ok: true };
  }

  // Mode 2: static X-Secret-Key
  const staticKey = req.headers['x-secret-key'] as string | undefined;
  if (!staticKey) {
    return {
      ok: false,
      error: 'No signature header (X-Webhook-Signature or X-Secret-Key)',
    };
  }
  const a = Buffer.from(staticKey);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Bictorys X-Secret-Key invalid' };
  }
  return { ok: true };
}

/**
 * Bridge a Stripe normalized event onto the same { providerTransactionId, status,
 * reportedAmount, reportedCurrency, metadata } shape used by Moneroo / Bictorys / PayTech.
 * Only handles "one-shot payment" events — subscription/invoice events are dispatched
 * separately upstream of this function.
 */
function stripeEventToPaymentEvent(norm: NormalizedStripeEvent): {
  providerTransactionId: string;
  status: 'completed' | 'failed' | 'pending';
  failureReason?: string;
  reportedAmount?: number;
  reportedCurrency?: string;
  paymentConnectionId?: string;
} | null {
  if (norm.kind === 'checkout.completed') {
    if (norm.mode !== 'payment') return null; // subscription completion handled elsewhere
    return {
      providerTransactionId: norm.sessionId,
      status: norm.paymentStatus === 'paid' ? 'completed' : 'pending',
      reportedAmount: norm.amount,
      reportedCurrency: norm.currency,
      paymentConnectionId: norm.metadata?.paymentConnectionId,
    };
  }
  if (norm.kind === 'payment.succeeded') {
    return {
      providerTransactionId: norm.paymentIntentId,
      status: 'completed',
      reportedAmount: norm.amount,
      reportedCurrency: norm.currency,
      paymentConnectionId: norm.metadata?.paymentConnectionId,
    };
  }
  if (norm.kind === 'payment.failed') {
    return {
      providerTransactionId: norm.paymentIntentId,
      status: 'failed',
      failureReason: norm.lastError,
      paymentConnectionId: norm.metadata?.paymentConnectionId,
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Dedup helpers
// ─────────────────────────────────────────────────────────────────────────

function computeEventId(rawBody: Buffer, stripeEvent?: Stripe.Event | null): string {
  // Stripe assigns a stable event id (`evt_…`) — prefer it over the body hash so
  // dedup survives between API-version migrations that change body bytes.
  if (stripeEvent?.id) return stripeEvent.id;
  return `synthetic-${crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`;
}

async function alreadyProcessedEvent(provider: string, eventId: string): Promise<boolean> {
  const row = await db.query.processedEvents.findFirst({
    where: and(eq(processedEvents.provider, provider), eq(processedEvents.eventId, eventId)),
  });
  return Boolean(row);
}

async function markEventProcessed(provider: string, eventId: string): Promise<void> {
  await db.insert(processedEvents).values({ provider, eventId }).onConflictDoNothing();
}

// ─────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────

export const webhookRouter = express.Router();

webhookRouter.post('/webhooks/byok/:connectionId', async (req, res) => {
  const { connectionId } = req.params;

  // 1. Look up the connection
  const conn = await db.query.paymentConnections.findFirst({
    where: eq(paymentConnections.id, connectionId),
  });
  if (!conn) return res.status(404).json({ error: 'Unknown connection' });

  // 2. Raw body required for HMAC
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody) return res.status(400).json({ error: 'raw body required' });

  // 3. Decrypt credentials
  // The intersection type is for TypeScript only; at runtime, only the fields
  // for `conn.provider` are present in the encrypted blob.
  const credentials = decryptCredentials<
    StripeCredentials & MonerooCredentials & BictorysCredentials & PaytechCredentials
  >(conn.credentialsEncrypted as EncryptedPayload);

  // PayTech doesn't use a separate webhookSecret — it signs/echoes with API_KEY+API_SECRET.
  // Stripe and the others need an explicit webhookSecret (whsec_… for Stripe, dashboard-issued for the others).
  if (
    (conn.provider === 'stripe' || conn.provider === 'moneroo' || conn.provider === 'bictorys') &&
    !credentials.webhookSecret
  ) {
    return res.status(400).json({
      error: `webhookSecret not configured on connection ${connectionId}`,
    });
  }

  // 4. Pre-parse for PayTech (form-encoded support) — the body parser middleware
  //    only handles JSON; PayTech ships form-encoded by default.
  let paytechBody: PaytechIPNPayload | null = null;
  if (conn.provider === 'paytech') {
    paytechBody = parsePaytechBody(rawBody, req);
    if (!paytechBody) {
      return res.status(400).json({ error: 'PayTech: cannot parse IPN body' });
    }
  }

  // Stripe gets verified-and-parsed in one shot via constructEvent. The other
  // providers verify here, then parse separately at step 6.
  let stripeEvent: Stripe.Event | null = null;
  if (conn.provider === 'stripe') {
    const stripeResult = verifyStripe(rawBody, req, credentials);
    if (!stripeResult.ok) {
      console.error('[WEBHOOK] Stripe verification failed', {
        connectionId,
        error: stripeResult.error,
      });
      return res.status(401).json({ error: stripeResult.error });
    }
    stripeEvent = stripeResult.event;
  }

  // 5. Verify signature (non-Stripe providers — Stripe was handled above)
  const verified =
    conn.provider === 'stripe'
      ? { ok: true as const }
      : conn.provider === 'moneroo'
        ? verifyMoneroo(rawBody, req, credentials.webhookSecret!)
        : conn.provider === 'bictorys'
          ? verifyBictorys(rawBody, req, credentials.webhookSecret!)
          : conn.provider === 'paytech'
            ? verifyPaytech(paytechBody!, credentials)
            : {
                ok: false as const,
                error: `Unsupported provider ${conn.provider}`,
              };

  if (!verified.ok) {
    console.error('[WEBHOOK] verification failed', {
      connectionId,
      provider: conn.provider,
      error: verified.error,
    });
    return res.status(401).json({ error: verified.error });
  }

  // 6. Parse + normalize the event
  //
  // Stripe is special: it emits ~40 event types. Only a few map cleanly onto the
  // "one event = one payment-row update" model used by the rest of the handler:
  //   - checkout.session.completed (mode=payment)        → payment-row update
  //   - payment_intent.succeeded / .payment_failed       → payment-row update
  // Subscription lifecycle events (invoice.paid, customer.subscription.{updated,deleted})
  // belong to a separate `handleStripeSubscriptionEvent` dispatcher because they
  // touch the subscription / entitlement record, not the one-shot payment row.
  // See references/stripe.md "Webhook events — what fires when".
  let event: (ReturnType<typeof parseMonerooEvent> & object) | null = null;

  if (conn.provider === 'stripe') {
    const norm = normalizeStripeEvent(stripeEvent!);
    if (!norm) {
      // Unhandled (and harmless) event type — ack and move on.
      await markEventProcessed(conn.provider, computeEventId(rawBody));
      return res.json({ received: true, ignored: true, type: stripeEvent!.type });
    }

    // Subscription / invoice events: hand off to the subscription dispatcher.
    // Implement this in your app — see references/stripe.md for shape and lifecycle.
    if (
      norm.kind === 'subscription.updated' ||
      norm.kind === 'subscription.deleted' ||
      norm.kind === 'invoice.paid' ||
      norm.kind === 'invoice.payment_failed'
    ) {
      // await handleStripeSubscriptionEvent(norm, conn, credentials);  // ← your code
      await markEventProcessed(conn.provider, computeEventId(rawBody));
      return res.json({ received: true, kind: norm.kind, deferred: true });
    }

    // Map the payment-row events into the same shape as the African providers.
    event = stripeEventToPaymentEvent(norm);
  } else {
    event =
      conn.provider === 'moneroo'
        ? parseMonerooEvent(req.body)
        : conn.provider === 'bictorys'
          ? parseBictorysEvent(req.body)
          : conn.provider === 'paytech'
            ? parsePaytechEvent(paytechBody!)
            : null;
  }
  if (!event) return res.json({ received: true, ignored: true });

  // PayTech: pull paymentConnectionId out of custom_field for ownership check below.
  // (Other providers carry it in `metadata.paymentConnectionId` natively;
  //  Stripe carries it in `event.metadata` of either Checkout Session or PaymentIntent.)
  if (conn.provider === 'paytech' && paytechBody) {
    const cf = parsePaytechCustomField<{ paymentConnectionId?: string }>(paytechBody.custom_field);
    if (cf?.paymentConnectionId) {
      // Stash on the event for the ownership check at step 9 of this handler.
      (event as any).paymentConnectionId = cf.paymentConnectionId;
    }
  }

  // 7. Dedup
  const eventId = computeEventId(rawBody);
  if (await alreadyProcessedEvent(conn.provider, eventId)) {
    return res.json({ received: true, deduped: true });
  }

  // 8. Defense-in-depth re-query
  //    - Moneroo: supported, recommended.
  //    - PayTech: supported, recommended (defends against the SHA256-of-keys leak case).
  //    - Bictorys: SKIP — their WAF blocks follow-up calls from server IPs.
  if (conn.provider === 'moneroo' && event.status === 'completed') {
    const live = await monerooAdapter.verifyPayment(
      event.providerTransactionId,
      credentials.secretKey,
    );
    if (live && live.status !== 'success') {
      event.status = 'failed';
      event.failureReason = `Re-query mismatch: live=${live.status}`;
    } else if (live) {
      event.reportedAmount = typeof live.amount === 'number' ? live.amount : event.reportedAmount;
      event.reportedCurrency = live.currency || event.reportedCurrency;
    }
  } else if (conn.provider === 'paytech' && event.status === 'completed') {
    const live = await paytechAdapter.verifyPayment(event.providerTransactionId, credentials);
    if (live && live.status !== 'completed') {
      event.status = 'failed';
      event.failureReason = `Re-query mismatch: live=${live.status}`;
    }
  } else if (conn.provider === 'stripe' && event.status === 'completed') {
    // Optional belt-and-braces: re-fetch the Checkout Session or PaymentIntent
    // and confirm the live status matches the webhook. constructEvent already
    // protects against forged signatures, so this is only useful if the webhook
    // secret could have leaked separately from the API key. Safe to skip.
    //
    // const live = await stripeAdapter.verifySession(event.providerTransactionId, credentials);
    // if (live && live.status !== "paid") { event.status = "failed"; … }
  }

  // 8. Find the payments row
  const payment = await db.query.payments.findFirst({
    where: eq(payments.providerTransactionId, event.providerTransactionId),
  });
  if (!payment) {
    console.error('[WEBHOOK] payment row not found', {
      provider: conn.provider,
      providerTransactionId: event.providerTransactionId,
    });
    // 200 to avoid retries for an event we'll never resolve.
    await markEventProcessed(conn.provider, eventId);
    return res.json({ received: true, orphaned: true });
  }

  // 10. Ownership check (BYOK / multi-merchant): the row's connection must match
  if (payment.metadata?.paymentConnectionId !== conn.id) {
    console.error('[WEBHOOK] connection mismatch', {
      paymentId: payment.id,
      expected: payment.metadata?.paymentConnectionId,
      got: conn.id,
    });
    return res.status(403).json({ error: 'Connection mismatch' });
  }

  // 11. Amount tampering check
  // PayTech mobile-money settlements may arrive ~3% lower than charged due to operator fees.
  // Allow a 5% tolerance for PayTech, exact match for Moneroo / Bictorys.
  const tolerance = conn.provider === 'paytech' ? 0.05 : 0;
  if (typeof event.reportedAmount === 'number') {
    const min = Math.floor(payment.amountTotal * (1 - tolerance));
    const max = payment.amountTotal;
    if (event.reportedAmount < min || event.reportedAmount > max) {
      console.error('[WEBHOOK] amount tampering or fee anomaly', {
        provider: conn.provider,
        paymentId: payment.id,
        expected: payment.amountTotal,
        got: event.reportedAmount,
        toleranceWindow: [min, max],
      });
      return res.status(400).json({ error: 'Amount mismatch' });
    }
  }
  if (event.reportedCurrency && event.reportedCurrency !== payment.currency) {
    return res.status(400).json({ error: 'Currency mismatch' });
  }

  // 11. Atomic, idempotent state transition
  const target = event.status === 'completed' ? 'completed' : 'failed';
  const updated = await db
    .update(payments)
    .set({
      status: target,
      webhookReceivedAt: new Date(),
      failureReason: event.failureReason ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    .returning({ id: payments.id });

  if (updated.length === 0) {
    // Already in a terminal state — no-op.
    await markEventProcessed(conn.provider, eventId);
    return res.json({ received: true, alreadyProcessed: true });
  }

  // 12. Grant entitlement (only on success)
  if (target === 'completed') {
    try {
      await grantEntitlement(payment);
    } catch (err) {
      // Log but don't fail the webhook — the row is already marked completed,
      // and your entitlement granter should itself be idempotent. A background
      // job should reconcile any divergence.
      console.error('[WEBHOOK] grant failed', {
        paymentId: payment.id,
        error: (err as Error).message,
      });
    }
  }

  // 13. Mark dedup, respond 200
  await markEventProcessed(conn.provider, eventId);
  return res.json({ received: true });
});
