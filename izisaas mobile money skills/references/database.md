# Database Schema

You need three tables to power the integration:

1. **`payment_connections`** — one row per merchant per provider (BYOK credentials)
2. **`payments`** — one row per checkout attempt (pending → completed/failed)
3. **`processed_events`** — webhook dedup table (24h TTL)

Plus optional but recommended:

4. **`webhook_logs`** — append-only history of every webhook for audit / replay

## payment_connections

Stores encrypted credentials for each merchant × provider pair.

### Drizzle (TypeScript)

```ts
import {
  pgTable,
  pgEnum,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const paymentProviderEnum = pgEnum("payment_provider", [
  "stripe",
  "bictorys",
  "moneroo",
  "paytech",
]);

type EncryptedPayload = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
};

type ProviderConfig = {
  webhookEnabled?: boolean;
  enabledModes?: ("mobile_money" | "card")[];
  testMode?: boolean;
  [key: string]: unknown;
};

export const paymentConnections = pgTable(
  "payment_connections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    merchantId: text("merchant_id").notNull(),
    provider: paymentProviderEnum("provider").notNull(),
    displayName: text("display_name").notNull(),
    credentialsEncrypted: jsonb("credentials_encrypted")
      .$type<EncryptedPayload>()
      .notNull(),
    config: jsonb("config").$type<ProviderConfig>(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastVerificationError: text("last_verification_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    merchantIdx: index("payment_connections_merchant_idx").on(table.merchantId),
  }),
);
```

### Plain SQL

```sql
CREATE TYPE payment_provider AS ENUM ('stripe', 'bictorys', 'moneroo', 'paytech');

CREATE TABLE payment_connections (
  id                       TEXT PRIMARY KEY,
  merchant_id              TEXT NOT NULL,
  provider                 payment_provider NOT NULL,
  display_name             TEXT NOT NULL,
  credentials_encrypted    JSONB NOT NULL,
  config                   JSONB,
  is_enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at         TIMESTAMPTZ,
  last_verification_error  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payment_connections_merchant_idx ON payment_connections(merchant_id);
```

## payments

The pending → completed state machine. One row per checkout attempt.

### Drizzle (TypeScript)

```ts
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const payments = pgTable(
  "payments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    payerId: text("payer_id").notNull(),
    provider: text("provider").notNull(), // 'moneroo' | 'bictorys' | 'paytech' | 'stripe'
    paymentMode: text("payment_mode"), // 'mobile_money' | 'card' (Bictorys)
    amountTotal: integer("amount_total").notNull(), // in smallest unit (XOF/XAF = whole)
    amountNet: integer("amount_net").notNull(), // after platform commission
    platformFee: integer("platform_fee").default(0).notNull(),
    gatewayFee: integer("gateway_fee").default(0).notNull(),
    currency: text("currency").default("XOF").notNull(), // 'XOF' | 'XAF'
    status: text("status").default("pending").notNull(), // see enum below
    paymentType: text("payment_type").notNull(), // your domain: 'order' | 'subscription' | 'service' | etc.
    referenceId: text("reference_id"), // FK to your domain entity
    referenceType: text("reference_type"),
    providerTransactionId: text("provider_transaction_id"), // returned by provider
    checkoutUrl: text("checkout_url"), // hosted page URL we redirected to
    refundId: text("refund_id"),
    refundStatus: text("refund_status"),
    webhookReceivedAt: timestamp("webhook_received_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    customerEmail: text("customer_email"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    metadata: jsonb("metadata"), // { paymentConnectionId, originalReturnUrl, ... }
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    providerTxIdx: index("payments_provider_tx_idx").on(
      table.providerTransactionId,
    ),
    referenceIdx: index("payments_reference_idx").on(
      table.referenceId,
      table.referenceType,
    ),
    payerIdx: index("payments_payer_idx").on(table.payerId),
    statusIdx: index("payments_status_idx").on(table.status),
  }),
);
```

### Status enum

```
pending → processing → completed
                     → failed
                     → refunded
                     → expired
```

