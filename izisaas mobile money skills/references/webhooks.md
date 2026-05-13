# Webhook Security & Idempotency

A webhook receiver has three jobs:

1. **Verify** the signature so you know the call really came from the provider.
2. **Dedup** so a replayed event doesn't fire your fulfillment twice.
3. **Fulfill** atomically — grant the entitlement exactly once, even under concurrent retries.

This file documents the patterns. The full Express implementation is in [`../examples/webhook-handler.ts`](../examples/webhook-handler.ts).

## Step 0 — capture the raw body

Express's default JSON parser discards the bytes after parsing. HMAC over `JSON.stringify(req.body)` will **never** match because key ordering and whitespace differ from what the provider hashed. You must capture the buffer before parsing:

```ts
import express from "express";

const app = express();

// IMPORTANT: this must be set BEFORE any router that handles webhooks.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf; // Buffer, available as req.rawBody in handlers
    },
  }),
);
```

In Next.js (app router), webhook routes need `runtime: "nodejs"` and you read the raw text:

```ts
// app/api/webhooks/[provider]/[connectionId]/route.ts
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const rawBuffer = Buffer.from(rawBody, "utf8");
  // ... verify with rawBuffer
}
```

In Next.js (pages router) you must disable the body parser:

```ts
export const config = { api: { bodyParser: false } };
```

and read manually with a `getRawBody`-style helper.

## Step 1 — verify the signature

### Stripe

Stripe wraps verification in a single SDK call. **Do not roll your own HMAC** — `constructEvent` does the timing-safe HMAC-SHA256 over the raw bytes, parses the `Stripe-Signature` header (which combines a timestamp `t=` and one or more `v1=` signatures for key rotation), and enforces a 5-minute timestamp tolerance against replay.

```ts
import Stripe from "stripe";

const stripe = new Stripe(secretKey, { apiVersion: "2025-11-17.clover" });

function verifyStripe(rawBody: Buffer | string, req: Request, webhookSecret: string) {
  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) return { ok: false, error: "stripe-signature header missing" };
  try {
    const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    return { ok: true, event };
  } catch (err) {
    // err.message is one of:
    //   "No signatures found matching the expected signature for payload."
    //   "Timestamp outside the tolerance zone (xxx)."
    //   "Webhook payload must be provided as a string or a Buffer..."
    return { ok: false, error: (err as Error).message };
  }
}
```

#### Raw body trick (mandatory for Stripe)

Stripe signs the **bytes**, not the parsed JSON. If your middleware parses JSON before the handler runs and you pass `JSON.stringify(req.body)`, the field ordering and whitespace will differ from what Stripe hashed and the signature will never match.

Express:

```ts
// Either: capture rawBody for ALL routes (works for Stripe AND the African providers)
app.use(
  express.json({
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
  }),
);

// Or: dedicated raw-body parser on the Stripe route specifically
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),  // req.body is now a Buffer
  handler,
);
```

Next.js App Router:

```ts
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();   // ← .text(), NOT .json()
  const sig = req.headers.get("stripe-signature")!;
  const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  // … handle event
  return Response.json({ received: true });
}
```

Next.js Pages Router (legacy):

```ts
export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rawBody = await getRawBody(req);  // helper from "raw-body"
  const sig = req.headers["stripe-signature"] as string;
  const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  // …
}
```

#### Why `constructEvent` and not custom HMAC

The `Stripe-Signature` header combines:
- A timestamp (`t=`) used for the replay-window check.
- One or more `v1=` signatures (multiple are present during a key rotation window so old and new secrets both verify).
- Future schemes Stripe may roll out (`v2=`, `v3=`).

Reimplementing this correctly is more work than it looks, and a near-zero-value differentiator. Use `constructEvent`.

### Moneroo

```ts
function verifyMoneroo(rawBody: Buffer, req: Request, secret: string) {
  const sig = req.headers["x-moneroo-signature"] as string | undefined;
  if (!sig) return { ok: false, error: "x-moneroo-signature header missing" };

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(sig.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length)
    return { ok: false, error: "Moneroo signature length mismatch" };
  if (!crypto.timingSafeEqual(a, b))
    return { ok: false, error: "Moneroo signature invalid" };
  return { ok: true };
}
```

### Bictorys (HMAC mode + static fallback)

