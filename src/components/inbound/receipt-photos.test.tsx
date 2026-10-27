import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { PrepareDeps } from '../../lib/receipt-photos';
import { HEIC_MESSAGE } from '../../lib/receipt-photos';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ReceiptPhotosDialog } from './receipt-photos';

/**
 * Story 2-5a — the photos dialog, driven through a stubbed `fetch`:
 *   1. every status renders in words (attached image, On its way, Never
 *      arrived, Removed with who and why and no image — A20);
 *   2. gating: Add for `receipt.attach`, Remove / Cancel for
 *      `receipt.photo-remove`, neither for a reader — absent, not disabled;
 *   3. Add re-encodes and POSTs multipart under a key, then re-reads; a HEIC
 *      file never leaves the browser;
 *   4. Remove / Cancel POST the reason under a key bound to it;
 *   5. expired URLs refetch the list ONCE however many images fail (A28);
 *   6. storage off: a warning, no Add.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const GRN = '0198f7a2-1b3c-7d4e-8f90-0000000000b7';
const L1 = '0198f7a2-1b3c-7d4e-8f90-00000000a001';
const L2 = '0198f7a2-1b3c-7d4e-8f90-00000000a002';
const BASE = `/api/v1/tenants/${T}/receiving/goods-receipts/${GRN}`;

function session(role: 'owner' | 'ops_manager' | 'operator' | 'accountant'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'me@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

function photo(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    grnLineId: L1,
    lineNo: 1,
    status: 'attached',
    source: 'handheld',
    contentType: 'image/jpeg',
    byteSize: 204_800,
    width: 1600,
    height: 1200,
    capturedAt: '2026-10-13T08:33:00.000Z',
    uploadedAt: '2026-10-13T08:40:00.000Z',
    createdAt: '2026-10-13T08:33:00.000Z',
    fileName: `GRN-0042-L1-${id}.jpg`,
    url: `https://bucket.example/${id}?sig=1`,
    urlExpiresAt: FUTURE,
    ...over,
  };
}

const LINES = [
  { id: L1, skuId: 's-1', skuCode: 'CHILLI-1KG', skuName: 'Chilli 1 kg', batchId: null, batchCode: null, qty: 8, appliedQty: 8, damagedQty: 2, damageReasonCode: 'crushed', photoCount: 1, pendingPhotoCount: 1 },
  { id: L2, skuId: 's-2', skuCode: 'TURMERIC', skuName: 'Turmeric', batchId: null, batchCode: null, qty: 5, appliedQty: 5, photoCount: 0, pendingPhotoCount: 0 },
];

let photos: Record<string, unknown>[] = [];
let storageEnabled = true;
let listReads = 0;
let posts: { path: string; key: string | null; body: unknown; file: File | null }[] = [];
let postReplies: [number, unknown][] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stub(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    if (request.method.toUpperCase() === 'POST') {
      const type = request.headers.get('content-type') ?? '';
      let body: unknown = null;
      let file: File | null = null;
      if (type.startsWith('multipart/')) {
        const form = await request.formData();
        const entry = form.get('file');
        file = entry instanceof File ? entry : null;
      } else {
        body = await request.json();
      }
      posts.push({ path: pathname, key: request.headers.get('Idempotency-Key'), body, file });
      const reply = postReplies.shift() ?? [201, { attachment: photo('new') }];
      return json(reply[0], reply[1]);
    }
    if (pathname === `${BASE}/photos`) {
      listReads += 1;
      return json(200, { storageEnabled, photos });
    }
    if (pathname === `${BASE}/lines`) return json(200, { items: LINES });
    return json(404, { code: 'not-found', status: 404 });
  }) as unknown as typeof fetch);
}

/** A decoder/encoder that needs no canvas (happy-dom has none). */
const fakeDeps: PrepareDeps = {
  decode: async () => ({ width: 4000, height: 3000 }),
  encode: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
};

let view: Rendered | undefined;