- `pending` — row inserted at checkout, before redirect.
- `processing` — (optional) intermediate state while waiting on MoMo OTP.
- `completed` — webhook confirmed payment + entitlement granted.
- `failed` — webhook reported failure / cancellation / re-query mismatch.
- `refunded` — manual refund logged.
- `expired` — auto-set by a daily cron for pending rows older than ~30 minutes (no webhook ever arrived).

### Plain SQL

```sql
CREATE TABLE payments (
  id                      TEXT PRIMARY KEY,
  payer_id                TEXT NOT NULL,
  provider                TEXT NOT NULL,
  payment_mode            TEXT,
  amount_total            INTEGER NOT NULL,
  amount_net              INTEGER NOT NULL,
  platform_fee            INTEGER NOT NULL DEFAULT 0,
  gateway_fee             INTEGER NOT NULL DEFAULT 0,
  currency                TEXT NOT NULL DEFAULT 'XOF',
  status                  TEXT NOT NULL DEFAULT 'pending',
  payment_type            TEXT NOT NULL,
  reference_id            TEXT,
  reference_type          TEXT,
  provider_transaction_id TEXT,
  checkout_url            TEXT,
  refund_id               TEXT,
  refund_status           TEXT,
  webhook_received_at     TIMESTAMPTZ,
  failure_reason          TEXT,
  customer_email          TEXT,
  customer_name           TEXT,
  customer_phone          TEXT,
  metadata                JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payments_provider_tx_idx ON payments(provider_transaction_id);
CREATE INDEX payments_reference_idx ON payments(reference_id, reference_type);
CREATE INDEX payments_payer_idx ON payments(payer_id);
CREATE INDEX payments_status_idx ON payments(status);
```

## processed_events

Webhook dedup. 24h TTL is sufficient — providers stop retrying after that.

### Drizzle

```ts
export const processedEvents = pgTable(
  "processed_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.eventId] }),
    processedAtIdx: index("processed_events_processed_at_idx").on(
      table.processedAt,
    ),
  }),
);
```

### Plain SQL

```sql
CREATE TABLE processed_events (
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX processed_events_processed_at_idx ON processed_events(processed_at);
```

### TTL cleanup (daily cron)

```sql
DELETE FROM processed_events WHERE processed_at < NOW() - INTERVAL '24 hours';
```

## webhook_logs (optional)

Append-only history. Helpful for support / debugging / replay. Keep ~30 days.

```sql
CREATE TABLE webhook_logs (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  connection_id   TEXT NOT NULL,
  event_id        TEXT,
  raw_body        TEXT NOT NULL,
  headers         JSONB NOT NULL,
  signature_ok    BOOLEAN NOT NULL,
  signature_error TEXT,
  parsed_status   TEXT,
  payment_id      TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_logs_received_at_idx ON webhook_logs(received_at);
CREATE INDEX webhook_logs_payment_id_idx  ON webhook_logs(payment_id);
```

**Privacy**: `raw_body` contains customer email/phone — treat as PII. Add a daily job to redact rows older than 30 days, or drop the column entirely in prod and only log enough to diagnose.

## Migration order

1. Create `payment_provider` enum.
2. Create `payment_connections`.
3. Create `payments`.
4. Create `processed_events`.
5. (Optional) Create `webhook_logs`.
6. Wire FK to your `users` / `merchants` tables as needed.

## Indexes — why each one

- `payments(provider_transaction_id)` — webhook handler lookup.
- `payments(reference_id, reference_type)` — "which payment funded this domain entity" queries (e.g. order, subscription).
- `payments(payer_id)` — user dashboard "my payments" tab.
- `payments(status)` — admin views, expired-payment cron.
- `processed_events.PK(provider, event_id)` — primary lookup is by both columns.
- `payment_connections(merchant_id)` — fetch all connections for a merchant.

## What you DON'T need

- A separate `mobile_money_payments` and `card_payments` table — one `payments` table with a `payment_mode` discriminator is simpler.
- A separate `failed_payments` table — `status='failed'` is enough.
- Soft-delete columns on `payments` — payments are immutable history; refunds get a new row, not an UPDATE.
