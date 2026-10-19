import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { readActiveClientId, writeActiveClientId } from '../../lib/active-client';
import type { ClientDto } from '../../lib/api/generated';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { useActiveClient } from '../../lib/use-active-client';
import { AllClientsNote, ClientFilterChip } from '../shared/client-filter-chip';
import { ClientSwitcher } from './client-switcher';

/**
 * Story 1-5a — the client switcher in the shell, and the chip a filtered
 * screen shows. Pinned: hidden for a single-client tenant; "All clients"
 * then the API order, departed marked; a pick is stored per tenant + user;
 * a failed clients read says so and keeps the stored pick; the chip's
 * "Show all clients" clears the filter.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const USER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000u1';
const GLOW_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000c2';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Logistics', gstin: null },
  user: { id: USER_ID, email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

function client(over: Partial<ClientDto>): ClientDto {
  return {
    id: GLOW_ID,
    tenantId: TENANT_ID,
    code: 'GLOWCO',
    name: 'GlowCo',
    status: 'active',
    systemOwned: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    taxDetails: {} as ClientDto['taxDetails'],
    registeredAddress: null,
    returnAddress: null,
    ...over,
  };
}
const SELF = client({ id: '0198f7a2-1b3c-7d4e-8f90-0000000000c1', code: 'self', name: 'Priya Logistics', systemOwned: true });
const GLOW = client({});
const GONE = client({ id: '0198f7a2-1b3c-7d4e-8f90-0000000000c3', code: 'GONE', name: 'Gone Ltd', status: 'departed' });

/** The clients read's answer: 'fail' → 503, 'hang' → never answers, else the items. */
let clientsReply: 'fail' | 'hang' | readonly ClientDto[] = [SELF, GLOW, GONE];
let clientReads = 0;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let view: Rendered | undefined;

