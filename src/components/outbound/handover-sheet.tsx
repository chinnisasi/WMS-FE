'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiUploadHandoverSheet } from '@/lib/api/client';
import type { HandoverDetailDto } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { notifyOutboundChanged } from '@/lib/outbound';
import {
  codTotalLabel,
  DOCUMENT_ACCEPT,
  MAX_SHEET_PAGES,
  prepareShippingFile,
  rupees,
  sheetParty,
  shippingReason,
  weightLabel,
  type SheetParty,
} from '@/lib/shipping';
import { useHandoverDetail } from '@/lib/use-shipping';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { FileList } from '@/components/outbound/shipping-panel';
import { buttonClass, labelClass, ReadFailure } from '@/components/outbound/shell';

/**
 * Story 4-4a (A20) — one handover's detail: the printable handover sheet
 * (`data-print-root`, A4) built ONLY from the handover's frozen parties (AC6)
 * and its parcels, with signature lines for the courier and the warehouse,
 * then — outside the print root — the signed sheet's pages and their upload
 * (image or PDF, ≤ 10 pages, `dispatch.execute`).
 */
export function HandoverDetail({
  tenantId,
  handoverId,
  canDispatch,
  canRemove,
}: {
  tenantId: string;
  handoverId: string;
  canDispatch: boolean;
  canRemove: boolean;
}) {
  const detail = useHandoverDetail(handoverId);
  if (detail.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading handover…</div>;
  if (detail.state === 'failed') return <ReadFailure word="Handover unavailable" reason={detail.reason} onRetry={detail.reload} />;
  const handover = detail.data;
  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="handover-detail">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" className={buttonClass} onClick={() => window.print()} data-testid="print-handover-sheet">
          Print handover sheet
        </button>
        <span className="text-(--muted-foreground)">A4 — the courier signs it; then upload the signed copy below.</span>
      </div>
      <HandoverSheet handover={handover} />
      <div className="flex flex-col gap-2 print:hidden">
        <div className="font-medium">Signed sheet</div>
        {handover.sheet.length === 0 ? (
          <div className="text-(--warning)">Not uploaded yet.</div>
        ) : (
          <FileList files={handover.sheet} tenantId={tenantId} canRemove={canRemove} onExpired={detail.refresh} />
        )}
        {canDispatch && handover.sheet.length < MAX_SHEET_PAGES && <SheetUpload tenantId={tenantId} handoverId={handoverId} />}
      </div>
    </div>
  );
}

function PartyBlock({ heading, party }: { heading: string; party: SheetParty }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-(--border) p-2" aria-label={heading}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-(--muted-foreground)">{heading}</span>
      <span className="text-sm font-medium">{party.name}</span>
      {party.lines.map((line, i) => (
        <span key={`${i}-${line}`}>{line}</span>
      ))}
      {party.facts.map((fact) => (
        <span key={fact.label}>
          {fact.label}: <span className="font-mono">{fact.value}</span>
        </span>
      ))}
    </div>
  );
}

