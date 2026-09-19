'use client';

import { useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiEditSku,
} from '@/lib/api/client';
import type { SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { notifyCatalogChanged } from '@/lib/catalog';
import { parseQuantityInput, quantityInputLabel } from '@/lib/format-quantity';
import { skuPhysicalLabel } from '@/lib/sku-attributes';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useSkus } from '@/lib/use-catalog';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/** GST is stored in basis points; the UI edits plain percent (18% ↔ 1800). */
function gstPercent(bps: number): string {
  return String(bps / 100);
}

/**
 * One physical-attribute input (story 11.2), parsed through the
 * `parseQuantityInput` grammar (never a bare `Number()`). A blank field means
 * CLEAR (`null` — the `hsn` template); a malformed spelling refuses
 * client-side (`false`), naming the field and its unit; anything well-formed
 * but out of the backend's bounds (fractional, over-cap) is SENT, so the
 * server's own refusal naming the field renders through `rejectionReason`.
 */
function attributeInput(
  raw: string,
  label: string,
  unit: string,
  onRejected: (reason: string) => void,
): number | null | false {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = parseQuantityInput(trimmed);
  if (parsed === null) {
    onRejected(`${label} must be a whole number of ${unit}.`);
    return false;
  }
  return parsed;
}

/**
 * The tenant's SKU master data (story 1.4), a Settings sub-card: a keyset
 * paginated DataTable with inline edit — name, GST, HSN, batch/serial
 * tracking, reorder defaults, barcode. The SKU code is immutable (imports
 * create SKUs; there is no manual create in this story).
 */
export function SkuTableCard() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">SKUs</div>
        <div className="text-(--muted-foreground)">Sign in to browse your catalog.</div>
      </div>
    );
  }
  return <SkuTableCardSessioned />;
}

function SkuTableCardSessioned() {
  const skus = useSkus();
  const [editing, setEditing] = useState<SkuResponse | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // Story 1.5 gating: the table is a read (open to every member); the Edit
  // actions column renders only for roles holding `sku.edit`. The role is
  // subscribed (not a bare readSession() at render) so a /me bootstrap role
  // rewrite re-renders the column. The backend per-command role read
  // remains the authority.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canEditSku = roleHasCapability(role, 'sku.edit');

  const columns: readonly DataTableColumn<SkuResponse>[] = [
    { key: 'code', header: 'SKU code', render: (sku) => <span className="font-mono text-xs">{sku.code}</span> },
    { key: 'name', header: 'Name' },
    {
      key: 'uom',
      header: 'UoM',
      render: (sku) =>
        sku.uomConversions.length === 0
          ? sku.uom
          : `${sku.uom} · ${sku.uomConversions.map((c) => `${c.uom}:${c.factor}`).join(';')}`,
    },
    { key: 'gstRateBps', header: 'GST %', numeric: true, render: (sku) => `${sku.gstRateBps / 100}%` },
    { key: 'hsn', header: 'HSN', render: (sku) => sku.hsn ?? '—' },
    // Story 11.2 — the static physical attributes, WYSIWYG grams/millimetres;
    // the derivation lives in `src/lib/sku-attributes.ts` so a sentence stays
    // out of JSX and pinned by test.
    { key: 'physical', header: 'Weight · dims', render: (sku) => skuPhysicalLabel(sku) },
    {
      key: 'flags',
      header: 'Tracking',
      render: (sku) =>
        [sku.batchTracked ? 'Batch' : null, sku.serialTracked ? 'Serial' : null]
          .filter((flag) => flag !== null)
          .join(' + ') || '—',
    },
    { key: 'barcode', header: 'Barcode', render: (sku) => <span className="font-mono text-xs">{sku.barcode}</span> },
    ...(canEditSku
      ? [
          {
            key: 'actions',
            header: '',
            render: (sku: SkuResponse) => (
              <button
                type="button"
                onClick={() => {
                  setEditing(sku);
                  setOutcome(null);
                }}
                className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)"
              >
                Edit
              </button>
            ),
          } satisfies DataTableColumn<SkuResponse>,
        ]
      : []),
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">SKUs</h2>
        <div className="text-(--muted-foreground)">
          Your catalog, newest first. Codes are immutable — edit everything else inline.
        </div>
      </div>

      <DataTable<SkuResponse>
        columns={columns}
        rows={skus?.items ?? []}
        nextCursor={skus?.nextCursor ?? null}
        onCursor={skus?.onCursor}
        emptyMessage="No SKUs yet — import your catalog above."
      />

      {editing !== null && (
        <SkuEditForm
          sku={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            setOutcome({
              tone: 'accepted',
              word: `${updated.code} updated`,
              reason: 'The change is live across the catalog.',
            });
            skus?.reload();
            notifyCatalogChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not updated', reason })}
        />
      )}
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </section>
  );
}

