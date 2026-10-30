'use client';

import { useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiGoodsReceiptDocumentFile } from '@/lib/api/client';
import type { GoodsReceiptDocumentDto, GrnDocumentLineDto } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import { downloadBlob } from '@/lib/csv';
import {
  GRN_DOCUMENTS_OMITTED_NOTE,
  GRN_FROZEN_NOTE,
  GRN_NOT_FROZEN_NOTE,
  GRN_UNAVAILABLE,
  grnDocumentFilename,
  grnExcessLabel,
  grnExpiryLabel,
  grnPartyLines,
  grnQcLabel,
  grnQuantity,
  grnSerialsLabel,
} from '@/lib/grn-document';
import { readReason } from '@/lib/outbound-orders';
import { useGoodsReceiptDocument } from '@/lib/use-grn-document';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DetailDrawer } from '@/components/shared/detail-drawer';
import { ReadFailure, buttonClass } from '@/components/shared/surface';

/**
 * Story 2-9a (UI-PATTERNS §3.6) — the GRN details drawer (`?grn=<id>`): the
 * document as the server prints it — the three parties (frozen at receipt,
 * or the current ones with the note), the document and the gate-in arrival,
 * every line with its batch, dates, condition, over-receipt and QC outcome,
 * the damage details and the totals — with "Download GRN (PDF)" and "Export
 * lines (CSV)". Reads by id, so a deep link to a receipt on any page opens.
 * States (§5): loading, an unknown receipt inline, a failed read with Retry,
 * a refused download inline and retryable.
 */
export function GrnDetailDrawer({ grnId, onClose }: { grnId: string; onClose: () => void }) {
  const doc = useGoodsReceiptDocument(grnId);
  const title = doc.state === 'ready' ? `Goods receipt ${doc.data.code}` : 'Goods receipt';
  return (
    <DetailDrawer title={title} subtitle={doc.state === 'ready' ? doc.data.document.label : undefined} onClose={onClose} testId="grn-detail-drawer">
      {doc.state === 'loading' && <div className="text-(--muted-foreground)">Loading the receipt…</div>}
      {doc.state === 'failed' &&
        (/could not be found/.test(doc.reason) ? (
          <FeedbackBanner tone="rejected" word={GRN_UNAVAILABLE} reason="It may belong to another tenant, or the link is wrong." />
        ) : (
          <ReadFailure word="Receipt not loaded" reason={doc.reason} onRetry={doc.reload} />
        ))}
      {doc.state === 'ready' && <GrnDocumentBody doc={doc.data} />}
    </DetailDrawer>
  );
}

