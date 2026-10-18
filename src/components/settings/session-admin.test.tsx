import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { DevicesCard } from './devices-card';
import { UsersCard } from './users-card';

/**
 * Story 6-1a — the owner's session administration on the Settings cards:
 *   - Team: the status reads Deactivated / Sign-in locked; Deactivate,
 *     Reactivate and Unlock each sit behind a confirmation and send ONE key
 *     per confirmation; a reactivated invitee's new invite link is shown.
 *   - Devices: Badge-in locked; Unlock and Release device behind a
 *     confirmation. An operator sees none of these actions.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function sessionAs(role: 'owner' | 'operator'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
    user: { id: `u-${role}`, email: `${role}@example.com`, role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
    refreshUntil: Date.now() + 12 * 60 * 60_000,
  };
}

const FUTURE = new Date(Date.now() + 10 * 60_000).toISOString();
const ACTIVE = { id: 'u-ravi', email: 'ravi@example.com', role: 'operator', status: 'active', clientId: null, createdAt: '2026-01-02T00:00:00.000Z', lockedUntil: FUTURE };
const GONE = { id: 'u-meena', email: 'meena@example.com', role: 'operator', status: 'deactivated', clientId: null, createdAt: '2026-01-03T00:00:00.000Z', lockedUntil: null };

const DEVICE = {
  id: 'd-1',
  label: 'HH-07',
  operatorUserId: 'u-ravi',
  operatorEmail: 'ravi@example.com',
  status: 'active',
  wipeFlag: false,
  enrolledAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: null,
  revokedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  badgeLockedUntil: FUTURE,
};

let posts: { path: string; key: string | null }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts = [];
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [] });
    if (method === 'GET' && pathname.endsWith('/users')) return json(200, { items: [ACTIVE, GONE], nextCursor: null });
    if (method === 'GET' && pathname.endsWith('/devices')) return json(200, { items: [DEVICE], nextCursor: null });
    if (method === 'POST') {
      posts.push({ path: pathname, key: request.headers.get('Idempotency-Key') });
      if (pathname.endsWith('/deactivate')) return json(200, { user: { ...ACTIVE, status: 'deactivated' } });
      if (pathname.endsWith('/reactivate')) {
        return json(200, { user: { ...GONE, status: 'invited' }, inviteToken: 'fresh-token', inviteExpiresAt: FUTURE });
      }
      if (pathname.endsWith('/users/u-ravi/unlock')) return json(200, { ...ACTIVE, lockedUntil: null });
      if (pathname.endsWith('/release') || pathname.endsWith('/devices/d-1/unlock')) return json(200, { ...DEVICE, operatorUserId: null });
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

describe('Team card — offboarding and unlock (story 6-1a)', () => {
  test('status reads Active / Deactivated and "Sign-in locked"; the owner gets Deactivate, Reactivate and Unlock', async () => {
    writeSession(sessionAs('owner'));
    view = render(<UsersCard />);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('Deactivated');
    expect(text).toContain('Sign-in locked');
    expect(buttons(view.container, 'Deactivate')).toHaveLength(1);
    expect(buttons(view.container, 'Reactivate')).toHaveLength(1);
    expect(buttons(view.container, 'Unlock')).toHaveLength(1);
  });

  test('Deactivate asks first, then sends one keyed POST; the banner names the user', async () => {
    writeSession(sessionAs('owner'));
    view = render(<UsersCard />);
    await settle();
    await click(buttons(view.container, 'Deactivate')[0]!);
    expect(posts).toHaveLength(0);
    expect(view.container.textContent).toContain('Deactivate ravi@example.com?');
    await click(buttons(view.container, 'Deactivate')[0]!);
    expect(posts).toEqual([{ path: `/api/v1/tenants/${TENANT_ID}/users/u-ravi/deactivate`, key: expect.any(String) }]);
    expect(view.container.textContent).toContain('ravi@example.com deactivated');
  });

  test('Reactivating a never-accepted invitee shows the fresh invite link', async () => {
    writeSession(sessionAs('owner'));
    view = render(<UsersCard />);
    await settle();
    await click(buttons(view.container, 'Reactivate')[0]!);
    await click(buttons(view.container, 'Reactivate')[0]!);
    expect(posts[0]!.path).toBe(`/api/v1/tenants/${TENANT_ID}/users/u-meena/reactivate`);
    const link = view.container.querySelector('input[readonly]') as HTMLInputElement;
    expect(link.value).toContain('token=fresh-token');
  });

  test('Unlock clears the sign-in lock after a confirmation', async () => {
    writeSession(sessionAs('owner'));
    view = render(<UsersCard />);
    await settle();
    await click(buttons(view.container, 'Unlock')[0]!);
    await click(buttons(view.container, 'Unlock')[0]!);
    expect(posts.map((post) => post.path)).toEqual([`/api/v1/tenants/${TENANT_ID}/users/u-ravi/unlock`]);
    expect(view.container.textContent).toContain('ravi@example.com unlocked');
  });

  test('an operator sees the statuses but no actions', async () => {
    writeSession(sessionAs('operator'));
    view = render(<UsersCard />);
    await settle();
    expect(view.container.textContent).toContain('Deactivated');
    expect(buttons(view.container, 'Deactivate')).toHaveLength(0);
    expect(buttons(view.container, 'Unlock')).toHaveLength(0);
  });
});

describe('Devices card — release and unlock (story 6-1a)', () => {
  test('"Badge-in locked" shows; Unlock and Release device each confirm, then POST once', async () => {
    writeSession(sessionAs('owner'));
    view = render(<DevicesCard />);
    await settle();
    expect(view.container.textContent).toContain('Badge-in locked');
    await click(buttons(view.container, 'Release device')[0]!);
    expect(view.container.textContent).toContain('Release HH-07?');
    await click(buttons(view.container, 'Release')[0]!);
    expect(posts.map((post) => post.path)).toEqual([`/api/v1/tenants/${TENANT_ID}/devices/d-1/release`]);
    expect(view.container.textContent).toContain('HH-07 released');
    await click(buttons(view.container, 'Unlock')[0]!);
    await click(buttons(view.container, 'Unlock')[0]!);
    expect(posts.map((post) => post.path)).toContain(`/api/v1/tenants/${TENANT_ID}/devices/d-1/unlock`);
  });

  test('an operator sees no device actions', async () => {
    writeSession(sessionAs('operator'));
    view = render(<DevicesCard />);
    await settle();
    expect(buttons(view.container, 'Release device')).toHaveLength(0);
    expect(buttons(view.container, 'Unlock')).toHaveLength(0);
  });
});
