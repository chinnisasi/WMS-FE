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
/** The kits-list join — keyed by `skuId` on the wire, list-shaped here. */
let kitRows: Record<string, unknown>[] = [];
/** Forces the next kit create to 409 `kit-already-composed` (the race arm). */
let forceKitConflict = false;
/** Makes every kits-list GET answer 500 (the join's failed arm). */
let kitsFail = false;

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

/** A kit fixture — the join's response shape (11-4), components in decimals. */
function kit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    skuId: 'sku-5',
    tenantId: TENANT_ID,
    code: 'GIFT-BOX',
    name: 'Gift box',
    components: [
      { skuId: 'sku-3', code: 'PAD-01', qty: 2 },
      { skuId: 'sku-4', code: 'TAPE-01', qty: 1.5 },
    ],
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
    if (method === 'GET' && pathname.endsWith('/catalog/kits')) {
      if (kitsFail) {
        return json(500, { code: 'internal-error', title: 'Kits unavailable', status: 500, detail: 'The kits list is unavailable.' });
      }
      return json(200, { items: kitRows, nextCursor: null });
    }
    if (
      (method === 'POST' || method === 'PUT') &&
      /\/catalog\/skus\/[^/]+\/kit$/.test(pathname)
    ) {
      const skuId = pathname.split('/catalog/skus/')[1]!.split('/kit')[0]!;
      if (method === 'POST' && forceKitConflict) {
        // The winning composition is visible to the join the form refetches.
        kitRows = [...kitRows, kit({ skuId, code: 'GIFT-BOX' })];
        forceKitConflict = false;
        return json(409, {
          code: 'kit-already-composed',
          title: 'Already a kit',
          status: 409,
          detail: 'This SKU is already a kit.',
        });
      }
      // The echo carries the SAVED composition — code-per-component from the
      // catalog, quantity as the decimal the request sent.
      const sent = ((body as { components?: { skuId: string; quantity: number }[] })?.components ??
        []) as { skuId: string; quantity: number }[];
      return json(
        200,
        kit({
          skuId,
          components: sent.map((component) => ({
            skuId: component.skuId,
            code:
              (skuRows.find((s) => (s as { id: string }).id === component.skuId) as
                | { code?: string }
                | undefined)?.code ?? component.skuId,
            qty: component.quantity,
          })),
        }),
      );
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  forceKitConflict = false;
  kitsFail = false;
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
    // Story 11-6 fixtures: a kit SKU and its two ordinary component SKUs.
    sku({ id: 'sku-3', code: 'PAD-01', name: 'Foam pad', hsn: null, barcode: 'BC-PAD-01' }),
    sku({ id: 'sku-4', code: 'TAPE-01', name: 'Tape', uom: 'kg', uomPrecision: 3, hsn: null, barcode: 'BC-TAPE-01' }),
    sku({ id: 'sku-5', code: 'GIFT-BOX', name: 'Gift box', hsn: null, barcode: 'BC-BOX-1' }),
    sku({ id: 'sku-6', code: 'BOX-2', name: 'Second kit', hsn: null, barcode: 'BC-BOX-2' }),
  ];
  kitRows = [kit(), kit({ skuId: 'sku-6', code: 'BOX-2' })];
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

/**
 * The kit surface (story 11-6). The claims a `src/lib` test cannot make:
 *   1. the Kit marker column renders `Kit · N components` for kit rows and
 *      an em-dash for plain rows — derived from the kits-list join, not a
 *      SKU flag,
 *   2. pressing Kit on a plain SKU and saving sends the POST with decimal
 *      component quantities (never raw milli),
 *   3. pressing Edit kit on a kit row sends the PUT that replaces the whole
 *      composition, prefilled from the join,
 *   4. a create refused 409 `kit-already-composed` switches the form to edit
 *      mode — the next submit is the PUT,
 *   5. the component picker excludes the kit itself and every other kit
 *      (guaranteed refusals filtered, not validated).
 */
