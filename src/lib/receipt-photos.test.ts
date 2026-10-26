import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  HEIC_MESSAGE,
  MAX_PHOTO_BYTES,
  MAX_SOURCE_BYTES,
  PHOTO_SOURCE_TOO_LARGE,
  noRoomSentence,
  photoRoom,
  skippedPhotosSentence,
  PHOTO_TOO_LARGE,
  PHOTO_TYPE_UNSUPPORTED,
  PHOTO_UNREADABLE,
  addPhotoBlocker,
  addPhotoReason,
  createUrlRefresher,
  fitLongEdge,
  jpegFileName,
  linePhotosLabel,
  parseRemoveReason,
  photoRemovedLine,
  prepareImageForUpload,
  removePhotoReason,
  removeVerb,
  sniffImage,
  type PrepareDeps,
} from './receipt-photos';

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const WEBP_HEAD = [...ascii('RIFF'), 0x10, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 ')];
const HEIC_HEAD = [0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')];
const HEIC_COMPAT_HEAD = [0, 0, 0, 0x1c, ...ascii('ftypisom'), 0, 0, 0, 0, ...ascii('isomheix')];
const GIF_HEAD = ascii('GIF89a\u0001\u0000\u0001\u0000');

function fileOf(head: number[], name = 'crate.jpg', size = 2048): File {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return new File([bytes], name, { type: 'application/octet-stream' });
}

function deps(over: Partial<PrepareDeps> & { sizes?: { width: number; height: number }[] } = {}): PrepareDeps & { calls: { width: number; height: number; quality: number }[] } {
  const calls: { width: number; height: number; quality: number }[] = [];
  return {
    calls,
    decode: over.decode ?? (async () => ({ width: 4032, height: 3024, close: () => undefined })),
    encode:
      over.encode ??
      (async (_image, width, height, quality) => {
        calls.push({ width, height, quality });
        return new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });
      }),
  };
}

describe('sniffImage — the type from the bytes, never the name', () => {
  test('JPEG, PNG, WebP, HEIC (major and compatible brand), and anything else', () => {
    expect(sniffImage(new Uint8Array(JPEG_HEAD))).toBe('jpeg');
    expect(sniffImage(new Uint8Array(PNG_HEAD))).toBe('png');
    expect(sniffImage(new Uint8Array(WEBP_HEAD))).toBe('webp');
    expect(sniffImage(new Uint8Array(HEIC_HEAD))).toBe('heic');
    expect(sniffImage(new Uint8Array(HEIC_COMPAT_HEAD))).toBe('heic');
    expect(sniffImage(new Uint8Array(GIF_HEAD))).toBe('other');
    expect(sniffImage(new Uint8Array([]))).toBe('other');
  });
});

describe('prepareImageForUpload (decision 4, A28)', () => {
  test('a HEIC file — whatever its name — is refused with the A28 words, before any decode', async () => {
    let decoded = false;
    const result = await prepareImageForUpload(fileOf(HEIC_HEAD, 'IMG_0001.jpg'), deps({ decode: async () => ((decoded = true), { width: 1, height: 1 }) }));
    expect(result).toEqual({ ok: false, problem: HEIC_MESSAGE });
    expect(HEIC_MESSAGE).toBe('HEIC photos are not supported — export as JPEG');
    expect(decoded).toBe(false);
  });

  test('a 48 MP phone JPEG over 10 MB raw is re-encoded and sent (the 10 MB cap is on the ENCODED blob)', async () => {
    const result = await prepareImageForUpload(fileOf(JPEG_HEAD, 'phone.jpg', 18 * 1024 * 1024), deps({ decode: async () => ({ width: 8000, height: 6000 }) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.type).toBe('image/jpeg');
  });

  test('over the 40 MB memory ceiling is refused before decoding; an encoded blob over 10 MB is refused', async () => {
    let decoded = false;
    const huge = await prepareImageForUpload(fileOf(JPEG_HEAD, 'huge.jpg', MAX_SOURCE_BYTES + 1), deps({ decode: async () => ((decoded = true), { width: 1, height: 1 }) }));
    expect(huge).toEqual({ ok: false, problem: PHOTO_SOURCE_TOO_LARGE });
    expect(decoded).toBe(false);
    const fat = deps({ encode: async () => new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)]) });
    expect(await prepareImageForUpload(fileOf(JPEG_HEAD), fat)).toEqual({ ok: false, problem: PHOTO_TOO_LARGE });
  });

  test('a browser that cannot encode sends the original only when it is within 10 MB', async () => {
    const noEncode = deps({ encode: async () => null });
    expect(await prepareImageForUpload(fileOf(JPEG_HEAD, 'big.jpg', MAX_PHOTO_BYTES + 1), noEncode)).toEqual({ ok: false, problem: PHOTO_TOO_LARGE });
    expect((await prepareImageForUpload(fileOf(JPEG_HEAD, 'edge.jpg', MAX_PHOTO_BYTES), noEncode)).ok).toBe(true);
  });

  test('a GIF (or any other type) is refused; an undecodable JPEG is refused', async () => {
    expect(await prepareImageForUpload(fileOf(GIF_HEAD, 'a.gif'), deps())).toEqual({ ok: false, problem: PHOTO_TYPE_UNSUPPORTED });
    const broken = deps({ decode: async () => Promise.reject(new Error('bad')) });
    expect(await prepareImageForUpload(fileOf(JPEG_HEAD), broken)).toEqual({ ok: false, problem: PHOTO_UNREADABLE });
  });

  test('re-encodes to JPEG 0.85 with the long edge at 2,560 px, named .jpg', async () => {
    const d = deps();
    const result = await prepareImageForUpload(fileOf(PNG_HEAD, 'dock shot.png'), d);
    expect(d.calls).toEqual([{ width: 2560, height: 1920, quality: 0.85 }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.type).toBe('image/jpeg');
      expect(result.file.name).toBe('dock shot.jpg');
    }
  });

  test('a small photo is never upscaled; a browser that cannot encode sends the original', async () => {
    const d = deps({ decode: async () => ({ width: 800, height: 600 }) });
    await prepareImageForUpload(fileOf(WEBP_HEAD, 'w.webp'), d);
    expect(d.calls[0]).toMatchObject({ width: 800, height: 600 });
    const original = fileOf(JPEG_HEAD);
    const result = await prepareImageForUpload(original, deps({ encode: async () => null }));
    expect(result).toEqual({ ok: true, file: original });
  });
});