/** The printable sheet — hook-free, from the detail alone. The pickup phone is never printed (A45). */
export function HandoverSheet({ handover }: { handover: HandoverDetailDto }) {
  const totalWeight = handover.parcels.reduce<number | null>((sum, p) => (p.weightGrams === null || sum === null ? null : sum + p.weightGrams), 0);
  return (
    <article data-print-root aria-label={`Handover sheet ${handover.code}`} className="flex flex-col gap-3 rounded-md border border-(--border) bg-(--background) p-4 text-(--foreground)">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-base font-semibold">Courier handover sheet</h3>
          <span className="font-mono text-sm" data-testid="sheet-code">
            {handover.code}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span>Picked up {istDateTimeLabel(handover.handedOverAt)} IST</span>
          <span className="text-(--muted-foreground)">{handover.source === 'handheld' ? 'Recorded on the handheld' : 'Recorded on the web'}</span>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <PartyBlock heading="Warehouse" party={sheetParty(handover.warehouseSnapshot, 'Warehouse')} />
        <PartyBlock heading="Client" party={sheetParty(handover.clientSnapshot, 'Client')} />
        <PartyBlock heading="Courier" party={sheetParty(handover.courierSnapshot, handover.courierName)} />
      </div>
      <div className="flex flex-wrap gap-4">
        <span>
          Pickup person: <span className="font-medium" data-testid="sheet-pickup">{handover.pickupPersonName}</span>
        </span>
        {handover.vehicleNumber !== null && (
          <span>
            Vehicle: <span className="font-mono">{handover.vehicleNumber}</span>
          </span>
        )}
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-(--border) text-left">
            <th className="py-1 pr-2 font-medium">Order</th>
            <th className="py-1 pr-2 font-medium">AWB / LR</th>
            <th className="py-1 pr-2 font-medium">City</th>
            <th className="data py-1 pr-2 text-right font-medium">Parcels</th>
            <th className="data py-1 pr-2 text-right font-medium">Weight</th>
            <th className="data py-1 text-right font-medium">COD</th>
          </tr>
        </thead>
        <tbody>
          {handover.parcels.map((parcel) => (
            <tr key={parcel.shipmentId} className="border-b border-(--border)" data-testid="sheet-parcel">
              <td className="py-1 pr-2 font-mono">{parcel.orderLabel}</td>
              <td className="py-1 pr-2 font-mono">{parcel.awb}</td>
              <td className="py-1 pr-2">{parcel.destinationCity ?? '—'}</td>
              {/* FB18 — the server's own per-parcel count (the total below is the server's too). */}
              <td className="data py-1 pr-2 text-right">{parcel.packageCount ?? '—'}</td>
              <td className="data py-1 pr-2 text-right">{weightLabel(parcel.weightGrams)}</td>
              <td className="data py-1 text-right">{parcel.codAmountPaise === null ? 'Prepaid' : rupees(parcel.codAmountPaise)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td className="py-1 pr-2" colSpan={3}>
              {handover.shipmentCount} {handover.shipmentCount === 1 ? 'order' : 'orders'}
            </td>
            <td className="data py-1 pr-2 text-right">{handover.packageCount}</td>
            <td className="data py-1 pr-2 text-right">{weightLabel(totalWeight)}</td>
            <td className="data py-1 text-right" data-testid="sheet-cod">
              {codTotalLabel(handover.codShipmentCount, handover.codTotalPaise)}
            </td>
          </tr>
        </tfoot>
      </table>
      {handover.note !== null && <div>Note: {handover.note}</div>}
      <p className="font-medium">Received the above parcels in good order.</p>
      <div className="grid gap-6 pt-6 sm:grid-cols-2">
        {['For the courier', 'For the warehouse'].map((who) => (
          <div key={who} className="flex flex-col gap-4">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-(--muted-foreground)">{who}</span>
            <span className="border-b border-(--foreground) pb-4">Signature</span>
            <span className="border-b border-(--foreground) pb-4">Name</span>
            <span className="border-b border-(--foreground) pb-4">Date</span>
          </div>
        ))}
      </div>
    </article>
  );
}

/** One signed-sheet page (image or PDF); the key belongs to the prepared file. */
function SheetUpload({ tenantId, handoverId }: { tenantId: string; handoverId: string }) {
  const [prepared, setPrepared] = useState<{ file: File; key: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // FE9 — only the newest pick may land.
  const pickSeq = useRef(0);

  async function onPick(picked: File | null) {
    const mine = ++pickSeq.current;
    setProblem(null);
    setOutcome(null);
    if (picked === null) {
      setPrepared(null);
      return;
    }
    const result = await prepareShippingFile(picked);
    if (!mounted.current || mine !== pickSeq.current) return;
    if (!result.ok) {
      setPrepared(null);
      setProblem(result.problem);
      return;
    }
    setPrepared({ file: result.file, key: ulid() });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (prepared === null) {
      setProblem('Choose the photo or scan of the signed sheet.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      await fetchApiUploadHandoverSheet(tenantId, handoverId, prepared.file, prepared.key);
      notifyOutboundChanged();
      if (!mounted.current) return;
      setOutcome('Sheet page attached — opted-in client contacts are emailed it.');
      setPrepared(null);
      if (inputRef.current !== null) inputRef.current.value = '';
    } catch (caught) {
      if (mounted.current) setProblem(shippingReason(caught, 'sheet'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" data-testid="sheet-upload">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Signed sheet page (photo or PDF, ≤ 10 MB)</span>
          <input ref={inputRef} type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => void onPick(e.target.files?.[0] ?? null)} data-testid="sheet-file" />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Uploading…' : 'Upload signed sheet'}
        </button>
      </div>
      {outcome !== null && <FeedbackBanner tone="accepted" word="Attached" reason={outcome} />}
      {problem !== null && <FeedbackBanner tone="rejected" word="Not attached" reason={problem} />}
    </form>
  );
}