describe('SkuTable: the kit marker and kit forms (story 11-6)', () => {
  /** Open the kit form on the row whose code matches. */
  async function openKitForm(container: HTMLElement, code: string): Promise<void> {
    const row = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent!.includes(code))!;
    const button = [...row.querySelectorAll('button')].find(
      (b) => b.textContent === 'Kit' || b.textContent === 'Edit kit',
    );
    expect(button).toBeDefined();
    act(() => button!.click());
    await settle();
  }

  function kitFormInputs(container: HTMLElement): { select: HTMLSelectElement; quantity: HTMLInputElement } {
    const form = container.querySelector('form')!;
    return {
      select: form.querySelector<HTMLSelectElement>('select')!,
      quantity: form.querySelector<HTMLInputElement>('input')!,
    };
  }

  function setSelect(select: HTMLSelectElement, value: string): void {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  test('the Kit column marks kit rows and leaves plain rows an em-dash', async () => {
    view = await mount();
    const headers = [...view.container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toContain('Kit');

    const kitRow = [...view.container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent!.includes('GIFT-BOX'),
    )!;
    expect(kitRow.textContent).toContain('Kit · 2 components');
    const plainRow = [...view.container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent!.includes('SPICE-01'),
    )!;
    expect(plainRow.textContent).toContain('—');
  });

  test('Kit on a plain SKU: saving POSTs the composition with decimal quantities', async () => {
    view = await mount();
    await openKitForm(view.container, 'SPICE-01');

    const { select, quantity } = kitFormInputs(view.container);
    setSelect(select, 'sku-3');
    setInput(quantity, '2.5');
    submitForm(view.container);
    await settle();

    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/kit'));
    expect(post).toBeDefined();
    expect(post!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/catalog/skus/sku-1/kit`);
    expect(post!.body).toEqual({ components: [{ skuId: 'sku-3', quantity: 2.5 }] });
    // The saved banner speaks in components, never in milli.
    expect(view.container.textContent).toContain('is now a kit');
    expect(view.container.textContent).toContain('1 component makes one kit.');
  });

  test('Edit kit on a kit row: saving PUTs the replacement BOM, prefilled from the join', async () => {
    view = await mount();
    await openKitForm(view.container, 'GIFT-BOX');

    // Prefilled from the kits-list join — submit unchanged.
    const { select, quantity } = kitFormInputs(view.container);
    expect(select.value).toBe('sku-3');
    expect(quantity.value).toBe('2');
    submitForm(view.container);
    await settle();

    const put = requests.find((r) => r.method === 'PUT');
    expect(put).toBeDefined();
    expect(put!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/catalog/skus/sku-5/kit`);
    expect(put!.body).toEqual({
      components: [
        { skuId: 'sku-3', quantity: 2 },
        { skuId: 'sku-4', quantity: 1.5 },
      ],
    });
    expect(view.container.textContent).toContain('kit updated');
  });

  test('a create refused kit-already-composed switches to edit — the next submit is the PUT', async () => {
    forceKitConflict = true;
    view = await mount();
    await openKitForm(view.container, 'SPICE-01');

    const { select, quantity } = kitFormInputs(view.container);
    setSelect(select, 'sku-3');
    setInput(quantity, '2');
    submitForm(view.container);
    await settle();

    // The refusal renders with the mapped sentence…
    expect(view.container.textContent).toContain('Not saved');
    expect(view.container.textContent).toContain('This SKU is already a kit.');
    // …the create POST went out, and the form flipped to edit mode.
    expect(requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/kit'))).toBeDefined();
    const form = view.container.querySelector('form')!;
    expect(form.textContent).toContain('Editing the kit');
    expect(form.textContent).toContain('Replace composition');

    // The second submit is the replacement PUT, not another POST.
    submitForm(view.container);
    await settle();
    expect(requests.find((r) => r.method === 'PUT')).toBeDefined();
  });

  test('the component picker excludes the kit itself and every other kit', async () => {
    view = await mount();
    await openKitForm(view.container, 'GIFT-BOX');

    const options = [...view.container.querySelectorAll('select option')].map((o) => o.textContent);
    // Ordinary SKUs — including this kit's own components — are pickable.
    expect(options).toContain('PAD-01 Foam pad');
    expect(options).toContain('TAPE-01 Tape');
    expect(options).toContain('SPICE-01 Turmeric 500g');
    // Guaranteed refusals are filtered out of the picker, not validated late.
    expect(options.join(' ')).not.toContain('GIFT-BOX');
    expect(options.join(' ')).not.toContain('BOX-2');
  });

  test('an edit that lands on one component still says "kit updated" — the sentence branches on mode, not count', async () => {
    kitRows = [kit({ skuId: 'sku-6', code: 'BOX-2', components: [{ skuId: 'sku-3', code: 'PAD-01', qty: 2 }] })];
    view = await mount();
    await openKitForm(view.container, 'BOX-2');

    submitForm(view.container);
    await settle();

    const put = requests.find((r) => r.method === 'PUT');
    expect(put).toBeDefined();
    expect(view.container.textContent).toContain('kit updated');
    expect(view.container.textContent).not.toContain('is now a kit');
  });

  test('the kits join failing surfaces a banner with a working Retry, not silent unmarking', async () => {
    kitsFail = true;
    view = await mount();

    // The failed join must not read as "no kits": the banner names the
    // outage instead of letting every kit render as a plain SKU.
    expect(view.container.textContent).toContain('Kit markers unavailable');
    expect(view.container.textContent).toContain('The kits list is unavailable.');

    kitsFail = false;
    const retry = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    act(() => retry!.click());
    await settle();
    expect(view.container.textContent).not.toContain('Kit markers unavailable');
    const kitRow = [...view.container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent!.includes('GIFT-BOX'),
    )!;
    expect(kitRow.textContent).toContain('Kit · 2 components');
  });

  test('a kit-already-composed recovery whose refetch fails still gives the user feedback', async () => {
    kitsFail = true;
    forceKitConflict = true;
    view = await mount();
    await openKitForm(view.container, 'SPICE-01');

    const { select, quantity } = kitFormInputs(view.container);
    setSelect(select, 'sku-3');
    setInput(quantity, '2');
    submitForm(view.container);
    await settle();

    // The fresh-list fetch inside the recovery fails — the refusal STILL
    // renders (mapped from the original 409), the submission never vanishes.
    expect(view.container.textContent).toContain('Not saved');
    expect(view.container.textContent).toContain('This SKU is already a kit.');
  });
});
