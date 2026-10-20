import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { Licences } from './licences';

/**
 * Story 1-6c — Compliance → Licences. The claims a `src/lib` test cannot make:
 *   1. the gaps render first, worded from each gap's `coveredBy`, and "All
 *      drug and food goods are covered" when there are none;
 *   2. the table shows the SERVER's badge (state and days) — no browser clock;
 *   3. a role without `licences.manage` reads everything and is offered no
 *      mutating affordance at all (absent, not disabled);
 *   4. pressing Add sends the parsed body under a key that a retry reuses and
 *      an edit clears; Withdraw sends the withdraw verb; a refusal is worded;
 *   5. a withdrawn licence offers no row action;
 *   6. a failed read renders its reason with a Retry that re-reads.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ACME = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';
const SELF = '0198f7a2-1b3c-7d4e-8f90-0000000000c0';
const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';

function session(role: 'owner' | 'ops_manager'): StoredSession {
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

function licence(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'l-1',
    holder: 'client',
    clientId: ACME,
    warehouseId: W1,
    kind: 'drug-20b',
    number: 'MH/PUN/20B 12',
    validFrom: null,
    validUntil: '2026-12-31',
    note: null,
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    expiryState: 'upcoming',
    daysLeft: 60,
    ...extra,
  };
}

let requests: { method: string; pathname: string; key: string | null; body: unknown }[] = [];
let items: Record<string, unknown>[] = [];
let gaps: Record<string, unknown>[] = [];
let listFails = false;
let addAnswer: () => Response = () => json(201, { licence: licence({ id: 'l-new' }) });
/** Story 1-6d — the switch the policy GET reads, and the PUT answers in order (the last repeats). */
let policy: { enforce: boolean; gapCount: number } = { enforce: false, gapCount: 1 };
let putAnswers: (() => Response)[] = [];

beforeEach(() => {
  requests = [];
  listFails = false;
  items = [
    licence({}),
    licence({ id: 'l-2', holder: 'site', clientId: null, kind: 'fssai-state', number: '10012345678901', validUntil: '2027-03-31', expiryState: 'valid', daysLeft: 150 }),
    licence({ id: 'l-3', number: 'OLD-1', status: 'withdrawn', expiryState: 'withdrawn', daysLeft: null }),
  ];
  gaps = [{ holder: 'client', clientId: ACME, warehouseId: W1, need: 'drug-20g', coveredBy: ['drug-20g'], skuCount: 2 }];
  addAnswer = () => json(201, { licence: licence({ id: 'l-new' }) });
  policy = { enforce: false, gapCount: 1 };
  putAnswers = [];
  stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input.toString(), init);
    const url = new URL(request.url);
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method: request.method, pathname: url.pathname, key: request.headers.get('Idempotency-Key'), body });
    if (request.method === 'GET' && url.pathname.endsWith('/licences/coverage')) return json(200, { asOfDate: '2026-11-01', gaps });
    if (request.method === 'GET' && url.pathname.endsWith('/licence-policy')) return json(200, policy);
    if (request.method === 'PUT' && url.pathname.endsWith('/licence-policy')) {
      const answer = putAnswers.length > 1 ? putAnswers.shift()! : putAnswers[0];
      if (answer !== undefined) return answer();
      const enforce = (body as { enforce: boolean }).enforce;
      policy = { ...policy, enforce };
      return json(200, policy);
    }
    if (request.method === 'GET' && url.pathname.endsWith('/licences')) {
      if (listFails) return json(500, { type: 'about:blank', title: 'Boom', status: 500, code: 'internal', detail: 'The licence read failed.' });
      return json(200, { asOfDate: '2026-11-01', items });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/licences')) return addAnswer();
    if (request.method === 'PATCH' && url.pathname.endsWith('/licences/l-1')) return json(200, { licence: licence({ note: 'renewed' }) });
    if (request.method === 'POST' && url.pathname.endsWith('/withdraw')) return json(200, { licence: licence({ status: 'withdrawn' }) });
    if (request.method === 'GET' && url.pathname.endsWith('/clients')) {
      return json(200, {
        items: [
          { id: SELF, code: 'self', name: 'Priya Spices', status: 'active', systemOwned: true },
          { id: ACME, code: 'ACME', name: 'Acme Foods', status: 'active', systemOwned: false },
        ],
      });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/warehouses')) {
      return json(200, { items: [{ id: W1, code: 'WH-PUN', name: 'Pune DC', origin: {}, createdAt: '2026-09-01T00:00:00.000Z' }], nextCursor: null });
    }
    return json(404, { code: 'not-found', status: 404 });
  }) as unknown as typeof fetch);
});

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
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

