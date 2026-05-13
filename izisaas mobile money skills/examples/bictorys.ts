/**
 * Bictorys BYOK adapter — drop-in.
 * https://docs.bictorys.com/
 *
 * Handles BOTH mobile money and card via the hosted Checkout endpoint.
 * The buyer chooses the method on the hosted page; we pre-select a tab
 * via the `payment_category` query param appended to the response URL.
 *
 * ⚠️  Critical: Bictorys is fronted by AWS WAF (Bot Control) which blocks
 * Node.js's default fetch (undici TLS fingerprint). We spawn `curl` instead.
 * Do NOT change curl args — minimal flags only. Adding -s, -A, --noproxy,
 * Accept, User-Agent, etc. will get you re-flagged.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileP = promisify(execFile);

const BICTORYS_API_URL_LIVE = 'https://api.bictorys.com';
const BICTORYS_API_URL_SANDBOX = 'https://api.test.bictorys.com';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES_ON_WAF_403 = 3;

// ─────────────────────────────────────────────────────────────────────────
// Credentials schema
// ─────────────────────────────────────────────────────────────────────────

export const bictorysCredentialsSchema = z.object({
  publicApiKey: z
    .string()
    .trim()
    .min(10)
    .refine(
      (v) => !/^sk_/.test(v) && !/^pk_/.test(v) && !/^whsec_/.test(v),
      "This isn't a Bictorys key — looks like a Stripe key.",
    ),
  webhookSecret: z.string().trim().min(1).optional(),
});

export type BictorysCredentials = z.infer<typeof bictorysCredentialsSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────

export type InitiatePaymentParams = {
  amount: number;
  currency: 'XOF' | 'XAF';
  description: string;
  reference: string; // your payments row UUID — round-tripped as paymentReference
  returnUrl: string;
  cancelUrl: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  paymentMode: 'mobile_money' | 'card';
  /** Merchant's home country (ISO-3166 alpha-2). Sent at body root + customerObject.country. Default "SN". */
  merchantCountry?: string;
  /** Customer city. Default "Dakar". For multi-country merchants, set to the buyer's city. */
  customerCity?: string;
  /** Hosted-page locale, e.g. "fr-FR", "en-US". Default "fr-FR". */
  locale?: string;
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
// Internal: API URL routing
// ─────────────────────────────────────────────────────────────────────────

function bictorysApiUrl(publicApiKey: string): string {
  return publicApiKey.startsWith('test_') ? BICTORYS_API_URL_SANDBOX : BICTORYS_API_URL_LIVE;
}

// ─────────────────────────────────────────────────────────────────────────
// Internal: curl-based fetch (WAF workaround)
// ─────────────────────────────────────────────────────────────────────────

type BictorysResponse = {
  ok: boolean;
  status: number;
  text: string;
  json: <T = unknown>() => Promise<T>;
};

function parseRawHttpResponse(raw: string): { status: number; body: string } {
  // curl -i emits: STATUS LINE\r\nHEADERS\r\n\r\nBODY
  const sep = raw.indexOf('\r\n\r\n');
  const head = sep >= 0 ? raw.slice(0, sep) : raw;
  const body = sep >= 0 ? raw.slice(sep + 4) : '';
  const statusLine = head.split(/\r?\n/)[0] ?? '';
  const m = statusLine.match(/^HTTP\/[\d.]+\s+(\d+)/);
  return { status: m ? parseInt(m[1]!, 10) : 0, body };
}

