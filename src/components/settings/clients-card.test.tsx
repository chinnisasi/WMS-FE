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
 * Story 21-10 adds: the Status column's words; Suspend / Reactivate only for
 * an owner and only on an eligible row; the PATCH with its Idempotency-Key
 * and `{status}` body; the key reused on a retry of one confirmation and
 * fresh for the next; the list reloaded after success.
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
/** Story 21-10 — how many status PATCHes fail (503) before one succeeds. */
let statusFailures = 0;
/** Story 21-10 — when set, a status PATCH waits for this promise before answering. */
let statusGate: Promise<void> | null = null;
/** Story 1-2a — the contacts the GET answers (and the writes change). */
let contactRows: { id: string; isPrimary: boolean; [key: string]: unknown }[] = [];
/** Story 1-2a — when set, the next departure answers 409 with these blockers. */
let departBlockers: unknown[] | null = null;

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
    if (method === 'PATCH' && pathname.endsWith('/status')) {
      if (statusGate !== null) await statusGate;
      if (departBlockers !== null && (body as { status: string }).status === 'departed') {
        const blockers = departBlockers;
        departBlockers = null;
        return json(409, { code: 'client-not-wound-down', title: 'x', status: 409, detail: 'Client cannot depart while work remains', blockers });
      }
      if (statusFailures > 0) {
        statusFailures -= 1;
        return json(503, { code: 'unavailable', title: 'Down', status: 503, detail: 'Try again.' });
      }
      const id = pathname.split('/').at(-2);
      const status = (body as { status: string }).status;
      clientRows = clientRows.map((row) => ((row as { id: string }).id === id ? { ...(row as object), status } : row));
      return json(200, { client: clientRows.find((row) => (row as { id: string }).id === id) });
    }
    // Story 1-2a — contacts and addresses.
    if (method === 'GET' && pathname.endsWith('/contacts')) {
      return json(200, { items: contactRows });
    }
    if (method === 'POST' && pathname.endsWith('/contacts')) {
      const sent = body as { name: string; email: string; phone: string | null; roles: string[] };
      const contact = { id: `k-${contactRows.length + 1}`, clientId: 'c-acme', ...sent, isPrimary: contactRows.length === 0, createdAt: '', updatedAt: '' };
      contactRows = [...contactRows, contact];
      return json(201, { contact });
    }
    if (method === 'PATCH' && pathname.includes('/contacts/')) {
      const id = pathname.split('/').at(-1);
      const patch = body as { isPrimary?: boolean };
      contactRows = contactRows.map((row) =>
        patch.isPrimary === true ? { ...row, isPrimary: row.id === id } : row.id === id ? { ...row, ...(body as object) } : row,
      );
      return json(200, { contact: contactRows.find((row) => row.id === id) });
    }
    if (method === 'DELETE' && pathname.includes('/contacts/')) {
      const id = pathname.split('/').at(-1);
      const removed = contactRows.find((row) => row.id === id);
      contactRows = contactRows.filter((row) => row.id !== id);
      return json(200, { contact: removed });
    }
    if (method === 'PATCH' && pathname.endsWith('/addresses')) {
      return json(200, { client: { ...ACME, status: 'active', registeredAddress: null, returnAddress: null } });
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
  statusFailures = 0;
  statusGate = null;
  contactRows = [];
  departBlockers = null;
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
    // Story 21-10 — the status reads as a word, never the raw lowercase value.
    expect(text).toContain('Suspended');
    expect(text).not.toContain('suspended');
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
      // Story 21-10 — suspend / reactivate are clients.manage's (owner-only).
      expect(buttons(view.container, 'Suspend')).toHaveLength(0);
      expect(buttons(view.container, 'Reactivate')).toHaveLength(0);
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

  describe('story 21-10: suspend and reactivate', () => {
    const GLOBEX = { ...ACME, id: 'c-globex', code: 'GLOBEX', name: 'Globex Ltd', status: 'active' };
    const GONE = { ...ACME, id: 'c-gone', code: 'GONE', name: 'Gone Brand', status: 'departed' };
    const patches = () => requests.filter((r) => r.method === 'PATCH' && r.pathname.endsWith('/status'));

    async function press(label: string): Promise<void> {
      await act(async () => {
        buttons(view!.container, label)[0]!.click();
      });
      await settle();
    }

    // Story 1-2a changed this pin: a departed brand now offers Reactivate,
    // and Depart joins Suspend (active) and Reactivate (suspended).
    test('the labels render; an owner sees Suspend + Depart on an active brand, Reactivate + Depart on a suspended one, Reactivate on a departed one, nothing on self', async () => {
      clientRows = [SELF, ACME, GLOBEX, GONE];
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      const statusCells = [...view.container.querySelectorAll('tbody tr')].map((row) => row.querySelectorAll('td')[2]?.textContent);
      expect(statusCells).toEqual(['Active', 'Suspended', 'Active', 'Departed']);
      const labels = (word: string) => buttons(view!.container, word).map((b) => b.getAttribute('aria-label'));
      expect(labels('Suspend')).toEqual(['Suspend GLOBEX']);
      expect(labels('Reactivate')).toEqual(['Reactivate ACME', 'Reactivate GONE']);
      expect(labels('Depart')).toEqual(['Depart ACME', 'Depart GLOBEX']);
    });

    test('Suspend confirms, PATCHes {status} with an Idempotency-Key, reloads the list; Reactivate right after uses a fresh key', async () => {
      clientRows = [SELF, GLOBEX];
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await press('Suspend');
      const confirm = view.container.querySelector('[role="group"][aria-label="Confirm suspend"]')!;
      expect(confirm.textContent).toContain(
        'Suspend Globex Ltd? Its portal users are signed out on their next action and cannot sign in or announce shipments; no new portal users can be invited and no new rate card can be drafted or activated. Warehouse work and billing continue (it cannot see invoices in the portal while suspended). Open ASNs stay open.',
      );
      expect(patches()).toHaveLength(0);
      const readsBefore = requests.filter((r) => r.method === 'GET').length;
      await press('Suspend GLOBEX');
      expect(patches()).toHaveLength(1);
      expect(patches()[0]!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients/c-globex/status`);
      expect(patches()[0]!.body).toEqual({ status: 'suspended' });
      expect(patches()[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(view.container.textContent).toContain('Globex Ltd is suspended.');
      expect(requests.filter((r) => r.method === 'GET').length).toBeGreaterThan(readsBefore);
      // The confirmation unmounted on success; the reloaded row offers Reactivate.
      expect(view.container.querySelector('[aria-label="Confirm suspend"]')).toBeNull();
      await press('Reactivate');
      expect(view.container.querySelector('[aria-label="Confirm reactivate"]')!.textContent).toContain(
        'Reactivate Globex Ltd? Its portal users can sign in again.',
      );
      await press('Reactivate GLOBEX');
      expect(patches()).toHaveLength(2);
      expect(patches()[1]!.body).toEqual({ status: 'active' });
      expect(patches()[1]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(patches()[1]!.key).not.toBe(patches()[0]!.key);
      expect(view.container.textContent).toContain('Globex Ltd is active again.');
    });

    test('a failed confirm keeps the confirmation open and its retry reuses the key', async () => {
      clientRows = [SELF, GLOBEX];
      statusFailures = 1;
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await press('Suspend');
      await press('Suspend GLOBEX');
      expect(view.container.textContent).toContain('Not suspended');
      expect(view.container.querySelector('[aria-label="Confirm suspend"]')).not.toBeNull();
      await press('Suspend GLOBEX');
      expect(patches()).toHaveLength(2);
      expect(patches()[1]!.key).toBe(patches()[0]!.key);
      expect(view.container.textContent).toContain('Globex Ltd is suspended.');
    });

    test('Keep is disabled while the request is in flight', async () => {
      clientRows = [SELF, GLOBEX];
      let release!: () => void;
      statusGate = new Promise<void>((resolve) => (release = resolve));
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await press('Suspend');
      expect(buttons(view.container, 'Keep')[0]!.disabled).toBe(false);
      await press('Suspend GLOBEX');
      expect(buttons(view.container, 'Keep')[0]!.disabled).toBe(true);
      release();
      await settle();
      expect(view.container.textContent).toContain('Globex Ltd is suspended.');
    });

    test('a late status response leaves a panel opened meanwhile open and un-overwritten', async () => {
      clientRows = [SELF, GLOBEX];
      let release!: () => void;
      statusGate = new Promise<void>((resolve) => (release = resolve));
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await press('Suspend');
      await press('Suspend GLOBEX');
      // While the suspend is in flight the owner opens Rename on the same row.
      await press('Rename');
      expect(view.container.querySelector('form[aria-label="Rename GLOBEX"]')).not.toBeNull();
      release();
      await settle();
      expect(patches()).toHaveLength(1);
      expect(view.container.querySelector('form[aria-label="Rename GLOBEX"]')).not.toBeNull();
      expect(view.container.textContent).not.toContain('Globex Ltd is suspended.');
      // The list still reloads: the row now offers Reactivate.
      expect(buttons(view.container, 'Reactivate')).toHaveLength(1);
    });

    test('Keep closes the confirmation and sends nothing', async () => {
      clientRows = [SELF, GLOBEX];
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await press('Suspend');
      await press('Keep');
      expect(view.container.querySelector('[aria-label="Confirm suspend"]')).toBeNull();
      expect(patches()).toHaveLength(0);
    });
  });

  describe('story 1-2a: departure, contacts, addresses', () => {
    const GLOBEX = { ...ACME, id: 'c-globex', code: 'GLOBEX', name: 'Globex Ltd', status: 'active' };
    const GONE = { ...ACME, id: 'c-gone', code: 'GONE', name: 'Gone Brand', status: 'departed' };

    async function press(label: string, index = 0): Promise<void> {
      await act(async () => {
        buttons(view!.container, label)[index]!.click();
      });
      await settle();
    }
    async function pressLabelled(ariaLabel: string): Promise<void> {
      await act(async () => {
        (view!.container.querySelector(`button[aria-label="${ariaLabel}"]`) as HTMLButtonElement).click();
      });
      await settle();
    }
    const rowButtons = (code: string) => {
      const row = [...view!.container.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('td')?.textContent === code)!;
      return [...row.querySelectorAll('button')].map((b) => b.textContent);
    };

    test('the self row offers only Contacts and Addresses; a departed row Reactivate, Rename, Tax details, Contacts, Addresses', async () => {
      clientRows = [SELF, GLOBEX, GONE];
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      expect(rowButtons('self')).toEqual(['Contacts', 'Addresses']);
      expect(rowButtons('GONE')).toEqual(['Reactivate', 'Rename', 'Tax details', 'Contacts', 'Addresses']);
      expect(rowButtons('GLOBEX')).toEqual(['Rename', 'Tax details', 'Contacts', 'Addresses', 'Suspend', 'Depart']);
    });

    test('a refused departure lists every blocker in an alert under the confirm, which stays open; the retry reuses the key and departs', async () => {
      clientRows = [SELF, GLOBEX];
      departBlockers = [
        { kind: 'stock', count: 4, codes: ['A', 'B', 'C', 'D'] },
        { kind: 'open-orders', count: 3, codes: ['SO-104', 'SO-109'] },
        { kind: 'future-kind', count: 1 },
      ];
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await press('Depart');
      const confirm = view.container.querySelector('[role="group"][aria-label="Confirm depart"]')!;
      expect(confirm.textContent).toContain('Depart Globex Ltd? It takes no new work from now on');
      await press('Depart GLOBEX');
      const alert = confirm.querySelector('[role="alert"]')!;
      expect([...alert.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'Stock on hand in 4 SKUs: A, B, C, D',
        '3 open orders: SO-104, SO-109 and 1 more',
        '1 other open item (future-kind)',
      ]);
      expect(view.container.querySelector('[aria-label="Confirm depart"]')).not.toBeNull();
      await press('Depart GLOBEX');
      const departs = requests.filter((r) => r.method === 'PATCH' && r.pathname.endsWith('/status'));
      expect(departs.map((r) => r.body)).toEqual([{ status: 'departed' }, { status: 'departed' }]);
      expect(departs[1]!.key).toBe(departs[0]!.key);
      expect(view.container.textContent).toContain('Globex Ltd has departed — it takes no new work, and its history stays.');
      expect(rowButtons('GLOBEX')).toEqual(['Reactivate', 'Rename', 'Tax details', 'Contacts', 'Addresses']);
    });

    test('Contacts: any staff session reads the list, the owner adds (roles as checkboxes), makes one primary and removes one', async () => {
      contactRows = [
        { id: 'k-1', clientId: 'c-acme', name: 'Asha', email: 'asha@acme.example', phone: null, roles: ['operations'], isPrimary: true, createdAt: '', updatedAt: '' },
      ];
      writeSession(session('operator'));
      view = render(<ClientsCard />);
      await settle();
      await pressLabelled('Contacts of ACME');
      const panel = () => view!.container.querySelector('section[aria-labelledby]')!;
      expect(panel().textContent).toContain('Contacts — ACME');
      expect(panel().textContent).toContain('asha@acme.example · Operations');
      expect(buttons(view.container, 'Add contact')).toHaveLength(0);
      expect(buttons(view.container, 'Edit')).toHaveLength(0);
      view.unmount();

      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await pressLabelled('Contacts of ACME');
      // Focus moved to the panel's heading, which names the client code.
      expect(document.activeElement?.textContent).toBe('Contacts — ACME');
      await press('Add contact');
      const form = view.container.querySelector('form[aria-label="Add contact for ACME"]')!;
      const [name, email, phone] = [...form.querySelectorAll('input:not([type="checkbox"])')] as HTMLInputElement[];
      setInput(name!, ' Ravi ');
      setInput(email!, ' Ravi@Acme.Example ');
      setInput(phone!, '');
      const fieldset = form.querySelector('fieldset')!;
      expect(fieldset.querySelector('legend')?.textContent).toContain('Roles');
      const boxes = [...fieldset.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
      await act(async () => {
        boxes[2]!.click(); // returns
        boxes[1]!.click(); // billing
      });
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await settle();
      const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/contacts'))!;
      expect(post.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients/c-acme/contacts`);
      expect(post.body).toEqual({ name: 'Ravi', email: 'ravi@acme.example', phone: null, roles: ['billing', 'returns'] });
      expect(post.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(view.container.textContent).toContain('Ravi added');

      await pressLabelled('Make Ravi primary');
      // The confirmation's own button (the row's carries the same words).
      await act(async () => {
        (view!.container.querySelector('[aria-label="Confirm make primary"] button') as HTMLButtonElement).click();
      });
      await settle();
      const primary = requests.find((r) => r.method === 'PATCH' && r.pathname.includes('/contacts/'))!;
      expect(primary.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients/c-acme/contacts/k-2`);
      expect(primary.body).toEqual({ isPrimary: true });

      await pressLabelled('Remove Asha');
      await press('Remove contact');
      const removed = requests.find((r) => r.method === 'DELETE')!;
      expect(removed.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients/c-acme/contacts/k-1`);
      expect(removed.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(view.container.textContent).toContain('Asha removed');
    });

    test('opening another panel over a dirty contact draft asks first; Keep editing stays, Discard switches', async () => {
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await pressLabelled('Contacts of ACME');
      await press('Add contact');
      const form = view.container.querySelector('form[aria-label="Add contact for ACME"]')!;
      setInput(form.querySelector('input') as HTMLInputElement, 'Half typed');
      await pressLabelled('Addresses of ACME');
      expect(view.container.querySelector('[aria-label="Discard unsaved changes"]')).not.toBeNull();
      await press('Keep editing');
      expect(view.container.querySelector('form[aria-label="Add contact for ACME"]')).not.toBeNull();
      await pressLabelled('Addresses of ACME');
      await press('Discard');
      expect(view.container.querySelector('form[aria-label="Add contact for ACME"]')).toBeNull();
      expect(view.container.textContent).toContain('Addresses — ACME');
    });

    test('re-clicking the open panel for the same client is a no-op: the draft stays dirty and another panel still asks', async () => {
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await pressLabelled('Contacts of ACME');
      await press('Add contact');
      const form = view.container.querySelector('form[aria-label="Add contact for ACME"]')!;
      setInput(form.querySelector('input') as HTMLInputElement, 'Half typed');
      await pressLabelled('Contacts of ACME');
      expect(view.container.querySelector('form[aria-label="Add contact for ACME"]')).not.toBeNull();
      expect(view.container.querySelector('[aria-label="Discard unsaved changes"]')).toBeNull();
      await pressLabelled('Addresses of ACME');
      expect(view.container.querySelector('[aria-label="Discard unsaved changes"]')).not.toBeNull();
    });

    test('Addresses: saving one group keeps an unsaved edit in the other (still dirty — another panel asks)', async () => {
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await pressLabelled('Addresses of ACME');
      const returnForm = view.container.querySelector('form[aria-label="Return address of ACME"]')!;
      const contactName = returnForm.querySelector('input') as HTMLInputElement;
      setInput(contactName, 'Returns desk');
      const form = view.container.querySelector('form[aria-label="Registered address of ACME"]')!;
      const [line1, , city, pincode] = [...form.querySelectorAll('input')] as HTMLInputElement[];
      setInput(line1!, '4th Floor');
      setInput(city!, 'Mumbai');
      setInput(pincode!, '400001');
      const state = form.querySelector('select') as HTMLSelectElement;
      await act(async () => {
        state.value = '27';
        state.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await settle();
      expect(view.container.textContent).toContain('Registered address saved');
      expect((view.container.querySelector('form[aria-label="Return address of ACME"] input') as HTMLInputElement).value).toBe('Returns desk');
      await pressLabelled('Contacts of ACME');
      expect(view.container.querySelector('[aria-label="Discard unsaved changes"]')).not.toBeNull();
    });

    test('Addresses: saving a group sends only that group; Clear asks, then sends null', async () => {
      clientRows = [SELF, { ...ACME, returnAddress: { contactName: 'Desk', phone: '1', line1: 'L1', city: 'Pune', state: 'Maharashtra', pincode: '411001' }, registeredAddress: null }];
      writeSession(session('owner'));
      view = render(<ClientsCard />);
      await settle();
      await pressLabelled('Addresses of ACME');
      const form = view.container.querySelector('form[aria-label="Registered address of ACME"]')!;
      const [line1, , city, pincode] = [...form.querySelectorAll('input')] as HTMLInputElement[];
      setInput(line1!, '4th Floor');
      setInput(city!, 'Mumbai');
      setInput(pincode!, '400001');
      const state = form.querySelector('select') as HTMLSelectElement;
      await act(async () => {
        state.value = '27';
        state.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await settle();
      const saved = requests.find((r) => r.method === 'PATCH' && r.pathname.endsWith('/addresses'))!;
      expect(saved.body).toEqual({ registered: { line1: '4th Floor', city: 'Mumbai', stateCode: '27', pincode: '400001' } });
      expect(saved.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      view.unmount();

      requests = [];
      view = render(<ClientsCard />);
      await settle();
      await pressLabelled('Addresses of ACME');
      await press('Clear');
      expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
      await press('Clear return address');
      const cleared = requests.find((r) => r.method === 'PATCH' && r.pathname.endsWith('/addresses'))!;
      expect(cleared.body).toEqual({ return: null });
    });
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

  // Story 1-2a — the gate counts every client; only the options drop a
  // departed one: self + one departed brand still asks (never a forced 400).
  test('a departed client is not offered, yet still makes the picker required', async () => {
    clientRows = [SELF, { ...ACME, status: 'departed' }];
    writeSession(session('owner'));
    view = render(<ImportCatalogCard />);
    await settle();
    const select = view.container.querySelector('select[aria-label="Client"]') as HTMLSelectElement;
    expect(select.required).toBe(true);
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Choose the client these SKUs belong to',
      'Priya Spices (your company)',
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
