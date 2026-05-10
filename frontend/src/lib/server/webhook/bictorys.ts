// frontend/src/lib/server/webhook/bictorys.ts — Phase 5 D-02.
//
// Re-exports the WebhookProvider impl from the payments adapter so the
// webhook namespace is cohesive (handler factory + per-provider impls).
// The real HMAC code lives in payments/bictorys.ts:367-428 and is PROTECTED.
//
// This wrapper adds:
//   1. Lazy-init env reads (Pitfall 6 — supports vi.stubEnv).
//   2. Kind-upgrade for status="refunded"/"refund" — the underlying
//      classifyStatus only emits 'paid'/'failed'/'other', so we patch the
//      ParsedIds.kind to 'refunded' for refund events. This is what
//      createWebhookHandler reads to dispatch onRefunded.
import 'server-only';
import type { WebhookProvider } from './handler';
import { createBictorysProvider, type BictorysWebhookPayload } from '../payments/bictorys';

export type { BictorysWebhookPayload };

let _provider: WebhookProvider<BictorysWebhookPayload> | null = null;

/** Lazy-init — env reads happen at first call so `vi.stubEnv` works in tests. */
export function getBictorysWebhookProvider(): WebhookProvider<BictorysWebhookPayload> {
  if (_provider) return _provider;
  const env = {
    BICTORYS_API_URL: process.env.BICTORYS_API_URL ?? '',
    BICTORYS_API_KEY: process.env.BICTORYS_API_KEY ?? '',
    BICTORYS_WEBHOOK_SECRET: process.env.BICTORYS_WEBHOOK_SECRET ?? '',
  };
  if (!env.BICTORYS_API_URL || !env.BICTORYS_API_KEY || !env.BICTORYS_WEBHOOK_SECRET) {
    throw new Error('Bictorys webhook provider not configured (env missing)');
  }
  _provider = createBictorysProvider(env).webhookProvider;
  return _provider;
}

/** Convenience binding for the route file. */
export const bictorysWebhookProvider: WebhookProvider<BictorysWebhookPayload> = {
  name: 'bictorys',
  verifySignature: (raw, headers) => getBictorysWebhookProvider().verifySignature(raw, headers),
  parsePayload: (raw) => getBictorysWebhookProvider().parsePayload(raw),
  extractIds: (payload) => {
    const ids = getBictorysWebhookProvider().extractIds(payload);
    // Upgrade kind for refunded events (classifyStatus only handles paid/failed).
    const status = String((payload as Record<string, unknown>).status ?? '').toLowerCase();
    if (status === 'refunded' || status === 'refund') {
      return { ...ids, kind: 'refunded' };
    }
    return ids;
  },
};

/** Test-only — clear the cached provider for `vi.stubEnv` reuse. */
export function __resetBictorysWebhookProvider(): void {
  _provider = null;
}
