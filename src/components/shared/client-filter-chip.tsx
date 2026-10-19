'use client';

import {
  ALL_CLIENTS,
  NOT_FILTERED_BY_CLIENT,
  SHOW_ALL_CLIENTS,
  clientChipLabel,
  writeActiveClientId,
  type ActiveClient,
} from '@/lib/active-client';
import { readSession } from '@/lib/auth';

/**
 * Story 1-5a — the chip on a screen the client switcher filters:
 * "Client: <label>" with a "Show all clients" action, so the filter can be
 * cleared at widths where the sidebar (and its switcher) is hidden.
 * Renders nothing unless a client is active — a single-client tenant, all
 * clients, or a pending/failed clients list show no chip.
 */
export function ClientFilterChip({
  active,
  tenantName,
}: {
  active: ActiveClient;
  tenantName: string | null;
}) {
  if (active.state !== 'client') return null;
  function showAll() {
    const session = readSession();
    if (session === null) return;
    writeActiveClientId(session.tenant.id, session.user.id, null);
  }
  return (
    <div
      data-testid="client-filter-chip"
      className="flex w-fit flex-wrap items-center gap-2 rounded-md border border-(--border) bg-(--muted) px-2 py-1 text-xs"
    >
      <span className="font-medium">{clientChipLabel(active.client, tenantName)}</span>
      <button type="button" onClick={showAll} className="underline underline-offset-2">
        {SHOW_ALL_CLIENTS}
      </button>
    </div>
  );
}

/**
 * Story 1-5a — a section on a filtered page that the switcher does NOT
 * filter (an unfiltered tab, a drill, a write-side screen such as wave
 * generation or the manifest builder) says "All clients", so the viewer
 * never reads it as the chosen client's. Nothing while no client is active.
 */
export function AllClientsNote({ active }: { active: ActiveClient }) {
  if (active.state !== 'client') return null;
  return (
    <span
      data-testid="all-clients-note"
      title={NOT_FILTERED_BY_CLIENT}
      className="w-fit rounded-md border border-(--border) px-2 py-0.5 text-xs text-(--muted-foreground)"
    >
      {ALL_CLIENTS}
    </span>
  );
}
