'use client';

import { useState, useSyncExternalStore } from 'react';

import type { ColdChainBinDto, ColdChainEventDto, ColdChainTraceResponse } from '@/lib/api/generated';
import { readActiveWarehouseId, subscribeActiveWarehouse, writeActiveWarehouseId } from '@/lib/warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { isUuid } from '@/lib/cold-chain';
import { useColdChainTrace } from '@/lib/use-cold-chain';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { useSkuMap } from '@/lib/use-inbound';

import { ReadFailure, selectClass } from '@/components/outbound/shell';

/**
 * The `/compliance` cold-chain trace viewer (story 12-6's FR-45 read,
 * activated by story 12-7) — the ledger-timeline surface: for one dispatched
 * order, every picked batch/serial scope's complete chain, each hop annotated
 * with the bin's CURRENT storage class (the 12-1 class-edit guards make that
 * annotation honest), plus the excursions whose readings fell inside a scope
 * dwell window at a chain bin.
 *
 * Reads are reconstruction from `ledger_events` alone — the viewer fabricates
 * nothing: the reference docs render verbatim, and a bin row that no longer
 * exists renders its storage class as unknown rather than a guess.
 */

export function ColdChainTrace() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Cold-chain trace</div>
        <div className="text-(--muted-foreground)">Sign in to read an order&apos;s cold chain.</div>
      </div>
    );
  }
  return <ColdChainTraceSessioned />;
}

function ColdChainTraceSessioned() {
  const { tenantId, items: warehouses } = useTenantWarehouses() ?? { tenantId: null, items: [] };
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  const warehouseId =
    activeId !== null && warehouses.some((w) => w.id === activeId)
      ? activeId
      : (warehouses[0]?.id ?? null);

  const skus = useSkuMap();
  // The loaded order is keyed by the warehouse it was loaded under: a trace
  // belongs to ONE warehouse, and switching warehouses — through this
  // surface's picker OR the shell's global one (both write the same active
  // warehouse store) — invalidates it in the SAME render (a keyed state, not
  // a reset effect, whose ordering would let the trace hook see the old
  // orderId under the new warehouse for one effect pass and fire a false
  // 404 re-request; triage row 8).
  const [loadedOrder, setLoadedOrder] = useState<{ warehouseId: string; orderId: string } | null>(null);
  const orderId = loadedOrder !== null && loadedOrder.warehouseId === warehouseId ? loadedOrder.orderId : null;
  // The pasted id and its inline shape refusal are display state about the
  // OLD warehouse's form — keyed by the warehouse they were typed under, so
  // a switch (either switcher) clears both in the same render, the same
  // keyed mechanism as the loaded order above (no setState-in-effect).
  const [draft, setDraft] = useState<{ warehouseId: string | null; value: string; problem: string | null }>({
    warehouseId: null,
    value: '',
    problem: null,
  });
  const orderInput = draft.warehouseId === warehouseId ? draft.value : '';
  const inputProblem = draft.warehouseId === warehouseId ? draft.problem : null;

  const trace = useColdChainTrace(warehouseId, orderId);

  if (tenantId === null) return null;

  function lookup(event: React.FormEvent) {
    event.preventDefault();
    // Trim + lowercase before the shape check: a copy out of some tooling
    // arrives uppercase or with stray whitespace, and every BE entity id is
    // a dashed lowercase UUIDv7 (ULIDs are Idempotency-Keys only).
    const trimmed = orderInput.trim().toLowerCase();
    if (warehouseId === null || !isUuid(trimmed)) {
      setDraft({ warehouseId, value: orderInput, problem: 'An order id is a 36-character UUID (8-4-4-4-12, hex, dashes) — check the paste.' });
      setLoadedOrder(null);
      return;
    }
    setDraft({ warehouseId, value: orderInput, problem: null });
    setLoadedOrder({ warehouseId, orderId: trimmed });
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Cold-chain trace</h2>
        <div className="text-(--muted-foreground)">
          One dispatched order&apos;s temperature story, reconstructed from the ledger: every
          picked batch or serial&apos;s complete chain, each hop with the bin&apos;s current
          storage class, and the excursions recorded while the stock dwelt there.
        </div>
      </div>

      {warehouses.length > 0 && warehouseId !== null && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">Warehouse</span>
            <select
              className={selectClass}
              value={warehouseId}
              onChange={(e) => {
                // The keyed states above reset the loaded order and the form
                // — one mechanism for both this picker and the shell's
                // switcher.
                writeActiveWarehouseId(tenantId, e.target.value);
              }}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </select>
          </label>
          <form onSubmit={lookup} className="flex flex-[2] flex-col gap-1">
            <span className="text-sm font-medium">Order id</span>
            <div className="flex gap-2">
              <input
                className="w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)"
                value={orderInput}
                onChange={(e) => setDraft({ warehouseId, value: e.target.value, problem: inputProblem })}
                placeholder="0198f7a2-1b3c-7d4e-8f90-0011223344ff"
                maxLength={36}
                spellCheck={false}
              />
              <button
                type="submit"
                className="shrink-0 rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90"
              >
                Load trace
              </button>
            </div>
            {inputProblem !== null && <div className="text-xs text-(--destructive)">{inputProblem}</div>}
          </form>
        </div>
      )}

      {warehouseId === null && (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          Create a warehouse first — traces are read per dispatched order in one.
        </div>
      )}

      {warehouseId !== null && trace.state === 'failed' && (
        <ReadFailure word="Trace unavailable" reason={trace.reason} onRetry={trace.reload} />
      )}
      {warehouseId !== null && orderId !== null && trace.state === 'loading' && (
        <div className="text-(--muted-foreground)">Loading…</div>
      )}
      {warehouseId !== null && orderId !== null && trace.state === 'ready' && (
        <TraceView trace={trace.data} skuLabel={(skuId) => skus?.[skuId]?.code ?? null} />
      )}
    </section>
  );
}

