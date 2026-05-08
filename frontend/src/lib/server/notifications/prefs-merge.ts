// Phase 2 Plan 02-00 — D-10 notification preferences deep-merge.
//
// Wave 1 PATCH /api/notifications/prefs (Plan 02-02) layers a client-supplied
// patch on top of the row's existing prefs JSON. The merge is two-level:
// event-type at the outer key, channel (`email` | `inApp`) at the inner key.
// Both levels are SHALLOW-merged (assign), so a partial patch like
// `{ ORDER_PAID: { email: false } }` updates only `email` and preserves
// `inApp`.
//
// CRITICAL: missing event-type ⇒ ENABLED (opt-out, D-10). The data model
// stores ONLY user overrides — every other event is implicitly enabled. New
// notification types never need a backfill migration; users opt out per
// type. This contract is the inverse of typical "prefs default to off"
// systems and must NOT be flipped without a phase-level decision.
//
// Pitfall 9 (RESEARCH.md) — last-write-wins on the prefs row: the route
// layer wraps mergePrefs in an upsert with `{ updatedAt }` to surface concurrent
// edits, but the merge itself doesn't try to reconcile those. Two near-simul
// PATCHes both hit the row; the second wins. Acceptable for prefs UX.
import 'server-only';

export type ChannelPrefs = { email?: boolean; inApp?: boolean };
export type NotificationPrefs = Record<string, ChannelPrefs>;

/**
 * Deep-merge two prefs objects.
 *
 * Semantics (D-10):
 *  - Additive at the event-type level: new keys are kept.
 *  - Partial at the channel level: an override that only sets `email` keeps
 *    the existing `inApp` untouched.
 *  - Existing prefs are never mutated (returns a fresh object each call).
 *  - null/undefined `existing` is treated as `{}` so callers don't have to
 *    pre-flight when the row is freshly created with `prefs Json @default("{}")`.
 */
export function mergePrefs(
  existing: NotificationPrefs | null | undefined,
  patch: NotificationPrefs,
): NotificationPrefs {
  const out: NotificationPrefs = {};
  if (existing) {
    for (const [k, v] of Object.entries(existing)) {
      out[k] = { ...v };
    }
  }
  for (const [event, channels] of Object.entries(patch)) {
    out[event] = { ...(out[event] ?? {}), ...channels };
  }
  return out;
}

/**
 * Resolve whether a channel is enabled for a given event type.
 *
 * D-10 default-enabled / opt-out:
 *  - Missing event ⇒ enabled (the prefs row only stores user overrides).
 *  - Missing channel within a known event ⇒ enabled.
 *  - Explicit `false` ⇒ disabled.
 *  - Explicit `true` ⇒ enabled (redundant with default but explicit-friendly).
 */
export function isChannelEnabled(
  prefs: NotificationPrefs | null | undefined,
  eventType: string,
  channel: 'email' | 'inApp',
): boolean {
  const event = prefs?.[eventType];
  if (!event) return true;
  const v = event[channel];
  if (v === undefined) return true;
  return v !== false;
}
