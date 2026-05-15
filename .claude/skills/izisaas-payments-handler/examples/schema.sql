-- Bictorys + Moneroo + PayTech BYOK schema (PostgreSQL).
-- Run with: psql $DATABASE_URL < schema.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Provider enum
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE payment_provider AS ENUM ('stripe', 'bictorys', 'moneroo', 'paytech');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. payment_connections — one row per (merchant, provider)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE payment_connections (
  id                       TEXT PRIMARY KEY,
  merchant_id              TEXT NOT NULL,
  provider                 payment_provider NOT NULL,
  display_name             TEXT NOT NULL,
  -- credentials_encrypted is the JSON blob produced by encryptCredentials():
  --   { ciphertext, nonce, authTag, algorithm: 'aes-256-gcm', keyVersion }
  credentials_encrypted    JSONB NOT NULL,
  -- config holds non-secret operator settings: enabled modes, merchant country, etc.
  config                   JSONB,
  is_enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at         TIMESTAMPTZ,
  last_verification_error  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payment_connections_merchant_idx ON payment_connections (merchant_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. payments — one row per checkout attempt (pending → completed/failed)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE payments (
  id                      TEXT PRIMARY KEY,
  payer_id                TEXT NOT NULL,
  provider                TEXT NOT NULL,                         -- 'moneroo' | 'bictorys' | 'paytech' | 'stripe'
  payment_mode            TEXT,                                  -- 'mobile_money' | 'card' (Bictorys only)
  amount_total            INTEGER NOT NULL,                      -- smallest unit; XOF/XAF = whole francs
  amount_net              INTEGER NOT NULL,
  platform_fee            INTEGER NOT NULL DEFAULT 0,
  gateway_fee             INTEGER NOT NULL DEFAULT 0,
  currency                TEXT NOT NULL DEFAULT 'XOF',           -- 'XOF' | 'XAF'
  status                  TEXT NOT NULL DEFAULT 'pending',       -- pending | processing | completed | failed | refunded | expired
  payment_type            TEXT NOT NULL,                         -- domain: 'order' | 'subscription' | 'service' | etc.
  reference_id            TEXT,                                  -- FK to your domain entity
  reference_type          TEXT,
  provider_transaction_id TEXT,                                  -- returned by provider (Moneroo data.id, Bictorys transactionId)
  checkout_url            TEXT,
  refund_id               TEXT,
  refund_status           TEXT,
  webhook_received_at     TIMESTAMPTZ,
  failure_reason          TEXT,
  customer_email          TEXT,
  customer_name           TEXT,
  customer_phone          TEXT,
  metadata                JSONB,                                 -- { paymentConnectionId, ... }
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payments_provider_tx_idx ON payments (provider_transaction_id);
CREATE INDEX payments_reference_idx   ON payments (reference_id, reference_type);
CREATE INDEX payments_payer_idx       ON payments (payer_id);
CREATE INDEX payments_status_idx      ON payments (status);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. processed_events — webhook dedup (24h TTL)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE processed_events (
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX processed_events_processed_at_idx ON processed_events (processed_at);

-- Daily cleanup (run as cron):
--   DELETE FROM processed_events WHERE processed_at < NOW() - INTERVAL '24 hours';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. (optional) webhook_logs — audit trail
-- ─────────────────────────────────────────────────────────────────────────

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

CREATE INDEX webhook_logs_received_at_idx ON webhook_logs (received_at);
CREATE INDEX webhook_logs_payment_id_idx  ON webhook_logs (payment_id);

-- Daily cleanup (run as cron):
--   DELETE FROM webhook_logs WHERE received_at < NOW() - INTERVAL '30 days';