/** The trace body: order header, bins dict, per-line scope timelines. */
function TraceView({
  trace,
  skuLabel,
}: {
  trace: ColdChainTraceResponse;
  skuLabel: (skuId: string) => string | null;
}) {
  // The bins dict — id → { code, storageClass }. Every chain hop names its
  // bins through this dict; a bin missing from it (the row was deleted, or
  // the class is gone) renders unknown rather than a guess.
  const binById = new Map(trace.bins.map((bin) => [bin.id, bin]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--muted) p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs">{trace.order.id}</span>
          <span className="font-medium">{trace.order.status}</span>
          <span className="text-xs text-(--muted-foreground)">
            Dispatched <time dateTime={trace.order.dispatchedAt}>{new Date(trace.order.dispatchedAt).toLocaleString()}</time>
          </span>
        </div>
        <div className="text-xs text-(--muted-foreground)">
          Carrier: {trace.order.carrierName ?? '—'} · Tracking: {trace.order.trackingNumber ?? '—'}
        </div>
      </div>

      {trace.lines.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          This order carries no lines.
        </div>
      ) : (
        trace.lines.map((line) => (
          <article key={line.orderLineId} className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{skuLabel(line.skuId) ?? '(unknown SKU)'}</span>
              <span className="text-xs text-(--muted-foreground)">{line.dispatchedQty} dispatched</span>
            </div>

            {line.excursions.length > 0 && (
              <div className="flex flex-col gap-1 rounded-sm border border-(--destructive) p-2 text-xs">
                <div className="font-medium">Excursions during the chain</div>
                {line.excursions.map((excursion) => (
                  <div key={`${excursion.excursionId}-${excursion.binId}`} className="text-xs">
                    {excursion.readingC} °C at {binById.get(excursion.binId)?.code ?? '(unknown bin)'} ·{' '}
                    <time dateTime={excursion.occurredAt}>{new Date(excursion.occurredAt).toLocaleString()}</time>
                  </div>
                ))}
              </div>
            )}

            {line.scopes.length === 0 ? (
              <div className="text-xs text-(--muted-foreground)">No picked scopes on this line.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {line.scopes.map((scope, scopeIndex) => (
                  <div key={`${scope.batchRef ?? scope.serialRef ?? scopeIndex}`} className="flex flex-col gap-1">
                    <div className="text-xs font-medium">
                      {scope.batchRef !== null ? `Batch ${scope.batchRef}` : null}
                      {scope.serialRef !== null ? `Serial ${scope.serialRef}` : null}
                    </div>
                    <ol className="flex flex-col gap-1 border-l border-(--border) pl-3">
                      {scope.chain.map((event) => (
                        <ChainEventRow key={event.seq} event={event} binById={binById} />
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))
      )}
    </div>
  );
}

/** One chain hop: type, seq, business time, from→to with current classes. */
function ChainEventRow({
  event,
  binById,
}: {
  event: ColdChainEventDto;
  binById: Map<string, ColdChainBinDto>;
}) {
  const from = event.fromBinId === null ? null : (binById.get(event.fromBinId) ?? null);
  const to = event.toBinId === null ? null : (binById.get(event.toBinId) ?? null);
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <span className="font-mono">#{event.seq}</span>
        <span className="font-medium">{event.type}</span>
        <span className="text-(--muted-foreground)">
          <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
        </span>
      </div>
      <div className="text-xs text-(--muted-foreground)">
        {event.quantityDelta} ·{' '}
        {from === null ? '—' : `${from.code} (${from.storageClass})`}
        {' → '}
        {to === null ? '—' : `${to.code} (${to.storageClass})`}
        {event.batchRef !== null && ` · batch ${event.batchRef}`}
        {event.serialRef !== null && ` · serial ${event.serialRef}`}
      </div>
      <details className="text-xs text-(--muted-foreground)">
        <summary className="cursor-pointer">reference</summary>
        <pre className="overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(event.referenceDoc, null, 2)}
        </pre>
      </details>
    </li>
  );
}