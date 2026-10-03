import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { HSN_CSV_HEADER, istMonthOf } from '../../lib/hsn-summary';
import { INVOICES_CHANGED_EVENT } from '../../lib/invoices';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { HsnSummary } from './hsn-summary';

/**
 * The /compliance HSN summary (story 8-2a). The claims a `src/lib` test
 * cannot make:
 *   1. the HSN-issue flag renders on EXACTLY the issue rows, the mixed-unit
 *      flag on exactly the mixed OTH row, and the issue-lines panel lists the
 *      lines with the catalog HSN hint and the shortfall;
 *   2. each CSV button downloads ITS section, issue rows excluded, under the
 *      section/GSTIN/period filename;
 *   3. the pickers drive the request (gstin + period on the query);
 *   4. the empty states (no issued GSTIN; an empty period) and a failed read
 *      with a Retry that re-reads;
 *   5. a role with no capabilities at all reads it (it is a member read).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const G29 = '29AAAPZ1234C1ZV';
const G27 = '27AAAPZ1234C1ZV';

function session(role: 'owner' | 'operator'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

function json(code: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
}

const zeroTotals = { invoiceCount: 0, taxablePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0, gstPaise: 0, totalValuePaise: 0 };

function rowOf(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    hsn: '0910',
    hsnIssue: false,
    uqc: 'KGS',
    sourceUoms: ['kg'],
    mixedUnits: false,
    gstBps: 500,
    qtyMilli: 2_500,
    lineCount: 1,
    taxablePaise: 100_000,
    igstPaise: 0,
    cgstPaise: 2_500,
    sgstPaise: 2_500,
    totalValuePaise: 105_000,
    ...overrides,
  };
}

function summaryBody(gstin: string, period: string, empty = false): Record<string, unknown> {
  if (empty) {
    return {
      summary: {
        gstin,
        period: { label: period, kind: 'month', from: 'x', to: 'y', toExclusive: true },
        b2b: { rows: [], totals: zeroTotals },
        b2c: { rows: [], totals: zeroTotals },
        totals: zeroTotals,
        issueLines: [],
      },
    };
  }
  return {
    summary: {
      gstin,
      period: { label: period, kind: 'month', from: 'x', to: 'y', toExclusive: true },
      b2b: {
        rows: [rowOf({})],
        totals: { invoiceCount: 1, taxablePaise: 100_000, igstPaise: 0, cgstPaise: 2_500, sgstPaise: 2_500, gstPaise: 5_000, totalValuePaise: 105_000 },
      },
      b2c: {
        rows: [
          rowOf({ hsn: '2201', uqc: 'OTH', sourceUoms: ['jar', 'keg'], mixedUnits: true, gstBps: 1800, qtyMilli: 3_000, taxablePaise: 35_000, igstPaise: 6_300, cgstPaise: 0, sgstPaise: 0, totalValuePaise: 41_300 }),
          rowOf({ hsn: null, hsnIssue: true, uqc: 'NOS', sourceUoms: ['each'], gstBps: 1800, qtyMilli: 1_000, taxablePaise: 10_000, igstPaise: 1_800, cgstPaise: 0, sgstPaise: 0, totalValuePaise: 11_800 }),
        ],
        totals: { invoiceCount: 1, taxablePaise: 45_000, igstPaise: 8_100, cgstPaise: 0, sgstPaise: 0, gstPaise: 8_100, totalValuePaise: 53_100 },
      },
      totals: { invoiceCount: 2, taxablePaise: 145_000, igstPaise: 8_100, cgstPaise: 2_500, sgstPaise: 2_500, gstPaise: 13_100, totalValuePaise: 158_100 },
      issueLines: [
        { section: 'b2c', invoiceId: 'i-1', invoiceNo: '29/2627/000002', skuCode: 'HS-BLANK', hsn: null, taxablePaise: 10_000, gstPaise: 1_800, valuePaise: 11_800, catalogHsn: '21069099' },
      ],
    },
  };
}

let requests: { pathname: string; query: URLSearchParams }[] = [];
let gstinItems: unknown[] = [];
let summaryFails = false;
let emptyPeriods = new Set<string>();
let downloads: { name: string; text: Promise<string> }[] = [];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let originalClick: () => void;
const blobs = new Map<string, Blob>();

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function currentMonth(): string {
  const m = istMonthOf(Date.now());
  return `${m.year}-${String(m.month0 + 1).padStart(2, '0')}`;
}

/** The default period: the IST month of the GSTIN's LAST issue (both fixtures' last issue is in September). */
const LAST_MONTH = '2026-09';

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  summaryFails = false;
  emptyPeriods = new Set();
  downloads = [];
  gstinItems = [
    { gstin: G27, firstIssuedAt: '2026-09-02T00:00:00.000Z', lastIssuedAt: '2026-09-03T00:00:00.000Z', invoiceCount: 1 },
    { gstin: G29, firstIssuedAt: '2026-07-01T00:00:00.000Z', lastIssuedAt: '2026-09-30T18:29:59.999Z', invoiceCount: 4 },
  ];
  writeSession(session('owner'));
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    requests.push({ pathname: url.pathname, query: url.searchParams });
    if (url.pathname.endsWith('/invoices/hsn-summary/gstins')) return json(200, { items: gstinItems });
    if (url.pathname.endsWith('/invoices/hsn-summary')) {
      if (summaryFails) return json(500, { type: 'about:blank', title: 'Boom', status: 500, code: 'internal', detail: 'The summary read failed.' });
      const gstin = url.searchParams.get('gstin')!;
      const period = url.searchParams.get('period')!;
      return json(200, summaryBody(gstin, period, emptyPeriods.has(period)));
    }
    return json(404, { code: 'not-found', status: 404 });
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

