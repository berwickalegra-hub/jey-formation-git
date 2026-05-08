import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  bictorysWebhookProvider,
  getBictorysWebhookProvider,
  __resetBictorysWebhookProvider,
} from './bictorys';

const SECRET = 'test-webhook-secret';

beforeEach(() => {
  vi.stubEnv('BICTORYS_API_URL', 'https://api.bictorys.test');
  vi.stubEnv('BICTORYS_API_KEY', 'test-api-key');
  vi.stubEnv('BICTORYS_WEBHOOK_SECRET', SECRET);
  __resetBictorysWebhookProvider();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetBictorysWebhookProvider();
});

describe('bictorysWebhookProvider (WH-01)', () => {
  it('verifies a valid HMAC + timestamp', () => {
    const ts = String(Date.now());
    const body = Buffer.from(JSON.stringify({ id: 'c1', status: 'succeeded' }));
    const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
    const r = bictorysWebhookProvider.verifySignature(body, {
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    });
    expect(r.valid).toBe(true);
  });

  it('rejects tampered body', () => {
    const ts = String(Date.now());
    const body = Buffer.from(JSON.stringify({ id: 'c1', status: 'succeeded' }));
    const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
    const tampered = Buffer.from(JSON.stringify({ id: 'c1', status: 'failed' }));
    const r = bictorysWebhookProvider.verifySignature(tampered, {
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects expired replay (drift > 60s default)', () => {
    const ts = String(Date.now() - 70_000); // 70s old
    const body = Buffer.from('{}');
    const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
    const r = bictorysWebhookProvider.verifySignature(body, {
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/replay/i);
  });

  it('throws when env unset (lazy init)', () => {
    vi.stubEnv('BICTORYS_API_KEY', '');
    __resetBictorysWebhookProvider();
    expect(() => getBictorysWebhookProvider()).toThrow(/not configured/i);
  });

  it('extractIds upgrades kind to refunded for status="refunded"', () => {
    const payload = {
      id: 'c1',
      charge_id: 'c1',
      status: 'refunded',
      event_type: 'charge.refunded',
    };
    const ids = bictorysWebhookProvider.extractIds(payload as never);
    expect(ids.kind).toBe('refunded');
    expect(ids.externalId).toBe('c1');
  });

  it('extractIds upgrades kind to refunded for status="refund"', () => {
    const payload = { id: 'c2', status: 'refund' };
    const ids = bictorysWebhookProvider.extractIds(payload as never);
    expect(ids.kind).toBe('refunded');
  });

  it('extractIds keeps kind=paid for status="succeeded"', () => {
    const payload = { id: 'c3', charge_id: 'c3', status: 'succeeded' };
    const ids = bictorysWebhookProvider.extractIds(payload as never);
    expect(ids.kind).toBe('paid');
  });
});
