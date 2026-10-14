import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { NotificationEntryLink } from '../notifications/notification-entry';
import { LedgerIntegrity, WarehouseIntegrity } from './ledger-integrity';

/**
 * Story 9-3c — the `/reports` Ledger integrity section, driven through a
 * stubbed global `fetch`:
 *   - owner-only (`audit.view`), hidden on `role-denied`;
 *   - the always-rendered `#ledger-integrity` anchor (loading and failed
 *     included), the empty tenant, Refresh with no polling;
 *   - per warehouse: the status (red AND the word when broken), the pre-0026
 *     line only when B > 0, the WORM line, the breaks;
 *   - Acknowledge: only with `ledger.acknowledge`, a NEW key per click, a
 *     synchronous double-click guard, a reload after, a 409 reloading silently;
 *   - the anchors list and Download proof (`ledger-proof-<code>-<from>-<to>.json`);
 *   - the bell entry's href and refresh event, and the hash change.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const OWNER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000w1';
const W2 = '0198f7a2-1b3c-7d4e-8f90-0000000000w2';
const AT = '2026-10-14T08:33:07.412Z';

function session(role: 'owner' | 'ops_manager' = 'owner'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Integrity Co', gstin: null },
    user: { id: OWNER_ID, email: 'owner@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

function anchorRow(id: string, fromSeq: number, toSeq: number, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, kind: 'verified', fromSeq, toSeq, digest: 'ab'.repeat(32), anchoredAt: AT, worm: null, ...patch };
}

function breakRow(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: 'chain',
    firstSeq: 42,
    anchorId: null,
    reason: 'hash mismatch at seq 42',
    detectedBy: 'anchor',
    detectedAt: AT,
    acknowledgedBy: null,
    acknowledgedAt: null,
    ...patch,
  };
}

function houseRow(warehouseId: string, code: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    warehouseId,
    warehouseCode: code,
    baselined: true,
    legacyThroughSeq: 0,
    verifiedThroughSeq: null,
    verifiedAt: null,
    lastRunAt: null,
    brokenAtSeq: null,
    brokenDetectedAt: null,
    lastAnchor: null,
    wormPending: 0,
    breaks: [],
    openBreakCount: 0,
    ...patch,
  };
}

interface Seen {
  method: string;
  path: string;
  search: URLSearchParams;
  key: string | null;
  auth: string | null;
}

let seen: Seen[] = [];
let integrityReplies: [number, unknown][] = [];
let integrityReply: [number, unknown] = [200, { wormStore: 'none', warehouses: [] }];
let anchorsReply: [number, unknown] = [200, { items: [], nextCursor: null }];
let ackReply: [number, unknown] = [200, breakRow('b-1', { acknowledgedAt: AT, acknowledgedBy: OWNER_ID })];
let ackGate: Promise<void> | null = null;
let proofReply: [number, unknown] = [200, { lines: ['1:aa'] }];
let downloads: { name: string; text: Promise<string> }[] = [];
let scrolled = 0;
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let originalClick: typeof HTMLAnchorElement.prototype.click;
let originalScroll: typeof HTMLElement.prototype.scrollIntoView;

function json(status: number, body: unknown): Response {
  const type = status >= 400 ? 'application/problem+json' : 'application/json';
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

let view: Rendered | undefined;

beforeEach(() => {
  seen = [];
  integrityReplies = [];
  integrityReply = [200, { wormStore: 'none', warehouses: [] }];
  anchorsReply = [200, { items: [], nextCursor: null }];
  ackReply = [200, breakRow('b-1', { acknowledgedAt: AT, acknowledgedBy: OWNER_ID })];
  ackGate = null;
  proofReply = [200, { lines: ['1:aa'] }];
  downloads = [];
  scrolled = 0;
  window.history.replaceState(null, '', window.location.pathname);
  writeSession(session());
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    seen.push({ method, path: url.pathname, search: url.searchParams, key: request.headers.get('Idempotency-Key'), auth: request.headers.get('Authorization') });
    const p = url.pathname;
    if (method === 'GET' && p.endsWith('/inventory/ledger/integrity')) {
      const next = integrityReplies.shift() ?? integrityReply;
      return json(next[0], next[1]);
    }
    if (method === 'GET' && p.endsWith('/inventory/ledger/anchors')) return json(anchorsReply[0], anchorsReply[1]);
    if (method === 'GET' && p.endsWith('/proof')) return json(proofReply[0], proofReply[1]);
    if (method === 'POST' && p.endsWith('/acknowledge')) {
      if (ackGate !== null) await ackGate;
      return json(ackReply[0], ackReply[1]);
    }
    return json(404, { code: 'not-found', status: 404, title: 'Unrouted in this test' });
  }) as unknown as typeof fetch);
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  originalClick = HTMLAnchorElement.prototype.click;
  originalScroll = HTMLElement.prototype.scrollIntoView;
  const blobs = new Map<string, Blob>();
  let n = 0;
  URL.createObjectURL = ((blob: Blob) => {
    const href = `blob:test/${n++}`;
    blobs.set(href, blob);
    return href;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, text: blobs.get(this.getAttribute('href') ?? '')!.text() });
  };
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    if (this.id === 'ledger-integrity') scrolled += 1;
  };
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  HTMLAnchorElement.prototype.click = originalClick;
  HTMLElement.prototype.scrollIntoView = originalScroll;
  window.history.replaceState(null, '', window.location.pathname);
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  act(() => {
    (element as HTMLElement).click();
  });
  await settle();
}

const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
const integrityReads = () => seen.filter((s) => s.method === 'GET' && s.path.endsWith('/inventory/ledger/integrity'));
const acks = () => seen.filter((s) => s.method === 'POST' && s.path.endsWith('/acknowledge'));
const anchor = (container: HTMLElement) => container.querySelector('#ledger-integrity') as HTMLElement | null;
const house = (container: HTMLElement, code: string) => container.querySelector(`[data-warehouse="${code}"]`) as HTMLElement | null;

async function open(): Promise<HTMLElement> {
  view = render(<LedgerIntegrity />);
  await settle();
  return view.container;
}

describe('the gate and the states', () => {
  test('owner-only: an ops_manager session renders nothing and reads nothing', async () => {
    writeSession(session('ops_manager'));
    const container = await open();
    expect(anchor(container)).toBeNull();
    expect(integrityReads()).toHaveLength(0);
  });

  test('role-denied (a demoted owner) hides the whole section', async () => {
    integrityReply = [403, { code: 'role-denied', status: 403, title: 'x', detail: 'no' }];
    const container = await open();
    expect(integrityReads()).toHaveLength(1);
    expect(anchor(container)).toBeNull();
  });

  test('the #ledger-integrity anchor is rendered while loading and when the read failed; an empty tenant reads "No warehouses yet"', async () => {
    integrityReplies = [[503, { code: 'service-unavailable', status: 503, title: 'x', detail: 'The integrity read is down.' }]];
    view = render(<LedgerIntegrity />);
    expect(anchor(view.container)).not.toBeNull();
    expect(anchor(view.container)!.textContent).toContain('Loading the ledger integrity status…');
    await settle();
    const container = view.container;
    expect(anchor(container)!.textContent).toContain('The integrity read is down.');
    await click(button(anchor(container)!, 'Retry'));
    expect(anchor(container)!.textContent).toContain('No warehouses yet');
  });

  test('Refresh re-reads (there is no polling)', async () => {
    const container = await open();
    const before = integrityReads().length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(integrityReads()).toHaveLength(before);
    await click(button(container, 'Refresh'));
    expect(integrityReads()).toHaveLength(before + 1);
  });
});

describe('per warehouse', () => {
  test('the status in priority order, red AND the word when broken; the pre-0026 line only when B > 0; the WORM line', async () => {
    integrityReply = [
      200,
      {
        wormStore: 's3',
        warehouses: [
          houseRow(W1, 'MAIN', {
            legacyThroughSeq: 5,
            verifiedThroughSeq: 900,
            verifiedAt: AT,
            brokenAtSeq: 42,
            brokenDetectedAt: AT,
            lastAnchor: anchorRow('a-9', 801, 900),
            wormPending: 2,
            breaks: [breakRow('b-1')],
            openBreakCount: 1,
          }),
          houseRow(W2, 'EAST', {
            verifiedThroughSeq: 10,
            verifiedAt: AT,
            lastAnchor: anchorRow('a-1', 1, 10, { worm: { bucket: 'b', objectKey: 'k', versionId: 'v', retainUntil: '2033-10-14T08:33:07.412Z', copiedAt: AT } }),
          }),
          houseRow('w-3', 'NEW', { baselined: false }),
        ],
      },
    ];
    const container = await open();
    const main = house(container, 'MAIN')!;
    const status = main.querySelector('[data-status]')!;
    expect(status.getAttribute('data-status')).toBe('broken');
    expect(status.textContent).toBe('Broken at #42');
    expect(status.className).toContain('text-(--destructive)');
    expect(main.textContent).toContain('5 events verified in the pre-0026 form');
    expect(main.textContent).toContain('Last anchor #801–#900 · 14 Oct 2026, 14:03');
    expect(main.textContent).toContain('2 anchors waiting for WORM copy');
    expect(main.textContent).toContain('Chain break at #42 · 14 Oct 2026, 14:03');
    expect(main.textContent).toContain('hash mismatch at seq 42');

    const east = house(container, 'EAST')!;
    expect(east.querySelector('[data-status]')!.textContent).toBe('Verified through #10 · 14 Oct 2026, 14:03');
    expect(east.textContent).not.toContain('pre-0026');
    expect(east.textContent).toContain('Stored in WORM until 14 Oct 2033');

    const fresh = house(container, 'NEW')!;
    expect(fresh.querySelector('[data-status]')!.textContent).toBe('Not yet checked');
    expect(fresh.textContent).toContain('No anchor yet');
  });

  test('WORM storage not configured (none); an acknowledged break reads so and offers no button', async () => {
    integrityReply = [
      200,
      {
        wormStore: 'none',
        warehouses: [houseRow(W1, 'MAIN', { brokenAtSeq: 42, breaks: [breakRow('b-1', { acknowledgedAt: AT, acknowledgedBy: OWNER_ID })] })],
      },
    ];
    const container = await open();
    const main = house(container, 'MAIN')!;
    expect(main.textContent).toContain('WORM storage not configured');
    expect(main.querySelector('[data-status]')!.textContent).toBe('Broken at #42 · acknowledged');
    expect(main.textContent).toContain('Acknowledged 14 Oct 2026, 14:03');
    expect(button(main, 'Acknowledge')).toBeUndefined();
  });

  test('an older open break beyond the listed 10 (openBreakCount > 0) keeps "· acknowledged" off', async () => {
    integrityReply = [
      200,
      {
        wormStore: 'none',
        warehouses: [
          houseRow(W1, 'MAIN', { brokenAtSeq: 42, breaks: [breakRow('b-1', { acknowledgedAt: AT, acknowledgedBy: OWNER_ID })], openBreakCount: 1 }),
        ],
      },
    ];
    const container = await open();
    expect(house(container, 'MAIN')!.querySelector('[data-status]')!.textContent).toBe('Broken at #42');
  });
});

describe('Acknowledge', () => {
  const brokenHouse = () => houseRow(W1, 'MAIN', { brokenAtSeq: 42, breaks: [breakRow('b-1')], openBreakCount: 1 });

  test('hidden without ledger.acknowledge; shown with it', () => {
    const props = { row: brokenHouse() as never, mode: 'none' as const, onChanged: () => undefined, onProblem: () => undefined };
    view = render(<WarehouseIntegrity {...props} canAcknowledge={false} />);
    expect(button(view.container, 'Acknowledge')).toBeUndefined();
    expect(view.container.textContent).toContain('Chain break at #42');
    view.unmount();
    view = render(<WarehouseIntegrity {...props} canAcknowledge />);
    expect(button(view.container, 'Acknowledge')).toBeDefined();
  });

  test('posts with a new key per click to the warehouse’s break, then reloads the section', async () => {
    integrityReply = [200, { wormStore: 'none', warehouses: [brokenHouse()] }];
    const container = await open();
    const before = integrityReads().length;
    await click(button(container, 'Acknowledge'));
    expect(acks()).toHaveLength(1);
    expect(acks()[0]!.path).toBe(`/api/v1/tenants/${TENANT_ID}/warehouses/${W1}/inventory/ledger/breaks/b-1/acknowledge`);
    expect(acks()[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(acks()[0]!.auth).toBe('Bearer header.payload.signature');
    expect(integrityReads()).toHaveLength(before + 1);
    await click(button(container, 'Acknowledge'));
    expect(acks()).toHaveLength(2);
    expect(acks()[1]!.key).not.toBe(acks()[0]!.key);
  });

  test('a double click posts once (the synchronous ref guard)', async () => {
    integrityReply = [200, { wormStore: 'none', warehouses: [brokenHouse()] }];
    const container = await open();
    let release!: () => void;
    ackGate = new Promise((resolve) => (release = resolve));
    const ack = button(container, 'Acknowledge')!;
    act(() => {
      ack.click();
      ack.click();
    });
    await settle();
    expect(acks()).toHaveLength(1);
    release();
    await settle();
    expect(acks()).toHaveLength(1);
  });

  test('a 409 chain-break-acknowledged reloads silently; another refusal shows its reason', async () => {
    integrityReply = [200, { wormStore: 'none', warehouses: [brokenHouse()] }];
    const container = await open();
    ackReply = [409, { code: 'chain-break-acknowledged', status: 409, title: 'x', detail: 'already' }];
    const before = integrityReads().length;
    await click(button(container, 'Acknowledge'));
    expect(integrityReads()).toHaveLength(before + 1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    ackReply = [404, { code: 'chain-break-not-found', status: 404, title: 'x', detail: 'gone' }];
    await click(button(container, 'Acknowledge'));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('That break no longer exists in this warehouse — the section is refreshed.');
  });
});

describe('the anchors and the proof', () => {
  test('Show anchors reads the paged list; Download proof saves ledger-proof-<code>-<from>-<to>.json with the bearer header', async () => {
    integrityReply = [200, { wormStore: 'none', warehouses: [houseRow(W1, 'MAIN-CHN', { verifiedThroughSeq: 20, verifiedAt: AT, lastAnchor: anchorRow('a-2', 11, 20) })] }];
    anchorsReply = [200, { items: [anchorRow('a-2', 11, 20), anchorRow('a-1', 1, 10, { kind: 'legacy' })], nextCursor: 'next' }];
    const container = await open();
    await click(button(container, 'Show anchors'));
    const listRead = seen.find((s) => s.path.endsWith('/inventory/ledger/anchors'))!;
    expect(listRead.path).toBe(`/api/v1/tenants/${TENANT_ID}/warehouses/${W1}/inventory/ledger/anchors`);
    expect(listRead.search.get('limit')).toBe('20');
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([
      ['#11–#20', 'Current form', '14 Oct 2026, 14:03', '—', 'Download proof'],
      ['#1–#10', 'Pre-0026 form', '14 Oct 2026, 14:03', '—', 'Download proof'],
    ]);
    await click(button(container, 'Next'));
    expect(seen.filter((s) => s.path.endsWith('/inventory/ledger/anchors')).at(-1)!.search.get('cursor')).toBe('next');

    const downloadButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Download proof')!;
    await click(downloadButton);
    const proofRead = seen.find((s) => s.path.endsWith('/proof'))!;
    expect(proofRead.path).toBe(`/api/v1/tenants/${TENANT_ID}/warehouses/${W1}/inventory/ledger/anchors/a-2/proof`);
    expect(proofRead.auth).toBe('Bearer header.payload.signature');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe('ledger-proof-MAIN-CHN-11-20.json');
    expect(JSON.parse(await downloads[0]!.text)).toEqual({ lines: ['1:aa'] });
  });

  test('a proof with matches: false is saved AND flagged "This range no longer matches its anchor" (words, not colour alone)', async () => {
    integrityReply = [200, { wormStore: 'none', warehouses: [houseRow(W1, 'MAIN')] }];
    anchorsReply = [200, { items: [anchorRow('a-1', 1, 10), anchorRow('a-0', 11, 20)], nextCursor: null }];
    proofReply = [200, { lines: ['1:aa'], matches: false }];
    const container = await open();
    await click(button(container, 'Show anchors'));
    expect(container.textContent).not.toContain('This range no longer matches its anchor');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Download proof'));
    expect(downloads).toHaveLength(1);
    const flag = container.querySelector('[data-proof-mismatch="a-1"]');
    expect(flag?.textContent).toBe('This range no longer matches its anchor');
    expect(container.querySelector('[data-proof-mismatch="a-0"]')).toBeNull();
    // A matching proof flags nothing.
    proofReply = [200, { lines: ['11:bb'], matches: true }];
    await click([...container.querySelectorAll('button')].filter((b) => b.textContent === 'Download proof')[1]);
    expect(container.querySelector('[data-proof-mismatch="a-0"]')).toBeNull();
  });

  test('a refused proof (404 anchor-not-found) shows its reason and saves nothing', async () => {
    integrityReply = [200, { wormStore: 'none', warehouses: [houseRow(W1, 'MAIN')] }];
    anchorsReply = [200, { items: [anchorRow('a-1', 1, 10)], nextCursor: null }];
    proofReply = [404, { code: 'anchor-not-found', status: 404, title: 'x', detail: 'no' }];
    const container = await open();
    await click(button(container, 'Show anchors'));
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Download proof'));
    expect(downloads).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('That anchor no longer exists in this warehouse — the list is refreshed.');
  });
});

describe('the bell and the hash', () => {
  const entry = {
    id: 'n-1',
    sourceType: 'ledger-chain-break',
    sourceId: 'b-1',
    warehouseId: W1,
    summary: { kind: 'chain', firstSeq: 42, reason: 'hash mismatch at seq 42', detectedBy: 'anchor' },
    raisedAt: AT,
    resolvedAt: null,
    resolution: null,
  } as const;

  test('the entry links to /reports#ledger-integrity and its click reloads the mounted section and scrolls it into view', async () => {
    view = render(
      <>
        <NotificationEntryLink entry={entry} lookups={{ sku: () => null, warehouse: () => 'MAIN Chennai DC' }} nowMs={Date.parse(AT) + 60_000} />
        <LedgerIntegrity />
      </>,
    );
    await settle();
    const container = view.container;
    expect(anchor(container)).not.toBeNull();
    const link = container.querySelector('a[data-notification="ledger-chain-break"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/reports#ledger-integrity');
    expect(link.textContent).toContain('Ledger integrity');
    expect(link.textContent).toContain('Ledger chain broken at #42 — MAIN Chennai DC');
    const before = integrityReads().length;
    const noNativeNavigation = (event: Event) => event.preventDefault();
    window.addEventListener('click', noNativeNavigation);
    try {
      await act(async () => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await settle();
    } finally {
      window.removeEventListener('click', noNativeNavigation);
    }
    expect(integrityReads()).toHaveLength(before + 1);
    expect(scrolled).toBe(1);
  });

  test('opening /reports#ledger-integrity scrolls once read; a hash change to it reloads', async () => {
    window.history.replaceState(null, '', '#ledger-integrity');
    const container = await open();
    expect(scrolled).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();
    const before = integrityReads().length;
    act(() => {
      window.dispatchEvent(new Event('hashchange'));
    });
    await settle();
    expect(integrityReads()).toHaveLength(before + 1);
    expect(anchor(container)).not.toBeNull();
  });
});
