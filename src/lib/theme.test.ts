import { afterEach, describe, expect, test } from 'bun:test';

import { THEME_STORAGE_KEY, readStoredTheme, writeStoredTheme } from './theme';

/**
 * Pins the theme-persistence contract between the pre-paint init script
 * (layout.tsx) and ThemeToggle: same key, 'dark'/'light' vocabulary,
 * round-trips cleanly, tolerates a corrupted/blocked storage.
 */
const store = new Map<string, string>();
// @ts-expect-error — test stub for the storage the lib targets
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
};

describe('theme persistence', () => {
  afterEach(() => {
    store.clear();
  });

  test('round-trips an explicit choice under the shared key', () => {
    writeStoredTheme('dark');
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
    writeStoredTheme('light');
    expect(readStoredTheme()).toBe('light');
  });

  test('rejects corrupted values and tolerates a blocked storage', () => {
    store.set(THEME_STORAGE_KEY, 'Dark');
    expect(readStoredTheme()).toBeNull();
    // @ts-expect-error — simulate storage throwing (blocked site data)
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredTheme()).toBeNull();
    expect(() => writeStoredTheme('dark')).not.toThrow();
    // restore the stub for other suites
    // @ts-expect-error — test stub for the storage the lib targets
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
});