/** The inline edit row form: prefilled from the picked SKU, PATCH on save. */
function SkuEditForm({
  sku,
  onClose,
  onSaved,
  onRejected,
}: {
  sku: SkuResponse;
  onClose: () => void;
  onSaved: (updated: SkuResponse) => void;
  onRejected: (reason: string) => void;
}) {
  const [name, setName] = useState(sku.name);
  const [gst, setGst] = useState(gstPercent(sku.gstRateBps));
  const [hsn, setHsn] = useState(sku.hsn ?? '');
  const [batchTracked, setBatchTracked] = useState(sku.batchTracked);
  const [serialTracked, setSerialTracked] = useState(sku.serialTracked);
  // Story 11.2 — the static physical attributes, edited WYSIWYG in grams and
  // millimetres; a blank field sends null (clear), following the hsn template.
  const [weightGrams, setWeightGrams] = useState(sku.weightGrams === null ? '' : String(sku.weightGrams));
  const [lengthMm, setLengthMm] = useState(sku.lengthMm === null ? '' : String(sku.lengthMm));
  const [widthMm, setWidthMm] = useState(sku.widthMm === null ? '' : String(sku.widthMm));
  const [heightMm, setHeightMm] = useState(sku.heightMm === null ? '' : String(sku.heightMm));
  const [countryOfOrigin, setCountryOfOrigin] = useState(sku.countryOfOrigin ?? '');
  const [reorderPoint, setReorderPoint] = useState(String(sku.reorderPoint));
  const [reorderQty, setReorderQty] = useState(String(sku.reorderQty));
  const [barcode, setBarcode] = useState(sku.barcode);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    // The decimal-literal shape, never a bare `Number()`: `1e3`, `0x10` and
    // `Infinity` all coerce silently and none of them can come out of a
    // `type="number"` field. The shape check also settles the non-negative
    // rule (no minus sign in the grammar); precision refusals stay the
    // SERVER's — a too-fine value is sent, and its refusal naming unit and
    // precision renders through `rejectionReason`.
    const point = parseQuantityInput(reorderPoint);
    if (point === null) {
      onRejected('Reorder point must be a decimal greater than zero.');
      return;
    }
    const qty = parseQuantityInput(reorderQty);
    if (qty === null) {
      onRejected('Reorder quantity must be a decimal greater than zero.');
      return;
    }
    // Story 11.2 — the attribute fields go through the same grammar. A blank
    // field clears (null); a fractional or over-cap value is SENT, and the
    // backend's refusal naming the field renders through `rejectionReason`.
    const weight = attributeInput(weightGrams, 'Weight', 'grams', onRejected);
    if (weight === false) return;
    const length = attributeInput(lengthMm, 'Length', 'millimetres', onRejected);
    if (length === false) return;
    const width = attributeInput(widthMm, 'Width', 'millimetres', onRejected);
    if (width === false) return;
    const height = attributeInput(heightMm, 'Height', 'millimetres', onRejected);
    if (height === false) return;
    setPending(true);
    try {
      const trimmedName = name.trim();
      const gstBps = Math.round(Number(gst) * 100);
      const trimmedHsn = hsn.trim();
      const trimmedOrigin = countryOfOrigin.trim();
      const updated = await fetchApiEditSku(
        session.tenant.id,
        sku.id,
        {
          name: trimmedName,
          gstRate: gstBps,
          hsn: trimmedHsn === '' ? null : trimmedHsn,
          batchTracked,
          serialTracked,
          weightGrams: weight,
          lengthMm: length,
          widthMm: width,
          heightMm: height,
          countryOfOrigin: trimmedOrigin === '' ? null : trimmedOrigin,
          reorderPoint: point,
          reorderQty: qty,
          barcode: barcode.trim(),
        },
        ulid(),
      );
      onSaved(updated);
    } catch (error) {
      onRejected(rejectionReason(error, barcode.trim()));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Editing <span className="font-mono">{sku.code}</span> — the SKU code itself cannot change.
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>Name</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>GST %</span>
          <input
            className={inputClass}
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={gst}
            onChange={(e) => setGst(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>HSN</span>
          <input
            className={inputClass}
            value={hsn}
            onChange={(e) => setHsn(e.target.value)}
            maxLength={32}
            placeholder="—"
          />
        </label>
      </div>
      {/* Story 11.2 — physical attributes, WYSIWYG grams/millimetres. Text
          inputs with inputMode="numeric" — the reorder fields' precedent
          (and 11-1's pincode): a type="number" field's native step/min/max
          validation would block submit with generic copy ahead of the
          DESIGNED named refusals, and its paste sanitization silently
          empties a field, which this form would read as a CLEAR. The
          grammar (`parseQuantityInput`) and the server's decorators are
          the only authorities; a fractional or over-cap entry is SENT and
          the server's named refusal renders. */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Weight (g)</span>
          <input
            className={inputClass}
            type="text"
            inputMode="numeric"
            value={weightGrams}
            onChange={(e) => setWeightGrams(e.target.value)}
            placeholder="—"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Length (mm)</span>
          <input
            className={inputClass}
            type="text"
            inputMode="numeric"
            value={lengthMm}
            onChange={(e) => setLengthMm(e.target.value)}
            placeholder="—"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Width (mm)</span>
          <input
            className={inputClass}
            type="text"
            inputMode="numeric"
            value={widthMm}
            onChange={(e) => setWidthMm(e.target.value)}
            placeholder="—"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Height (mm)</span>
          <input
            className={inputClass}
            type="text"
            inputMode="numeric"
            value={heightMm}
            onChange={(e) => setHeightMm(e.target.value)}
            placeholder="—"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Origin</span>
          <input
            className={inputClass}
            value={countryOfOrigin}
            onChange={(e) => setCountryOfOrigin(e.target.value)}
            maxLength={2}
            placeholder="IN"
          />
        </label>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Reorder point</span>
          <input
            className={inputClass}
            type="number"
            min={0}
            // The input constrains NOTHING beyond non-negativity (`min={0}`):
            // `step="any"` — a step from the unit's precision would make the
            // browser refuse a too-fine entry with its generic step-mismatch
            // copy, while the backend's precision refusal naming unit and
            // precision is the authority and renders through `rejectionReason`.
            step="any"
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
            required
            title={quantityInputLabel(sku.uomPrecision)}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Reorder quantity</span>
          <input
            className={inputClass}
            type="number"
            min={0}
            step="any"
            value={reorderQty}
            onChange={(e) => setReorderQty(e.target.value)}
            required
            title={quantityInputLabel(sku.uomPrecision)}
          />
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>Barcode</span>
          <input
            className={inputClass}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            maxLength={64}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={batchTracked} onChange={(e) => setBatchTracked(e.target.checked)} />
          Batch tracked
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={serialTracked} onChange={(e) => setSerialTracked(e.target.checked)} />
          Serial tracked
        </label>
        <div className="flex flex-1 justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-(--border) px-3 py-2 text-sm hover:bg-(--muted)"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Clients branch on the machine-readable problem `code`, never on prose —
 * same convention as the zone/bin forms, extended with the edit codes
 * (spec 1.4).
 */
function rejectionReason(error: unknown, attemptedBarcode?: string): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-barcode':
        // The API names the conflicting SKU in the problem detail.
        return error.detail ?? `Barcode ${attemptedBarcode ?? ''} already belongs to another SKU in this tenant.`;
      case 'not-found':
        return 'That SKU no longer exists — refresh the page.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Update failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}