afterEach(() => {
  view?.unmount();
  view = undefined;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  HTMLAnchorElement.prototype.click = originalClick;
  clearSession();
  restoreGlobals();
});

async function mount(): Promise<Rendered> {
  const rendered = render(<HsnSummary />);
  await settle();
  return rendered;
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function summaryRequests(): { gstin: string | null; period: string | null }[] {
  return requests
    .filter((r) => r.pathname.endsWith('/invoices/hsn-summary'))
    .map((r) => ({ gstin: r.query.get('gstin'), period: r.query.get('period') }));
}

describe('HsnSummary', () => {
  test('flags exactly the issue row and the mixed-unit row, lists the issue lines with the catalog hint, and states the shortfall', async () => {
    view = await mount();
    const c = view.container;
    // The first GSTIN, the month of its last issue by default (not the in-progress month).
    expect(summaryRequests()).toEqual([{ gstin: G27, period: LAST_MONTH }]);
    const offered = [...c.querySelectorAll('select')[1]!.querySelectorAll('option')];
    expect(offered.find((o) => o.value === currentMonth())!.textContent).toContain('in progress');
    expect(c.querySelector('[data-testid="hsn-b2b"]')!.textContent).toContain('0910');
    const flagged = [...c.querySelectorAll('tr[data-hsn-issue="true"]')];
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.textContent).toContain('(blank)');
    expect(c.querySelectorAll('[data-testid="hsn-issue-flag"]')).toHaveLength(1);
    const mixed = [...c.querySelectorAll('[data-testid="hsn-mixed-units"]')];
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.textContent).toContain('jar, keg');
    const issues = c.querySelector('[data-testid="hsn-issue-lines"]')!;
    expect(issues.textContent).toContain('29/2627/000002');
    expect(issues.textContent).toContain('HS-BLANK');
    expect(issues.textContent).toContain('21069099');
    expect(c.textContent).toContain('₹118.00 short of the invoice total');
    expect(c.querySelector('[data-testid="hsn-b2c-totals"]')!.textContent).toContain('₹531.00');
    expect(c.textContent).toContain('aggregate annual turnover');
  });

  test('each CSV button downloads its own section, issue rows excluded, no BOM, named by section/GSTIN/period', async () => {
    view = await mount();
    const buttons = [...view.container.querySelectorAll('button')].filter((b) => b.textContent?.includes('CSV'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Download B2B CSV', 'Download B2C CSV']);
    act(() => buttons[1]!.click());
    act(() => buttons[0]!.click());
    expect(downloads.map((d) => d.name)).toEqual([`hsn-b2c-${G27}-${LAST_MONTH}.csv`, `hsn-b2b-${G27}-${LAST_MONTH}.csv`]);
    const b2c = await downloads[0]!.text;
    expect(b2c.startsWith(HSN_CSV_HEADER)).toBe(true);
    expect(b2c).toContain('"2201","","OTH-OTHERS","3.00","413.00","18","350.00","63.00","0.00","0.00","0.00"');
    expect(b2c.trim().split('\n')).toHaveLength(2); // the issue row is not exported
    const b2b = await downloads[1]!.text;
    expect(b2b).toContain('"0910","","KGS-KILOGRAMS","2.50","1050.00","5","1000.00","0.00","25.00","25.00","0.00"');
  });

  test('the pickers drive the request: another GSTIN, then an FY quarter', async () => {
    view = await mount();
    const gstinSelect = view.container.querySelector('select') as HTMLSelectElement;
    choose(gstinSelect, G29);
    await settle();
    expect(summaryRequests().at(-1)).toEqual({ gstin: G29, period: LAST_MONTH });
    const options = [...view.container.querySelectorAll('select')[1]!.querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('2026-07');
    expect(options).toContain('FY-2627-Q2');
    choose(view.container.querySelectorAll('select')[1] as HTMLSelectElement, 'FY-2627-Q2');
    await settle();
    expect(summaryRequests().at(-1)).toEqual({ gstin: G29, period: 'FY-2627-Q2' });
  });

  test('a period picked under one GSTIN does not leak into another: switching GSTIN reads its own default period', async () => {
    view = await mount();
    choose(view.container.querySelectorAll('select')[1] as HTMLSelectElement, 'FY-2627-Q2');
    await settle();
    expect(summaryRequests().at(-1)).toEqual({ gstin: G27, period: 'FY-2627-Q2' });
    choose(view.container.querySelector('select') as HTMLSelectElement, G29);
    await settle();
    expect(summaryRequests().at(-1)).toEqual({ gstin: G29, period: LAST_MONTH });
  });

  test('the invoices broadcaster re-reads both the GSTIN list and the summary', async () => {
    view = await mount();
    const count = (suffix: string) => requests.filter((r) => r.pathname.endsWith(suffix)).length;
    const gstinsBefore = count('/invoices/hsn-summary/gstins');
    const summaryBefore = count('/invoices/hsn-summary');
    act(() => {
      window.dispatchEvent(new Event(INVOICES_CHANGED_EVENT));
    });
    await settle();
    expect(count('/invoices/hsn-summary/gstins')).toBe(gstinsBefore + 1);
    expect(count('/invoices/hsn-summary')).toBe(summaryBefore + 1);
  });

  test('an empty period says so; no issued GSTIN at all says so', async () => {
    emptyPeriods.add(LAST_MONTH);
    view = await mount();
    expect(view.container.querySelector('[data-testid="hsn-empty"]')!.textContent).toContain(`No invoice was issued under ${G27}`);
    view.unmount();
    gstinItems = [];
    view = await mount();
    expect(view.container.textContent).toContain('No invoice has been issued yet');
    expect(view.container.querySelector('select')).toBeNull();
  });

  test('a failed read renders the reason and a Retry that re-reads', async () => {
    summaryFails = true;
    view = await mount();
    expect(view.container.textContent).toContain('The summary read failed.');
    const before = summaryRequests().length;
    summaryFails = false;
    const retry = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    act(() => retry.click());
    await settle();
    expect(summaryRequests().length).toBe(before + 1);
    expect(view.container.querySelector('[data-testid="hsn-b2b"]')).not.toBeNull();
  });

  test('an operator (no invoice capability) reads the whole summary', async () => {
    clearSession();
    writeSession(session('operator'));
    view = await mount();
    expect(view.container.querySelector('[data-testid="hsn-b2b"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="hsn-issue-lines"]')).not.toBeNull();
  });
});