async function press(button: HTMLButtonElement | undefined | null): Promise<void> {
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
  await settle();
}

function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function mount(role: 'owner' | 'ops_manager'): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(<Licences />);
  await settle();
  return rendered;
}

describe('Licences', () => {
  test('the gaps first, worded from coveredBy; then the table with the server’s badge and IST dates', async () => {
    view = await mount('owner');
    const gapList = view.container.querySelector('ul[aria-label="Coverage gaps"]')!;
    expect(gapList.textContent).toBe('ACME at WH-PUN — client licence needed: Form 20G (2 SKUs)');
    const rows = [...view.container.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('ACME');
    expect(rows[0]).toContain('WH-PUN');
    expect(rows[0]).toContain('Form 20B');
    expect(rows[0]).toContain('31 Dec 2026');
    expect(rows[0]).toContain('Expires in 60 days');
    expect(rows[1]).toContain('Site');
    expect(rows[1]).toContain('FSSAI state licence');
    expect(rows[1]).toContain('Valid');
    expect(rows[2]).toContain('Withdrawn');
  });

  test('no gaps: "All drug and food goods are covered"', async () => {
    gaps = [];
    view = await mount('owner');
    expect(view.container.querySelector('ul[aria-label="Coverage gaps"]')).toBeNull();
    expect(view.container.textContent).toContain('All drug and food goods are covered');
  });

  test('an ops manager reads everything and is offered no mutating affordance', async () => {
    view = await mount('ops_manager');
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(buttonNamed(view.container, 'Add licence')).toBeUndefined();
    expect(buttonNamed(view.container, 'Edit')).toBeUndefined();
    expect(buttonNamed(view.container, 'Withdraw')).toBeUndefined();
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  test('a withdrawn licence offers no row action; an active one offers Edit and Withdraw', async () => {
    view = await mount('owner');
    const rows = [...view.container.querySelectorAll('tbody tr')];
    expect(rows[0]!.querySelectorAll('button')).toHaveLength(2);
    expect(rows[2]!.querySelectorAll('button')).toHaveLength(0);
  });

  test('Add sends the parsed body under one key; a retry reuses it, an edit mints a new one; a refusal is worded', async () => {
    let answered = 0;
    addAnswer = () => {
      answered += 1;
      return answered === 1
        ? json(409, { type: 'about:blank', title: 'x', status: 409, code: 'licence-number-taken', detail: 'x' })
        : json(201, { licence: licence({ id: 'l-new', number: 'X-1', kind: 'drug-20g' }) });
    };
    view = await mount('owner');
    await press(buttonNamed(view.container, 'Add licence'));
    const form = view.container.querySelector<HTMLFormElement>('form[aria-label="Add licence"]')!;
    const selects = form.querySelectorAll('select');
    setValue(selects[0]!, ACME); // client — the self client is never offered
    expect([...selects[0]!.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose a client', 'ACME — Acme Foods']);
    setValue(selects[1]!, W1);
    setValue(selects[2]!, 'drug-20g');
    const number = form.querySelector<HTMLInputElement>('input:not([type])')!;
    setValue(number, ' x-1 ');
    await press(form.querySelector<HTMLButtonElement>('button[type="submit"]'));
    const first = requests.filter((r) => r.method === 'POST');
    expect(first).toHaveLength(1);
    expect(first[0]!.body).toEqual({ clientId: ACME, warehouseId: W1, kind: 'drug-20g', number: 'X-1' });
    expect(view.container.textContent).toContain('Another active licence of this family already carries that number');
    // A retry of the unchanged draft reuses the key; editing the draft mints a new one.
    await press(form.querySelector<HTMLButtonElement>('button[type="submit"]'));
    const posts = requests.filter((r) => r.method === 'POST');
    expect(posts[1]!.key).toBe(posts[0]!.key);
    expect(view.container.textContent).toContain('Licence added');
  });

  test('an edited draft drops the retry key', async () => {
    addAnswer = () => json(409, { type: 'about:blank', title: 'x', status: 409, code: 'conflict', detail: 'x' });
    view = await mount('owner');
    await press(buttonNamed(view.container, 'Add licence'));
    const form = view.container.querySelector<HTMLFormElement>('form[aria-label="Add licence"]')!;
    setValue(form.querySelectorAll('select')[0]!, ACME);
    setValue(form.querySelector<HTMLInputElement>('input:not([type])')!, 'A-1');
    await press(form.querySelector<HTMLButtonElement>('button[type="submit"]'));
    setValue(form.querySelector<HTMLInputElement>('input:not([type])')!, 'A-2');
    await press(form.querySelector<HTMLButtonElement>('button[type="submit"]'));
    const posts = requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.key).not.toBe(posts[0]!.key);
  });

  test('a client-side problem sends nothing', async () => {
    view = await mount('owner');
    await press(buttonNamed(view.container, 'Add licence'));
    const form = view.container.querySelector<HTMLFormElement>('form[aria-label="Add licence"]')!;
    setValue(form.querySelectorAll('select')[0]!, ACME);
    setValue(form.querySelectorAll('select')[2]!, 'ndps');
    setValue(form.querySelector<HTMLInputElement>('input:not([type])')!, 'N-1');
    await press(form.querySelector<HTMLButtonElement>('button[type="submit"]'));
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(form.querySelector('[role="alert"]')!.textContent).toContain('Valid until: required');
  });

  test('Edit → Save sends ONE PATCH with the four editable fields and a key; holder, site and kind are fixed', async () => {
    view = await mount('owner');
    await press(view.container.querySelector<HTMLButtonElement>('button[aria-label="Edit MH/PUN/20B 12"]'));
    const form = view.container.querySelector<HTMLFormElement>('form[aria-label="Edit licence"]')!;
    expect(form.querySelector('fieldset')!.disabled).toBe(true);
    const selects = [...form.querySelectorAll('select')];
    expect(selects).toHaveLength(3); // client, site, kind
    expect(selects.every((select) => select.disabled)).toBe(true);
    setValue(form.querySelectorAll<HTMLInputElement>('input:not([type])')[1]!, 'renewed'); // the note
    await press(form.querySelector<HTMLButtonElement>('button[type="submit"]'));
    const writes = requests.filter((r) => r.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.method).toBe('PATCH');
    expect(writes[0]!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/licences/l-1`);
    expect(writes[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(writes[0]!.body).toEqual({ number: 'MH/PUN/20B 12', validFrom: null, validUntil: '2026-12-31', note: 'renewed' });
    expect(view.container.textContent).toContain('Licence saved');
  });

  test('Withdraw confirms, then sends the withdraw verb with a key', async () => {
    view = await mount('owner');
    await press(view.container.querySelector<HTMLButtonElement>('button[aria-label="Withdraw MH/PUN/20B 12"]'));
    await press(buttonNamed(view.container, 'Withdraw licence'));
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/licences/l-1/withdraw`);
    expect(post.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('Licence withdrawn');
  });

  test('a failed read renders its reason and a Retry that re-reads', async () => {
    listFails = true;
    view = await mount('owner');
    expect(view.container.textContent).toContain('Licences not loaded');
    expect(view.container.textContent).toContain('The licence read failed.');
    listFails = false;
    await press(buttonNamed(view.container, 'Retry'));
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(3);
  });
});

describe('story 1-6d — Enforce licences', () => {
  function section(container: HTMLElement): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>('section')].find((el) => el.querySelector('h2')?.textContent === 'Enforce licences');
    expect(found).toBeTruthy();
    return found!;
  }
  const puts = () => requests.filter((r) => r.method === 'PUT');

  test('the section sits above the gaps; an ops manager reads the state with no action', async () => {
    view = await mount('ops_manager');
    const headings = [...view.container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings.indexOf('Enforce licences')).toBeLessThan(headings.indexOf('Coverage gaps'));
    const enforce = section(view.container);
    expect(enforce.textContent).toContain('Off — licences are recorded');
    expect(enforce.querySelectorAll('button')).toHaveLength(0);
  });

  test('an owner turns it on with known gaps: the question names N and the PUT acknowledges them', async () => {
    policy = { enforce: false, gapCount: 3 };
    view = await mount('owner');
    await press(buttonNamed(section(view.container), 'Turn on'));
    expect(section(view.container).textContent).toContain(
      'Turn on with 3 known coverage gaps? Uncovered receipts, including goods on open POs and ASNs, will go to review, and orders will be refused.',
    );
    await press(buttonNamed(section(view.container), 'Turn on'));
    expect(puts()).toHaveLength(1);
    expect(puts()[0]!.body).toEqual({ enforce: true, acknowledgeGaps: true });
    expect(puts()[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('Enforcement on');
    // The policy GET re-read on notifyLicencesChanged: the state line follows.
    expect(section(view.container).textContent).toContain('On — a receipt line of drug or food goods');
  });

  test('gaps appeared since the read: the 409 opens a fresh, re-keyed confirmation that names them and acknowledges', async () => {
    policy = { enforce: false, gapCount: 0 };
    putAnswers = [
      () => json(409, { code: 'licence-gaps-unacknowledged', status: 409, title: 'Known licence coverage gaps', detail: 'There are 2 known coverage gaps …', gapCount: 2 }),
      () => json(200, { enforce: true, gapCount: 2 }),
    ];
    view = await mount('owner');
    await press(buttonNamed(section(view.container), 'Turn on'));
    expect(section(view.container).textContent).toContain('Turn on licence enforcement?');
    await press(buttonNamed(section(view.container), 'Turn on'));
    expect(puts()[0]!.body).toEqual({ enforce: true });
    expect(section(view.container).textContent).toContain('Turn on with 2 known coverage gaps?');
    expect(view.container.textContent).not.toContain('Enforcement not changed');
    await press(buttonNamed(section(view.container), 'Turn on'));
    expect(puts()).toHaveLength(2);
    expect(puts()[1]!.body).toEqual({ enforce: true, acknowledgeGaps: true });
    // A fresh confirmation mints a fresh key.
    expect(puts()[1]!.key).not.toBe(puts()[0]!.key);
    expect(view.container.textContent).toContain('Enforcement on');
  });

  test('an owner turns it off — always allowed, no acknowledgement', async () => {
    policy = { enforce: true, gapCount: 4 };
    view = await mount('owner');
    await press(buttonNamed(section(view.container), 'Turn off'));
    expect(section(view.container).textContent).toContain('Turn off licence enforcement?');
    await press(buttonNamed(section(view.container), 'Turn off'));
    expect(puts()[0]!.body).toEqual({ enforce: false });
    expect(view.container.textContent).toContain('Enforcement off');
  });

  test('a refusal is worded and the switch is unchanged', async () => {
    putAnswers = [() => json(403, { code: 'role-denied', status: 403, title: 'Forbidden' })];
    view = await mount('owner');
    await press(buttonNamed(section(view.container), 'Turn on'));
    await press(buttonNamed(section(view.container), 'Turn on'));
    expect(view.container.textContent).toContain('Enforcement not changed');
    expect(view.container.textContent).toContain('Only an owner can turn licence enforcement on or off.');
  });
});
