import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import type { ComponentType } from 'react';

import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';

/**
 * `RegisterForm`'s GSTIN wiring (story 8-1c). The body builder is pinned in
 * `tenancy-forms.test.ts`; this pins that the FORM sends what it builds:
 *   1. a padded lowercase GSTIN reaches `POST /tenants` trimmed + uppercased,
 *   2. a blank one sends no `gstin` key,
 *   3. a malformed one sends no POST and leaves the submit button enabled.
 *
 * `RegisterForm` calls `useRouter()`, which needs an App Router, so
 * `next/navigation` is mocked — spreading the real module so every other
 * export stays intact for any later file in the run — with a recording `push`.
 */

const pushes: string[] = [];
let RegisterForm: ComponentType;
let LoginForm: ComponentType<{ initialEmail?: string; notice?: string | null }>;

beforeAll(async () => {
  const real = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...real,
    useRouter: () => ({ push: (href: string) => void pushes.push(href) }),
  }));
  ({ RegisterForm, LoginForm } = await import('./auth-forms'));
});

let posts: Record<string, unknown>[] = [];
/** Story 6-1b — every sign-in request's header, and the second step's bodies. */
let signInHeaders: (string | null)[] = [];
let secondFactorPosts: Record<string, unknown>[] = [];
/** What the password step answers: the session (null) or a challenge. */
let challenge: Record<string, unknown> | null = null;
/** What the second step answers next (shifted per call); empty = the session. */
let secondFactorAnswers: { status: number; body: Record<string, unknown> }[] = [];

