/**
 * PayTech adapter — drop-in.
 * https://docs.intech.sn/doc_paytech.php
 *
 * PayTech is a Senegal-based hosted-checkout aggregator covering Wave, Orange Money,
 * Free Money, MTN Money and card. Mobile-money coverage is partial UEMOA: SN, CI, ML, BJ
 * (Burkina Faso is NOT covered by PayTech mobile money — fall back to Moneroo).
 *
 * Two quirks vs Moneroo / Bictorys:
 *   1. Auth uses two custom headers: `API_KEY` and `API_SECRET` (uppercase, snake_case).
 *      No `Authorization: Bearer ...` here.
 *   2. The IPN ships as `application/x-www-form-urlencoded` (not JSON). The webhook
 *      handler MUST handle both content types — see `parsePaytechBody` in webhook-handler.
 *
 * Usage:
 *   import { paytechAdapter, paytechCredentialsSchema } from "./paytech";
 *   const credentials = paytechCredentialsSchema.parse(input);
 *   const result = await paytechAdapter.initiatePayment(params, credentials);
 *   if (result.ok) redirect(result.checkoutUrl);
 */

import { z } from 'zod';
import crypto from 'node:crypto';

const PAYTECH_API_URL = 'https://paytech.sn/api';
const FETCH_TIMEOUT_MS = 15_000;

// PayTech absorbs ~3% on mobile money. If you want the merchant to receive the full
// gross amount, charge the buyer `gross / (1 - 0.03)`. If you want PayTech to deduct
// from a fixed buyer-charge, send `floor(gross / 1.03)` as `amount`. The adapter does
// not auto-adjust — pass the amount you want PayTech to charge the buyer.
export const PAYTECH_FEE_RATE = 0.03;

// ─────────────────────────────────────────────────────────────────────────
// Credentials schema
// ─────────────────────────────────────────────────────────────────────────

export const paytechCredentialsSchema = z.object({
  apiKey: z.string().trim().min(10),
  apiSecret: z.string().trim().min(10),
});

export type PaytechCredentials = z.infer<typeof paytechCredentialsSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Shared types (identical shape to other adapters in this skill)
// ─────────────────────────────────────────────────────────────────────────

// Confirmed operator strings accepted by PayTech. Other values may exist;
// consult the PayTech dashboard before using anything beyond this list.
// You can also pass comma-separated lists like "Wave,Orange Money".
export type PaytechOperator = 'Orange Money' | 'Wave' | 'Free Money' | 'Carte Bancaire' | string;

export type InitiatePaymentParams = {
  amount: number; // integer XOF
  currency: 'XOF';
  description: string;
  itemName: string; // shown on the hosted page header
  reference: string; // your DB row UUID — used to correlate the IPN later
  returnUrl: string;
  cancelUrl: string;
  ipnUrl: string; // public HTTPS URL — no localhost, PayTech rejects HTTP
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
  /** Restrict the hosted page to specific operators. Omit to show all. */
  targetPayment?: PaytechOperator;
  /** Override the env (defaults to NODE_ENV-based detection). */
  env?: 'test' | 'prod';
};

export type InitiatePaymentResult =
  | {
      ok: true;
      providerTransactionId: string; // PayTech `token`
      checkoutUrl: string; // PayTech `redirect_url`
      status: 'pending';
    }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────
// IPN payload (what PayTech POSTs to your ipnUrl)
// ─────────────────────────────────────────────────────────────────────────

export type PaytechIPNPayload = {
  type_event: 'sale_complete' | 'sale_canceled' | 'refund_complete';
  custom_field: string; // JSON or base64-encoded JSON
  ref_command: string; // your reference (or `${itemName}` fallback)
  item_name: string;
  item_price: string | number; // PayTech sends as string in form-encoded mode
  currency: string;
  command_name: string;
  token: string; // matches the `providerTransactionId` you stored at init
  env: string;
  payment_method: string; // "Wave" | "Orange Money" | "Carte Bancaire" | ...
  client_phone: string;
  api_key_sha256: string;
  api_secret_sha256: string;
  hmac_compute?: string; // present iff dashboard HMAC mode is enabled
};

// ─────────────────────────────────────────────────────────────────────────
// Internal fetch with timeout
// ─────────────────────────────────────────────────────────────────────────

