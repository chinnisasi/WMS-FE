import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ClientsCard } from './clients-card';
import { CLIENT_EMAIL_POLL_WINDOW_MS } from '../../lib/client-emails';

/**
 * Story 5-2b — receipt and dispatch emails in Settings → Clients:
 *   1. every staff session is offered Emails beside Contacts, never on the
 *      warehouse's own client; only an owner gets the Reply-To form;
 *   2. the log reads status as words with IST times, the server-state
 *      banners show, Problems sends `problems=true`, Next sends the cursor;
 *   3. while a row is queued the log re-reads after 5 s;
 *   4. the Reply-To save is a keyed PATCH, lower-cased; a malformed one sends nothing;
 *   5. the contact form's Emails fieldset sends `emailEvents` (none on `self`,
 *      where it is disabled with a note); each row says its emails and warns
 *      on the last one's problem.
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
  emailReplyTo: null,
};
const ACME = { ...SELF, id: 'c-acme', code: 'ACME', name: 'Acme Foods', systemOwned: false, emailReplyTo: 'accounts@priya.in' };

const EMAIL = {
  id: 'm-1',
  kind: 'dispatch',
  subjectLabel: 'SO-1042',
  to: 'ops@acme.in',
  status: 'sent',
  errorCode: null,
  attempts: 1,
  createdAt: '2026-10-27T08:35:00.000Z',
  updatedAt: '2026-10-27T08:36:00.000Z',
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: URLSearchParams;
  readonly body: unknown;
  readonly key: string | null;
}
let requests: Recorded[] = [];
let log: Record<string, unknown> = {};
let contactRows: Record<string, unknown>[] = [];
/** When set, the next email-settings PATCH answers this instead of 200. */
let patchFailure: Response | null = null;
/** When true, every /emails read answers 503. */
let emailsFail = false;
/** The Reply-To the clients list answers with (a save updates it, as the server would). */
let acmeReplyTo: string | null = 'accounts@priya.in';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, search: url.searchParams, body, key: request.headers.get('Idempotency-Key') });
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [SELF, { ...ACME, emailReplyTo: acmeReplyTo }] });
    if (method === 'GET' && pathname.endsWith('/emails')) {
      return emailsFail ? json(503, { code: 'unavailable', title: 'Down', status: 503, detail: 'The database is unavailable.' }) : json(200, log);
    }
    if (method === 'PATCH' && pathname.endsWith('/email-settings')) {
      if (patchFailure !== null) {
        const failure = patchFailure;
        patchFailure = null;
        return failure;
      }
      acmeReplyTo = (body as { replyTo: string | null }).replyTo;
      return json(200, { client: { ...ACME, emailReplyTo: acmeReplyTo } });
    }
    if (method === 'GET' && pathname.endsWith('/contacts')) return json(200, { items: contactRows });
    if (method === 'POST' && pathname.endsWith('/contacts')) {
      const sent = body as Record<string, unknown>;
      const contact = { id: 'k-new', clientId: 'c-acme', emailEvents: [], ...sent, isPrimary: false, createdAt: '', updatedAt: '' };
      return json(201, { contact });
    }
    if (method === 'PATCH' && pathname.includes('/contacts/')) return json(200, { contact: { ...contactRows[0], ...(body as object) } });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  log = { items: [EMAIL], nextCursor: null, mailEnabled: true, clientMailEnabled: true, capReachedToday: { receipt: false, dispatch: false, shipmentDocument: false } };
  contactRows = [];
  patchFailure = null;
  emailsFail = false;
  acmeReplyTo = 'accounts@priya.in';
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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