function GrnDocumentBody({ doc }: { doc: GoodsReceiptDocumentDto }) {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const download = async (format: 'pdf' | 'csv') => {
    if (tenantId === null) return;
    setBusy(format);
    setRefused(null);
    try {
      downloadBlob(grnDocumentFilename(doc.code, format), await fetchApiGoodsReceiptDocumentFile(tenantId, doc.id, format));
    } catch (error) {
      setRefused(error instanceof ApiProblem ? readReason(error, 'the GRN file') : 'The file could not be downloaded — check your connection and retry.');
    } finally {
      setBusy(null);
    }
  };
  const { parties, arrival } = doc;
  const affected = doc.lines.filter((line) => line.damagedQty > 0 || line.shortQty > 0 || line.photoCount > 0);
  const serials = doc.lines.flatMap((line) => {
    const label = grnSerialsLabel(line);
    return label === null ? [] : [`Line ${line.lineNo} ${line.skuCode}: ${label}`];
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void download('pdf')}>
          {busy === 'pdf' ? 'Preparing…' : 'Download GRN (PDF)'}
        </button>
        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void download('csv')}>
          {busy === 'csv' ? 'Preparing…' : 'Export lines (CSV)'}
        </button>
      </div>
      {refused !== null && <FeedbackBanner tone="rejected" word="Download failed" reason={refused} />}

      <div className="text-(--muted-foreground)">
        Received {istDateTimeLabel(doc.receivedAt)} IST · Recorded {istDateTimeLabel(doc.recordedAt)} IST
      </div>

      <section className="flex flex-col gap-2" aria-label="Parties">
        <div className="text-xs text-(--muted-foreground)">{parties.frozen ? GRN_FROZEN_NOTE : GRN_NOT_FROZEN_NOTE}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <PartyBlock
            heading="Received at"
            lines={[
              `${parties.warehouse.name} (${parties.warehouse.code})`,
              ...grnPartyLines(parties.warehouse).slice(1),
              `Operated by ${parties.warehouse.operatorName}`,
            ]}
          />
          <PartyBlock heading="Client (owner of goods)" lines={parties.client === null ? ['Client: several (older receipt)'] : grnPartyLines(parties.client)} />
          <PartyBlock heading="Supplier" lines={parties.vendor === null ? [parties.supplierNote ?? '—'] : grnPartyLines(parties.vendor)} />
        </div>
      </section>

      {arrival !== null && (
        <section className="flex flex-col gap-1" aria-label="Arrival">
          <h3 className="font-medium">Arrival — as recorded on gate-in {arrival.gateInCode}</h3>
          {(arrival.vehicleNo !== null || arrival.containerNo !== null) && (
            <div>{[arrival.vehicleNo && `Vehicle ${arrival.vehicleNo}`, arrival.containerNo && `Container ${arrival.containerNo}`].filter(Boolean).join(' · ')}</div>
          )}
          {(arrival.transporterName !== null || arrival.lrNumber !== null) && (
            <div>{[arrival.transporterName && `Transporter ${arrival.transporterName}`, arrival.lrNumber && `LR/AWB ${arrival.lrNumber}`].filter(Boolean).join(' · ')}</div>
          )}
          <div>
            Seal {arrival.sealStatus}
            {arrival.sealNumber !== null ? ` ${arrival.sealNumber}` : ''}
            {arrival.dockDoor !== null ? ` · Dock door ${arrival.dockDoor}` : ''}
          </div>
          <div className="text-(--muted-foreground)">
            Gated in {istDateTimeLabel(arrival.gatedInAt)} IST
            {arrival.unloadStartedAt !== null ? ` · Unload started ${istDateTimeLabel(arrival.unloadStartedAt)} IST` : ''}
            {arrival.unloadEndedAt !== null ? ` · Unload ended ${istDateTimeLabel(arrival.unloadEndedAt)} IST` : ''}
          </div>
          {arrival.documents.map((document, index) => (
            <div key={index} className="data">
              {document.kind} {document.number} dated {document.date}
              {document.ewayBillNo !== null ? ` · e-way bill ${document.ewayBillNo}` : ''}
            </div>
          ))}
          {arrival.documentsOmitted && <div className="text-(--muted-foreground)">{GRN_DOCUMENTS_OMITTED_NOTE}</div>}
        </section>
      )}

      <section className="flex flex-col gap-1" aria-label="Lines">
        <h3 className="font-medium">Lines</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-(--border) text-left">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">SKU</th>
                <th className="py-1 pr-2">Batch</th>
                <th className="py-1 pr-2">Expiry</th>
                <th className="py-1 pr-2 text-right">Good</th>
                <th className="py-1 pr-2 text-right">Damaged</th>
                <th className="py-1 pr-2 text-right">Short</th>
                <th className="py-1 pr-2">Over-receipt</th>
                <th className="py-1 pr-2">QC</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line) => (
                <LineRow key={line.id} line={line} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {affected.length > 0 && (
        <section className="flex flex-col gap-1" aria-label="Damage and short details">
          <h3 className="font-medium">Damage and short details</h3>
          <ul className="flex flex-col gap-0.5 text-xs">
            {affected.map((line) => (
              <li key={line.id}>
                {line.lineNo} · {line.skuCode}
                {line.damagedQty > 0 ? ` · damaged ${grnQuantity(line.damagedQty, line.uomPrecision)} ${line.uom} (${line.damageReasonLabel ?? '—'})` : ''}
                {line.shortQty > 0 ? ` · short ${grnQuantity(line.shortQty, line.uomPrecision)} ${line.uom} (${line.shortReasonLabel ?? '—'})` : ''}
                {line.photoCount > 0 ? ` · ${line.photoCount} photo(s)` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {serials.length > 0 && (
        <section className="flex flex-col gap-0.5 text-xs" aria-label="Serials">
          {serials.map((text) => (
            <div key={text}>{text}</div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-0.5" aria-label="Totals">
        <h3 className="font-medium">Totals</h3>
        <div>Lines: {doc.totals.lineCount}</div>
        {doc.totals.byUom.map((group) => (
          <div key={group.uom} className="data">
            {group.uom}: good {group.goodQty} · damaged {group.damagedQty} · short {group.shortQty}
          </div>
        ))}
      </section>
    </div>
  );
}

function PartyBlock({ heading, lines }: { heading: string; lines: readonly string[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">{heading}</div>
      {lines.map((line, index) => (
        <div key={index} className="text-xs">
          {line}
        </div>
      ))}
    </div>
  );
}

function LineRow({ line }: { line: GrnDocumentLineDto }) {
  const q = (value: number) => grnQuantity(value, line.uomPrecision);
  return (
    <tr className="border-b border-(--border) align-top">
      <td className="py-1 pr-2">{line.lineNo}</td>
      <td className="py-1 pr-2">
        <span className="font-mono">{line.skuCode}</span>
        <div className="text-(--muted-foreground)">{line.skuName}</div>
      </td>
      <td className="py-1 pr-2 font-mono">{line.batchCode ?? '—'}</td>
      <td className="py-1 pr-2">{grnExpiryLabel(line) || '—'}</td>
      <td className="data py-1 pr-2 text-right">
        {q(line.goodQty)} {line.uom}
      </td>
      <td className="data py-1 pr-2 text-right">{line.damagedQty > 0 ? q(line.damagedQty) : '—'}</td>
      <td className="data py-1 pr-2 text-right">{line.shortQty > 0 ? q(line.shortQty) : '—'}</td>
      <td className="py-1 pr-2">{grnExcessLabel(line.excess, line.uomPrecision, line.toleranceQty) || '—'}</td>
      <td className="py-1 pr-2">{grnQcLabel(line.qc, line.uomPrecision) || '—'}</td>
    </tr>
  );
}
