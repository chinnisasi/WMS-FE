import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { PartnersCard } from './partners-card';

/**
 * Story 1-3 — the claims a `src/lib` test cannot make:
 *   1. every role reads the partner list (roles, GSTIN, status, linked
 *      clients — the self client as "Your company");
 *   2. without `vendor.manage` (operator, accountant) no Add / Edit / Links /
 *      Deactivate is offered — absent, not disabled;
 *   3. Add partner POSTs the parsed body (PAN derived from the GSTIN) with an
 *      Idempotency-Key, and the list reloads;
 *   4. Link POSTs `{clientId, role, isDefault}` to the partner's links path;
 *   5. Deactivate PATCHes `{status: 'inactive', reason}` to the status path;
 *   6. a refusal is worded from its `code`.
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
const ACME = { ...SELF, id: 'c-acme', code: 'ACME', name: 'Acme Foods', systemOwned: false };

function partner(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p-1',
    tenantId: TENANT_ID,
    code: 'V-1',
    name: 'Prime Foods',
    legalName: null,
    gstin: '27ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    roles: ['vendor'],
    registeredAddress: null,
    dispatchAddress: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    status: 'active',
    inactiveReason: null,
    links: [{ id: 'l-1', clientId: 'c-self', role: 'vendor', active: true, isDefault: true, clientCode: null }],
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    ...over,
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
}
let requests: Recorded[] = [];
let partnerRows: Record<string, unknown>[] = [];
let refusal: { status: number; code: string; detail: string } | null = null;
/** When set, the list read stops carrying p-1 (as if it sat on a later page). */
let hideP1 = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, body, key: request.headers.get('Idempotency-Key') });
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [SELF, ACME] });
    if (method === 'GET' && pathname.endsWith('/partners')) return json(200, { items: hideP1 ? partnerRows.filter((row) => row.id !== 'p-1') : partnerRows, nextCursor: null });
    if (refusal !== null && method !== 'GET') {
      const r = refusal;
      refusal = null;
      return json(r.status, { code: r.code, title: 't', status: r.status, detail: r.detail });
    }
    if (method === 'POST' && pathname.endsWith('/partners')) {
      const created = partner({ id: 'p-2', ...(body as object), links: [] });
      partnerRows = [...partnerRows, created];
      return json(201, { partner: created });
    }
    if (method === 'POST' && pathname.endsWith('/links')) {
      const sent = body as { clientId: string; role: string; isDefault?: boolean };
      partnerRows = partnerRows.map((row) =>
        row.id === 'p-1'
          ? { ...row, links: [...(row.links as unknown[]), { id: 'l-2', clientId: sent.clientId, role: sent.role, active: true, isDefault: sent.isDefault ?? false, clientCode: null }] }
          : row,
      );
      return json(201, { partner: partnerRows[0] });
    }
    if (method === 'PATCH' && pathname.includes('/links/')) {
      const sent = body as { active?: boolean };
      partnerRows = partnerRows.map((row) =>
        row.id === 'p-1'
          ? { ...row, links: (row.links as { active: boolean }[]).map((l) => ({ ...l, ...(sent.active === undefined ? {} : { active: sent.active, isDefault: false }) })) }
          : row,
      );
      return json(200, { partner: partnerRows[0] });
    }
    if (method === 'PATCH' && pathname.endsWith('/status')) {
      const sent = body as { status: string; reason?: string };
      partnerRows = partnerRows.map((row) => (row.id === 'p-1' ? { ...row, status: sent.status, inactiveReason: sent.reason ?? null } : row));
      return json(200, { partner: partnerRows[0] });
    }
    return json(404, { code: 'not-found', title: 'x', status: 404, detail: 'unrouted' });
  }) as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  partnerRows = [partner()];
  refusal = null;
  hideP1 = false;
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

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
  await settle();
}

function inputLabelled(scope: Element, label: string): HTMLInputElement {
  const found = [...scope.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === label);
  if (found === undefined) throw new Error(`no field "${label}"`);
  return found.querySelector('input, select') as HTMLInputElement;
}

