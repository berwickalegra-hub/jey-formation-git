// Tests for D-07 cursor encode/decode (notifications pagination).
//
// Round-trip is the contract: Wave 1 GET /api/notifications uses encodeCursor
// to mint the `nextCursor` field in the response, and decodeCursor to parse
// the `?cursor=` query param on the next request. A round-trip miss would
// silently cause clients to skip or re-show pages.
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, type Cursor } from './cursor';

describe('encodeCursor', () => {
  it('returns a base64 string', () => {
    const out = encodeCursor({ createdAt: new Date('2026-05-08T12:00:00.000Z'), id: 'cuidabc' });
    expect(typeof out).toBe('string');
    // base64 alphabet: A-Z, a-z, 0-9, + / =
    expect(/^[A-Za-z0-9+/]+=*$/.test(out)).toBe(true);
  });
});

describe('decodeCursor (round-trip and malformed handling)', () => {
  it('round-trip: encodeCursor → decodeCursor preserves createdAt and id', () => {
    const orig: Cursor = { createdAt: new Date('2026-05-08T12:00:00.000Z'), id: 'cuidabc' };
    const encoded = encodeCursor(orig);
    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe('cuidabc');
    expect(decoded!.createdAt.getTime()).toBe(orig.createdAt.getTime());
  });

  it('returns null for malformed base64', () => {
    expect(decodeCursor('not-base64-!!!')).toBeNull();
  });

  it('returns null when JSON is missing createdAt', () => {
    const cursor = Buffer.from('{"id":"x"}', 'utf8').toString('base64');
    expect(decodeCursor(cursor)).toBeNull();
  });

  it('returns null when createdAt is not a valid date', () => {
    const cursor = Buffer.from('{"createdAt":"not-a-date","id":"x"}', 'utf8').toString('base64');
    expect(decodeCursor(cursor)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(decodeCursor(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('returns null for empty string input', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('preserves millisecond ordering — encoding two Dates 1ms apart produces different cursors', () => {
    const a = encodeCursor({ createdAt: new Date('2026-05-08T12:00:00.000Z'), id: 'x' });
    const b = encodeCursor({ createdAt: new Date('2026-05-08T12:00:00.001Z'), id: 'x' });
    expect(a).not.toBe(b);
  });

  it('returns null when JSON parses to a non-object (string)', () => {
    const cursor = Buffer.from('"just-a-string"', 'utf8').toString('base64');
    expect(decodeCursor(cursor)).toBeNull();
  });

  it('returns null when JSON parses to null', () => {
    const cursor = Buffer.from('null', 'utf8').toString('base64');
    expect(decodeCursor(cursor)).toBeNull();
  });

  it('returns null when id is empty string', () => {
    const cursor = Buffer.from('{"createdAt":"2026-05-08T00:00:00.000Z","id":""}', 'utf8').toString(
      'base64',
    );
    expect(decodeCursor(cursor)).toBeNull();
  });
});
