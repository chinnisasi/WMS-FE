/**
 * ULID generation for client-side Idempotency-Key headers (AD-5): every
 * mutating request carries a client-generated ULID. Hand-rolled to match the
 * backend's format contract (26-char Crockford base32, 10-char ms timestamp
 * + 16 random chars) — no new dependency.
 */

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford base32 of arbitrary bytes; pads with alphabet[0]. */
function encodeBase32(bytes: Uint8Array, charCount: number): string {
  let out = '';
  let bits = 0;
  let nBits = 0;
  let idx = 0;
  for (let c = 0; c < charCount; c++) {
    while (nBits < 5 && idx < bytes.length) {
      bits = ((bits << 8) | bytes[idx]!) & 0xffffff;
      idx++;
      nBits += 8;
    }
    out += nBits >= 5 ? ULID_ALPHABET.charAt((bits >> (nBits - 5)) & 31) : ULID_ALPHABET[0]!;
    nBits -= 5;
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  let ms = now;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ULID_ALPHABET.charAt(ms % 32) + timePart;
    ms = Math.floor(ms / 32);
  }
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  return timePart + encodeBase32(random, 16);
}