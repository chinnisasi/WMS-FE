'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiCartonLabels, fetchApiPackingSlip } from '@/lib/api/client';
import type { PackViewDto, RecartonResponse, SkuResponse } from '@/lib/api/generated';
import {
  cartonLine,
  cartonReason,
  cartonSummary,
  grossOverShipmentBound,
  OVER_SHIPMENT_WEIGHT_NOTE,
  PACK_PRINT_CHOICES,
  packPrintRequest,
  rememberedPrintChoice,
  rememberPrintChoice,
  type PackPrintChoice,
} from '@/lib/cartons';
import { downloadBlob } from '@/lib/csv';
import { useOrderCartons } from '@/lib/use-outbound-pack-dispatch';

import { FeedbackBanner } from '@/components/feedback/banner';
import { RecartonOutcome, RepackIntoCartons } from '@/components/outbound/carton-editor';
import { primaryClass, ReadFailure, rowButtonClass, selectClass } from '@/components/outbound/shell';

/** Which print choices a viewer may ask for (A14: labels are `labels.execute` and a `ready_to_dispatch` order). */
export function availablePrintChoices(canLabel: boolean, status: string): readonly PackPrintChoice[] {
  const labelsAllowed = canLabel && status === 'ready_to_dispatch';
  return PACK_PRINT_CHOICES.map((c) => c.choice).filter((choice) => labelsAllowed || !choice.startsWith('labels-'));
}

/**
 * Story 4-5a (A26) — the Print group: Carton labels (ZPL, the D7 default),
 * PDF 4×6, PDF on A4, Packing slip (A4 PDF), Carton slips (ZPL). The choice
 * is remembered per browser (best-effort). Downloads are the 2-10b blob
 * pattern; a refusal is worded by `code`.
 */
