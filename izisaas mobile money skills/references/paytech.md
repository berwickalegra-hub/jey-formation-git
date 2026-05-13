# PayTech Reference

Sources:
- Official docs: https://docs.intech.sn/doc_paytech.php
- Dashboard: https://paytech.sn

PayTech is a Senegalese payment aggregator. It is the dominant provider in **SN, CI, ML, BJ** for Wave/Orange Money/Free Money. It is NOT available for **Burkina Faso** mobile money — fall back to Moneroo for BF.

The integration in this skill drives a hosted-checkout flow with IPN (Instant Payment Notification) callbacks. The PayTech "Direct API" (in-app) is out of scope here — for V1 always use the hosted page; it's much more reliable and handles operator branding for you.

## Endpoints

| Purpose          | Method | URL                                                  |
| ---------------- | ------ | ---------------------------------------------------- |
| Initiate payment | POST   | `https://paytech.sn/api/payment/request-payment`     |
| Check status     | GET    | `https://paytech.sn/api/payment/get-status?token_payment=<token>` |
| Refund           | POST   | `https://paytech.sn/api/payment/refund` (manual via dashboard recommended for V1) |

There is **one URL for both sandbox and prod**. The mode is selected per-request via the `env` field in the body (`"test"` or `"prod"`). This is unusual — Moneroo and Bictorys use different keys/URLs per environment, PayTech does not.

## Authentication

```http
POST /api/payment/request-payment HTTP/1.1
Host: paytech.sn
Accept: application/json
Content-Type: application/json
API_KEY: <your_api_key>
API_SECRET: <your_api_secret>
```

Two custom headers, **both required, both uppercase with underscore** (`API_KEY`, `API_SECRET`). There is no `Authorization: Bearer` flow. Many HTTP clients normalize header case; this is fine — Node `fetch` and `node:http` send them verbatim.

## Initiate payment — request

```jsonc
{
  "item_name": "Order #1234",                    // shown at top of hosted page
  "item_price": 5000,                            // integer in XOF
  "currency": "XOF",                             // PayTech XOF only
  "ref_command": "<your_payment_uuid>",          // your DB row UUID
  "command_name": "Payment for order 1234",      // sub-label on hosted page
  "env": "test",                                 // "test" | "prod"
  "ipn_url": "https://yourapp.com/api/webhooks/paytech",
  "success_url": "https://yourapp.com/paid?ref=<uuid>",
  "cancel_url": "https://yourapp.com/cancelled?ref=<uuid>",
  "custom_field": "{\"order_id\":\"abc\",\"customer_id\":\"123\"}",
  "target_payment": "Wave"                       // optional, see below
}
```

### Field notes

- `item_price` — integer XOF only. Pass cents and PayTech will quietly round; pass a decimal string and it will 400.
- `currency` — only `"XOF"` is accepted today.
- `ref_command` — **your** identifier. Pass your DB row's UUID. It comes back verbatim in the IPN as `ref_command`. Two valid patterns exist:
  - **Pass-the-UUID (preferred)**: caller generates the UUID at insert time and passes it to the adapter. The IPN ownership check works directly off `ref_command`. This is what the skill's adapter does.
  - **Server-generated**: the PayTech client builds something like `${appPrefix}_${Date.now()}_${rand}`, returns it to the caller, and the caller stores both that and the `token` against the row. Works fine for single-tenant apps; less convenient for BYOK / multi-merchant.
- `env` — controls which sandbox / prod backend handles the call. Sandbox keys are issued separately by PayTech; ask their support if your dashboard doesn't show both.
- `ipn_url` — must be publicly reachable. A common defensive pattern is to rewrite `http://` → `https://` before submission and use ngrok / Cloudflare Tunnel in dev. Whether PayTech rejects HTTP / localhost outright at submission time varies by account; test before relying on it. Always use HTTPS in prod regardless.
- `success_url` / `cancel_url` — after the buyer completes the flow on the hosted page, PayTech redirects them here. The IPN is independent — don't grant entitlement on `success_url`, that path is spoofable. Wait for the IPN.
- `custom_field` — must be a JSON string. PayTech sometimes echoes it back base64-encoded in the IPN; the parser handles both. Keep it under 2 KB.
- `target_payment` — restrict the hosted page to one or more operators. Comma-separated values: `"Wave,Orange Money"`. Omit to show all available operators for the buyer's country.

#### `target_payment` values

The four values below are confirmed by the PayTech client adapter we ship with this skill. PayTech may accept additional operator names — consult the PayTech dashboard / docs before adding others.

| Operator     | String              | Notes                            |
| ------------ | ------------------- | -------------------------------- |
| Orange Money | `"Orange Money"`    | All PayTech-covered countries    |
| Wave         | `"Wave"`            | Where Wave is operationally live |
| Free Money   | `"Free Money"`      | Senegal                          |
| Card         | `"Carte Bancaire"`  | Worldwide buyer                  |

