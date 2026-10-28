import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import type { ComponentType } from 'react';

import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';

/**
 * Story 6-1c — the forgot and reset pages: the token read from the fragment
 * and dropped from the address bar, `check` on load (nothing spent), the
 * invalid-link state, the code field for an enrolled account, the confirm's
 * body, the 400 / 422 / 423 / 429 / 503 states, the browser's session
 * cleared on success and the route to `/login?…&reset=done`; no bearer on
 * any reset call even with a session in the tab; the forgot page's one
 * answer and its prefilled email; the login page's link.
 */

const pushes: string[] = [];
let ResetPasswordForm: ComponentType;
let ForgotPasswordForm: ComponentType<{ initialEmail?: string }>;
let LoginForm: ComponentType<{ initialEmail?: string; notice?: string | null; resetDone?: boolean }>;

beforeAll(async () => {
  const real = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...real,
    useRouter: () => ({ push: (href: string) => void pushes.push(href) }),
  }));
  ({ ResetPasswordForm, ForgotPasswordForm, LoginForm } = await import('./auth-forms'));
});

const TOKEN = '0193a1b2-0000-7000-8000-000000000001.secret_value-0123456789abcdefghijklmnop';

interface Call {
  path: string;
  body: Record<string, unknown>;
  authorization: string | null;
  credentials: RequestCredentials;
}
let calls: Call[] = [];
let checkAnswers: { status: number; body: Record<string, unknown> }[] = [];
let confirmAnswers: { status: number; body: Record<string, unknown> }[] = [];
let requestAnswer: { status: number; body: Record<string, unknown> } = { status: 202, body: { message: 'ok' } };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubApi(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    calls.push({ path: pathname, body, authorization: request.headers.get('Authorization'), credentials: request.credentials });
    if (pathname.endsWith('/tenants/password-reset/check')) {
      const next = checkAnswers.shift() ?? { status: 200, body: { email: 'priya@example.com', expiresAt: '2026-10-28T10:00:00.000Z', secondFactorRequired: false } };
      return json(next.status, next.body);
    }
    if (pathname.endsWith('/tenants/password-reset/confirm')) {
      const next = confirmAnswers.shift() ?? { status: 200, body: { email: 'priya@example.com' } };
      return json(next.status, next.body);
    }
    if (pathname.endsWith('/tenants/password-reset')) return json(requestAnswer.status, requestAnswer.body);
    return json(404, { code: 'not-found', title: 'Unrouted', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  calls = [];
  checkAnswers = [];
  confirmAnswers = [];
  requestAnswer = { status: 202, body: { message: 'ok' } };
  pushes.length = 0;
  stubApi();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  restoreGlobals();
  localStorage.removeItem('wms-session');
  window.history.replaceState(null, '', '/');
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
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

function byLabel(container: HTMLElement, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find((l) => l.textContent === label);
  expect(found).toBeDefined();
  const id = found!.getAttribute('for');
  return (id === null ? found!.querySelector('input') : container.querySelector(`#${CSS.escape(id)}`)) as HTMLInputElement;
}

function submit(container: HTMLElement): void {
  const form = container.querySelector('form')!;
  act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

async function openLink(hash = `#token=${TOKEN}`): Promise<HTMLElement> {
  window.history.replaceState(null, '', `/reset-password${hash}`);
  view = render(<ResetPasswordForm />);
  await settle();
  return view.container;
}

describe('ResetPasswordForm (story 6-1c)', () => {
  test('the token is read from the fragment, dropped from the address bar, and sent only in the check body; nothing else is called on open', async () => {
    const container = await openLink();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('secret_value');
    expect(calls.map((c) => c.path.replace(/^.*\/tenants/, ''))).toEqual(['/password-reset/check']);
    expect(calls[0]!.body).toEqual({ token: TOKEN });
    expect(container.textContent).toContain('Setting a new password for priya@example.com');
    expect(container.textContent).not.toContain('Authenticator code');
  });

  test('no token, or a link the server refuses → "expired or already used" with Request a new link', async () => {
    let container = await openLink('');
    expect(calls).toHaveLength(0);
    expect(container.textContent).toContain('This link has expired or was already used. If you just set your password, sign in.');
    expect(container.querySelector('a[href="/forgot-password"]')!.textContent).toBe('Request a new link');
    view!.unmount();
    checkAnswers = [{ status: 400, body: { code: 'reset-link-invalid', status: 400, detail: 'x' } }];
    container = await openLink();
    expect(container.textContent).toContain('Link not valid');
  });

  test('the two passwords must match before anything is sent; then confirm → the session cleared → /login?email=…&reset=done', async () => {
    // A tab with a live session (A13 / A14): no bearer on the reset calls, and the session is cleared after.
    localStorage.setItem(
      'wms-session',
      JSON.stringify({ token: 'h.p.s', tenant: { id: 't-1', name: 'T' }, user: { id: 'u-1', email: 'priya@example.com', role: 'owner', clientId: null }, client: null, expiresAt: Date.now() + 600_000, refreshUntil: Date.now() + 3_600_000 }),
    );
    const container = await openLink();
    setInput(byLabel(container, 'New password'), 'a-new-password');
    setInput(byLabel(container, 'Confirm new password'), 'a-new-passworX');
    submit(container);
    await settle();
    expect(calls.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(0);
    expect(container.textContent).toContain('The two passwords do not match.');
    setInput(byLabel(container, 'Confirm new password'), 'a-new-password');
    submit(container);
    await settle();
    const sent = calls.filter((c) => c.path.endsWith('/confirm'));
    expect(sent.map((c) => c.body)).toEqual([{ token: TOKEN, password: 'a-new-password' }]);
    expect(sent[0]!.credentials).toBe('include');
    expect(calls.every((c) => c.authorization === null)).toBe(true);
    // clearSession() ran: the stored session is gone (it also zeroes the hint cookie).
    expect(localStorage.getItem('wms-session')).toBeNull();
    expect(pushes).toEqual(['/login?email=priya%40example.com&reset=done']);
  });

  test('an enrolled account: the code field (and the backup-code switch); the code rides the confirm; a wrong one says the attempts left', async () => {
    checkAnswers = [{ status: 200, body: { email: 'owner@example.com', expiresAt: '2026-10-28T10:00:00.000Z', secondFactorRequired: true } }];
    confirmAnswers = [{ status: 422, body: { code: 'second-factor-invalid', status: 422, detail: 'x', attemptsLeft: 4 } }];
    const container = await openLink();
    setInput(byLabel(container, 'New password'), 'a-new-password');
    setInput(byLabel(container, 'Confirm new password'), 'a-new-password');
    setInput(byLabel(container, 'Authenticator code'), '123456');
    submit(container);
    await settle();
    expect(calls.filter((c) => c.path.endsWith('/confirm')).map((c) => c.body.code)).toEqual(['123456']);
    expect(container.textContent).toContain('That code is not right — 4 attempts left.');
    expect(pushes).toEqual([]);
    const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Use a backup code')!;
    act(() => void toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    setInput(byLabel(container, 'Backup code'), 'abcde fgh23');
    submit(container);
    await settle();
    expect(calls.filter((c) => c.path.endsWith('/confirm')).map((c) => c.body.code)).toEqual(['123456', 'ABCDE-FGH23']);
    expect(pushes).toEqual(['/login?email=priya%40example.com&reset=done']);
  });

  test('second-factor-needed after the check → re-check, then the code field with a notice', async () => {
    checkAnswers = [
      { status: 200, body: { email: 'm@example.com', expiresAt: '2026-10-28T10:00:00.000Z', secondFactorRequired: false } },
      { status: 200, body: { email: 'm@example.com', expiresAt: '2026-10-28T10:00:00.000Z', secondFactorRequired: true } },
    ];
    confirmAnswers = [{ status: 422, body: { code: 'second-factor-needed', status: 422, detail: 'x' } }];
    const container = await openLink();
    setInput(byLabel(container, 'New password'), 'a-new-password');
    setInput(byLabel(container, 'Confirm new password'), 'a-new-password');
    submit(container);
    await settle();
    expect(calls.map((c) => c.path.replace(/^.*\/tenants/, ''))).toEqual(['/password-reset/check', '/password-reset/confirm', '/password-reset/check']);
    expect(container.textContent).toContain('This account uses two-factor sign-in — enter a code');
    expect(byLabel(container, 'Authenticator code')).toBeDefined();
  });

  test('code review C4 — a check refused by a limit is not a dead link: "Couldn’t check the link" with Try again, which then opens the form', async () => {
    checkAnswers = [{ status: 429, body: { code: 'rate-limited', status: 429, detail: 'x', retryAfterSeconds: 45 } }];
    const container = await openLink();
    expect(container.textContent).toContain('Try again in 1 minute.');
    expect(container.textContent).not.toContain('Link not valid');
    expect(container.textContent).not.toContain('Request a new link');
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    act(() => void retry.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(calls.filter((c) => c.path.endsWith('/check')).map((c) => c.body)).toEqual([{ token: TOKEN }, { token: TOKEN }]);
    expect(container.textContent).toContain('Setting a new password for priya@example.com');
  });

  test('code review C14 / C16 — a re-check that needs no code shows no code notice; the 5th wrong code (attemptsLeft 0) moves to Request a new link', async () => {
    checkAnswers = [
      { status: 200, body: { email: 'o@example.com', expiresAt: '2026-10-28T10:00:00.000Z', secondFactorRequired: true } },
      { status: 200, body: { email: 'o@example.com', expiresAt: '2026-10-28T10:00:00.000Z', secondFactorRequired: false } },
    ];
    confirmAnswers = [
      { status: 422, body: { code: 'second-factor-needed', status: 422, detail: 'x' } },
      { status: 422, body: { code: 'second-factor-invalid', status: 422, detail: 'x', attemptsLeft: 0 } },
    ];
    const container = await openLink();
    setInput(byLabel(container, 'New password'), 'a-new-password');
    setInput(byLabel(container, 'Confirm new password'), 'a-new-password');
    setInput(byLabel(container, 'Authenticator code'), '123456');
    submit(container);
    await settle();
    expect(container.textContent).not.toContain('Code needed');
    expect([...container.querySelectorAll('label')].some((l) => l.textContent === 'Authenticator code')).toBe(false);
    submit(container);
    await settle();
    expect(container.textContent).toContain('Request a new link');
  });

  test('the link expired while typing (confirm 400) → the invalid-link state; 423, 429 and 503 keep the form with their words', async () => {
    confirmAnswers = [
      { status: 423, body: { code: 'second-factor-locked', status: 423, detail: 'x', retryAfterSeconds: 600 } },
      { status: 429, body: { code: 'rate-limited', status: 429, detail: 'x', retryAfterSeconds: 45 } },
      { status: 503, body: { code: 'second-factor-unavailable', status: 503, detail: 'x' } },
      { status: 400, body: { code: 'reset-link-invalid', status: 400, detail: 'x' } },
    ];
    const container = await openLink();
    setInput(byLabel(container, 'New password'), 'a-new-password');
    setInput(byLabel(container, 'Confirm new password'), 'a-new-password');
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      submit(container);
      await settle();
      seen.push(container.querySelector('[role="alert"]')?.textContent ?? '');
    }
    expect(seen[0]).toContain('Too many wrong codes. Try again in 10 minutes.');
    expect(seen[1]).toContain('Try again in 1 minute.');
    expect(seen[2]).toContain('Two-factor sign-in is unavailable — try again later.');
    submit(container);
    await settle();
    expect(container.textContent).toContain('Request a new link');
  });
});

describe('ForgotPasswordForm (story 6-1c)', () => {
  test('prefilled from the sign-in page; one answer whatever the email; Back to sign in carries it', async () => {
    view = render(<ForgotPasswordForm initialEmail="priya@example.com" />);
    const { container } = view;
    expect(byLabel(container, 'Email').value).toBe('priya@example.com');
    submit(container);
    await settle();
    expect(calls.map((c) => c.body)).toEqual([{ email: 'priya@example.com' }]);
    expect(calls[0]!.authorization).toBeNull();
    expect(container.textContent).toContain("If an account exists for that email, we've sent a link. It expires in 60 minutes.");
    expect(container.querySelector('a[href="/login?email=priya%40example.com"]')).not.toBeNull();
  });

  test('a 429 says its wait in minutes', async () => {
    requestAnswer = { status: 429, body: { code: 'rate-limited', status: 429, detail: 'x', retryAfterSeconds: 2400 } };
    view = render(<ForgotPasswordForm />);
    setInput(byLabel(view.container, 'Email'), 'x@example.com');
    submit(view.container);
    await settle();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Try again in 40 minutes.');
  });
});

describe('LoginForm: the forgot link and the reset notice (story 6-1c)', () => {
  test('code review C3 — a 429 from the hour buckets says its wait in minutes, naming the network or the account', async () => {
    stubGlobal('fetch', (async () =>
      json(429, { code: 'rate-limited', status: 429, detail: 'x', retryAfterSeconds: 1800 })) as unknown as typeof fetch);
    view = render(<LoginForm />);
    const { container } = view;
    const input = (label: string) =>
      [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === label)!.querySelector('input')!;
    setInput(input('Email'), 'priya@example.com');
    setInput(input('Password'), 'whatever-password');
    submit(container);
    await settle();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'Too many sign-in attempts from this network or for this account. Try again in 30 minutes.',
    );
  });

  test('"Forgot password?" carries the typed email; reset=done shows an accepted banner, not "Signed out"', async () => {
    view = render(<LoginForm notice="Password changed — sign in with your new password." resetDone />);
    const { container } = view;
    const email = [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Email')!.querySelector('input')!;
    setInput(email, 'priya@example.com');
    const link = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Forgot password?')!;
    expect(link.getAttribute('href')).toBe('/forgot-password?email=priya%40example.com');
    expect(container.querySelector('[role="status"]')!.textContent).toContain('Password changed');
    expect(container.textContent).not.toContain('Signed out');
  });
});
