import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { API_BASE_URL } from '../../lib/api/client';
import { webhookUrlFromBase } from '../../lib/channels';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ChannelsView } from './channels-view';

/**
 * The channels surface (story 7-1), driven through a stubbed global `fetch`
 * — the generated client is a fetch wrapper — so the wiring under test is
 * the one that ships. The claims only a component test can make:
 *   1. connect-never-auto: mounting sends reads alone — no POST/PUT/DELETE
 *      until a button is clicked; the connect POST carries the provider
 *      pick, the provider-shaped credentials, and a per-click Idempotency-Key,
 *   2. the rotate arm PUTs the pasted material with a fresh key (a blank
 *      required field refuses locally — nothing is sent),
 *   3. the disconnect arm DELETEs with a key, behind a confirm step,
 *   4. the buffer editor's save sends MILLI-converted items and renders the
 *      per-item verdicts with the server's words (a refused item's detail
 *      verbatim), and a removed standing row rides the save as a 0-clear,
 *   5. sync health is inline, never a modal: a `degraded` card is amber WITH
 *      the lag and the last effort named, an `error` card carries the Retry
 *      affordance whose POST re-reads the list,
 *   6. an operator session renders the cards read-only — no mutating
 *      affordance at all.
 *
 * Story 7-2 adds (same stub discipline):
 *   7. the SKU-mapping editor: open-then-GET, a FULL-replacement PUT with a
 *      fresh key, local refusals (blank field, duplicate channel code, the
 *      200-row cap) that send nothing, and the server refusal arms verbatim,
 *   8. the ingest-warehouse select: a full-shape config PUT (the policy
 *      rides), `null` clearing through the '' sentinel, the saved sentences,
 *   9. the webhook URL rows: composed from the CONFIGURED API base (never
 *      the page origin), readOnly inputs with a Copy affordance, and gated
 *      off for a provider with no wired ingest.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-222222222222';
const SKU_ID = '0198f7a2-1b3c-7d4e-8f90-666666666666';
const CONNECTION_ID = '0198f7a2-1b3c-7d4e-8f90-444444444444';

const OWNER_SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const OPERATOR_SESSION: StoredSession = {
  ...OWNER_SESSION,
  user: { ...OWNER_SESSION.user, role: 'operator' },
};

let requests: {
  method: string;
  pathname: string;
  query: string;
  body: unknown;
  headers: Record<string, string>;
}[] = [];
let connectionRows: Record<string, unknown>[];
/** Overridden per test: the next mutating verb's answer, non-200 = the arm. */
let nextConnectStatus = 201;
/** null = the connect answered a problem payload (the mapper's arm). */
let connectProblem: Record<string, unknown> | null = null;
let nextBufferVerdicts: Record<string, unknown>[] | null = null;
/** The config PUT's answer override (the backorder-policy arm's stub). */
let nextConfigStatus = 200;
/** null = the config PUT answered a problem payload (the mapper's arm). */
let configProblem: Record<string, unknown> | null = null;
/** The mappings GET's list answer override (the editor's read arm). */
let mappingsList: Record<string, unknown>[] | null = null;
/** The mappings PUT's answer override, non-200 = the arm. */
let nextMappingsStatus = 200;
/** null = the mappings PUT answered a problem payload (the mapper's arm). */
let mappingsProblem: Record<string, unknown> | null = null;
/** The mappings GET's problem payload (the read arm's refusal). */
let mappingsGetProblem: Record<string, unknown> | null = null;

