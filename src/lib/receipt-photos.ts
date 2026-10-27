/**
 * Story 2-5a — damage photos on a goods-receipt line: the words, the limits
 * the web mirrors, the refusal mappers, the browser-side re-encode
 * (`prepareImageForUpload`, decision 4) and the deduped expired-URL refetch
 * (A28).
 *
 * Pure apart from `prepareImageForUpload`'s default decoder/encoder (the
 * browser's `createImageBitmap` and a canvas), which a test replaces. No
 * React, no hook — the portal imports it too (`lib/portal-boundary.test.ts`).
 */
import { ApiProblem } from '@/lib/api/client';
import type { PortalReceiptPhotoDto, ReceiptPhotoViewDto } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

// ── limits (mirrored from the backend; the server is the authority) ──────────

/** The backend's upload cap (multer `fileSize: 10_485_760`, 422 `attachment-too-large`). */
export const MAX_PHOTO_BYTES = 10_485_760;
/**
 * The ORIGINAL file's pre-decode memory ceiling (code review): a 48 MP phone
 * JPEG is over 10 MB raw and well under it after the re-encode, so the
 * 10 MB cap applies to what is SENT, never to what is picked.
 */
export const MAX_SOURCE_BYTES = 41_943_040;
/** The web re-encode's long edge (decision 4). */
export const WEB_MAX_LONG_EDGE = 2560;
/** The web re-encode's JPEG quality (decision 4). */
export const WEB_JPEG_QUALITY = 0.85;
/** Live photos (attached + awaited) one line may carry (decision 8; 409 `attachment-limit-reached`). */
export const MAX_PHOTOS_PER_LINE = 10;
/** Live photos one receipt may carry (A5). */
export const MAX_PHOTOS_PER_RECEIPT = 50;
/** The remove reason's `@Length(1, 200)`. */
export const MAX_REMOVE_REASON_LENGTH = 200;
/** What the file picker offers — the three types the server stores. */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

// ── words ────────────────────────────────────────────────────────────────────

export type ReceiptPhotoStatus = ReceiptPhotoViewDto['status'];

/** A photo's status in words — a `Record` over the generated union, so a new status fails the compile. */
export const PHOTO_STATUS_LABEL: Readonly<Record<ReceiptPhotoStatus, string>> = {
  attached: 'Attached',
  awaited: 'On its way',
  expired: 'Never arrived',
  removed: 'Removed',
};

/** The one-line explanation under a placeholder tile. */
export const PHOTO_STATUS_HINT: Readonly<Record<Exclude<ReceiptPhotoStatus, 'attached'>, string>> = {
  awaited: 'Taken on the handheld — it uploads when the device syncs.',
  expired: 'The handheld never uploaded this photo.',
  removed: 'Removed from the receipt.',
};

/** A23 — the portal's removed placeholder (A4: no image, no reason, no remover). */
export const PORTAL_REMOVED_PHOTO = 'Removed by the warehouse';

/** A28 — a file that sniffs as HEIC/HEIF. */
export const HEIC_MESSAGE = 'HEIC photos are not supported — export as JPEG';
export const PHOTO_TOO_LARGE = 'This photo is larger than 10 MB — pick a smaller one.';
export const PHOTO_SOURCE_TOO_LARGE = 'This photo is larger than 40 MB — pick a smaller one.';
export const PHOTO_TYPE_UNSUPPORTED = 'Only JPEG, PNG or WebP photos can be added.';
export const PHOTO_UNREADABLE = 'This photo could not be read — it may be damaged. Try another.';
export const STORAGE_OFF_WORD = 'Photo storage is off';
export const STORAGE_OFF_REASON = 'This server has no file storage configured, so photos cannot be shown or added.';

/** `1 photo`, `3 photos`. */
export function photoCountLabel(count: number): string {
  return count === 1 ? '1 photo' : `${count} photos`;
}

/**
 * A line's photo button: `2 photos`, `2 photos · 1 on its way`, `1 on its
 * way`; null when the line has none (the caller then offers Add, or nothing).
 */
