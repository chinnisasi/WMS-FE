import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { emptyConsignmentDraft } from '../../lib/consignment-capture';
import { lastPrintedPackageLabelCount, rememberPackageLabelCount } from '../../lib/cartons';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { canPrintPackageLabels, PackageLabelsDialog } from './package-labels-dialog';
import { ReturnDispatchForm } from './return-dispatch-form';

/**
 * Story 4-5a (A22, A27, A43) — the return package-labels dialog through a
 * stubbed `fetch`: a count is required before dispatch and prefilled from the
 * dispatched count after it; the query carries format, layout, count and the
 * slice; the file is named for the document; the printed count is remembered;
 * a refusal is worded by its code; the dispatch form warns when its packages
 * differ from the labels last printed.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const RTV_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const RTC_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';

function session(): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role: 'operator', status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

let requests: { pathname: string; params: URLSearchParams }[] = [];
let reply: () => Response = () => new Response('^XA^XZ', { status: 200, headers: { 'content-type': 'text/plain' } });
let downloads: string[] = [];
let view: Rendered | undefined;
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let originalClick: () => void;

beforeEach(() => {
  requests = [];
  downloads = [];
  reply = () => new Response('^XA^XZ', { status: 200, headers: { 'content-type': 'text/plain' } });
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    requests.push({ pathname: url.pathname, params: url.searchParams });
    return reply();
  }) as unknown as typeof fetch);
  writeSession(session());
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (() => 'blob:test') as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  HTMLAnchorElement.prototype.click = originalClick;
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function byTestId<T extends HTMLElement = HTMLElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`[data-testid="${id}"]`);
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => void element.click());
  await settle();
}

describe('story 4-5a — return package labels (A22, A27, A43)', () => {
  test('picked and dispatched returns print; draft and cancelled do not', () => {
    expect(['draft', 'picked', 'dispatched', 'cancelled'].map(canPrintPackageLabels)).toEqual([false, true, true, false]);
  });

  test('before dispatch a count is required; ZPL 4×6 downloads under the document’s name and the count is remembered', async () => {
    view = render(<PackageLabelsDialog kind="rtv" documentId={RTV_ID} documentCode="RTV-0007" dispatchedCount={null} onClose={() => {}} />);
    const root = view.container;
    expect(byTestId<HTMLInputElement>(root, 'package-labels-count')!.value).toBe('');
    await click(byTestId(root, 'package-labels-download')!);
    expect(requests).toHaveLength(0);
    expect(byTestId(root, 'package-labels-problem')?.textContent).toContain('Packages is a whole number');
    setValue(byTestId<HTMLInputElement>(root, 'package-labels-count')!, '4');
    await click(byTestId(root, 'package-labels-download')!);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.pathname).toEndWith(`/tenants/${TENANT_ID}/vendor-returns/${RTV_ID}/package-labels`);
    expect(Object.fromEntries(requests[0]!.params)).toEqual({ format: 'zpl', layout: 'label', count: '4' });
    expect(downloads).toEqual(['RTV-0007-package-labels.zpl']);
    expect(lastPrintedPackageLabelCount(RTV_ID)).toBe(4);
  });

  test('after dispatch the count is the dispatched one; a PDF A4 slice goes to the RTC route', async () => {
    view = render(<PackageLabelsDialog kind="rtc" documentId={RTC_ID} documentCode="RTC-0003" dispatchedCount={3} onClose={() => {}} />);
    const root = view.container;
    expect(byTestId<HTMLInputElement>(root, 'package-labels-count')!.value).toBe('3');
    setValue(byTestId<HTMLSelectElement>(root, 'package-labels-format')!, 'pdf');
    setValue(byTestId<HTMLSelectElement>(root, 'package-labels-layout')!, 'a4');
    setValue(byTestId<HTMLInputElement>(root, 'package-labels-from')!, '2');
    reply = () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } });
    await click(byTestId(root, 'package-labels-download')!);
    expect(requests[0]!.pathname).toEndWith(`/tenants/${TENANT_ID}/client-returns/${RTC_ID}/package-labels`);
    expect(Object.fromEntries(requests[0]!.params)).toEqual({ format: 'pdf', layout: 'a4', count: '3', from: '2' });
    expect(downloads).toEqual(['RTC-0003-package-labels.pdf']);
  });

  test('a refusal is worded by its code and nothing downloads', async () => {
    reply = () =>
      new Response(JSON.stringify({ code: 'package-count-mismatch', status: 409, title: 'Count differs', detail: '3 packages were dispatched, not 4.' }), {
        status: 409,
        headers: { 'content-type': 'application/problem+json' },
      });
    view = render(<PackageLabelsDialog kind="rtv" documentId={RTV_ID} documentCode="RTV-0007" dispatchedCount={3} onClose={() => {}} />);
    const root = view.container;
    setValue(byTestId<HTMLInputElement>(root, 'package-labels-count')!, '4');
    await click(byTestId(root, 'package-labels-download')!);
    expect(byTestId(root, 'package-labels-problem')?.textContent).toBe('3 packages were dispatched, not 4.');
    expect(downloads).toHaveLength(0);
    expect(lastPrintedPackageLabelCount(RTV_ID)).toBeNull();
  });

  test('the dispatch form warns when its packages differ from the labels last printed (A43)', () => {
    rememberPackageLabelCount(RTV_ID, 4);
    const draft = { ...emptyConsignmentDraft(null), packageCount: '3' };
    view = render(
      <ReturnDispatchForm
        ariaLabel="Dispatch"
        draft={draft}
        onEdit={() => {}}
        transporters={{ state: 'loading' }}
        fieldError={null}
        problem={null}
        consignorHint=""
        consignorWarning={null}
        dateWindow={{ earliest: '2026-10-01', latest: '2026-10-30' }}
        busy={false}
        submitLabel="Dispatch"
        busyLabel="Dispatching…"
        onSubmit={() => {}}
        onDiscard={() => {}}
        packageCountWarning="4 package labels were printed, but 3 packages are recorded — reprint the labels if the count changed."
      />,
    );
    expect(byTestId(view.container, 'dispatch-package-count-warning')?.textContent).toContain('4 package labels were printed, but 3 packages are recorded');
  });
});
