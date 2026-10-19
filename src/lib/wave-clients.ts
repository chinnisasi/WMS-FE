/**
 * Story 1-5a — a wave's detail names each order's client (a mixed wave
 * appears under every client it holds, decision 4, so its detail must say
 * whose each order is). The wave read carries no client: an order is for
 * one client and its lines are that client's SKUs, so each order's client
 * is read off its first line whose SKU resolves (`SkuResponse.clientId`).
 *
 * Pure; pinned by `wave-clients.test.ts`.
 */
import type { ClientDto, PicklistDto } from '@/lib/api/generated';
import { clientCell, showClients } from '@/lib/clients';

export interface WaveOrderClient {
  readonly orderId: string;
  /** The client's short name (`clientCell`), or '—' when its SKUs are not resolved. */
  readonly client: string;
}

/** The heading over the list. */
export const WAVE_ORDER_CLIENTS_HEADING = 'Orders by client';

/**
 * Each order in the wave (first-appearance order) with its client — null
 * for a single-client tenant (or the clients not loaded), where nothing is shown.
 */
export function waveOrderClients(
  picklists: readonly Pick<PicklistDto, 'lines'>[],
  skuClientOf: (skuId: string) => string | null | undefined,
  clients: readonly ClientDto[] | null,
  tenantName: string | null,
): readonly WaveOrderClient[] | null {
  if (!showClients(clients)) return null;
  const order: string[] = [];
  const clientOf = new Map<string, string | null>();
  for (const picklist of picklists) {
    for (const line of picklist.lines) {
      if (!clientOf.has(line.orderId)) {
        order.push(line.orderId);
        clientOf.set(line.orderId, null);
      }
      if (clientOf.get(line.orderId) === null) clientOf.set(line.orderId, skuClientOf(line.skuId) ?? null);
    }
  }
  return order.map((orderId) => ({ orderId, client: clientCell(clientOf.get(orderId), clients!, tenantName) }));
}

/** One row of the list. */
export function waveOrderClientLabel(entry: WaveOrderClient): string {
  return `Order ${entry.orderId} · ${entry.client}`;
}
