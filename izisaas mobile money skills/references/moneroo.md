# Moneroo — API Reference

Moneroo is a hosted multi-provider aggregator covering the whole African mobile money market plus cards. One API, ~10 underlying providers (Wave, Orange Money, MTN, Moov, Airtel, Free Money, Mvola, etc.). The buyer is redirected to Moneroo's hosted page; Moneroo presents the right methods based on currency + locale.

## Base URL

```
https://api.moneroo.io
```

There is **no separate sandbox host**. Sandbox vs live is determined by the secret key itself. Test keys typically have a different prefix or are flagged in the dashboard. Keep this in mind: the same URL serves both — the key is the only switch.

## Auth

```
Authorization: Bearer <secretKey>
Accept: application/json
Content-Type: application/json
```

Bad key → `401 Unauthorized` with body `{ "message": "Unauthorized : Invalid API Key" }`.

## Credentials shape (Zod)

```ts
import { z } from "zod";

export const monerooCredentialsSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .min(10)
    .refine(
      (v) => !/^sk_/.test(v) && !/^pk_/.test(v) && !/^whsec_/.test(v),
      "This isn't a Moneroo key — looks like a Stripe key (sk_ / pk_ / whsec_).",
    ),
  webhookSecret: z.string().trim().min(1).optional(),
});

export type MonerooCredentials = z.infer<typeof monerooCredentialsSchema>;
```

