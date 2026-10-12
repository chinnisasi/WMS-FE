import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import NotificationsPage from '../../app/(app)/notifications/page';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';

/**
 * Story 9-2 — `/notifications`: the full keyset list on `DataTable`
 * Prev/Next (the cursor passed back verbatim), the API's empty answer as the
 * empty state, a failed read with Retry — and no `opened` mark (only the
 * bell's panel records an open).
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccdd01';
const CURSOR = 'eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTA2VDA5OjAwOjAwLjEyMzQ1NloiLCJpZCI6IngifQ';

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sourceType: 'qc-hold',
    sourceId: `0198f7a2-1b3c-7d4e-8f90-0000000000${id.padStart(2, '0')}`,
    warehouseId: W,
    summary: { skuId: '0198f7a2-1b3c-7d4e-8f90-0000000000a1', reason: `Reason ${id}` },
    raisedAt: '2026-10-06T04:30:00.000Z',
    resolvedAt: null,
    resolution: null,
    ...overrides,
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly params: URLSearchParams;
}

let requests: Recorded[] = [];
let mode: 'paged' | 'empty' | 'fail' | 'future' = 'paged';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  requests = [];
  mode = 'paged';
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    requests.push({ method, pathname: url.pathname, params: url.searchParams });
    const p = url.pathname;
    if (p === `/api/v1/tenants/${T}/notifications`) {
      if (mode === 'fail') return json(500, { code: 'internal-error', title: 'Internal Server Error', status: 500, detail: 'Notifications read failed' });
      if (mode === 'empty') return json(200, { items: [], nextCursor: null });
      if (mode === 'future') {
        return json(200, { items: [entry('1'), entry('8', { sourceType: 'task-assignment', summary: { taskId: 't' } })], nextCursor: null });
      }
      return url.searchParams.has('cursor')
        ? json(200, { items: [entry('3', { resolvedAt: '2026-10-06T05:00:00.000Z', resolution: 'released' })], nextCursor: null })
        : json(200, { items: [entry('1'), entry('2')], nextCursor: CURSOR });
    }
    if (p.endsWith('/catalog/skus')) return json(200, { items: [], nextCursor: null });
    if (p.endsWith('/warehouses')) return json(200, { items: [{ id: W, code: 'MAIN', name: 'Chennai DC' }], nextCursor: null });
    return json(404, { code: 'not-found', title: 'Unrouted', status: 404 });
  }) as typeof fetch);
  writeSession({
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role: 'ops_manager', status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession);
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

const listReads = () => requests.filter((r) => r.method === 'GET' && r.pathname === `/api/v1/tenants/${T}/notifications`);
const button = (label: string) => [...view!.container.querySelectorAll('button')].find((b) => b.textContent === label)!;
const entryLinks = () => [...view!.container.querySelectorAll('a[data-notification]')];

describe('/notifications', () => {
  test('pages on the keyset cursor: the first read sends nothing, Next sends the cursor verbatim, Prev returns to page one', async () => {
    view = render(NotificationsPage());
    await settle();
    expect(listReads()).toHaveLength(1);
    expect([...listReads()[0]!.params.keys()]).toEqual([]);
    expect(entryLinks()).toHaveLength(2);
    expect(entryLinks()[0]!.textContent).toContain('Reason 1');

    await act(async () => button('Next').click());
    await settle();
    expect(listReads().at(-1)!.params.get('cursor')).toBe(CURSOR);
    expect(entryLinks()).toHaveLength(1);
    expect(entryLinks()[0]!.textContent).toContain('Resolved · released');

    await act(async () => button('Prev').click());
    await settle();
    expect(entryLinks()).toHaveLength(2);
    // Reading the page never records a panel open.
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  test('the empty state is the API’s empty answer', async () => {
    mode = 'empty';
    view = render(NotificationsPage());
    await settle();
    expect(entryLinks()).toHaveLength(0);
    expect(view.container.textContent).toContain('Nothing needs your attention.');
  });

  test('a failed read says so with Retry — never progress copy', async () => {
    mode = 'fail';
    view = render(NotificationsPage());
    await settle();
    expect(view.container.textContent).toContain('Notifications unavailable');
    expect(view.container.textContent).not.toContain('Loading notifications');
    mode = 'paged';
    await act(async () => button('Retry').click());
    await settle();
    expect(entryLinks()).toHaveLength(2);
  });

  test('an entry of a source this build does not know is dropped, never rendered half-known', async () => {
    mode = 'future';
    view = render(NotificationsPage());
    await settle();
    expect(entryLinks().map((a) => a.getAttribute('data-notification'))).toEqual(['qc-hold']);
  });
});
