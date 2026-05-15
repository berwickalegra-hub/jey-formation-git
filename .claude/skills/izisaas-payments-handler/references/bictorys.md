# Bictorys — API Reference

Bictorys is a Senegal-based aggregator covering UEMOA mobile money (Wave, Orange Money, Free Money, Wizall, Maxit, MTN, Moov) plus card payments. The integration in this skill uses **Bictorys Checkout** (hosted page), which is more reliable than the Direct API for V1 — one endpoint handles both mobile money and card via a `payment_category` query parameter that pre-selects the tab on the hosted page.

## Base URLs

```
Production: https://api.bictorys.com
Sandbox:    https://api.test.bictorys.com
```

**Auto-detection from key prefix:**

```ts
function bictorysApiUrl(publicApiKey: string): string {
  return publicApiKey.startsWith("test_")
    ? "https://api.test.bictorys.com"
    : "https://api.bictorys.com";
}
```

## Auth

```
X-Api-Key: <publicApiKey>     // ⚠️  PascalCase X-Api-Key, NOT X-API-Key
Content-Type: application/json
Accept: application/json
```

Key formats:

- Production: `public-XXXX.YYYY`
- Sandbox: `test_public-XXXX.YYYY`

There is **no separate secret/private key** in V1 (no payouts API used). The same key signs requests AND identifies the merchant.

## Credentials shape (Zod)

```ts
import { z } from "zod";

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
```

## Endpoints used

| Purpose                     | Method | Path                                                                                    |
| --------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Create charge (MoMo + Card) | POST   | `/pay/v1/charges`                                                                       |
| Re-query transaction status | GET    | `/pay/v1/transactions/{transactionId}/status?by_charge_id=true`                         |
| Probe key validity          | GET    | `/pay/v1/transactions/probe_<unix_ts>/status?by_charge_id=true` (any 401/403 = bad key) |

**Note**: an older endpoint `GET /pay/v1/charges/{id}` returned 500 errors and was deprecated. Use `/pay/v1/transactions/{id}/status?by_charge_id=true` instead.

## ⚠️ AWS WAF / TLS Fingerprint Issue (production-critical)

Bictorys runs behind an AWS ALB (`server: awselb/2.0`) with WAF Bot Control enabled. The default Node.js HTTPS stack (`undici`, used by `fetch`, `axios`, `got`, etc.) has a JA3/JA4 TLS fingerprint that the WAF blocks. You will get:

```
HTTP/1.1 403 Forbidden
Content-Type: text/html
<body>...</body>
```

**Fix: spawn `curl` as a subprocess.** `curl`'s TLS fingerprint is allowed.

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

async function bictorysFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) {
  const args = ["-i", "-X", init.method];
  for (const [k, v] of Object.entries(init.headers))
    args.push("-H", `${k}: ${v}`);
  if (init.body) args.push("-d", init.body);
  args.push(url);
  const { stdout } = await execFileP("curl", args, { timeout: 15_000 });
  return parseRawHttpResponse(stdout);
}
```

**Do NOT add any of these flags** — they change the TLS/HTTP fingerprint enough to be re-flagged:

- `-s` / `--silent`
- `-A` / `--user-agent`
- `--noproxy *`
- `--data-raw` (use `-d`)
- `Accept` header (omit it on POST — let curl default)
- `User-Agent` header

Keep curl args **minimal**. See `examples/bictorys.ts` for the complete implementation including raw HTTP/1.1 response parsing.

**Retry strategy**: On `403 Forbidden` HTML response, retry up to 3 times with exponential backoff `2s, 4s, 8s`. Other 4xx/5xx are NOT retried.

### ⚠️ PII redaction in debug logs

If you log the curl invocation for debugging (you will, eventually), the body contains the customer's `name`, `email`, and `phone`. Redact before logging — don't ship raw PII to your log aggregator.

```ts
function redactPii(args: string[]): string[] {
  return args.map((a) =>
    a
      .replace(/"email":"[^"]+"/g, '"email":"[REDACTED]"')
      .replace(/"phone":"[^"]+"/g, '"phone":"[REDACTED]"')
      .replace(/"name":"[^"]+"/g, '"name":"[REDACTED]"'),
  );
}

