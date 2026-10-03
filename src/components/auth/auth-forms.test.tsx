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

beforeAll(async () => {
  const real = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...real,
    useRouter: () => ({ push: (href: string) => void pushes.push(href) }),
  }));
  ({ RegisterForm } = await import('./auth-forms'));
});

let posts: Record<string, unknown>[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
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

beforeEach(() => {
  posts = [];
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
