import { describe, expect, test } from 'bun:test';

import { ulid } from './ulid';

describe('ulid (client idempotency keys)', () => {
  test('matches the backend key format (26-char Crockford base32)', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('encodes the millisecond timestamp monotonically', () => {
    const earlier = ulid(1_000_000_000_000);
    const later = ulid(1_000_000_000_001);
    expect(later > earlier).toBe(true);
  });

  test('does not repeat within a burst', () => {
    const keys = new Set(Array.from({ length: 100 }, () => ulid()));
    expect(keys.size).toBe(100);
  });
});