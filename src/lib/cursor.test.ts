import { describe, expect, test } from 'bun:test';

import { buildPage, decodeCursor, encodeCursor } from './cursor';

describe('cursor pagination helper', () => {
  test('round-trips an opaque cursor', () => {
    const encoded = encodeCursor({ createdAt: '2026-09-08T00:00:00Z', id: '0198-1' });
    expect(encoded).not.toContain('=');
    expect(decodeCursor(encoded)).toEqual({ createdAt: '2026-09-08T00:00:00Z', id: '0198-1' });
  });

  test('is UTF-8-safe (btoa/atob are latin-1 only)', () => {
    // Non-ASCII ids must survive the base64url round-trip byte-exact.
    const payload = { createdAt: '2026-09-08T00:00:00Z', id: 'id-ñ-✓' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  test('rejects malformed cursors', () => {
    expect(() => decodeCursor(encodeCursor({ createdAt: 'x', id: 'y' } as never))).not.toThrow();
    expect(() => decodeCursor(Buffer.from('{"foo":1}').toString('base64url'))).toThrow();
  });

  test('buildPage detects the next page from a limit+1 fetch', () => {
    const rows = [
      { id: 'a', createdAt: '2026-09-08T00:00:00Z' },
      { id: 'b', createdAt: '2026-09-08T00:00:01Z' },
      { id: 'c', createdAt: '2026-09-08T00:00:02Z' },
    ];
    const page = buildPage(rows, 2);
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor!).id).toBe('b');
    expect(buildPage(rows.slice(2), 2).nextCursor).toBeNull();
    expect(() => buildPage(rows, 0)).toThrow();
    expect(() => buildPage(rows, 1.5)).toThrow();
  });
});