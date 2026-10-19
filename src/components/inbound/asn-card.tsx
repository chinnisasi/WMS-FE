'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiAmendAsn,
  fetchApiCreateAsn,
  fetchApiGetAsn,
  fetchApiTransitionAsn,
} from '@/lib/api/client';
import type { AsnDto, AsnEntryDto, ClientDto, SkuResponse } from '@/lib/api/generated';
import {
  ASN_STATUS_LABEL,
  MAX_ASN_CODE_LENGTH,
  MAX_ASN_NOTE_LENGTH,
  amendDraftOf,
  asnProgressLabel,
  asnReason,
  canAmendAsn,
  canCancelAsn,
  canCloseAsn,
  expectedAtInputValue,
  notifyInboundChanged,
  parseAsnAmend,
  parseAsnCreate,
  parseAsnNote,
  withoutKits,
  type AsnDraftLine,
} from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { clientCell, clientLabel, showClients, skusOfClient, workingClients } from '@/lib/clients';
import { quantityLabel } from '@/lib/format-quantity';
import { readReason } from '@/lib/outbound-orders';
import { openQtyLabel } from '@/lib/over-receipt';
import { useAsns } from '@/lib/use-asns';
import { readyClients, useClients } from '@/lib/use-clients';
import { useSkuMap } from '@/lib/use-inbound';
import { useKits } from '@/lib/use-catalog';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { AsnImport } from '@/components/inbound/asn-import';
import { ReadFailure } from '@/components/outbound/shell';
import { lineButtonClass as buttonClass, lineInputClass as inputClass, LineRows } from '@/components/shared/line-rows';

/**
 * Story 21-6 — the Inbound surface's advance shipment notices: a client
 * announces a shipment before the truck arrives, and receiving books against
 * the ASN exactly as against a PO. The list (code, client once the tenant
 * holds more than its own, status, expected arrival, received of announced)
 * with each row's detail (its lines) expanded in place; every mutation —
 * announce, amend, close short, cancel — is gated on `asn.manage` and offered
 * only where the row's state allows it. Pessimistic throughout: every row
 * shown is the server's answer.
 *
 * Story 21-6b shipped the handheld flow (an open ASN is received on the
 * device like a PO), so the 21-6 "arrives with the next handheld update"
 * notice is gone.
 */

const NO_KITS: ReadonlySet<string> = new Set();

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

