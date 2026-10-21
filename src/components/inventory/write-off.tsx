'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';

import { fetchApiAdjustStock, fetchApiListBatches } from '@/lib/api/client';
import type { BatchListItemDto, SkuResponse, StockEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { formatQuantity } from '@/lib/format-quantity';
import { readReason } from '@/lib/outbound-orders';
import type { ResourceState } from '@/lib/resource-state';
import { ulid } from '@/lib/ulid';
import {
  ADJUSTMENT_PENDINGS_HREF,
  WRITE_OFF_NOTE_MAX,
  parseWriteOff,
  writeOffBatches,
  writeOffOutcome,
  writeOffReason,
  type WriteOffDraft,
} from '@/lib/write-off';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, ReadFailure } from '@/components/shared/surface';

/** What a finished write-off tells the Stock section (its banner, and whether to re-read). */
export interface WriteOffResult {
  readonly tone: 'accepted' | 'warning';
  readonly word: string;
  readonly reason: string;
  /** A pend links to the approval queue. */
  readonly pending: boolean;
}

/**
 * Story 2-4a — the damaged write-off, opened under a DAMAGED stock row:
 * quantity, a required note, and — on a batch-tracked SKU — the batch (one
 * write-off per batch; an expired batch is listed too, since the write-off
 * names its batch with an override reason rather than drawing FEFO). One
 * Idempotency-Key per submission: reused on a retry of the same draft,
 * renewed when the draft changes and after success. A 202 is "Pending
 * approval" (the tenant's threshold) with a link to the queue.
 */
export function WriteOffPanel({
  warehouseId,
  row,
  sku,
  onDone,
  onClose,
}: {
  warehouseId: string;
  row: StockEntryDto;
  sku: SkuResponse;
  onDone: (result: WriteOffResult) => void;
  onClose: () => void;
}) {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [draft, setDraft] = useState<WriteOffDraft>({ quantity: '', note: '', batchCode: null });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per submission: kept across a retry of the SAME draft, dropped on
  // any edit (another payload under the key would be a 422) and on success.
  const keyRef = useRef<string | null>(null);
  const batches = useDamagedBatches(sku.batchTracked ? tenantId : null, warehouseId, sku.id, row.binId);

  const edit = (patch: Partial<WriteOffDraft>) => {
    keyRef.current = null;
    setProblem(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const chosenBatch =
    batches.state === 'ready' && draft.batchCode !== null ? (batches.data.find((batch) => batch.code === draft.batchCode) ?? null) : null;
  const available = sku.batchTracked ? (chosenBatch?.quantity ?? 0) : row.quantity;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (tenantId === null || busy) return;
    const parsed = parseWriteOff({ warehouseId, binId: row.binId, sku, draft, available });
    if (parsed.kind === 'refused') {
      setProblem(parsed.problem);
      return;
    }
    keyRef.current ??= ulid();
    setBusy(true);
    try {
      const answer = await fetchApiAdjustStock(tenantId, parsed.body, keyRef.current);
      keyRef.current = null;
      const qty = -parsed.body.quantityDelta;
      const outcome = writeOffOutcome(answer.kind, qty, sku);
      onDone({ tone: answer.kind === 'applied' ? 'accepted' : 'warning', ...outcome, pending: answer.kind === 'pending' });
    } catch (error) {
      setProblem(writeOffReason(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-2 text-xs" onSubmit={submit} aria-label={`Write off ${sku.code} from DAMAGED`} data-testid="write-off">
      <div className="font-medium">
        Write off damaged {sku.code} — {formatQuantity(row.quantity, sku.uomPrecision)} {sku.uom} in DAMAGED
      </div>
      {sku.batchTracked &&
        (batches.state === 'loading' ? (
          <div className="text-(--muted-foreground)">Loading the batches…</div>
        ) : batches.state === 'failed' ? (
          <ReadFailure word="Batches unavailable" reason={batches.reason} onRetry={batches.reload} />
        ) : batches.data.length === 0 ? (
          <div className="text-(--muted-foreground)">No batch holds stock in DAMAGED any more — refresh the stock.</div>
        ) : (
          <label className="flex flex-col gap-1">
            <span>Batch</span>
            <select
              className={inputClass}
              value={draft.batchCode ?? ''}
              onChange={(e) => edit({ batchCode: e.target.value === '' ? null : e.target.value })}
            >
              <option value="">Choose the batch…</option>
              {batches.data.map((batch) => (
                <option key={batch.id} value={batch.code}>
                  {batch.code} · {formatQuantity(batch.quantity, sku.uomPrecision)} {sku.uom}
                  {batch.expiryDate === null ? '' : ` · exp ${batch.expiryDate.slice(0, 10)}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      <label className="flex flex-col gap-1">
        <span>Quantity to write off ({sku.uom})</span>
        <input
          className={`${inputClass} w-40`}
          inputMode="decimal"
          value={draft.quantity}
          onChange={(e) => edit({ quantity: e.target.value })}
          aria-label="Quantity to write off"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>Note (required)</span>
        <textarea
          className={inputClass}
          rows={2}
          maxLength={WRITE_OFF_NOTE_MAX}
          value={draft.note}
          onChange={(e) => edit({ note: e.target.value })}
          aria-label="Write-off note"
          placeholder="What happened to the damaged units — scrapped, destroyed, claimed from the vendor…"
        />
      </label>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not written off" reason={problem} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass} disabled={busy || tenantId === null}>
          {busy ? 'Writing off…' : 'Write off'}
        </button>
        <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The Stock section's banner for a finished write-off — a pend links to the approval queue. */
export function WriteOffBanner({ result }: { result: WriteOffResult }) {
  return (
    <FeedbackBanner
      tone={result.tone}
      word={result.word}
      reason={result.reason}
      action={
        result.pending ? (
          <Link href={ADJUSTMENT_PENDINGS_HREF} className="text-xs text-(--primary) underline underline-offset-2">
            Open the approval queue
          </Link>
        ) : undefined
      }
    />
  );
}

/** The SKU's batches holding stock in the DAMAGED bin (a one-shot read per panel). */
function useDamagedBatches(
  tenantId: string | null,
  warehouseId: string,
  skuId: string,
  binId: string,
): ResourceState<readonly BatchListItemDto[]> & { reload: () => void } {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<readonly BatchListItemDto[]> } | null>(null);
  const key = `${tenantId ?? ''}|${warehouseId}|${skuId}|${binId}|${revision}`;
  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetchApiListBatches(tenantId, warehouseId, skuId, { binId });
        if (!cancelled) setResult({ key, state: { state: 'ready', data: writeOffBatches(items) } });
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: readReason(error, 'the batches') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, skuId, binId, key]);
  const reload = () => setRevision((r) => r + 1);
  return { ...(result === null || result.key !== key ? ({ state: 'loading' } as const) : result.state), reload };
}
