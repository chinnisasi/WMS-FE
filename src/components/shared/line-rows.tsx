'use client';

import type { AsnDraftLine, LineOption } from '@/lib/asns';

// The ASN card draws with these too (imported, never copied — a copy would
// let a restyle diverge the card from its own rows).
export const lineButtonClass = 'rounded-sm border border-(--border) px-2 py-0.5 text-xs hover:bg-(--muted) disabled:opacity-60';
export const lineInputClass = 'rounded-sm border border-(--border) bg-(--background) px-2 py-1 text-xs';

/**
 * Draft line rows: SKU picker (the client's SKUs only) + quantity, add/remove.
 * Story 21-7b — generic over the minimal `LineOption`, so the portal's
 * announce form renders the same rows from its own SKU list (mapped by
 * `portalSkuOption`) without importing an operator type. Story 21-11b moved
 * it here from `inbound/asn-card.tsx`, whose module imports operator hooks
 * (`useAsns`, `useClients`, `useSkuMap`) — the portal reached them through
 * this one import (`lib/portal-boundary.test.ts`).
 */
export function LineRows<O extends LineOption>({
  lines,
  options,
  skus,
  onChange,
  lockedIds,
  hint,
}: {
  lines: readonly AsnDraftLine[];
  options: readonly O[];
  skus: Readonly<Record<string, O>> | null;
  onChange: (next: AsnDraftLine[]) => void;
  /** Lines that have received stock: their SKU is fixed (the server refuses a change). */
  lockedIds?: ReadonlySet<string>;
  /**
   * Story 4-1a — an optional per-line note after the unit (the portal order
   * form's "available here: N"). Absent — every other form — nothing renders.
   */
  hint?: (line: AsnDraftLine, index: number) => string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, index) => {
        const locked = line.id !== undefined && (lockedIds?.has(line.id) ?? false);
        const sku = skus?.[line.skuId];
        return (
          <div key={line.id ?? `new-${index}`} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Line ${index + 1} SKU`}
              value={line.skuId}
              disabled={locked}
              onChange={(event) => onChange(lines.map((l, i) => (i === index ? { ...l, skuId: event.target.value } : l)))}
              className={lineInputClass}
            >
              <option value="">Pick a SKU…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} — {option.name}
                </option>
              ))}
              {/* A row's current SKU stays listed even when the options exclude it. */}
              {line.skuId !== '' && !options.some((option) => option.id === line.skuId) && (
                <option value={line.skuId}>{sku?.code ?? line.skuId}</option>
              )}
            </select>
            <input
              type="number"
              aria-label={`Line ${index + 1} quantity`}
              min={0}
              step={sku === undefined || sku.uomPrecision === 0 ? 1 : 10 ** -sku.uomPrecision}
              value={line.qty}
              onChange={(event) => onChange(lines.map((l, i) => (i === index ? { ...l, qty: event.target.value } : l)))}
              className={`${lineInputClass} w-28`}
            />
            {sku !== undefined && <span className="text-xs text-(--muted-foreground)">{sku.uom}</span>}
            {(() => {
              const note = hint?.(line, index) ?? null;
              return note === null ? null : (
                <span className="text-xs text-(--muted-foreground)" data-testid="line-hint">
                  {note}
                </span>
              );
            })()}
            {!locked && lines.length > 1 && (
              <button type="button" onClick={() => onChange(lines.filter((_, i) => i !== index))} className={lineButtonClass}>
                Remove
              </button>
            )}
          </div>
        );
      })}
      <div>
        <button type="button" onClick={() => onChange([...lines, { skuId: '', qty: '' }])} className={lineButtonClass}>
          Add line
        </button>
      </div>
    </div>
  );
}
