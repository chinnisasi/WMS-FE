import { ApiProblem } from '@/lib/api/client';
import type { ClientDto, PatchBinDto } from '@/lib/api/generated';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { clientShortLabel, clientTakesWork } from '@/lib/clients';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { binClassReason } from '@/lib/sku-admin';

/**
 * Story 1-5b — dedicated client bins on the web (Settings → Zones and bins).
 * The copy and derivations the surface renders, kept here so they are
 * pinned by `bin-clients.test.ts` rather than living in JSX. Every read here
 * is over ALL clients (departed included) and never the 1.5a client switcher
 * (decision 13): bin admin is master data, not a client-scoped list.
 */

/** The word a shared (undedicated) bin shows, and the picker's first option. */
export const SHARED_BIN_LABEL = 'Shared';

/** The Client cell: "Shared", the client's short label, "(departed)" appended; an unknown id reads as such. */
export function binClientCell(dedicatedClientId: string | null | undefined, clients: readonly ClientDto[]): string {
  if (dedicatedClientId === null || dedicatedClientId === undefined) return SHARED_BIN_LABEL;
  const client = clients.find((entry) => entry.id === dedicatedClientId);
  if (client === undefined) return 'Unknown client';
  const label = clientShortLabel(client);
  return clientTakesWork(client) ? label : `${label} (departed)`;
}

export interface BinClientOption {
  /** `''` = Shared. */
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
}

/**
 * The Edit-client and create/grid picker: "Shared", then every client that
 * takes new work (suspended included); a CURRENT departed client is kept as
 * a disabled option so the select can show the stored value (an existing
 * dedication to a departed client stays — backend decision 8).
 */
export function binClientOptions(clients: readonly ClientDto[], currentId: string | null = null): readonly BinClientOption[] {
  const options: BinClientOption[] = [{ value: '', label: SHARED_BIN_LABEL, disabled: false }];
  for (const client of clients) {
    if (clientTakesWork(client)) {
      options.push({ value: client.id, label: clientShortLabel(client), disabled: false });
    } else if (client.id === currentId) {
      options.push({ value: client.id, label: `${clientShortLabel(client)} (departed)`, disabled: true });
    }
  }
  return options;
}

/** The Edit-client PATCH body, or null when the pick equals the stored value (nothing is sent). */
export function binClientPatch(currentId: string | null | undefined, draft: string): PatchBinDto | null {
  const next = draft === '' ? null : draft;
  if (next === (currentId ?? null)) return null;
  return { dedicatedClientId: next };
}

/** The create/grid body fragment: the key rides ONLY when a client was chosen (`''` = Shared). */
export function dedicatedClientBody(choice: string): { dedicatedClientId?: string } {
  return choice === '' ? {} : { dedicatedClientId: choice };
}

/** The merge picker's option label: the code, with its dedicated client when there is one. */
export function mergeTargetLabel(
  bin: { readonly code: string; readonly dedicatedClientId?: string | null },
  clients: readonly ClientDto[] | null,
): string {
  if (clients === null || bin.dedicatedClientId === null || bin.dedicatedClientId === undefined) return bin.code;
  return `${bin.code} — ${binClientCell(bin.dedicatedClientId, clients)}`;
}

/** The success banner of an Edit-client save, from the RESPONSE. */
export function binClientSavedWord(code: string, dedicatedClientId: string | null | undefined, clients: readonly ClientDto[]): string {
  return dedicatedClientId === null || dedicatedClientId === undefined
    ? `${code} is shared again`
    : `${code} dedicated to ${binClientCell(dedicatedClientId, clients)}`;
}

/** The note shown in place of the client affordances when the clients read failed. */
export const BIN_CLIENTS_UNAVAILABLE =
  'Clients could not be loaded — the Client column and dedicated-bin editing are unavailable until they load.';

/**
 * The Edit-client PATCH's refusals. A `not-found` here is the CLIENT (a bin
 * that vanished reads the same, but the client is what this edit names), so
 * it reads "That client no longer exists"; `bin-client-conflict` renders the
 * server's detail, which names the other client's SKUs.
 */
export function binClientReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'bin-client-conflict':
        return error.detail ?? "The bin holds another client's stock or QC holds — move them first.";
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
      default:
        return binClassReason(error);
    }
  }
  return UNREACHABLE_REASON;
}