beforeEach(() => {
  clientsReply = [SELF, GLOW, GONE];
  clientReads = 0;
  writeSession(SESSION);
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    if (pathname.endsWith(`/tenants/${TENANT_ID}/clients`)) {
      clientReads += 1;
      if (clientsReply === 'hang') return new Promise<Response>(() => undefined);
      return clientsReply === 'fail'
        ? json(503, { code: 'service-unavailable', status: 503, title: 'Unavailable', detail: 'down' })
        : json(200, { items: clientsReply });
    }
    return json(200, { items: [], nextCursor: null });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  localStorage.clear();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function click(button: Element | null | undefined): Promise<void> {
  expect(button).toBeTruthy();
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
  await settle();
}

/** A stand-in filtered screen: the chip, the note, and the filter it would pass to its hooks. */
function Screen() {
  const active = useActiveClient();
  const filter = typeof active.filter === 'symbol' ? 'pending' : (active.filter ?? 'all');
  return (
    <div>
      <span data-testid="filter">{filter}</span>
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      <AllClientsNote active={active} />
    </div>
  );
}

function options(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
}

describe('ClientSwitcher', () => {
  test('lists "All clients" first, then the clients in the API order, labelled, departed marked', async () => {
    view = render(<ClientSwitcher />);
    await settle();
    expect(view.container.textContent).toContain('All clients');
    await click(view.container.querySelector('button[aria-haspopup="listbox"]'));
    expect(options(view.container)).toEqual([
      'All clients',
      'Priya Logistics (your company)',
      'GLOWCO — GlowCo',
      'GONE — Gone Ltd (departed)',
    ]);
  });

  test('a pick is stored per tenant and user, and every screen refilters', async () => {
    view = render(
      <>
        <ClientSwitcher />
        <Screen />
      </>,
    );
    await settle();
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe('all');
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')).toBeNull();
    await click(view.container.querySelector('button[aria-haspopup="listbox"]'));
    await click([...view.container.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'GLOWCO — GlowCo'));
    expect(readActiveClientId(TENANT_ID, USER_ID)).toBe(GLOW_ID);
    expect(readActiveClientId(TENANT_ID, 'another-user')).toBeNull();
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe(GLOW_ID);
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')?.textContent).toContain(
      'Client: GLOWCO — GlowCo',
    );
    expect(view.container.querySelector('[data-testid="all-clients-note"]')?.textContent).toBe('All clients');
    // Back to All clients.
    await click(view.container.querySelector('button[aria-haspopup="listbox"]'));
    await click([...view.container.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'All clients'));
    expect(readActiveClientId(TENANT_ID, USER_ID)).toBeNull();
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe('all');
  });

  test('a departed client stays selectable', async () => {
    view = render(
      <>
        <ClientSwitcher />
        <Screen />
      </>,
    );
    await settle();
    await click(view.container.querySelector('button[aria-haspopup="listbox"]'));
    await click([...view.container.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('GONE')));
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')?.textContent).toContain('(departed)');
  });

  test('the chip\'s "Show all clients" clears the filter', async () => {
    writeActiveClientId(TENANT_ID, USER_ID, GLOW_ID);
    view = render(<Screen />);
    await settle();
    await click(
      [...view.container.querySelectorAll('[data-testid="client-filter-chip"] button')].find(
        (b) => b.textContent === 'Show all clients',
      ),
    );
    expect(readActiveClientId(TENANT_ID, USER_ID)).toBeNull();
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')).toBeNull();
  });

  test('a single-client tenant sees no switcher and no chip, even with a stored id', async () => {
    clientsReply = [SELF];
    writeActiveClientId(TENANT_ID, USER_ID, SELF.id);
    view = render(
      <>
        <ClientSwitcher />
        <Screen />
      </>,
    );
    await settle();
    expect(view.container.querySelector('[data-testid="client-switcher"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe('all');
  });

  test('while the clients load a stored pick is pending and nothing renders', async () => {
    clientsReply = 'hang';
    writeActiveClientId(TENANT_ID, USER_ID, GLOW_ID);
    view = render(
      <>
        <ClientSwitcher />
        <Screen />
      </>,
    );
    await settle();
    expect(view.container.querySelector('[data-testid="client-switcher"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe('pending');
  });

  test('a failed clients read says so, lists all clients, keeps the stored pick; Retry reads again', async () => {
    clientsReply = 'fail';
    writeActiveClientId(TENANT_ID, USER_ID, GLOW_ID);
    view = render(
      <>
        <ClientSwitcher />
        <Screen />
      </>,
    );
    await settle();
    expect(view.container.textContent).toContain('Client list unavailable — showing all clients');
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe('all');
    expect(readActiveClientId(TENANT_ID, USER_ID)).toBe(GLOW_ID);
    clientsReply = [SELF, GLOW];
    const before = clientReads;
    await click(
      [...view.container.querySelectorAll('[data-testid="client-switcher"] button')].find((b) => b.textContent === 'Retry'),
    );
    expect(clientReads).toBe(before + 1);
    // One shared read: the Retry answers the switcher AND the screen — the kept pick applies to both.
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe(GLOW_ID);
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')?.textContent).toContain('GLOWCO');
    expect(view.container.textContent).not.toContain('Client list unavailable');
  });

  test('the switcher and the screens share ONE clients read, and so always agree', async () => {
    writeActiveClientId(TENANT_ID, USER_ID, GLOW_ID);
    view = render(
      <>
        <ClientSwitcher />
        <Screen />
        <Screen />
      </>,
    );
    await settle();
    expect(clientReads).toBe(1);
    expect(view.container.querySelector('button[aria-haspopup="listbox"]')?.textContent).toContain('GLOWCO — GlowCo');
    expect([...view.container.querySelectorAll('[data-testid="filter"]')].map((e) => e.textContent)).toEqual([GLOW_ID, GLOW_ID]);
    // A clients mutation re-reads once for everyone; the last-good list stays meanwhile (no flip to pending).
    clientsReply = [SELF];
    await act(async () => {
      window.dispatchEvent(new Event('wms-clients-changed'));
    });
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).not.toBe('pending');
    await settle();
    expect(clientReads).toBe(2);
    // Now a single-client tenant: the switcher hides and every screen reads all — together.
    expect(view.container.querySelector('[data-testid="client-switcher"]')).toBeNull();
    expect([...view.container.querySelectorAll('[data-testid="filter"]')].map((e) => e.textContent)).toEqual(['all', 'all']);
  });

  test('a failed shared read: the switcher says unavailable AND every screen lists all — from one fetch', async () => {
    clientsReply = 'fail';
    writeActiveClientId(TENANT_ID, USER_ID, GLOW_ID);
    view = render(
      <>
        <ClientSwitcher />
        <Screen />
      </>,
    );
    await settle();
    expect(clientReads).toBe(1);
    expect(view.container.textContent).toContain('Client list unavailable — showing all clients');
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe('all');
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')).toBeNull();
  });

  test('a stored id absent from the loaded list reads as all clients and is never erased', async () => {
    writeActiveClientId(TENANT_ID, USER_ID, '0198f7a2-1b3c-7d4e-8f90-0000000000ff');
    view = render(
      <>
        <ClientSwitcher />
        <Screen />
      </>,
    );
    await settle();
    expect(view.container.querySelector('[data-testid="filter"]')?.textContent).toBe('all');
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')).toBeNull();
    expect(readActiveClientId(TENANT_ID, USER_ID)).toBe('0198f7a2-1b3c-7d4e-8f90-0000000000ff');
  });

  test('a client-portal session never sees the switcher', async () => {
    writeSession({ ...SESSION, user: { ...SESSION.user, role: 'client', clientId: GLOW_ID } });
    view = render(<ClientSwitcher />);
    await settle();
    expect(view.container.querySelector('[data-testid="client-switcher"]')).toBeNull();
  });
});
