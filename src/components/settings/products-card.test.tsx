import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ProductsCard } from './products-card';

/**
 * The products card's variant surface (story 11-6). The claims a `src/lib`
 * test cannot make:
 *   1. a product row expands to a labelled variant matrix naming both
 *      attached SKUs with their axis values (UX-DR28's one-expanding-row),
 *      through surface-owned aria-expanded/aria-controls,
 *   2. an attach that would duplicate another variant's values is refused
 *      BY NAME inline (the server's detail rendered in the row),
 *   3. an empty product renders "no variants" and offers the attach CTA,
 *   4. a role without `sku.edit` reads everything and is offered no
 *      mutating affordance at all,
 *   5. pressing Save on the create form sends the POST with the parsed axes.
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
  readonly query: string;
  readonly body: unknown;
}

let requests: Recorded[] = [];
let productRows: Record<string, unknown>[] = [];
let skuRows: Record<string, unknown>[] = [];
/** The products list's nextCursor, so a test can offer a second page. */
let productsNextCursor: unknown = null;
/** The next PATCH answer, so a test can force a refusal or an echo. */
let nextSkuPatchStatus = 200;
let nextSkuPatchBody: unknown = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function product(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prod-1',
    tenantId: TENANT_ID,
    name: 'T-Shirts',
    axes: ['size', 'colour'],
    skuCount: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function sku(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sku-1',
    tenantId: TENANT_ID,
    code: 'TEE-M-RED',
    name: 'Tee M Red',
    uom: 'each',
    uomPrecision: 0,
    gstRateBps: 1800,
    hsn: null,
    batchTracked: false,
    serialTracked: false,
    catchWeightTracked: false,
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    countryOfOrigin: null,
    reorderPoint: 0,
    reorderQty: 0,
    productId: 'prod-1',
    variantValues: { size: 'M', colour: 'Red' },
    barcode: 'BC-1',
    uomConversions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function stubRouter(role: string = 'owner'): void {
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
    requests.push({ method, pathname, query: url.search, body });
    if (method === 'GET' && pathname.endsWith('/catalog/products')) {
      return json(200, { items: productRows, nextCursor: productsNextCursor });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      const productId = url.searchParams.get('productId');
      const items =
        productId === null ? skuRows : skuRows.filter((s) => (s as { productId?: string }).productId === productId);
      return json(200, { items, nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/kits')) {
      return json(200, { items: [], nextCursor: null });
    }
    if (method === 'POST' && pathname.endsWith('/catalog/products')) {
      return json(201, product({ id: 'prod-2', name: 'Mugs', axes: ['size'], skuCount: 0 }));
    }
    if (method === 'PATCH' && /\/catalog\/skus\/[^/]+$/.test(pathname)) {
      return json(nextSkuPatchStatus, nextSkuPatchBody ?? sku());
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
  void role;
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextSkuPatchStatus = 200;
  nextSkuPatchBody = null;
  productsNextCursor = null;
  productRows = [
    product(),
    product({ id: 'prod-empty', name: 'Mugs', axes: ['size'], skuCount: 0 }),
  ];
  skuRows = [
    sku(),
    sku({ id: 'sku-2', code: 'TEE-L-BLUE', productId: 'prod-1', variantValues: { size: 'L', colour: 'Blue' }, barcode: 'BC-2' }),
    sku({ id: 'sku-3', code: 'UNATT-01', name: 'Unattached', productId: null, variantValues: null, barcode: 'BC-3' }),
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

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(): Promise<Rendered> {
  const rendered = render(<ProductsCard />);
  await settle();
  return rendered;
}

async function expandProduct(container: HTMLElement, name: string): Promise<void> {
  const toggle = [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-expanded') !== null && b.textContent!.includes(name),
  );
  expect(toggle).toBeDefined();
  act(() => toggle!.click());
  await settle();
}

describe('ProductsCard: the variant matrix (story 11-6)', () => {
  test('expanding a product shows its attached variants with their axis values', async () => {
    view = await mount();
    const matrix = view.container.querySelector('[role="region"][aria-label="Variants for T-Shirts"]');
    expect(matrix).toBeNull(); // not expanded yet

    await expandProduct(view.container, 'T-Shirts');

    const region = view.container.querySelector('[role="region"][aria-label="Variants for T-Shirts"]');
    expect(region).not.toBeNull();
    const rows = region!.textContent!;
    expect(rows).toContain('TEE-M-RED');
    expect(rows).toContain('size: M · colour: Red');
    expect(rows).toContain('TEE-L-BLUE');
    expect(rows).toContain('size: L · colour: Blue');
    expect(rows).toContain('BC-1');
  });

  test('the disclosure owns aria-expanded and aria-controls, agreeing with the panel id', async () => {
    view = await mount();
    const toggle = [...view.container.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-expanded') !== null,
    );
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle!.click());
    await settle();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    const panelId = toggle!.getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    expect(view.container.querySelector(`#${panelId}`)).not.toBeNull();
  });

  test('an empty product offers the attach CTA, and attaching sends the SKU PATCH', async () => {
    view = await mount();
    await expandProduct(view.container, 'Mugs');

    const region = view.container.querySelector('[role="region"][aria-label="Variants for Mugs"]')!;
    expect(region.textContent).toContain('No variants attached');
    const attach = [...region.querySelectorAll('button')].find((b) => b.textContent === 'Attach variant');
    expect(attach).not.toBeNull();
    act(() => attach!.click());
    await settle();

    // Pick the unattached SKU and fill the single axis.
    const form = region.querySelector('form')!;
    const select = form.querySelector<HTMLSelectElement>('select')!;
    const sizeInput = form.querySelector<HTMLInputElement>('input')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'sku-3');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sizeInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    setInput(sizeInput, 'M');
    act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();

    const patch = requests.find((r) => r.method === 'PATCH' && r.pathname.includes('/catalog/skus/'));
    expect(patch).toBeDefined();
    expect(patch!.body).toEqual({
      productId: 'prod-empty',
      variantValues: { size: 'M' },
    });
  });

  test('an attach refused with duplicate-variant-values renders the server verbatim inline', async () => {
    nextSkuPatchStatus = 409;
    nextSkuPatchBody = {
      code: 'duplicate-variant-values',
      title: 'Duplicate variant values',
      status: 409,
      detail: 'SKU "TEE-M-RED" already carries size: M · colour: Red.',
    };
    view = await mount();
    await expandProduct(view.container, 'T-Shirts');

    const region = view.container.querySelector('[role="region"][aria-label="Variants for T-Shirts"]')!;
    const attach = [...region.querySelectorAll('button')].find((b) => b.textContent === 'Attach variant');
    act(() => attach!.click());
    await settle();

    const form = region.querySelector('form')!;
    const select = form.querySelector<HTMLSelectElement>('select')!;
    const size = [...form.querySelectorAll('label')]
      .find((label) => label.textContent!.includes('size'))!
      .querySelector<HTMLInputElement>('input')!;
    act(() => {
      const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      selectSetter.call(select, 'sku-3');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    setInput(size, 'M');
    setInput(colourInput(form), 'Red');
    act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();

    const alert = region.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('SKU "TEE-M-RED" already carries size: M · colour: Red.');
  });

  test('a variant-matrix read failure renders inline on the row with a Retry', async () => {
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      const url = new URL(request.url);
      if (request.method === 'GET' && url.searchParams.has('productId')) {
        return json(500, { code: 'boom', title: 'Boom', status: 500, detail: 'variant list broke' });
      }
      if (request.method === 'GET' && url.pathname.endsWith('/catalog/products')) {
        return json(200, { items: productRows, nextCursor: null });
      }
      if (request.method === 'GET' && url.pathname.endsWith('/catalog/skus')) {
        return json(200, { items: skuRows, nextCursor: null });
      }
      return json(404, { code: 'not-found', title: 'Unrouted', status: 404 });
    }) as unknown as typeof fetch);
    view = await mount();
    await expandProduct(view.container, 'T-Shirts');

    const region = view.container.querySelector('[role="region"][aria-label="Variants for T-Shirts"]')!;
    expect(region.querySelector('[role="alert"]')!.textContent).toContain('variant list broke');
    const retry = [...region.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).not.toBeNull();
  });

  test('the create form sends the product POST with its axes', async () => {
    view = await mount();
    const newProduct = [...view.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'New product',
    )!;
    act(() => newProduct.click());
    await settle();

    const form = view.container.querySelector('form')!;
    const inputs = [...form.querySelectorAll('input')];
    setInput(inputs[0]!, 'Mugs');
    setInput(inputs[1]!, 'size, colour');
    act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();

    const post = requests.find((r) => r.method === 'POST');
    expect(post).toBeDefined();
    expect(post!.body).toEqual({ name: 'Mugs', axes: ['size', 'colour'] });
    expect(post!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/catalog/products`);
  });

  test('a role without sku.edit reads everything and is offered no mutating affordance', async () => {
    writeSession({ ...SESSION, user: { ...SESSION.user, role: 'operator' } });
    view = await mount();
    await expandProduct(view.container, 'T-Shirts');

    const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('New product');
    expect(labels).not.toContain('Attach variant');
    expect(labels).not.toContain('Detach');
    // The read side still renders.
    expect(view.container.textContent).toContain('TEE-M-RED');
    expect(view.container.textContent).toContain('size: M · colour: Red');
  });

  test('the attach picker offers UNATTACHED SKUs only — a SKU of another product is not silently moved', async () => {
    skuRows = [
      ...skuRows,
      // Attached to a DIFFERENT product: offering it would let the PATCH
      // move it off that product silently (the server's attach arm has no
      // current-attachment guard).
      sku({ id: 'sku-7', code: 'TEE-OTHER', name: 'Attached elsewhere', productId: 'prod-other', variantValues: { size: 'S' }, barcode: 'BC-7' }),
    ];
    view = await mount();
    await expandProduct(view.container, 'Mugs');

    const region = view.container.querySelector('[role="region"][aria-label="Variants for Mugs"]')!;
    const attach = [...region.querySelectorAll('button')].find((b) => b.textContent === 'Attach variant');
    act(() => attach!.click());
    await settle();

    const options = [...region.querySelectorAll('select option')].map((o) => o.textContent);
    // The unattached SKU is pickable; the SKU belonging to another product
    // is filtered out, not offered as a silent move.
    expect(options.join(' ')).toContain('UNATT-01');
    expect(options.join(' ')).not.toContain('TEE-OTHER');
  });

  test('a zero-SKU catalog says so at the attach CTA, not "Every SKU already carries a variant"', async () => {
    skuRows = [];
    view = await mount();
    await expandProduct(view.container, 'Mugs');

    const region = view.container.querySelector('[role="region"][aria-label="Variants for Mugs"]')!;
    expect(region.textContent).toContain('No SKUs yet');
    expect(region.textContent).not.toContain('Every SKU already carries');
  });

  test('a non-null nextCursor wires the Next button to a refetch carrying the cursor', async () => {
    productsNextCursor = 'cur-2';
    view = await mount();

    const next = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Next')!;
    expect(next.disabled).toBe(false);
    act(() => next.click());
    await settle();
    productsNextCursor = null;
    await settle();

    const productGets = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/catalog/products'));
    expect(productGets.length).toBeGreaterThanOrEqual(2);
    expect(productGets[1]!.query).toContain('cursor=cur-2');
  });
});

function colourInput(form: ParentNode): HTMLInputElement {
  return [...form.querySelectorAll('label')]
    .find((label) => label.textContent!.includes('colour'))!
    .querySelector<HTMLInputElement>('input')!;
}