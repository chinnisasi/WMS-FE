'use client';

import { useState, useSyncExternalStore } from 'react';

import { fetchApiPortalRecallReport } from '@/lib/api/client';
import type { PortalRecallDetailResponse, PortalRecallListEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { portalDate, portalInstantIst } from '@/lib/portal';
import { MOCK_RECALL_NOTE, recallQuantity } from '@/lib/recalls';
import { usePortalRecall, usePortalRecalls, usePortalTenantId } from '@/lib/use-portal';

import { DataTable, TableSkeleton, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { EmptyState } from '@/components/shared/empty-state';
import { RecallChips, RecallFiguresTable, RecallOnHandTable } from '@/components/shared/recall-figures';
import { RecallReportButtons } from '@/components/shared/recall-report-buttons';
import { SkeletonBar } from '@/components/shared/skeleton';
import { ReadFailure, Section, rowButtonClass } from '@/components/shared/surface';

/**
 * Story 3-7a (decision 11, A11) — the portal's Recalls: this company's
 * batch recalls, newest first, each opening to the reason and the brand
 * reference, every lot with its figures (live, and as frozen at close), on
 * hand per warehouse and location (never a bin), the company's own open
 * orders holding a recalled lot, and the report download. The response is
 * the server's allowlist — no bin, no warehouse operator, no other client.
 * A recall shows here the moment it opens. Read only.
 */
export function PortalRecalls() {
  const recalls = usePortalRecalls();
  const tenantId = usePortalTenantId();
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: readonly DataTableColumn<PortalRecallListEntryDto>[] = [
    {
      key: 'code',
      header: 'Recall',
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-mono">{row.code}</span>
          {row.externalRef !== null && <span className="text-xs text-(--muted-foreground)">Your ref {row.externalRef}</span>}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <RecallChips status={row.status} mode={row.mode} /> },
    { key: 'lots', header: 'Lots', numeric: true, render: (row) => row.lotCount.toLocaleString('en-IN') },
    { key: 'opened', header: 'Opened', render: (row) => portalDate(row.openedAt) },
    { key: 'closed', header: 'Closed', render: (row) => (row.closedAt === null ? '—' : portalDate(row.closedAt)) },
    {
      key: 'toggle',
      header: '',
      render: (row) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openId === row.id}
          aria-controls={expandedRowId(row.id)}
          aria-label={`${openId === row.id ? 'Hide' : 'Show'} recall ${row.code}`}
          onClick={() => setOpenId(openId === row.id ? null : row.id)}
        >
          {openId === row.id ? 'Hide' : 'Details'}
        </button>
      ),
    },
  ];
  return (
    <Section title="Recalls">
      <div className="max-w-3xl text-(--muted-foreground)">
        Lots of your goods under recall at the warehouse. A live recall stops the lot everywhere at once — it is not sold, picked or shipped while the recall is
        open. Each recall shows where the units are, which of your open orders hold them, and the full report to download.
      </div>
      {recalls.state === 'loading' && <TableSkeleton columns={columns} label="Loading your recalls…" />}
      {recalls.state === 'failed' && <ReadFailure word="Recalls not loaded" reason={recalls.reason} onRetry={recalls.reload} />}
      {recalls.state === 'ready' && (
        <DataTable<PortalRecallListEntryDto>
          key={tenantId ?? 'none'}
          columns={columns}
          rows={recalls.data.items}
          nextCursor={recalls.data.nextCursor}
          onCursor={recalls.onCursor}
          rowNoun={{ one: 'recall', many: 'recalls' }}
          emptyMessage={<EmptyState kind="cleared">No recalls for your company.</EmptyState>}
          renderExpanded={(row) => (row.id === openId ? <PortalRecallDetail recallId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

function PortalRecallDetail({ recallId }: { readonly recallId: string }) {
  const recall = usePortalRecall(recallId);
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  if (recall.state === 'loading') {
    return (
      <div className="flex flex-col gap-2 py-1" role="status" aria-label="Loading the recall">
        <SkeletonBar className="h-4 w-64" />
        <SkeletonBar className="h-24 w-full" />
      </div>
    );
  }
  if (recall.state === 'failed') return <ReadFailure word="Recall not loaded" reason={recall.reason} onRetry={recall.reload} />;
  const data: PortalRecallDetailResponse = recall.data;
  const uomOf = (batchCode: string) => data.lots.find((lot) => lot.batchCode === batchCode)?.uom ?? 'units';
  return (
    <div className="flex flex-col gap-4 py-2" data-testid="portal-recall-detail">
      {data.mode === 'mock' && <FeedbackBanner tone="warning" word="Mock recall" reason={MOCK_RECALL_NOTE} />}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex flex-col">
          <dt className="text-xs text-(--muted-foreground)">Reason</dt>
          <dd>{data.reasonNote}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-(--muted-foreground)">Opened</dt>
          <dd>{portalInstantIst(data.openedAt)}</dd>
        </div>
        {data.closedAt !== null && (
          <div className="flex flex-col">
            <dt className="text-xs text-(--muted-foreground)">Closed</dt>
            <dd>
              {portalInstantIst(data.closedAt)}
              {data.closeNote !== null && <span className="text-(--muted-foreground)"> · {data.closeNote}</span>}
            </dd>
          </div>
        )}
      </dl>
      {tenantId !== null && <RecallReportButtons code={data.code} mode={data.mode} fetchReport={(format) => fetchApiPortalRecallReport(tenantId, data.id, format)} />}

      <section className="flex flex-col gap-3" aria-label="Lots">
        <h3 className="text-sm font-medium">Lots</h3>
        {data.lots.map((lot) => (
          <div key={lot.batchId} className="flex flex-col gap-1">
            <div className="text-sm">
              <span className="font-mono">{lot.batchCode}</span> · <span className="font-mono">{lot.skuCode}</span> {lot.skuName}
              {lot.expiryDate !== null && <span className="text-(--muted-foreground)"> · expires {portalDate(lot.expiryDate)}</span>}
            </div>
            <RecallFiguresTable figures={lot.figures} closeFigures={lot.closeFigures} uom={lot.uom} caption={`Figures of ${lot.batchCode}`} />
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2" aria-label="Where it is">
        <h3 className="text-sm font-medium">Where it is</h3>
        <RecallOnHandTable rows={data.onHandByWarehouse} uomOf={uomOf} />
      </section>

      <section className="flex flex-col gap-2" aria-label="Your open orders holding it">
        <h3 className="text-sm font-medium">Your open orders holding it</h3>
        {data.heldOrders.length === 0 ? (
          <p className="text-sm text-(--muted-foreground)">None of your open orders holds a recalled lot.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="portal-recall-held">
            {data.heldOrders.map((row, index) => (
              <li key={index}>
                <span className="font-mono">{row.clientOrderRef ?? row.orderLabel}</span> · lot <span className="font-mono">{row.batchCode}</span> ·{' '}
                <span className="data">{recallQuantity(row.quantity, uomOf(row.batchCode))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