```ts
function verifyBictorys(rawBody: Buffer, req: Request, secret: string) {
  const sig = req.headers["x-webhook-signature"] as string | undefined;
  const ts = req.headers["x-webhook-timestamp"] as string | undefined;

  // ── Mode 1: HMAC (preferred) ──
  if (sig && ts) {
    let tsNum = parseInt(ts, 10);
    // Auto-detect ms vs sec: < 10 billion = seconds → multiply
    if (tsNum > 0 && tsNum < 10_000_000_000) tsNum *= 1000;
    if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > 5 * 60_000) {
      return { ok: false, error: "Bictorys timestamp out of ±5min tolerance" };
    }
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${ts}.${rawBody.toString("utf-8")}`)
      .digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: "Bictorys HMAC signature invalid" };
    }
    return { ok: true };
  }

  // ── Mode 2: Static X-Secret-Key (fallback) ──
  const staticKey = req.headers["x-secret-key"] as string | undefined;
  if (!staticKey) {
    return {
      ok: false,
      error: "No signature header (X-Webhook-Signature or X-Secret-Key)",
    };
  }
  const a = Buffer.from(staticKey);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "Bictorys X-Secret-Key invalid" };
  }
  return { ok: true };
}
```

### PayTech (HMAC mode + SHA256-of-keys fallback) — signature is IN BODY, not headers

PayTech does NOT send signature headers. Both verification methods read named fields from the parsed body. This means PayTech IPN verification doesn't need the raw bytes for the signature itself — but you still want them for the dedup hash.

PayTech also ships the IPN as `application/x-www-form-urlencoded` by default. Your handler must branch on `Content-Type` before parsing.

```ts
function verifyPaytech(
  rawBody: Buffer,
  req: Request,
  apiKey: string,
  apiSecret: string,
) {
  // Parse body according to Content-Type
  const ct = (req.headers["content-type"] as string | undefined) || "";
  let body: any;
  if (ct.includes("application/x-www-form-urlencoded")) {
    body = Object.fromEntries(new URLSearchParams(rawBody.toString("utf-8")));
  } else {
    try {
      body = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return { ok: false, error: "PayTech: cannot parse body" };
    }
  }

  // ── Method 1: HMAC mode (preferred, present iff dashboard toggle is on) ──
  if (body.hmac_compute) {
    // Note: item_price arrives as STRING when form-encoded, NUMBER when JSON.
    // The HMAC message uses whichever form the IPN itself carries.
    const message = `${body.item_price}|${body.ref_command}|${apiKey}`;
    const expected = crypto
      .createHmac("sha256", apiSecret)
      .update(message)
      .digest("hex");
    const a = Buffer.from(body.hmac_compute);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { ok: true, body, method: "hmac" };
    }
    // Fall through to SHA256-of-keys — sometimes both modes are active.
  }

  // ── Method 2: SHA256-of-keys (default mode, always present) ──
  const expectedKeyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex");
  const expectedSecretHash = crypto
    .createHash("sha256")
    .update(apiSecret)
    .digest("hex");
  const aK = Buffer.from(body.api_key_sha256 ?? "");
  const bK = Buffer.from(expectedKeyHash);
  const aS = Buffer.from(body.api_secret_sha256 ?? "");
  const bS = Buffer.from(expectedSecretHash);
  const keyOk = aK.length === bK.length && crypto.timingSafeEqual(aK, bK);
  const secretOk = aS.length === bS.length && crypto.timingSafeEqual(aS, bS);
  if (keyOk && secretOk) return { ok: true, body, method: "sha256-keys" };

  return { ok: false, error: "PayTech IPN signature invalid" };
}
```

Why two methods: PayTech's default verification is a shared-secret echo (`sha256(apiKey)` + `sha256(apiSecret)` in the body) which proves the sender knows your keys but doesn't sign the message. The HMAC mode is opt-in per dashboard setting and signs the message properly. Older accounts only have the SHA256-of-keys mode — your verifier MUST accept either.

Caveat: the SHA256-of-keys mode is vulnerable to webhook spoofing if either key ever leaks (unlike a true HMAC, where leaking the verification key alone doesn't let you forge messages). Treat the leak risk as you would for the API key itself; rotate immediately if compromised.

### Why `crypto.timingSafeEqual`

Naive `===` comparison leaks information about how many bytes match through timing differences. `crypto.timingSafeEqual` always takes the same time regardless of where the difference is. The two buffers MUST be the same length first — that's why we early-return on length mismatch (with `crypto.timingSafeEqual` itself throwing if lengths differ).

## Step 2 — dedup events

Providers retry webhooks. Moneroo retries up to 5 times with exponential backoff. Bictorys retries until you respond 200 OK. The same byte-for-byte payload may arrive 2-10 times. Without dedup, your fulfillment fires multiple times.

```ts
import crypto from "node:crypto";