In practice, **most integrations omit `target_payment` entirely** — the hosted page picks operators automatically based on the buyer's country, which is what you want unless you have a strong UX reason to pre-select one (e.g. a Wave-only landing page).

## Initiate payment — response

```jsonc
// Success (success === 1)
{
  "success": 1,
  "token": "T_64c5b4...",          // store this — it's your providerTransactionId
  "redirect_url": "https://paytech.sn/payment/checkout/T_64c5b4..."
}

// Failure (success === 0 or absent)
{
  "success": 0,
  "message": "Invalid item_price"
}
```

`success` is a **number** (`1` / `0`), not a boolean. Equality check accordingly.

The `redirect_url` is the hosted-page URL — redirect the buyer there, or render it inside an `<iframe>` if you want.

`token` is what PayTech echoes back in the IPN. Store it on your `payments` row immediately.

## Check status (re-query)

```http
GET /api/payment/get-status?token_payment=T_64c5b4... HTTP/1.1
API_KEY: ...
API_SECRET: ...
```

Returns the current state of the payment. Useful for:
- Defense-in-depth in the webhook (verify the IPN with a server-to-server call before granting).
- Reconciliation cron jobs that scan stuck `pending` rows older than ~30 minutes.

The exact response shape is not 100% stable across PayTech versions (some envelopes are flat, some are nested under `data`). The adapter normalizes it — see `examples/paytech.ts:verifyPayment`.

## IPN (webhook)

PayTech POSTs to `ipn_url` after every state change.

### Content type

PayTech sends the IPN as **`application/x-www-form-urlencoded` by default**. Some accounts have JSON enabled. Your handler MUST support both:

```ts
const contentType = request.headers.get("content-type") || "";
let body: PaytechIPNPayload;
if (contentType.includes("application/x-www-form-urlencoded")) {
  const formData = await request.formData();
  body = Object.fromEntries(formData.entries()) as any;
} else {
  body = await request.json();
}
```

### Payload shape

```jsonc
{
  "type_event": "sale_complete",       // or "sale_canceled" | "refund_complete"
  "ref_command": "<your_payment_uuid>",
  "item_name": "Order #1234",
  "item_price": "5000",                // STRING when form-encoded, NUMBER when JSON
  "currency": "XOF",
  "command_name": "Payment for order 1234",
  "token": "T_64c5b4...",
  "env": "prod",
  "payment_method": "Wave",            // operator that buyer used
  "client_phone": "221770000000",
  "custom_field": "{\"order_id\":\"abc\",\"customer_id\":\"123\"}",
  "api_key_sha256": "<sha256(apiKey)>",
  "api_secret_sha256": "<sha256(apiSecret)>",
  "hmac_compute": "<HMAC-SHA256(...)>" // present iff HMAC mode is on in dashboard
}
```

`item_price` arrives as **string** when content-type is `x-www-form-urlencoded`, as **number** when JSON. Always coerce: `parseInt(payload.item_price as string, 10)`.

### Signature verification — two methods, both required

PayTech ships **two parallel verification methods**. You must accept either, because the dashboard's HMAC toggle controls whether `hmac_compute` is sent.

#### Method 1 — HMAC-SHA256 (preferred when present)

```
message  = `${item_price}|${ref_command}|${apiKey}`
expected = hex(HMAC_SHA256(message, apiSecret))
verify   = timingSafeEqual(expected, payload.hmac_compute)
```

Note that `apiKey` is part of the **message**, and `apiSecret` is the HMAC key. Easy to swap by accident.

Note also that `item_price` is concatenated as-is — if the IPN arrives form-encoded with `"5000"` (string), use the string form. If it arrives JSON with `5000` (number), use the number coerced to string.

#### Method 2 — SHA256-of-keys (always present, fallback)

```
sha256(apiKey)    === payload.api_key_sha256
sha256(apiSecret) === payload.api_secret_sha256
```

Both equalities must hold. This is **not** a true signature — it's a shared-secret echo. It only proves the sender knows `apiKey` and `apiSecret`. An attacker who somehow learned both could forge an IPN. That's why the HMAC mode exists — once enabled in the dashboard, prefer it.

#### Practical algorithm

```ts
function verify(payload: PaytechIPNPayload, creds: PaytechCredentials) {
  if (payload.hmac_compute) {
    const msg = `${payload.item_price}|${payload.ref_command}|${creds.apiKey}`;
    const exp = hmacSha256Hex(msg, creds.apiSecret);
    if (timingSafeEqual(exp, payload.hmac_compute)) return { ok: true, method: "hmac" };
    // fall through — sometimes both are present
  }
  const k = sha256Hex(creds.apiKey)    === payload.api_key_sha256;
  const s = sha256Hex(creds.apiSecret) === payload.api_secret_sha256;
  return k && s ? { ok: true, method: "sha256-keys" } : { ok: false };
}
```

