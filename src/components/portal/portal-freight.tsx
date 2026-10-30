'use client';

import type { PortalFreightBlockDto } from '@/lib/api/generated';
import { PORTAL_FREIGHT_TERMS_LABEL, portalDate, portalFreightLine, portalFreightPackages } from '@/lib/portal';
import { usePortalFreightNoteDownload } from '@/lib/use-portal';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass } from '@/components/shared/surface';
import { StatusChip, type StatusTone } from '@/components/shared/status-chip';

const TONE: Readonly<Record<PortalFreightBlockDto['status'], StatusTone>> = {
  planned: 'info',
  dispatched: 'success',
  delivered: 'success',
  'delivered-with-exceptions': 'warning',
  refused: 'warning',
};

/**
 * Story 4-9a (A31) — the portal order's Truck block, inside Shipping: the
 * status line in the client's words, the packages line, the transporter's
 * facts the client may see (from the frozen carriage snapshot — never the
 * load, another brand's consignment, the driver's phone or licence) and
 * **Download freight note**. While planned it says only "Booked on a truck".
 */
export function PortalFreight({ orderId, orderLabel, freight }: { orderId: string; orderLabel: string; freight: PortalFreightBlockDto }) {
  const note = usePortalFreightNoteDownload(orderId, orderLabel);
  const packages = portalFreightPackages(freight);
  const facts = [
    freight.consignmentRef === undefined ? null : `Consignment ${freight.consignmentRef}`,
    freight.lrDate == null ? null : `LR date ${portalDate(freight.lrDate)}`,
    freight.freightTerms == null ? null : `Freight ${PORTAL_FREIGHT_TERMS_LABEL[freight.freightTerms] ?? freight.freightTerms}`,
    freight.containerNumber == null ? null : `container ${freight.containerNumber}`,
    freight.driverName === undefined ? null : `driver ${freight.driverName}`,
    freight.seals == null || freight.seals.length === 0 ? null : `seal${freight.seals.length === 1 ? '' : 's'} ${freight.seals.join(', ')}`,
  ].filter((part): part is string => part !== null);
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-(--border) p-2" data-testid="portal-freight">
      <span className="text-xs font-medium">Truck</span>
      <span>
        <StatusChip tone={TONE[freight.status]}>{portalFreightLine(freight)}</StatusChip>
      </span>
      {packages !== null && <span className="data">{packages}</span>}
      {facts.length > 0 && <span className="text-(--muted-foreground)">{facts.join(' · ')}</span>}
      {freight.noteAvailable === true && (
        <div>
          <button type="button" className={buttonClass} disabled={note.busy} onClick={() => void note.download()} data-testid="portal-freight-note">
            {note.busy ? 'Preparing…' : 'Download freight note (PDF)'}
          </button>
        </div>
      )}
      {note.refused !== null && <FeedbackBanner tone="rejected" word="Not downloaded" reason={note.refused} />}
    </div>
  );
}
