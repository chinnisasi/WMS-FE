'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiRecartonOrder } from '@/lib/api/client';
import type { PackViewDto, RecartonResponse, SkuResponse } from '@/lib/api/generated';
import {
  addCarton,
  assignCase,
  bindRecartonKey,
  buildRecartonBody,
  cartonIsEmpty,
  cartonReason,
  cartonSummary,
  gridFromLivePack,
  MAX_CARTONS,
  MAX_RECARTON_REASON_LENGTH,
  removeCarton,
  rowTotals,
  setCartonMeasure,
  setCartonQty,
  type CartonGrid,
  type CartonMeasure,
  type CartonSku,
} from '@/lib/cartons';
import { notifyOutboundChanged } from '@/lib/outbound';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, labelClass, primaryClass, rowButtonClass } from '@/components/outbound/shell';

/**
 * Story 4-5a (A26) — the carton grid: one row per SKU, one column per carton,
 * each row's total against what was packed (word first, red when it differs),
 * a weight (kg) and three sides (cm) per carton, Add carton and Remove (an
 * empty carton only). Pure presentation over `lib/cartons.ts`; the caller owns
 * the grid state and its validation.
 *
 * At pack a catch-weight SKU is read-only (its cases are split on the
 * handheld, A50 item 10); at re-carton each case gets a carton select.
 */
