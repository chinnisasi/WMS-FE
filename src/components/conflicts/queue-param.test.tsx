import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import type { ReactElement } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';

/**
 * Story 9-2 — `/conflicts?queue=<id>`: a notification for a pending
 * adjustment, a variance or a rejected op opens ITS queue (a plain param,
 * never a drill). An unknown id, or a queue the role cannot see, falls back
 * to the default; following another queue's link remounts on it.
 */

type Page = (props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) => Promise<ReactElement>;
let ConflictsPage: Page;

beforeAll(async () => {
  const real = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...real,
    useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
    usePathname: () => '/conflicts',
  }));
  ConflictsPage = (await import('../../app/(app)/conflicts/page')).default;
});

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function session(role: StoredSession['user']['role']): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

let view: Rendered | undefined;

beforeEach(() => {
  stubGlobal('fetch', (async () =>
    new Response(JSON.stringify({ items: [], nextCursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch);
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

async function open(params: Record<string, string>): Promise<string | null> {
  const ui = await ConflictsPage({ searchParams: Promise.resolve(params) });
  if (view === undefined) view = render(ui);
  else view.rerender(ui);
  await settle();
  return view.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null;
}

describe('/conflicts?queue=', () => {
  test('each notification queue opens its tab; following another queue link switches to it', async () => {
    writeSession(session('owner'));
    expect(await open({ queue: 'adjustment-pendings' })).toBe('Adjustment pendings');
    expect(await open({ queue: 'variances' })).toBe('Variances');
    expect(await open({ queue: 'rejected-ops' })).toBe('Rejected ops');
  });

  test('no queue, an unknown queue, or a queue the role cannot see: the default tab', async () => {
    writeSession(session('owner'));
    expect(await open({})).toBe('Over-receipts');
    view!.unmount();
    view = undefined;
    expect(await open({ queue: 'nope' })).toBe('Over-receipts');
    view!.unmount();
    view = undefined;
    // The ops manager does not hold adjustments.approve — no pendings tab.
    writeSession(session('ops_manager'));
    expect(await open({ queue: 'adjustment-pendings' })).toBe('Over-receipts');
  });
});
