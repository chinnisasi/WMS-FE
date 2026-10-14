import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { NotificationEntryLink } from '../notifications/notification-entry';
import { AuditTrail } from './audit-trail';

/**
 * Story 9-3b — the async audit export on `/reports`, driven through a
 * stubbed global `fetch`:
 *   - "Export the applied filters" posts the APPLIED filters (never a draft),
 *     with a NEW Idempotency-Key per click, then reloads "Your exports";
 *   - it stays available when the trail 503s, and hides on role-denied;
 *   - "Your exports": the always-rendered `#audit-exports` anchor (loading and
 *     failed included), "Preparing…", the filter summary, the empty state,
 *     Refresh, and the hash change that reloads and scrolls;
 *   - Download fetches the file with the bearer header and saves it under a
 *     name built from `requestedAt`; a 409/404 shows its reason and reloads.
 * Download replies serve PLAIN CSV bytes (the browser's fetch has already
 * inflated the gzip by the time the page sees them).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const OWNER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const SYSTEM_ID = '01900000-0000-7000-8000-000000000000';
const CSV = '﻿recorded_at,occurred_at,actor_kind,actor_user_id,actor_email,action,target_type,target_id\r\n';

function session(): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Audit Co', gstin: null },
    user: { id: OWNER_ID, email: 'owner@example.com', role: 'owner', status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

function exportRow(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    status: 'ready',
    filters: {},
    requestedAt: '2026-10-13T08:33:07.412Z',
    startedAt: '2026-10-13T08:33:10.000Z',
    finishedAt: '2026-10-13T08:34:00.000Z',
    expiresAt: '2026-10-20T08:34:00.000Z',
    rowCount: 102345,
    byteSize: 2048,
    sha256: 'a'.repeat(64),
    failureReason: null,
    ...patch,
  };
}

interface Seen {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
  key: string | null;
  auth: string | null;
}

let seen: Seen[] = [];
let trailReply: [number, unknown] = [200, { items: [], nextCursor: null, systemActorId: SYSTEM_ID }];
let listReplies: [number, unknown][] = [];
let listReply: [number, unknown] = [200, { items: [] }];
let postReply: [number, unknown] = [202, exportRow('e-new', { status: 'queued' })];
let fileReply: [number, unknown] | 'csv' = 'csv';
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
  trailReply = [200, { items: [], nextCursor: null, systemActorId: SYSTEM_ID }];
  listReplies = [];
  listReply = [200, { items: [] }];
  postReply = [202, exportRow('e-new', { status: 'queued' })];
  fileReply = 'csv';
  downloads = [];
  scrolled = 0;
  window.history.replaceState(null, '', window.location.pathname);
  writeSession(session());
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    if (method === 'POST') {
      try {
        body = await request.json();
      } catch {
        body = null;
      }
    }
    seen.push({ method, path: url.pathname, search: url.searchParams, body, key: request.headers.get('Idempotency-Key'), auth: request.headers.get('Authorization') });
    const p = url.pathname;
    if (p.endsWith('/reporting/audit')) return json(trailReply[0], trailReply[1]);
    if (method === 'POST' && p.endsWith('/reporting/audit/exports')) return json(postReply[0], postReply[1]);
    if (method === 'GET' && p.endsWith('/reporting/audit/exports')) {
      const next = listReplies.shift() ?? listReply;
      return json(next[0], next[1]);
    }
    if (method === 'GET' && p.endsWith('/file')) {
      if (fileReply === 'csv') return new Response(CSV, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
      return json(fileReply[0], fileReply[1]);
    }
    if (p.endsWith('/users')) {
      return json(200, {
        items: [{ id: OWNER_ID, tenantId: TENANT_ID, email: 'owner@example.com', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
        nextCursor: null,
      });
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
    if (this.id === 'audit-exports') scrolled += 1;
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

function setValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  act(() => {
    (element as HTMLElement).click();
  });
  await settle();
}

async function apply(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form[aria-label="Audit filters"]') as HTMLFormElement;
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
const posts = () => seen.filter((s) => s.method === 'POST' && s.path.endsWith('/reporting/audit/exports'));
const listReads = () => seen.filter((s) => s.method === 'GET' && s.path.endsWith('/reporting/audit/exports'));
const anchor = (container: HTMLElement) => container.querySelector('#audit-exports') as HTMLElement | null;
const exportRows = (container: HTMLElement) =>
  [...anchor(container)!.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));

async function open(): Promise<HTMLElement> {
  view = render(<AuditTrail />);
  await settle();
  return view.container;
}

describe('Export the applied filters (9-3b)', () => {
  test('posts the APPLIED filters — an unapplied draft is not sent — with a new key per click, then reloads the list', async () => {
    const container = await open();
    setValue(container.querySelector('[aria-label="Audit action prefix"]') as HTMLInputElement, 'transfer.');
    await apply(container);
    // A draft edited after Apply is NOT what the export sends.
    setValue(container.querySelector('[aria-label="Audit action prefix"]') as HTMLInputElement, 'warehouse.');
    const readsBefore = listReads().length;
    await click(button(container, 'Export the applied filters'));
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({ actionPrefix: 'transfer.' });
    expect(posts()[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(posts()[0]!.path).toBe(`/api/v1/tenants/${TENANT_ID}/reporting/audit/exports`);
    expect(listReads().length).toBeGreaterThan(readsBefore);
    expect(container.textContent).toContain('Export queued');

    postReply = [409, { code: 'export-in-progress', status: 409, title: 'x', detail: 'You already have one.' }];
    await click(button(container, 'Export the applied filters'));
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.key).not.toBe(posts()[0]!.key);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('An export is already running — wait for it to finish');
  });

  test('stays available when the trail read 503s (the case an export exists for)', async () => {
    trailReply = [503, { code: 'report-unavailable', status: 503, title: 'x', detail: 'took too long' }];
    const container = await open();
    expect(container.textContent).toContain('Narrow the filters or dates');
    const exportButton = button(container, 'Export the applied filters');
    expect(exportButton?.disabled).toBe(false);
    await click(exportButton);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({});
  });

  test('hidden on role-denied — the trail’s, or the exports list’s', async () => {
    trailReply = [403, { code: 'role-denied', status: 403, title: 'x', detail: 'no' }];
    let container = await open();
    expect(button(container, 'Export the applied filters')).toBeUndefined();
    expect(anchor(container)).toBeNull();
    view?.unmount();
    trailReply = [200, { items: [], nextCursor: null, systemActorId: SYSTEM_ID }];
    listReply = [403, { code: 'role-denied', status: 403, title: 'x', detail: 'no' }];
    container = await open();
    expect(button(container, 'Export the applied filters')).toBeUndefined();
    expect(anchor(container)).toBeNull();
  });
});

describe('Your exports (9-3b)', () => {
  test('the #audit-exports anchor is rendered while loading and when the read failed; the empty state reads "No exports yet"', async () => {
    listReplies = [[503, { code: 'service-unavailable', status: 503, title: 'x', detail: 'The exports read is down.' }]];
    view = render(<AuditTrail />);
    // Before any read settles: loading, and the anchor is there.
    expect(anchor(view.container)).not.toBeNull();
    await settle();
    const container = view.container;
    expect(anchor(container)).not.toBeNull();
    expect(anchor(container)!.textContent).toContain('The exports read is down.');
    await click([...anchor(container)!.querySelectorAll('button')].find((b) => b.textContent === 'Retry'));
    expect(anchor(container)!.textContent).toContain('No exports yet');
  });

  test('rows: requested IST, the filter summary, "Preparing…" for queued and running, events, size, expiry — Download only when ready', async () => {
    listReply = [
      200,
      {
        items: [
          exportRow('e-3', { status: 'queued', startedAt: null, finishedAt: null, expiresAt: null, rowCount: null, byteSize: null, sha256: null, filters: { actorUserId: SYSTEM_ID } }),
          exportRow('e-2', {
            status: 'running',
            finishedAt: null,
            expiresAt: null,
            rowCount: null,
            byteSize: null,
            sha256: null,
            filters: { actionPrefix: 'transfer.', from: '2026-09-30T18:30:00.000Z', to: '2026-10-12T18:30:00.000Z' },
          }),
          exportRow('e-1', { filters: { actorUserId: OWNER_ID, targetType: 'transfer_order' } }),
          exportRow('e-0', { status: 'failed', rowCount: null, byteSize: null, sha256: null, failureReason: 'too-many-events' }),
        ],
      },
    ];
    const container = await open();
    expect(exportRows(container)).toEqual([
      ['13 Oct 2026, 14:03', 'System', 'Preparing…', '—', '—', '—', ''],
      ['13 Oct 2026, 14:03', 'transfer.* · 01 Oct 2026 – 12 Oct 2026', 'Preparing…', '—', '—', '—', ''],
      ['13 Oct 2026, 14:03', 'owner@example.com · Transfer', 'Ready', '1,02,345', '2.0 KB', '20 Oct 2026, 14:04', 'Download'],
      ['13 Oct 2026, 14:03', 'Everything', 'Failed — too many events — narrow the filters or dates', '—', '—', '20 Oct 2026, 14:04', ''],
    ]);
  });

  test('Refresh re-reads the list (there is no polling)', async () => {
    const container = await open();
    const before = listReads().length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listReads()).toHaveLength(before);
    await click(button(container, 'Refresh'));
    expect(listReads()).toHaveLength(before + 1);
  });

  test('a hash change to #audit-exports reloads the list and scrolls it into view; opening /reports#audit-exports scrolls once ready', async () => {
    const container = await open();
    expect(scrolled).toBe(0);
    // Set the hash first and let anything the DOM does about it settle, so
    // exactly ONE hashchange is measured below.
    window.history.replaceState(null, '', '#audit-exports');
    // happy-dom may queue a hashchange of its own on a macrotask — let it land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();
    const before = listReads().length;
    const scrolledBefore = scrolled;
    act(() => {
      window.dispatchEvent(new Event('hashchange'));
    });
    await settle();
    expect(listReads()).toHaveLength(before + 1);
    expect(scrolled).toBe(scrolledBefore + 1);
    // A hash change to anything else reads nothing.
    window.history.replaceState(null, '', '#elsewhere');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();
    const quiet = listReads().length;
    act(() => {
      window.dispatchEvent(new Event('hashchange'));
    });
    await settle();
    expect(listReads()).toHaveLength(quiet);
    expect(container.querySelector('#audit-exports')).not.toBeNull();

    view?.unmount();
    view = undefined;
    scrolled = 0;
    window.history.replaceState(null, '', '#audit-exports');
    await open();
    expect(scrolled).toBe(1);
  });

  test('clicking the bell’s audit-export entry while the list is mounted reloads it and scrolls it into view (a Link’s pushState fires no hashchange)', async () => {
    const entry = {
      id: 'n-1',
      sourceType: 'audit-export',
      sourceId: 'e-1',
      warehouseId: null,
      summary: { status: 'ready', rowCount: 3 },
      raisedAt: '2026-10-13T08:34:00.000Z',
      resolvedAt: null,
      resolution: null,
    } as const;
    view = render(
      <>
        <NotificationEntryLink entry={entry} lookups={{ sku: () => null, warehouse: (id) => id }} nowMs={Date.parse('2026-10-13T09:00:00.000Z')} />
        <AuditTrail />
      </>,
    );
    await settle();
    const container = view.container;
    expect(anchor(container)).not.toBeNull();
    const before = listReads().length;
    let navigated = 0;
    const onHash = () => (navigated += 1);
    // Next's router navigates with pushState (no hashchange). Outside a router
    // the Link falls back to the anchor's native navigation, which happy-dom
    // turns into a hashchange — cancel that default (after React's handlers
    // ran) so the test sees exactly what a real in-app click does.
    const noNativeNavigation = (event: Event) => event.preventDefault();
    window.addEventListener('hashchange', onHash);
    window.addEventListener('click', noNativeNavigation);
    try {
      const link = container.querySelector('a[data-notification="audit-export"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/reports#audit-exports');
      await act(async () => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await settle();
    } finally {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('click', noNativeNavigation);
    }
    // No hashchange is relied on: the click itself asked for the reload.
    expect(navigated).toBe(0);
    expect(listReads()).toHaveLength(before + 1);
    expect(scrolled).toBe(1);
  });

  test('Download fetches the file with the bearer header and saves it as audit-export-<IST yyyyMMdd-HHmm>.csv', async () => {
    listReply = [200, { items: [exportRow('e-1')] }];
    const container = await open();
    await click(button(container, 'Download'));
    const fileRead = seen.find((s) => s.path.endsWith('/file'))!;
    expect(fileRead.path).toBe(`/api/v1/tenants/${TENANT_ID}/reporting/audit/exports/e-1/file`);
    expect(fileRead.auth).toBe('Bearer header.payload.signature');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe('audit-export-20261013-1403.csv');
    expect(await downloads[0]!.text).toBe(CSV);
  });

  test('a refused download (409 expired, 404) shows its reason and reloads the list', async () => {
    listReply = [200, { items: [exportRow('e-1')] }];
    const container = await open();
    fileReply = [409, { code: 'export-expired', status: 409, title: 'x', detail: 'gone' }];
    const before = listReads().length;
    await click(button(container, 'Download'));
    expect(downloads).toHaveLength(0);
    expect(container.querySelector('#audit-exports [role="alert"]')?.textContent).toBe('That export has expired and its file was deleted — export again.');
    expect(listReads()).toHaveLength(before + 1);

    fileReply = [404, { code: 'export-not-found', status: 404, title: 'x', detail: 'no' }];
    await click(button(container, 'Download'));
    expect(container.querySelector('#audit-exports [role="alert"]')?.textContent).toBe('That export no longer exists — the list is refreshed.');
  });
});