export function CartonGridEditor({
  grid,
  onChange,
  mode,
  disabled = false,
}: {
  grid: CartonGrid;
  onChange: (next: CartonGrid) => void;
  mode: 'pack' | 'recarton';
  disabled?: boolean;
}) {
  const totals = new Map(rowTotals(grid).map((row) => [row.skuId, row]));
  const measures: readonly { field: CartonMeasure; word: string }[] = [
    { field: 'weightKg', word: 'Weight (kg)' },
    { field: 'lengthCm', word: 'L (cm)' },
    { field: 'widthCm', word: 'W (cm)' },
    { field: 'heightCm', word: 'H (cm)' },
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="carton-grid">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium">
                SKU
              </th>
              {grid.cartons.map((_, index) => (
                <th key={index} scope="col" className="px-2 py-1 text-left font-medium whitespace-nowrap">
                  <span className="flex items-center gap-1">
                    Carton {index + 1}
                    {grid.cartons.length > 1 && cartonIsEmpty(grid, index) && (
                      <button
                        type="button"
                        className={rowButtonClass}
                        disabled={disabled}
                        onClick={() => onChange(removeCarton(grid, index))}
                        aria-label={`Remove carton ${index + 1}`}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </th>
              ))}
              <th scope="col" className="px-2 py-1 text-left font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.skus.map((sku) => {
              const total = totals.get(sku.skuId);
              return (
                <tr key={sku.skuId} className="border-t border-(--border)">
                  <th scope="row" className="px-2 py-1 text-left font-normal">
                    <span className="font-mono">{sku.skuCode}</span>
                    {sku.skuName !== undefined && <span className="block text-(--muted-foreground)">{sku.skuName}</span>}
                  </th>
                  {grid.cartons.map((carton, index) => (
                    <td key={index} className="px-2 py-1 align-top">
                      {sku.catchWeight ? (
                        <CaseCell sku={sku} grid={grid} index={index} mode={mode} disabled={disabled} onChange={onChange} />
                      ) : (
                        <input
                          className={`${inputClass} w-20 py-1`}
                          inputMode="decimal"
                          aria-label={`${sku.skuCode} in carton ${index + 1}`}
                          value={carton.qty[sku.skuId] ?? ''}
                          disabled={disabled}
                          onChange={(e) => onChange(setCartonQty(grid, index, sku.skuId, e.target.value))}
                        />
                      )}
                    </td>
                  ))}
                  <td
                    className={`px-2 py-1 align-top whitespace-nowrap ${total?.matches === false ? 'font-medium text-(--destructive)' : ''}`}
                    data-testid="carton-row-total"
                  >
                    {total?.word}
                  </td>
                </tr>
              );
            })}
            {measures.map(({ field, word }) => (
              <tr key={field} className="border-t border-(--border)">
                <th scope="row" className="px-2 py-1 text-left font-normal text-(--muted-foreground)">
                  {word}
                </th>
                {grid.cartons.map((carton, index) => (
                  <td key={index} className="px-2 py-1">
                    <input
                      className={`${inputClass} w-20 py-1`}
                      inputMode="decimal"
                      aria-label={`Carton ${index + 1} ${word}`}
                      placeholder="—"
                      value={carton[field]}
                      disabled={disabled}
                      onChange={(e) => onChange(setCartonMeasure(grid, index, field, e.target.value))}
                    />
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || grid.cartons.length >= MAX_CARTONS}
          onClick={() => onChange(addCarton(grid))}
        >
          Add carton
        </button>
        <span className="text-(--muted-foreground)">
          {grid.cartons.length} {grid.cartons.length === 1 ? 'carton' : 'cartons'} — weigh each carton; dimensions are all three sides or none.
        </span>
      </div>
    </div>
  );
}

/** A catch-weight SKU's cell: read-only at pack; a carton select per case at re-carton. */
function CaseCell({
  sku,
  grid,
  index,
  mode,
  disabled,
  onChange,
}: {
  sku: CartonSku;
  grid: CartonGrid;
  index: number;
  mode: 'pack' | 'recarton';
  disabled: boolean;
  onChange: (next: CartonGrid) => void;
}) {
  const here = (sku.cases ?? []).filter((c) => grid.caseCarton[c.id] === index);
  if (mode === 'pack') {
    return <span className="text-(--muted-foreground)">{here.length} cases</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {here.map((c) => (
        <li key={c.id}>
          <label className="flex items-center gap-1">
            <span className="font-mono">{c.label}</span>
            <select
              className="rounded-sm border border-(--border) bg-(--background) px-1 py-0.5"
              aria-label={`Carton for case ${c.label}`}
              value={index}
              disabled={disabled}
              onChange={(e) => onChange(assignCase(grid, c.id, Number(e.target.value)))}
            >
              {grid.cartons.map((_, i) => (
                <option key={i} value={i}>
                  Carton {i + 1}
                </option>
              ))}
            </select>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** The live pack's SKUs as grid rows (A26: the re-carton grid is prefilled from the live pack). */
export function cartonSkusFromPack(pack: PackViewDto, skuMap: Readonly<Record<string, SkuResponse>> | null): readonly CartonSku[] {
  const bySku = new Map<string, { milli: number; code: string; name: string; uom: string; cases: string[]; catchWeight: boolean }>();
  for (const carton of pack.cartons) {
    for (const line of carton.lines) {
      const entry = bySku.get(line.skuId) ?? { milli: 0, code: line.skuCode, name: line.skuName, uom: line.uom, cases: [], catchWeight: false };
      entry.milli += Math.round(line.qty * 1000);
      if (line.handlingUnitIds !== null && line.handlingUnitIds.length > 0) {
        entry.catchWeight = true;
        entry.cases.push(...line.handlingUnitIds);
      }
      bySku.set(line.skuId, entry);
    }
  }
  return [...bySku.entries()].map(([skuId, entry]) => {
    const sku = skuMap?.[skuId];
    const catchWeight = entry.catchWeight || sku?.catchWeightTracked === true;
    return {
      skuId,
      skuCode: entry.code,
      skuName: entry.name,
      uom: sku === undefined ? null : { uom: sku.uom, uomPrecision: sku.uomPrecision },
      packedQty: entry.milli / 1000,
      catchWeight,
      ...(catchWeight ? { cases: entry.cases.map((id) => ({ id, label: `…${id.replace(/-/g, '').slice(-8)}` })) } : {}),
    };
  });
}

/**
 * Story 4-5a (A8, A26) — Re-pack into cartons (`pack.execute`): the same
 * goods in a new split while the order is packed and no carrier label exists.
 * The grid opens prefilled from the live pack; a reason is required; the
 * `Idempotency-Key` is bound to the body (the same body reuses its key, any
 * edit mints a fresh one). Refusals are worded by `code`.
 */
export function RepackIntoCartons({
  tenantId,
  orderId,
  pack,
  skuMap,
  onClose,
  onDone,
}: {
  tenantId: string;
  orderId: string;
  pack: PackViewDto;
  skuMap: Readonly<Record<string, SkuResponse>> | null;
  onClose: () => void;
  /** The 200/201: the caller shows the outcome (it outlives this form and the refetch). */
  onDone: (response: RecartonResponse) => void;
}) {
  const [grid, setGrid] = useState<CartonGrid>(() => gridFromLivePack(cartonSkusFromPack(pack, skuMap), pack.cartons));
  const [reason, setReason] = useState('');
  const [binding, setBinding] = useState<{ key: string; body: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const built = buildRecartonBody(grid, reason);
    if (built.body === null) {
      setProblem(built.problem);
      return;
    }
    const bound = bindRecartonKey(binding, built.body, ulid);
    setBinding(bound);
    setProblem(null);
    setPending(true);
    try {
      const response = await fetchApiRecartonOrder(tenantId, orderId, built.body, bound.key);
      if (mounted.current) setBinding(null);
      onDone(response);
      notifyOutboundChanged();
    } catch (error) {
      if (mounted.current) setProblem(cartonReason(error, 'recarton'));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-sm border border-(--border) p-3" data-testid="recarton-form">
      <div className="text-xs font-medium">Re-pack into cartons</div>
      <div className="text-xs text-(--muted-foreground)">
        The same goods in a new split. Pack {pack.packSeq} is superseded and its carton labels stop scanning.
      </div>
      <CartonGridEditor
        grid={grid}
        mode="recarton"
        disabled={pending}
        onChange={(next) => {
          setGrid(next);
          setProblem(null);
        }}
      />
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Reason</span>
        <input
          className={inputClass}
          value={reason}
          maxLength={MAX_RECARTON_REASON_LENGTH}
          disabled={pending}
          onChange={(e) => {
            setReason(e.target.value);
            setProblem(null);
          }}
          placeholder="Why the order is re-packed"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryClass} disabled={pending}>
          {pending ? 'Re-packing…' : 'Re-pack'}
        </button>
        <button type="button" className={buttonClass} disabled={pending} onClick={onClose}>
          Cancel
        </button>
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not re-packed" reason={problem} />}
    </form>
  );
}

/** The re-carton's outcome (A8, A40): the new pack, or unchanged; re-verify a client label. */
export function RecartonOutcome({ outcome }: { outcome: RecartonResponse }) {
  return (
    <div className="flex flex-col gap-2" data-testid="recarton-outcome">
      <FeedbackBanner
        tone="accepted"
        word={outcome.unchanged ? 'Unchanged' : 'Re-packed'}
        reason={
          outcome.unchanged
            ? 'The split is the same as the live pack — nothing changed.'
            : `Pack ${outcome.pack.packSeq}: ${cartonSummary(outcome.pack.cartonCount, outcome.pack.grossWeightGrams)}. Print the new carton labels — the old ones no longer scan.`
        }
      />
      {outcome.clientLabelReverify && (
        <FeedbackBanner tone="warning" word="Re-verify the client label" reason="The client’s label sat on a box of the old split — scan it again." />
      )}
    </div>
  );
}

