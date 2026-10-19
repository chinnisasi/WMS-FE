import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ComplianceTabs } from '../compliance/compliance-tabs';
import { SettingsTabs } from './settings-tabs';

/**
 * page-tabs — the Settings page: the header and the setup checklist above a
 * tab bar (Warehouses · Catalog · Clients · Partners · Team · Devices), one group
 * mounted at a time, `?tab=` linkable, and the checklist's Continue links
 * opening the tab that holds each step's card. Drives the real `page.tsx`
 * (`await Page({ searchParams })`) through a stubbed `fetch`.
 */

type Page = (props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) => Promise<ReactElement>;
let SettingsPage: Page;

beforeAll(async () => {
  SettingsPage = (await import('../../app/(app)/settings/page')).default as unknown as Page;
});

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

const OWNER: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-owner', email: 'owner@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const STEP = (key: string) => ({ key, label: `Step ${key}`, done: false, detail: `${key} pending`, href: '/settings' });

let requests: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let originalHref = '';

beforeEach(() => {
  requests = [];
  originalHref = window.location.href;
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    if (request.method.toUpperCase() === 'GET') requests.push(pathname);
    if (pathname === `/api/v1/tenants/${TENANT_ID}/warehouses`) {
      return json(200, { items: [{ id: 'w-1', code: 'MAIN', name: 'Chennai DC' }], nextCursor: null });
    }
    if (pathname.endsWith('/setup-checklist')) {
      return json(200, { steps: [STEP('warehouse'), STEP('bins'), STEP('catalog'), STEP('users'), { ...STEP('later'), href: '/settings#later' }] });
    }
    return json(404, { code: 'not-found', status: 404, title: 'Unrouted in this test' });
  }) as unknown as typeof fetch);
  writeSession(OWNER);
});

let view: Rendered | undefined;

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
  window.history.replaceState(null, '', originalHref);
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountPage(params: Record<string, string>): Promise<Rendered> {
  const rendered = render(await SettingsPage({ searchParams: Promise.resolve(params) }));
  await settle();
  return rendered;
}

const bar = (r: Rendered) => r.container.querySelector('[role="tablist"][aria-label="Settings sections"]')!;
const selected = (r: Rendered) => bar(r).querySelector('[aria-selected="true"]')?.getAttribute('data-tab');
const panelText = (r: Rendered) => r.container.querySelector('#settings-panel')?.textContent ?? '';
const reads = (suffix: string) => requests.filter((p) => p.endsWith(suffix));

describe('Settings — tabs (page-tabs)', () => {
  test('opens on Warehouses, mounting only that group; the checklist sits above the bar', async () => {
    view = await mountPage({});
    expect([...bar(view).querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      'Warehouses',
      'Catalog',
      'Clients',
      'Partners',
      'Team',
      'Devices',
    ]);
    expect(selected(view)).toBe('warehouses');
    // The Team and Devices cards are not mounted: they read nothing.
    expect(reads('/users')).toHaveLength(0);
    expect(reads('/devices')).toHaveLength(0);
    expect(panelText(view)).not.toContain('Users & roles');
    const checklist = [...view.container.querySelectorAll('h2')].find((h) => h.textContent === 'Setup checklist')!;
    expect(checklist).toBeDefined();
    expect(checklist.compareDocumentPosition(bar(view)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('?tab=team opens Team; an unknown tab falls back to Warehouses', async () => {
    view = await mountPage({ tab: 'team' });
    expect(selected(view)).toBe('team');
    expect(panelText(view)).toContain('Users & roles');
    expect(reads('/users').length).toBeGreaterThan(0);
    view.unmount();
    view = await mountPage({ tab: 'nope' });
    expect(selected(view)).toBe('warehouses');
  });

  test('a click swaps the group and rewrites the URL in place; the default tab writes the bare route', async () => {
    view = await mountPage({});
    await act(async () => {
      bar(view!).querySelector<HTMLButtonElement>('[data-tab="devices"]')!.click();
    });
    await settle();
    expect(selected(view)).toBe('devices');
    expect(window.location.search).toBe('?tab=devices');
    expect(panelText(view)).toContain('Device enrollment');
    expect(reads('/devices').length).toBeGreaterThan(0);
    await act(async () => {
      bar(view!).querySelector<HTMLButtonElement>('[data-tab="warehouses"]')!.click();
    });
    await settle();
    expect(window.location.pathname + window.location.search).toBe('/settings');
    expect(panelText(view)).not.toContain('Device enrollment');
  });

  test('nothing of the bar renders before the session is known (the server render); signed out, it renders over the cards\' own copy', async () => {
    // The server snapshot is "unknown": the wrappers render nothing.
    expect(renderToString(<SettingsTabs />)).toBe('');
    expect(renderToString(<ComplianceTabs />)).toBe('');
    clearSession();
    view = await mountPage({});
    expect(bar(view)).not.toBeNull();
    expect(panelText(view)).toContain('Sign in to create a warehouse');
  });

  /** The decided grouping (user, 2026-10-17): each tab's cards, panel-scoped. */
  test.each([
    ['warehouses', ['Create a warehouse', 'MAIN Chennai DC', 'Zones and bins']],
    ['catalog', ['Import catalog', 'Products', 'SKUs', 'Segregation matrix']],
    ['clients', ['Clients', 'Rate cards']],
    ['partners', ['Partners']],
    ['team', ['Users & roles']],
    ['devices', ['Device enrollment']],
  ] as const)('the %s tab holds its cards (an owner holds catalog.import)', async (tab, cards) => {
    view = await mountPage({ tab });
    expect(selected(view)).toBe(tab);
    const panel = view.container.querySelector('#settings-panel')!;
    const headings = [...panel.querySelectorAll('h2, .font-medium')].map((h) => h.textContent?.trim());
    for (const card of cards) expect(headings).toContain(card);
  });
});

describe('Settings — the setup checklist Continue links open the tab holding each step', () => {
  test('warehouse/bins → Warehouses (the bare route), catalog → Catalog, users → Team; an unknown step keeps its href', async () => {
    view = await mountPage({});
    const links = Object.fromEntries(
      [...view.container.querySelectorAll('li')].map((li) => [
        li.querySelector('.font-medium')?.textContent,
        li.querySelector('a')?.getAttribute('href'),
      ]),
    );
    expect(links).toEqual({
      'Step warehouse': '/settings',
      'Step bins': '/settings',
      'Step catalog': '/settings?tab=catalog',
      'Step users': '/settings?tab=team',
      'Step later': '/settings#later',
    });
  });
});
