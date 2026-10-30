import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import type { ClientDto } from '../../lib/api/generated';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ClientConsignmentPolicyPanel } from './client-consignment-policy';

/**
 * Story 4-6a (A11, A24) — the client's documents rule: read by every staff
 * role, changed by an owner; Save sends the PUT with the picked rule under a
 * key, and a retry of the same rule reuses it.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-cccccccccccc';
const session = (role: StoredSession['user']['role']): StoredSession => ({
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Three PL', gstin: null },
  user: { id: 'u-1', email: 'o@example.com', role, status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
});
const client = { id: CLIENT_ID, code: 'BRAND-A', name: 'Brand A', systemOwned: false } as unknown as ClientDto;

let puts: { key: string | null; body: unknown }[] = [];
let putStatus = 200;
function stub(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    if (request.method.toUpperCase() === 'PUT') {
      puts.push({ key: request.headers.get('Idempotency-Key'), body: JSON.parse(await request.text()) });
      const body = putStatus === 200 ? { client: { ...client, consignmentPolicy: { documentRule: 'all' } } } : { code: 'unavailable', status: 503, title: 'Down' };
      return new Response(JSON.stringify(body), { status: putStatus, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ clientId: CLIENT_ID, documentRule: 'b2b' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
}

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  puts = [];
  putStatus = 200;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await act(async () => void (await Promise.resolve()));
}

async function mount(canManage: boolean): Promise<void> {
  writeSession(session(canManage ? 'owner' : 'operator'));
  stub();
  view = render(<ClientConsignmentPolicyPanel client={client} canManage={canManage} onClose={() => {}} onSaved={() => {}} onDirtyChange={() => {}} />);
  await settle();
}

describe('ClientConsignmentPolicyPanel (story 4-6a)', () => {
  test('a reader sees the rule and the standing note, and no form', async () => {
    await mount(false);
    expect(view!.container.querySelector('[data-testid="consignment-rule-read"]')!.textContent).toBe('B2B orders (recommended)');
    expect(view!.container.textContent).toContain('always needs the brand’s documents');
    expect(view!.container.querySelector('form')).toBeNull();
  });

  test('an owner picks Every order and saves: the PUT carries it under a key; a retry reuses the key', async () => {
    await mount(true);
    const save = view!.container.querySelector<HTMLButtonElement>('[data-testid="consignment-rule-save"]')!;
    expect(save.disabled).toBe(true);
    const all = view!.container.querySelector<HTMLInputElement>('input[value="all"]')!;
    await act(async () => all.click());
    putStatus = 503;
    await act(async () => void view!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(view!.container.textContent).toContain('Documents rule not saved');
    putStatus = 200;
    await act(async () => void view!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(puts.map((p) => p.body)).toEqual([{ documentRule: 'all' }, { documentRule: 'all' }]);
    expect(puts[1]!.key).toBe(puts[0]!.key);
    expect(view!.container.textContent).toContain('Documents rule saved');
  });
});
