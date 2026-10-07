import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ClientsCard } from './clients-card';
import { ImportCatalogCard } from './import-catalog';

/**
 * Story 21-2b — the claims a `src/lib` test cannot make:
 *   1. every role READS the client list (status included), and the tenant's
 *      own client reads as the company;
 *   2. only an owner (`clients.manage`) is offered the create form and the
 *      Rename action — absent, not disabled, for everyone else — and Rename
 *      is never offered on the system-owned client;
 *   3. pressing Add client sends the create verb with the normalized body and
 *      an Idempotency-Key;
 *   4. the import card shows the single-client hint with one client, and a
 *      required picker with NO default once several exist.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const SELF = {
  id: 'c-self',
  tenantId: TENANT_ID,
  code: 'self',
  name: 'Priya Spices',
  status: 'active',
  systemOwned: true,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};
const ACME = { ...SELF, id: 'c-acme', code: 'ACME', name: 'Acme Foods', systemOwned: false, status: 'suspended' };

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
}
let requests: Recorded[] = [];
let clientRows: unknown[] = [];
let clientsFail = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await request.formData();
      body = Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '<file>']));
    } else {
      try {
        body = await request.json();
      } catch {
        body = null;
      }
    }
    requests.push({ method, pathname, body, key: request.headers.get('Idempotency-Key') });
    if (method === 'GET' && pathname.endsWith('/clients')) {
      return clientsFail ? json(503, { code: 'unavailable', title: 'Down', status: 503, detail: 'Clients read failed.' }) : json(200, { items: clientRows });
    }
    if (method === 'POST' && pathname.endsWith('/catalog/imports')) {
      return json(201, { importId: 'i-1', mode: 'initial', committedRows: 1, failedRows: 0, skippedRows: 0, errors: [], clientId: 'c-acme' });
    }
    if (method === 'PATCH' && pathname.endsWith('/tax-details')) {
      return json(200, { client: { ...ACME, status: 'active' } });
    }
    if (method === 'POST' && pathname.endsWith('/clients')) {
      const sent = body as { code: string; name: string };
      return json(201, { client: { ...ACME, id: 'c-new', code: sent.code, name: sent.name, status: 'active' } });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  clientRows = [SELF, ACME];
  clientsFail = false;
  stubRouter();
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

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
}

describe('ClientsCard', () => {
  test('the owner reads the list and is offered create + rename (never on the self client)', async () => {
    writeSession(session('owner'));
    view = render(<ClientsCard />);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('Priya Spices (your company)');
    expect(text).toContain('ACME — Acme Foods');
    expect(text).toContain('suspended');
    expect(view.container.querySelector('form[aria-label="New client"]')).not.toBeNull();
    // One Rename — on ACME's row, none on the self row.
    expect(buttons(view.container, 'Rename')).toHaveLength(1);
  });

  for (const role of ['ops_manager', 'accountant', 'operator'] as const) {
    test(`${role} reads the list and is offered no create or rename${role === 'accountant' ? ' (only Tax details — 21-5)' : ', and no Tax details'}`, async () => {
      writeSession(session(role));
      view = render(<ClientsCard />);
      await settle();
      expect(view.container.textContent).toContain('ACME — Acme Foods');
      expect(view.container.querySelector('form[aria-label="New client"]')).toBeNull();
      expect(buttons(view.container, 'Rename')).toHaveLength(0);
      // Story 21-5 — the tax details are billing.invoice's (owner + accountant), never on the self row.
      expect(buttons(view.container, 'Tax details')).toHaveLength(role === 'accountant' ? 1 : 0);
    });
  }

  test('story 21-5: every role reads the tax-details summary; the accountant saves ONLY the changed fields', async () => {
    clientRows = [
      SELF,
      {
        ...ACME,
        taxDetails: {
          legalName: 'Acme Foods Private Limited',
          gstin: null,
          billingLine1: '5 FC Road',
          billingLine2: 'Floor 2',
          billingCity: 'Pune',
          billingStateCode: '27',
          billingPincode: '411001',
        },
      },
    ];
    writeSession(session('accountant'));
    view = render(<ClientsCard />);
    await settle();
    expect(view.container.textContent).toContain('Acme Foods Private Limited · Unregistered · Maharashtra');
    await act(async () => {
      buttons(view!.container, 'Tax details')[0]!.click();
    });
    const form = view.container.querySelector('form[aria-label="Tax details of ACME"]')!;
    const input = (label: string) => form.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    expect(input('Legal name').value).toBe('Acme Foods Private Limited');
    // A GSTIN of another state than the billing state is refused locally — nothing sent.
    setInput(input('GSTIN'), '29aaaca1234a1z5');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
    expect(view.container.textContent).toContain('registered in Karnataka (29)');
    // A matching GSTIN, and line 2 cleared: exactly those two are sent.
    setInput(input('GSTIN'), '27aaaca1234a1z5');
    setInput(input('Address line 2'), '');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    const patch = requests.find((r) => r.method === 'PATCH')!;
    expect(patch.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients/c-acme/tax-details`);
    expect(patch.body).toEqual({ gstin: '27AAACA1234A1Z5', billingLine2: null });
    expect(patch.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('ACME tax details saved');
  });

  test('Add client POSTs the normalized body with an Idempotency-Key and refetches the list', async () => {
    writeSession(session('owner'));
    view = render(<ClientsCard />);
    await settle();
    const form = view.container.querySelector('form[aria-label="New client"]')!;
    const [code, name] = [...form.querySelectorAll('input')] as HTMLInputElement[];
    setInput(code!, ' globex ');
    setInput(name!, 'Globex Ltd');
    const listReadsBefore = requests.filter((r) => r.method === 'GET').length;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    const post = requests.find((r) => r.method === 'POST');
    expect(post?.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients`);
    expect(post?.body).toEqual({ code: 'GLOBEX', name: 'Globex Ltd' });
    expect(post?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('GLOBEX created');
    expect(requests.filter((r) => r.method === 'GET').length).toBeGreaterThan(listReadsBefore);
  });

  test('a reserved code is refused client-side and nothing is sent', async () => {
    writeSession(session('owner'));
    view = render(<ClientsCard />);
    await settle();
    const form = view.container.querySelector('form[aria-label="New client"]')!;
    const [code, name] = [...form.querySelectorAll('input')] as HTMLInputElement[];
    setInput(code!, 'self');
    setInput(name!, 'Me');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
    expect(view.container.textContent).toContain('reserved');
  });
});

describe('ImportCatalogCard — the client field', () => {
  test('one client: the hint line, no picker', async () => {
    clientRows = [SELF];
    writeSession(session('owner'));
    view = render(<ImportCatalogCard />);
    await settle();
    expect(view.container.textContent).toContain(
      'Importing for Priya Spices. Add clients in Settings to import for a brand.',
    );
    expect(view.container.querySelector('select[aria-label="Client"]')).toBeNull();
  });

  test('several clients: a required picker with no default', async () => {
    writeSession(session('owner'));
    view = render(<ImportCatalogCard />);
    await settle();
    const select = view.container.querySelector('select[aria-label="Client"]') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select!.required).toBe(true);
    expect(select!.disabled).toBe(false);
    expect(select!.value).toBe('');
    expect(view.container.textContent).not.toContain('Add clients in Settings');
    const options = [...select!.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual([
      'Choose the client these SKUs belong to',
      'Priya Spices (your company)',
      'ACME — Acme Foods',
    ]);
  });
});

describe('ImportClientField — fix mode', () => {
  test('the inherit hint, no picker — the server names the client on the result', async () => {
    const { ImportClientField } = await import('./import-catalog');
    view = render(
      <ImportClientField
        choice={{ kind: 'inherit', hint: 'A fix run imports for the same client as the latest run it fixes — the result names it.' }}
        clients={[SELF, ACME] as never}
        tenantName="Priya Spices"
        picked="c-self"
        onPick={() => undefined}
      />,
    );
    expect(view.container.querySelector('select')).toBeNull();
    expect(view.container.textContent).toContain('the result names it');
  });
});

describe('ImportCatalogCard — what the import sends', () => {
  function pickFile(container: HTMLElement): void {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['sku_code,name,uom,gst_rate\nA,A,pcs,1800'], 'catalog.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  function choose(select: HTMLSelectElement, value: string): void {
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  async function submit(container: HTMLElement): Promise<void> {
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
  }
  const importBody = () => requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/catalog/imports'))?.body as
    | Record<string, string>
    | undefined;

  test('a multi-client initial import sends the chosen clientId in the multipart body; the result names the client', async () => {
    writeSession(session('owner'));
    view = render(<ImportCatalogCard />);
    await settle();
    pickFile(view.container);
    choose(view.container.querySelector('select[aria-label="Client"]') as HTMLSelectElement, 'c-acme');
    await submit(view.container);
    expect(importBody()?.clientId).toBe('c-acme');
    expect(view.container.textContent).toContain('Imported for ACME — Acme Foods.');
  });

  test('a fix run sends NO clientId (the server inherits the latest run\'s client)', async () => {
    writeSession(session('owner'));
    view = render(<ImportCatalogCard />);
    await settle();
    pickFile(view.container);
    const fix = view.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      fix.click();
    });
    expect(view.container.querySelector('select[aria-label="Client"]')).toBeNull();
    await submit(view.container);
    const body = importBody();
    expect(body?.mode).toBe('fix');
    expect(body !== undefined && 'clientId' in body).toBe(false);
  });

  test('a failed clients read offers Retry, which refetches', async () => {
    clientsFail = true;
    writeSession(session('owner'));
    view = render(<ImportCatalogCard />);
    await settle();
    const retry = buttons(view.container, 'Retry')[0];
    expect(retry).toBeDefined();
    clientsFail = false;
    const before = requests.filter((r) => r.pathname.endsWith('/clients')).length;
    act(() => {
      retry!.click();
    });
    await settle();
    expect(requests.filter((r) => r.pathname.endsWith('/clients')).length).toBe(before + 1);
    expect(view.container.querySelector('select[aria-label="Client"]')).not.toBeNull();
  });
});