function computeEventId(rawBody: Buffer): string {
  return `synthetic-${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
}

// Storage table:
//   processed_events (
//     provider     text not null,
//     event_id     text not null,
//     processed_at timestamptz not null default now(),
//     primary key (provider, event_id)
//   )
//   (Add a TTL job: delete where processed_at < now() - interval '24 hours')

async function alreadyProcessedEvent(
  provider: string,
  eventId: string,
): Promise<boolean> {
  const row = await db.query.processedEvents.findFirst({
    where: and(
      eq(processedEvents.provider, provider),
      eq(processedEvents.eventId, eventId),
    ),
  });
  return Boolean(row);
}

async function markEventProcessed(
  provider: string,
  eventId: string,
): Promise<void> {
  await db
    .insert(processedEvents)
    .values({ provider, eventId })
    .onConflictDoNothing(); // safe race
}
```

### Alternative: Redis-backed dedup (recommended for high-throughput / serverless)

If you already run Redis (Upstash, ElastiCache, self-hosted), prefer it over the Postgres table — atomic `SET NX` with TTL is faster, has no cleanup cron, and works under any concurrency level. This pattern works well with Upstash Redis (or any Redis with `SET NX EX` support):

```ts
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

async function alreadyProcessedEvent(
  connectionId: string,
  provider: string,
  eventId: string,
): Promise<boolean> {
  const key = `webhook:dedup:${provider}:${connectionId}:${eventId}`;
  // SET key value NX EX 86400 → only sets if not exists, with 24h TTL.
  // Returns "OK" on success, null if key already existed.
  const result = await redis.set(key, "1", { nx: true, ex: 24 * 60 * 60 });
  return result === null;
}
```

Single round-trip, no separate "mark processed" call needed. The atomic `NX` check IS the dedup — if it returns `null`, you've already processed this event. No race conditions possible.

Trade-off: adds a Redis dependency. If your stack doesn't have Redis, the Postgres `processed_events` table works fine.

````

Inside the handler:

```ts
const eventId = computeEventId(rawBody);
if (await alreadyProcessedEvent(connection.provider, eventId)) {
  return res.json({ received: true, deduped: true });
}
// ... do fulfillment ...
await markEventProcessed(connection.provider, eventId);
res.json({ received: true });
````

**Race condition**: two webhook deliveries arriving simultaneously could both pass the `alreadyProcessed` check before either inserts. The `onConflictDoNothing` saves you on the insert, but the fulfillment itself must also be idempotent — see Step 4.

## Step 3 — re-query (defense-in-depth)

If the merchant's `webhookSecret` ever leaks (e.g. they paste it into a Slack channel by accident), an attacker could forge a valid signature and trick you into granting an entitlement.

Re-query the provider's API with the merchant's **secret API key** (which never leaves your server) before granting:

```ts
if (connection.provider === "moneroo" && event.status === "completed") {
  const live = await monerooVerifyPayment(
    event.providerTransactionId,
    credentials.secretKey,
  );
  if (live && live.status !== "success") {
    event.status = "failed";
    event.failureReason = `Re-query mismatch: live=${live.status}`;
  }
}
```

**Skip re-query for Bictorys** — their WAF blocks the re-query call from server IPs (we covered the curl workaround for the initial charge, but the WAF gets stricter on follow-up calls). Trust the signed webhook for Bictorys.

## Step 4 — atomic, idempotent fulfillment

Layer 1 — status transition guarded by SQL:

```ts
const updated = await db
  .update(payments)
  .set({ status: "completed", webhookReceivedAt: new Date() })
  .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
  .returning({ id: payments.id });

if (updated.length === 0) {
  // Either already completed, or row doesn't exist — no-op.
  return res.json({ received: true, alreadyProcessed: true });
}
```

Layer 2 — entitlement guard. Replace `entitlements` / `customerId` / `referenceId` with whatever your domain uses (orders, subscriptions, course enrollments, license keys, …):

```ts
const existing = await db.query.entitlements.findFirst({
  where: and(
    eq(entitlements.customerId, payment.payerId),
    eq(entitlements.referenceId, payment.referenceId),
  ),
});
if (existing && existing.expiresAt > new Date()) {
  return res.json({ received: true, alreadyEntitled: true });
}
// Otherwise: insert / extend the entitlement for your domain entity.
```

## Step 5 — amount tampering check

The webhook payload includes `data.amount` and `data.currency` (or equivalents). Compare to the row inserted at checkout time:

```ts
if (
  event.reportedAmount !== payment.amountTotal ||
  event.reportedCurrency !== payment.currency
) {
  // Refuse — log a security alert.
  console.error("[WEBHOOK] amount tampering detected", {
    paymentId,
    expected: payment.amountTotal,
    got: event.reportedAmount,
  });
  return res.status(400).json({ error: "Amount mismatch" });
}
```

## Step 6 — ownership check (BYOK / multi-merchant)

If you have multiple merchants each with their own webhook URLs, an attacker who learns merchant A's webhook URL but compromises merchant B's secret cannot use B's secret to validate A's payment. The receiver path includes the `connectionId`:

```
POST /webhooks/byok/<connectionId>
```

So the secret used to verify the HMAC is the one bound to that connection. Additionally, when you find the `payments` row by `providerTransactionId`, verify:

```ts
if (payment.metadata.paymentConnectionId !== connection.id) {
  return res.status(403).json({ error: "Connection mismatch" });
}
```

This prevents merchant A from validating merchant B's payments via their own connection.

## Putting it all together — the receiver shape

```ts
router.post("/webhooks/byok/:connectionId", async (req, res) => {
  // 1. Find the connection
  const conn = await db.query.paymentConnections.findFirst({
    where: eq(paymentConnections.id, req.params.connectionId),
  });
  if (!conn) return res.status(404).json({ error: "Unknown connection" });

  // 2. Capture raw body (already done by middleware)
  const rawBody = (req as any).rawBody as Buffer;
  if (!rawBody) return res.status(400).json({ error: "Raw body required" });

  // 3. Decrypt credentials
  const credentials = decryptCredentials(conn.credentialsEncrypted);

  // 4. Verify signature
  const verified = verifyWebhookSignature(
    conn.provider,
    req,
    rawBody,
    credentials,
  );
  if (!verified.ok) return res.status(401).json({ error: verified.error });

  // 5. Parse + normalize event
  const event = parseEvent(conn.provider, req.body);
  if (!event) return res.json({ received: true, ignored: true });

  // 6. Dedup
  const eventId = computeEventId(rawBody);
  if (await alreadyProcessedEvent(conn.provider, eventId)) {
    return res.json({ received: true, deduped: true });
  }

  // 7. Re-query (Moneroo only)
  if (conn.provider === "moneroo" && event.status === "completed") {
    const live = await monerooVerifyPayment(
      event.providerTransactionId,
      credentials.secretKey,
    );
    if (live && live.status !== "success") event.status = "failed";
  }

  // 8. Find payments row, ownership + amount checks, atomic update
  // 9. Grant entitlement
  // 10. Mark event processed, respond 200
  await markEventProcessed(conn.provider, eventId);
  res.json({ received: true });
});
```

## Performance / response time

Providers expect a 200 within a few seconds. If your fulfillment takes longer (sending emails, calling external APIs, granting credits in 5 systems), **respond 200 first, then enqueue the work** to a background job (Inngest, BullMQ, etc.). The dedup table protects you — the worker can check it before re-firing.

```ts
res.json({ received: true });
await jobQueue.enqueue("fulfill-payment", { paymentId, eventId });
```

## Logging

In production, log:

- Webhook received (provider, connectionId, eventId, status)
- Signature verification result (ok / error)
- Dedup hit (provider, eventId, original-processed-at)
- Amount tampering detected (paymentId, expected, got)
- Re-query mismatch (paymentId, webhook-status, live-status)

Do **NOT** log raw bodies in production — they contain PII (customer email, phone). In dev, fine.

## Common pitfalls

| Pitfall                                  | Symptom                                               | Fix                                     |
| ---------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| HMAC over `JSON.stringify(req.body)`     | Signature always invalid                              | Capture raw `Buffer`                    |
| Compared with `===`                      | Timing attack vector                                  | `crypto.timingSafeEqual`                |
| No length check before `timingSafeEqual` | Throws "Input buffers must have the same byte length" | Early-return on length mismatch         |
| Forgot to dedup                          | Member granted twice                                  | Hash raw body, store 24h                |
| No idempotent UPDATE                     | Concurrent retries fulfill twice                      | `WHERE status='pending'` clause         |
| Skipped amount check                     | Tampering risk                                        | Compare event.amount to row.amountTotal |
| Re-queried Bictorys from server          | 403 from WAF                                          | Skip re-query for Bictorys              |
| Block fulfillment in handler             | Webhook timeout, retries                              | 200 fast, enqueue work                  |
| Logged full body in prod                 | PII leak                                              | Log only safe fields                    |
| Webhook URL contains `localhost`         | Bictorys WAF rejects body                             | Use ngrok / dev-redirect                |

## Test checklist before going live

- [ ] Replay a captured webhook: receiver responds `{ deduped: true }` second time.
- [ ] Tamper amount in a captured webhook, re-sign with secret: receiver responds 400.
- [ ] Send valid signature but garbage body: receiver responds `{ ignored: true }`.
- [ ] Wrong signature: 401.
- [ ] Concurrent identical deliveries (use `xargs -P`): only one fulfillment runs.
- [ ] HMAC mode + static-key mode both verify in Bictorys.
- [ ] Moneroo re-query overrides webhook on mismatch (test by manually editing webhook status to "success" but expecting live API to say "pending").
