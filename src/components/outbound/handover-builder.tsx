'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiCreateHandover } from '@/lib/api/client';
import type { HandoverCandidateDto, HandoverResponse } from '@/lib/api/generated';
import { notifyOutboundChanged } from '@/lib/outbound';
import {
  awbTail,
  bindHandoverKey,
  candidateBlocker,
  cartonTally,
  defaultPackageCountText,
  emptyHandoverDraft,
  EMPTY_ROW,
  handoverCartonConfirms,
  handoverRefusals,
  matchCartonScan,
  matchScan,
  normalizeAwb,
  MAX_HANDOVER_CANDIDATES,
  MAX_HANDOVER_PARCELS,
  mismatchedOrderIds,
  parseHandoverDraft,
  pruneStaleCartonCodes,
  rowOf,
  rupees,
  SHIPMENT_KIND_WORD,
  shippingReason,
  staleCartonsDroppedNote,
  tickCarton,
  type HandoverDraft,
  type HandoverRowDraft,
  type RefusedParcel,
} from '@/lib/shipping';
import { useClients } from '@/lib/use-clients';
import { useTransporterOptions } from '@/lib/use-gate-ins';
import { useHandoverCandidates } from '@/lib/use-shipping';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, labelClass, primaryClass, ReadFailure, selectClass } from '@/components/outbound/shell';
import { DetailDrawer } from '@/components/shared/detail-drawer';

/**
 * Story 4-4a (A20, A49) — the courier handover builder, a non-modal drawer:
 * one courier, one client, one pickup. The client select reads that client's
 * packed orders awaiting a courier — the whole chain (≤ 500) before any scan,
 * so a scan never misses a later page. A scan field takes an AWB on record or
 * a parcel tag; a tag on a row with no AWB asks for the courier's AWB next.
 * Per-row parcels and weight (blank = the shipment's count / the packed
 * weight). Confirm dispatches every ticked order (A12, all-or-nothing on the
 * web): a `handover-parcels-refused` answer marks each refused row with its
 * reason and keeps the draft. One key per draft, bound to its body.
 *
 * Story 4-5a (A21, A26, A37, A44) — a carton label scan ticks that carton of
 * its order ("2/3"); a superseded pack's label is refused (reprint). The
 * parcels field defaults to the order's carton count, and confirming with
 * fewer cartons scanned than counted, or a COD order's carton 1 unscanned,
 * asks first.
 */
/** The wall clock, read in the confirm handler (never during render). */
const clockNow = (): number => Date.now();

