import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, readSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { UsersCard } from '../settings/users-card';
import { SecurityView } from './security-view';

/**
 * Story 6-1b — My account → Security and the Team card's two-factor
 * affordances, driven through a stubbed `fetch` (the generated client is a
 * fetch wrapper, so the wiring under test is what ships).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function sessionAs(role: 'owner' | 'operator' | 'accountant', id = `u-${role}`): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
    user: { id, email: `${role}@example.com`, role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
    refreshUntil: Date.now() + 12 * 60 * 60_000,
  };
}

let status: Record<string, unknown> = { enabled: true, enabledAt: '2026-10-18T09:00:00.000Z', required: true, backupCodesRemaining: 10 };
let posts: { path: string; body: unknown; key: string | null }[] = [];
let answers: Record<string, { status: number; body: unknown }> = {};

function json(code: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
}

const USERS = [
  { id: 'u-owner', email: 'owner@example.com', role: 'owner', status: 'active', clientId: null, createdAt: '2026-01-01T00:00:00.000Z', lockedUntil: null, secondFactorEnabled: true },
  { id: 'u-other', email: 'other@example.com', role: 'owner', status: 'active', clientId: null, createdAt: '2026-01-02T00:00:00.000Z', lockedUntil: null, secondFactorEnabled: true },
  { id: 'u-op', email: 'op@example.com', role: 'operator', status: 'active', clientId: null, createdAt: '2026-01-03T00:00:00.000Z', lockedUntil: null, secondFactorEnabled: false },
  // A stored snapshot without the field: no chip, no reset.
  { id: 'u-old', email: 'old@example.com', role: 'operator', status: 'active', clientId: null, createdAt: '2026-01-04T00:00:00.000Z', lockedUntil: null },
];

beforeEach(() => {
  posts = [];
  answers = {};
  status = { enabled: true, enabledAt: '2026-10-18T09:00:00.000Z', required: true, backupCodesRemaining: 10 };
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'GET' && pathname.endsWith('/me/second-factor')) return json(200, status);
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [] });
    if (method === 'GET' && pathname.endsWith('/users')) return json(200, { items: USERS, nextCursor: null });
    if (method === 'POST') {
      const text = await request.text();
      posts.push({ path: pathname, body: text === '' ? null : JSON.parse(text), key: request.headers.get('Idempotency-Key') });
      const answer = Object.entries(answers).find(([suffix]) => pathname.endsWith(suffix));
      if (answer !== undefined) return json(answer[1].status, answer[1].body);
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
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label) as HTMLButtonElement | undefined;
}

async function click(target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.click();
  });
  await settle();
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(container: HTMLElement): Promise<void> {
  act(() => void container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

describe('My account → Security (story 6-1b)', () => {
  test('an owner: On, the codes left, no Turn off (2FA is required)', async () => {
    writeSession(sessionAs('owner'));
    view = render(<SecurityView />);
    await settle();
    expect(view.container.textContent).toContain('On');
    expect(view.container.textContent).toContain('10 backup codes left');
    expect(view.container.textContent).toContain('Owners must use two-factor sign-in.');
    expect(button(view.container, 'Turn off')).toBeUndefined();
    expect(button(view.container, 'Replace authenticator')).toBeDefined();
  });

  test('the low-codes warning shows at 2 or fewer, including 0', async () => {
    writeSession(sessionAs('owner'));
    status = { ...status, backupCodesRemaining: 0 };
    view = render(<SecurityView />);
    await settle();
    expect(view.container.textContent).toContain('You have no backup codes left');
  });

  test('a wrong code on Security is a 422: the reason shows and the session stays', async () => {
    writeSession(sessionAs('owner'));
    answers = { '/me/second-factor/backup-codes': { status: 422, body: { code: 'second-factor-invalid', status: 422, title: 'Wrong code', attemptsLeft: 4 } } };
    view = render(<SecurityView />);
    await settle();
    await click(button(view.container, 'New backup codes')!);
    type(view.container.querySelector('form input') as HTMLInputElement, '000000');
    await submit(view.container);
    expect(posts.map((post) => post.path)).toEqual([`/api/v1/tenants/${TENANT_ID}/me/second-factor/backup-codes`]);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('4 attempts left');
    expect(readSession()).not.toBeNull();
  });

  test('replace runs: the current code → the QR code → the confirm code → the codes panel', async () => {
    writeSession(sessionAs('owner'));
    answers = {
      '/me/second-factor/setup': { status: 200, body: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' } },
      '/me/second-factor/confirm': { status: 200, body: { backupCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] } },
    };
    view = render(<SecurityView />);
    await settle();
    await click(button(view.container, 'Replace authenticator')!);
    type(view.container.querySelector('form input') as HTMLInputElement, '123456');
    await submit(view.container);
    expect(posts[0]).toMatchObject({ path: `/api/v1/tenants/${TENANT_ID}/me/second-factor/setup`, body: { code: '123456' }, key: null });
    expect(view.container.querySelector('[role="img"]')).not.toBeNull();
    expect(view.container.textContent).toContain('JBSW Y3DP EHPK 3PXP');
    type(view.container.querySelector('form input') as HTMLInputElement, '654321');
    await submit(view.container);
    expect(posts[1]).toMatchObject({ path: `/api/v1/tenants/${TENANT_ID}/me/second-factor/confirm`, body: { code: '654321' } });
    expect(view.container.querySelector('[data-testid="backup-codes"]')!.textContent).toContain('CCCCC-DDDDD');
    expect(button(view.container, 'Done')!.disabled).toBe(true);
  });

  test('an opt-in user with 2FA off: Turn on asks for the password', async () => {
    writeSession(sessionAs('accountant'));
    status = { enabled: false, enabledAt: null, required: false, backupCodesRemaining: 0 };
    answers = { '/me/second-factor/setup': { status: 422, body: { code: 'password-invalid', status: 422, title: 'Wrong password' } } };
    view = render(<SecurityView />);
    await settle();
    expect(view.container.textContent).toContain('Off');
    await click(button(view.container, 'Turn on')!);
    const password = view.container.querySelector('input[type="password"]') as HTMLInputElement;
    type(password, 'nope-nope');
    await submit(view.container);
    expect(posts[0]).toMatchObject({ body: { password: 'nope-nope' } });
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('That password is not right.');
    expect(readSession()).not.toBeNull();
  });
});

describe('Team card — two-factor (story 6-1b)', () => {
  test('an owner sees the 2FA chip (none when the field is absent) and Reset 2FA only on another user with 2FA on', async () => {
    writeSession(sessionAs('owner', 'u-owner'));
    view = render(<UsersCard />);
    await settle();
    const chips = [...view.container.querySelectorAll('[data-testid="second-factor-chip"]')].map((chip) => chip.textContent);
    expect(chips).toEqual(['2FA On', '2FA On', '2FA Off']);
    const resets = [...view.container.querySelectorAll('button')].filter((candidate) => candidate.textContent === 'Reset 2FA');
    expect(resets).toHaveLength(1);
    expect(resets[0]!.closest('tr')!.textContent).toContain('other@example.com');
  });

  test('Reset 2FA confirms, sends one keyed POST and shows the enrolment code once', async () => {
    writeSession(sessionAs('owner', 'u-owner'));
    answers = { '/users/u-other/second-factor/reset': { status: 200, body: { enrolmentCode: 'K7PQ2MXA', enrolmentCodeExpiresAt: '2026-10-21T09:00:00.000Z' } } };
    view = render(<UsersCard />);
    await settle();
    await click(button(view.container, 'Reset 2FA')!);
    expect(posts).toHaveLength(0);
    await click(button(view.container, 'Reset 2FA')!);
    expect(posts).toEqual([{ path: `/api/v1/tenants/${TENANT_ID}/users/u-other/second-factor/reset`, body: null, key: expect.any(String) }]);
    expect(view.container.querySelector('[data-testid="enrolment-code"]')!.textContent).toBe('K7PQ2MXA');
  });

  test('an operator sees no chip and no Reset 2FA', async () => {
    writeSession(sessionAs('operator', 'u-op'));
    view = render(<UsersCard />);
    await settle();
    expect(view.container.querySelectorAll('[data-testid="second-factor-chip"]')).toHaveLength(0);
    expect(button(view.container, 'Reset 2FA')).toBeUndefined();
  });
});
