import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { INVITE_EMAIL_POLL_WINDOW_MS } from '../../lib/users';
import { UsersCard } from './users-card';

/**
 * Story 5-1a — the Team card and the invite email: the link shown is the
 * backend's `inviteUrl`, the line under it says what happened to the email,
 * an invited row shows its email's status (owner only — the field is absent
 * for anyone else), and Resend invite mints a fresh link behind a
 * confirmation.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function sessionAs(role: 'owner' | 'operator'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
    user: { id: 'u-me', email: 'me@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const ROW = { role: 'operator', clientId: null, createdAt: '2026-10-01T00:00:00.000Z' };
const QUEUED = { ...ROW, id: 'u-q', email: 'queued@x.in', status: 'invited', inviteEmail: { status: 'pending', updatedAt: '2026-10-23T05:00:00.000Z' } };
const SENT = { ...ROW, id: 'u-s', email: 'sent@x.in', status: 'invited', inviteEmail: { status: 'sent', updatedAt: '2026-10-23T05:00:00.000Z' } };
const FAILED = { ...ROW, id: 'u-f', email: 'failed@x.in', status: 'invited', inviteEmail: { status: 'failed', updatedAt: '2026-10-23T05:00:00.000Z' } };
const SKIPPED = { ...ROW, id: 'u-k', email: 'skipped@x.in', status: 'invited', inviteEmail: { status: 'skipped', updatedAt: '2026-10-23T05:00:00.000Z' } };
const ACTIVE = { ...ROW, id: 'u-a', email: 'active@x.in', status: 'active', inviteEmail: null };
const BACKEND_URL = 'https://app.wms.in/accept-invite?tenant=t&token=from-backend';

let posts: { path: string; key: string | null }[] = [];
let listRows: unknown[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts = [];
  listRows = [SENT, FAILED, SKIPPED, ACTIVE];
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [] });
    if (method === 'GET' && pathname.endsWith('/users')) return json(200, { items: listRows, nextCursor: null });
    if (method === 'POST') {
      posts.push({ path: pathname, key: request.headers.get('Idempotency-Key') });
      if (pathname.endsWith('/users')) {
        const body = (await request.json()) as { email: string };
        return json(201, {
          user: { ...ROW, id: 'u-new', email: body.email, status: 'invited' },
          inviteToken: 'from-backend',
          inviteExpiresAt: '2026-10-30T00:00:00.000Z',
          inviteUrl: BACKEND_URL,
          inviteEmail: { status: 'pending' },
        });
      }
      if (pathname.endsWith('/resend-invite')) {
        return json(200, {
          user: { ...FAILED, inviteEmail: undefined },
          inviteToken: 'fresh',
          inviteExpiresAt: '2026-10-30T00:00:00.000Z',
          inviteUrl: 'https://app.wms.in/accept-invite?tenant=t&token=fresh',
          inviteEmail: { status: 'pending' },
        });
      }
    }
    return json(404, { code: 'not-found', status: 404, title: 'Unrouted' });
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

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((button) => button.textContent === label);
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
  await settle();
}

function setValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function statusOf(container: HTMLElement, email: string): string | null {
  const row = [...container.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(email));
  return row?.querySelector('[data-testid="invite-email-status"]')?.textContent ?? null;
}

describe('Team card — the invite email (story 5-1a)', () => {
  test('an invited row reads its email status (owner); skipped and accepted rows read nothing', async () => {
    writeSession(sessionAs('owner'));
    view = render(<UsersCard />);
    await settle();
    expect(statusOf(view.container, 'sent@x.in')).toBe('Sent to the mail service');
    expect(statusOf(view.container, 'failed@x.in')).toBe('Not sent — resend or copy the link');
    expect(statusOf(view.container, 'skipped@x.in')).toBeNull();
    expect(statusOf(view.container, 'active@x.in')).toBeNull();
  });

  test('an operator (no inviteEmail field, no users.invite) sees no email status and no Resend', async () => {
    listRows = [{ ...SENT, inviteEmail: undefined }];
    writeSession(sessionAs('operator'));
    view = render(<UsersCard />);
    await settle();
    expect(view.container.querySelector('[data-testid="invite-email-status"]')).toBeNull();
    expect(buttons(view.container, 'Resend invite')).toHaveLength(0);
  });

  test('after an invite, the shown link is the backend inviteUrl and the note says the email is queued', async () => {
    writeSession(sessionAs('owner'));
    view = render(<UsersCard />);
    await settle();
    setValue(view.container.querySelector('form input[type="email"]') as HTMLInputElement, 'new@x.in');
    act(() => void view!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    const panel = view.container.querySelector('[data-testid="invite-link"]')!;
    expect((panel.querySelector('input[readonly]') as HTMLInputElement).value).toBe(BACKEND_URL);
    expect(panel.textContent).toContain('An invitation email to new@x.in is queued to send.');
  });

  test('Resend invite shows on invited rows only, asks first, then sends one keyed POST and shows the fresh link', async () => {
    writeSession(sessionAs('owner'));
    view = render(<UsersCard />);
    await settle();
    // Three invited rows (sent, failed, skipped); never the active one.
    expect(buttons(view.container, 'Resend invite')).toHaveLength(3);
    const failedRow = () => [...view!.container.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('failed@x.in'))! as HTMLElement;
    await click(buttons(failedRow(), 'Resend invite')[0]!);
    expect(posts).toHaveLength(0);
    expect(view.container.textContent).toContain('Send failed@x.in a new invitation? The link they have now stops working.');
    await click(buttons(failedRow(), 'Resend invite')[0]!);
    expect(posts).toEqual([{ path: `/api/v1/tenants/${TENANT_ID}/users/u-f/resend-invite`, key: expect.any(String) }]);
    const panel = view.container.querySelector('[data-testid="invite-link"]')!;
    expect((panel.querySelector('input[readonly]') as HTMLInputElement).value).toBe('https://app.wms.in/accept-invite?tenant=t&token=fresh');
    expect(view.container.textContent).toContain('New invitation for failed@x.in');
  });

  test('a queued row starts the light polling: the list is read again', async () => {
    listRows = [QUEUED];
    let reads = 0;
    const original = globalThis.fetch;
    stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      if (request.method.toUpperCase() === 'GET' && new URL(request.url).pathname.endsWith('/users')) reads += 1;
      return original(input, init);
    }) as unknown as typeof fetch);
    const timers: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    stubGlobal('setTimeout', ((fn: () => void, ms?: number) => {
      if (ms === 5_000) {
        timers.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms);
    }) as unknown as typeof setTimeout);
    const realNow = Date.now;
    let now = 1_800_000_000_000;
    Date.now = () => now;
    try {
      writeSession(sessionAs('owner'));
      view = render(<UsersCard />);
      await settle();
      expect(reads).toBe(1);
      expect(timers).toHaveLength(1);
      // Inside the window: the timer re-reads, and the still-queued row schedules the next one.
      await act(async () => {
        timers.shift()!();
      });
      await settle();
      expect(reads).toBe(2);
      expect(timers).toHaveLength(1);
      // Past the 60 s window: the timer's read is the last — no further timer is scheduled.
      now += INVITE_EMAIL_POLL_WINDOW_MS + 1;
      await act(async () => {
        timers.shift()!();
      });
      await settle();
      expect(reads).toBe(3);
      expect(timers).toHaveLength(0);
    } finally {
      Date.now = realNow;
    }
  });
});
