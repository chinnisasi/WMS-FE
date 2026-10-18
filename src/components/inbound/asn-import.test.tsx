import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { AsnsCard } from './asn-card';

/**
 * The ASN import (2026-10-17) — the claims `asn-import.test.ts` cannot make:
 *   1. only `asn.manage` is offered "Import from file" — absent for an operator;
 *   2. Check file sends the file with dryRun=true and NO key; Import sends the
 *      key and no dryRun — pressing a button sends the step it says;
 *   3. one key per CHECKED FILE: an Import retried after a refusal reuses it,
 *      another file gets a new one;
 *   4. the refused rows render and the report downloads what they say; the
 *      template downloads the file contract; a 422 file error shows its words;
 *   5. an import refreshes the ASN list.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = 'wh-1';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const SELF = {
  id: 'c-self',
  tenantId: TENANT_ID,
  code: 'self',
  name: 'Priya Logistics',
  status: 'active',
  systemOwned: true,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};

const ERRORS = [
  { rowNumber: 7, asnCode: 'GLOW-ASN-9', code: 'unknown-sku', detail: 'No SKU with code "GLOW-X" exists in this tenant.', sku: 'GLOW-X', quantity: '3' },
  { rowNumber: 9, asnCode: 'GLOW-ASN-9', code: 'quantity-precision', detail: 'quantity must be a whole number.', sku: 'GLOW-1', quantity: '1.5' },
];

function importResult(dryRun: boolean) {
  return {
    importId: dryRun ? null : 'imp-1',
    dryRun,
    warehouseId: WAREHOUSE_ID,
    fileSha256: 'ab'.repeat(32),
    rowCount: 12,
    asnCount: 3,
    acceptedCount: 2,
    refusedCount: 1,
    asns: [
      { asnId: dryRun ? null : 'a-1', asnCode: 'GLOW-ASN-7', clientId: 'c-glow', clientLabel: 'GLOWCO', lineCount: 6, firstRow: 2 },
      { asnId: dryRun ? null : 'a-2', asnCode: 'GLOW-ASN-8', clientId: 'c-glow', clientLabel: 'GLOWCO', lineCount: 4, firstRow: 10 },
    ],
    errors: ERRORS,
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly key: string | null;
  readonly form: { file: string | null; warehouseId: string | null; dryRun: string | null } | null;
}
let requests: Recorded[] = [];
/** The next import POST's answer, when a test wants a refusal. */
let nextImport: { status: number; body: unknown }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    let form: Recorded['form'] = null;
    if (method === 'POST' && pathname.endsWith('/inbound/asn-imports')) {
      const data = await request.formData();
      const file = data.get('file');
      form = {
        file: file instanceof File ? file.name : null,
        warehouseId: data.get('warehouseId') as string | null,
        dryRun: data.get('dryRun') as string | null,
      };
    }
    requests.push({ method, pathname, key: request.headers.get('Idempotency-Key'), form });
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [SELF] });
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) return json(200, { items: [], nextCursor: null });
    if (method === 'GET' && pathname.endsWith(`/warehouses/${WAREHOUSE_ID}/inbound/asns`)) return json(200, { items: [], nextCursor: null });
    if (form !== null) {
      const queued = nextImport.shift();
      if (queued !== undefined) return json(queued.status, queued.body);
      return json(form.dryRun === 'true' ? 200 : 201, importResult(form.dryRun === 'true'));
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;
let downloads: { name: string; text: Promise<string> }[] = [];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let originalClick: () => void;
const blobs = new Map<string, Blob>();

beforeEach(() => {
  requests = [];
  nextImport = [];
  downloads = [];
  stubRouter();
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
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
}

async function press(button: HTMLButtonElement | undefined): Promise<void> {
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}

function pickFile(container: HTMLElement, file: File): void {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="ASN file"]')!;
  act(() => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function csv(name: string): File {
  return new File(['asn_code,sku,quantity\nGLOW-ASN-7,GLOW-1,5\n'], name, { type: 'text/csv' });
}

async function mount(role: UserRole): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(<AsnsCard warehouseId={WAREHOUSE_ID} warehouseLabel="Peenya" warehouseCode="BLR-DC" />);
  await settle();
  return rendered;
}

async function openImport(container: HTMLElement): Promise<HTMLElement> {
  await press(buttons(container, 'Import from file')[0]);
  return container.querySelector<HTMLElement>('section[aria-label="Import ASNs from a file"]')!;
}

const imports = () => requests.filter((r) => r.form !== null);

describe('ASN import', () => {
  test('only asn.manage is offered "Import from file" — an operator sees no such button', async () => {
    view = await mount('operator');
    expect(buttons(view.container, 'Import from file')).toHaveLength(0);
    view.unmount();
    view = await mount('ops_manager');
    expect(buttons(view.container, 'Import from file')).toHaveLength(1);
  });

  test('Check file posts dryRun=true with no key and shows what is ready; Import posts the key and refreshes the list', async () => {
    view = await mount('ops_manager');
    const panel = await openImport(view.container);
    // Import is not offered before a check.
    expect(buttons(panel, 'Import')[0]!.disabled).toBe(true);
    pickFile(panel, csv('asns.csv'));
    await press(buttons(panel, 'Check file')[0]);
    expect(imports()).toHaveLength(1);
    expect(imports()[0]).toMatchObject({
      pathname: `/api/v1/tenants/${TENANT_ID}/inbound/asn-imports`,
      key: null,
      form: { file: 'asns.csv', warehouseId: WAREHOUSE_ID, dryRun: 'true' },
    });
    expect(panel.textContent).toContain('2 ASNs, 10 lines ready');
    expect(panel.textContent).toContain('Ready to create');
    expect(panel.textContent).toContain('GLOW-ASN-7');

    const listReadsBefore = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/inbound/asns')).length;
    await press(buttons(panel, 'Import')[0]);
    expect(imports()).toHaveLength(2);
    expect(imports()[1]!.form).toEqual({ file: 'asns.csv', warehouseId: WAREHOUSE_ID, dryRun: null });
    expect(imports()[1]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(panel.textContent).toContain('2 ASNs announced');
    expect(panel.textContent).toContain('Created');
    expect(requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/inbound/asns')).length).toBeGreaterThan(listReadsBefore);
  });

  test('one key per checked file: a retried Import reuses it; another file gets a new one', async () => {
    view = await mount('owner');
    const panel = await openImport(view.container);
    pickFile(panel, csv('first.csv'));
    await press(buttons(panel, 'Check file')[0]);
    nextImport.push({ status: 409, body: { code: 'conflict', status: 409, title: 'Concurrent idempotent request' } });
    await press(buttons(panel, 'Import')[0]);
    expect(panel.textContent).toContain('The same import is still in flight');
    await press(buttons(panel, 'Import')[0]);
    const [refused, retried] = imports().filter((r) => r.form!.dryRun === null);
    expect(retried!.key).toBe(refused!.key);

    pickFile(panel, csv('second.csv'));
    // The previous file's result is gone with it.
    expect(panel.querySelector('[data-testid="asn-import-result"]')).toBeNull();
    await press(buttons(panel, 'Check file')[0]);
    await press(buttons(panel, 'Import')[0]);
    const second = imports().filter((r) => r.form!.dryRun === null && r.form!.file === 'second.csv');
    expect(second).toHaveLength(1);
    expect(second[0]!.key).not.toBe(refused!.key);
  });

  test('refused rows render, and the error report and the template download what they say', async () => {
    view = await mount('ops_manager');
    const panel = await openImport(view.container);
    pickFile(panel, csv('asns.csv'));
    await press(buttons(panel, 'Check file')[0]);
    const rows = [...panel.querySelectorAll('table[aria-label="Refused rows"] tbody tr')].map((tr) => tr.textContent);
    expect(rows).toEqual([
      '7GLOW-ASN-9Unknown SKUNo SKU with code "GLOW-X" exists in this tenant.',
      '9GLOW-ASN-9Too many decimalsquantity must be a whole number.',
    ]);
    expect(panel.textContent).toContain('1 ASN refused — 2 rows with problems, listed below');

    await press(buttons(panel, 'Download error report (.csv)')[0]);
    expect(downloads.map((d) => d.name)).toEqual([`asn-import-${'ab'.repeat(6)}-errors.csv`]);
    const report = await downloads[0]!.text;
    expect(report.replace(/^\uFEFF/, '').trimEnd().split('\n')).toEqual([
      'row_number,asn_code,sku,quantity,code,reason,detail',
      '7,"GLOW-ASN-9","GLOW-X","3","unknown-sku","Unknown SKU","No SKU with code ""GLOW-X"" exists in this tenant."',
      '9,"GLOW-ASN-9","GLOW-1","1.5","quantity-precision","Too many decimals","quantity must be a whole number."',
    ]);

    await press(buttons(panel, 'Download template')[0]);
    expect(downloads[1]!.name).toBe('asn-import-template.csv');
    expect((await downloads[1]!.text).split('\n')[0]).toBe('asn_code,client,warehouse,expected_at,sku,quantity');
    expect((await downloads[1]!.text).split('\n')[1]).toBe('ASN-1001,,BLR-DC,2026-10-20,SKU-CODE-1,24');
  });

  test('a 422 file error shows its words and offers no Import', async () => {
    view = await mount('ops_manager');
    const panel = await openImport(view.container);
    pickFile(panel, csv('huge.csv'));
    nextImport.push({
      status: 422,
      body: { code: 'import-too-large', status: 422, title: 'Import exceeds the row or size cap', detail: 'The file announces 501 ASNs — the cap is 500 per import.' },
    });
    await press(buttons(panel, 'Check file')[0]);
    expect(panel.textContent).toContain('Not imported');
    expect(panel.textContent).toContain('The file announces 501 ASNs — the cap is 500 per import.');
    expect(buttons(panel, 'Import')[0]!.disabled).toBe(true);
  });

  test('the input is cleared after a pick, so picking the fixed file again starts over (result gone, new key)', async () => {
    view = await mount('ops_manager');
    const panel = await openImport(view.container);
    pickFile(panel, csv('asns.csv'));
    expect(panel.querySelector<HTMLInputElement>('input[aria-label="ASN file"]')!.value).toBe('');
    expect(panel.textContent).toContain('Selected: asns.csv');
    await press(buttons(panel, 'Check file')[0]);
    expect(panel.querySelector('[data-testid="asn-import-result"]')).not.toBeNull();
    // The same name, fixed on disk: the browser hands over a new File.
    pickFile(panel, csv('asns.csv'));
    expect(panel.querySelector('[data-testid="asn-import-result"]')).toBeNull();
    expect(buttons(panel, 'Import')[0]!.disabled).toBe(true);
  });

  test('a file the browser cannot read is named as such — nothing is sent', async () => {
    view = await mount('ops_manager');
    const panel = await openImport(view.container);
    const broken = csv('gone.csv');
    Object.defineProperty(broken, 'arrayBuffer', { value: () => Promise.reject(new DOMException('gone', 'NotReadableError')) });
    pickFile(panel, broken);
    await press(buttons(panel, 'Check file')[0]);
    expect(panel.textContent).toContain('gone.csv could not be read — it may have been moved or changed since you picked it. Pick it again.');
    expect(panel.textContent).not.toContain('unreachable');
    expect(imports()).toHaveLength(0);
  });
});
