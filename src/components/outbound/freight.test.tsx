import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import type { FreightLoadViewDto } from '../../lib/api/generated';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { consignment, load } from '../../lib/test/freight-fixtures';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { FreightLoadsCard } from './freight-loads-card';

/**
 * Story 4-9a (A30) — the Freight tab driven through a stubbed `fetch` (guide
 * §8): New load hidden without `dispatch.execute`, a load opens in its drawer,
 * the departure posts the body it shows under a key and marks a refused row
 * keeping the draft, a web scan posts a load, the delivery amendment is
 * offered only to an office role, and a read-only role is offered no write.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const LOAD_ID = '0198f7a2-1b3c-7d4e-8f90-00000000a001';

function session(role: StoredSession['user']['role']): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
    user: { id: 'u-1', email: 'ops@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly key: string | null;
  readonly body: unknown;
}

let requests: Recorded[] = [];
let detail: FreightLoadViewDto = load({ id: LOAD_ID });
let postReplies: Record<string, { status: number; body: unknown }> = {};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function listRow(view: FreightLoadViewDto) {
  return {
    id: view.id,
    code: view.code,
    status: view.status,
    mode: view.mode,
    transporterName: view.transporter.name,
    vehicleNumber: view.vehicle.number,
    dockDoor: view.dockDoor,
    consignmentCount: view.consignments.length,
    clientCodes: ['ACME', 'GLOW'],
    clientMore: 0,
    packages: { consignmentId: '', loaded: view.totals.loaded, total: view.totals.packages },
    palletCount: view.totals.pallets,
    grossWeightGrams: view.totals.grossWeightGrams,
    capacityKg: view.vehicle.capacityKg,
    dispatchedAt: view.dispatchedAt,
    deliveredCount: 0,
    createdAt: view.createdAt,
  };
}

beforeEach(() => {
  requests = [];
  detail = load({ id: LOAD_ID });
  postReplies = {};
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://localhost/outbound?tab=freight');
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    if (method !== 'GET') {
      const raw = await request.text();
      body = raw === '' ? null : (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      })();
    }
    requests.push({ method, pathname: url.pathname, key: request.headers.get('Idempotency-Key'), body });
    if (method === 'POST') {
      const suffix = Object.keys(postReplies).find((k) => url.pathname.endsWith(k));
      if (suffix !== undefined) return json(postReplies[suffix]!.status, postReplies[suffix]!.body);
      return json(503, { code: 'unavailable', status: 503, title: 'Unrouted POST' });
    }
    if (url.pathname.endsWith('/outbound/freight-loads')) return json(200, { items: [listRow(detail)], nextCursor: null });
    if (url.pathname.endsWith(`/outbound/freight-loads/${LOAD_ID}`)) return json(200, detail);
    if (url.pathname.endsWith(`/tenants/${TENANT_ID}/clients`)) return json(200, { items: [], nextCursor: null });
    return json(404, { code: 'not-found', status: 404, title: 'Unrouted in this test' });
  }) as unknown as typeof fetch);
});

let view: Rendered | undefined;

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function click(element: Element): Promise<void> {
  await act(async () => void element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await settle();
}

function byTestId<T extends Element = HTMLElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`[data-testid="${id}"]`);
}

function setValue(element: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

async function mount(role: StoredSession['user']['role']): Promise<void> {
  writeSession(session(role));
  view = render(<FreightLoadsCard tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role={role} />);
  await settle();
}

async function openLoad(): Promise<HTMLElement> {
  await click(byTestId(view!.container, 'open-load-LD-0001')!);
  const drawer = byTestId(document.body, 'freight-load-detail');
  expect(drawer).not.toBeNull();
  return drawer!;
}

const KEY_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('the Freight tab (story 4-9a)', () => {
  test('the list reads the open view; the row says the progress word first', async () => {
    await mount('operator');
    const list = requests.find((r) => r.pathname.endsWith('/outbound/freight-loads'))!;
    expect(list.method).toBe('GET');
    expect(view!.container.textContent).toContain('21 of 21 loaded');
    expect(view!.container.textContent).toContain('ACME, GLOW');
    expect(byTestId(view!.container, 'new-freight-load')).not.toBeNull();
  });

  test('a role without dispatch.execute reads everything and is offered no write', async () => {
    await mount('accountant');
    expect(byTestId(view!.container, 'new-freight-load')).toBeNull();
    const drawer = await openLoad();
    expect(byTestId(drawer, 'dispatch-freight-load')).toBeNull();
    expect(byTestId(drawer, 'freight-scan')).toBeNull();
    expect(byTestId(drawer, 'print-loading-sheet')).not.toBeNull();
    expect(window.location.search).toContain(`open=${LOAD_ID}`);
  });

  test('Dispatch sends the body it shows under a key; a refused row is marked and the draft kept', async () => {
    postReplies = {
      '/dispatch': {
        status: 409,
        body: { type: 'about:blank', title: 'x', status: 409, code: 'freight-orders-refused', detail: 'd', orders: [{ orderId: 'o-3', code: 'consignment-documents-missing' }] },
      },
    };
    await mount('operator');
    const drawer = await openLoad();
    await click(byTestId(drawer, 'dispatch-freight-load')!);
    const dialog = byTestId<HTMLFormElement>(drawer, 'freight-dispatch-dialog')!;
    setValue(dialog.querySelector('input[aria-label="Seal number"]') as HTMLInputElement, 's-991');
    await click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Add seal')!);
    await submit(dialog);
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith(`/freight-loads/${LOAD_ID}/dispatch`))!;
    expect(post.key).toMatch(KEY_RE);
    expect(post.body).toEqual({
      vehicleNumber: 'KA01AB1234',
      vehicleType: 'hcv',
      driverName: 'Ravi',
      driverPhone: '9876543210',
      seals: ['S-991'],
      consignments: [
        { orderId: 'o-1', decision: 'dispatch' },
        { orderId: 'o-3', decision: 'dispatch' },
      ],
    });
    const refused = byTestId(byTestId(drawer, 'dispatch-row-SO-3')!, 'dispatch-row-refusal');
    expect(refused?.textContent).toBe('Invoice not recorded — record it first');
    // The draft is kept: a retry of the unchanged body replays the same key.
    await submit(byTestId<HTMLFormElement>(drawer, 'freight-dispatch-dialog')!);
    const posts = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/dispatch'));
    expect(posts).toHaveLength(2);
    expect(posts[1]!.key).toBe(posts[0]!.key);
  });

  test('a web scan posts a load of the scanned code', async () => {
    postReplies = {
      '/scans': { status: 201, body: { scan: { packageCode: 'O8FE5145B99902272.1.3', orderId: 'o-1', status: 'loaded' }, alreadyLoaded: false, progress: { consignmentId: 'c-1', loaded: 3, total: 15 } } },
    };
    await mount('operator');
    const drawer = await openLoad();
    const field = byTestId<HTMLInputElement>(drawer, 'freight-scan')!;
    setValue(field, 'o8fe5145b99902272.1.3');
    await submit(field.form!);
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/scans'))!;
    expect(post.body).toEqual({ packageCode: 'O8FE5145B99902272.1.3', action: 'load' });
    expect(post.key).toMatch(KEY_RE);
    expect(drawer.textContent).toContain('SO-1: 3 of 15 loaded.');
    expect(field.value).toBe('');
  });

  test('a recorded delivery is amended only by an office role', async () => {
    const delivered = consignment({
      status: 'dispatched',
      dispatchedAt: '2026-10-30T10:35:00.000Z',
      delivery: { outcome: 'delivered', deliveredAt: '2026-11-02T05:50:00.000Z', receiverName: null, short: null, damaged: null, note: null, deliverySeq: 1, recordedAt: null, recordedBy: null },
    });
    detail = load({ id: LOAD_ID, status: 'dispatched', dispatchedAt: '2026-10-30T10:35:00.000Z', consignments: [delivered] });
    await mount('operator');
    let drawer = await openLoad();
    expect(byTestId(drawer, 'record-delivery-SO-1')).toBeNull();
    expect(byTestId(drawer, 'print-note-SO-1')).not.toBeNull();
    view!.unmount();
    view = undefined;
    await mount('ops_manager');
    drawer = await openLoad();
    expect(byTestId(drawer, 'record-delivery-SO-1')?.textContent).toBe('Amend delivery');
  });
});

describe('the Freight tab — review fixes (story 4-9a)', () => {
  const left = () =>
    load({
      id: LOAD_ID,
      status: 'dispatched',
      dispatchedAt: '2026-10-01T04:00:00.000Z',
      consignments: [consignment({ status: 'dispatched', dispatchedAt: '2026-10-01T04:00:00.000Z' })],
    });

  function setInput(element: HTMLInputElement, value: string): void {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  test('Record delivery posts the body under a key; a failed POD retries the upload only', async () => {
    detail = left();
    postReplies = {
      '/delivery': { status: 201, body: { consignment: { id: 'c-1', orderId: 'o-1', loadId: LOAD_ID, status: 'dispatched', consignmentRef: 'LD-0001/01', lr: { number: null, date: null, terms: null }, delivery: null } } },
      '/documents': { status: 503, body: { code: 'file-storage-unavailable', status: 503, title: 'Down' } },
    };
    await mount('operator');
    const drawer = await openLoad();
    await click(byTestId(drawer, 'record-delivery-SO-1')!);
    const dialog = byTestId<HTMLFormElement>(drawer, 'freight-delivery-dialog')!;
    await click(dialog.querySelectorAll('input[type="radio"]')[0]!);
    setInput(dialog.querySelector('input[type="datetime-local"]') as HTMLInputElement, '2026-10-02T11:20');
    const file = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(file, 'files', { value: [new File(['%PDF-1.7 pod'], 'pod.pdf', { type: 'application/pdf' })] });
    await act(async () => void file.dispatchEvent(new Event('change', { bubbles: true })));
    await settle();
    await submit(dialog);
    const delivery = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/delivery'));
    expect(delivery).toHaveLength(1);
    expect(delivery[0]!.key).toMatch(KEY_RE);
    expect(delivery[0]!.body).toEqual({ outcome: 'delivered', deliveredAt: '2026-10-02T05:50:00.000Z' });
    expect(requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/documents'))).toHaveLength(1);
    expect(byTestId(drawer, 'confirm-delivery')?.textContent).toBe('Retry the POD upload');
    await submit(byTestId<HTMLFormElement>(drawer, 'freight-delivery-dialog')!);
    expect(requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/delivery'))).toHaveLength(1);
    expect(requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/documents'))).toHaveLength(2);
  });

  test('Reorder stops posts the new stop order and shows the loading order', async () => {
    postReplies = { '/stops': { status: 200, body: { load: detail } } };
    await mount('operator');
    const drawer = await openLoad();
    await click([...drawer.querySelectorAll('button')].find((b) => b.textContent === 'Reorder stops')!);
    await click(drawer.querySelector('button[aria-label="Move SO-3 up"]')!);
    expect(byTestId(drawer, 'loading-order')?.textContent).toContain('last stop first: SO-1, SO-3');
    await click([...drawer.querySelectorAll('button')].find((b) => b.textContent === 'Save stops')!);
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/stops'))!;
    expect(post.body).toEqual({ orderIds: ['o-3', 'o-1'] });
    expect(post.key).toMatch(KEY_RE);
  });

  test('a members change re-reads the load, rebases the rows and keeps the vehicle fields', async () => {
    postReplies = { '/dispatch': { status: 409, body: { type: 'about:blank', title: 'x', status: 409, code: 'freight-members-changed', detail: 'd', orderIds: [] } } };
    await mount('operator');
    const drawer = await openLoad();
    await click(byTestId(drawer, 'dispatch-freight-load')!);
    const dialog = byTestId<HTMLFormElement>(drawer, 'freight-dispatch-dialog')!;
    const driver = [...dialog.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Driver’s name'))!.querySelector('input') as HTMLInputElement;
    setInput(driver, 'Suresh');
    detail = load({ id: LOAD_ID, consignments: [...load().consignments, consignment({ id: 'c-9', orderId: 'o-9', orderLabel: 'SO-9', stopSeq: 3 })] });
    await submit(dialog);
    expect(byTestId(drawer, 'dispatch-row-SO-9')).not.toBeNull();
    const after = [...byTestId(drawer, 'freight-dispatch-dialog')!.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Driver’s name'))!.querySelector('input') as HTMLInputElement;
    expect(after.value).toBe('Suresh');
  });

  test('wedge scans are queued, none dropped; an unreadable code is refused with no request', async () => {
    postReplies = {
      '/scans': { status: 201, body: { scan: { packageCode: 'X', orderId: 'o-1', status: 'loaded' }, alreadyLoaded: false, progress: { consignmentId: 'c-1', loaded: 15, total: 15 } } },
    };
    await mount('operator');
    const drawer = await openLoad();
    const field = byTestId<HTMLInputElement>(drawer, 'freight-scan')!;
    await act(async () => {
      for (const code of ['O8FE5145B99902272.1.1', 'O8FE5145B99902272.1.2']) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, code);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });
    await settle();
    const scans = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/scans'));
    expect(scans.map((r) => (r.body as { packageCode: string }).packageCode)).toEqual(['O8FE5145B99902272.1.1', 'O8FE5145B99902272.1.2']);
    setValue(field, 'HELLO');
    await submit(field.form!);
    expect(requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/scans'))).toHaveLength(2);
    expect(drawer.textContent).toContain('This is not a package label');
  });
});
