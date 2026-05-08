// Tests for D-10 notification prefs deep-merge.
//
// Critical invariants under test:
//  - Additive at the event-type level (new events merge in)
//  - Partial at the channel level (override `email` keeps `inApp`)
//  - Opt-out defaults — missing event ⇒ ENABLED (NEVER opt-in)
//  - Input is never mutated
import { describe, it, expect } from 'vitest';
import { mergePrefs, isChannelEnabled, type NotificationPrefs } from './prefs-merge';

describe('mergePrefs', () => {
  it('additive: empty existing + patch with new event yields the patch', () => {
    expect(mergePrefs({}, { ORDER_PAID: { email: false, inApp: true } })).toEqual({
      ORDER_PAID: { email: false, inApp: true },
    });
  });

  it('partial channel override preserves untouched channel', () => {
    const out = mergePrefs(
      { ORDER_PAID: { email: true, inApp: true } },
      { ORDER_PAID: { email: false } },
    );
    expect(out).toEqual({ ORDER_PAID: { email: false, inApp: true } });
  });

  it('multi-event: only the patched event/channel flips', () => {
    const out = mergePrefs(
      {
        ORDER_PAID: { email: true, inApp: true },
        WELCOME: { email: false, inApp: true },
      },
      { WELCOME: { inApp: false } },
    );
    expect(out).toEqual({
      ORDER_PAID: { email: true, inApp: true },
      WELCOME: { email: false, inApp: false },
    });
  });

  it('empty patch is a no-op (returns equivalent shape)', () => {
    const existing = { ORDER_PAID: { email: true, inApp: true } };
    expect(mergePrefs(existing, {})).toEqual(existing);
  });

  it('input arguments are NOT mutated (defaults-enabled / no-mutation)', () => {
    const existing: NotificationPrefs = { ORDER_PAID: { email: true, inApp: true } };
    const patch: NotificationPrefs = { ORDER_PAID: { email: false } };
    const existingSnap = JSON.stringify(existing);
    const patchSnap = JSON.stringify(patch);
    mergePrefs(existing, patch);
    expect(JSON.stringify(existing)).toBe(existingSnap);
    expect(JSON.stringify(patch)).toBe(patchSnap);
  });

  it('null/undefined existing prefs are treated as {}', () => {
    expect(mergePrefs(null, { X: { email: true, inApp: true } })).toEqual({
      X: { email: true, inApp: true },
    });
    expect(mergePrefs(undefined, { Y: { email: true, inApp: true } })).toEqual({
      Y: { email: true, inApp: true },
    });
  });
});

describe('isChannelEnabled (opt-out semantics, default-enabled)', () => {
  it('missing event ⇒ enabled (BRAND_NEW_EVENT default-enabled, opt-out)', () => {
    expect(isChannelEnabled({}, 'BRAND_NEW_EVENT', 'email')).toBe(true);
    expect(isChannelEnabled({}, 'BRAND_NEW_EVENT', 'inApp')).toBe(true);
  });

  it('explicit false disables channel', () => {
    expect(
      isChannelEnabled({ ORDER_PAID: { email: false, inApp: true } }, 'ORDER_PAID', 'email'),
    ).toBe(false);
  });

  it('explicit true enables channel', () => {
    expect(
      isChannelEnabled({ ORDER_PAID: { email: false, inApp: true } }, 'ORDER_PAID', 'inApp'),
    ).toBe(true);
  });

  it('channel missing within known event ⇒ default enabled', () => {
    expect(isChannelEnabled({ ORDER_PAID: { email: false } }, 'ORDER_PAID', 'inApp')).toBe(true);
  });

  it('null/undefined prefs ⇒ default enabled', () => {
    expect(isChannelEnabled(null, 'ANY_EVENT', 'email')).toBe(true);
    expect(isChannelEnabled(undefined, 'ANY_EVENT', 'inApp')).toBe(true);
  });
});
