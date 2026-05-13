/**
 * Moneroo BYOK adapter — drop-in.
 * https://docs.moneroo.io/
 *
 * Usage:
 *   import { monerooAdapter, monerooCredentialsSchema } from "./moneroo";
 *   const credentials = monerooCredentialsSchema.parse(input);
 *   const result = await monerooAdapter.initiatePayment(params, credentials);
 *   if (result.ok) redirect(result.checkoutUrl);
 */

import { z } from 'zod';

const MONEROO_API_URL = 'https://api.moneroo.io';
const FETCH_TIMEOUT_MS = 15_000;

// ─────────────────────────────────────────────────────────────────────────
// Credentials schema
// ─────────────────────────────────────────────────────────────────────────

export const monerooCredentialsSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .min(10)
    .refine(
      (v) => !/^sk_/.test(v) && !/^pk_/.test(v) && !/^whsec_/.test(v),
      "This isn't a Moneroo key — looks like a Stripe key (sk_/pk_/whsec_).",
    ),
  webhookSecret: z.string().trim().min(1).optional(),
});

export type MonerooCredentials = z.infer<typeof monerooCredentialsSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────

export type InitiatePaymentParams = {
  amount: number;
  currency: 'XOF' | 'XAF' | 'USD' | 'EUR' | string;
  description: string;
  reference: string;
  returnUrl: string;
  cancelUrl?: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
};

export type InitiatePaymentResult =
  | {
      ok: true;
      providerTransactionId: string;
      checkoutUrl: string;
      status: 'pending';
    }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function splitName(
  full: string | undefined,
  fallbackEmail: string,
): { first: string; last: string } {
  const v = (full ?? '').trim();
  if (!v) {
    const local = fallbackEmail.split('@')[0] || 'Customer';
    return { first: local, last: '-' };
  }
  const parts = v.split(/\s+/);
  return { first: parts[0]!, last: parts.slice(1).join(' ') || '-' };
}

async function monerooFetch(path: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${MONEROO_API_URL}${path}`, {
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

export const monerooAdapter = {
  async initiatePayment(
    params: InitiatePaymentParams,
    credentials: MonerooCredentials,
  ): Promise<InitiatePaymentResult> {
    const { first, last } = splitName(params.customerName, params.customerEmail);

    const body: Record<string, unknown> = {
      amount: params.amount,
      currency: params.currency,
      description: params.description.slice(0, 200),
      return_url: params.returnUrl,
      customer: {
        email: params.customerEmail,
        first_name: first,
        last_name: last,
        ...(params.customerPhone ? { phone: params.customerPhone } : {}),
      },
      metadata: Object.fromEntries(
        Object.entries(params.metadata ?? {})
          .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
          .map(([k, v]) => [k, String(v)]),
      ),
    };

    let res: Response;
    try {
      res = await monerooFetch('/v1/payments/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.secretKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Network error contacting Moneroo: ${(err as Error).message}`,
      };
    }

    let parsed: {
      data?: { id?: string; checkout_url?: string };
      message?: string;
    };
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      return { ok: false, error: `Moneroo returned ${res.status} (non-JSON)` };
    }

    if (!res.ok || !parsed.data?.id || !parsed.data?.checkout_url) {
      return {
        ok: false,
        error: parsed.message || `Moneroo responded ${res.status}`,
      };
    }

    return {
      ok: true,
      providerTransactionId: parsed.data.id,
      checkoutUrl: parsed.data.checkout_url,
      status: 'pending',
    };
  },

  /** Re-query a payment status. Used for defense-in-depth in webhook handler. */
  async verifyPayment(
    paymentId: string,
    secretKey: string,
  ): Promise<{
    status: string;
    amount?: number;
    currency?: string;
    raw: unknown;
  } | null> {
    let res: Response;
    try {
      res = await monerooFetch(`/v1/payments/${encodeURIComponent(paymentId)}/verify`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    const json = (await res.json().catch(() => null)) as {
      data?: {
        status?: string;
        amount?: number | string;
        currency?: { code?: string } | string;
      };
    } | null;
    if (!json?.data?.status) return null;

    const currency =
      typeof json.data.currency === 'string' ? json.data.currency : json.data.currency?.code;

    return {
      status: String(json.data.status).toLowerCase(),
      amount:
        typeof json.data.amount === 'string' ? parseInt(json.data.amount, 10) : json.data.amount,
      currency,
      raw: json,
    };
  },

  /**
   * Probe key validity without making a real charge.
   * Hits a fake payment ID. 401/403 = bad key. Anything else = key OK.
   */
  async probeKey(secretKey: string): Promise<{ ok: boolean; error?: string }> {
    let res: Response;
    try {
      res = await monerooFetch(`/v1/payments/izi_verify_probe_${Date.now()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      return { ok: false, error: `Network error: ${(err as Error).message}` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid Moneroo API key' };
    }
    return { ok: true };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Webhook payload normalization
// ─────────────────────────────────────────────────────────────────────────

export type NormalizedEvent = {
  providerTransactionId: string;
  status: 'completed' | 'failed' | 'pending';
  failureReason?: string;
  reportedAmount?: number;
  reportedCurrency?: string;
};

export function parseMonerooEvent(body: unknown): NormalizedEvent | null {
  const b = body as { event?: string; data?: Record<string, unknown> } | null;
  if (!b?.event || !b.data) return null;

  const data = b.data;
  const id = data.id as string | undefined;
  if (!id) return null;

  const reportedAmount =
    typeof data.amount === 'number'
      ? data.amount
      : typeof data.amount === 'string'
        ? parseInt(data.amount, 10)
        : undefined;
  const reportedCurrency =
    typeof data.currency === 'string'
      ? data.currency
      : (data.currency as { code?: string } | undefined)?.code;

  if (b.event === 'payment.success') {
    return {
      providerTransactionId: id,
      status: 'completed',
      reportedAmount,
      reportedCurrency,
    };
  }
  if (b.event === 'payment.failed' || b.event === 'payment.cancelled') {
    return {
      providerTransactionId: id,
      status: 'failed',
      failureReason: typeof data.status === 'string' ? data.status : b.event,
      reportedAmount,
      reportedCurrency,
    };
  }
  // payment.initiated → ignore (we already inserted pending row)
  return null;
}
