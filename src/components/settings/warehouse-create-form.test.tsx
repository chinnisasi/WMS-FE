import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { WarehouseCreateForm } from './warehouse-create-form';

/**
 * The warehouse GSTIN input (story 8-1c), driven through a stubbed global
 * `fetch` so the body under test is the one the shipped wrapper sends:
 *   1. a typed GSTIN rides the POST body trimmed and uppercased,
 *   2. a blank GSTIN sends NO `gstin` key,
 *   3. a malformed GSTIN sends nothing and the rejected banner names it,
 *   4. the success banner echoes the GSTIN the server stored, and the field resets.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

let posts: { body: Record<string, unknown>; key: string | null }[] = [];
/** When set, the stub answers with THIS stored GSTIN whatever was typed. */
let storedGstin: string | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'POST' && pathname.endsWith(`/tenants/${TENANT_ID}/warehouses`)) {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push({ body, key: request.headers.get('Idempotency-Key') });
      return json(201, {
        id: 'wh-1',
        tenantId: TENANT_ID,
        code: body.code,
        name: body.name,
        origin: body.origin,
        // The server's stored value — the banner must echo THIS.
        gstin: storedGstin ?? (body.gstin as string | undefined) ?? null,
        createdAt: '2026-10-03T00:00:00.000Z',
      });
    }
    // The warehouse list read the switcher etc. may fire — empty.
    if (method === 'GET') return json(200, { items: [], nextCursor: null });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  posts = [];
  storedGstin = undefined;
  stubRouter();
  writeSession(SESSION);
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

/** A controlled React input needs the native setter or React never sees it. */
function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (l) => l.querySelector('span')?.textContent === label,
  );
  expect(found).toBeDefined();
  return found!.querySelector('input')!;
}

function fill(container: HTMLElement, gstin: string): void {
  setInput(field(container, 'Code'), 'BLR-01');
  setInput(field(container, 'Name'), 'Whitefield');
  setInput(field(container, 'Contact name'), 'Priya Sharma');
  setInput(field(container, 'Phone'), '+91 98450 12345');
  setInput(field(container, 'Address line 1'), '12, Peenya Industrial Area');
  setInput(field(container, 'City'), 'Bengaluru');
  setInput(field(container, 'State'), 'Karnataka');
  setInput(field(container, 'Pincode'), '560066');
  setInput(field(container, 'Warehouse GSTIN (optional)'), gstin);
}

async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form')!;
  act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

describe('WarehouseCreateForm: the GSTIN input (story 8-1c)', () => {
  test('the GSTIN input carries no pattern, a loose cap, and the help copy', async () => {
    view = render(<WarehouseCreateForm />);
    await settle();
    const input = field(view.container, 'Warehouse GSTIN (optional)');
    expect(input.hasAttribute('pattern')).toBe(false);
    expect(input.maxLength).toBe(20);
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.getAttribute('spellcheck')).toBe('false');
    const help = view.container.querySelector(`#${CSS.escape(input.getAttribute('aria-describedby')!)}`);
    expect(help!.textContent).toBe("Can't be changed after creation yet.");
  });

  test('a typed GSTIN is sent trimmed and uppercased, echoed from the response, then reset', async () => {
    view = render(<WarehouseCreateForm />);
    await settle();
    fill(view.container, ' 29aapcd1234k1z5 ');
    await submit(view.container);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.gstin).toBe('29AAPCD1234K1Z5');
    expect(posts[0]!.key).not.toBeNull();
    const banner = view.container.querySelector('[role="status"]')!.textContent;
    expect(banner).toContain("GSTIN 29AAPCD1234K1Z5 — can't be changed later.");
    expect(field(view.container, 'Warehouse GSTIN (optional)').value).toBe('');
  });

  test('a blank GSTIN sends no gstin key, and the banner says nothing of one', async () => {
    view = render(<WarehouseCreateForm />);
    await settle();
    fill(view.container, '   ');
    await submit(view.container);

    expect(posts).toHaveLength(1);
    expect('gstin' in posts[0]!.body).toBe(false);
    expect(view.container.querySelector('[role="status"]')!.textContent).not.toContain('GSTIN');
  });

  test('a malformed GSTIN sends nothing and the rejected banner names the field', async () => {
    view = render(<WarehouseCreateForm />);
    await settle();
    fill(view.container, '29ABC');
    await submit(view.container);

    expect(posts).toHaveLength(0);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain(
      'Warehouse GSTIN is 15 characters',
    );
    // The refusal comes before setPending: the button stays enabled.
    const button = view.container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    // The draft survives the refusal.
    expect(field(view.container, 'Warehouse GSTIN (optional)').value).toBe('29ABC');
  });

  test('the banner echoes the GSTIN the server STORED, not the one typed', async () => {
    storedGstin = '29ZZZZZ9999Z9Z9';
    view = render(<WarehouseCreateForm />);
    await settle();
    fill(view.container, '29aapcd1234k1z5');
    await submit(view.container);

    expect(posts[0]!.body.gstin).toBe('29AAPCD1234K1Z5');
    const banner = view.container.querySelector('[role="status"]')!.textContent;
    expect(banner).toContain('GSTIN 29ZZZZZ9999Z9Z9');
    expect(banner).not.toContain('29AAPCD1234K1Z5');
  });
});