async function pressLabelled(ariaLabel: string): Promise<void> {
  await click(view!.container.querySelector(`button[aria-label="${ariaLabel}"]`) as HTMLButtonElement);
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(form: Element): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function openEmails(role: UserRole): Promise<HTMLElement> {
  writeSession(session(role));
  view = render(<ClientsCard />);
  await settle();
  await pressLabelled('Emails of ACME');
  return view.container;
}

const emailReads = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/emails'));

describe('the Emails panel (story 5-2b)', () => {
  test('every staff role is offered Emails on a brand, never on the warehouse’s own client', async () => {
    for (const role of ['operator', 'accountant', 'ops_manager', 'owner'] as const) {
      writeSession(session(role));
      view = render(<ClientsCard />);
      await settle();
      expect(view.container.querySelector('button[aria-label="Emails of ACME"]')).not.toBeNull();
      expect(view.container.querySelector('button[aria-label="Emails of self"]')).toBeNull();
      view.unmount();
    }
    view = undefined;
  });

  test('a non-owner reads the log and the Reply-To, with no form; status words and IST times', async () => {
    log = {
      ...log,
      items: [
        EMAIL,
        { ...EMAIL, id: 'm-2', kind: 'receipt', subjectLabel: 'GRN-0007', status: 'failed', errorCode: 'suppressed' },
        { ...EMAIL, id: 'm-3', status: 'cancelled', errorCode: 'unsubscribed' },
        { ...EMAIL, id: 'm-4', status: 'skipped', errorCode: 'allowlist' },
      ],
    };
    const container = await openEmails('operator');
    expect(document.activeElement?.textContent).toBe('Emails — ACME');
    const read = emailReads()[0]!;
    expect(read.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients/c-acme/emails`);
    expect(read.search.has('problems')).toBe(false);
    expect(container.querySelector('form[aria-label="Reply-To of ACME"]')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('Reply-To: accounts@priya.in');
    expect(text).toContain('SO-1042');
    expect(text).toContain('Sent to the mail service');
    expect(text).toContain('Not sent — address refused (it bounced or complained before)');
    expect(text).toContain('Cancelled — unsubscribed');
    expect(text).toContain('Not sent — address outside this server’s allowlist');
    expect(text).toContain('27 Oct 2026, 14:05 IST');
    expect(text).toContain('Sent means the mail service accepted it; a bounce on a first send is not shown yet');
    // No banner while the server sends and no limit was reached.
    expect(container.querySelector('[aria-label="Email warnings"]')).toBeNull();
  });

  test('the banners: mail off, client emails off, and the dispatch limit', async () => {
    log = { ...log, mailEnabled: false, clientMailEnabled: false, capReachedToday: { receipt: false, dispatch: true, shipmentDocument: false } };
    const container = await openEmails('operator');
    const banners = container.querySelector('[aria-label="Email warnings"]')!.textContent ?? '';
    expect(banners).toContain('Mail is off on this server');
    expect(banners).toContain('Client emails are off on this server');
    expect(banners).toContain('Daily limit of 500 reached — later dispatches today were not emailed');
    expect(banners).not.toContain('later receipts');
  });

  test('Problems sends problems=true and back to page one; Next sends the cursor', async () => {
    log = { ...log, nextCursor: 'cur-2' };
    const container = await openEmails('operator');
    // The panel's own table (the clients table above has a Next too).
    const panel = [...container.querySelectorAll('section[aria-labelledby]')].find((s) => s.textContent?.includes('Emails — ACME')) as HTMLElement;
    await click(buttons(panel, 'Next')[0]!);
    expect(emailReads().at(-1)!.search.get('cursor')).toBe('cur-2');
    await click(buttons(container, 'Problems')[0]!);
    const filtered = emailReads().at(-1)!;
    expect(filtered.search.get('problems')).toBe('true');
    expect(filtered.search.has('cursor')).toBe(false);
    expect(buttons(container, 'Problems')[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  test('a queued row re-reads the log after 5 s; a settled log schedules nothing', async () => {
    const polls: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    stubGlobal('setTimeout', ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 5_000) {
        polls.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms, ...rest);
    }) as unknown as typeof setTimeout);

    await openEmails('operator');
    expect(polls).toHaveLength(0);
    view!.unmount();
    view = undefined;

    log = { ...log, items: [{ ...EMAIL, status: 'pending', attempts: 0 }] };
    const container = await openEmails('operator');
    expect(container.textContent).toContain('Queued…');
    expect(polls).toHaveLength(1);
    const before = emailReads().length;
    log = { ...log, items: [EMAIL] };
    await act(async () => {
      polls[0]!();
    });
    await settle();
    expect(emailReads().length).toBe(before + 1);
    expect(container.textContent).toContain('Sent to the mail service');
    expect(polls).toHaveLength(1);
  });

  test('an owner saves the Reply-To: a keyed PATCH, lower-cased; a malformed one sends nothing', async () => {
    const container = await openEmails('owner');
    const form = container.querySelector('form[aria-label="Reply-To of ACME"]')!;
    const input = form.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('accounts@priya.in');
    setInput(input, 'ops@3pl');
    await submit(form);
    expect(container.textContent).toContain('Enter an email address like name@company.com.');
    expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
    setInput(input, ' Ops@3PL.in ');
    await submit(form);
    const patch = requests.find((r) => r.method === 'PATCH')!;
    expect(patch.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients/c-acme/email-settings`);
    expect(patch.body).toEqual({ replyTo: 'ops@3pl.in' });
    expect(patch.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(container.textContent).toContain('Reply-To saved');
    setInput(input, '  ');
    await submit(form);
    expect(requests.filter((r) => r.method === 'PATCH').at(-1)!.body).toEqual({ replyTo: null });
    expect(container.textContent).toContain('Reply-To cleared');
  });
});

describe('the Emails panel — polling, failures and the Reply-To form (story 5-2b review)', () => {
  function stubPollTimers(): (() => void)[] {
    const polls: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    stubGlobal('setTimeout', ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 5_000) {
        polls.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms, ...rest);
    }) as unknown as typeof setTimeout);
    return polls;
  }

  test('a row queued past the 60 s window stops the 5 s poll; a Refresh after expiry polls again', async () => {
    const polls = stubPollTimers();
    const realNow = Date.now;
    let now = 1_800_000_000_000;
    Date.now = () => now;
    try {
      log = { ...log, items: [{ ...EMAIL, status: 'pending', attempts: 0 }] };
      const container = await openEmails('operator');
      expect(polls).toHaveLength(1);
      // Inside the window: the timer re-reads and schedules the next one.
      await act(async () => {
        polls.shift()!();
      });
      await settle();
      expect(polls).toHaveLength(1);
      // Past the window: the timer's read is the last — no further timer.
      now += CLIENT_EMAIL_POLL_WINDOW_MS + 1;
      await act(async () => {
        polls.shift()!();
      });
      await settle();
      expect(polls).toHaveLength(0);
      // Refresh is a user action: the window starts afresh.
      const reads = emailReads().length;
      await click(buttons(container, 'Refresh')[0]!);
      expect(emailReads().length).toBe(reads + 1);
      expect(polls).toHaveLength(1);
    } finally {
      Date.now = realNow;
    }
  });

  test('a failing log read shows "Emails unavailable", and Retry re-reads', async () => {
    emailsFail = true;
    const container = await openEmails('operator');
    expect(container.textContent).toContain('Emails unavailable');
    const reads = emailReads().length;
    emailsFail = false;
    await click(buttons(container, 'Retry')[0]!);
    expect(emailReads().length).toBe(reads + 1);
    expect(container.textContent).toContain('Sent to the mail service');
    expect(container.textContent).not.toContain('Emails unavailable');
  });

  test('a typed Reply-To, then another row button: the "Discard unsaved changes" question', async () => {
    const container = await openEmails('owner');
    const input = container.querySelector('form[aria-label="Reply-To of ACME"] input') as HTMLInputElement;
    setInput(input, 'new@3pl.in');
    await pressLabelled('Contacts of ACME');
    const ask = container.querySelector('[role="group"][aria-label="Discard unsaved changes"]');
    expect(ask).not.toBeNull();
    expect(ask!.textContent).toContain('ACME');
  });

  test('a rejected save shows "Reply-To not saved"; the retry reuses the same Idempotency-Key; typing clears the saved banner', async () => {
    patchFailure = json(503, { code: 'unavailable', title: 'Down', status: 503, detail: 'Try again.' });
    const container = await openEmails('owner');
    const form = container.querySelector('form[aria-label="Reply-To of ACME"]')!;
    expect(form.hasAttribute('novalidate')).toBe(true);
    const input = form.querySelector('input') as HTMLInputElement;
    setInput(input, 'ops@3pl.in');
    await submit(form);
    expect(container.textContent).toContain('Reply-To not saved');
    await submit(form);
    const patches = requests.filter((r) => r.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[1]!.key).toBe(patches[0]!.key);
    expect(container.textContent).toContain('Reply-To saved');
    setInput(input, 'other@3pl.in');
    expect(container.textContent).not.toContain('Reply-To saved');
  });

  test('after a save the clients list is re-read, and reopening the panel shows the stored Reply-To', async () => {
    const container = await openEmails('owner');
    const listReads = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/clients')).length;
    const before = listReads();
    const form = container.querySelector('form[aria-label="Reply-To of ACME"]')!;
    setInput(form.querySelector('input') as HTMLInputElement, 'Ops@3PL.in');
    await submit(form);
    expect(listReads()).toBeGreaterThan(before);
    await click(buttons(container, 'Close')[0]!);
    await pressLabelled('Emails of ACME');
    expect((container.querySelector('form[aria-label="Reply-To of ACME"] input') as HTMLInputElement).value).toBe('ops@3pl.in');
  });

  test('Refresh issues another read of the same page', async () => {
    const container = await openEmails('operator');
    const reads = emailReads().length;
    await click(buttons(container, 'Refresh')[0]!);
    expect(emailReads().length).toBe(reads + 1);
  });
});

