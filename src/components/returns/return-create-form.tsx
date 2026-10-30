'use client';

import { useRef, useState } from 'react';

import { fetchApiCreateReturn } from '@/lib/api/client';
import type { ReturnableLineDto, ReturnAuthorizationDto, SkuResponse } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import { quantityInputLabel, quantityLabel } from '@/lib/format-quantity';
import {
  EMPTY_RETURN_LINE,
  MAX_RETURN_EXTERNAL_REFERENCE_LENGTH,
  MAX_RETURN_NOTE_LENGTH,
  MAX_RETURN_SERIALS_PER_LINE,
  RETURN_REASON_OPTIONS,
  filterSerials,
  groupReturnableLines,
  notifyReturnsChanged,
  parseReturnDraft,
  pruneReturnDraft,
  refreshesReturnable,
  returnReason,
  selectAllSerials,
  type ReturnDraft,
  type ReturnDraftLine,
  type AuthorizableReasonCode,
} from '@/lib/returns';
import { useReturnable } from '@/lib/use-returns';
import { ulid } from '@/lib/ulid';

import { buttonClass, inputClass, primaryClass, ReadFailure, selectClass } from '@/components/outbound/shell';

/**
 * Story 13-1 — "Create return" on a dispatched order's detail (FR-46): an
 * INLINE form, never a modal, that authorizes part of the order for return.
 * It reads the order's returnable quantities when it MOUNTS — the panel
 * renders it only once the viewer opens it, so expanding an order row never
 * fetches it. Lines are grouped parent-over-children; a kit parent reads
 * "Return the components below". A serial-tracked line lists its returnable
 * serials with a filter box and "Select all" — its quantity is the count
 * checked, capped at 500.
 *
 * The Idempotency-Key is per DRAFT (the `asn-card.tsx` shape): minted on the
 * first submit, reused across retries of an unchanged draft (a create that
 * timed out after the server committed must replay, never raise a second
 * RMA), cleared on success and on any edit. A 409 that changed what is
 * returnable (`exceeds-returnable`, a serial refusal) reloads the returnable
 * read and clears the key. Pessimistic throughout.
 */