export function linePhotosLabel(attached: number, pending: number): string | null {
  if (attached <= 0 && pending <= 0) return null;
  if (pending <= 0) return photoCountLabel(attached);
  if (attached <= 0) return `${pending} on its way`;
  return `${photoCountLabel(attached)} · ${pending} on its way`;
}

/** `Captured 13 Oct 2026, 14:03 IST on the handheld` / `Added 13 Oct 2026, 14:03 IST on the web`. */
export function photoProvenance(photo: Pick<ReceiptPhotoViewDto, 'source' | 'capturedAt' | 'uploadedAt' | 'createdAt'>): string {
  if (photo.source === 'handheld') {
    const at = photo.capturedAt ?? photo.uploadedAt ?? photo.createdAt;
    return `Captured ${istDateTimeLabel(at)} IST on the handheld`;
  }
  return `Added ${istDateTimeLabel(photo.uploadedAt ?? photo.createdAt)} IST on the web`;
}

/** `1.2 MB · 2560 × 1920`, the parts that are known; '' when none. */
export function photoDimensions(photo: Pick<ReceiptPhotoViewDto, 'byteSize' | 'width' | 'height'>): string {
  const parts: string[] = [];
  if (photo.byteSize !== null) parts.push(byteSizeLabel(photo.byteSize));
  if (photo.width !== null && photo.height !== null) parts.push(`${photo.width} × ${photo.height}`);
  return parts.join(' · ');
}

export function byteSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A20 — what staff read on a removed photo (status + remover + reason, never
 * a URL): `Removed by Asha Rao · 13 Oct 2026, 14:03 IST`. A cancelled
 * placeholder (removed with no bytes) reads "Cancelled".
 */
export function photoRemovedLine(photo: Pick<ReceiptPhotoViewDto, 'removedAt' | 'removedByName' | 'removedBy' | 'contentType'>): string {
  const verb = photo.contentType === null ? 'Cancelled' : 'Removed';
  const who = photo.removedByName ?? (photo.removedBy === undefined ? null : `user …${photo.removedBy.slice(-8)}`);
  const parts = [who === null ? verb : `${verb} by ${who}`];
  if (photo.removedAt !== undefined) parts.push(`${istDateTimeLabel(photo.removedAt)} IST`);
  return parts.join(' · ');
}

/** Whether a photo counts toward the live caps (attached + awaited). */
export function isLivePhoto(photo: Pick<ReceiptPhotoViewDto, 'status'>): boolean {
  return photo.status === 'attached' || photo.status === 'awaited';
}

/**
 * Why Add is not offered on a line that the server would refuse with 409
 * `attachment-limit-reached` — null when there is room. The count is of the
 * list on screen; the server's count is the ruling.
 */
/**
 * How many more photos fit on a line, and which cap bound it (code review):
 * the line's 10, or the receipt's 50 — the words follow the cap that bit.
 */
export function photoRoom(lineLive: number, receiptLive: number): { room: number; limitedBy: 'line' | 'receipt' } {
  const lineRoom = MAX_PHOTOS_PER_LINE - lineLive;
  const receiptRoom = MAX_PHOTOS_PER_RECEIPT - receiptLive;
  return receiptRoom < lineRoom ? { room: Math.max(0, receiptRoom), limitedBy: 'receipt' } : { room: Math.max(0, lineRoom), limitedBy: 'line' };
}

/** Why `skipped` picked files were not added, naming the cap that bound them. */
export function skippedPhotosSentence(skipped: number, limitedBy: 'line' | 'receipt'): string {
  const cap = limitedBy === 'line' ? `a line carries at most ${MAX_PHOTOS_PER_LINE} photos` : `a receipt carries at most ${MAX_PHOTOS_PER_RECEIPT} photos`;
  return `${skipped} more did not fit — ${cap}.`;
}

/** The refusal when nothing fit. */
export function noRoomSentence(limitedBy: 'line' | 'receipt'): string {
  return limitedBy === 'line'
    ? `This line already holds ${MAX_PHOTOS_PER_LINE} photos — remove one to add another.`
    : `This receipt already holds ${MAX_PHOTOS_PER_RECEIPT} photos — remove one to add another.`;
}

