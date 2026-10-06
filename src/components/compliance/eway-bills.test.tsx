import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { notifyEwayChanged } from '../../lib/eway';
import { notifyInvoicesChanged } from '../../lib/invoices';
import { EWAY_INVOICE_REFETCH_DELAYS_MS } from '../../lib/use-eway';
import { EwayBills } from './eway-bills';

/**
 * The /compliance E-way bills section (story 8-2b). The claims a `src/lib`
 * test cannot make:
 *   1. checkboxes are limited to one GSTIN, and "Download NIC JSON (n)" posts
 *      exactly the READY selected bills (blocked ones skipped and counted),
 *      then downloads the server's file under the GSTIN's name;
 *   2. per-row blocker badges render, and a terminal one says to generate on
 *      the portal and record here;
 *   3. Generate renders ONLY on a bill that reads gatewayAvailable, and
 *      pressing it posts /generate;
 *   4. Save transport PATCHes the Part B it shows; Record posts the number;
 *   5. a 409 eway-not-exportable renders each refused bill's reasons;
 *   6. an operator reads everything and is offered no mutating affordance;
 *      the settings panel is owner-only (the accountant acts on bills but
 *      does not configure);
 *   7. a status tab reads that status; Refresh re-reads.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const G29 = '29AAAPZ1234C1ZV';
const G27 = '27AAAPZ1234C1ZV';

function session(role: 'owner' | 'ops_manager' | 'operator' | 'accountant'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const TRANSPORT = {
  transMode: null, vehicleNo: null, vehicleType: null, transporterId: null, transporterName: null, transDocNo: null, transDocDate: null, distanceKm: null,
};

function billDto(id: string, invoiceNo: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    invoiceId: `inv-${id}`,
    invoiceNo,
    invoiceIssuedAt: '2026-10-04T05:00:00.000Z',
    originGstin: G29,
    consigneeGstin: null,
    b2b: false,
    status: 'pending',
    consignmentValuePaise: 7_080_000,
    thresholdPaise: 5_000_000,
    thresholdRule: 'national',
    transport: TRANSPORT,
    ewbNo: null,
    ewbGeneratedAt: null,
    ewbValidUntil: null,
    source: null,
    dismissedReason: null,
    lastError: null,
    gatewayClaimedAt: null,
    lastExportedAt: null,
    lastExportedBy: null,
    blockers: [],
    gatewayAvailable: false,
    createdAt: '2026-10-04T05:00:00.000Z',
    updatedAt: '2026-10-04T05:00:00.000Z',
    ...overrides,
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: URLSearchParams;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

let requests: Recorded[] = [];
let bills: Record<string, unknown>[] = [];
let exportAnswer: { status: number; body: unknown } | null = null;
let downloads: { name: string; text: Promise<string> }[] = [];
const blobs = new Map<string, Blob>();
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let originalClick: () => void;

const keyOf = (r: Recorded) => Object.entries(r.headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];

function json(code: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  requests = [];
  downloads = [];
  exportAnswer = null;
  bills = [
    billDto('b-ready', '29/2627/000001', { gatewayAvailable: true }),
    billDto('b-blocked', '29/2627/000002', { blockers: [{ code: 'transport-incomplete', terminal: false }] }),
    billDto('b-terminal', '29/2627/000003', { blockers: [{ code: 'ship-to-differs', terminal: true }] }),
    billDto('b-other', '27/2627/000001', { originGstin: G27 }),
  ];
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname: url.pathname, search: url.searchParams, body, headers: Object.fromEntries(request.headers.entries()) });
    const p = url.pathname;
    if (method === 'GET' && p.endsWith('/eway/bills')) {
      const status = url.searchParams.get('status');
      return json(200, { items: status === 'pending' ? bills : [], nextCursor: null });
    }
    if (method === 'GET' && p.endsWith('/eway/gstin-settings')) {
      return json(200, { items: [{ gstin: G27, eInvoiceApplies: false, updatedBy: null, updatedAt: null }, { gstin: G29, eInvoiceApplies: true, updatedBy: 'u', updatedAt: '2026-10-01T00:00:00.000Z' }] });
    }
    if (method === 'GET' && p.endsWith('/eway/state-thresholds')) {
      return json(200, { items: [{ id: 't-1', stateCode: '27', thresholdPaise: 10_000_000, effectiveFrom: '2025-04-01', createdBy: 'u', createdAt: '2026-01-01T00:00:00.000Z' }] });
    }
    if (method === 'POST' && p.endsWith('/eway/bills/export')) {
      if (exportAnswer !== null) return json(exportAnswer.status, exportAnswer.body);
      return json(200, { file: { version: '1.0.0621', billLists: [{ docNo: '29/2627/000001' }] } });
    }
    const billId = p.split('/').at(-2);
    const found = bills.find((b) => b.id === billId);
    if (found !== undefined && method === 'PATCH' && p.endsWith('/transport')) return json(200, { bill: found });
    if (found !== undefined && method === 'POST' && p.endsWith('/record')) return json(200, { bill: { ...found, status: 'generated', ewbNo: '141234567890' } });
    if (found !== undefined && method === 'POST' && p.endsWith('/generate')) return json(200, { bill: { ...found, status: 'generated', ewbNo: '151234567890' } });
    if (found !== undefined && method === 'POST' && p.endsWith('/dismiss')) return json(200, { bill: { ...found, status: 'dismissed' } });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  originalClick = HTMLAnchorElement.prototype.click;
  let n = 0;
  URL.createObjectURL = ((blob: Blob) => {
    const href = `blob:test/${n++}`;
    blobs.set(href, blob);
    return href;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, text: blobs.get(this.getAttribute('href') ?? '')!.text() });
  };
});

let view: Rendered | undefined;

afterEach(() => {
  view?.unmount();
  view = undefined;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  HTMLAnchorElement.prototype.click = originalClick;
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

async function mountAs(role: Parameters<typeof session>[0]): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(<EwayBills />);
  await settle();
  return rendered;
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
}

function checkbox(container: HTMLElement, invoiceNo: string): HTMLInputElement {
  return container.querySelector(`input[aria-label="Select ${invoiceNo}"]`) as HTMLInputElement;
}

async function click(element: HTMLElement): Promise<void> {
  act(() => element.click());
  await settle();
}

function setInput(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function openRow(container: HTMLElement, index: number): Promise<HTMLElement> {
  await click(buttons(container, 'Act')[index]!);
  return container.querySelector('[id^="expanded-"]') as HTMLElement;
}

describe('the e-way bills section', () => {
  test('reads the pending tab and renders blocker badges; a terminal one points at the portal', async () => {
    view = await mountAs('accountant');
    const list = requests.find((r) => r.method === 'GET' && r.pathname.endsWith('/eway/bills'))!;
    expect(list.search.get('status')).toBe('pending');
    const text = view.container.textContent ?? '';
    expect(text).toContain('New bills appear shortly after an invoice issues; a Part-A-only bill lapses after 15 days without Part B.');
    expect(view.container.querySelector('[data-blocker="transport-incomplete"]')?.textContent).toBe('Transport details needed');
    expect(view.container.querySelector('[data-blocker="ship-to-differs"]')?.textContent).toBe('Ship-to state differs from bill-to');
    expect(text).toContain('Generate on the NIC portal, then record the number here.');
  });

  test('selection is one GSTIN; Download posts ONLY the ready bills, counts the skipped, and downloads the file', async () => {
    view = await mountAs('accountant');
    const c = view.container;
    expect(buttons(c, 'Download NIC JSON (0)')[0]!.disabled).toBe(true);
    await click(checkbox(c, '29/2627/000001'));
    await click(checkbox(c, '29/2627/000002'));
    expect(checkbox(c, '27/2627/000001').disabled).toBe(true);
    expect(checkbox(c, '29/2627/000003').disabled).toBe(false);
    expect(c.textContent).toContain('1 skipped (blocked)');
    await click(buttons(c, 'Download NIC JSON (1)')[0]!);
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/eway/bills/export'))!;
    expect(post.body).toEqual({ ids: ['b-ready'] });
    expect(keyOf(post)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/^ewb-bulk-29AAAPZ1234C1ZV-\d{8}-\d{4}\.json$/);
    expect(JSON.parse(await downloads[0]!.text)).toEqual({ version: '1.0.0621', billLists: [{ docNo: '29/2627/000001' }] });
    expect(c.textContent).toContain('NIC JSON downloaded');
    // The list re-read after the export.
    expect(requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/eway/bills')).length).toBeGreaterThan(1);
  });

  test('a 409 eway-not-exportable names each refused bill and its reasons', async () => {
    exportAnswer = {
      status: 409,
      body: { type: 'x', title: 'Refused', status: 409, code: 'eway-not-exportable', detail: 'Refused', bills: [{ id: 'b-ready', reasons: ['not-pending'] }] },
    };
    view = await mountAs('ops_manager');
    await click(checkbox(view.container, '29/2627/000001'));
    await click(buttons(view.container, 'Download NIC JSON (1)')[0]!);
    expect(view.container.textContent).toContain('Nothing was exported — 29/2627/000001: no longer pending.');
    expect(downloads).toHaveLength(0);
  });

  test('Generate renders only on a gatewayAvailable bill, and pressing it posts /generate', async () => {
    view = await mountAs('accountant');
    const ready = await openRow(view.container, 0);
    expect(buttons(ready, 'Generate')).toHaveLength(1);
    await click(buttons(ready, 'Generate')[0]!);
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/bills/b-ready/generate'))!;
    expect(keyOf(post)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('EWB generated');
    const blocked = await openRow(view.container, 1);
    expect(buttons(blocked, 'Generate')).toHaveLength(0);
  });

  test('Save transport PATCHes the Part B on screen; Record posts the number with an IST time', async () => {
    view = await mountAs('accountant');
    let panel = await openRow(view.container, 1);
    setInput(panel.querySelector('select[aria-label="Mode"]') as HTMLSelectElement, '1');
    setInput(panel.querySelector('input[aria-label="Transporter id"]') as HTMLInputElement, '29AABCT1234Q1ZP');
    setInput(panel.querySelector('input[aria-label="Distance (km)"]') as HTMLInputElement, '120');
    await click(buttons(panel, 'Save transport')[0]!);
    const patch = requests.find((r) => r.method === 'PATCH')!;
    expect(patch.pathname).toEndWith('/eway/bills/b-blocked/transport');
    expect(patch.body).toEqual({ transMode: 1, transporterId: '29AABCT1234Q1ZP', distanceKm: 120 });

    panel = await openRow(view.container, 2);
    setInput(panel.querySelector('input[aria-label="EWB number"]') as HTMLInputElement, '1412 3456 7890');
    setInput(panel.querySelector('input[aria-label="Generated at"]') as HTMLInputElement, '2026-10-04T10:30');
    await click(buttons(panel, 'Record')[0]!);
    const record = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/record'))!;
    expect(record.pathname).toEndWith('/eway/bills/b-terminal/record');
    expect(record.body).toEqual({ ewbNo: '141234567890', generatedAt: '2026-10-04T05:00:00.000Z' });
    expect(view.container.textContent).toContain('EWB recorded');
  });

  test('an operator reads everything and is offered no mutating affordance', async () => {
    view = await mountAs('operator');
    const c = view.container;
    expect(c.textContent).toContain('29/2627/000001');
    expect(c.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(buttons(c, 'Act')).toHaveLength(0);
    expect(c.textContent).not.toContain('Download NIC JSON');
    expect(c.textContent).not.toContain('E-way settings');
  });

  test('the settings panel is owner-only: history, the no-re-evaluation copy, and the per-GSTIN toggle', async () => {
    view = await mountAs('accountant');
    expect(view.container.textContent).not.toContain('E-way settings');
    view.unmount();
    view = await mountAs('owner');
    const text = view.container.textContent ?? '';
    expect(text).toContain('E-way settings');
    expect(text).toContain('does not re-evaluate bills already queued');
    expect(text).toContain('27 — Maharashtra');
    expect(text).toContain('₹1,00,000.00');
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      requests.push({ method: request.method, pathname: new URL(request.url).pathname, search: new URL(request.url).searchParams, body: await request.json().catch(() => null), headers: Object.fromEntries(request.headers.entries()) });
      return json(200, { setting: { gstin: G27, eInvoiceApplies: true, updatedBy: 'u', updatedAt: '2026-10-04T00:00:00.000Z' }, items: [], nextCursor: null });
    }) as unknown as typeof fetch);
    await click(buttons(view.container, 'Turn on')[0]!);
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.pathname).toEndWith(`/eway/gstin-settings/${G27}`);
    expect(put.body).toEqual({ eInvoiceApplies: true });
  });

  test('a status tab reads that status; Refresh re-reads', async () => {
    view = await mountAs('accountant');
    await click(buttons(view.container, 'Generated')[0]!);
    const last = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/eway/bills')).at(-1)!;
    expect(last.search.get('status')).toBe('generated');
    expect(view.container.textContent).toContain('No generated e-way bills.');
    const before = requests.length;
    await click(buttons(view.container, 'Refresh')[0]!);
    expect(requests.length).toBeGreaterThan(before);
  });
});

describe('8-1d: the needs-irn hint follows eway.configure', () => {
  const irn = () => billDto('b-irn', '29/2627/000009', { b2b: true, consigneeGstin: '27BBBPT5678M2AB', blockers: [{ code: 'needs-irn', terminal: false }] });

  test('an accountant (no eway.configure) is told to ask an owner — never to turn the flag off', async () => {
    bills = [irn()];
    view = await mountAs('accountant');
    const badge = view.container.querySelector('[data-blocker="needs-irn"]') as HTMLElement;
    expect(badge.title).toContain('ask an owner to turn the flag off');
    expect(badge.title).not.toContain('Turn the flag off');
  });

  test('an owner (eway.configure) is told to turn the flag off', async () => {
    bills = [irn()];
    view = await mountAs('owner');
    const badge = view.container.querySelector('[data-blocker="needs-irn"]') as HTMLElement;
    expect(badge.title).toContain('Turn the flag off if it no longer applies');
    expect(badge.title).not.toContain('ask an owner');
  });
});

describe('8-1d: invoice events re-read the bills on a trailing debounce; the settings lists ignore them', () => {
  const gets = (suffix: string) => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith(suffix)).length;

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  async function advance(ms: number): Promise<void> {
    act(() => {
      jest.advanceTimersByTime(ms);
    });
    await settle();
  }

  test('a burst of invoice events: nothing at once, ONE bills re-read at ~3 s after the last, one more at ~10 s, no settings re-read', async () => {
    view = await mountAs('owner'); // the owner mounts all three reads
    const bills0 = gets('/eway/bills');
    const gstin0 = gets('/eway/gstin-settings');
    const thresholds0 = gets('/eway/state-thresholds');
    expect(gstin0).toBeGreaterThan(0);
    expect(thresholds0).toBeGreaterThan(0);

    act(() => notifyInvoicesChanged());
    await advance(2_000);
    act(() => notifyInvoicesChanged()); // restarts the debounce
    act(() => notifyInvoicesChanged());
    await settle();
    expect(gets('/eway/bills')).toBe(bills0); // never immediate

    const [first, second] = EWAY_INVOICE_REFETCH_DELAYS_MS;
    await advance(first - 1);
    expect(gets('/eway/bills')).toBe(bills0);
    await advance(1);
    expect(gets('/eway/bills')).toBe(bills0 + 1);
    await advance(second - first - 1);
    expect(gets('/eway/bills')).toBe(bills0 + 1);
    await advance(1);
    expect(gets('/eway/bills')).toBe(bills0 + 2);
    await advance(60_000);
    expect(gets('/eway/bills')).toBe(bills0 + 2); // the schedule ends

    expect(gets('/eway/gstin-settings')).toBe(gstin0);
    expect(gets('/eway/state-thresholds')).toBe(thresholds0);
  });

  test('an e-way mutation still re-reads every list at once', async () => {
    view = await mountAs('owner');
    const bills0 = gets('/eway/bills');
    const gstin0 = gets('/eway/gstin-settings');
    act(() => notifyEwayChanged());
    await settle();
    expect(gets('/eway/bills')).toBe(bills0 + 1);
    expect(gets('/eway/gstin-settings')).toBeGreaterThan(gstin0);
  });

  test('the pending re-read is cleared on unmount', async () => {
    view = await mountAs('accountant');
    const before = requests.length;
    act(() => notifyInvoicesChanged());
    view.unmount();
    view = undefined;
    await advance(20_000);
    expect(requests.length).toBe(before);
  });

  test('the pending re-read is cleared on a tenant change — the old schedule never fires', async () => {
    view = await mountAs('accountant');
    act(() => notifyInvoicesChanged());
    await settle();
    act(() => writeSession({ ...session('accountant'), tenant: { id: '0198f7a2-1b3c-7d4e-8f90-aabbccddeeff', name: 'Other Co', gstin: null } }));
    await settle();
    const afterSwitch = gets('/eway/bills'); // the new tenant's own first read
    await advance(20_000);
    expect(gets('/eway/bills')).toBe(afterSwitch);
  });
});
