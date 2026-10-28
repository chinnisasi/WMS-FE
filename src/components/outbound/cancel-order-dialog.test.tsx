import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { CancelOrderDialog, PutBackSection, type CancelTarget } from './cancel-order-dialog';

/**
 * Story 4-2b — the shared Cancel dialog (decision 14, A8, A9), driven
 * through a stubbed global `fetch`. It pins what a `src/lib` test cannot:
 * the plan's lines render; a labelled shipment shows the void notice; a
 * manifested one is a refusal with NO Confirm; a packed order (and a recalled
 * lot) opens on "All into one bin" and needs the bin; the recall warning;
 * changing the bin clears the Idempotency-Key while a retry of the same inputs
 * keeps it; the put-back list after success; the cancelled order's "Put back"
 * section.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000w1';
const ZONE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000z1';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function planLine(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderLineId: 'ol-1',
    skuId: 'sku-1',
    skuCode: 'TEE-M',
    skuName: 'Tee, medium',
    uom: 'each',
    fromBinId: 'bin-a',
    fromBinCode: 'A-01-01',
    batchId: 'batch-1',
    batchCode: 'LOT-1',
    qty: 2,
    serialNumbers: ['SN-1', 'SN-2'],
    recallCode: null,
    ...over,
  };
}

function bin(id: string, code: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    zoneId: ZONE_ID,
    code,
    capacity: 100,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    maxWeightGrams: null,
    storageClass: 'ambient',
    dedicatedClientId: null,
    type: 'shelf',
    blocked: false,
    retiredAt: null,
    retiredBy: null,
    systemOwned: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

let plan: Record<string, unknown>;
let cancels: { body: Record<string, unknown>; key: string | null }[] = [];
/** The next cancel answers this (default: success). */
let cancelAnswer: (() => Response) | null = null;