export function addPhotoBlocker(lineLive: number, receiptLive: number): string | null {
  if (lineLive >= MAX_PHOTOS_PER_LINE) return `This line holds ${MAX_PHOTOS_PER_LINE} photos — the most one line can carry. Remove one to add another.`;
  if (receiptLive >= MAX_PHOTOS_PER_RECEIPT) return `This receipt holds ${MAX_PHOTOS_PER_RECEIPT} photos — the most one receipt can carry.`;
  return null;
}

// ── the remove reason ────────────────────────────────────────────────────────

/** A reason's length the server's way: code points of the trimmed text. */
export function reasonLength(text: string): number {
  return [...text.trim()].length;
}

/** The trimmed reason, or the problem (1–200 characters). */
export function parseRemoveReason(text: string): { reason: string; problem: null } | { reason: null; problem: string } {
  const reason = text.trim();
  if (reason === '') return { reason: null, problem: 'Say why — the reason stays on the record.' };
  // Code points, as the server counts (`[...reason.trim()].length`) — never UTF-16 units.
  const length = reasonLength(reason);
  if (length > MAX_REMOVE_REASON_LENGTH) {
    return { reason: null, problem: `Keep the reason to ${MAX_REMOVE_REASON_LENGTH} characters (it has ${length}).` };
  }
  return { reason, problem: null };
}

/** The confirmation's words: an attached photo is Removed, an awaited placeholder Cancelled. */
export function removeVerb(status: ReceiptPhotoStatus): { button: string; busy: string; done: string; prompt: string } {
  return status === 'awaited'
    ? { button: 'Cancel placeholder', busy: 'Cancelling…', done: 'Placeholder cancelled', prompt: 'Why cancel this placeholder? The photo will not be attached if it arrives later.' }
    : { button: 'Remove photo', busy: 'Removing…', done: 'Photo removed', prompt: 'Why remove this photo? The record and its reason stay; the image is deleted after 30 days.' };
}

// ── refusal mappers (branch on `code`, never on prose — guide §3) ────────────

/** Codes shared by both writes. */
function commonPhotoReason(error: ApiProblem): string | null {
  switch (error.code) {
    case 'file-storage-unavailable':
      return 'Photo storage is not set up on this server — photos cannot be added.';
    case 'file-storage-failed':
      return 'Photo storage did not answer — try again.';
    case 'file-storage-busy':
      return 'Photo storage is busy — try again in a moment.';
    case 'idempotency-key-reuse':
      return 'This request was already sent with different content — try again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'permission-denied':
      return 'This receipt belongs to another tenant.';
    case 'conflict':
      return 'The same request is already being processed — wait a moment and refresh.';
    default:
      return null;
  }
}

