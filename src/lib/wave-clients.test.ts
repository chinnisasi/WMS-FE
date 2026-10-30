import { describe, expect, test } from 'bun:test';

import type { ClientDto } from '@/lib/api/generated';
import { waveOrderClientLabel, waveOrderClients } from '@/lib/wave-clients';

function client(id: string, code: string, systemOwned = false): ClientDto {
  return {
    id,
    tenantId: 't',
    code,
    name: systemOwned ? 'Acme' : `${code} Ltd`,
    status: 'active',
    systemOwned,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    taxDetails: {} as ClientDto['taxDetails'],
    registeredAddress: null,
    returnAddress: null,
    emailReplyTo: null,
  };
}

const SELF = client('c-self', 'self', true);
const GLOW = client('c-glow', 'GLOWCO');
const skuClient: Record<string, string> = { 'sku-a': 'c-self', 'sku-g': 'c-glow' };

const line = (orderId: string, skuId: string) => ({ orderId, skuId }) as never;

describe('waveOrderClients', () => {
  test('names each order once, by its SKUs’ client, in first-appearance order', () => {
    const picklists = [{ lines: [line('o-1', 'sku-g'), line('o-2', 'sku-a'), line('o-1', 'sku-g')] }];
    expect(waveOrderClients(picklists, (id) => skuClient[id], [SELF, GLOW], 'Acme')).toEqual([
      { orderId: 'o-1', client: 'GLOWCO' },
      { orderId: 'o-2', client: 'Acme' },
    ]);
  });

  test('a later resolvable line fills an order whose first SKU is unknown', () => {
    const picklists = [{ lines: [line('o-1', 'sku-x')] }, { lines: [line('o-1', 'sku-g')] }];
    expect(waveOrderClients(picklists, (id) => skuClient[id], [SELF, GLOW], 'Acme')).toEqual([
      { orderId: 'o-1', client: 'GLOWCO' },
    ]);
  });

  test('unresolved → a dash; a single-client tenant or no clients → null', () => {
    const picklists = [{ lines: [line('o-1', 'sku-x')] }];
    expect(waveOrderClients(picklists, () => undefined, [SELF, GLOW], 'Acme')).toEqual([{ orderId: 'o-1', client: '—' }]);
    expect(waveOrderClients(picklists, (id) => skuClient[id], [SELF], 'Acme')).toBeNull();
    expect(waveOrderClients(picklists, (id) => skuClient[id], null, 'Acme')).toBeNull();
  });

  test('the row label', () => {
    expect(waveOrderClientLabel({ orderId: 'o-1', client: 'GLOWCO' })).toBe('Order o-1 · GLOWCO');
  });
});