describe('PartnersCard', () => {
  test('the owner reads the list (self client as "Your company") and is offered every action', async () => {
    writeSession(session('owner'));
    view = render(<PartnersCard />);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('Prime Foods');
    expect(text).toContain('27ABCDE1234F1Z5');
    expect(text).toContain('Your company (Vendor, default)');
    expect(buttons(view.container, 'Add partner')).toHaveLength(1);
    expect(buttons(view.container, 'Edit')).toHaveLength(1);
    expect(buttons(view.container, 'Links')).toHaveLength(1);
    expect(buttons(view.container, 'Deactivate')).toHaveLength(1);
  });

  for (const role of ['operator', 'accountant'] as const) {
    test(`${role} reads the list read-only — no add, edit, links or status action`, async () => {
      writeSession(session(role));
      view = render(<PartnersCard />);
      await settle();
      expect(view.container.textContent).toContain('Prime Foods');
      for (const label of ['Add partner', 'Edit', 'Links', 'Deactivate', 'Reactivate']) {
        expect(buttons(view.container, label)).toHaveLength(0);
      }
      expect(requests.every((r) => r.method === 'GET')).toBe(true);
    });
  }

  test('Add partner POSTs the parsed body — the PAN derived from the GSTIN — with a key, and reloads the list', async () => {
    writeSession(session('owner'));
    view = render(<PartnersCard />);
    await settle();
    await click(buttons(view.container, 'Add partner')[0]!);
    const formEl = view.container.querySelector('form[aria-label="New partner"]')!;
    setValue(inputLabelled(formEl, 'Code'), ' V-2 ');
    setValue(inputLabelled(formEl, 'Name'), 'Deccan Packaging');
    setValue(inputLabelled(formEl, 'GSTIN'), '29zzzzz9999z1z5');
    // The PAN field followed the GSTIN.
    expect(inputLabelled(formEl, 'PAN').value).toBe('ZZZZZ9999Z');
    const readsBefore = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/partners')).length;
    await act(async () => {
      (formEl as HTMLFormElement).requestSubmit();
    });
    await settle();
    const posts = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/partners'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ code: 'V-2', name: 'Deccan Packaging', roles: ['vendor'], gstin: '29ZZZZZ9999Z1Z5', pan: 'ZZZZZ9999Z' });
    expect(posts[0]!.key).not.toBeNull();
    expect(view.container.textContent).toContain('V-2 added');
    expect(requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/partners')).length).toBeGreaterThan(readsBefore);
  });

  test('a refusal is worded from its code', async () => {
    writeSession(session('owner'));
    view = render(<PartnersCard />);
    await settle();
    await click(buttons(view.container, 'Add partner')[0]!);
    const formEl = view.container.querySelector('form[aria-label="New partner"]')!;
    setValue(inputLabelled(formEl, 'Code'), 'V-1');
    setValue(inputLabelled(formEl, 'Name'), 'Dup');
    refusal = { status: 409, code: 'partner-code-taken', detail: 'Partner code "V-1" is already used by another partner of this tenant.' };
    await act(async () => {
      (formEl as HTMLFormElement).requestSubmit();
    });
    await settle();
    expect(view.container.textContent).toContain('Not added');
    expect(view.container.textContent).toContain('Partner code "V-1" is already used');
  });

  test('Link POSTs the client, role and default flag to the partner\'s links path', async () => {
    writeSession(session('owner'));
    view = render(<PartnersCard />);
    await settle();
    await click(buttons(view.container, 'Links')[0]!);
    const linkForm = view.container.querySelector('form[aria-label="Link V-1 to a client"]')!;
    const clientSelect = inputLabelled(linkForm, 'Client') as unknown as HTMLSelectElement;
    // The self client is offered as "Your company".
    expect([...clientSelect.querySelectorAll('option')].map((o) => o.textContent)).toContain('Your company');
    setValue(clientSelect, 'c-acme');
    const defaultBox = [...linkForm.querySelectorAll('input[type="checkbox"]')][0] as HTMLInputElement;
    await click(defaultBox);
    await act(async () => {
      (linkForm as HTMLFormElement).requestSubmit();
    });
    await settle();
    const posts = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/partners/p-1/links'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ clientId: 'c-acme', role: 'vendor', isDefault: true });
    expect(posts[0]!.key).not.toBeNull();
    expect(view.container.textContent).toContain('ACME (Vendor, default)');
  });

  test('code review — the links panel shows the partner the server returned, even when the reloaded list page no longer carries it', async () => {
    writeSession(session('owner'));
    view = render(<PartnersCard />);
    await settle();
    await click(buttons(view.container, 'Links')[0]!);
    hideP1 = true; // the reload after the link lands on a page without p-1
    const linkForm = view.container.querySelector('form[aria-label="Link V-1 to a client"]')!;
    setValue(inputLabelled(linkForm, 'Client') as unknown as HTMLSelectElement, 'c-acme');
    await act(async () => {
      (linkForm as HTMLFormElement).requestSubmit();
    });
    await settle();
    const links = view.container.querySelector('[aria-label="Client links of V-1"] ul[aria-label="Links"]')!;
    expect(links.querySelectorAll('li')).toHaveLength(2);
    expect(links.textContent).toContain('ACME');
  });

  test('code review — a client-code problem clears on the next link action', async () => {
    writeSession(session('owner'));
    view = render(<PartnersCard />);
    await settle();
    await click(buttons(view.container, 'Links')[0]!);
    await click(buttons(view.container, 'Edit code')[0]!);
    setValue(view.container.querySelector('input[aria-label="Client\'s code"]') as HTMLInputElement, 'X'.repeat(65));
    await click(buttons(view.container, 'Save code')[0]!);
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('at most 64');
    await click(buttons(view.container, 'Cancel')[0]!);
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    await click(buttons(view.container, 'Edit code')[0]!);
    setValue(view.container.querySelector('input[aria-label="Client\'s code"]') as HTMLInputElement, 'X'.repeat(65));
    await click(buttons(view.container, 'Save code')[0]!);
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    await click(buttons(view.container, 'Switch off')[0]!);
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
  });

  test('Deactivate PATCHes the status path with the reason', async () => {
    writeSession(session('owner'));
    view = render(<PartnersCard />);
    await settle();
    await click(buttons(view.container, 'Deactivate')[0]!);
    const group = view.container.querySelector('[aria-label="Confirm deactivate"]')!;
    setValue(group.querySelector('input') as HTMLInputElement, 'stopped trading');
    await click(buttons(view.container, 'Deactivate V-1')[0]!);
    const patches = requests.filter((r) => r.method === 'PATCH' && r.pathname.endsWith('/partners/p-1/status'));
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ status: 'inactive', reason: 'stopped trading' });
    expect(patches[0]!.key).not.toBeNull();
    expect(view.container.textContent).toContain('Inactive — stopped trading');
    expect(buttons(view.container, 'Reactivate')).toHaveLength(1);
  });
});