if (process.env.DEBUG_BICTORYS) {
  console.log("[BICTORYS] curl", ["curl", ...redactPii(args)].join(" "));
}
```

The `X-Api-Key` header is also a secret — redact it the same way (`/X-Api-Key:[^"]+/`).

## Create charge — request body (verbatim, with all gotchas)

```jsonc
{
  "amount": 5000, // integer; XOF/XAF = whole francs (no decimals)
  "currency": "XOF", // "XOF" | "XAF"
  "country": "SN", // ⚠️  HARDCODED to merchant country (not buyer)
  "paymentReference": "<your-uuid>", // your payments row id; round-trips back in webhook
  "successRedirectUrl": "https://your.app/checkout/success?paymentId=<your-uuid>",
  "errorRedirectUrl": "https://your.app/checkout/cancel?paymentId=<your-uuid>",
  "ErrorRedirectUrl": "https://your.app/checkout/cancel?paymentId=<your-uuid>",
  // ⚠️  Both casings — Bictorys is case-sensitive on this field, the requirement varies by API version
  "customerObject": {
    "name": "Aminata Diallo",
    "email": "buyer@example.com",
    "phone": "+221771234567",
    "city": "Dakar",
    "country": "SN", // also hardcoded SN
    "locale": "fr-FR",
  },
}
```

**Quirks (re-stating them so they don't get missed):**

1. **`country` is hardcoded** to your merchant's home country (e.g. `"SN"` for V1). Even when the buyer is in another country. The buyer's actual country is irrelevant to the payment — Bictorys uses this to route through the right banking partner.
2. **`ErrorRedirectUrl` PascalCase + `errorRedirectUrl` camelCase**: send both. The Direct API docs say camelCase but production gateways have rejected camelCase only. Belt and braces.
3. **`paymentReference`**, NOT `client_reference_id` or `metadata.id`. This is the field that comes back in the webhook so you can find your row.
4. **`successRedirectUrl` / `errorRedirectUrl`**, NOT `success_url` / `cancel_url`.
5. **No `localhost` in body**: Bictorys WAF blocks any request whose body contains the substring `localhost`. In dev, use ngrok or a redirect-stub endpoint on your prod-like domain that 302s back to `localhost:3000`.
6. **`customerObject.locale`**: `"fr-FR"`, `"en-US"`. Drives the language of the hosted page.

## Create charge — response

```jsonc
{
  "transactionId": "tx_01ABCDEF...", // store as providerTransactionId
  // OR (Direct API, depending on endpoint variant):
  "chargeId": "ch_01ABCDEF...",
  "link": "https://checkout.bictorys.com/...", // hosted page URL — prefer this
  "redirectUrl": "https://checkout.bictorys.com/...", // sometimes this name; prefer `link`
}
```

Code:

```ts
const txId = data.transactionId || data.chargeId;
const checkoutUrl = data.link || data.redirectUrl;
if (!txId || !checkoutUrl)
  return { ok: false, error: "Bictorys: incomplete response" };
```

## Forcing the hosted page tab (Mobile Money vs Card)

The same charge response works for both modes — the buyer picks their method on the hosted page. To pre-select a tab, append `payment_category` to the returned URL:

```ts
const u = new URL(checkoutUrl);
if (!u.searchParams.has("payment_category")) {
  u.searchParams.set("payment_category", mode); // "mobile_money" | "card"
  checkoutUrl = u.toString();
}
```

This is documented in Bictorys's "Contrôler l'affichage des moyens de paiement" page. The values:

- `mobile_money` — shows MoMo tab pre-selected
- `card` — shows card tab pre-selected

### ⚠️ Whitelist `paymentMode` server-side

`paymentMode` typically arrives from the client (the buyer clicked "Mobile Money" or "Carte"). Treat it as untrusted input and validate against a whitelist before passing it to `payment_category`:

```ts
const BICTORYS_VALID_MODES = new Set(["mobile_money", "card"] as const);

if (!BICTORYS_VALID_MODES.has(paymentMode)) {
  return res.status(400).json({ error: `Invalid paymentMode: ${paymentMode}` });
}
```

Without this, a forged `paymentMode` value (e.g. `"javascript:alert(1)"`) gets reflected into the URL. The hosted page itself ignores unknown values, but it's a basic input-validation hygiene step.

- omitted — shows the picker

## Mobile Money provider list (informational)

The hosted page auto-detects the country and shows the right operators. You don't need to specify the operator in the request. For reference, supported MoMo providers (UEMOA only):

| Country            | Operators                                     |
| ------------------ | --------------------------------------------- |
| Sénégal (SN)       | Wave, Orange Money, Free Money, Wizall, Maxit |
| Côte d'Ivoire (CI) | Wave, Orange Money, MTN, Moov                 |
| Mali (ML)          | Wave, Orange Money, Moov                      |
| Burkina Faso (BF)  | Orange Money, Moov, Telecel                   |
| Bénin (BJ)         | MTN, Moov, Celtiis                            |
| Togo (TG)          | Flooz, T-Money                                |

If you need a Direct API call (no hosted page), the request body adds `provider: "wave_money_sn"` (etc.) — but Direct API has more WAF issues. Prefer the hosted page.

## Verify (re-query) — request

```ts
const url = `${apiUrl}/pay/v1/transactions/${encodeURIComponent(transactionId)}/status?by_charge_id=true`;
await bictorysFetch(url, {
  method: "GET",
  headers: { "X-Api-Key": publicApiKey, Accept: "application/json" },
});
```

Returns `{ status: "..." }`. Status values: lowercased `"pending"`, `"succeeded"`, `"failed"`, `"cancelled"`, plus `"processing"` for in-flight MoMo OTP confirmations.

**⚠️ In production, this re-query call will be 403'd by the WAF when called from a server IP** even with curl, because the IP itself can get flagged after a few rapid requests. We **disable re-query for Bictorys** and rely entirely on signed webhooks. Moneroo re-query works fine.

## Webhook payload (Bictorys → your API)

```jsonc
{
  "event": "payment.succeeded",          // or "payment.failed", "payment.cancelled"
  "transactionId": "tx_01ABCDEF...",
  "chargeId": "ch_01ABCDEF...",
  "paymentReference": "<your-uuid>",     // the value you sent in the charge request
  "amount": 5000,
  "currency": "XOF",
  "status": "succeeded",                  // "succeeded" | "failed" | "cancelled" | "pending"
  "paymentMethod": "wave_money_sn",       // or "card", etc.
  "customer": { "email": "...", "phone": "..." },
  "metadata": { ... }                      // optional
}
```

The exact field names vary slightly between webhook events. Read both `data.transactionId` and `data.chargeId` (one of them will be present). Map `status` to your internal enum:

| Bictorys status / event           | Internal status                              |
| --------------------------------- | -------------------------------------------- |
| `succeeded` / `payment.succeeded` | `completed`                                  |
| `failed` / `payment.failed`       | `failed`                                     |
| `cancelled` / `payment.cancelled` | `failed`                                     |
| `pending` / `processing`          | `pending` (ignore — wait for terminal state) |

## Webhook signature verification

Bictorys ships with **two signing modes**. Support both: HMAC mode is opt-in and not all merchants enable it.

### Mode 1 — HMAC (preferred when enabled)

Headers:

- `X-Webhook-Signature` — hex HMAC-SHA256
- `X-Webhook-Timestamp` — unix timestamp (sec OR ms — auto-detect)

Signed payload string: `` `${timestamp}.${rawBody}` ``

```ts
function verifyBictorysHmac(
  rawBody: Buffer,
  sig: string,
  ts: string,
  secret: string,
): boolean {
  let tsNum = parseInt(ts, 10);
  // Auto-detect ms vs sec: anything < 10_000_000_000 is seconds (year 2286 in ms)
  if (tsNum > 0 && tsNum < 10_000_000_000) tsNum *= 1000;
  // Replay protection: ±5 minutes
  if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > 5 * 60_000) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${rawBody.toString("utf-8")}`)
    .digest("hex");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

### Mode 2 — Static `X-Secret-Key` (default / fallback)

Header: `X-Secret-Key` — the same `webhookSecret` value, sent as plaintext. Compare with `crypto.timingSafeEqual` to prevent timing attacks:

```ts
function verifyBictorysStatic(
  headerSecret: string,
  expectedSecret: string,
): boolean {
  const a = Buffer.from(headerSecret);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

### Combined verification

```ts
function verifyBictorys(
  req: Request,
  rawBody: Buffer,
  secret: string,
): { ok: boolean; error?: string } {
  const sig = req.headers["x-webhook-signature"] as string | undefined;
  const ts = req.headers["x-webhook-timestamp"] as string | undefined;
  if (sig && ts) {
    return verifyBictorysHmac(rawBody, sig, ts, secret)
      ? { ok: true }
      : { ok: false, error: "Bictorys HMAC signature invalid" };
  }
  const staticKey = req.headers["x-secret-key"] as string | undefined;
  if (!staticKey) {
    return {
      ok: false,
      error:
        "No signature header (X-Webhook-Signature or X-Secret-Key required)",
    };
  }
  return verifyBictorysStatic(staticKey, secret)
    ? { ok: true }
    : { ok: false, error: "Bictorys X-Secret-Key invalid" };
}
```

## Idempotency / event dedup

Like Moneroo, Bictorys does not provide a stable `event_id`. Compute synthetic:

```ts
const eventId = `synthetic-${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
```

Store in `processed_events (provider, eventId, processedAt)` with 24h TTL. Reject duplicates with `{ received: true, deduped: true }`.

## Sandbox testing

- Test card: `4242 4242 4242 4242` (success), CVV any, exp any future date.
- Test mobile money: select Wave/OM in sandbox, enter any phone, confirm OTP `123456`.
- Failure simulation: amount `13` (or as documented in their dashboard) triggers a forced failure.

## Probe key validity

```ts
async function probeKey(
  publicApiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${bictorysApiUrl(publicApiKey)}/pay/v1/transactions/izi_verify_probe_${Date.now()}/status?by_charge_id=true`;
  const res = await bictorysFetch(url, {
    method: "GET",
    headers: { "X-Api-Key": publicApiKey, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403)
    return { ok: false, error: "Invalid Bictorys key" };
  return { ok: true }; // 404 (probe doesn't exist) is the normal "key OK" response
}
```

## Dashboard URLs (for merchant-facing UI)

- API keys: Bictorys dashboard → **Developers → API Keys**
- Webhooks: Bictorys dashboard → **Developers → Webhooks** — paste your endpoint there.
- Webhook secret: revealed once when the webhook is created in the dashboard. Tell merchants to copy it immediately.
- HMAC mode toggle: per-webhook setting in the dashboard. Optional but recommended for production.

## Common errors and fixes

| Error                                        | Cause                                             | Fix                                            |
| -------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `403 Forbidden` HTML page                    | AWS WAF blocked your TLS fingerprint              | Use `curl` subprocess, minimal args            |
| `403 Forbidden` after retries                | Server IP itself blocked                          | Wait, or contact Bictorys to whitelist         |
| `400 ErrorRedirectUrl required`              | Sent only `errorRedirectUrl`                      | Send both casings                              |
| `400` no clear message, body has `localhost` | WAF rejects URLs containing `localhost`           | Use ngrok / dev-redirect endpoint              |
| Webhook signature fails on every request     | Used `JSON.stringify(req.body)` for HMAC          | Use raw `Buffer` from middleware               |
| `Bictorys timestamp out of tolerance`        | Server clock drift > 5 min                        | NTP sync your server                           |
| `incomplete response`                        | Got `link` but no `transactionId` (or vice versa) | Bictorys flaky; retry once                     |
| Hosted page shows wrong tab                  | Forgot to append `payment_category`               | Append it as a query param to the response URL |

## Migration / version notes

- **April 2026**: `GET /pay/v1/charges/{id}` deprecated (returned 500). Use `/pay/v1/transactions/{id}/status?by_charge_id=true`.
- HMAC webhook mode rolled out gradually starting late 2025. Older merchant accounts may still be on `X-Secret-Key`-only.
