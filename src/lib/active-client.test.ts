import { afterEach, describe, expect, test } from 'bun:test';

import {
  ACTIVE_CLIENT_CHANGED_EVENT,
  ACTIVE_CLIENT_STORAGE_KEY,
  ALL_CLIENTS,
  CLIENT_PENDING,
  clientChipLabel,
  clientFilterForDrill,
  clientFilterKey,
  clientFilterOf,
  clientOptionLabel,
  clientQuery,
  defaultFormClientId,
  hiddenByClientFilterNote,
  readActiveClientId,
  resolveActiveClient,
  subscribeActiveClient,
  writeActiveClientId,
} from './active-client';
import type { ClientDto } from './api/generated';
import { clearSession, writeSession, type StoredSession } from './auth';
import { clientLabel } from './clients';

function client(over: Partial<ClientDto> = {}): ClientDto {
  return {
    id: 'c-glow',
    tenantId: 't-1',
    code: 'GLOWCO',
    name: 'GlowCo',
    status: 'active',
    systemOwned: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    taxDetails: { legalName: null, gstin: null, pan: null, placeOfSupply: null } as unknown as ClientDto['taxDetails'],
    registeredAddress: null,
    returnAddress: null,
    ...over,
  };
}
const SELF = client({ id: 'c-self', code: 'self', name: 'Priya Spices', systemOwned: true });
const GLOW = client();
const GONE = client({ id: 'c-gone', code: 'GONE', name: 'Gone Ltd', status: 'departed' });
const READY = { state: 'ready', data: [SELF, GLOW, GONE] } as const;

afterEach(() => {
  clearSession();
  localStorage.clear();
});

describe('active-client storage — per tenant and per user', () => {
  test('a pick is read back for the same tenant + user only', () => {
    writeActiveClientId('t-1', 'u-1', 'c-glow');
    expect(readActiveClientId('t-1', 'u-1')).toBe('c-glow');
    expect(readActiveClientId('t-1', 'u-2')).toBeNull();
    expect(readActiveClientId('t-2', 'u-1')).toBeNull();
    expect(localStorage.getItem(`${ACTIVE_CLIENT_STORAGE_KEY}:t-1:u-1`)).toBe('c-glow');
  });

  test('writing null ("All clients") removes the key', () => {
    writeActiveClientId('t-1', 'u-1', 'c-glow');
    writeActiveClientId('t-1', 'u-1', null);
    expect(readActiveClientId('t-1', 'u-1')).toBeNull();
    expect(localStorage.getItem(`${ACTIVE_CLIENT_STORAGE_KEY}:t-1:u-1`)).toBeNull();
  });

  test('a write fires the change event; the subscription hears it and the storage event of another tab', () => {
    let heard = 0;
    const off = subscribeActiveClient(() => (heard += 1));
    writeActiveClientId('t-1', 'u-1', 'c-glow');
    expect(heard).toBe(1);
    window.dispatchEvent(new StorageEvent('storage', { key: `${ACTIVE_CLIENT_STORAGE_KEY}:t-1:u-1` }));
    expect(heard).toBe(2);
    window.dispatchEvent(new StorageEvent('storage', { key: 'wms-session' }));
    expect(heard).toBe(2);
    off();
    window.dispatchEvent(new Event(ACTIVE_CLIENT_CHANGED_EVENT));
    expect(heard).toBe(2);
  });

  test('logout (clearSession) forgets the signed-in user\'s pick — and only theirs', () => {
    const session: StoredSession = {
      token: 'h.p.s',
      tenant: { id: 't-1', name: 'Priya', gstin: null },
      user: { id: 'u-1', email: 'p@example.com', role: 'owner', status: 'active' },
      expiresAt: Date.now() + 60_000,
    };
    writeSession(session);
    writeActiveClientId('t-1', 'u-1', 'c-glow');
    writeActiveClientId('t-1', 'u-2', 'c-glow');
    clearSession();
    expect(readActiveClientId('t-1', 'u-1')).toBeNull();
    expect(readActiveClientId('t-1', 'u-2')).toBe('c-glow');
  });
});

