/**
 * Cursor pagination helper (client side of the AD-9 spine primitive).
 * Cursors are opaque: encode/decode only, never inspected or constructed
 * from domain data. Offset pagination and infinite scroll are banned.
 */
export interface CursorPayload {
  readonly createdAt: string;
  readonly id: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** UTF-8-safe base64 (btoa is latin-1 only; cursor payloads are not). */
function encodeBase64Url(json: string): string {
  const bytes = textEncoder.encode(json);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(cursor: string): string {
  const b64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return textDecoder.decode(bytes);
}

export function encodeCursor(payload: CursorPayload): string {
  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeCursor(cursor: string): CursorPayload {
  const json = decodeBase64Url(cursor);
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as CursorPayload).createdAt !== 'string' ||
    typeof (parsed as CursorPayload).id !== 'string'
  ) {
    throw new Error('Malformed pagination cursor');
  }
  return parsed as CursorPayload;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** Builds a page from a `limit + 1` fetch, mirroring the backend primitive. */
export function buildPage<T extends { createdAt: string; id: string }>(
  rows: readonly T[],
  limit: number,
): Page<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Page limit must be a positive integer, got ${limit}`);
  }
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}