/** Why a web add was refused. */
export function addPhotoReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    const common = commonPhotoReason(error);
    if (common !== null) return common;
    switch (error.code) {
      case 'attachment-limit-reached':
        return `This line already holds ${MAX_PHOTOS_PER_LINE} photos (or the receipt ${MAX_PHOTOS_PER_RECEIPT}) — remove one first.`;
      case 'attachment-type-unsupported':
        return PHOTO_TYPE_UNSUPPORTED;
      case 'attachment-too-large':
        return PHOTO_TOO_LARGE;
      case 'attachment-content-invalid':
        return 'This photo could not be read — it may be damaged, or larger than 8,000 px a side.';
      case 'not-found':
        return 'This receipt line no longer exists — refresh the list.';
      case 'role-denied':
        return 'Your role cannot add photos.';
      case 'validation-failed':
        return error.detail ?? 'The photo was not sent correctly — try again.';
      default:
        return error.detail ?? `Not added (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** Why a remove (or a placeholder cancel) was refused. */
export function removePhotoReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    const common = commonPhotoReason(error);
    if (common !== null) return common;
    switch (error.code) {
      case 'attachment-not-attached':
        return 'This photo was already removed or cancelled — the list is refreshed.';
      case 'not-found':
        return 'This photo no longer exists — refresh the list.';
      case 'role-denied':
        return 'Only an owner or ops manager can remove photos.';
      case 'validation-failed':
        return error.detail ?? 'The reason must be 1–200 characters.';
      default:
        return error.detail ?? `Not removed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** Why the photos list did not load. */
export function photosReadReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This receipt no longer exists — refresh the list.';
      case 'role-denied':
      case 'permission-denied':
        return 'Your session cannot read this receipt.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Could not load the photos (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

// ── preparing a file for upload (decision 4) ─────────────────────────────────

export type SniffedImage = 'jpeg' | 'png' | 'webp' | 'heic' | 'other';

/** HEIF brands (ISO/IEC 23008-12) — `ftyp` at offset 4, the major brand at 8. */
const HEIF_BRANDS: ReadonlySet<string> = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** The image type by its first bytes — the same rule the server uses (decision 3): never the name or the declared type. */
export function sniffImage(head: Uint8Array): SniffedImage {
  const at = (index: number) => head[index] ?? -1;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg';
  if (at(0) === 0x89 && ascii(1, 4) === 'PNG' && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (head.length >= 12 && ascii(4, 8) === 'ftyp') {
    if (HEIF_BRANDS.has(ascii(8, 12))) return 'heic';
    // A compatible-brands list naming a HEIF brand (some encoders lead with another major brand).
    for (let offset = 16; offset + 4 <= Math.min(head.length, 64); offset += 4) {
      if (HEIF_BRANDS.has(ascii(offset, offset + 4))) return 'heic';
    }
  }
  return 'other';
}

/** The decoded image the encoder draws (a browser `ImageBitmap` or a test double). */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close?: () => void;
}

export interface PrepareDeps {
  /** Decode with the EXIF orientation applied (`createImageBitmap(file, {imageOrientation: 'from-image'})`). */
  decode: (file: Blob) => Promise<DecodedImage>;
  /** Draw at `width × height` and encode JPEG at `quality`; null when the browser cannot encode. */
  encode: (image: DecodedImage, width: number, height: number, quality: number) => Promise<Blob | null>;
}

/** The size after fitting the long edge into `maxEdge` (never upscaled). */
export function fitLongEdge(width: number, height: number, maxEdge = WEB_MAX_LONG_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `crate-3.heic` → `crate-3.jpg`. */
export function jpegFileName(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, '').trim();
  return `${base === '' ? 'photo' : base}.jpg`;
}

const browserDeps: PrepareDeps = {
  decode: async (file) => {
    if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap is unavailable');
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  },
  encode: async (image, width, height, quality) => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    // JPEG has no alpha: a transparent PNG would otherwise turn black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  },
};

export type PreparedPhoto = { ok: true; file: File } | { ok: false; problem: string };

async function readHead(file: Blob, bytes: number): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  // happy-dom and older engines lack Blob#arrayBuffer on a slice; FileReader is everywhere.
  if (typeof slice.arrayBuffer === 'function') return new Uint8Array(await slice.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Decision 4 — the web re-encodes before it uploads: refuse a file over
 * 40 MB (a memory ceiling; the 10 MB cap applies to what is sent), one that sniffs as HEIC (A28's words) or as anything but JPEG, PNG
 * or WebP, and one the browser cannot decode; otherwise decode with the
 * EXIF orientation applied, fit the long edge into 2,560 px and encode JPEG
 * at 0.85. That bakes the orientation in and drops the metadata; the server's
 * strip remains the guarantee. A browser that cannot encode sends the
 * original (the server strips it) rather than refusing a good photo.
 */
export async function prepareImageForUpload(file: File, deps: PrepareDeps = browserDeps): Promise<PreparedPhoto> {
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, problem: PHOTO_SOURCE_TOO_LARGE };
  if (file.size === 0) return { ok: false, problem: PHOTO_UNREADABLE };
  let head: Uint8Array;
  try {
    head = await readHead(file, 64);
  } catch {
    return { ok: false, problem: PHOTO_UNREADABLE };
  }
  const kind = sniffImage(head);
  if (kind === 'heic') return { ok: false, problem: HEIC_MESSAGE };
  if (kind === 'other') return { ok: false, problem: PHOTO_TYPE_UNSUPPORTED };
  let image: DecodedImage;
  try {
    image = await deps.decode(file);
  } catch {
    return { ok: false, problem: PHOTO_UNREADABLE };
  }
  try {
    if (!(image.width > 0 && image.height > 0)) return { ok: false, problem: PHOTO_UNREADABLE };
    const size = fitLongEdge(image.width, image.height);
    let blob: Blob | null = null;
    try {
      blob = await deps.encode(image, size.width, size.height, WEB_JPEG_QUALITY);
    } catch {
      blob = null;
    }
    if (blob === null || blob.size === 0) return file.size > MAX_PHOTO_BYTES ? { ok: false, problem: PHOTO_TOO_LARGE } : { ok: true, file };
    if (blob.size > MAX_PHOTO_BYTES) return { ok: false, problem: PHOTO_TOO_LARGE };
    return { ok: true, file: new File([blob], jpegFileName(file.name), { type: 'image/jpeg' }) };
  } finally {
    image.close?.();
  }
}

// ── the deduped expired-URL refetch (A28) ────────────────────────────────────

/** What an image error led to. */
export type ImageErrorOutcome = 'refetching' | 'joined' | 'broken';

/** A photo whose `<img>` may fail: its id, the URL that failed and when that URL stops working. */
export interface FailingImage {
  readonly id: string;
  readonly url: string;
  readonly urlExpiresAt: string | null;
}

/**
 * A28 — one refetch in flight per dialog, at most once per image error. An
 * `<img>` that fails asks `onImageError`:
 *
 * - while a refetch is in flight, the error joins it (no second request);
 * - a URL that already triggered a refetch never triggers another — the
 *   fresh list either replaced it or the image is genuinely broken;
 * - a URL that has not expired yet (by its `urlExpiresAt`, with a 5 s
 *   margin) is broken, not stale — refetching would only mint the same
 *   failure again;
 * - and one photo triggers at most `maxPerPhoto` refetches per dialog, so a
 *   skewed clock can never turn a broken image into a request loop.
 *
 * The caller renders `broken` as a placeholder with a manual Retry
 * (`retry`), which refetches once regardless of the URL's age.
 */
export function createUrlRefresher(initialRefetch: () => Promise<unknown>, options: { maxPerPhoto?: number; now?: () => number } = {}) {
  let refetch = initialRefetch;
  const maxPerPhoto = options.maxPerPhoto ?? 2;
  const now = options.now ?? Date.now;
  let inFlight: Promise<void> | null = null;
  const triedUrls = new Set<string>();
  const perPhoto = new Map<string, number>();

  function run(): Promise<void> {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      try {
        await refetch();
      } catch {
        // The list's own failed arm reports it; the refresher only dedupes.
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    /** Point the refresher at the newest refetch (a component calls this from an effect). */
    bind(next: () => Promise<unknown>): void {
      refetch = next;
    },
    onImageError(image: FailingImage): ImageErrorOutcome {
      if (inFlight !== null) return 'joined';
      if (triedUrls.has(image.url)) return 'broken';
      const expiresAt = image.urlExpiresAt === null ? Number.NaN : Date.parse(image.urlExpiresAt);
      const expired = Number.isNaN(expiresAt) || now() >= expiresAt - 5_000;
      const used = perPhoto.get(image.id) ?? 0;
      if (!expired || used >= maxPerPhoto) return 'broken';
      triedUrls.add(image.url);
      perPhoto.set(image.id, used + 1);
      void run();
      return 'refetching';
    },
    /** Resolves when the running refetch (if any) has settled — a tile then re-checks its URL. */
    settled(): Promise<void> {
      return inFlight ?? Promise.resolve();
    },
    /** A manual Retry on a broken image: one refetch (joined if one is already running). */
    retry(): Promise<void> {
      return run();
    },
    /** Whether a refetch is running (for a test, or a quiet "Refreshing…"). */
    get refreshing(): boolean {
      return inFlight !== null;
    },
  };
}

export type UrlRefresher = ReturnType<typeof createUrlRefresher>;

/** A photo either surface can show: staff's view or the portal's. */
export type ViewablePhoto = Pick<ReceiptPhotoViewDto, 'id' | 'url' | 'urlExpiresAt' | 'width' | 'height'> | PortalReceiptPhotoDto;
