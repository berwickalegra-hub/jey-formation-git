// Opt-in factory for mocking next/headers cookies in tests.
// Per RESEARCH.md Pattern 20 note: a global setup mock can mask bugs where a
// route forgets to call cookies(); prefer per-test opt-in.
//
// Usage (at module level of a test file):
//   import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
//   mockNextCookies();
//
// Tests can then assert what was set via __cookieStore.get('app-token').
import { vi } from 'vitest';

export interface MockCookieEntry {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

const store = new Map<string, MockCookieEntry>();

/** Exported for test assertions: read what the route set. */
export const __cookieStore: {
  get(name: string): MockCookieEntry | undefined;
  has(name: string): boolean;
  size(): number;
  clear(): void;
  entries(): IterableIterator<[string, MockCookieEntry]>;
} = {
  get(name: string) {
    return store.get(name);
  },
  has(name: string) {
    return store.has(name);
  },
  size() {
    return store.size;
  },
  clear() {
    store.clear();
  },
  entries() {
    return store.entries();
  },
};

/** The shape returned by next/headers cookies() — Map-backed. */
const mockStore = {
  get(name: string): { name: string; value: string } | undefined {
    const entry = store.get(name);
    return entry ? { name: entry.name, value: entry.value } : undefined;
  },
  set(name: string, value: string, options?: Record<string, unknown>): void {
    store.set(name, { name, value, ...(options ? { options } : {}) });
  },
  delete(name: string): void {
    store.delete(name);
  },
  has(name: string): boolean {
    return store.has(name);
  },
  getAll(): Array<{ name: string; value: string }> {
    return [...store.values()].map((e) => ({ name: e.name, value: e.value }));
  },
};

/**
 * Install a vi.mock for `next/headers` that returns a Map-backed cookie store.
 * Must be called at the top of a test file (not inside beforeEach) so the
 * vi.mock auto-hoists.
 */
export function mockNextCookies(): void {
  vi.mock('next/headers', () => ({
    cookies: () => Promise.resolve(mockStore),
  }));
}