export function AsnsCard({
  warehouseId,
  warehouseLabel,
  warehouseCode = null,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
  /** The ASN import's template pre-fills it (the `warehouse` column must equal it or stay blank). */
  warehouseCode?: string | null;
}) {
  const asns = useAsns(warehouseId);
  const skus = useSkuMap();
  // A kit can never hold stock, so receiving refuses a kit line (409
  // kit-cannot-hold-stock): the pickers never offer one, as the portal's
  // `portal/skus` never lists one. Until the kit list is read nothing is
  // hidden — the server's refusal (worded by `asnReason`) still stands.
  const kits = useKits();
  const kitIds: ReadonlySet<string> = kits.state === 'ready' ? new Set(Object.keys(kits.data)) : NO_KITS;
  const clients = readyClients(useClients());
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  // Subscribed, never a bare readSession() at render: the /me bootstrap
  // rewrites the role after mount.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'asn.manage');

  // State that belongs to ONE warehouse is keyed by it (keyed derivation, not
  // a reset effect): a switch invalidates it in the same render.
  const [opened, setOpened] = useState<{ warehouseId: string; asnId: string } | null>(null);
  const openId = opened !== null && opened.warehouseId === warehouseId ? opened.asnId : null;
  const [banner, setBanner] = useState<{ warehouseId: string; outcome: Outcome } | null>(null);
  const outcome = banner !== null && banner.warehouseId === warehouseId ? banner.outcome : null;
  const [creating, setCreating] = useState(false);
  // The ASN import (2026-10-17): open for ONE warehouse (keyed derivation).
  const [importingFor, setImportingFor] = useState<string | null>(null);
  const importing = importingFor !== null && importingFor === warehouseId;
  const [pageEpoch, setPageEpoch] = useState(0);

  function report(next: Outcome) {
    if (warehouseId !== null) setBanner({ warehouseId, outcome: next });
  }

  const columns: readonly DataTableColumn<AsnEntryDto>[] = [
    { key: 'code', header: 'ASN code', render: (asn) => <span className="font-mono text-xs">{asn.code}</span> },
    ...(showClients(clients)
      ? [
          {
            key: 'client',
            header: 'Client',
            render: (asn: AsnEntryDto) => clientCell(asn.clientId, clients ?? [], tenantName),
          } satisfies DataTableColumn<AsnEntryDto>,
        ]
      : []),
    {
      key: 'status',
      header: 'Status',
      render: (asn) => <span className="rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs">{ASN_STATUS_LABEL[asn.status]}</span>,
    },
    {
      key: 'expectedAt',
      header: 'Expected',
      render: (asn) =>
        asn.expectedAt === null ? '—' : <time dateTime={asn.expectedAt}>{new Date(asn.expectedAt).toLocaleString()}</time>,
    },
    { key: 'progress', header: 'Received', numeric: true, render: (asn) => asnProgressLabel(asn) },
    {
      key: 'detail',
      header: 'Detail',
      render: (asn) => (
        <button
          type="button"
          aria-expanded={openId === asn.id}
          aria-controls={expandedRowId(asn.id)}
          onClick={() => {
            if (warehouseId === null) return;
            setOpened(openId === asn.id ? null : { warehouseId, asnId: asn.id });
          }}
          className={buttonClass}
        >
          {openId === asn.id ? 'Hide' : 'Lines'}
        </button>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm" aria-label="Advance shipment notices">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium">Advance shipment notices</h2>
          <div className="text-(--muted-foreground)">
            {warehouseLabel === null
              ? 'Pick a warehouse to review its announced shipments.'
              : `${warehouseLabel} — newest first. A client announces a shipment; receiving books against it like a PO.`}
          </div>
        </div>
        {canManage && warehouseId !== null && !creating && (
          <div className="flex gap-2">
            {!importing && (
              <button type="button" onClick={() => setImportingFor(warehouseId)} className={buttonClass}>
                Import from file
              </button>
            )}
            <button type="button" onClick={() => setCreating(true)} className={primaryClass}>
              Announce a shipment
            </button>
          </div>
        )}
      </div>

      {canManage && warehouseId !== null && importing && (
        <AsnImport
          key={warehouseId}
          warehouseId={warehouseId}
          warehouseCode={warehouseCode}
          onClose={() => setImportingFor(null)}
          onImported={(result) => {
            if (result.acceptedCount === 0) return;
            // Back to page one, remounting the table's Prev/Next state, and
            // every inbound reader (the tab counts) refetches.
            asns.onCursor(null);
            setPageEpoch((epoch) => epoch + 1);
            notifyInboundChanged();
          }}
        />
      )}

      {canManage && warehouseId !== null && creating && (
        <AsnCreateForm
          warehouseId={warehouseId}
          clients={clients}
          skus={skus}
          kitIds={kitIds}
          tenantName={tenantName}
          onCancel={() => setCreating(false)}
          onCreated={(asn) => {
            setCreating(false);
            report({ tone: 'accepted', word: `ASN ${asn.code} announced`, reason: `${asn.lineCount} line(s), ${asn.announcedTotal} unit(s) announced.` });
            // Back to page one, remounting the table's Prev/Next state.
            asns.onCursor(null);
            setPageEpoch((epoch) => epoch + 1);
            notifyInboundChanged();
          }}
        />
      )}

      {asns.state === 'failed' ? (
        <ReadFailure word="Advance shipment notices unavailable" reason={asns.reason} onRetry={asns.reload} />
      ) : (
        <DataTable<AsnEntryDto>
          key={pageEpoch}
          columns={columns}
          rows={asns.state === 'ready' ? asns.data.items : []}
          nextCursor={asns.state === 'ready' ? asns.data.nextCursor : null}
          onCursor={asns.onCursor}
          emptyMessage={
            warehouseId === null
              ? 'Create a warehouse first.'
              : asns.state === 'loading'
                ? 'Loading…'
                : 'No shipments announced yet.'
          }
          renderExpanded={(asn) =>
            asn.id === openId ? (
              <AsnDetail key={asn.id} asnId={asn.id} skus={skus} kitIds={kitIds} canManage={canManage} onOutcome={report} />
            ) : null
          }
        />
      )}

      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </section>
  );
}

function AsnCreateForm({
  warehouseId,
  clients,
  skus,
  kitIds,
  tenantName,
  onCancel,
  onCreated,
}: {
  warehouseId: string;
  clients: readonly ClientDto[] | null;
  skus: Readonly<Record<string, SkuResponse>> | null;
  kitIds: ReadonlySet<string>;
  tenantName: string | null;
  onCancel: () => void;
  onCreated: (asn: AsnDto) => void;
}) {
  // A tenant with only its own client sees no picker: that client is the one.
  // Story 1-2a: the gate counts ALL clients (a self + one departed client
  // still shows a picker, never a forced client); only the OPTIONS drop a
  // departed client.
  const soleClient = clients !== null && !showClients(clients) ? (clients[0]?.id ?? '') : '';
  const [pickedClient, setPickedClient] = useState('');
  const clientId = soleClient !== '' ? soleClient : pickedClient;
  const [asnCode, setAsnCode] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [lines, setLines] = useState<AsnDraftLine[]>([{ skuId: '', qty: '' }]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per DRAFT: minted on the first submit, reused across retries of an
  // unchanged draft (a create that timed out after the server committed must
  // replay, never raise a second ASN), cleared on success and on any edit.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const inFlight = useRef(false);

  const options = withoutKits(skusOfClient(Object.values(skus ?? {}), clientId), kitIds);

  function edit<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      setter(value);
      setIdempotencyKey(null);
      setProblem(null);
    };
  }

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseAsnCreate({ clientId, asnCode, expectedAt, lines }, warehouseId);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { asn } = await fetchApiCreateAsn(session.tenant.id, parsed.body, key);
      setIdempotencyKey(null);
      onCreated(asn);
    } catch (error) {
      setProblem(asnReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Announce a shipment"
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-xs font-medium">Announce a shipment</div>
      <div className="flex flex-wrap gap-2">
        {soleClient === '' && (
          <select
            aria-label="Client"
            value={pickedClient}
            onChange={(event) => {
              edit(setPickedClient)(event.target.value);
              // Another client's SKUs never fit: the lines start over.
              setLines([{ skuId: '', qty: '' }]);
            }}
            className={inputClass}
          >
            <option value="">Pick the client…</option>
            {(workingClients(clients) ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {clientLabel(client, tenantName)}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          aria-label="ASN code"
          placeholder="The client's ASN reference"
          maxLength={MAX_ASN_CODE_LENGTH}
          value={asnCode}
          onChange={(event) => edit(setAsnCode)(event.target.value)}
          className={`${inputClass} min-w-40`}
        />
        <input
          type="datetime-local"
          aria-label="Expected arrival"
          value={expectedAt}
          onChange={(event) => edit(setExpectedAt)(event.target.value)}
          className={inputClass}
        />
      </div>
      {clientId === '' ? (
        <div className="text-xs text-(--muted-foreground)">Pick the client first — an ASN carries only its own client&apos;s SKUs.</div>
      ) : (
        <LineRows lines={lines} options={options} skus={skus} onChange={edit(setLines)} />
      )}
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Discard
        </button>
        <button type="submit" disabled={busy} className={primaryClass}>
          Announce
        </button>
      </div>
    </form>
  );
}

/** One ASN's lines and its actions, read fresh from the detail route. */
function AsnDetail({
  asnId,
  skus,
  kitIds,
  canManage,
  onOutcome,
}: {
  asnId: string;
  skus: Readonly<Record<string, SkuResponse>> | null;
  kitIds: ReadonlySet<string>;
  canManage: boolean;
  onOutcome: (outcome: Outcome) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<{ revision: number; asn: AsnDto } | { revision: number; failed: string } | null>(null);
  const [mode, setMode] = useState<'view' | 'amend' | 'close' | 'cancel'>('view');

  useEffect(() => {
    const session = readSession();
    if (session === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { asn } = await fetchApiGetAsn(session.tenant.id, asnId);
        if (!cancelled) setDetail({ revision, asn });
      } catch (error) {
        if (!cancelled) setDetail({ revision, failed: readReason(error, 'this ASN') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asnId, revision]);

  if (detail === null || detail.revision !== revision) return <div className="text-xs text-(--muted-foreground)">Loading…</div>;
  if ('failed' in detail) {
    return <ReadFailure word="ASN unavailable" reason={detail.failed} onRetry={() => setRevision((r) => r + 1)} />;
  }
  const asn = detail.asn;

  function changed(next: AsnDto, word: string, reason: string) {
    setMode('view');
    setDetail({ revision, asn: next });
    onOutcome({ tone: 'accepted', word, reason });
    notifyInboundChanged();
  }

  return (
    <div className="flex flex-col gap-2 py-1 text-xs">
      <div className="flex flex-col gap-0.5">
        {asn.lines.map((line) => {
          const sku = skus?.[line.skuId];
          const qty = (value: number) => quantityLabel(value, sku ?? null);
          return (
            <div key={line.id} className="flex flex-wrap gap-x-2">
              <span className="font-mono">{sku?.code ?? '(unknown SKU)'}</span>
              <span className="text-(--muted-foreground)">
                {qty(line.announcedQty)} announced · {qty(line.receivedQty)} received · {openQtyLabel({ openQty: line.openQty, receivedQty: line.receivedQty, expected: line.announcedQty }, sku)} open
              </span>
            </div>
          );
        })}
      </div>
      {asn.statusNote !== null && <div className="text-(--muted-foreground)">Note: {asn.statusNote}</div>}

      {canManage && mode === 'view' && (
        <div className="flex flex-wrap gap-2">
          {canAmendAsn(asn.status) && (
            <button type="button" onClick={() => setMode('amend')} className={buttonClass}>
              Amend
            </button>
          )}
          {canCloseAsn(asn.status) && (
            <button type="button" onClick={() => setMode('close')} className={buttonClass}>
              Close short
            </button>
          )}
          {canCancelAsn(asn.status) && (
            <button type="button" onClick={() => setMode('cancel')} className={buttonClass}>
              Cancel ASN
            </button>
          )}
        </div>
      )}

      {canManage && mode === 'amend' && (
        <AsnAmendForm
          asn={asn}
          skus={skus}
          kitIds={kitIds}
          onCancel={() => setMode('view')}
          onAmended={(next) => changed(next, `ASN ${next.code} amended`, `Now ${ASN_STATUS_LABEL[next.status].toLowerCase()}.`)}
        />
      )}
      {canManage && (mode === 'close' || mode === 'cancel') && (
        <AsnTransitionForm
          asn={asn}
          transition={mode}
          onCancel={() => setMode('view')}
          onDone={(next) =>
            changed(
              next,
              `ASN ${next.code} ${mode === 'close' ? 'closed short' : 'cancelled'}`,
              mode === 'close' ? 'It leaves the open list; nothing carries forward.' : 'Nothing was received against it.',
            )
          }
        />
      )}
    </div>
  );
}

function AsnAmendForm({
  asn,
  skus,
  kitIds,
  onCancel,
  onAmended,
}: {
  asn: AsnDto;
  skus: Readonly<Record<string, SkuResponse>> | null;
  kitIds: ReadonlySet<string>;
  onCancel: () => void;
  onAmended: (asn: AsnDto) => void;
}) {
  const [lines, setLines] = useState<AsnDraftLine[]>(() => amendDraftOf(asn));
  const [expectedAt, setExpectedAt] = useState(() => expectedAtInputValue(asn.expectedAt));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const inFlight = useRef(false);
  const received = new Set(asn.lines.filter((line) => line.receivedQty > 0).map((line) => line.id));
  // A kit already on a line (keyed before kits were refused) stays shown.
  const options = withoutKits(skusOfClient(Object.values(skus ?? {}), asn.clientId), kitIds, new Set(asn.lines.map((line) => line.skuId)));

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseAsnAmend({ expectedAt, lines }, asn.expectedAt);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { asn: next } = await fetchApiAmendAsn(session.tenant.id, asn.id, parsed.body, key);
      setIdempotencyKey(null);
      onAmended(next);
    } catch (error) {
      setProblem(asnReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={`Amend ASN ${asn.code}`}
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        type="datetime-local"
        aria-label="Expected arrival"
        value={expectedAt}
        onChange={(event) => {
          setExpectedAt(event.target.value);
          setIdempotencyKey(null);
        }}
        className={`${inputClass} w-fit`}
      />
      <LineRows
        lines={lines}
        options={options}
        skus={skus}
        lockedIds={received}
        onChange={(next) => {
          setLines(next);
          setIdempotencyKey(null);
          setProblem(null);
        }}
      />
      {problem !== null && (
        <div role="alert" className="text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Discard
        </button>
        <button type="submit" disabled={busy} className={primaryClass}>
          Save lines
        </button>
      </div>
    </form>
  );
}

function AsnTransitionForm({
  asn,
  transition,
  onCancel,
  onDone,
}: {
  asn: AsnDto;
  transition: 'close' | 'cancel';
  onCancel: () => void;
  onDone: (asn: AsnDto) => void;
}) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per CONFIRMATION: minted when this confirmation first submits, reused
  // across its retries, cleared when the note (in the hash) changes.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseAsnNote(note);
    if (parsed.note === null) {
      setProblem(parsed.problem);
      return;
    }
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { asn: next } = await fetchApiTransitionAsn(session.tenant.id, asn.id, transition, parsed.note, key);
      onDone(next);
    } catch (error) {
      setProblem(asnReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={transition === 'close' ? `Close ASN ${asn.code} short` : `Cancel ASN ${asn.code}`}
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-(--muted-foreground)">
        {transition === 'close'
          ? 'Closing ends the ASN short: it leaves the open list and the handheld, and nothing carries forward.'
          : 'Cancelling withdraws an ASN nothing was received against.'}
      </div>
      <input
        type="text"
        aria-label="Note"
        placeholder="Why?"
        maxLength={MAX_ASN_NOTE_LENGTH * 2}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          setIdempotencyKey(null);
          setProblem(null);
        }}
        className={inputClass}
      />
      {problem !== null && (
        <div role="alert" className="text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Back
        </button>
        <button type="submit" disabled={busy} className={primaryClass}>
          {transition === 'close' ? 'Close short' : 'Cancel ASN'}
        </button>
      </div>
    </form>
  );
}
