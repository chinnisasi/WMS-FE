'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiCreateClient, fetchApiRenameClient } from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { clientLabel, clientNameProblem, clientReason, notifyClientsChanged, parseClientDraft } from '@/lib/clients';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useClients } from '@/lib/use-clients';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure } from '@/components/outbound/shell';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * The clients card (story 21-2b) — the client brands this tenant holds goods
 * for. Every member reads the list (status included); an owner
 * (`clients.manage`) registers a client and renames one. The tenant's own
 * `self` client is shown as the company itself and is never renamed here —
 * its name mirrors the tenant's.
 *
 * Gating copies `sku-table.tsx`: the role is read through the session
 * subscription, so a `/me` role rewrite re-renders the affordances.
 */
export function ClientsCard() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Clients</div>
        <div className="text-(--muted-foreground)">Sign in to see your clients.</div>
      </div>
    );
  }
  return <ClientsCardSessioned />;
}

function ClientsCardSessioned() {
  const clients = useClients();
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  const canManage = roleHasCapability(role, 'clients.manage');
  const [renaming, setRenaming] = useState<ClientDto | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const columns: readonly DataTableColumn<ClientDto>[] = [
    { key: 'code', header: 'Code', render: (client) => <span className="font-mono">{client.code}</span> },
    { key: 'name', header: 'Client', render: (client) => clientLabel(client, tenantName) },
    { key: 'status', header: 'Status', render: (client) => client.status },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            render: (client: ClientDto) =>
              client.systemOwned ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(client);
                    setOutcome(null);
                  }}
                  className={rowButtonClass}
                >
                  Rename
                </button>
              ),
          } satisfies DataTableColumn<ClientDto>,
        ]
      : []),
  ];

  return (
    <section aria-label="Clients" className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Clients</h2>
        <div className="text-(--muted-foreground)">
          The brands whose goods you hold. Each SKU belongs to one client, and orders and purchase
          orders take their client from their SKUs. Your own company is always a client.
        </div>
      </div>

      {clients.state === 'failed' ? (
        <ReadFailure word="Clients unavailable" reason={clients.reason} onRetry={clients.reload} />
      ) : (
        <DataTable<ClientDto>
          columns={columns}
          rows={clients.state === 'ready' ? clients.data : []}
          emptyMessage={clients.state === 'loading' ? 'Loading clients…' : 'No clients yet.'}
        />
      )}

      {canManage ? (
        <CreateClientForm
          onCreated={(client) => {
            setOutcome({
              tone: 'accepted',
              word: `${client.code} created`,
              reason: 'Import SKUs for it from the catalog import below.',
            });
            notifyClientsChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not created', reason })}
        />
      ) : null}

      {canManage && renaming !== null ? (
        <RenameClientForm
          key={renaming.id}
          client={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(client) => {
            setRenaming(null);
            setOutcome({ tone: 'accepted', word: `${client.code} renamed`, reason: `It now reads “${client.name}”.` });
            notifyClientsChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not renamed', reason })}
        />
      ) : null}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </section>
  );
}

/**
 * Register a client — per-draft Idempotency-Key: minted on first submit,
 * reused across retries of the unchanged draft, cleared on any edit and on
 * success (a create that timed out after the server committed must replay,
 * never raise a second client).
 */
function CreateClientForm({
  onCreated,
  onRejected,
}: {
  onCreated: (client: ClientDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  // A pre-render double-click fires both handlers before `disabled`
  // renders — a synchronous ref, not state, is the re-entry guard.
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseClientDraft(code, name);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const client = await fetchApiCreateClient(session.tenant.id, parsed.body, keyRef.current);
      keyRef.current = null;
      setCode('');
      setName('');
      onCreated(client);
    } catch (error) {
      onRejected(clientReason(error, 'created'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const edit = (apply: () => void) => {
    keyRef.current = null;
    apply();
  };

  return (
    <form onSubmit={submit} aria-label="New client" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Code</span>
        <input
          className={inputClass}
          value={code}
          maxLength={32}
          required
          onChange={(event) => edit(() => setCode(event.target.value))}
          placeholder="ACME"
        />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className={labelClass}>Name</span>
        <input
          className={inputClass}
          value={name}
          required
          onChange={(event) => edit(() => setName(event.target.value))}
          placeholder="Acme Foods"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40"
      >
        {busy ? 'Adding…' : 'Add client'}
      </button>
      {problem !== null ? (
        <div role="alert" className="w-full text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </form>
  );
}

function RenameClientForm({
  client,
  onClose,
  onRenamed,
  onRejected,
}: {
  client: ClientDto;
  onClose: () => void;
  onRenamed: (client: ClientDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [name, setName] = useState(client.name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const nameProblem = clientNameProblem(name);
    if (nameProblem !== null) {
      setProblem(nameProblem);
      return;
    }
    const trimmed = name.trim();
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const renamed = await fetchApiRenameClient(session.tenant.id, client.id, trimmed, keyRef.current);
      keyRef.current = null;
      onRenamed(renamed);
    } catch (error) {
      onRejected(clientReason(error, 'renamed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={`Rename ${client.code}`} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className={labelClass}>New name for {client.code}</span>
        <input
          className={inputClass}
          value={name}
          required
          onChange={(event) => {
            keyRef.current = null;
            setName(event.target.value);
          }}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={onClose} className={rowButtonClass}>
        Cancel
      </button>
      {problem !== null ? (
        <div role="alert" className="w-full text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </form>
  );
}
