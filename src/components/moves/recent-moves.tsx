'use client';

import { clientFilterKey } from '@/lib/active-client';
import { quantityLabel } from '@/lib/format-quantity';
import { ledgerRecordedLabel } from '@/lib/ledger';
import { groupMoves, moveBatchLabel, moveReasonCell, type RecentMove } from '@/lib/moves';
import type { ActiveClientState } from '@/lib/use-active-client';
import { useBinCodeMap, useSkuMap, useUserMap } from '@/lib/use-inbound';
import { useBatchCodes, useRecentMoves } from '@/lib/use-moves';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { ReadFailure } from '@/components/shared/surface';

/**
 * Story 3-1 — the warehouse's recent moves: its `stock.moved` ledger events,
 * newest first, grouped by move (a serial move's events are one row), with
 * the ledger table's IST clock and its SKU, bin and user lookups. Follows the
 * client switcher (the chip, the filter and its epoch in the table key). A
 * move made on this page reloads it back to page one.
 */
export function RecentMoves({ warehouseId, active }: { warehouseId: string; active: ActiveClientState }) {
  const moves = useRecentMoves(warehouseId, active.filter);
  const skus = useSkuMap();
  const bins = useBinCodeMap(warehouseId);
  const users = useUserMap();
  const events = moves.state === 'ready' ? moves.data.items : [];
  const rows = groupMoves(events).map((move) => ({ ...move, id: move.moveId }));
  const batchCodes = useBatchCodes(
    warehouseId,
    rows.filter((move) => move.batchRefs.length > 0).map((move) => move.skuId),
  );
  const binCode = (id: string | null) => (id === null ? '—' : (bins?.[id] ?? id.slice(-8)));

  const columns: readonly DataTableColumn<RecentMove & { id: string }>[] = [
    {
      key: 'recordedAt',
      header: 'Recorded (IST)',
      render: (move) => <time dateTime={move.recordedAt}>{ledgerRecordedLabel(move.recordedAt)}</time>,
    },
    {
      key: 'sku',
      header: 'SKU',
      render: (move) => <span className="font-mono text-xs">{skus?.[move.skuId]?.code ?? move.skuId.slice(-8)}</span>,
    },
    {
      key: 'quantity',
      header: 'Quantity',
      numeric: true,
      render: (move) => quantityLabel(move.quantity, skus?.[move.skuId] ?? null),
    },
    {
      key: 'bins',
      header: 'From → to',
      render: (move) => <span className="font-mono text-xs">{`${binCode(move.fromBinId)} → ${binCode(move.toBinId)}`}</span>,
    },
    {
      key: 'batch',
      header: 'Batch / serials',
      render: (move) => <span className="font-mono text-xs">{moveBatchLabel(move, (id) => batchCodes?.[id] ?? null)}</span>,
    },
    { key: 'reason', header: 'Reason', render: (move) => <span className="text-xs">{moveReasonCell(move)}</span> },
    {
      key: 'actor',
      header: 'By',
      render: (move) => <span className="text-xs">{users?.[move.actorUserId]?.email ?? move.actorUserId.slice(-8)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      {moves.state === 'failed' ? (
        <ReadFailure word="Recent moves unavailable" reason={moves.reason} onRetry={moves.reload} />
      ) : (
        <DataTable<RecentMove & { id: string }>
          key={`${clientFilterKey(active.filter)}#${moves.epoch}`}
          columns={columns}
          rows={rows}
          nextCursor={moves.state === 'ready' ? moves.data.nextCursor : null}
          onCursor={moves.onCursor}
          emptyMessage="No moves in this warehouse yet."
          // Story UI-2 (C14) — a cold load is a skeleton, never an empty-row sentence.
          loading={moves.state === 'loading' ? 'Loading the recent moves…' : undefined}
        />
      )}
    </div>
  );
}