function successBody(): Record<string, unknown> {
  return {
    order: { id: ORDER_ID, status: 'cancelled', lines: [] },
    restock: {
      restockId: 'rs-1',
      restockedAt: '2026-10-13T08:33:00.000Z',
      destination: 'origin',
      restockBinId: null,
      lines: [
        {
          orderLineId: 'ol-1',
          skuId: 'sku-1',
          skuCode: 'TEE-M',
          skuName: 'Tee, medium',
          uom: 'each',
          toBinId: 'bin-a',
          toBinCode: 'A-01-01',
          batchId: 'batch-1',
          batchCode: 'LOT-1',
          qty: 2,
          serialCount: 2,
          recallCode: null,
        },
      ],
      totalUnits: 2,
      cancelledPickLineCount: 0,
      releasedReservationIds: [],
      retiredReservationIds: ['h-1'],
      handlingUnitIds: [],
      voidedShipment: { id: 'sh-1', carrierName: 'Delhivery', trackingNumber: 'DL123' },
    },
  };
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'GET' && pathname.endsWith(`/outbound/orders/${ORDER_ID}/restock-plan`)) return json(200, plan);
    if (method === 'POST' && pathname.endsWith(`/outbound/orders/${ORDER_ID}/cancel-with-restock`)) {
      cancels.push({ body: (await request.json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') });
      return cancelAnswer === null ? json(200, successBody()) : cancelAnswer();
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, { items: [{ id: 'sku-1', code: 'TEE-M', name: 'Tee, medium', uom: 'each', uomPrecision: 0 }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith(`/warehouses/${WAREHOUSE_ID}/zones`)) {
      return json(200, { items: [{ id: ZONE_ID, code: 'Z1' }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith(`/zones/${ZONE_ID}/bins`)) {
      return json(200, {
        items: [
          bin('bin-b', 'B-02'),
          bin('bin-sys', 'RECEIVING', { systemOwned: true }),
          bin('bin-a', 'A-01'),
          bin('bin-old', 'Z-99', { retiredAt: '2026-01-01T00:00:00.000Z' }),
        ],
        nextCursor: null,
      });
    }
    return json(404, { code: 'not-found', status: 404, title: 'Not found' });
  }) as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  writeSession(SESSION);
  cancels = [];
  cancelAnswer = null;
  plan = { orderId: ORDER_ID, orderStatus: 'accepted', shipment: null, lines: [planLine()], restocked: [] };
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(status: CancelTarget['status'] = 'accepted'): Promise<HTMLElement> {
  view = render(
    <CancelOrderDialog
      tenantId={TENANT_ID}
      warehouseId={WAREHOUSE_ID}
      order={{ id: ORDER_ID, label: 'SO-1', status }}
      onClose={() => {}}
    />,
  );
  await settle();
  return view.container;
}

function radio(container: HTMLElement, value: 'origin' | 'bin'): HTMLInputElement {
  return container.querySelector(`input[type="radio"][value="${value}"]`) as HTMLInputElement;
}

function confirmButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector('button[type="submit"]');
}

async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form')!;
  act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

function setSelect(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('CancelOrderDialog', () => {
  test('renders the plan lines — SKU, quantity, origin bin, batch and the serials to scan back', async () => {
    const container = await mount();
    const rows = container.querySelectorAll('[data-testid="restock-plan-line"]');
    expect(rows.length).toBe(1);
    const text = rows[0]!.textContent ?? '';
    expect(text).toContain('TEE-M');
    expect(text).toContain('2 each');
    expect(text).toContain('A-01-01');
    expect(text).toContain('LOT-1');
    expect(text).toContain('SN-1, SN-2');
    expect(container.querySelector('[data-testid="restock-booking-window"]')?.textContent).toBe(
      'Stock is booked into these bins now and can be allocated to new picks straight away — put the units back before the bins are picked or counted.',
    );
    // An accepted order goes back to its origin bins by default.
    expect(radio(container, 'origin').checked).toBe(true);
    expect(container.querySelector('[data-testid="restock-void-notice"]')).toBeNull();
  });

  test('a labelled shipment shows the void notice', async () => {
    plan = { ...plan, shipment: { id: 'sh-1', status: 'labelled', carrierName: 'Delhivery', trackingNumber: 'DL123', manifestId: null } };
    const container = await mount();
    expect(container.querySelector('[data-testid="restock-void-notice"]')?.textContent).toBe('The label Delhivery DL123 will be voided.');
    expect(confirmButton(container)).not.toBeNull();
  });

  test('a manifested shipment is a refusal with no Confirm', async () => {
    plan = {
      ...plan,
      orderStatus: 'ready_to_dispatch',
      shipment: { id: 'sh-1', status: 'manifested', carrierName: 'Delhivery', trackingNumber: 'DL123', manifestId: 'mf-1' },
    };
    const container = await mount('ready_to_dispatch');
    const refusal = container.querySelector('[data-testid="restock-manifested"]');
    expect(refusal?.textContent).toContain('Delhivery DL123');
    expect(refusal?.textContent).toContain('return');
    expect(confirmButton(container)).toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });

  test('a packed order opens on "All into one bin" and needs the bin before Confirm', async () => {
    plan = { ...plan, orderStatus: 'ready_to_dispatch' };
    const container = await mount('ready_to_dispatch');
    expect(radio(container, 'bin').checked).toBe(true);
    expect(confirmButton(container)!.disabled).toBe(true);
    const select = container.querySelector('select') as HTMLSelectElement;
    // Storage bins only — no system bin, no retired one — by code.
    expect([...select.options].map((o) => o.textContent)).toEqual(['Pick a bin…', 'A-01', 'B-02']);
    setSelect(select, 'bin-b');
    expect(confirmButton(container)!.disabled).toBe(false);
    await submit(container);
    expect(cancels.length).toBe(1);
    expect(cancels[0]!.body).toEqual({ restockBinId: 'bin-b' });
  });

  test('a recalled lot warns and opens on one bin, even on an accepted order', async () => {
    plan = { ...plan, lines: [planLine({ recallCode: 'RCL-3' })] };
    const container = await mount();
    expect(container.textContent).toContain(
      'Lot LOT-1 is under recall RCL-3 — its units stay blocked wherever they are put back; choose a bin set aside for held stock, because a pick from a bin holding a recalled lot is refused.',
    );
    expect(radio(container, 'bin').checked).toBe(true);
    expect(confirmButton(container)!.disabled).toBe(true);
  });

  test('a retry of the same inputs keeps the key; changing the bin or the destination mints a new one', async () => {
    plan = { ...plan, orderStatus: 'ready_to_dispatch' };
    cancelAnswer = () => json(409, { code: 'bin-full', status: 409, title: 'Bin full', detail: 'Bin B-02 is full' });
    const container = await mount('ready_to_dispatch');
    const select = container.querySelector('select') as HTMLSelectElement;
    setSelect(select, 'bin-b');
    await submit(container);
    expect(container.textContent).toContain('Bin full — Bin B-02 is full');
    await submit(container);
    expect(cancels.length).toBe(2);
    expect(cancels[1]!.key).toBe(cancels[0]!.key);

    setSelect(container.querySelector('select') as HTMLSelectElement, 'bin-a');
    await submit(container);
    expect(cancels[2]!.body).toEqual({ restockBinId: 'bin-a' });
    expect(cancels[2]!.key).not.toBe(cancels[1]!.key);

    act(() => radio(container, 'origin').click());
    cancelAnswer = null;
    await submit(container);
    expect(cancels[3]!.body).toEqual({});
    expect(cancels[3]!.key).not.toBe(cancels[2]!.key);
    expect(cancels.every((c) => typeof c.key === 'string' && c.key.length === 26)).toBe(true);
  });

  test('nothing is sent (and no key minted) before the inputs parse', async () => {
    plan = { ...plan, orderStatus: 'ready_to_dispatch' };
    const container = await mount('ready_to_dispatch');
    await submit(container);
    expect(cancels.length).toBe(0);
  });

  test('a refusal re-reads the plan: a shipment manifested meanwhile becomes the refusal, with no Confirm', async () => {
    plan = { ...plan, shipment: { id: 'sh-1', status: 'labelled', carrierName: 'Delhivery', trackingNumber: 'DL123', manifestId: null } };
    const container = await mount();
    expect(container.querySelector('[data-testid="restock-void-notice"]')).not.toBeNull();
    cancelAnswer = () => {
      // The manifest landed between the dialog's read and the confirm.
      plan = { ...plan, shipment: { id: 'sh-1', status: 'manifested', carrierName: 'Delhivery', trackingNumber: 'DL123', manifestId: 'mf-1' } };
      return json(409, {
        code: 'shipment-manifested',
        status: 409,
        title: 'Shipment manifested',
        detail: 'Delhivery DL123 is on manifest MF-1 — receive it as a return.',
        manifestId: 'mf-1',
        shipmentId: 'sh-1',
      });
    };
    await submit(container);
    expect(cancels.length).toBe(1);
    expect(container.querySelector('[data-testid="restock-manifested"]')).not.toBeNull();
    expect(confirmButton(container)).toBeNull();
  });

  test('a replayed no-op after a lost response still names where the units went', async () => {
    cancelAnswer = () => {
      // The first attempt committed; this retry (a new key) finds the order cancelled.
      plan = {
        orderId: ORDER_ID,
        orderStatus: 'cancelled',
        shipment: null,
        lines: [],
        restocked: [
          {
            orderLineId: 'ol-1',
            skuId: 'sku-1',
            skuCode: 'TEE-M',
            skuName: 'Tee, medium',
            uom: 'each',
            toBinId: 'bin-b',
            toBinCode: 'B-02',
            batchId: 'batch-1',
            batchCode: 'LOT-1',
            qty: 2,
            serialCount: 2,
            restockedAt: '2026-10-13T08:33:00.000Z',
            restockId: 'rs-1',
            recallCode: null,
          },
        ],
      };
      return json(200, { order: { id: ORDER_ID, status: 'cancelled', lines: [] }, restock: null });
    };
    const container = await mount();
    await submit(container);
    const result = container.querySelector('[data-testid="cancel-order-result"]')!;
    expect(result.textContent).toContain('This order was already cancelled — its units were put back here:');
    expect(result.textContent).not.toContain('nothing changed');
    expect(container.querySelector('[data-testid="put-back-line"]')?.textContent).toContain('TEE-M × 2 each → B-02 (LOT-1)');
  });

  test('a no-op with nothing restocked says nothing changed', async () => {
    cancelAnswer = () => {
      plan = { orderId: ORDER_ID, orderStatus: 'cancelled', shipment: null, lines: [], restocked: [] };
      return json(200, { order: { id: ORDER_ID, status: 'cancelled', lines: [] }, restock: null });
    };
    const container = await mount();
    await submit(container);
    expect(container.querySelector('[data-testid="cancel-order-result"]')?.textContent).toContain('It was already cancelled — nothing changed.');
    expect(container.querySelector('[data-testid="put-back-line"]')).toBeNull();
  });

  test('after success: the put-back list from the response and the voided label, then Close', async () => {
    const container = await mount();
    await submit(container);
    expect(cancels[0]!.body).toEqual({});
    const result = container.querySelector('[data-testid="cancel-order-result"]');
    expect(result).not.toBeNull();
    expect(result!.textContent).toContain('Order SO-1 cancelled');
    const putBack = [...container.querySelectorAll('[data-testid="put-back-line"]')].map((li) => li.textContent ?? '');
    expect(putBack.length).toBe(1);
    expect(putBack[0]).toContain('TEE-M × 2 each → A-01-01 (LOT-1)');
    expect(putBack[0]).toContain('2 serials');
    expect(container.querySelector('[data-testid="restock-voided-label"]')?.textContent).toContain('DL123');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Close')).toBe(true);
    expect(confirmButton(container)).toBeNull();
  });
});

describe('PutBackSection', () => {
  test('a cancelled order shows what the cancel put back, per bin', async () => {
    plan = {
      orderId: ORDER_ID,
      orderStatus: 'cancelled',
      shipment: null,
      lines: [],
      restocked: [
        {
          orderLineId: 'ol-1',
          skuId: 'sku-1',
          skuCode: 'TEE-M',
          skuName: 'Tee, medium',
          uom: 'each',
          toBinId: 'bin-b',
          toBinCode: 'B-02',
          batchId: null,
          batchCode: null,
          qty: 3,
          serialCount: 0,
          restockedAt: '2026-10-13T08:33:00.000Z',
          restockId: 'rs-1',
          recallCode: null,
        },
      ],
    };
    view = render(<PutBackSection orderId={ORDER_ID} />);
    await settle();
    const section = view.container.querySelector('[data-testid="put-back-section"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Put back');
    expect(section!.textContent).toContain('TEE-M × 3 each → B-02');
  });

  test('renders nothing when the cancel restocked nothing', async () => {
    plan = { orderId: ORDER_ID, orderStatus: 'cancelled', shipment: null, lines: [], restocked: [] };
    view = render(<PutBackSection orderId={ORDER_ID} />);
    await settle();
    expect(view.container.querySelector('[data-testid="put-back-section"]')).toBeNull();
  });
});