describe('the words', () => {
  test('fitLongEdge and jpegFileName', () => {
    expect(fitLongEdge(3024, 4032)).toEqual({ width: 1920, height: 2560 });
    expect(fitLongEdge(100, 50)).toEqual({ width: 100, height: 50 });
    expect(jpegFileName('IMG.HEIC')).toBe('IMG.jpg');
    expect(jpegFileName('.png')).toBe('photo.jpg');
  });

  test('a line\'s photo label: attached, pending, both, none', () => {
    expect(linePhotosLabel(2, 0)).toBe('2 photos');
    expect(linePhotosLabel(1, 0)).toBe('1 photo');
    expect(linePhotosLabel(0, 2)).toBe('2 on its way');
    expect(linePhotosLabel(3, 1)).toBe('3 photos · 1 on its way');
    expect(linePhotosLabel(0, 0)).toBeNull();
  });

  test('the room names the cap that bound it: the line\'s 10 or the receipt\'s 50', () => {
    expect(photoRoom(7, 20)).toEqual({ room: 3, limitedBy: 'line' });
    expect(photoRoom(2, 48)).toEqual({ room: 2, limitedBy: 'receipt' });
    expect(photoRoom(10, 10)).toEqual({ room: 0, limitedBy: 'line' });
    expect(photoRoom(0, 50)).toEqual({ room: 0, limitedBy: 'receipt' });
    expect(skippedPhotosSentence(4, 'line')).toBe('4 more did not fit — a line carries at most 10 photos.');
    expect(skippedPhotosSentence(4, 'receipt')).toBe('4 more did not fit — a receipt carries at most 50 photos.');
    expect(noRoomSentence('line')).toContain('This line already holds 10');
    expect(noRoomSentence('receipt')).toContain('This receipt already holds 50');
  });

  test('the add blocker mirrors the 10-per-line and 50-per-receipt caps', () => {
    expect(addPhotoBlocker(9, 49)).toBeNull();
    expect(addPhotoBlocker(10, 10)).toContain('10 photos');
    expect(addPhotoBlocker(2, 50)).toContain('50 photos');
  });

  test('the remove reason: trimmed, 1–200 characters', () => {
    expect(parseRemoveReason('  wrong line  ')).toEqual({ reason: 'wrong line', problem: null });
    expect(parseRemoveReason('   ').problem).toContain('Say why');
    expect(parseRemoveReason('x'.repeat(201)).problem).toContain('200');
    // Code points, as the server counts: 200 emoji (400 UTF-16 units) pass; 201 do not.
    expect(parseRemoveReason(' ' + '📦'.repeat(200) + ' ')).toEqual({ reason: '📦'.repeat(200), problem: null });
    expect(parseRemoveReason('📦'.repeat(201)).problem).toContain('it has 201');
  });

  test('Remove on an attached photo, Cancel on an awaited one', () => {
    expect(removeVerb('attached').button).toBe('Remove photo');
    expect(removeVerb('awaited').button).toBe('Cancel placeholder');
  });

  test('a removed photo names its remover and time (A20); a cancelled placeholder reads Cancelled', () => {
    const line = photoRemovedLine({ removedAt: '2026-10-13T08:33:00.000Z', removedByName: 'Asha Rao', removedBy: 'u-1', contentType: 'image/jpeg' });
    expect(line).toBe('Removed by Asha Rao · 13 Oct 2026, 14:03 IST');
    expect(photoRemovedLine({ removedAt: undefined, removedByName: undefined, removedBy: '0198f7a2-0000-7000-8000-00000000abcd', contentType: null })).toBe(
      'Cancelled by user …0000abcd',
    );
  });

  test('the refusal mappers branch on code; the transport arm is the house copy', () => {
    const problem = (code: string, status = 409) => new ApiProblem(code, status, 'server words');
    expect(addPhotoReason(problem('attachment-limit-reached'))).toContain('10 photos');
    expect(addPhotoReason(problem('attachment-type-unsupported', 415))).toBe(PHOTO_TYPE_UNSUPPORTED);
    expect(addPhotoReason(problem('file-storage-busy', 503))).toContain('busy');
    expect(addPhotoReason(problem('role-denied', 403))).toBe('Your role cannot add photos.');
    expect(addPhotoReason(problem('something-new'))).toBe('server words');
    expect(addPhotoReason(new TypeError('Failed to fetch'))).toContain('unreachable');
    expect(removePhotoReason(problem('attachment-not-attached'))).toContain('already removed');
    expect(removePhotoReason(problem('role-denied', 403))).toContain('owner or ops manager');
  });
});