describe('the contact form’s Emails fieldset (story 5-2b)', () => {
  test('each row says its emails and warns on the last email’s problem', async () => {
    contactRows = [
      { id: 'k-1', clientId: 'c-acme', name: 'Asha', email: 'asha@acme.in', phone: null, roles: ['operations'], isPrimary: true, createdAt: '', updatedAt: '', emailEvents: ['receipt.recorded', 'order.dispatched'], lastEmail: { status: 'failed', errorCode: 'suppressed', at: '' } },
      { id: 'k-2', clientId: 'c-acme', name: 'Ravi', email: 'ravi@acme.in', phone: null, roles: [], isPrimary: false, createdAt: '', updatedAt: '', emailEvents: ['order.dispatched'], lastEmail: { status: 'expired', errorCode: 'expired', at: '' } },
      { id: 'k-3', clientId: 'c-acme', name: 'Meera', email: 'meera@acme.in', phone: null, roles: [], isPrimary: false, createdAt: '', updatedAt: '', emailEvents: [], lastEmail: { status: 'sent', errorCode: null, at: '' } },
    ];
    writeSession(session('operator'));
    view = render(<ClientsCard />);
    await settle();
    await pressLabelled('Contacts of ACME');
    const items = [...view.container.querySelectorAll('ul[aria-label="Contacts of ACME"] > li')].map((li) => li.textContent ?? '');
    expect(items[0]).toContain('Emails: receipts, dispatches');
    expect(items[0]).toContain('Address refused — it bounced or complained before');
    expect(items[1]).toContain('Emails: dispatches');
    expect(items[1]).toContain('Last email not sent');
    expect(items[2]).not.toContain('Emails:');
    expect(items[2]).not.toContain('not sent');
  });

  test('on a brand: the fieldset sends the ticked events on add, and the edited set on edit', async () => {
    contactRows = [
      { id: 'k-1', clientId: 'c-acme', name: 'Asha', email: 'asha@acme.in', phone: null, roles: [], isPrimary: true, createdAt: '', updatedAt: '', emailEvents: ['receipt.recorded'], lastEmail: null },
    ];
    writeSession(session('owner'));
    view = render(<ClientsCard />);
    await settle();
    await pressLabelled('Contacts of ACME');
    await click(buttons(view.container, 'Add contact')[0]!);
    const form = view.container.querySelector('form[aria-label="Add contact for ACME"]')!;
    const [name, email] = [...form.querySelectorAll('input:not([type="checkbox"])')] as HTMLInputElement[];
    setInput(name!, 'Ravi');
    setInput(email!, 'ravi@acme.in');
    const emails = form.querySelectorAll('fieldset')[1]!;
    expect(emails.querySelector('legend')?.textContent).toBe('Emails');
    expect(emails.disabled).toBe(false);
    expect(emails.textContent).toContain('Goods received (each GRN)');
    expect(emails.textContent).toContain('Each order is one email per contact. A daily limit of 500 applies.');
    const [receipt, dispatch] = [...emails.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(receipt!.checked).toBe(false);
    await click(dispatch!);
    await submit(form);
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/contacts'))!;
    expect(post.body).toEqual({ name: 'Ravi', email: 'ravi@acme.in', phone: null, roles: [], emailEvents: ['order.dispatched'] });

    await pressLabelled('Edit Asha');
    const edit = view.container.querySelector('form[aria-label="Save contact for ACME"]')!;
    const [editReceipt, editDispatch] = [...edit.querySelectorAll('fieldset')[1]!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(editReceipt!.checked).toBe(true);
    await click(editReceipt!);
    await click(editDispatch!);
    await submit(edit);
    const patch = requests.find((r) => r.method === 'PATCH' && r.pathname.endsWith('/contacts/k-1'))!;
    expect(patch.body).toEqual({ name: 'Asha', email: 'asha@acme.in', phone: null, roles: [], emailEvents: ['order.dispatched'] });
  });

  test('an edit that leaves the ticks as seeded sends no emailEvents (a stale form never overwrites another owner’s opt-in)', async () => {
    contactRows = [
      { id: 'k-1', clientId: 'c-acme', name: 'Asha', email: 'asha@acme.in', phone: null, roles: [], isPrimary: true, createdAt: '', updatedAt: '', emailEvents: ['receipt.recorded'], lastEmail: null },
    ];
    writeSession(session('owner'));
    view = render(<ClientsCard />);
    await settle();
    await pressLabelled('Contacts of ACME');
    await pressLabelled('Edit Asha');
    const edit = view.container.querySelector('form[aria-label="Save contact for ACME"]')!;
    const [name] = [...edit.querySelectorAll('input:not([type="checkbox"])')] as HTMLInputElement[];
    setInput(name!, 'Asha R');
    await submit(edit);
    const patch = requests.find((r) => r.method === 'PATCH' && r.pathname.endsWith('/contacts/k-1'))!;
    expect(patch.body).toEqual({ name: 'Asha R', email: 'asha@acme.in', phone: null, roles: [] });
  });

  test('on the warehouse’s own client the fieldset is disabled with a note, and no emailEvents is sent', async () => {
    writeSession(session('owner'));
    view = render(<ClientsCard />);
    await settle();
    await pressLabelled('Contacts of self');
    await click(buttons(view.container, 'Add contact')[0]!);
    const form = view.container.querySelector('form[aria-label="Add contact for self"]')!;
    const emails = form.querySelectorAll('fieldset')[1]!;
    expect(emails.disabled).toBe(true);
    expect(emails.textContent).toContain('Your own company gets no client emails');
    const [name, email] = [...form.querySelectorAll('input:not([type="checkbox"])')] as HTMLInputElement[];
    setInput(name!, 'Store');
    setInput(email!, 'store@priya.in');
    await submit(form);
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/contacts'))!;
    expect(post.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/clients/c-self/contacts`);
    expect(post.body).toEqual({ name: 'Store', email: 'store@priya.in', phone: null, roles: [] });
    expect(Object.hasOwn(post.body as object, 'emailEvents')).toBe(false);
  });
});