export function PrintPackDocuments({
  tenantId,
  orderId,
  orderLabel,
  canLabel,
  status,
}: {
  tenantId: string;
  orderId: string;
  orderLabel: string;
  canLabel: boolean;
  status: string;
}) {
  const choices = availablePrintChoices(canLabel, status);
  const [choice, setChoice] = useState<PackPrintChoice>(() => rememberedPrintChoice());
  const effective = choices.includes(choice) ? choice : choices[0]!;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function print() {
    if (busy) return;
    const request = packPrintRequest(effective, orderLabel);
    setBusy(true);
    setDone(null);
    setProblem(null);
    try {
      const query = { format: request.format, layout: request.layout };
      const blob =
        request.route === 'carton-labels'
          ? await fetchApiCartonLabels(tenantId, orderId, query)
          : await fetchApiPackingSlip(tenantId, orderId, query);
      downloadBlob(request.filename, blob);
      rememberPrintChoice(effective);
      if (mounted.current) setDone(`${request.filename} downloaded`);
    } catch (error) {
      if (mounted.current) {
        const action = request.route === 'carton-labels' ? 'carton-labels' : request.format === 'zpl' ? 'carton-slips' : 'packing-slip';
        setProblem(cartonReason(error, action));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1" data-testid="print-pack-documents">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-(--muted-foreground)">Print</span>
          <select
            className={`${selectClass} w-auto py-1`}
            value={effective}
            disabled={busy}
            onChange={(e) => {
              setChoice(e.target.value as PackPrintChoice);
              setDone(null);
              setProblem(null);
            }}
          >
            {PACK_PRINT_CHOICES.filter((c) => choices.includes(c.choice)).map((c) => (
              <option key={c.choice} value={c.choice}>
                {c.word}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={primaryClass} disabled={busy} onClick={() => void print()}>
          {busy ? 'Preparing…' : 'Download'}
        </button>
      </div>
      {done !== null && <FeedbackBanner tone="accepted" word="Downloaded" reason={done} />}
      {problem !== null && <FeedbackBanner tone="rejected" word="Not printed" reason={problem} />}
    </div>
  );
}

/** The live pack's cartons, staff copy: number, weight, size and code (A26). */
export function CartonList({ pack }: { pack: PackViewDto }) {
  return (
    <ul className="flex flex-col gap-1" data-testid="carton-list">
      {pack.cartons.map((carton) => (
        <li key={carton.seq} className="flex flex-wrap items-center gap-2 text-xs">
          <span>{cartonLine(carton.seq, pack.cartonCount, carton.weightGrams, carton.dimensionsMm)}</span>
          <span className="font-mono text-(--muted-foreground)">{carton.code}</span>
          <span className="text-(--muted-foreground)">
            {carton.totals.map((t) => `${t.qty} ${t.uom}`).join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Story 4-5a (A26) — a packed order's cartons: the summary, the carton list,
 * the Print group and (for `pack.execute`, while the order is packed and no
 * carrier holds its label) Re-pack into cartons.
 */
export function PackCartonsPanel({
  tenantId,
  orderId,
  orderLabel,
  status,
  canPack,
  canLabel,
  carrierLabelled,
  skuMap,
}: {
  tenantId: string;
  orderId: string;
  orderLabel: string;
  status: string;
  canPack: boolean;
  canLabel: boolean;
  /** A live 4.6c carrier label: the carrier counts the pieces, so no re-pack (409 `shipment-labelled-by-carrier`). */
  carrierLabelled: boolean;
  skuMap: Readonly<Record<string, SkuResponse>> | null;
}) {
  const cartons = useOrderCartons(tenantId, orderId);
  const [repacking, setRepacking] = useState(false);
  const [outcome, setOutcome] = useState<RecartonResponse | null>(null);
  if (cartons.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading cartons…</div>;
  if (cartons.state === 'failed') return <ReadFailure word="Cartons unavailable" reason={cartons.reason} onRetry={cartons.reload} />;
  if (cartons.data === null) return null;
  const { pack } = cartons.data;
  const canRepack = canPack && status === 'ready_to_dispatch' && !carrierLabelled;
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) p-3" data-testid="pack-cartons">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">Cartons</span>
        <span data-testid="carton-summary">{cartonSummary(pack.cartonCount, pack.grossWeightGrams)}</span>
        {pack.packSeq > 1 && <span className="text-(--muted-foreground)">Pack {pack.packSeq}</span>}
        {pack.status !== 'live' && <span className="text-(--muted-foreground)">({pack.status})</span>}
      </div>
      {pack.legacy && (
        <div className="text-xs text-(--muted-foreground)">Packed before cartons were recorded — one carton, and the documents print the current party details.</div>
      )}
      {grossOverShipmentBound(pack.grossWeightGrams) && <div className="text-xs text-(--muted-foreground)">{OVER_SHIPMENT_WEIGHT_NOTE}</div>}
      {outcome !== null && <RecartonOutcome outcome={outcome} />}
      <CartonList pack={pack} />
      {(status === 'ready_to_dispatch' || status === 'dispatched') && (
        <PrintPackDocuments tenantId={tenantId} orderId={orderId} orderLabel={orderLabel} canLabel={canLabel} status={status} />
      )}
      {canRepack &&
        (repacking ? (
          <RepackIntoCartons
            tenantId={tenantId}
            orderId={orderId}
            pack={pack}
            skuMap={skuMap}
            onClose={() => setRepacking(false)}
            onDone={(response) => {
              setOutcome(response);
              setRepacking(false);
            }}
          />
        ) : (
          <div>
            <button
              type="button"
              className={rowButtonClass}
              onClick={() => {
                setOutcome(null);
                setRepacking(true);
              }}
              data-testid="open-recarton"
            >
              Re-pack into cartons
            </button>
          </div>
        ))}
      {canPack && status === 'ready_to_dispatch' && carrierLabelled && (
        <div className="text-xs text-(--muted-foreground)">The carrier’s label counts the pieces — cancel it to re-pack.</div>
      )}
    </div>
  );
}
