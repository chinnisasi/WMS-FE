import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { SkuCreateCard } from './sku-create-card';

/**
 * Story 1-4 — the create card's claims a `src/lib` test cannot make:
 *   1. pressing Create sends the parsed body to `POST …/catalog/skus`,
 *   2. a refused create retried unchanged reuses its Idempotency-Key, and an
 *      edit to the draft mints a new one (the per-draft key),
 *   3. the shelf-life warning renders against the client's policy minimum,
 *   4. while the clients list is loading, submit is disabled with a note.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};
const SELF = {
  id: 'c-self',
  tenantId: TENANT_ID,
  code: 'self',
  name: 'Priya Spices',
  status: 'active',
  systemOwned: true,
  receivingPolicy: { receivingToleranceBps: 0, qcOnReceipt: false, expiryRequired: false, minShelfLifeDays: 90 },
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
}
let requests: Recorded[] = [];
let createRefusals = 0;
/** When set, the clients GET waits for it (the loading arm). */
let clientsGate: Promise<void> | null = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input.toString(), init);
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, body, key: request.headers.get('Idempotency-Key') });
    if (method === 'GET' && pathname.endsWith('/clients')) {
      if (clientsGate !== null) await clientsGate;
      return json(200, { items: [SELF] });
    }
    if (method === 'POST' && pathname.endsWith('/catalog/skus')) {
      if (createRefusals > 0) {
        createRefusals -= 1;
        return json(409, { code: 'duplicate-sku-code', status: 409, title: 'SKU code already in use', detail: 'Taken.' });
      }
      const sent = body as { code: string };
      return json(201, { sku: { id: 'sku-new', code: sent.code, uomConversions: [], barcodes: [] } });
    }
    return json(404, { code: 'not-found', title: 'Unrouted', status: 404 });
  }) as unknown as typeof fetch);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  return [...container.querySelectorAll('label')]
    .find((node) => node.querySelector('span')?.textContent === label)!
    .querySelector<HTMLInputElement>('input')!;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
}

async function openForm(): Promise<Rendered> {
  const rendered = render(<SkuCreateCard />);
  await settle();
  act(() => button(rendered.container, 'New SKU').click());
  await settle();
  return rendered;
}

function submit(container: HTMLElement): void {
  const form = container.querySelector('form[aria-label="New SKU"]')!;
  act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  createRefusals = 0;
  clientsGate = null;
  writeSession(SESSION);
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

describe('story 1-4: the SKU create card', () => {
  test('Create sends the parsed body to POST …/catalog/skus', async () => {
    view = await openForm();
    setInput(field(view.container, 'Code'), 'TEA-1');
    setInput(field(view.container, 'Name'), 'Assam tea');
    setInput(field(view.container, 'GST %'), '5');
    submit(view.container);
    await settle();
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/catalog/skus`);
    expect(post.body).toEqual({
      code: 'TEA-1',
      name: 'Assam tea',
      uom: 'each',
      gstRate: 500,
      batchTracked: false,
      serialTracked: false,
      catchWeightTracked: false,
      storageClass: 'ambient',
    });
    expect(view.container.textContent).toContain('TEA-1 created');
  });

  test('a refused create retried unchanged reuses its Idempotency-Key; an edit mints a new one', async () => {
    createRefusals = 2;
    view = await openForm();
    setInput(field(view.container, 'Code'), 'TEA-2');
    setInput(field(view.container, 'Name'), 'Tea two');
    submit(view.container);
    await settle();
    submit(view.container);
    await settle();
    setInput(field(view.container, 'Name'), 'Tea two, renamed');
    submit(view.container);
    await settle();
    const keys = requests.filter((r) => r.method === 'POST').map((r) => r.key);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test('the shelf-life warning renders against the client policy minimum (90 required, 60 typed)', async () => {
    view = await openForm();
    expect(view.container.textContent).not.toContain('requires at least 90 days');
    setInput(field(view.container, 'Shelf life — total days from manufacture'), '60');
    await settle();
    expect(view.container.textContent).toContain('This client requires at least 90 days of remaining shelf life on receipt');
    setInput(field(view.container, 'Shelf life — total days from manufacture'), '120');
    await settle();
    expect(view.container.textContent).not.toContain('requires at least 90 days');
  });

  test('while the clients list loads, submit is disabled with a note and nothing is sent', async () => {
    let release: () => void = () => undefined;
    clientsGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    view = await openForm();
    expect(view.container.textContent).toContain('Loading clients…');
    expect(button(view.container, 'Create SKU').disabled).toBe(true);
    submit(view.container);
    await settle();
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
    release();
    await settle();
    expect(button(view.container, 'Create SKU').disabled).toBe(false);
  });
});

describe('story 1-4: a base-unit change', () => {
  test('drops levels equal to the new base and clears barcode levels that named the old base or a dropped level', async () => {
    const { rebaseDraft } = await import('./sku-create-card');
    const { emptySkuCreateDraft } = await import('../../lib/sku-admin');
    const draft = {
      ...emptySkuCreateDraft(),
      uom: 'each',
      levels: [
        { id: 'l1', uom: 'case', factor: '12' },
        { id: 'l2', uom: 'box', factor: '6' },
      ],
      barcodes: [
        { id: 'b1', barcode: 'A', uom: 'each' },
        { id: 'b2', barcode: 'B', uom: 'case' },
        { id: 'b3', barcode: 'C', uom: 'box' },
      ],
    };
    expect(rebaseDraft(draft, 'case')).toEqual({
      uom: 'case',
      levels: [{ id: 'l2', uom: 'box', factor: '6' }],
      barcodes: [
        { id: 'b1', barcode: 'A', uom: '' },
        { id: 'b2', barcode: 'B', uom: '' },
        { id: 'b3', barcode: 'C', uom: 'box' },
      ],
    });
  });
});