describe('resolveActiveClient — decision 8', () => {
  test('nothing stored → all clients, whatever the clients read is doing', () => {
    expect(resolveActiveClient(null, { state: 'loading' })).toEqual({ state: 'all' });
    expect(resolveActiveClient(null, READY)).toEqual({ state: 'all' });
  });

  test('stored and the clients still loading → pending (lists wait)', () => {
    expect(resolveActiveClient('c-glow', { state: 'loading' })).toEqual({ state: 'pending' });
  });

  test('stored and the clients read failed → all clients', () => {
    expect(resolveActiveClient('c-glow', { state: 'failed', reason: 'down' })).toEqual({ state: 'all' });
  });

  test('stored and found → that client; a departed client stays selectable (decision 7)', () => {
    expect(resolveActiveClient('c-glow', READY)).toEqual({ state: 'client', client: GLOW });
    expect(resolveActiveClient('c-gone', READY)).toEqual({ state: 'client', client: GONE });
  });

  test('a stored id absent from the loaded list → all clients', () => {
    expect(resolveActiveClient('c-unknown', READY)).toEqual({ state: 'all' });
  });

  test('a single-client tenant never filters, even with its own client stored', () => {
    expect(resolveActiveClient('c-self', { state: 'ready', data: [SELF] })).toEqual({ state: 'all' });
  });
});

describe('the filter a list hook receives', () => {
  test('pending → CLIENT_PENDING; client → its id; all → null', () => {
    expect(clientFilterOf({ state: 'pending' })).toBe(CLIENT_PENDING);
    expect(clientFilterOf({ state: 'client', client: GLOW })).toBe('c-glow');
    expect(clientFilterOf({ state: 'all' })).toBeNull();
  });

  test('a drill ignores the switcher (decision 11)', () => {
    expect(clientFilterForDrill('c-glow', true)).toBeNull();
    expect(clientFilterForDrill(CLIENT_PENDING, true)).toBeNull();
    expect(clientFilterForDrill('c-glow', false)).toBe('c-glow');
    expect(clientFilterForDrill(CLIENT_PENDING, false)).toBe(CLIENT_PENDING);
  });

  test('the remount-key fragment differs per filter', () => {
    const keys = [clientFilterKey(null), clientFilterKey('c-glow'), clientFilterKey('c-self'), clientFilterKey(CLIENT_PENDING)];
    expect(new Set(keys).size).toBe(4);
  });

  test('the query fragment is sent only when set', () => {
    expect(clientQuery(null)).toEqual({});
    expect(clientQuery(undefined)).toEqual({});
    expect(clientQuery('c-glow')).toEqual({ clientId: 'c-glow' });
  });
});

describe('copy', () => {
  test('options use clientLabel; a departed client is marked', () => {
    expect(clientOptionLabel(GLOW, 'Priya')).toBe('GLOWCO — GlowCo');
    expect(clientOptionLabel(SELF, 'Priya')).toBe('Priya (your company)');
    expect(clientOptionLabel(GONE, 'Priya')).toBe('GONE — Gone Ltd (departed)');
    expect(clientOptionLabel(GLOW, 'Priya')).toBe(clientLabel(GLOW, 'Priya'));
    expect(ALL_CLIENTS).toBe('All clients');
  });

  test('the chip names the client', () => {
    expect(clientChipLabel(GLOW, 'Priya')).toBe('Client: GLOWCO — GlowCo');
  });

  test('a create for another client than the active one is hidden by the filter — and says so', () => {
    const active = { state: 'client', client: GLOW } as const;
    expect(hiddenByClientFilterNote(active, 'c-self', [SELF, GLOW], 'Priya')).toBe(
      'Created for Priya (your company) — hidden by the client filter',
    );
    expect(hiddenByClientFilterNote(active, 'c-glow', [SELF, GLOW], 'Priya')).toBeNull();
    expect(hiddenByClientFilterNote({ state: 'all' }, 'c-self', [SELF, GLOW], 'Priya')).toBeNull();
    expect(hiddenByClientFilterNote(active, null, [SELF, GLOW], 'Priya')).toBeNull();
    expect(hiddenByClientFilterNote(active, 'c-x', null, 'Priya')).toBe('Created for another client — hidden by the client filter');
  });

  test('a create form defaults to the active client only when its picker offers it', () => {
    const active = { state: 'client', client: GLOW } as const;
    expect(defaultFormClientId(active, [SELF, GLOW], '')).toBe('c-glow');
    expect(defaultFormClientId(active, [SELF], '')).toBe('');
    expect(defaultFormClientId(active, null, 'x')).toBe('x');
    expect(defaultFormClientId({ state: 'all' }, [SELF, GLOW], '')).toBe('');
  });
});
