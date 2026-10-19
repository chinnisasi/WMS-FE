'use client';

import type { SkuResponse } from '@/lib/api/generated';
import { UOM_OPTIONS, type PackBarcodeRow, type PackLevelRow } from '@/lib/sku-admin';
import { ulid } from '@/lib/ulid';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const smallButton = 'rounded-sm border border-(--border) px-3 py-2 text-xs hover:bg-(--muted) disabled:opacity-40';

/** The editor rows a stored SKU starts from: its levels, and every NON-primary barcode. */
export function packagingRowsOf(sku: Pick<SkuResponse, 'uomConversions' | 'barcodes'>): {
  levels: PackLevelRow[];
  barcodes: PackBarcodeRow[];
} {
  return {
    levels: sku.uomConversions.map((level) => ({ id: ulid(), uom: level.uom, factor: String(level.factor) })),
    barcodes: (sku.barcodes ?? [])
      .filter((entry) => !entry.isPrimary)
      .map((entry) => ({ id: ulid(), barcode: entry.barcode, uom: entry.uom })),
  };
}

/**
 * Story 1-4 — the shared pack-levels-and-barcodes editor (the create card
 * and the SKU table's Packaging panel). Controlled: the parent owns the rows
 * (so its per-draft idempotency key clears on every edit) and parses them
 * with `parsePackagingDraft` at submit. A barcode's level is the base unit or
 * one of the levels above it — the options offer nothing else.
 */
export function PackagingEditor({
  baseUom,
  levels,
  barcodes,
  onLevels,
  onBarcodes,
}: {
  baseUom: string;
  levels: readonly PackLevelRow[];
  barcodes: readonly PackBarcodeRow[];
  onLevels: (next: readonly PackLevelRow[]) => void;
  onBarcodes: (next: readonly PackBarcodeRow[]) => void;
}) {
  const levelOptions = UOM_OPTIONS.filter((uom) => uom !== baseUom);
  // Deduped: two level rows naming one uom must not yield duplicate options/keys.
  const barcodeLevels = [...new Set([baseUom, ...levels.map((level) => level.uom).filter((uom) => uom !== '')])];
  return (
    <div className="flex flex-col gap-3" data-testid="packaging-editor">
      <div className="flex flex-col gap-2">
        <span className={labelClass}>Pack levels</span>
        {levels.length === 0 ? (
          <span className="text-xs text-(--muted-foreground)">No pack levels — every scan counts one {baseUom}.</span>
        ) : null}
        {levels.map((row) => (
          <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-end" data-testid="pack-level-row">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs">Level</span>
              <select
                className={inputClass}
                value={row.uom}
                aria-label="Pack level unit"
                onChange={(e) => onLevels(levels.map((r) => (r.id === row.id ? { ...r, uom: e.target.value } : r)))}
              >
                <option value="">Choose…</option>
                {levelOptions.map((uom) => (
                  <option key={uom} value={uom}>
                    {uom}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs">Holds ({baseUom})</span>
              <input
                className={inputClass}
                type="text"
                inputMode="numeric"
                aria-label="Pack level factor"
                value={row.factor}
                placeholder="12"
                onChange={(e) => onLevels(levels.map((r) => (r.id === row.id ? { ...r, factor: e.target.value } : r)))}
              />
            </label>
            <button type="button" className={smallButton} onClick={() => onLevels(levels.filter((r) => r.id !== row.id))}>
              Remove level
            </button>
          </div>
        ))}
        <div>
          <button type="button" className={smallButton} onClick={() => onLevels([...levels, { id: ulid(), uom: '', factor: '' }])}>
            Add level
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className={labelClass}>Extra barcodes</span>
        {barcodes.map((row) => (
          <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-end" data-testid="pack-barcode-row">
            <label className="flex flex-[2] flex-col gap-1">
              <span className="text-xs">Barcode</span>
              <input
                className={inputClass}
                aria-label="Extra barcode"
                value={row.barcode}
                maxLength={64}
                onChange={(e) => onBarcodes(barcodes.map((r) => (r.id === row.id ? { ...r, barcode: e.target.value } : r)))}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs">Level</span>
              <select
                className={inputClass}
                aria-label="Extra barcode level"
                value={row.uom}
                onChange={(e) => onBarcodes(barcodes.map((r) => (r.id === row.id ? { ...r, uom: e.target.value } : r)))}
              >
                <option value="">Choose…</option>
                {/* A row whose level was just removed keeps its pick visible. */}
                {row.uom !== '' && !barcodeLevels.includes(row.uom) ? <option value={row.uom}>{row.uom}</option> : null}
                {barcodeLevels.map((uom) => (
                  <option key={uom} value={uom}>
                    {uom === baseUom ? `${uom} (base unit)` : uom}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={smallButton} onClick={() => onBarcodes(barcodes.filter((r) => r.id !== row.id))}>
              Remove barcode
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className={smallButton}
            onClick={() => onBarcodes([...barcodes, { id: ulid(), barcode: '', uom: '' }])}
          >
            Add barcode
          </button>
        </div>
      </div>
    </div>
  );
}