export function ReturnCreateForm({
  orderId,
  skus,
  onCreated,
  onClose,
}: {
  orderId: string;
  skus: Readonly<Record<string, SkuResponse>> | null;
  onCreated: (rma: ReturnAuthorizationDto) => void;
  onClose: () => void;
}) {
  const returnable = useReturnable(orderId);
  const [draft, setDraft] = useState<ReturnDraft>({ externalReference: '', lines: {} });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  // A pre-render double-click fires both handlers before `disabled` renders.
  const inFlight = useRef(false);

  // The draft as the current read allows it (derived at render, never a
  // reset effect): after a 409 reload, refused serials and lines with nothing
  // left drop out instead of being resent forever.
  const readyLines = returnable.state === 'ready' ? returnable.data.lines : null;
  const current = readyLines === null ? draft : pruneReturnDraft(draft, readyLines);

  function editLine(orderLineId: string, change: Partial<ReturnDraftLine>) {
    setDraft((stored) => {
      const base = readyLines === null ? stored : pruneReturnDraft(stored, readyLines);
      return {
        ...base,
        lines: { ...base.lines, [orderLineId]: { ...(base.lines[orderLineId] ?? EMPTY_RETURN_LINE), ...change } },
      };
    });
    setIdempotencyKey(null);
    setProblem(null);
  }

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current || returnable.state !== 'ready') return;
    const parsed = parseReturnDraft(orderId, current, returnable.data.lines);
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
      const rma = await fetchApiCreateReturn(session.tenant.id, parsed.body, key);
      setIdempotencyKey(null);
      notifyReturnsChanged();
      onCreated(rma);
    } catch (error) {
      setProblem(returnReason(error));
      if (refreshesReturnable(error)) {
        // What is returnable moved under the draft: re-read it, and the next
        // submit is a new intent with a new key.
        setIdempotencyKey(null);
        returnable.reload();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (returnable.state === 'loading') {
    return <div className="text-xs text-(--muted-foreground)">Loading returnable quantities…</div>;
  }
  if (returnable.state === 'failed') {
    return <ReadFailure word="Returnable quantities unavailable" reason={returnable.reason} onRetry={returnable.reload} />;
  }

  const read = returnable.data;
  const groups = groupReturnableLines(read.lines);

  return (
    <form
      aria-label="Create return"
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-xs font-medium">Create return</div>
      <div className="text-xs text-(--muted-foreground)">
        Name the units coming back and why. Nothing moves in stock until they are received.
      </div>
      <ul className="flex flex-col gap-2">
        {groups.map(({ line, children }) => (
          <li key={line.orderLineId} className="flex flex-col gap-1">
            <ReturnLineRow line={line} sku={skus?.[line.skuId]} entry={current.lines[line.orderLineId]} onEdit={editLine} />
            {children.length > 0 && (
              <ul className="flex flex-col gap-1 border-l border-(--border) pl-3">
                {children.map((child) => (
                  <li key={child.orderLineId}>
                    <ReturnLineRow line={child} sku={skus?.[child.skuId]} entry={current.lines[child.orderLineId]} onEdit={editLine} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-(--muted-foreground)">External reference (optional)</span>
        <input
          type="text"
          aria-label="External reference"
          placeholder="The channel's or customer's RMA number"
          maxLength={MAX_RETURN_EXTERNAL_REFERENCE_LENGTH}
          value={current.externalReference}
          onChange={(event) => {
            const externalReference = event.target.value;
            setDraft((current) => ({ ...current, externalReference }));
            setIdempotencyKey(null);
            setProblem(null);
          }}
          className={`${inputClass} max-w-sm py-1`}
        />
      </label>
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryClass}>
          {busy ? 'Creating…' : 'Create return'}
        </button>
        <button type="button" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>
    </form>
  );
}

function ReturnLineRow({
  line,
  sku,
  entry = EMPTY_RETURN_LINE,
  onEdit,
}: {
  line: ReturnableLineDto;
  sku: SkuResponse | undefined;
  entry?: ReturnDraftLine;
  onEdit: (orderLineId: string, change: Partial<ReturnDraftLine>) => void;
}) {
  const [filter, setFilter] = useState('');
  const uom = sku === undefined ? null : { uom: sku.uom, uomPrecision: sku.uomPrecision };
  const code = sku?.code ?? line.skuId;
  const header = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono">{code}</span>
      {!line.kitParent && (
        <span className="data text-(--muted-foreground)">
          {quantityLabel(line.dispatchedQty, uom)} dispatched · {quantityLabel(line.authorizedQty, uom)} already on returns ·{' '}
          {quantityLabel(line.returnableQty, uom)} returnable
        </span>
      )}
    </div>
  );

  if (line.kitParent) {
    return (
      <div className="flex flex-col gap-1">
        {header}
        <div className="text-xs text-(--muted-foreground)">Return the components below</div>
      </div>
    );
  }
  if (line.returnableQty === 0) {
    return (
      <div className="flex flex-col gap-1">
        {header}
        <div className="text-xs text-(--muted-foreground)">Nothing left to return on this line.</div>
      </div>
    );
  }

  const shown = line.serialTracked ? filterSerials(line.returnableSerials, filter) : [];
  return (
    <div className="flex flex-col gap-1">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        {line.serialTracked ? (
          <span className="data text-xs" aria-label={`Quantity for ${code}`}>
            {entry.serials.length} selected
          </span>
        ) : (
          <input
            type="number"
            aria-label={`Quantity for ${code}`}
            min={0}
            // No `max`: the returnable bound is the server's to refuse — the
            // figure on screen may be stale (IMPLEMENTATION-GUIDE §7).
            // The SKU's declared precision; the server refuses a finer value
            // naming the unit — nothing is rounded here.
            step={sku === undefined ? 'any' : sku.uomPrecision === 0 ? 1 : 10 ** -sku.uomPrecision}
            title={sku === undefined ? undefined : quantityInputLabel(sku.uomPrecision)}
            value={entry.qty}
            onChange={(event) => onEdit(line.orderLineId, { qty: event.target.value })}
            className={`${inputClass} w-28 py-1`}
          />
        )}
        <select
          aria-label={`Reason for ${code}`}
          value={entry.reasonCode}
          onChange={(event) => onEdit(line.orderLineId, { reasonCode: event.target.value as AuthorizableReasonCode | '' })}
          className={`${selectClass} w-auto py-1`}
        >
          <option value="">Reason…</option>
          {RETURN_REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label={`Note for ${code}`}
          placeholder={entry.reasonCode === 'other' ? 'Say why (required)' : 'Note (optional)'}
          maxLength={MAX_RETURN_NOTE_LENGTH}
          value={entry.reasonNote}
          onChange={(event) => onEdit(line.orderLineId, { reasonNote: event.target.value })}
          className={`${inputClass} min-w-40 flex-1 py-1`}
        />
      </div>
      {line.serialTracked && (
        <div className="flex flex-col gap-1 rounded-sm border border-(--border) p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              aria-label={`Filter serials for ${code}`}
              placeholder="Filter serials"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className={`${inputClass} w-48 py-1`}
            />
            <button
              type="button"
              onClick={() => onEdit(line.orderLineId, { serials: selectAllSerials(entry.serials, shown) })}
              className={`${buttonClass} py-1 text-xs`}
            >
              Select all
            </button>
            <span className="text-xs text-(--muted-foreground)">At most {MAX_RETURN_SERIALS_PER_LINE} per line.</span>
          </div>
          <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {shown.map((serial) => {
              const checked = entry.serials.includes(serial.serialNumber);
              return (
                <li key={serial.id}>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && entry.serials.length >= MAX_RETURN_SERIALS_PER_LINE}
                      onChange={() =>
                        onEdit(line.orderLineId, {
                          serials: checked
                            ? entry.serials.filter((number) => number !== serial.serialNumber)
                            : [...entry.serials, serial.serialNumber],
                        })
                      }
                    />
                    <span className="font-mono">{serial.serialNumber}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