async function bictorysFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<BictorysResponse> {
  // Build minimal curl args. DO NOT ADD MORE FLAGS.
  const args: string[] = ['-i', '-X', init.method];
  for (const [k, v] of Object.entries(init.headers)) args.push('-H', `${k}: ${v}`);
  if (init.body) args.push('-d', init.body);
  args.push(url);

  let lastError = '';
  for (let attempt = 0; attempt < MAX_RETRIES_ON_WAF_403; attempt++) {
    try {
      const { stdout } = await execFileP('curl', args, {
        timeout: FETCH_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      const { status, body } = parseRawHttpResponse(stdout);

      // WAF block: 403 with HTML body. Retry with backoff.
      if (status === 403 && body.includes('Forbidden')) {
        lastError = `Bictorys WAF returned 403 (attempt ${attempt + 1}/${MAX_RETRIES_ON_WAF_403})`;
        if (attempt < MAX_RETRIES_ON_WAF_403 - 1) {
          await new Promise((r) => setTimeout(r, 2_000 * Math.pow(2, attempt))); // 2s, 4s, 8s
          continue;
        }
      }

      return {
        ok: status >= 200 && status < 300,
        status,
        text: body,
        json: async <T>() => JSON.parse(body) as T,
      };
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < MAX_RETRIES_ON_WAF_403 - 1) {
        await new Promise((r) => setTimeout(r, 2_000 * Math.pow(2, attempt)));
      }
    }
  }

  return {
    ok: false,
    status: 0,
    text: lastError,
    json: async () => {
      throw new Error(lastError);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────

export const bictorysAdapter = {
  async initiatePayment(
    params: InitiatePaymentParams,
    credentials: BictorysCredentials,
  ): Promise<InitiatePaymentResult> {
    const merchantCountry = params.merchantCountry ?? 'SN';

    // ⚠️  The body must NOT contain the substring "localhost" — Bictorys WAF
    // blocks it at the edge. In dev, your callers should provide URLs on a
    // tunneling domain (ngrok) that 302 to localhost, never localhost directly.
    if (params.returnUrl.includes('localhost') || params.cancelUrl.includes('localhost')) {
      return {
        ok: false,
        error:
          "Bictorys rejects request bodies containing 'localhost'. Use ngrok or a public-domain redirect-stub.",
      };
    }

    const body = {
      amount: params.amount,
      currency: params.currency,
      country: merchantCountry, // ROOT level
      paymentReference: params.reference,
      successRedirectUrl: params.returnUrl,
      // ⚠️  Bictorys is case-sensitive on this field name. Send BOTH casings.
      errorRedirectUrl: params.cancelUrl,
      ErrorRedirectUrl: params.cancelUrl,
      customerObject: {
        name: params.customerName || 'Customer',
        email: params.customerEmail || '',
        phone: params.customerPhone || '',
        city: params.customerCity ?? 'Dakar',
        country: merchantCountry,
        locale: params.locale ?? 'fr-FR',
      },
    };

    const url = `${bictorysApiUrl(credentials.publicApiKey)}/pay/v1/charges`;
    const res = await bictorysFetch(url, {
      method: 'POST',
      headers: {
        'X-Api-Key': credentials.publicApiKey, // PascalCase X-Api-Key
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const isWaf = res.status === 403 && res.text.includes('Forbidden');
      return {
        ok: false,
        error: isWaf
          ? 'Bictorys WAF blocked the request (3 retries exhausted). Likely sandbox/live key mismatch or IP flagged.'
          : `Bictorys responded ${res.status}: ${res.text.slice(0, 300)}`,
      };
    }

    let data: {
      transactionId?: string;
      chargeId?: string;
      link?: string;
      redirectUrl?: string;
    };
    try {
      data = await res.json();
    } catch {
      return { ok: false, error: 'Bictorys: invalid JSON response' };
    }

    const txId = data.transactionId || data.chargeId;
    let checkoutUrl = data.link || data.redirectUrl;
    if (!txId || !checkoutUrl) {
      return {
        ok: false,
        error: 'Bictorys: incomplete response (no transactionId or link)',
      };
    }

    // Force pre-selected tab (mobile_money | card) on the hosted page.
    try {
      const u = new URL(checkoutUrl);
      if (!u.searchParams.has('payment_category')) {
        u.searchParams.set('payment_category', params.paymentMode);
        checkoutUrl = u.toString();
      }
    } catch {
      // If the response URL is malformed for some reason, return as-is.
    }

    return {
      ok: true,
      providerTransactionId: txId,
      checkoutUrl,
      status: 'pending',
    };
  },

  /**
   * Re-query a transaction status.
   * ⚠️  In production, this call is often blocked by the WAF when made from
   * a server IP (even with curl). Skip Bictorys re-query and trust the signed
   * webhook. This helper is provided for completeness / dev / sandbox.
   */
  async verifyPayment(
    transactionId: string,
    publicApiKey: string,
  ): Promise<{ status: string; raw: unknown } | null> {
    const url = `${bictorysApiUrl(publicApiKey)}/pay/v1/transactions/${encodeURIComponent(
      transactionId,
    )}/status?by_charge_id=true`;
    const res = await bictorysFetch(url, {
      method: 'GET',
      headers: { 'X-Api-Key': publicApiKey, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    try {
      const data = (await res.json()) as { status?: string };
      if (!data.status) return null;
      return { status: String(data.status).toLowerCase(), raw: data };
    } catch {
      return null;
    }
  },

  /** Probe key validity. 401/403 (with JSON body) = bad key. WAF 403 (HTML) = network issue. */
  async probeKey(publicApiKey: string): Promise<{ ok: boolean; error?: string }> {
    const url = `${bictorysApiUrl(publicApiKey)}/pay/v1/transactions/izi_verify_probe_${Date.now()}/status?by_charge_id=true`;
    const res = await bictorysFetch(url, {
      method: 'GET',
      headers: { 'X-Api-Key': publicApiKey, Accept: 'application/json' },
    });
    if (res.status === 401) return { ok: false, error: 'Invalid Bictorys API key (401)' };
    if (res.status === 403 && !res.text.includes('Forbidden')) {
      return { ok: false, error: 'Bictorys API rejected key (403)' };
    }
    if (res.status === 403 && res.text.includes('Forbidden')) {
      return {
        ok: false,
        error: 'Bictorys WAF blocked probe — try again later',
      };
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
  paymentReference?: string; // your payments row UUID — useful as fallback lookup
};

export function parseBictorysEvent(body: unknown): NormalizedEvent | null {
  const b = body as {
    event?: string;
    status?: string;
    transactionId?: string;
    chargeId?: string;
    paymentReference?: string;
    amount?: number;
    currency?: string;
  } | null;
  if (!b) return null;

  const id = b.transactionId || b.chargeId;
  if (!id) return null;

  const rawStatus = (b.status || b.event || '').toLowerCase();

  if (
    rawStatus.includes('succeed') ||
    rawStatus === 'succeeded' ||
    rawStatus === 'payment.succeeded'
  ) {
    return {
      providerTransactionId: id,
      status: 'completed',
      reportedAmount: typeof b.amount === 'number' ? b.amount : undefined,
      reportedCurrency: b.currency,
      paymentReference: b.paymentReference,
    };
  }
  if (rawStatus.includes('fail') || rawStatus.includes('cancel')) {
    return {
      providerTransactionId: id,
      status: 'failed',
      failureReason: rawStatus,
      reportedAmount: typeof b.amount === 'number' ? b.amount : undefined,
      reportedCurrency: b.currency,
      paymentReference: b.paymentReference,
    };
  }
  // pending/processing → ignore
  return null;
}
