import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../../lib/test/globals';
import { render, type Rendered } from '../../../lib/test/render';
import { InventoryScreen } from '../inventory-screen';

/**
 * Story 3-7a — Inventory → Recalls, driven through a stubbed `fetch`
 * (frontend guide §8): the list (MOCK, status chips), the open flow (the
 * candidates checklist pre-ticks EXACT matches only, labels similar codes,
 * refuses a lot already on a live recall; the POST carries the draft's key
 * and body), the detail (figures live beside at close, held orders, the
 * report), the close rules (an override the moment a ticked lot still has
 * stock — refused in the browser without it), a role without `qc.manage`
 * offered nothing, and a `?recall=` code resolved to its recall.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const CLIENT = '0198f7a2-1b3c-7d4e-8f90-cccccccccc01';
const CLIENT_B = '0198f7a2-1b3c-7d4e-8f90-cccccccccc02';
const R1 = '0198f7a2-1b3c-7d4e-8f90-0000000003a1';
const R2 = '0198f7a2-1b3c-7d4e-8f90-0000000003a2';
const B_EXACT = '0198f7a2-1b3c-7d4e-8f90-00000000d001';
const B_SIMILAR = '0198f7a2-1b3c-7d4e-8f90-00000000d002';
const B_ON_LIVE = '0198f7a2-1b3c-7d4e-8f90-00000000d003';
const B_STOCK = '0198f7a2-1b3c-7d4e-8f90-00000000d004';

const NOW = Date.parse('2026-10-28T10:00:00.000Z');

function session(role = 'owner'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Three PL Co', gstin: null },
    user: { id: 'u-1', email: 'owner@example.com', role, status: 'active' },
    expiresAt: NOW + 10 * 365 * 86_400_000,
  } as StoredSession;
}

const ZERO = { received: 0, receivedDamaged: 0, onHand: 0, inTransit: 0, heldInOpenOrders: 0, dispatched: 0, returned: 0, returnScrapped: 0, adjustedOut: 0, unaccounted: 0 };

const LIST = [
  { id: R1, code: 'RCL-000001', clientId: CLIENT, clientCode: 'ACME', mode: 'live', status: 'open', reasonNote: 'Allergen mislabel', externalRef: 'BR-77', openedAt: '2026-10-27T05:00:00.000Z', closedAt: null, lotCount: 2 },
  { id: R2, code: 'RCL-000002', clientId: CLIENT, clientCode: 'ACME', mode: 'mock', status: 'closed', reasonNote: 'Drill', externalRef: null, openedAt: '2026-10-20T05:00:00.000Z', closedAt: '2026-10-21T05:00:00.000Z', lotCount: 1 },
];

function lotDto(batchId: string, code: string, over: Record<string, unknown> = {}) {
  return {
    batchId,
    batchCode: code,
    skuId: 'sku-1',
    skuCode: 'SERUM-30',
    skuName: 'Glow Serum 30ml',
    uom: 'each',
    expiryDate: '2027-01-01',
    status: 'blocked',
    blockedReason: 'recall',
    expired: false,
    blockedByRecall: true,
    released: false,
    figures: ZERO,
    adjustedOutByReason: {},
    closeFigures: null,
    closeAdjustedOutByReason: null,
    overrideReason: null,
    dispositionNote: null,
    ...over,
  };
}

const DETAIL = {
  recall: {
    id: R1,
    code: 'RCL-000001',
    mode: 'live',
    status: 'open',
    clientId: CLIENT,
    clientCode: 'ACME',
    clientName: 'Acme Foods',
    reasonNote: 'Allergen mislabel',
    externalRef: 'BR-77',
    openedAt: '2026-10-27T05:00:00.000Z',
    openedBy: 'u-1',
    openedByName: 'Ravi',
    closedAt: null,
    closedBy: null,
    closedByName: null,
    closeNote: null,
    evidenceRef: null,
    acknowledgedUnaccounted: null,
    firstReportAt: '2026-10-27T07:14:00.000Z',
    timeToReportSeconds: 2 * 3600 + 14 * 60,
  },
  asOf: '2026-10-28T09:59:00.000Z',
  lots: [lotDto(B_EXACT, 'AB123'), lotDto(B_STOCK, 'AB123-B', { figures: { ...ZERO, received: 10, onHand: 4, dispatched: 6 } })],
  onHandByWarehouse: [{ warehouseId: 'wh', warehouseCode: 'BLR', role: 'storage', batchId: B_STOCK, batchCode: 'AB123-B', quantity: 4 }],
  heldOrders: [
    {
      orderId: 'o-1',
      orderLabel: 'SO-1042',
      clientOrderRef: 'SO-1042',
      channelOrderRef: null,
      status: 'ready_to_dispatch',
      warehouseId: 'wh',
      warehouseCode: 'BLR',
      batchId: B_STOCK,
      batchCode: 'AB123-B',
      quantity: 2,
      lastPickedAt: '2026-10-26T05:00:00.000Z',
    },
  ],
  plannedPicks: [],
};

const CANDIDATES = {
  normalisedCode: 'AB123',
  truncated: false,
  items: [
    { batchId: B_EXACT, batchCode: 'AB123', skuId: 's', skuCode: 'SERUM-30', skuName: 'Serum', uom: 'each', status: 'active', blockedReason: null, expiryDate: null, match: 'exact', onHand: 12, onRecall: null, sameCodeOnOpenRecall: null },
    { batchId: B_SIMILAR, batchCode: 'ab-12/3', skuId: 's2', skuCode: 'SERUM-50', skuName: 'Serum 50', uom: 'each', status: 'active', blockedReason: null, expiryDate: null, match: 'normalised', onHand: 3, onRecall: null, sameCodeOnOpenRecall: null },
    {
      batchId: B_ON_LIVE,
      batchCode: 'AB123',
      skuId: 's3',
      skuCode: 'SERUM-10',
      skuName: 'Serum 10',
      uom: 'each',
      status: 'blocked',
      blockedReason: 'recall',
      expiryDate: null,
      match: 'exact',
      onHand: 1,
      onRecall: { recallId: R1, code: 'RCL-000001', mode: 'live' },
      sameCodeOnOpenRecall: null,
    },
  ],
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly params: Record<string, string>;
  readonly key: string | null;
  readonly body: unknown;
}
let requests: Recorded[] = [];
let postReplies: [number, unknown][] = [];
let candidatesTruncated = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const text = method === 'POST' ? await request.clone().text() : '';
    requests.push({ method, pathname, params: Object.fromEntries(url.searchParams), key: request.headers.get('Idempotency-Key'), body: text === '' ? null : JSON.parse(text) });
    const base = `/api/v1/tenants/${T}`;
    if (method === 'POST') {
      const reply = postReplies.shift() ?? [503, { code: 'unavailable', status: 503 }];
      return json(reply[0], reply[1]);
    }
    if (pathname === `${base}/clients`) {
      return json(200, {
        items: [
          { id: CLIENT, code: 'ACME', name: 'Acme Foods', systemOwned: false, status: 'active' },
          { id: CLIENT_B, code: 'BETA', name: 'Beta Brands', systemOwned: false, status: 'active' },
        ],
      });
    }
    if (pathname === `${base}/inventory/recalls`) {
      const code = url.searchParams.get('code');
      return json(200, { items: code === null ? LIST : LIST.filter((r) => r.code === code), nextCursor: null });
    }
    if (pathname === `${base}/inventory/recalls/candidates`) return json(200, { ...CANDIDATES, truncated: candidatesTruncated });
    if (pathname === `${base}/inventory/recalls/${R1}`) return json(200, DETAIL);
    if (/\/inventory\/recalls\/[^/]+\/(bins|shipments|receipts)$/.test(pathname)) return json(200, { items: [], nextCursor: null });
    return json(200, { items: [], nextCursor: null });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  postReplies = [];
  candidatesTruncated = false;
  stubRouter();
  writeSession(session());
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const panel = () => view!.container.querySelector('[role="tabpanel"]') as HTMLElement;
const text = () => panel().textContent ?? '';

function button(label: string): HTMLButtonElement {
  const found = ([...view!.container.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent === label || b.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`No button "${label}"`);
  return found;
}
const hasButton = (label: string) => ([...view!.container.querySelectorAll('button')] as HTMLButtonElement[]).some((b) => b.textContent === label);

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.click();
  });
  await settle();
}

async function setValue(selector: string, value: string): Promise<void> {
  const element = panel().querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (element === null) throw new Error(`No field ${selector}`);
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function submitForm(label: string): Promise<void> {
  const form = panel().querySelector(`form[aria-label="${label}"]`) as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

const listRows = () => [...panel().querySelectorAll('tbody tr')].filter((tr) => /RCL-\d{6}/.test(tr.textContent ?? ''));
const posts = () => requests.filter((r) => r.method === 'POST');

describe('Inventory → Recalls', () => {
  test('the list: every recall with its status chip, MOCK on a drill, the brand reference; the tab sits between Batches and Ledger', async () => {
    view = render(<InventoryScreen initialTab="recalls" />);
    await settle();
    const tabs = [...view.container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs.slice(0, 4)).toEqual(['Stock', 'Batches', 'Recalls', 'Ledger']);
    expect(panel().querySelector('h2')?.textContent).toBe('Recalls');
    const rows = listRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('RCL-000001');
    expect(rows[0]!.textContent).toContain('Ref BR-77');
    expect(rows[0]!.querySelector('[data-testid="recall-status-chip"]')?.textContent).toContain('Open');
    expect(rows[0]!.querySelector('[data-testid="recall-mock-chip"]')).toBeNull();
    expect(rows[1]!.querySelector('[data-testid="recall-mock-chip"]')?.textContent).toContain('MOCK');
    // The status filter is server-side.
    await setValue('select[aria-label="Status"]', 'open');
    await settle();
    expect(requests.some((r) => r.pathname.endsWith('/inventory/recalls') && r.params.status === 'open')).toBe(true);
  });

  test('open: EXACT matches pre-ticked, a similar code labelled and unticked, a lot on a live recall disabled; the POST carries the draft key and body, then the detail opens', async () => {
    view = render(<InventoryScreen initialTab="recalls" />);
    await settle();
    await click(button('Open a recall'));
    await setValue('select', CLIENT);
    await setValue('input[name="lotCode"]', 'ab-12/3');
    await submitForm('Find the recalled lot');
    const candidatesRead = requests.find((r) => r.pathname.endsWith('/inventory/recalls/candidates'))!;
    expect(candidatesRead.params).toEqual({ clientId: CLIENT, code: 'ab-12/3' });
    expect(panel().querySelector('[data-testid="candidates-summary"]')?.textContent).toBe('3 lots match AB123 — 2 exact, 1 similar.');

    const box = (id: string) => panel().querySelector(`tr[data-batch-id="${id}"] input[type="checkbox"]`) as HTMLInputElement;
    expect(box(B_EXACT).checked).toBe(true);
    expect(box(B_SIMILAR).checked).toBe(false);
    expect(panel().querySelector(`tr[data-batch-id="${B_SIMILAR}"] [data-testid="similar-code"]`)?.textContent).toContain('similar code — check the label');
    expect(box(B_ON_LIVE).disabled).toBe(true);
    expect(panel().querySelector(`tr[data-batch-id="${B_ON_LIVE}"]`)?.textContent).toContain('Already on RCL-000001');
    expect(text()).toContain('Visible to the client');

    // No note → refused in the browser, nothing sent.
    await submitForm('Recall details');
    expect(text()).toContain('Say why the lot is recalled — the client reads this note.');
    expect(posts()).toHaveLength(0);

    await setValue('textarea[name="reasonNote"]', '  Undeclared peanut  ');
    await setValue('input[name="externalRef"]', 'BR-77');
    postReplies.push([201, { recall: { id: R1, code: 'RCL-000001', mode: 'live', lots: [{ batchId: B_EXACT, batchCode: 'AB123', skuId: 's', blockedByRecall: true }] } }]);
    await submitForm('Recall details');
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.pathname).toBe(`/api/v1/tenants/${T}/inventory/recalls`);
    expect(posts()[0]!.body).toEqual({ batchIds: [B_EXACT], reasonNote: 'Undeclared peanut', externalRef: 'BR-77', mode: 'live' });
    expect(posts()[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(text()).toContain('Recall RCL-000001 opened');
    expect(panel().querySelector('[data-testid="recall-detail"]')).not.toBeNull();
  });

  test('a truncated candidates answer (over 200 lots) warns that the list is incomplete and the code must be narrowed', async () => {
    view = render(<InventoryScreen initialTab="recalls" />);
    await settle();
    await click(button('Open a recall'));
    await setValue('select', CLIENT);
    await setValue('input[name="lotCode"]', 'AB');
    await submitForm('Find the recalled lot');
    expect(panel().querySelector('[data-testid="candidates-truncated"]')).toBeNull();
    candidatesTruncated = true;
    await setValue('input[name="lotCode"]', 'A');
    await submitForm('Find the recalled lot');
    expect(panel().querySelector('[data-testid="candidates-truncated"]')?.textContent).toContain('More than 200 lots match this code — the list below is incomplete.');
  });

  test('add lots: a truncated answer warns the same way', async () => {
    candidatesTruncated = true;
    view = render(<InventoryScreen initialTab="recalls" />);
    await settle();
    await click(button('Open recall RCL-000001'));
    await click(button('Add lots'));
    await setValue('input[name="addLotCode"]', 'AB');
    await submitForm('Find more lots');
    expect(panel().querySelector('[data-testid="add-lots-form"] [data-testid="candidates-truncated"]')?.textContent).toContain('More than 200 lots match');
  });

  test('a retry of the unchanged draft reuses the key; an edit mints a new one', async () => {
    view = render(<InventoryScreen initialTab="recalls" />);
    await settle();
    await click(button('Open a recall'));
    await setValue('select', CLIENT);
    await setValue('input[name="lotCode"]', 'AB123');
    await submitForm('Find the recalled lot');
    await setValue('textarea[name="reasonNote"]', 'Peanut');
    postReplies.push([503, { code: 'recall-open-contended', status: 503, title: 'Contended' }]);
    await submitForm('Recall details');
    expect(text()).toContain('A lot is being picked, dispatched, blocked or recalled right now');
    postReplies.push([503, { code: 'recall-open-contended', status: 503, title: 'Contended' }]);
    await submitForm('Recall details');
    expect(posts()[1]!.key).toBe(posts()[0]!.key);
    await setValue('textarea[name="reasonNote"]', 'Peanut traces');
    postReplies.push([503, { code: 'recall-open-contended', status: 503, title: 'Contended' }]);
    await submitForm('Recall details');
    expect(posts()[2]!.key).not.toBe(posts()[0]!.key);
  });

  test('the detail: header facts, time to first report, lot figures live beside at close, where it sits, held orders, the report buttons', async () => {
    const urls: string[] = [];
    const original = window.history.replaceState;
    window.history.replaceState = (_state: unknown, _unused: string, url?: string | URL | null) => void urls.push(String(url));
    view = render(<InventoryScreen initialTab="recalls" />);
    await settle();
    try {
      await click(button('Open recall RCL-000001'));
    } finally {
      window.history.replaceState = original;
    }
    // The URL names the recall by its code (a plain in-place rewrite).
    expect(urls).toEqual(['/inventory?tab=recalls&recall=RCL-000001']);
    const detail = panel().querySelector('[data-testid="recall-detail"]')!;
    expect(detail.querySelector('h2')?.textContent).toContain('RCL-000001');
    const facts = detail.querySelector('[data-testid="recall-facts"]')!.textContent ?? '';
    expect(facts).toContain('Allergen mislabel');
    expect(facts).toContain('by Ravi');
    expect(facts).toContain('2 h 14 min after opening');
    expect(detail.querySelector('[data-testid="recall-on-hand"]')?.textContent).toContain('Storage');
    expect(text()).toContain('SO-1042');
    expect(text()).toContain('Dispatch refuses them while the recall is open');
    expect(hasButton('Download CSV')).toBe(true);
    expect(hasButton('Download XLSX')).toBe(true);
    await click(button('All figures'));
    const figures = detail.querySelector('[data-testid="recall-figures"]')!;
    expect(figures.textContent).toContain('Unaccounted');
    expect(figures.textContent).toContain('At close');
  });

  test('close: only lots this recall blocked can be released; a ticked lot with stock asks for an override — refused in the browser without it', async () => {
    view = render(<InventoryScreen initialTab="recalls" />);
    await settle();
    await click(button('Open recall RCL-000001'));
    await click(button('Close recall'));
    const form = panel().querySelector('[data-testid="close-recall-form"]') as HTMLFormElement;
    expect(form.querySelector('textarea[name="overrideReason"]')).toBeNull();
    await setValue('textarea[name="closeNote"]', 'Brand confirmed destruction');
    await click(form.querySelector('input[aria-label="Release AB123-B"]') as HTMLInputElement);
    expect(form.textContent).toContain('still has stock: 4 each on hand');
    expect(form.querySelector('textarea[name="overrideReason"]')).not.toBeNull();
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(text()).toContain('AB123-B still has stock — say why it may be released anyway, or leave it blocked.');
    expect(posts()).toHaveLength(0);

    await setValue('textarea[name="overrideReason"]', 'Brand cleared the remaining units');
    postReplies.push([201, { recall: { id: R1, code: 'RCL-000001', mode: 'live', releasedBatchIds: [B_STOCK], lots: [] } }]);
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(posts()[0]!.pathname).toBe(`/api/v1/tenants/${T}/inventory/recalls/${R1}/close`);
    expect(posts()[0]!.body).toEqual({ note: 'Brand confirmed destruction', releaseBatchIds: [B_STOCK], overrideReason: 'Brand cleared the remaining units' });
    expect(text()).toContain('Recall RCL-000001 closed');
  });

  test('a role without qc.manage reads every recall and is offered no open, add or close', async () => {
    writeSession(session('operator'));
    view = render(<InventoryScreen initialTab="recalls" />);
    await settle();
    expect(hasButton('Open a recall')).toBe(false);
    expect(text()).toContain('an owner or ops manager opens and closes them');
    await click(button('Open recall RCL-000001'));
    expect(panel().querySelector('[data-testid="recall-detail"]')).not.toBeNull();
    expect(hasButton('Close recall')).toBe(false);
    expect(hasButton('Add lots')).toBe(false);
    expect(hasButton('Download CSV')).toBe(true);
  });

  test('?recall=RCL-000001 resolves the code with one exact ?code= list call and opens that recall', async () => {
    view = render(<InventoryScreen initialTab="recalls" initialRecall="RCL-000001" />);
    await settle();
    // One exact-code list call resolves it — never a walk of the list.
    const lookups = requests.filter((r) => r.pathname === `/api/v1/tenants/${T}/inventory/recalls` && r.params.code !== undefined);
    expect(lookups.map((r) => r.params)).toEqual([{ code: 'RCL-000001', limit: '1' }]);
    expect(requests.some((r) => r.pathname === `/api/v1/tenants/${T}/inventory/recalls/${R1}`)).toBe(true);
    expect(panel().querySelector('[data-testid="recall-detail"]')).not.toBeNull();
  });

  test('an unknown code says so, with the way back', async () => {
    view = render(<InventoryScreen initialTab="recalls" initialRecall="RCL-999999" />);
    await settle();
    expect(text()).toContain('No recall RCL-999999 in this tenant');
    await click(button('← All recalls'));
    expect(listRows()).toHaveLength(2);
  });
});