function connection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONNECTION_ID,
    provider: 'shopify',
    providerName: 'Shopify',
    status: 'connected',
    backorderPolicy: 'accept',
    credentialVersion: 1,
    connectedBy: 'u-1',
    rotatedAt: null,
    rotatedBy: null,
    health: 'ok',
    lastSyncedAt: '2026-10-01T08:00:00.000Z',
    lastAttemptAt: '2026-10-01T08:00:00.000Z',
    lastError: null,
    syncLagMs: 12_000,
    breakerState: 'closed',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    buffers: [{ warehouseId: WAREHOUSE_ID, skuId: SKU_ID, bufferMilli: 4000 }],
    mappingCount: 3,
    ingestWarehouseId: null,
    ...overrides,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const headers = Object.fromEntries(request.headers.entries());
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, query: url.search, body, headers });
    if (method === 'GET' && pathname.endsWith('/warehouses')) {
      return json(200, {
        items: [{ id: WAREHOUSE_ID, code: 'W1', name: 'Main', origin: {}, createdAt: '2026-09-01T00:00:00.000Z' }],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, {
        items: [
          {
            id: SKU_ID,
            code: 'SPICE-01',
            name: 'Turmeric',
            uom: 'kg',
            uomPrecision: 3,
            uomConversions: [],
            reorderPoint: 10,
            reorderQty: 50,
          },
        ],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/channels/connections')) {
      return json(200, { items: connectionRows });
    }
    if (method === 'POST' && pathname.endsWith('/channels/connections')) {
      if (connectProblem !== null) {
        return json(nextConnectStatus, connectProblem);
      }
      return json(nextConnectStatus, {
        id: '0198f7a2-1b3c-7d4e-8f90-555555555555',
        provider: (body as { provider: string }).provider,
        providerName: 'Amazon.in',
        status: 'connected',
        backorderPolicy: 'accept',
        credentialVersion: 1,
      });
    }
    if (method === 'PUT' && pathname.endsWith('/credentials')) {
      return json(200, connection());
    }
    if (method === 'PUT' && pathname.endsWith('/buffers')) {
      // The 200 verdicts are the answer — including per-item refusals.
      return json(200, {
        connectionId: CONNECTION_ID,
        verdicts:
          nextBufferVerdicts ??
          [
            {
              index: 0,
              warehouseId: WAREHOUSE_ID,
              skuId: SKU_ID,
              status: 'applied',
              bufferMilli: 2500,
              standingMilli: 2500,
            },
          ],
      });
    }
    if (method === 'GET' && pathname.endsWith('/mappings')) {
      if (mappingsGetProblem !== null) {
        return json(nextMappingsStatus, mappingsGetProblem);
      }
      return json(200, {
        connectionId: CONNECTION_ID,
        items: mappingsList ?? [{ externalRef: 'shop-variant-1', skuId: SKU_ID }],
      });
    }
    if (method === 'PUT' && pathname.endsWith('/mappings')) {
      if (mappingsProblem !== null) {
        return json(nextMappingsStatus, mappingsProblem);
      }
      return json(nextMappingsStatus, {
        connectionId: CONNECTION_ID,
        items: (body as { items: { externalRef: string; skuId: string }[] }).items,
      });
    }
    if (method === 'PUT' && pathname.includes(`/channels/connections/${CONNECTION_ID}`)) {
      if (configProblem !== null) {
        return json(nextConfigStatus, configProblem);
      }
      return json(200, connection({ ...(body as { backorderPolicy?: string }) }));
    }
    if (method === 'DELETE' && pathname.includes(`/channels/connections/${CONNECTION_ID}`)) {
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && pathname.endsWith('/retry')) {
      return json(200, connection({ breakerState: 'half-open' }));
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextConnectStatus = 201;
  connectProblem = null;
  nextBufferVerdicts = null;
  nextConfigStatus = 200;
  configProblem = null;
  mappingsList = null;
  nextMappingsStatus = 200;
  mappingsProblem = null;
  mappingsGetProblem = null;
  connectionRows = [connection()];
  stubRouter();
  writeSession(OWNER_SESSION);
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

async function mount(session: StoredSession = OWNER_SESSION): Promise<Rendered> {
  writeSession(session);
  const rendered = render(<ChannelsView />);
  await settle();
  return rendered;
}

function button(scope: HTMLElement, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent === label);
  if (found === undefined) {
    throw new Error(`no button labeled "${label}"`);
  }
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

function requestsOf(method: string, suffix = ''): typeof requests {
  return requests.filter((r) => r.method === method && r.pathname.endsWith(suffix));
}

function header(record: (typeof requests)[number], name: string): string | undefined {
  return Object.entries(record.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

/** A controlled React input needs the native setter or React never sees it. */
function setInput(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    // React's onChange for a <select> rides 'change', not 'input' — the
    // provider/backorder/warehouse picks are selects, so dispatch both.
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('ChannelsView: the connect arm (story 7-1)', () => {
  test('connect-never-auto: mounting sends reads alone; the connect POST carries provider + credentials + key', async () => {
    view = await mount();
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

    await click(button(view.container, 'Connect'));
    const providerSelect = view.container.querySelector(
      'select[aria-label="Channel provider"]',
    ) as HTMLSelectElement;
    setInput(providerSelect, 'amazon-in');
    const seller = view.container.querySelector(
      'input[aria-label="Seller id for Amazon.in"]',
    ) as HTMLInputElement;
    const token = view.container.querySelector(
      'input[aria-label="SP-API refresh token for Amazon.in"]',
    ) as HTMLInputElement;
    setInput(seller, 'A1SELLER');
    setInput(token, 'amzn1.token.test');
    await click(button(view.container, 'Connect channel'));
    await settle();

    const posts = requestsOf('POST', '/channels/connections');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      provider: 'amazon-in',
      credentials: { sellerId: 'A1SELLER', refreshToken: 'amzn1.token.test' },
    });
    expect(header(posts[0]!, 'idempotency-key')).toBeDefined();
    const key = header(posts[0]!, 'idempotency-key')!;
    // The wire contract pins the key at EXACTLY 26 (the ULID; the backend
    // validates minLength: 26, maxLength: 26).
    expect(key.length).toBe(26);
    // The credentials object carries exactly the two filled fields — the
    // optional marketplaceId stays OUT of the body when blank.
    expect(
      Object.keys((posts[0]!.body as { credentials: Record<string, string> }).credentials),
    ).toEqual(['sellerId', 'refreshToken']);
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Amazon.in connected');
    // The list re-reads — the new connection's card is the answer.
    expect(requestsOf('GET', '/channels/connections').length).toBeGreaterThanOrEqual(2);
  });

  test('a blank required field refuses locally — nothing is sent', async () => {
    view = await mount();
    await click(button(view.container, 'Connect'));
    const providerSelect = view.container.querySelector(
      'select[aria-label="Channel provider"]',
    ) as HTMLSelectElement;
    setInput(providerSelect, 'flipkart');
    // Only the appId typed; appSecret left blank.
    setInput(
      view.container.querySelector('input[aria-label="Application id for Flipkart"]') as HTMLInputElement,
      'app-1',
    );

    const before = requests.filter((r) => r.method !== 'GET');
    await click(button(view.container, 'Connect channel'));
    await settle();

    expect(requests.filter((r) => r.method !== 'GET')).toEqual(before); // no POST
    expect(view.container.textContent).toContain('Fill every required credential field');
  });

  test('a 409 connection-exists renders the refusal and re-reads the list', async () => {
    view = await mount();
    await click(button(view.container, 'Connect'));
    const providerSelect = view.container.querySelector(
      'select[aria-label="Channel provider"]',
    ) as HTMLSelectElement;
    // shopify already connects in the fixture — its option still pickable
    // through the direct value set.
    setInput(providerSelect, 'shopify');
    setInput(
      view.container.querySelector('input[aria-label="Store domain for Shopify"]') as HTMLInputElement,
      'priya.myshopify.com',
    );
    setInput(
      view.container.querySelector('input[aria-label="Admin API access token for Shopify"]') as HTMLInputElement,
      'shpat_test',
    );
    connectProblem = {
      code: 'connection-exists',
      title: 'Connection exists',
      status: 409,
      detail: 'This provider is already connected for the tenant.',
    };
    nextConnectStatus = 409;

    await click(button(view.container, 'Connect channel'));
    await settle();

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Connection exists');
    expect(banner).toContain('This provider is already connected for the tenant.');
    // The reload IS the refusal's recovery (the row the server says exists renders).
    expect(requestsOf('GET', '/channels/connections').length).toBeGreaterThanOrEqual(2);
  });
});

describe('ChannelsView: the rotate and disconnect arms (story 7-1)', () => {
  test('the rotate PUT carries the pasted material with a fresh key; the version read-back is the list', async () => {
    view = await mount();
    await click(button(view.container, 'Rotate credential'));
    setInput(
      view.container.querySelector('input[aria-label="Store domain for Shopify"]') as HTMLInputElement,
      'priya2.myshopify.com',
    );
    setInput(
      view.container.querySelector('input[aria-label="Admin API access token for Shopify"]') as HTMLInputElement,
      'shpat_rotated',
    );

    await click(button(view.container, 'Rotate credential'));
    await settle();

    const puts = requestsOf('PUT', '/credentials');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({
      credentials: { shopDomain: 'priya2.myshopify.com', accessToken: 'shpat_rotated' },
    });
    expect(header(puts[0]!, 'idempotency-key')).toBeDefined();
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Credential rotated');
    expect(banner).toContain('The credential was replaced in place');
  });

  test('the disconnect DELETE rides the confirm step and carries a key', async () => {
    view = await mount();
    await click(button(view.container, 'Disconnect'));

    const deletesBefore = requestsOf('DELETE', `/channels/connections/${CONNECTION_ID}`);
    expect(deletesBefore).toEqual([]); // the confirm step stands first

    await click(button(view.container, 'Confirm disconnect'));
    await settle();

    const deletes = requestsOf('DELETE', `/channels/connections/${CONNECTION_ID}`);
    expect(deletes).toHaveLength(1);
    expect(header(deletes[0]!, 'idempotency-key')).toBeDefined();
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Channel disconnected');
    expect(banner).toContain('released back to the pool');
  });
});

describe('ChannelsView: sync health inline (story 7-1, UX-DR19)', () => {
  test('a degraded card is amber WITH the lag and the last effort named — never colour alone, never a modal', async () => {
    connectionRows = [
      connection({
        health: 'degraded',
        syncLagMs: 185_000,
        lastAttemptAt: '2026-10-01T07:12:00.000Z',
        lastError: 'delivery timed out after 5 attempts',
      }),
    ];
    view = await mount();

    const card = [...view.container.querySelectorAll('article')].find((a) =>
      a.textContent?.includes('degraded'),
    );
    expect(card).toBeDefined();
    expect(card!.className).toContain('border-(--warning)');
    expect(card!.textContent).toContain('3m of sync lag');
    // The last effort is named in words on the card, never behind a modal.
    expect(card!.textContent).toContain('last attempt 10/1/2026, 7:12:00 AM');
    expect(card!.textContent).toContain('the last error read: delivery timed out after 5 attempts');
  });

  test('an error card carries the retry affordance; the retry POSTs and re-reads the list', async () => {
    connectionRows = [
      connection({
        health: 'error',
        lastSyncedAt: '2026-09-30T08:00:00.000Z',
        breakerState: 'open',
        lastError: 'consecutive delivery failure threshold reached',
      }),
    ];
    view = await mount();
    const readsBefore = requestsOf('GET', '/channels/connections').length;

    expect(view.container.textContent).toContain('the breaker is open after repeated delivery failures');
    await click(button(view.container, 'Retry sync'));
    await settle();

    const posts = requestsOf('POST', '/retry');
    expect(posts).toHaveLength(1);
    expect(header(posts[0]!, 'idempotency-key')).toBeDefined();
    expect(view.container.textContent).toContain('the breaker reads half-open');
    expect(requestsOf('GET', '/channels/connections').length).toBeGreaterThan(readsBefore);
  });

  test('an ok card reads neutral and names its last sync and breaker', async () => {
    view = await mount();
    const card = view.container.querySelector('article')!;
    expect(card.className).not.toContain('border-(--warning)');
    expect(card.className).not.toContain('border-(--destructive)');
    expect(card.textContent).toContain('breaker closed');
    expect(card.textContent).toContain('Last synced');
  });
});

describe('ChannelsView: the standing-buffer editor (story 7-1, AD-13)', () => {
  test('the save sends MILLI-converted items with a key; the per-item verdicts render with the server\'s words', async () => {
    view = await mount();
    const bufferInput = view.container.querySelector(
      'input[aria-label="Buffer for SPICE-01"]',
    ) as HTMLInputElement;
    // The standing 4000 milli (4 kg) prefill; the manager retypes 2.5 kg.
    expect(bufferInput.value).toBe('4');
    setInput(bufferInput, '2.5');

    await click(button(view.container, 'Save buffers'));
    await settle();

    const puts = requestsOf('PUT', '/buffers');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({
      items: [{ warehouseId: WAREHOUSE_ID, skuId: SKU_ID, bufferMilli: 2500 }],
    });
    expect(header(puts[0]!, 'idempotency-key')).toBeDefined();
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('1 buffer applied');
    // The re-read leaves the editor showing what the server says stands.
    expect(requestsOf('GET', '/channels/connections').length).toBeGreaterThanOrEqual(2);
  });

  test('a refused verdict renders the server\'s own words — the old buffer stands and is SAID', async () => {
    nextBufferVerdicts = [
      {
        index: 0,
        warehouseId: WAREHOUSE_ID,
        skuId: SKU_ID,
        status: 'refused',
        bufferMilli: 2500,
        standingMilli: 4000,
        code: 'buffer-over-ceiling',
        detail: 'pool ATP 10.000 would fall below the floor; the previous buffer of 4.000 stands',
      },
    ];
    view = await mount();
    setInput(
      view.container.querySelector('input[aria-label="Buffer for SPICE-01"]') as HTMLInputElement,
      '2.5',
    );

    await click(button(view.container, 'Save buffers'));
    await settle();

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('1 refused');
    expect(banner).toContain('the previous buffer of 4.000 stands');
  });

  test('a removed standing row rides the save as a 0-clear item', async () => {
    view = await mount();
    await click(button(view.container, 'Remove'));
    await click(button(view.container, 'Save buffers'));
    await settle();

    const puts = requestsOf('PUT', '/buffers');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({
      items: [{ warehouseId: WAREHOUSE_ID, skuId: SKU_ID, bufferMilli: 0 }],
    });
  });

  test('a malformed input refuses locally — nothing is sent', async () => {
    view = await mount();
    setInput(
      view.container.querySelector('input[aria-label="Buffer for SPICE-01"]') as HTMLInputElement,
      '1.0001',
    );

    const before = requests.filter((r) => r.method !== 'GET');
    await click(button(view.container, 'Save buffers'));
    await settle();

    expect(requests.filter((r) => r.method !== 'GET')).toEqual(before);
    expect(view.container.textContent).toContain('decimals of at most three places');
  });

  test('a blank row value refuses locally — nothing is sent', async () => {
    view = await mount();
    setInput(
      view.container.querySelector('input[aria-label="Buffer for SPICE-01"]') as HTMLInputElement,
      '',
    );

    const before = requests.filter((r) => r.method !== 'GET');
    await click(button(view.container, 'Save buffers'));
    await settle();

    expect(requests.filter((r) => r.method !== 'GET')).toEqual(before);
  });
});

describe('ChannelsView: the backorder-policy arm (story 7-1)', () => {
  test('the policy select PUTs {backorderPolicy} with a 26-char key, renders the saved sentence, and re-reads the list', async () => {
    view = await mount();
    const readsBefore = requestsOf('GET', '/channels/connections').length;
    const policySelect = view.container.querySelector(
      'select[aria-label="Backorder policy for Shopify"]',
    ) as HTMLSelectElement;

    setInput(policySelect, 'reject');
    await settle();

    const puts = requestsOf('PUT', `/channels/connections/${CONNECTION_ID}`);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({ backorderPolicy: 'reject' });
    const key = header(puts[0]!, 'idempotency-key')!;
    expect(key.length).toBe(26);
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Backorder policy saved');
    expect(banner).toContain('Backorders are rejected');
    // The saved sentence is the mapper's — and the list re-read (the wire's
    // value is what re-derives the card).
    expect(requestsOf('GET', '/channels/connections').length).toBeGreaterThan(readsBefore);
  });

  test('a policy-save refusal renders the mapper\'s words — the select stays put', async () => {
    configProblem = {
      code: 'role-denied',
      title: 'Role denied',
      status: 403,
      detail: 'role denied',
    };
    nextConfigStatus = 403;
    view = await mount();
    const policySelect = view.container.querySelector(
      'select[aria-label="Backorder policy for Shopify"]',
    ) as HTMLSelectElement;

    setInput(policySelect, 'reject');
    await settle();

    const banner = view.container.textContent ?? '';
    // `updateConnectionConfigReason`'s exact words for the capability arm.
    expect(banner).toContain('Not saved');
    expect(banner).toContain('Your role cannot change a channel’s backorder policy.');
    // The select stays put: the entry's policy is what still renders.
    const still = view.container.querySelector(
      'select[aria-label="Backorder policy for Shopify"]',
    ) as HTMLSelectElement;
    expect(still.value).toBe('accept');
  });
});

describe('ChannelsView: the capability gate (story 7-1)', () => {
  test('an operator session sees the cards read-only — no mutating affordance at all', async () => {
    view = await mount(OPERATOR_SESSION);

    const text = view.container.textContent ?? '';
    expect(text).toContain('Shopify');
    expect(text).toContain('SPICE-01');
    // The only pins: no forms, no select, no button at all.
    expect([...view.container.querySelectorAll('input, select')]).toEqual([]);
    expect([...view.container.querySelectorAll('button')]).toEqual([]);
  });

  test('an owner session carries the mutating affordances', async () => {
    view = await mount();
    const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Connect');
    expect(labels).toContain('Rotate credential');
    expect(labels).toContain('Disconnect');
    expect(labels).toContain('Save buffers');
  });
});

describe('ChannelsView: the SKU-mapping editor (story 7-2)', () => {
  test('open-then-GET; the save is a FULL-replacement PUT with a fresh key', async () => {
    mappingsList = [
      { externalRef: 'shop-variant-1', skuId: SKU_ID },
      { externalRef: 'shop-variant-2', skuId: SKU_ID },
    ];
    view = await mount();

    await click(button(view.container, 'Edit SKU mappings'));
    await settle();
    // The GET carried no key (a read, not a mutation).
    expect(requestsOf('GET', '/mappings')).toHaveLength(1);

    const ref1 = view.container.querySelector(
      'input[aria-label="Channel SKU for row row-0"]',
    ) as HTMLInputElement;
    expect(ref1.value).toBe('shop-variant-1');
    const sku0 = view.container.querySelector(
      'select[aria-label="Warehouse SKU for row row-1"]',
    ) as HTMLSelectElement;
    setInput(sku0, SKU_ID);

    await click(button(view.container, 'Add row'));
    const newRow = view.container.querySelector(
      'input[aria-label="Channel SKU for row new-3"]',
    ) as HTMLInputElement;
    setInput(newRow, 'shop-variant-3');

    await click(button(view.container, 'Save mappings'));
    await settle();

    const puts = requestsOf('PUT', '/mappings');
    expect(puts).toHaveLength(1);
    // Full replacement: every row loaded plus the added one rides the save.
    expect(puts[0]!.body).toEqual({
      items: [
        { externalRef: 'shop-variant-1', skuId: SKU_ID },
        { externalRef: 'shop-variant-2', skuId: SKU_ID },
        { externalRef: 'shop-variant-3', skuId: SKU_ID },
      ],
    });
    expect(header(puts[0]!, 'idempotency-key')).toBeDefined();
    expect(header(puts[0]!, 'idempotency-key')!.length).toBe(26);
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Mappings saved');
    expect(banner).toContain('3 mappings replaced');
    expect(banner).toContain('rows absent from this save are removed');
    // The list re-reads — the saved set is the card's new read.
    expect(requestsOf('GET', '/channels/connections').length).toBeGreaterThanOrEqual(2);
  });

  test('a duplicate channel code refuses locally — nothing is sent', async () => {
    mappingsList = [
      { externalRef: 'shop-variant-1', skuId: SKU_ID },
      { externalRef: 'shop-variant-2', skuId: SKU_ID },
    ];
    view = await mount();
    await click(button(view.container, 'Edit SKU mappings'));
    await settle();
    // Point row 2 at row 1's channel code.
    setInput(
      view.container.querySelector('input[aria-label="Channel SKU for row row-1"]') as HTMLInputElement,
      'shop-variant-1',
    );

    const before = requests.filter((r) => r.method !== 'GET');
    await click(button(view.container, 'Save mappings'));
    await settle();

    expect(requests.filter((r) => r.method !== 'GET')).toEqual(before); // no PUT
    expect(view.container.textContent).toContain('one code maps to one SKU');
  });

  test('a blank row field refuses locally — nothing is sent', async () => {
    view = await mount();
    await click(button(view.container, 'Edit SKU mappings'));
    await settle();
    await click(button(view.container, 'Add row')); // a blank externalRef row

    const before = requests.filter((r) => r.method !== 'GET');
    await click(button(view.container, 'Save mappings'));
    await settle();

    expect(requests.filter((r) => r.method !== 'GET')).toEqual(before);
    expect(view.container.textContent).toContain('Every mapping row needs a channel SKU code');
  });

  test('a save over the per-request bound refuses locally — nothing is sent', async () => {
    // 201 loaded rows; the cap is 200.
    mappingsList = Array.from({ length: 201 }, (_, i) => ({
      externalRef: `shop-variant-${i}`,
      skuId: SKU_ID,
    }));
    view = await mount();
    await click(button(view.container, 'Edit SKU mappings'));
    await settle();

    const before = requests.filter((r) => r.method !== 'GET');
    await click(button(view.container, 'Save mappings'));
    await settle();

    expect(requests.filter((r) => r.method !== 'GET')).toEqual(before); // no PUT
    expect(view.container.textContent).toContain('at most 200 rows per connection');
  });

  test('a save refusal renders the mapper\'s words — 403 names the capability, 400 rides the detail verbatim', async () => {
    mappingsProblem = {
      code: 'role-denied',
      title: 'Role denied',
      status: 403,
      detail: 'role denied',
    };
    nextMappingsStatus = 403;
    view = await mount();
    await click(button(view.container, 'Edit SKU mappings'));
    await settle();
    await click(button(view.container, 'Save mappings'));
    await settle();

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Not saved');
    expect(banner).toContain('Your role cannot edit a channel’s SKU mappings.');

    mappingsProblem = {
      code: 'validation-failed',
      title: 'Validation failed',
      status: 400,
      detail: 'the published mapping set would exceed its ceiling (3 SKUs × 2 warehouses = 6 rows)',
    };
    nextMappingsStatus = 400;
    await click(button(view.container, 'Save mappings'));
    await settle();
    expect(view.container.textContent).toContain(
      '3 SKUs × 2 warehouses = 6 rows',
    );
  });

  test('a read refusal renders the list mapper\'s words inline in the panel', async () => {
    mappingsGetProblem = {
      code: 'not-found',
      title: 'Not found',
      status: 404,
      detail: 'not found',
    };
    nextMappingsStatus = 404;
    view = await mount();
    await click(button(view.container, 'Edit SKU mappings'));
    await settle();
    const text = view.container.textContent ?? '';
    // The GET's 404 is the mapper's arm — and NO save affordance while the
    // panel cannot read what it would replace.
    expect(text).toContain('This connection no longer exists — refresh the page.');
    expect([...view.container.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Save mappings',
    );
  });
});

describe('ChannelsView: the ingest warehouse and webhook rows (story 7-2)', () => {
  test('the webhook rows compose from the CONFIGURED API base — never the page origin — and Copy works', async () => {
    view = await mount();
    const expectedOrders = webhookUrlFromBase(
      API_BASE_URL,
      TENANT_ID,
      'shopify',
      CONNECTION_ID,
      'orders',
    );
    const expectedCancellations = webhookUrlFromBase(
      API_BASE_URL,
      TENANT_ID,
      'shopify',
      CONNECTION_ID,
      'cancellations',
    );
    const ordersRow = view.container.querySelector(
      'input[aria-label="New-order webhook URL for Shopify"]',
    ) as HTMLInputElement;
    const cancellationsRow = view.container.querySelector(
      'input[aria-label="Order-cancellation webhook URL for Shopify"]',
    ) as HTMLInputElement;
    // The value IS the composer's answer against the configured base — the
    // origin it carries is API_BASE_URL's, not the page's.
    expect(ordersRow.value).toBe(expectedOrders);
    expect(cancellationsRow.value).toBe(expectedCancellations);
    expect(new URL(ordersRow.value).origin).toBe(new URL(API_BASE_URL).origin);
    expect(ordersRow.value).toContain(
      `/api/v1/tenants/${TENANT_ID}/webhooks/channels/shopify/${CONNECTION_ID}/orders`,
    );
    expect(cancellationsRow.value).toContain('/cancellations');
    // Copy affordance, no modal — the row's own button.
    await click(button(view.container, 'Copy'));
    await settle();
    expect(button(view.container, 'Copied').textContent).toBe('Copied');
  });

  test('a provider without a wired ingest renders no webhook rows', async () => {
    connectionRows = [
      connection({ provider: 'amazon-in', providerName: 'Amazon.in' }),
    ];
    view = await mount();
    expect(
      view.container.querySelector('input[aria-label="New-order webhook URL for Amazon.in"]'),
    ).toBeNull();
  });

  test('the ingest-warehouse select PUTs the full config shape with a fresh key; clearing sends null', async () => {
    view = await mount();
    const readsBefore = requestsOf('GET', '/channels/connections').length;
    const select = view.container.querySelector(
      'select[aria-label="Ingest warehouse for Shopify"]',
    ) as HTMLSelectElement;
    expect(select.value).toBe(''); // nothing ingests yet

    setInput(select, WAREHOUSE_ID);
    await settle();

    const puts = requestsOf('PUT', `/channels/connections/${CONNECTION_ID}`);
    expect(puts).toHaveLength(1);
    // The WHOLE config shape — the standing policy rides an ingest-warehouse
    // save (an omitted sibling field leaves it alone, but the editor always
    // speaks the full shape).
    expect(puts[0]!.body).toEqual({
      backorderPolicy: 'accept',
      ingestWarehouseId: WAREHOUSE_ID,
    });
    expect(header(puts[0]!, 'idempotency-key')!.length).toBe(26);
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Ingest warehouse saved');
    expect(banner).toContain('W1');
    expect(requestsOf('GET', '/channels/connections').length).toBeGreaterThan(readsBefore);
  });

  test('clearing the ingest warehouse sends the null sentinel and names what clearing costs', async () => {
    connectionRows = [connection({ ingestWarehouseId: WAREHOUSE_ID })];
    view = await mount();
    const select = view.container.querySelector(
      'select[aria-label="Ingest warehouse for Shopify"]',
    ) as HTMLSelectElement;
    expect(select.value).toBe(WAREHOUSE_ID);

    // Clearing: '' is the sentinel that becomes null on the wire.
    setInput(select, '');
    await settle();

    const puts = requestsOf('PUT', `/channels/connections/${CONNECTION_ID}`);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({
      backorderPolicy: 'accept',
      ingestWarehouseId: null,
    });
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Ingest warehouse saved');
    expect(banner).toContain('ingest-warehouse-unset');
  });
});