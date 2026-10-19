import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, type ReactElement } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { AdjustmentPendingsQueue } from './adjustment-pendings-queue';
import { ExcursionQueue } from './excursion-queue';
import { OverReceiptQueue } from './over-receipt-queue';
import { RejectedOpsQueue } from './rejected-ops-queue';
import { VarianceQueue } from './variance-queue';

/**
 * Story 1-5a — the client switcher on the Conflicts & Reviews queues:
 *   1. the over-receipt, variance and adjustment-pending queues send the
 *      stored client's id on every read and show the chip;
 *   2. with no stored client (or a pending / failed clients read) nothing
 *      carries a client id, and a pending read sends no queue request at all;
 *   3. the excursion and rejected-op queues are never filtered and say
 *      "All clients" while a client is active.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: T, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};
const SELF = { id: 'c-self', tenantId: T, code: 'self', name: 'Priya Spices', status: 'active', systemOwned: true };
const GLOW = { id: '0198f7a2-1b3c-7d4e-8f90-0000000000c1', tenantId: T, code: 'GLOWCO', name: 'GlowCo', status: 'active', systemOwned: false };

let clientsMode: 'ok' | 'hang' | 'fail' = 'ok';
let requests: URL[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  clientsMode = 'ok';
  requests = [];
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    requests.push(url);
    if (url.pathname.endsWith('/clients')) {
      if (clientsMode === 'hang') return new Promise<Response>(() => undefined);
      if (clientsMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500 });
      return json(200, { items: [SELF, GLOW] });
    }
    // The variance queue's first page offers a next page ('p2'), so a switch
    // test holds a real cursor; every other list answers an empty last page.
    if (url.pathname.endsWith('/movements/variances') && !url.searchParams.has('cursor')) {
      return json(200, { items: [], nextCursor: 'p2' });
    }
    return json(200, { items: [], nextCursor: null });
  }) as unknown as typeof fetch);
  writeSession(SESSION);
});

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  localStorage.clear();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(element: ReactElement): Promise<void> {
  view = render(element);
  await settle();
}

const reads = (suffix: string) => requests.filter((url) => url.pathname.endsWith(suffix));
const chip = () => view!.container.querySelector('[data-testid="client-filter-chip"]');
const note = () => view!.container.querySelector('[data-testid="all-clients-note"]');

const FILTERED: readonly { name: string; element: () => ReactElement; path: string }[] = [
  { name: 'over-receipts', element: () => <OverReceiptQueue />, path: '/receiving/over-receipts' },
  { name: 'variances', element: () => <VarianceQueue />, path: '/movements/variances' },
  { name: 'adjustment pendings', element: () => <AdjustmentPendingsQueue />, path: '/inventory/adjustment-pendings' },
];

describe('filtered queues', () => {
  for (const { name, element, path } of FILTERED) {
    test(`${name}: under a stored client every read carries clientId and the chip renders`, async () => {
      writeActiveClientId(T, 'u-1', GLOW.id);
      await mount(element());
      expect(reads(path).length).toBeGreaterThan(0);
      expect(reads(path).every((url) => url.searchParams.get('clientId') === GLOW.id)).toBe(true);
      expect(chip()?.textContent).toContain('Client: GLOWCO — GlowCo');
    });

    test(`${name}: no stored client — no clientId, no chip`, async () => {
      await mount(element());
      expect(reads(path).length).toBeGreaterThan(0);
      expect(reads(path).some((url) => url.searchParams.has('clientId'))).toBe(false);
      expect(chip()).toBeNull();
    });

    test(`${name}: pending clients read — no queue request yet`, async () => {
      clientsMode = 'hang';
      writeActiveClientId(T, 'u-1', GLOW.id);
      await mount(element());
      expect(reads(path)).toEqual([]);
    });

    test(`${name}: failed clients read — the queue reads every client`, async () => {
      clientsMode = 'fail';
      writeActiveClientId(T, 'u-1', GLOW.id);
      await mount(element());
      expect(reads(path).length).toBeGreaterThan(0);
      expect(reads(path).some((url) => url.searchParams.has('clientId'))).toBe(false);
      expect(chip()).toBeNull();
    });
  }

  test('a switch drops the held cursor: page 2 under All → GlowCo reads page 1 → back to All reads page 1 too', async () => {
    await mount(<VarianceQueue />);
    const next = () => [...view!.container.querySelectorAll('button')].find((b) => b.textContent === 'Next');
    await act(async () => {
      next()!.click();
    });
    await settle();
    const variances = () => reads('/movements/variances');
    expect(variances().at(-1)!.searchParams.get('cursor')).toBe('p2');
    expect(variances().at(-1)!.searchParams.has('clientId')).toBe(false);

    requests = [];
    await act(async () => {
      writeActiveClientId(T, 'u-1', GLOW.id);
    });
    await settle();
    expect(variances().length).toBeGreaterThan(0);
    expect(variances().every((url) => url.searchParams.get('clientId') === GLOW.id && !url.searchParams.has('cursor'))).toBe(true);

    requests = [];
    await act(async () => {
      writeActiveClientId(T, 'u-1', null);
    });
    await settle();
    expect(variances().length).toBeGreaterThan(0);
    // The page-2 cursor requested under All is never replayed on the way back.
    expect(variances().every((url) => !url.searchParams.has('clientId') && !url.searchParams.has('cursor'))).toBe(true);
  });
});

describe('unfiltered queues say "All clients"', () => {
  for (const { name, element } of [
    { name: 'excursions', element: () => <ExcursionQueue /> },
    { name: 'rejected ops', element: () => <RejectedOpsQueue /> },
  ]) {
    test(`${name}: no clientId, no chip, and the "All clients" note under a stored client`, async () => {
      writeActiveClientId(T, 'u-1', GLOW.id);
      await mount(element());
      expect(requests.some((url) => url.searchParams.has('clientId'))).toBe(false);
      expect(chip()).toBeNull();
      expect(note()?.textContent).toBe('All clients');
    });

    test(`${name}: no note while no client is active`, async () => {
      await mount(element());
      expect(note()).toBeNull();
    });
  }
});
