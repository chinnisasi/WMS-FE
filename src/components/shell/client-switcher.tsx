'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  ALL_CLIENTS,
  CLIENTS_UNAVAILABLE,
  clientOptionLabel,
  writeActiveClientId,
} from '@/lib/active-client';
import { readSession, subscribeSession } from '@/lib/auth';
import { showClients } from '@/lib/clients';
import { useActiveClient } from '@/lib/use-active-client';

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ClientGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M20 7H4v13h16z" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

/**
 * Story 1-5a — the client switcher, beside the warehouse switcher (the
 * desktop sidebar and the mobile header menu mount it with the same
 * `className` / `onPicked` contract as `WarehouseSwitcher`). "All clients"
 * first, then the clients in the API's order (self first), each labelled
 * with `clientLabel`, a departed client marked but still selectable
 * (decision 7). A pick writes the per-tenant, per-user store; every list
 * screen re-reads it and restarts from page one.
 *
 * Hidden for a single-client tenant (`showClients` false) and while the
 * clients load. A failed clients read says so — the lists then show all
 * clients — and the stored pick is kept (decision 8).
 */
export function ClientSwitcher({
  className = '',
  onPicked,
}: {
  className?: string;
  onPicked?: () => void;
}) {
  const active = useActiveClient();
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const userId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.id ?? null,
    () => null,
  );
  const portal = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.clientId != null,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (tenantId === null || userId === null || portal) return null;

  if (active.clients.state === 'failed') {
    return (
      <div className={`border-b border-(--border) px-3 py-2 lg:px-4 ${className}`} data-testid="client-switcher">
        <p role="status" className="text-xs text-(--muted-foreground)">
          {CLIENTS_UNAVAILABLE}{' '}
          <button type="button" onClick={active.clients.reload} className="underline underline-offset-2">
            Retry
          </button>
        </p>
      </div>
    );
  }
  if (active.clients.state !== 'ready' || !showClients(active.clients.data)) return null;
  const clients = active.clients.data;
  const activeId = active.state === 'client' ? active.client.id : null;
  const current = active.state === 'client' ? clientOptionLabel(active.client, active.tenantName) : ALL_CLIENTS;

  function pick(id: string | null) {
    writeActiveClientId(tenantId!, userId!, id);
    setOpen(false);
    onPicked?.();
  }

  return (
    <div
      ref={rootRef}
      className={`relative border-b border-(--border) px-3 py-2 lg:px-4 ${className}`}
      data-testid="client-switcher"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Client filter: ${current}`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-xs hover:bg-(--muted)"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-(--border)" aria-hidden>
          <ClientGlyph />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate">{current}</b>
          <span className="block text-(--muted-foreground)">Client</span>
        </span>
        <ChevronDown />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Clients"
          className="absolute inset-x-3 top-full z-10 mt-1 flex max-h-80 flex-col overflow-y-auto rounded-md border border-(--border) bg-(--card) p-1 shadow-md lg:inset-x-4"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={activeId === null}
              onClick={() => pick(null)}
              className={`flex w-full rounded-sm px-2 py-1.5 text-left text-xs ${
                activeId === null ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
              }`}
            >
              {ALL_CLIENTS}
            </button>
          </li>
          {clients.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                role="option"
                aria-selected={client.id === activeId}
                onClick={() => pick(client.id)}
                className={`flex w-full rounded-sm px-2 py-1.5 text-left text-xs ${
                  client.id === activeId ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
                } ${client.status === 'departed' ? 'text-(--muted-foreground)' : ''}`}
              >
                <span className="truncate">{clientOptionLabel(client, active.tenantName)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