const SESSION_BODY = {
  accessToken: 'header.payload.signature',
  tokenType: 'Bearer',
  expiresInSeconds: 900,
  refreshExpiresInSeconds: 43200,
  tenant: { id: 't-1', name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'x@example.com', role: 'owner', status: 'active', clientId: null, createdAt: '2026-10-09T00:00:00.000Z' },
  client: null,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    if (request.method.toUpperCase() === 'POST' && pathname.endsWith('/tenants/sign-in/second-factor')) {
      secondFactorPosts.push((await request.json()) as Record<string, unknown>);
      const next = secondFactorAnswers.shift();
      if (next !== undefined) return json(next.status, next.body);
      return json(200, SESSION_BODY);
    }
    if (request.method.toUpperCase() === 'POST' && pathname.endsWith('/tenants/sign-in')) {
      signInHeaders.push(request.headers.get('X-WMS-Second-Factor'));
      if (signInRefusal !== null) return json(signInRefusal.status, signInRefusal);
      if (challenge !== null) return json(200, challenge);
      return json(200, {
        accessToken: 'header.payload.signature',
        tokenType: 'Bearer',
        expiresInSeconds: 900,
        refreshExpiresInSeconds: 43200,
        tenant: { id: 't-1', name: 'Priya Spices', gstin: null },
        user: { id: 'u-1', email: 'x@example.com', role: signInClient === null ? 'owner' : 'client', status: 'active', clientId: signInClient?.id ?? null, createdAt: '2026-10-09T00:00:00.000Z' },
        client: signInClient,
      });
    }
    if (request.method.toUpperCase() === 'POST' && pathname.endsWith('/tenants')) {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push(body);
      return json(201, {
        tenant: { id: 't-1', name: body.name, gstin: body.gstin ?? null },
        owner: { id: 'u-1', email: body.ownerEmail, role: 'owner', status: 'active' },
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;
let signInClient: { id: string; code: string; name: string } | null = null;
let signInRefusal: { code: string; status: number; title: string } | null = null;

beforeEach(() => {
  signInClient = null;
  signInRefusal = null;
  posts = [];
  signInHeaders = [];
  secondFactorPosts = [];
  challenge = null;
  secondFactorAnswers = [];
  pushes.length = 0;
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
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

function field(container: HTMLElement, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (l) => l.querySelector('span')?.textContent === label,
  );
  expect(found).toBeDefined();
  return found!.querySelector('input')!;
}

async function register(gstin: string): Promise<HTMLElement> {
  view = render(<RegisterForm />);
  const { container } = view;
  setInput(field(container, 'Business name'), 'Priya Spices');
  setInput(field(container, 'Owner email'), 'priya@example.com');
  setInput(field(container, 'Password'), 'hunter2hunter2');
  setInput(field(container, 'Business GSTIN (optional)'), gstin);
  const form = container.querySelector('form')!;
  act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
  return container;
}

describe('RegisterForm: the business GSTIN (story 8-1c)', () => {
  test('a padded lowercase GSTIN reaches the POST body trimmed and uppercased', async () => {
    await register(' 29aapcd1234k1z5 ');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.gstin).toBe('29AAPCD1234K1Z5');
    expect(pushes).toEqual(['/login?email=priya%40example.com']);
  });

  test('a blank GSTIN sends no gstin key', async () => {
    await register('   ');
    expect(posts).toHaveLength(1);
    expect('gstin' in posts[0]!).toBe(false);
  });

  test('a malformed GSTIN sends no POST, names the field, and leaves the button enabled', async () => {
    const container = await register('29ABC');
    expect(posts).toHaveLength(0);
    expect(pushes).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Business GSTIN is 15 characters');
    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});

describe('LoginForm: where a sign-in lands (story 21-7)', () => {
  async function signIn(): Promise<HTMLElement> {
    view = render(<LoginForm />);
    const { container } = view;
    setInput(field(container, 'Email'), 'x@example.com');
    setInput(field(container, 'Password'), 'hunter2hunter2');
    const form = container.querySelector('form')!;
    act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    return container;
  }

  afterEach(() => {
    localStorage.removeItem('wms-session');
  });

  test('a staff user goes to /settings, the session carries no client', async () => {
    await signIn();
    expect(pushes).toEqual(['/settings']);
    const stored = JSON.parse(localStorage.getItem('wms-session')!) as { client: unknown; user: { clientId: unknown } };
    expect(stored.client).toBeNull();
    expect(stored.user.clientId).toBeNull();
  });

  test('a client-portal user goes to /portal/stock with its client in the session', async () => {
    signInClient = { id: 'c-1', code: 'BRAND-A', name: 'Brand A' };
    await signIn();
    expect(pushes).toEqual(['/portal/stock']);
    const stored = JSON.parse(localStorage.getItem('wms-session')!) as { client: unknown; user: { clientId: unknown } };
    expect(stored.client).toEqual(signInClient);
    expect(stored.user.clientId).toBe('c-1');
  });

  test('a suspended client brand is refused with the suspension copy, and nothing is stored', async () => {
    signInRefusal = { code: 'client-suspended', status: 403, title: 'Client portal access is suspended' };
    const container = await signIn();
    expect(pushes).toEqual([]);
    expect(localStorage.getItem('wms-session')).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Your company's portal access is suspended.");
  });
});

describe('LoginForm: the second step (story 6-1b)', () => {
  const TOTP = { challenge: 'totp', challengeToken: 'chal.secret', expiresInSeconds: 300 };
  const ENROLL = {
    challenge: 'enroll',
    challengeToken: 'chal.secret',
    expiresInSeconds: 600,
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    otpauthUri: 'otpauth://totp/WMS%20(Priya)%3Ax%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=WMS%20(Priya)',
    enrolmentCodeRequired: false,
  };

  async function passwordStep(notice: string | null = null): Promise<HTMLElement> {
    view = render(<LoginForm initialEmail="x@example.com" notice={notice} />);
    const { container } = view;
    setInput(field(container, 'Password'), 'hunter2hunter2');
    act(() => void container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    return container;
  }

  function submit(container: HTMLElement): Promise<void> {
    act(() => void container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    return settle();
  }

  afterEach(() => {
    localStorage.removeItem('wms-session');
  });

  test('the sign-in tells the server this build can do the second step', async () => {
    await passwordStep();
    expect(signInHeaders).toEqual(['1']);
  });

  test('a totp challenge switches in place: email kept, password cleared, step announced, the ended notice hidden, nothing stored', async () => {
    challenge = TOTP;
    const container = await passwordStep('An owner reset your two-factor sign-in — sign in and set it up again.');
    expect(container.textContent).toContain('x@example.com');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('Step 2 of 2: enter the code from your authenticator app.');
    expect(container.textContent).not.toContain('An owner reset');
    expect(localStorage.getItem('wms-session')).toBeNull();
    const code = field(container, 'Authenticator code');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    expect(document.activeElement).toBe(code);
  });

  test('the right code: the session is written and the page left', async () => {
    challenge = TOTP;
    const container = await passwordStep();
    setInput(field(container, 'Authenticator code'), '123 456');
    await submit(container);
    expect(secondFactorPosts).toEqual([{ challengeToken: 'chal.secret', code: '123456' }]);
    expect(pushes).toEqual(['/settings']);
    expect(localStorage.getItem('wms-session')).not.toBeNull();
  });

  test('a wrong code shows the attempts left and stays on the step; "Use a backup code" sends one', async () => {
    challenge = TOTP;
    secondFactorAnswers = [{ status: 401, body: { code: 'second-factor-invalid', status: 401, title: 'Wrong code', attemptsLeft: 3 } }];
    const container = await passwordStep();
    setInput(field(container, 'Authenticator code'), '000000');
    await submit(container);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('3 attempts left');
    expect(localStorage.getItem('wms-session')).toBeNull();
    const toggle = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Use a backup code')!;
    act(() => toggle.click());
    const backup = field(container, 'Backup code');
    expect(backup.getAttribute('autocapitalize')).toBe('characters');
    setInput(backup, 'abcde-fgh23');
    await submit(container);
    expect(secondFactorPosts[1]).toEqual({ challengeToken: 'chal.secret', code: 'ABCDE-FGH23' });
    expect(pushes).toEqual(['/settings']);
  });

  test('challenge-ended from the server: back to the password with "Sign in again"', async () => {
    challenge = TOTP;
    secondFactorAnswers = [{ status: 401, body: { code: 'challenge-ended', status: 401, title: 'Sign-in step ended' } }];
    const container = await passwordStep();
    setInput(field(container, 'Authenticator code'), '123456');
    await submit(container);
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Sign in again.');
  });

  test('enrolment: the QR code and grouped key, then the backup codes — the session is written only on Continue, after "I\'ve saved these codes"', async () => {
    challenge = ENROLL;
    const codes = ['AAAAA-BBBBB', 'CCCCC-DDDDD', 'EEEEE-FFFFF', 'GGGGG-HHHHH', 'IIIII-JJJJJ', 'KKKKK-LLLLL', 'MMMMM-NNNNN', 'OOOOO-PPPPP', 'QQQQQ-RRRRR', 'SSSSS-TTTTT'];
    secondFactorAnswers = [{ status: 200, body: { ...SESSION_BODY, backupCodes: codes } }];
    const container = await passwordStep();
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('QR code');
    expect(container.textContent).toContain('JBSW Y3DP EHPK 3PXP');
    expect(container.textContent).toMatch(/Expires in \d+:\d\d/);
    expect(container.textContent).not.toContain('Enrolment code');
    setInput(field(container, 'Code from the app'), '654321');
    await submit(container);
    expect(secondFactorPosts).toEqual([{ challengeToken: 'chal.secret', code: '654321' }]);
    expect(container.querySelector('[data-testid="backup-codes"]')!.textContent).toContain('SSSSS-TTTTT');
    expect(localStorage.getItem('wms-session')).toBeNull();
    expect(pushes).toEqual([]);
    const proceed = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Continue') as HTMLButtonElement;
    expect(proceed.disabled).toBe(true);
    const saved = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(container.querySelector(`label[for="${saved.id}"]`)!.textContent).toBe("I've saved these codes");
    act(() => saved.click());
    expect(proceed.disabled).toBe(false);
    act(() => proceed.click());
    await settle();
    expect(localStorage.getItem('wms-session')).not.toBeNull();
    expect(pushes).toEqual(['/settings']);
  });

  test('after an owner\'s reset the enrolment code field appears and is sent', async () => {
    challenge = { ...ENROLL, enrolmentCodeRequired: true };
    secondFactorAnswers = [{ status: 200, body: { ...SESSION_BODY, backupCodes: ['AAAAA-BBBBB'] } }];
    const container = await passwordStep();
    setInput(field(container, 'Enrolment code'), 'K7PQ2MXA');
    setInput(field(container, 'Code from the app'), '654321');
    await submit(container);
    expect(secondFactorPosts).toEqual([{ challengeToken: 'chal.secret', code: '654321', enrolmentCode: 'K7PQ2MXA' }]);
  });

  test('failed attempts since the last sign-in are shown before going in', async () => {
    challenge = TOTP;
    secondFactorAnswers = [{ status: 200, body: { ...SESSION_BODY, secondFactorFailedAttempts: 7 } }];
    const container = await passwordStep();
    setInput(field(container, 'Authenticator code'), '123456');
    await submit(container);
    expect(container.textContent).toContain('7 failed two-factor attempts since your last sign-in');
    expect(pushes).toEqual([]);
    const proceed = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Continue')!;
    act(() => proceed.click());
    await settle();
    expect(pushes).toEqual(['/settings']);
  });

  test('client-outdated and an unknown challenge both say "Reload this page"; nothing is stored', async () => {
    signInRefusal = { code: 'client-outdated', status: 409, title: 'Reload required' };
    let container = await passwordStep();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Reload this page to sign in.');
    view?.unmount();
    signInRefusal = null;
    challenge = { challenge: 'webauthn', challengeToken: 'x', expiresInSeconds: 300 };
    container = await passwordStep();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Reload this page to sign in.');
    expect(localStorage.getItem('wms-session')).toBeNull();
  });
});
