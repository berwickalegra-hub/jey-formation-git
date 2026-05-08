// frontend/src/test-utils/bictorys-mock.ts — Phase 5 Wave 0.
//
// Fixture builder for /api/webhooks/bictorys route tests. Returns:
//   - rawBody (Buffer) — exact bytes Bictorys would have signed
//   - headers (Record<string,string>) — including a valid HMAC signature
//   - payload (BictorysWebhookPayload) — the parsed shape
//
// Tests can mutate any field to simulate tampered body / expired ts / wrong sig.
//
// HMAC algorithm mirrors `frontend/src/lib/server/payments/bictorys.ts:367-413`
// verbatim (sha256 of `${ts}.` + rawBody). Drift between fixture and verifier
// is impossible by construction — the fixture re-derives from the same
// canonical recipe.
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import type { BictorysWebhookPayload } from '@/lib/server/payments/bictorys';

export interface BictorysFixtureOpts {
  status?: 'succeeded' | 'failed' | 'refunded';
  chargeId?: string;
  paymentMethod?: string;
  webhookSecret?: string;
  /** Override the timestamp — useful for replay-window tests. */
  timestamp?: number;
}

export function bictorysFixture(opts: BictorysFixtureOpts = {}): {
  rawBody: Buffer;
  headers: Record<string, string>;
  payload: BictorysWebhookPayload;
} {
  const status = opts.status ?? 'succeeded';
  const payload: BictorysWebhookPayload = {
    id: opts.chargeId ?? 'charge_test_001',
    charge_id: opts.chargeId ?? 'charge_test_001',
    status,
    event_type: status,
    payment_method: opts.paymentMethod ?? 'wave_money',
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const ts = String(opts.timestamp ?? Date.now());
  const secret = opts.webhookSecret ?? 'test-webhook-secret';
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.`)
    .update(rawBody)
    .digest('hex');
  return {
    rawBody,
    headers: {
      'content-type': 'application/json',
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    },
    payload,
  };
}

/** Build a NextRequest with the fixture body + headers. Use in route tests. */
export function bictorysFixtureRequest(opts: BictorysFixtureOpts = {}): {
  req: NextRequest;
  payload: BictorysWebhookPayload;
} {
  const { rawBody, headers, payload } = bictorysFixture(opts);
  // Buffer is a Uint8Array subclass at runtime but TS' BodyInit type rejects
  // both. Cast to BodyInit — the bytes are byte-identical to what fetch
  // would send and the underlying NextRequest accepts ArrayBufferView.
  const body = rawBody as unknown as BodyInit;
  return {
    req: new NextRequest('http://localhost/api/webhooks/bictorys', {
      method: 'POST',
      headers,
      body,
    }),
    payload,
  };
}