beforeEach(() => {
  photos = [
    photo('p-att'),
    photo('p-wait', { status: 'awaited', url: null, urlExpiresAt: null, contentType: null, byteSize: null, width: null, height: null, uploadedAt: null }),
    photo('p-exp', { status: 'expired', url: null, urlExpiresAt: null, contentType: null, byteSize: null, width: null, height: null, uploadedAt: null }),
    photo('p-rem', { status: 'removed', url: null, urlExpiresAt: null, removedAt: '2026-10-14T05:00:00.000Z', removedBy: 'u-9', removedByName: 'Asha Rao', removedReason: 'Wrong pallet' }),
  ];
  storageEnabled = true;
  listReads = 0;
  posts = [];
  postReplies = [];
  stub();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function click(element: Element): void {
  act(() => void element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function buttons(container: HTMLElement, text: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => (b.textContent ?? '').includes(text) || (b.getAttribute('aria-label') ?? '').includes(text));
}

function dialogIn(container: HTMLElement): HTMLElement {
  // The modal renders inside the test container.
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog as HTMLElement;
}

async function open(role: Parameters<typeof session>[0], focusLineId: string | null = L1): Promise<HTMLElement> {
  writeSession(session(role));
  view = render(<ReceiptPhotosDialog grnId={GRN} grnCode="GRN-0042" focusLineId={focusLineId} skuMap={null} onClose={() => undefined} prepareDeps={fakeDeps} />);
  await settle();
  return dialogIn(view.container);
}

function typeInto(element: HTMLTextAreaElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function choose(dialog: HTMLElement, lineId: string, files: File[]): Promise<void> {
  const input = dialog.querySelector(`[data-testid="photo-input-${lineId}"]`) as HTMLInputElement;
  expect(input).not.toBeNull();
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

describe('the photos dialog — states (story 2-5a)', () => {
  test('attached shows its image; awaited, expired and removed are placeholders in words', async () => {
    const dialog = await open('owner');
    const images = [...dialog.querySelectorAll('img')];
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['https://bucket.example/p-att?sig=1']);
    expect(dialog.querySelector('[data-testid="photo-tile-awaited"]')!.textContent).toContain('On its way');
    expect(dialog.querySelector('[data-testid="photo-tile-expired"]')!.textContent).toContain('Never arrived');
    const removed = dialog.querySelector('[data-testid="photo-tile-removed"]')!;
    expect(removed.textContent).toContain('Removed');
    expect(removed.textContent).toContain('Wrong pallet');
    expect(removed.querySelector('img')).toBeNull();
    expect(dialog.textContent).toContain('1 photo · 1 on its way');
  });

  test('a removed photo in the lightbox: who, when and why — and no image, no link (A20)', async () => {
    const dialog = await open('owner');
    click(buttons(dialog, 'Open CHILLI-1KG photo 4')[0]!);
    const detail = dialog.querySelector('[data-testid="photo-removed-detail"]')!;
    expect(detail.textContent).toContain('Removed by Asha Rao');
    expect(detail.textContent).toContain('Wrong pallet');
    const stage = dialog.querySelector('[data-testid="photo-lightbox"]')!;
    expect(stage.querySelector('img')).toBeNull();
    expect(stage.textContent).not.toContain('Open full size');
    expect(stage.textContent).toContain('4 of 4');
  });

  test('the line view narrows to one line; Show all lines adds the rest', async () => {
    const dialog = await open('owner');
    expect(dialog.querySelector(`[data-testid="photo-line-${L2}"]`)).toBeNull();
    click(buttons(dialog, 'Show all 2 lines')[0]!);
    expect(dialog.querySelector(`[data-testid="photo-line-${L2}"]`)!.textContent).toContain('No photos on this line');
  });

  test('storage off: a warning and no Add', async () => {
    storageEnabled = false;
    const dialog = await open('owner');
    expect(dialog.textContent).toContain('Photo storage is off');
    expect(buttons(dialog, 'Add photo')).toHaveLength(0);
  });
});

describe('the photos dialog — gating', () => {
  test('operator: Add, but no Remove or Cancel (receipt.photo-remove is a manager\'s)', async () => {
    const dialog = await open('operator');
    expect(buttons(dialog, 'Add photo')).toHaveLength(1);
    click(buttons(dialog, 'Open CHILLI-1KG photo 1')[0]!);
    expect(buttons(dialog, 'Remove photo')).toHaveLength(0);
  });

  test('accountant: reads every photo, offered no Add and no Remove', async () => {
    const dialog = await open('accountant');
    expect(dialog.querySelectorAll('img')).toHaveLength(1);
    expect(buttons(dialog, 'Add photo')).toHaveLength(0);
    click(buttons(dialog, 'Open CHILLI-1KG photo 1')[0]!);
    expect(buttons(dialog, 'Remove photo')).toHaveLength(0);
  });

  test('ops manager: Remove on an attached photo, Cancel on an awaited one, nothing on removed or expired', async () => {
    const dialog = await open('ops_manager');
    click(buttons(dialog, 'Open CHILLI-1KG photo 1')[0]!);
    expect(buttons(dialog, 'Remove photo…')).toHaveLength(1);
    click(buttons(dialog, 'Next photo')[0]!);
    expect(buttons(dialog, 'Cancel placeholder…')).toHaveLength(1);
    click(buttons(dialog, 'Next photo')[0]!);
    expect(buttons(dialog, 'Remove photo')).toHaveLength(0);
    expect(buttons(dialog, 'Cancel placeholder')).toHaveLength(0);
  });
});

describe('the photos dialog — add, remove, cancel', () => {
  test('Add re-encodes, POSTs multipart to the line under a key, then re-reads the list', async () => {
    const dialog = await open('operator');
    const before = listReads;
    await choose(dialog, L1, [new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])], 'crate.png')]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe(`${BASE}/lines/${L1}/photos`);
    expect(posts[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(posts[0]!.file!.type).toBe('image/jpeg');
    expect(posts[0]!.file!.name).toBe('crate.jpg');
    expect(listReads).toBeGreaterThan(before);
    expect(dialog.textContent).toContain('1 photo added');
  });

  test('a HEIC file never leaves the browser: the A28 words, no POST', async () => {
    const dialog = await open('operator');
    const heic = new Uint8Array(32);
    heic.set([0, 0, 0, 0x18, ...[...'ftypheic'].map((c) => c.charCodeAt(0))]);
    await choose(dialog, L1, [new File([heic], 'IMG_0007.HEIC')]);
    expect(posts).toHaveLength(0);
    expect(dialog.textContent).toContain(HEIC_MESSAGE);
  });

  test('a storage failure keeps the prepared file: Retry re-sends it under the SAME key', async () => {
    const dialog = await open('operator');
    postReplies = [[503, { code: 'file-storage-failed', status: 503, title: 'Storage failed' }]];
    await choose(dialog, L1, [new File([new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])], 'a.jpg')]);
    expect(dialog.textContent).toContain('Photo storage did not answer');
    click(buttons(dialog, 'Retry')[0]!);
    await settle();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.key).toBe(posts[0]!.key);
    expect(dialog.querySelector('[data-testid="photo-upload"]')).toBeNull();
  });

  test('Remove POSTs {reason} under a key; a retry of the same reason reuses it, an edited one mints another', async () => {
    const dialog = await open('ops_manager');
    click(buttons(dialog, 'Open CHILLI-1KG photo 1')[0]!);
    click(buttons(dialog, 'Remove photo…')[0]!);
    const reason = dialog.querySelector('textarea[aria-label="Reason"]') as HTMLTextAreaElement;
    // Blank: refused locally, nothing sent.
    click(buttons(dialog, 'Remove photo').find((b) => b.textContent === 'Remove photo')!);
    await settle();
    expect(posts).toHaveLength(0);
    expect(dialog.textContent).toContain('Say why');
    typeInto(reason, 'Duplicate of photo 2');
    postReplies = [[503, { code: 'file-storage-busy', status: 503 }]];
    click(buttons(dialog, 'Remove photo').find((b) => b.textContent === 'Remove photo')!);
    await settle();
    click(buttons(dialog, 'Remove photo').find((b) => b.textContent === 'Remove photo')!);
    await settle();
    expect(posts.map((p) => p.path)).toEqual([`${BASE}/photos/p-att/remove`, `${BASE}/photos/p-att/remove`]);
    expect(posts[0]!.body).toEqual({ reason: 'Duplicate of photo 2' });
    expect(posts[1]!.key).toBe(posts[0]!.key);
    expect(dialog.textContent).toContain('Photo removed');
  });

  test('Cancel on an awaited placeholder sends the same verb with its id', async () => {
    const dialog = await open('owner');
    click(buttons(dialog, 'Open CHILLI-1KG photo 2')[0]!);
    click(buttons(dialog, 'Cancel placeholder…')[0]!);
    typeInto(dialog.querySelector('textarea[aria-label="Reason"]') as HTMLTextAreaElement, 'Photo retaken on the web');
    click(buttons(dialog, 'Cancel placeholder').find((b) => b.textContent === 'Cancel placeholder')!);
    await settle();
    expect(posts[0]!.path).toBe(`${BASE}/photos/p-wait/remove`);
    expect(dialog.textContent).toContain('Placeholder cancelled');
  });
});

describe('the photos dialog — expired URLs (A28)', () => {
  test('several images failing after expiry refetch the list ONCE; a fresh URL that fails is broken with a Retry', async () => {
    photos = [photo('a', { urlExpiresAt: PAST }), photo('b', { urlExpiresAt: PAST }), photo('c', { urlExpiresAt: PAST })];
    const dialog = await open('owner');
    const before = listReads;
    // The refetch answers with fresh URLs.
    photos = [photo('a', { url: 'https://bucket.example/a?sig=2' }), photo('b', { url: 'https://bucket.example/b?sig=2' }), photo('c', { url: 'https://bucket.example/c?sig=2' })];
    act(() => {
      for (const img of dialog.querySelectorAll('img')) img.dispatchEvent(new Event('error'));
    });
    await settle();
    expect(listReads - before).toBe(1);
    expect([...dialog.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      'https://bucket.example/a?sig=2',
      'https://bucket.example/b?sig=2',
      'https://bucket.example/c?sig=2',
    ]);
    // The fresh URL fails too: broken, no further read.
    act(() => void dialog.querySelector('img')!.dispatchEvent(new Event('error')));
    await settle();
    expect(listReads - before).toBe(1);
    expect(dialog.textContent).toContain('Could not load this photo.');
  });
});