describe('createUrlRefresher — the deduped expired-URL refetch (A28)', () => {
  const NOW = Date.parse('2026-10-26T10:00:00.000Z');
  const expired = '2026-10-26T09:59:00.000Z';
  const fresh = '2026-10-26T10:04:00.000Z';

  function harness() {
    let resolve: () => void = () => undefined;
    let calls = 0;
    const refresher = createUrlRefresher(
      () => {
        calls += 1;
        return new Promise<void>((done) => (resolve = done));
      },
      { now: () => NOW },
    );
    return { refresher, calls: () => calls, finish: () => resolve() };
  }

  test('many images failing at once: one refetch; the rest join it', async () => {
    const h = harness();
    expect(h.refresher.onImageError({ id: 'p1', url: 'u1', urlExpiresAt: expired })).toBe('refetching');
    expect(h.refresher.onImageError({ id: 'p2', url: 'u2', urlExpiresAt: expired })).toBe('joined');
    expect(h.refresher.onImageError({ id: 'p3', url: 'u3', urlExpiresAt: expired })).toBe('joined');
    expect(h.calls()).toBe(1);
    expect(h.refresher.refreshing).toBe(true);
    h.finish();
    await h.refresher.settled();
    expect(h.refresher.refreshing).toBe(false);
  });

  test('a URL refetches at most once; an unexpired URL is broken, not stale', async () => {
    const h = harness();
    h.refresher.onImageError({ id: 'p1', url: 'u1', urlExpiresAt: expired });
    h.finish();
    await h.refresher.settled();
    expect(h.refresher.onImageError({ id: 'p1', url: 'u1', urlExpiresAt: expired })).toBe('broken');
    expect(h.refresher.onImageError({ id: 'p2', url: 'u2', urlExpiresAt: fresh })).toBe('broken');
    expect(h.calls()).toBe(1);
  });

  test('one photo refetches at most twice per dialog, whatever its URLs (a skewed clock never loops)', async () => {
    const h = harness();
    for (const url of ['a', 'b']) {
      expect(h.refresher.onImageError({ id: 'p1', url, urlExpiresAt: expired })).toBe('refetching');
      h.finish();
      await h.refresher.settled();
    }
    expect(h.refresher.onImageError({ id: 'p1', url: 'c', urlExpiresAt: expired })).toBe('broken');
    expect(h.calls()).toBe(2);
  });

  test('a manual Retry refetches once, joining one in flight; bind() points at the newest refetch', async () => {
    const h = harness();
    void h.refresher.retry();
    void h.refresher.retry();
    expect(h.calls()).toBe(1);
    h.finish();
    await h.refresher.settled();
    let rebound = 0;
    h.refresher.bind(async () => void (rebound += 1));
    await h.refresher.retry();
    expect(rebound).toBe(1);
  });
});
