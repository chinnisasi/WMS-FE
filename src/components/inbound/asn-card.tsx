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
  ASN_HANDHELD_NOTICE,
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
  type AsnDraftLine,
} from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { clientCell, clientLabel, showClients, skusOfClient } from '@/lib/clients';
import { quantityLabel } from '@/lib/format-quantity';
import { readReason } from '@/lib/outbound-orders';
import { openQtyLabel } from '@/lib/over-receipt';
import { useAsns } from '@/lib/use-asns';
import { readyClients, useClients } from '@/lib/use-clients';
import { useSkuMap } from '@/lib/use-inbound';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure } from '@/components/outbound/shell';

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
 * Until story 21-6b ships the handheld flow, an ASN is received only through
 * the device API — the card says so (`ASN_HANDHELD_NOTICE`).
 */

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

const buttonClass = 'rounded-sm border border-(--border) px-2 py-0.5 text-xs hover:bg-(--muted) disabled:opacity-60';
const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';
const inputClass = 'rounded-sm border border-(--border) bg-(--background) px-2 py-1 text-xs';

export function AsnsCard({
  warehouseId,
  warehouseLabel,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
}) {
  const asns = useAsns(warehouseId);
  const skus = useSkuMap();
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
          <div className="text-xs text-(--muted-foreground)">{ASN_HANDHELD_NOTICE}</div>
        </div>
        {canManage && warehouseId !== null && !creating && (
          <button type="button" onClick={() => setCreating(true)} className={primaryClass}>
            Announce a shipment
          </button>
        )}
      </div>

      {canManage && warehouseId !== null && creating && (
        <AsnCreateForm
          warehouseId={warehouseId}
          clients={clients}
          skus={skus}
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
              <AsnDetail key={asn.id} asnId={asn.id} skus={skus} canManage={canManage} onOutcome={report} />
            ) : null
          }
        />
      )}

      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </section>
  );
}

/** Draft line rows: SKU picker (the client's SKUs only) + quantity, add/remove. */
function LineRows({
  lines,
  options,
  skus,
  onChange,
  lockedIds,
}: {
  lines: readonly AsnDraftLine[];
  options: readonly SkuResponse[];
  skus: Readonly<Record<string, SkuResponse>> | null;
  onChange: (next: AsnDraftLine[]) => void;
  /** Lines that have received stock: their SKU is fixed (the server refuses a change). */
  lockedIds?: ReadonlySet<string>;
}) {
  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, index) => {
        const locked = line.id !== undefined && (lockedIds?.has(line.id) ?? false);
        const sku = skus?.[line.skuId];
        return (
          <div key={line.id ?? `new-${index}`} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Line ${index + 1} SKU`}
              value={line.skuId}
              disabled={locked}
              onChange={(event) => onChange(lines.map((l, i) => (i === index ? { ...l, skuId: event.target.value } : l)))}
              className={inputClass}
            >
              <option value="">Pick a SKU…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} — {option.name}
                </option>
              ))}
              {/* A row's current SKU stays listed even when the options exclude it. */}
              {line.skuId !== '' && !options.some((option) => option.id === line.skuId) && (
                <option value={line.skuId}>{sku?.code ?? line.skuId}</option>
              )}
            </select>
            <input
              type="number"
              aria-label={`Line ${index + 1} quantity`}
              min={0}
              step={sku === undefined || sku.uomPrecision === 0 ? 1 : 10 ** -sku.uomPrecision}
              value={line.qty}
              onChange={(event) => onChange(lines.map((l, i) => (i === index ? { ...l, qty: event.target.value } : l)))}
              className={`${inputClass} w-28`}
            />
            {sku !== undefined && <span className="text-xs text-(--muted-foreground)">{sku.uom}</span>}
            {!locked && lines.length > 1 && (
              <button type="button" onClick={() => onChange(lines.filter((_, i) => i !== index))} className={buttonClass}>
                Remove
              </button>
            )}
          </div>
        );
      })}
      <div>
        <button type="button" onClick={() => onChange([...lines, { skuId: '', qty: '' }])} className={buttonClass}>
          Add line
        </button>
      </div>
    </div>
  );
}

function AsnCreateForm({
  warehouseId,
  clients,
  skus,
  tenantName,
  onCancel,
  onCreated,
}: {
  warehouseId: string;
  clients: readonly ClientDto[] | null;
  skus: Readonly<Record<string, SkuResponse>> | null;
  tenantName: string | null;
  onCancel: () => void;
  onCreated: (asn: AsnDto) => void;
}) {
  // A tenant with only its own client sees no picker: that client is the one.
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

  const options = skusOfClient(Object.values(skus ?? {}), clientId);

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
            {(clients ?? []).map((client) => (
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
  canManage,
  onOutcome,
}: {
  asnId: string;
  skus: Readonly<Record<string, SkuResponse>> | null;
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
                {qty(line.announcedQty)} announced · {qty(line.receivedQty)} received · {openQtyLabel(line.openQty, sku)} open
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
  onCancel,
  onAmended,
}: {
  asn: AsnDto;
  skus: Readonly<Record<string, SkuResponse>> | null;
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
  const options = skusOfClient(Object.values(skus ?? {}), asn.clientId);

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