See `examples/paytech.ts:verifyPaytechIPN` for the full implementation with constant-time comparison.

### Event-type mapping

| `type_event`      | Map to status        | Source row state required |
| ----------------- | -------------------- | ------------------------- |
| `sale_complete`   | `"completed"`        | `pending`                 |
| `sale_canceled`   | `"failed"`           | `pending`                 |
| `refund_complete` | `"refunded"`         | `completed`               |

Use atomic `UPDATE … WHERE status = '<expected>'` to enforce the source-state check. If the update affects 0 rows, you've already processed this event (or the row was in a different state) — respond 200 with `{ deduped: true }`.

### Idempotency

PayTech retries IPNs aggressively until your endpoint returns 200. Same payload may arrive 5+ times. Apply the standard pattern:

1. Hash the raw bytes → `synthetic-${sha256(rawBody).slice(0, 32)}` → store in your dedup table.
2. Atomic update with `WHERE status = 'pending'` clause — only the first update wins.
3. Idempotent fulfillment: re-fetch the order / entitlement record before granting; if already fulfilled, no-op.

### Amount tampering

Compare `item_price` against the row you inserted at checkout. PayTech mobile-money payments may arrive with a slightly lower amount due to operator fees (typically the merchant absorbs ~3%). Allow ±5% tolerance and log anything outside that window.

```ts
const minAccepted = paymentRow.amountTotal * 0.95;
const got = parseInt(payload.item_price as string, 10);
if (got < minAccepted) {
  // Refuse, do NOT grant.
  console.error("[PayTech IPN] amount tampering or fee anomaly", {
    expected: paymentRow.amountTotal,
    got,
  });
  return Response.json({ error: "amount mismatch" }, { status: 400 });
}
```

## Status mapping (re-query response)

The `get-status` endpoint returns a free-form `status` string. The adapter normalizes it:

| Raw `status` substring | Normalized            |
| ---------------------- | --------------------- |
| `complete` / `success` | `completed`           |
| `cancel`               | `cancelled`           |
| `refund`               | `refunded`            |
| `fail`                 | `failed`              |
| anything else          | `pending`             |

Don't trust `status` alone — also check `payment_status` and `data.status`, since the envelope shape varies.

## Refunds

Refunds via API exist (`POST /payment/refund`), but the UX is poor:
- The endpoint is partially documented and sometimes 500s on partial refunds.
- The IPN for `refund_complete` arrives ~1-3 minutes after the dashboard refund button is clicked.

For V1, do refunds manually from the PayTech dashboard, then mark the row `status='refunded'` in your DB once the IPN arrives.

## Common errors

| `success=0` `message`                        | Cause                              | Fix                                                    |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `Invalid item_price`                          | Sent decimal or string             | Send integer XOF only.                                 |
| `Invalid currency`                            | Sent `"XAF"` or `"USD"`            | PayTech is XOF-only.                                   |
| `ipn_url is invalid`                          | HTTP scheme or localhost           | Use HTTPS public URL (ngrok in dev).                   |
| `Authorization failed`                        | Wrong / swapped API_KEY / API_SECRET | Re-paste both, mind the casing.                       |
| `Wrong env`                                   | `env: "prod"` with sandbox keys    | Match `env` to the key set you have.                   |
| `target_payment not available in country`     | Buyer not in supported country     | Drop `target_payment` to let PayTech pick.             |
| 401 / 403 HTML                                | Header dropped by some proxies     | Confirm headers reach paytech.sn unaltered.            |

## Country coverage

PayTech mobile-money is **partial UEMOA — confirmed for SN, CI, ML, BJ** (per the PayTech FAQ at the time of writing). Burkina Faso is not covered. Togo coverage is unverified — check the PayTech dashboard for your account before enabling it.

| Country       | ISO | PayTech mobile money | Card |
| ------------- | --- | -------------------- | ---- |
| Sénégal       | SN  | ✓                    | ✓    |
| Côte d'Ivoire | CI  | ✓                    | ✓    |
| Mali          | ML  | ✓                    | ✓    |
| Bénin         | BJ  | ✓                    | ✓    |
| Burkina Faso  | BF  | —                    | ✓ (via Bictorys card / Moneroo) |
| Togo          | TG  | (not enabled)        | ✓ (via Bictorys card / Moneroo) |

The exact set of operators available per country evolves as PayTech adds providers. **Verify in the PayTech dashboard** before promising a specific operator (e.g. Wave) to a country. The skill's role is to document the integration; the operator-per-country activation list is a product / config decision, not a PayTech API constant.

For **BF and TG mobile money**, route to **Moneroo**. For card, PayTech works worldwide for the buyer (the merchant must be UEMOA-registered).