async function paytechFetch(path: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${PAYTECH_API_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────

export const paytechAdapter = {
  async initiatePayment(
    params: InitiatePaymentParams,
    credentials: PaytechCredentials,
  ): Promise<InitiatePaymentResult> {
    const env = params.env ?? (process.env.NODE_ENV === 'production' ? 'prod' : 'test');

    // PayTech requires a snake_case body. Field naming differs from Moneroo —
    // do NOT generalize blindly across providers.
    const body: Record<string, unknown> = {
      item_name: params.itemName,
      item_price: params.amount,
      currency: params.currency,
      ref_command: params.reference,
      command_name: params.description.slice(0, 200),
      env,
      ipn_url: params.ipnUrl,
      success_url: params.returnUrl,
      cancel_url: params.cancelUrl,
      // Stringified JSON. PayTech sometimes echoes back base64-encoded — the
      // webhook parser handles both.
      custom_field: JSON.stringify(
        Object.fromEntries(
          Object.entries({
            ...(params.metadata ?? {}),
            customer_email: params.customerEmail,
            ...(params.customerName ? { customer_name: params.customerName } : {}),
            ...(params.customerPhone ? { customer_phone: params.customerPhone } : {}),
          }).filter(([, v]) => v !== undefined && v !== null && String(v).length > 0),
        ),
      ),
      ...(params.targetPayment ? { target_payment: params.targetPayment } : {}),
    };

    let res: Response;
    try {
      res = await paytechFetch('/payment/request-payment', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          // ⚠️ NOT `Authorization: Bearer ...`. PayTech uses two custom headers,
          // uppercase + underscore, both required.
          API_KEY: credentials.apiKey,
          API_SECRET: credentials.apiSecret,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Network error contacting PayTech: ${(err as Error).message}`,
      };
    }

    let parsed: {
      success?: number; // PayTech uses 1 / 0, not boolean
      token?: string;
      redirect_url?: string;
      redirectUrl?: string;
      message?: string;
    };
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      return { ok: false, error: `PayTech returned ${res.status} (non-JSON)` };
    }

    if (parsed.success !== 1 || !parsed.token) {
      return {
        ok: false,
        error: parsed.message || `PayTech responded ${res.status} (success=${parsed.success})`,
      };
    }

    const checkoutUrl = parsed.redirect_url || parsed.redirectUrl;
    if (!checkoutUrl) {
      return { ok: false, error: 'PayTech response missing redirect_url' };
    }

    return {
      ok: true,
      providerTransactionId: parsed.token,
      checkoutUrl,
      status: 'pending',
    };
  },

  /**
   * Re-query a payment status. Useful for defense-in-depth in the webhook,
   * AND for reconciliation cron jobs.
   *
   * PayTech's `get-status` endpoint accepts the token via query string and
   * returns a JSON envelope with the latest state.
   */
  async verifyPayment(
    token: string,
    credentials: PaytechCredentials,
  ): Promise<{
    status: 'completed' | 'pending' | 'failed' | 'cancelled' | 'refunded' | string;
    raw: unknown;
  } | null> {
    let res: Response;
    try {
      res = await paytechFetch(`/payment/get-status?token_payment=${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          API_KEY: credentials.apiKey,
          API_SECRET: credentials.apiSecret,
        },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    const json = (await res.json().catch(() => null)) as {
      status?: string;
      payment_status?: string;
      data?: { status?: string };
    } | null;
    if (!json) return null;

    const raw = json.status || json.payment_status || json.data?.status || 'unknown';
    const lc = String(raw).toLowerCase();
    const status: 'completed' | 'pending' | 'failed' | 'cancelled' | 'refunded' | string =
      lc.includes('complete') || lc.includes('success')
        ? 'completed'
        : lc.includes('cancel')
          ? 'cancelled'
          : lc.includes('refund')
            ? 'refunded'
            : lc.includes('fail')
              ? 'failed'
              : 'pending';

    return { status, raw: json };
  },

  /**
   * Probe key validity without making a real charge. PayTech doesn't expose a
   * dedicated `whoami`, so we hit `get-status` with a synthetic token. A 401/403
   * means the keys are wrong; a 404/422 means the keys are accepted but the
   * token doesn't exist (= keys OK).
   */
  async probeKey(credentials: PaytechCredentials): Promise<{ ok: boolean; error?: string }> {
    let res: Response;
    try {
      res = await paytechFetch(`/payment/get-status?token_payment=izi_probe_${Date.now()}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          API_KEY: credentials.apiKey,
          API_SECRET: credentials.apiSecret,
        },
      });
    } catch (err) {
      return { ok: false, error: `Network error: ${(err as Error).message}` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid PayTech API_KEY / API_SECRET' };
    }
    return { ok: true };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// IPN signature verification (call this BEFORE trusting the payload)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verify a PayTech IPN payload using whichever method the dashboard is configured for.
 *
 * Method 1 — HMAC-SHA256 (preferred, only present if HMAC mode is enabled):
 *   message = `${item_price}|${ref_command}|${apiKey}`
 *   expected = hex(HMAC_SHA256(message, apiSecret))
 *   compare timing-safe vs `payload.hmac_compute`
 *
 * Method 2 — SHA256-of-keys (always present, used as fallback):
 *   sha256(apiKey)    === payload.api_key_sha256
 *   sha256(apiSecret) === payload.api_secret_sha256
 *
 * Both methods MUST be supported. The payload always includes the SHA256 hashes;
 * `hmac_compute` is opt-in per dashboard setting. Try HMAC first if present.
 */
export function verifyPaytechIPN(
  payload: PaytechIPNPayload,
  credentials: PaytechCredentials,
): { ok: boolean; method?: 'hmac' | 'sha256-keys'; error?: string } {
  // ── Method 1: HMAC ──
  if (payload.hmac_compute) {
    const message = `${payload.item_price}|${payload.ref_command}|${credentials.apiKey}`;
    const expected = crypto
      .createHmac('sha256', credentials.apiSecret)
      .update(message)
      .digest('hex');
    const a = Buffer.from(payload.hmac_compute);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { ok: true, method: 'hmac' };
    }
    // HMAC failed — do NOT silently fall back, log it. But we still try the
    // SHA256-keys method because PayTech sometimes ships both (and we don't
    // want a single typo'd HMAC to lock out a real notification).
  }

  // ── Method 2: SHA256-of-keys ──
  const expectedKeyHash = crypto.createHash('sha256').update(credentials.apiKey).digest('hex');
  const expectedSecretHash = crypto
    .createHash('sha256')
    .update(credentials.apiSecret)
    .digest('hex');

  const aK = Buffer.from(payload.api_key_sha256 ?? '');
  const bK = Buffer.from(expectedKeyHash);
  const aS = Buffer.from(payload.api_secret_sha256 ?? '');
  const bS = Buffer.from(expectedSecretHash);

  const keyOk = aK.length === bK.length && crypto.timingSafeEqual(aK, bK);
  const secretOk = aS.length === bS.length && crypto.timingSafeEqual(aS, bS);

  if (keyOk && secretOk) return { ok: true, method: 'sha256-keys' };
  return { ok: false, error: 'PayTech IPN signature invalid' };
}

// ─────────────────────────────────────────────────────────────────────────
// Custom field decoding (PayTech sometimes base64-encodes it server-side)
// ─────────────────────────────────────────────────────────────────────────

export function parsePaytechCustomField<
  T extends Record<string, unknown> = Record<string, unknown>,
>(customField: string | null | undefined): T | null {
  if (!customField) return null;
  // Try base64 first (PayTech docs say this is the norm; reality is mixed).
  try {
    const decoded = Buffer.from(customField, 'base64').toString('utf-8');
    const json = JSON.parse(decoded) as T;
    if (json && typeof json === 'object') return json;
  } catch {
    // not base64 → try direct
  }
  try {
    return JSON.parse(customField) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Normalize an IPN to the same shape used by the other providers
// ─────────────────────────────────────────────────────────────────────────

export type NormalizedEvent = {
  providerTransactionId: string;
  status: 'completed' | 'failed' | 'pending' | 'refunded';
  failureReason?: string;
  reportedAmount?: number;
  reportedCurrency?: string;
  reference?: string;
  paymentMethod?: string;
};

export function parsePaytechEvent(payload: PaytechIPNPayload): NormalizedEvent | null {
  if (!payload?.token || !payload.type_event) return null;

  const reportedAmount =
    typeof payload.item_price === 'number'
      ? payload.item_price
      : parseInt(payload.item_price as string, 10) || undefined;

  const base: NormalizedEvent = {
    providerTransactionId: payload.token,
    status: 'pending',
    reportedAmount,
    reportedCurrency: payload.currency,
    reference: payload.ref_command,
    paymentMethod: payload.payment_method,
  };

  switch (payload.type_event) {
    case 'sale_complete':
      return { ...base, status: 'completed' };
    case 'sale_canceled':
      return { ...base, status: 'failed', failureReason: 'sale_canceled' };
    case 'refund_complete':
      return { ...base, status: 'refunded' };
    default:
      return null;
  }
}