`webhookSecret` is the HMAC secret from **Dashboard Moneroo → Developers → Webhooks**. It is OPTIONAL during onboarding (so the merchant can save the connection before they configure their webhook on Moneroo's side), but webhook verification will fail until it's filled in. Block them from going live until set.

## Endpoints used

| Purpose                     | Method | Path                                                                                                               |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Initialize a payment        | POST   | `/v1/payments/initialize`                                                                                          |
| Verify (re-query) a payment | GET    | `/v1/payments/{paymentId}/verify`                                                                                  |
| Probe key validity          | GET    | `/v1/payments/probe_<unix_ts>` (any 401/403 = bad key, anything else = key valid even though endpoint is invented) |

## Initialize payment — request body

```jsonc
{
  "amount": 5000, // integer, smallest unit. For XOF/XAF this is whole francs (not centimes).
  "currency": "XOF", // "XOF" | "XAF" | "USD" | "EUR" | ...
  "description": "Order #1234", // max 200 chars; truncate
  "return_url": "https://your.app/checkout/return?paymentId=<your-uuid>",
  "customer": {
    "email": "buyer@example.com", // REQUIRED — silent 400 if missing
    "first_name": "Aminata", // REQUIRED
    "last_name": "Diallo", // REQUIRED — fallback "-" if name is single-word
    "phone": "+221771234567", // optional E.164
  },
  "metadata": {
    "paymentId": "<your-uuid>", // round-tripped back in webhook payload
    "merchantId": "...", // any string-keyed flat dict; values must be strings
  },
}
```

**Quirks:**

- `metadata` values **must be strings**. Filter out empty/non-string values before sending or you'll get a 422.
- Name splitting: `customerName.split(/\s+/)` — if there's only one token, `last_name = "-"`. If `customerName` is empty, fallback to email local-part for `first_name` and `"-"` for `last_name`.
- `return_url` is the **only** redirect URL. There is no separate `cancel_url`. After the hosted flow, Moneroo redirects with `?paymentId=...&paymentStatus=...` query params. If you need a "back" / cancel button, your hosted page should render it client-side and navigate to a URL on your own domain.
- `description` over 200 chars → API returns 422 `description.length` validation error. Slice it.
- No `payment_method` selection — Moneroo's hosted page chooses based on currency.

## Initialize payment — response shape

Success (`200 OK`):

```jsonc
{
  "data": {
    "id": "py_01H...", // store as providerTransactionId
    "checkout_url": "https://checkout.moneroo.io/p/...",
    "amount": 5000,
    "currency": "XOF",
    "status": "pending",
  },
  "message": "Payment initialized",
}
```

You **must** verify both `data.id` AND `data.checkout_url` are present before treating it as success. If either is missing, treat as a failure even on `200 OK`.

Error (`4xx/5xx`):

```jsonc
{ "message": "Customer email is required" }
```

or:

```jsonc
{
  "message": "The given data was invalid.",
  "errors": { "customer.first_name": ["..."] },
}
```

## Verify (re-query) — request

```
GET https://api.moneroo.io/v1/payments/<paymentId>/verify
Authorization: Bearer <secretKey>
Accept: application/json
```

## Verify (re-query) — response

```jsonc
{
  "data": {
    "id": "py_01H...",
    "amount": 5000,
    "currency": { "code": "XOF" },     // sometimes string "XOF", sometimes object — handle both
    "status": "success",                // "pending" | "success" | "failed" | "cancelled"
    "customer": { ... },
    "metadata": { ... }
  }
}
```

Use this for defense-in-depth: when a webhook claims `payment.success`, re-query and only grant the entitlement if the live API confirms `status === "success"`. If the live status disagrees with the webhook, override the webhook (`status = "failed"`, `failureReason = "Re-query mismatch: ${liveStatus}"`).

## Webhook payload shape

Per the Moneroo doc, every webhook is:

```jsonc
{
  "event": "payment.success" | "payment.failed" | "payment.cancelled" | "payment.initiated",
  "data": {
    "id": "py_01H...",
    "amount": 5000,
    "currency": "XOF",
    "status": "succeeded",                   // free-text per provider
    "metadata": { "paymentId": "<your-uuid>" },
    "customer": { ... }
  }
}
```

## Webhook signature verification

Header: `X-Moneroo-Signature`

Algorithm: hex-encoded HMAC-SHA256 of the **raw body** with the merchant's `webhookSecret`.

```ts
import crypto from "node:crypto";

function verifyMoneroo(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(signatureHeader.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

**Critical:** the HMAC must be computed over the **raw bytes** of the request, NOT a re-stringified `req.body`. JSON parsing changes whitespace and field ordering — your HMAC will never match if you don't capture the raw buffer first. See `references/webhooks.md` for the Express middleware that captures raw body.

## Status mapping

| Moneroo event       | Moneroo `data.status`   | Internal status                                                 |
| ------------------- | ----------------------- | --------------------------------------------------------------- |
| `payment.success`   | `success` / `succeeded` | `completed`                                                     |
| `payment.failed`    | `failed`                | `failed`                                                        |
| `payment.cancelled` | `cancelled`             | `failed`                                                        |
| `payment.initiated` | `pending`               | `pending` (ignore the webhook — wait for `success` or `failed`) |

The `payment.initiated` event is informational. Don't act on it — your row is already `pending` from checkout.

## Idempotency / event dedup

Moneroo does not provide a stable `event_id`. Compute a synthetic one:

```ts
const eventId = `synthetic-${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
```

Store in a `processed_events (provider, eventId, processedAt)` table with 24h TTL. Refuse to re-process. If the same payload arrives twice byte-for-byte, treat as no-op (return `{ received: true, deduped: true }`).

## Error handling

- **Timeout**: wrap `fetch` in `AbortController` with ~15s timeout. Moneroo can be slow during peak (Friday evenings in CIV).
- **Network errors**: retry the initialize call max 1 time. Don't retry verify/status — let the next webhook arrive instead.
- **422 `metadata.foo` invalid**: Moneroo refuses non-string metadata values. Stringify everything.
- **422 `customer.first_name`**: split the name correctly. Provide fallback `"-"`.

## Probe key validity (without making a real charge)

```ts
async function probeKey(
  secretKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.moneroo.io/v1/payments/izi_verify_probe_${Date.now()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403)
    return { ok: false, error: "Invalid Moneroo API key" };
  // 404 (probe id doesn't exist) is the normal "key OK" response
  return { ok: true };
}
```

The probe ID is intentionally garbage — the only thing we're testing is whether the auth header is accepted. 401/403 = bad key. 404 = good key (the endpoint accepted you but the resource doesn't exist).

## Dashboard URLs (for merchant-facing UI)

- API keys: `https://app.moneroo.io/developers/api-keys`
- Webhooks: `https://app.moneroo.io/developers/webhooks` — paste your `https://your.api/webhooks/byok/<connectionId>` here.
- Test mode toggle: top-right of dashboard.

## Sandbox testing

In sandbox, Moneroo provides test cards:

- `4242 4242 4242 4242` (success)
- `4000 0000 0000 0002` (decline)

Mobile money sandbox: enter any phone, hosted page simulates the OTP flow (typically code `123456`).
