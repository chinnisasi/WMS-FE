import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { OperationalReports } from './operational-reports';

/**
 * Story 5-3a — the `/reports` "Operational reports" section, driven through
 * a stubbed global `fetch` (the generated client is a fetch wrapper):
 *   - Download GETs the register route with exactly the set filters and
 *     saves the blob under the web-built name;
 *   - a snapshot register reads "As of now" and sends no dates; a dated one
 *     shows "Register from/to" and never sends a period the server refuses;
 *   - the client defaults (switcher, local All + the note) and the warehouse
 *     failure (WarehousesFailure, Download disabled);
 *   - a refusal renders in role="alert"; a double click sends one request.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const SELF = '0198f7a2-1b3c-7d4e-8f90-cccccccccc00';
const ACME = '0198f7a2-1b3c-7d4e-8f90-cccccccccc0a';
const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const W2 = '0198f7a2-1b3c-7d4e-8f90-0000000000a2';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
  user: { id: 'u-1', email: 'ops@example.com', role: 'ops_manager', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

function client(id: string, code: string, name: string, systemOwned = false) {
  return {
    id,
    tenantId: TENANT_ID,
    code,
    name,
    status: 'active',
    systemOwned,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    taxDetails: { gstin: null, legalName: null, stateCode: null, address: null },
  };
}

function warehouse(id: string, code: string, name: string) {
  return { id, tenantId: TENANT_ID, code, name, origin: null, gstin: null, createdAt: '2026-01-01T00:00:00.000Z' };
}

let reportUrls: string[] = [];
let reportReply: () => Response = () => new Response('csv-bytes', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
let warehousesFail = false;
let clientsFail = false;
let gate: Promise<void> | null = null;
const downloads: { name: string; text: Promise<string> }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let view: Rendered | undefined;
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let originalClick: typeof HTMLAnchorElement.prototype.click;

beforeEach(() => {
  reportUrls = [];
  downloads.length = 0;
  warehousesFail = false;
  clientsFail = false;
  gate = null;
  reportReply = () => new Response('csv-bytes', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
  writeSession(SESSION);
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname, search } = new URL(request.url);
    if (pathname.endsWith('/clients') && clientsFail) {
      return json(503, { code: 'service-unavailable', status: 503, title: 'Unavailable', detail: 'The clients read is down.' });
    }
    if (pathname.endsWith('/clients')) {
      return json(200, { items: [client(SELF, 'self', 'Three PL Co', true), client(ACME, 'ACME', 'Acme Brands')] });
    }
    if (pathname.endsWith('/warehouses') && warehousesFail) {
      return json(503, { code: 'service-unavailable', status: 503, title: 'Unavailable', detail: 'The warehouses read is down.' });
    }
    if (pathname.endsWith('/warehouses')) return json(200, { items: [warehouse(W1, 'BLR-1', 'Main'), warehouse(W2, 'BLR-2', 'North')], nextCursor: null });
    if (pathname.includes('/reports/')) {
      reportUrls.push(`${pathname}${search}`);
      if (gate !== null) await gate;
      return reportReply();
    }
    return json(200, { items: [], nextCursor: null });
  }) as unknown as typeof fetch);
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  originalClick = HTMLAnchorElement.prototype.click;
  const blobs = new Map<string, Blob>();
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

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  localStorage.clear();
  restoreGlobals();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  HTMLAnchorElement.prototype.click = originalClick;
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

const select = (container: HTMLElement, label: string) => container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
const input = (container: HTMLElement, label: string) => container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
const downloadButton = (container: HTMLElement) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Download' || b.textContent === 'Preparing…') as HTMLButtonElement;
const lastReport = () => new URL(`http://x${reportUrls.at(-1)!}`);

async function open(): Promise<HTMLElement> {
  view = render(<OperationalReports />);
  await settle();
  return view.container;
}

async function clickDownload(container: HTMLElement): Promise<void> {
  act(() => {
    downloadButton(container).click();
  });
  await settle();
}

describe('OperationalReports', () => {
  test('stock on hand: "As of now", no dates sent; the first warehouse; every client; saved as <report>-<WH>-asof-<IST date>.csv', async () => {
    const container = await open();
    expect(container.querySelector('[data-testid="register-as-of-now"]')?.textContent).toBe('As of now');
    expect(input(container, 'Register from')).toBeNull();
    expect(select(container, 'Register warehouse').value).toBe(W1);
    expect(select(container, 'Register client').value).toBe('');
    await clickDownload(container);
    expect(reportUrls).toHaveLength(1);
    expect(lastReport().pathname).toBe(`/api/v1/tenants/${TENANT_ID}/warehouses/${W1}/reports/stock-on-hand`);
    expect([...lastReport().searchParams.entries()]).toEqual([['format', 'csv']]);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/^stock-on-hand-BLR-1-asof-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await downloads[0]!.text).toBe('csv-bytes');
    expect(container.textContent).toContain(downloads[0]!.name);
  });

  test('a dated register: "Register from/to" inputs; the period, the picked client, warehouse and Excel go out; the name carries them', async () => {
    const container = await open();
    setValue(select(container, 'Register'), 'ledger');
    await settle();
    expect(container.querySelector('[data-testid="register-as-of-now"]')).toBeNull();
    // Distinct accessible names — the Client service section keeps "Report from/to".
    setValue(input(container, 'Register from')!, '2026-09-01');
    setValue(input(container, 'Register to')!, '2026-09-30');
    setValue(select(container, 'Register client'), ACME);
    setValue(select(container, 'Register warehouse'), W2);
    setValue(select(container, 'Register format'), 'xlsx');
    await settle();
    await clickDownload(container);
    expect(lastReport().pathname).toBe(`/api/v1/tenants/${TENANT_ID}/warehouses/${W2}/reports/ledger`);
    expect(Object.fromEntries(lastReport().searchParams)).toEqual({ format: 'xlsx', clientId: ACME, from: '2026-09-01', to: '2026-09-30' });
    expect(downloads[0]!.name).toBe('ledger-BLR-2-ACME-2026-09-01_2026-09-30.xlsx');
  });

  test('a period the server would refuse is never sent: the problem shows and Download is disabled', async () => {
    const container = await open();
    setValue(select(container, 'Register'), 'inbound-register');
    setValue(input(container, 'Register from')!, '2026-09-30');
    setValue(input(container, 'Register to')!, '2026-09-01');
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(downloadButton(container).disabled).toBe(true);
    await clickDownload(container);
    expect(reportUrls).toHaveLength(0);
  });

  test('the switcher client is the default; a local All overrides it and shows the "All clients" note', async () => {
    writeActiveClientId(TENANT_ID, 'u-1', ACME);
    const container = await open();
    expect(select(container, 'Register client').value).toBe(ACME);
    expect(container.querySelector('[data-testid="all-clients-note"]')).toBeNull();
    await clickDownload(container);
    expect(lastReport().searchParams.get('clientId')).toBe(ACME);
    expect(downloads[0]!.name).toMatch(/^stock-on-hand-BLR-1-ACME-asof-/);
    setValue(select(container, 'Register client'), '');
    await settle();
    expect(container.querySelector('[data-testid="all-clients-note"]')).toBeTruthy();
    await clickDownload(container);
    expect(lastReport().searchParams.get('clientId')).toBeNull();
  });

  test('a failed warehouses read: WarehousesFailure in the picker’s slot and Download disabled', async () => {
    warehousesFail = true;
    const container = await open();
    expect(select(container, 'Register warehouse')).toBeNull();
    expect(container.textContent).toContain('Warehouses not loaded');
    expect(downloadButton(container).disabled).toBe(true);
  });

  test('a failed clients read: the failure shows and Download stays disabled (never a silent every-client download)', async () => {
    clientsFail = true;
    const container = await open();
    expect(container.textContent).toContain('Clients not loaded');
    expect(downloadButton(container).disabled).toBe(true);
    await clickDownload(container);
    expect(reportUrls).toHaveLength(0);
  });

  test('a refusal renders in role="alert" by its code, the cap read from the problem; nothing is saved', async () => {
    reportReply = () =>
      json(422, { code: 'report-too-large', status: 422, title: 'Register too large', detail: 'The stock-on-hand register has more than 1,000 rows.', maxRows: 1000 });
    const container = await open();
    await clickDownload(container);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('This register has more than 1,000 rows — pick a client.');
    expect(downloads).toHaveLength(0);
  });

  test('busy: aria-busy and "Preparing…" while in flight; a double click sends ONE request', async () => {
    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const container = await open();
    act(() => {
      downloadButton(container).click();
      downloadButton(container).click();
    });
    await settle();
    expect(downloadButton(container).getAttribute('aria-busy')).toBe('true');
    expect(downloadButton(container).textContent).toBe('Preparing…');
    release();
    await settle();
    expect(reportUrls).toHaveLength(1);
    expect(downloads).toHaveLength(1);
    expect(downloadButton(container).getAttribute('aria-busy')).toBe('false');
  });
});
