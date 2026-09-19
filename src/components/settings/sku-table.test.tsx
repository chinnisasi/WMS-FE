import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { SkuTableCard } from './sku-table';

/**
 * The SKU table's physical-attributes surface (story 11-2). The claims a
 * `src/lib` test cannot make:
 *   1. the Weight · dims summary column renders between HSN and Tracking,
 *      through the `skuPhysicalLabel` derivation, with the em-dash
 *      placeholder for a SKU that carries no attributes,
 *   2. pressing Save sends the five attribute fields in the PATCH body,
 *      prefilled field-for-field from the row,
 *   3. a cleared weight field sends `null` (clear), not zero and not absence.
 *
 * The surface is driven through a stubbed global `fetch` — the generated
 * client is a fetch wrapper — so the wiring under test is the one that ships.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
}

let requests: Recorded[] = [];
let skuRows: unknown[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A SKU fixture with every response field the table and the form read. */
function sku(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sku-1',
    tenantId: TENANT_ID,
    code: 'SPICE-01',
    name: 'Turmeric 500g',
    uom: 'each',
    uomPrecision: 0,
    gstRateBps: 1800,
    hsn: '10062020',
    batchTracked: false,
    serialTracked: false,
    catchWeightTracked: false,
    weightGrams: 500,
    lengthMm: 200,
    widthMm: 150,
    heightMm: 100,
    countryOfOrigin: 'IN',
    reorderPoint: 50,
    reorderQty: 100,
    barcode: 'BC-SPICE-01',
    uomConversions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, body });
    if (method === 'PATCH' && /\/catalog\/skus\/[^/]+$/.test(pathname)) {
      return json(200, sku());
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, { items: skuRows, nextCursor: null });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  skuRows = [
    sku(),
    sku({
      id: 'sku-2',
      code: 'UNSET-01',
      name: 'No attributes',
      barcode: 'BC-UNSET-01',
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      countryOfOrigin: null,
    }),
  ];
  stubRouter();
  writeSession(SESSION);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** A controlled React input needs the native setter or React never sees it. */
function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(): Promise<Rendered> {
  const rendered = render(<SkuTableCard />);
  await settle();
  return rendered;
}

/**
 * Submit the edit form. happy-dom does not turn a click on a `type="submit"`
 * button into a form submit event, so the test dispatches the event itself —
 * which is the same event React's `onSubmit` handles in the browser.
 */
function submitForm(scope: ParentNode): void {
  const form = scope.querySelector('form')!;
  act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('SkuTable: the weight · dims summary column (story 11-2)', () => {
  test('renders between HSN and Tracking, full and placeholder rows alike', async () => {
    view = await mount();

    const headers = [...view.container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers.indexOf('HSN')).toBeGreaterThanOrEqual(0);
    expect(headers.indexOf('Weight · dims')).toBe(headers.indexOf('HSN') + 1);
    expect(headers.indexOf('Tracking')).toBe(headers.indexOf('Weight · dims') + 1);

    const rows = [...view.container.querySelectorAll('tbody tr')];
    const full = rows.find((row) => row.textContent!.includes('SPICE-01'));
    expect(full!.textContent).toContain('500 g · 200×150×100 mm · IN');
    const unset = rows.find((row) => row.textContent!.includes('UNSET-01'));
    expect(unset!.textContent).toContain('—');
  });
});

describe('SkuEditForm: the attribute fields (story 11-2)', () => {
  test('Save sends the five attributes in the PATCH body, prefilled from the row', async () => {
    view = await mount();
    const edit = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
    act(() => edit!.click());
    await settle();

    submitForm(view.container);
    await settle();

    const patch = requests.find((r) => r.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch!.body).toMatchObject({
      weightGrams: 500,
      lengthMm: 200,
      widthMm: 150,
      heightMm: 100,
      countryOfOrigin: 'IN',
    });
  });

  test('a cleared weight field sends null (clear), not zero and not absence', async () => {
    view = await mount();
    const edit = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
    act(() => edit!.click());
    await settle();

    // The first number input in the form is GST %, not Weight — resolve the
    // weight field through its label text, not input order.
    const weight = [...view.container.querySelectorAll('label')]
      .find((label) => label.textContent!.includes('Weight (g)'))!
      .querySelector<HTMLInputElement>('input')!;
    setInput(weight, '');
    submitForm(view.container);
    await settle();

    const patch = requests.find((r) => r.method === 'PATCH');
    expect(patch).toBeDefined();
    expect((patch!.body as Record<string, unknown>).weightGrams).toBeNull();
  });

  test('a SKU with no attributes edits cleanly — every blank attribute clears to null', async () => {
    view = await mount();
    const unsetRow = [...view.container.querySelectorAll('tbody tr')].find((row) =>
      row.textContent!.includes('UNSET-01'),
    )!;
    const edit = [...unsetRow.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
    act(() => edit!.click());
    await settle();

    submitForm(view.container);
    await settle();

    const patch = requests.find((r) => r.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch!.body).toMatchObject({
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      countryOfOrigin: null,
    });
  });

  test('a malformed weight refuses client-side — named refusal, no PATCH sent', async () => {
    view = await mount();
    const edit = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
    act(() => edit!.click());
    await settle();

    // `1e3` is a spelling the whole-grams grammar refuses — with the text
    // input, `attributeInput`'s grammar is the authority and the refusal
    // names the field and its unit. The form returns before the fetch,
    // so no PATCH leaves and nothing changes.
    const weight = [...view.container.querySelectorAll('label')]
      .find((label) => label.textContent!.includes('Weight (g)'))!
      .querySelector<HTMLInputElement>('input')!;
    setInput(weight, '1e3');
    submitForm(view.container);
    await settle();

    // The refusal renders through the FeedbackBanner (the rejection outcome),
    // and no PATCH leaves the form.
    expect(view.container.textContent).toContain('Weight must be a whole number of grams.');
    expect(view.container.textContent).toContain('Not updated');
    expect(requests.find((r) => r.method === 'PATCH')).toBeUndefined();
  });

  test('the attribute labels carry the WYSIWYG units', async () => {
    view = await mount();
    const edit = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
    act(() => edit!.click());
    await settle();

    const labels = [...view.container.querySelectorAll('label span')].map((span) => span.textContent);
    expect(labels).toContain('Weight (g)');
    expect(labels).toContain('Length (mm)');
    expect(labels).toContain('Width (mm)');
    expect(labels).toContain('Height (mm)');
    expect(labels).toContain('Origin');
  });
});