export function HandoverBuilder({
  tenantId,
  warehouseId,
  initialClientId,
  initialOrderId,
  requestedOrderIds = [],
  onClose,
  onCreated,
}: {
  tenantId: string;
  warehouseId: string;
  initialClientId: string | null;
  /** "Hand over" on a row opens the builder with that order ticked. */
  initialOrderId: string | null;
  /** FE14 — orders asked for by "Hand over" on further rows while the builder is open: ticked unless the draft says otherwise. */
  requestedOrderIds?: readonly string[];
  onClose: () => void;
  onCreated: (response: HandoverResponse) => void;
}) {
  const clients = useClients();
  const transporters = useTransporterOptions();
  const [ownDraft, setDraft] = useState<HandoverDraft>(() => {
    const base = emptyHandoverDraft(initialClientId ?? '');
    return initialOrderId === null ? base : { ...base, rows: { [initialOrderId]: { ...EMPTY_ROW, selected: true } } };
  });
  const candidates = useHandoverCandidates(warehouseId, ownDraft.clientId === '' ? null : ownDraft.clientId);
  const items: readonly HandoverCandidateDto[] = candidates.state === 'ready' ? candidates.data.items : [];
  // A37 — a refresh that shows an order re-packed drops its stale carton scans
  // (derived at render against the current list, never a reset effect — guide §1.5).
  const pruned = pruneStaleCartonCodes(ownDraft, items);
  const staleNote = staleCartonsDroppedNote(pruned.dropped);
  // FE14 — a requested order joins the draft ticked (derived at render, never a reset effect — guide §1.5).
  const draft: HandoverDraft = {
    ...pruned.draft,
    rows: {
      ...Object.fromEntries(requestedOrderIds.filter((id) => !(id in pruned.draft.rows)).map((id) => [id, { ...EMPTY_ROW, selected: true }])),
      ...pruned.draft.rows,
    },
  };
  const truncated = candidates.state === 'ready' && candidates.data.truncated;
  const [scan, setScan] = useState('');
  const [scanNote, setScanNote] = useState<{ tone: 'accepted' | 'warning' | 'rejected'; text: string } | null>(null);
  const [awaitingRaw, setAwaitingAwbFor] = useState<string | null>(null);
  // FE13 — a row that left the list (a reload) no longer awaits its AWB.
  const awaitingAwbFor = awaitingRaw !== null && items.some((c) => c.orderId === awaitingRaw) ? awaitingRaw : null;
  const [ambiguous, setAmbiguous] = useState<readonly string[] | null>(null);
  // A carton scan that matched two rows: its code waits for the row the user picks.
  const [pendingCarton, setPendingCarton] = useState<string | null>(null);
  const [bound, setBound] = useState<{ key: string; body: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState<ReadonlyMap<string, RefusedParcel>>(new Map());
  const [foreign, setForeign] = useState<readonly string[]>([]);
  // A44 / A24's web twin — the confirms asked before submit; acknowledged for exactly this body.
  const [confirms, setConfirms] = useState<{ readonly body: string; readonly lines: readonly string[] } | null>(null);
  const inFlight = useRef(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function edit(patch: Partial<Omit<HandoverDraft, 'rows'>>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function editRow(orderId: string, patch: Partial<HandoverRowDraft>) {
    // Writes go over the pruned rows, so a stale carton scan never comes back.
    setDraft((current) => {
      const base = pruneStaleCartonCodes(current, items).draft;
      return { ...base, rows: { ...base.rows, [orderId]: { ...(base.rows[orderId] ?? rowOf(draft, orderId)), ...patch } } };
    });
    setRefused((current) => {
      if (!current.has(orderId)) return current;
      const next = new Map(current);
      next.delete(orderId);
      return next;
    });
    // FE15 — editing or unticking a row clears its other-client alert too.
    setForeign((current) => (current.includes(orderId) ? current.filter((id) => id !== orderId) : current));
  }

  function pickClient(clientId: string) {
    // Another client is another list: the ticks and scans of the old one do not carry over.
    setDraft((current) => ({ ...current, clientId, rows: {} }));
    setAwaitingAwbFor(null);
    setAmbiguous(null);
    setPendingCarton(null);
    setScanNote(null);
    setRefused(new Map());
    setForeign([]);
  }

  const labelOf = (orderId: string) => items.find((c) => c.orderId === orderId)?.orderLabel ?? orderId.slice(-8);

  function onScan(event: React.FormEvent) {
    event.preventDefault();
    setConfirms(null);
    // A21 — a carton label first (only while no AWB is awaited: an awaited AWB is the courier's label).
    const carton = awaitingAwbFor === null ? matchCartonScan(scan, items) : null;
    if (carton !== null) {
      setScan('');
      setAmbiguous(null);
      setPendingCarton(null);
      if (carton.kind === 'unknown') {
        setScanNote({ tone: 'warning', text: carton.problem });
      } else if (carton.kind === 'ambiguous') {
        setAmbiguous(carton.orderIds);
        setPendingCarton(carton.code);
        setScanNote({ tone: 'warning', text: 'This carton matches two parcels — tick the right one below.' });
      } else {
        const candidate = items.find((c) => c.orderId === carton.orderId);
        tickScannedCarton(carton.orderId, carton.code, carton.needsAwb, candidate);
      }
      scanRef.current?.focus();
      return;
    }
    const result = matchScan(scan, items, awaitingAwbFor);
    setScan('');
    setAmbiguous(null);
    setPendingCarton(null);
    if (result.kind === 'unknown') {
      // FE12 — with a truncated list the parcel may be past the oldest 500.
      setScanNote({
        tone: 'warning',
        text: truncated && awaitingAwbFor === null ? `Not in the oldest ${MAX_HANDOVER_CANDIDATES} listed — hand these over first, then refresh.` : result.problem,
      });
    } else if (result.kind === 'ambiguous') {
      setAmbiguous(result.orderIds);
      setScanNote({ tone: 'warning', text: 'This code matches two parcels — tick the right one below.' });
    } else if (result.kind === 'awb-for') {
      editRow(result.orderId, { selected: true, awb: result.awb });
      setAwaitingAwbFor(null);
      setScanNote({ tone: 'accepted', text: `${labelOf(result.orderId)} — AWB ${result.awb} recorded.` });
    } else {
      // An AWB scanned off the parcel is sent with it: it verifies a client label at handover (A12, `handover-scan`).
      editRow(result.orderId, result.by === 'awb' ? { selected: true, awb: normalizeAwb(scan) } : { selected: true });
      if (result.needsAwb && rowOf(draft, result.orderId).awb === '') {
        setAwaitingAwbFor(result.orderId);
        setScanNote({ tone: 'warning', text: `${labelOf(result.orderId)} ticked — now scan the courier’s AWB on this parcel.` });
      } else {
        setAwaitingAwbFor(null);
        setScanNote({ tone: 'accepted', text: `${labelOf(result.orderId)} ticked.` });
      }
    }
    scanRef.current?.focus();
  }

  /** Tick a scanned carton on its row; a row still needing the courier's AWB asks for it next. */
  function tickScannedCarton(orderId: string, code: string, needsAwb: boolean, candidate: HandoverCandidateDto | undefined) {
    const before = rowOf(draft, orderId);
    const ticked = tickCarton({ ...draft, rows: { ...draft.rows, [orderId]: before } }, orderId, code);
    editRow(orderId, { selected: true, cartonCodes: ticked.rows[orderId]?.cartonCodes ?? [] });
    const tally = candidate === undefined ? null : cartonTally(ticked.rows[orderId]!, candidate);
    const seq = code.split('.').pop();
    const lead = `${labelOf(orderId)} — carton ${seq}${tally === null ? '' : ` (${tally})`}`;
    if (needsAwb && before.awb === '') {
      setAwaitingAwbFor(orderId);
      setScanNote({ tone: 'warning', text: `${lead} ticked — now scan the courier’s AWB on this parcel.` });
    } else {
      setAwaitingAwbFor(null);
      setScanNote({ tone: 'accepted', text: `${lead} ticked.` });
    }
  }

  /** The row picked after an ambiguous carton scan receives that carton. */
  function onTick(candidate: HandoverCandidateDto, checked: boolean) {
    if (checked && pendingCarton !== null && ambiguous?.includes(candidate.orderId)) {
      const needsAwb =
        candidate.shipment === null || candidate.shipment.kind === 'courier-label' || (candidate.shipment.kind === 'client-label' && !candidate.shipment.labelVerified);
      setAmbiguous(null);
      setPendingCarton(null);
      tickScannedCarton(candidate.orderId, pendingCarton, needsAwb, candidate);
      return;
    }
    editRow(candidate.orderId, { selected: checked });
  }

  async function onConfirm(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseHandoverDraft(draft, warehouseId, items, clockNow());
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    // A44 / A24 — warn, never refuse: ask once for exactly this body.
    const asks = handoverCartonConfirms(draft, items);
    const bodyText = JSON.stringify(parsed.body);
    if (asks.length > 0 && confirms?.body !== bodyText) {
      setConfirms({ body: bodyText, lines: asks });
      setProblem(null);
      return;
    }
    const next = bindHandoverKey(bound, parsed.body, ulid);
    setBound(next);
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      const response = await fetchApiCreateHandover(tenantId, parsed.body, next.key);
      notifyOutboundChanged();
      if (!mounted.current) return;
      setBound(null);
      setConfirms(null);
      onCreated(response);
    } catch (caught) {
      if (!mounted.current) return;
      setRefused(handoverRefusals(caught));
      setForeign(mismatchedOrderIds(caught));
      setProblem(shippingReason(caught, 'handover'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  const selectedCount = items.filter((c) => rowOf(draft, c.orderId).selected).length;
  const clientOptions = clients.state === 'ready' ? clients.data.filter((c) => c.status !== 'departed') : [];

  return (
    <DetailDrawer title="Hand over to a courier" subtitle="One courier, one client, one pickup — confirming dispatches every ticked order." onClose={onClose} closeDisabled={pending} testId="handover-builder">
      <form onSubmit={onConfirm} className="flex flex-col gap-3 text-xs">
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className="sr-only">Pickup</legend>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Client</span>
            {clients.state === 'failed' ? (
              <ReadFailure word="Clients unavailable" reason={clients.reason} onRetry={clients.reload} />
            ) : (
              <select className={selectClass} value={draft.clientId} onChange={(e) => pickClient(e.target.value)} data-testid="handover-client">
                <option value="">Choose the client…</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.code} — {client.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Transporter</span>
              <select className={selectClass} value={draft.transporterId} onChange={(e) => edit({ transporterId: e.target.value })}>
                <option value="">Type the courier’s name instead</option>
                {transporters.state === 'ready' &&
                  transporters.data.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.code} — {partner.name}
                    </option>
                  ))}
              </select>
            </label>
            {draft.transporterId === '' && (
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelClass}>Courier</span>
                <input className={inputClass} value={draft.courierName} onChange={(e) => edit({ courierName: e.target.value })} placeholder="Delhivery" data-testid="handover-courier" />
              </label>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Pickup person</span>
              <input className={inputClass} value={draft.pickupPersonName} onChange={(e) => edit({ pickupPersonName: e.target.value })} data-testid="handover-person" />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Phone (optional)</span>
              <input className={inputClass} inputMode="tel" value={draft.pickupPersonPhone} onChange={(e) => edit({ pickupPersonPhone: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Vehicle (optional)</span>
              <input className={inputClass} value={draft.vehicleNumber} onChange={(e) => edit({ vehicleNumber: e.target.value })} placeholder="KA01AB1234" />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Picked up at (IST; blank = now)</span>
              <input className={inputClass} type="datetime-local" value={draft.pickedUpAt} onChange={(e) => edit({ pickedUpAt: e.target.value })} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Note (optional)</span>
            <input className={inputClass} value={draft.note} maxLength={500} onChange={(e) => edit({ note: e.target.value })} />
          </label>
        </fieldset>

        {draft.clientId === '' ? (
          <div className="text-(--muted-foreground)">Choose the client to list its packed parcels.</div>
        ) : candidates.state === 'loading' ? (
          <div className="text-(--muted-foreground)">Loading the parcels awaiting pickup…</div>
        ) : candidates.state === 'failed' ? (
          <ReadFailure word="Parcels unavailable" reason={candidates.reason} onRetry={candidates.reload} />
        ) : items.length === 0 ? (
          <div className="text-(--muted-foreground)" data-testid="handover-empty">
            No packed parcels of this client are waiting in this warehouse.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* FB14 — re-read the list (a parcel packed since it opened). */}
            <div>
              <button type="button" className={buttonClass} onClick={candidates.reload} data-testid="handover-refresh">
                Refresh the list
              </button>
            </div>
            {candidates.data.truncated && (
              <FeedbackBanner
                tone="warning"
                word={`Showing the oldest ${MAX_HANDOVER_CANDIDATES} parcels`}
                reason="Hand these over first; the newer ones list after a refresh."
              />
            )}
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>{awaitingAwbFor === null ? 'Scan an AWB, a parcel tag or a carton label' : `Scan the courier’s AWB for ${labelOf(awaitingAwbFor)}`}</span>
                <input
                  ref={scanRef}
                  className={inputClass}
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onScan(e);
                  }}
                  autoComplete="off"
                  data-testid="handover-scan"
                />
              </label>
              {staleNote !== null && (
                <div role="status" className="text-(--warning)" data-testid="handover-stale-cartons">
                  {staleNote}
                </div>
              )}
              {scanNote !== null && (
                <div role="status" className={scanNote.tone === 'accepted' ? 'text-(--accent)' : 'text-(--warning)'} data-testid="handover-scan-note">
                  {scanNote.text}
                </div>
              )}
            </div>
            <ul className="flex flex-col gap-1" data-testid="handover-candidates">
              {items.map((candidate) => {
                const row = rowOf(draft, candidate.orderId);
                const blocker = candidateBlocker(candidate, row);
                const refusal = refused.get(candidate.orderId);
                const isForeign = foreign.includes(candidate.orderId);
                const tally = cartonTally(row, candidate);
                const cartonsDefault = defaultPackageCountText(candidate);
                // A33 — a stored pack with no weight to default (over 1,000 kg, or never weighed).
                const noWeightDefault = candidate.packSeq !== undefined && candidate.defaultWeightGrams === null;
                return (
                  <li
                    key={candidate.orderId}
                    className={`flex flex-col gap-1 rounded-sm border p-2 ${ambiguous?.includes(candidate.orderId) ? 'border-(--warning)' : 'border-(--border)'}`}
                    data-testid="handover-row"
                    data-order-id={candidate.orderId}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => onTick(candidate, e.target.checked)}
                        aria-label={`Hand over ${candidate.orderLabel}`}
                      />
                      <span className="font-mono">{candidate.orderLabel}</span>
                      <span className="text-(--muted-foreground)">
                        {candidate.shipment === null
                          ? 'No courier record'
                          : `${SHIPMENT_KIND_WORD[candidate.shipment.kind]} · ${candidate.shipment.courierName} · AWB ${awbTail(candidate.shipment.awb)}`}
                        {candidate.destinationCity === null ? '' : ` · ${candidate.destinationCity}`}
                        {candidate.codAmountPaise === null ? ' · Prepaid' : ` · COD ${rupees(candidate.codAmountPaise)}`}
                      </span>
                      {tally !== null && (
                        <span className="font-mono" data-testid="handover-carton-tally">
                          Cartons {tally}
                        </span>
                      )}
                    </div>
                    {row.selected && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <label className="flex flex-1 flex-col gap-1">
                          <span className={labelClass}>AWB scanned</span>
                          <input className={inputClass} value={row.awb} onChange={(e) => editRow(candidate.orderId, { awb: e.target.value })} placeholder={candidate.shipment?.awb ?? 'Scan the courier’s label'} />
                        </label>
                        <label className="flex flex-col gap-1 sm:w-20">
                          <span className={labelClass}>Parcels</span>
                          <input className={inputClass} inputMode="numeric" value={row.packageCount} onChange={(e) => editRow(candidate.orderId, { packageCount: e.target.value })} placeholder={cartonsDefault !== '' ? cartonsDefault : String(candidate.shipment?.packageCount ?? 1)} />
                        </label>
                        <label className="flex flex-col gap-1 sm:w-28">
                          <span className={labelClass}>Weight (g)</span>
                          <input className={inputClass} inputMode="numeric" value={row.weightGrams} onChange={(e) => editRow(candidate.orderId, { weightGrams: e.target.value })} placeholder={candidate.defaultWeightGrams === null || candidate.defaultWeightGrams === undefined ? 'as packed' : String(candidate.defaultWeightGrams)} />
                        </label>
                      </div>
                    )}
                    {row.selected && noWeightDefault && row.weightGrams.trim() === '' && (
                      <div className="text-(--muted-foreground)" data-testid="handover-row-weight-note">
                        No packed weight to default. Over 1,000 kg — record the freight weight on the LR (4-9a); otherwise type it.
                      </div>
                    )}
                    {row.selected && blocker !== null && refusal === undefined && (
                      <div className="text-(--warning)" data-testid="handover-row-blocker">
                        ⚠ {blocker}
                      </div>
                    )}
                    {refusal !== undefined && (
                      <div role="alert" className="text-(--destructive)" data-testid="handover-row-refused">
                        ✕ {refusal.word}
                        {refusal.detail === null ? '' : ` — ${refusal.detail}`}
                      </div>
                    )}
                    {isForeign && (
                      <div role="alert" className="text-(--destructive)">
                        ✕ This parcel belongs to another client — hand it over separately.
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending || selectedCount === 0} className={primaryClass} data-testid="handover-confirm">
            {pending ? 'Handing over…' : `Hand over ${selectedCount} ${selectedCount === 1 ? 'parcel' : 'parcels'}`}
          </button>
          <button type="button" disabled={pending} className={buttonClass} onClick={onClose}>
            Discard
          </button>
          <span className="text-(--muted-foreground)">
            Dispatch is terminal. At most {MAX_HANDOVER_PARCELS} parcels per handover.
          </span>
        </div>
        {confirms !== null && (
          <div role="alert" className="flex flex-col gap-1 rounded-sm border border-(--warning) p-2 text-(--warning)" data-testid="handover-carton-confirms">
            <span className="font-medium">Check the cartons — confirm again to hand over anyway</span>
            {confirms.lines.map((line) => (
              <span key={line}>⚠ {line}</span>
            ))}
          </div>
        )}
        {problem !== null && <FeedbackBanner tone="rejected" word="Not handed over" reason={problem} />}
      </form>
    </DetailDrawer>
  );
}

