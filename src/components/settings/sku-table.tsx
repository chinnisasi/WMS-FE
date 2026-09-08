'use client';

import { useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiEditSku,
} from '@/lib/api/client';
import type { SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { notifyCatalogChanged } from '@/lib/catalog';
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
  const [reorderPoint, setReorderPoint] = useState(String(sku.reorderPoint));
  const [reorderQty, setReorderQty] = useState(String(sku.reorderQty));
  const [barcode, setBarcode] = useState(sku.barcode);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    setPending(true);
    try {
      const trimmedName = name.trim();
      const gstBps = Math.round(Number(gst) * 100);
      const trimmedHsn = hsn.trim();
      const updated = await fetchApiEditSku(
        session.tenant.id,
        sku.id,
        {
          name: trimmedName,
          gstRate: gstBps,
          hsn: trimmedHsn === '' ? null : trimmedHsn,
          batchTracked,
          serialTracked,
          reorderPoint: Number(reorderPoint),
          reorderQty: Number(reorderQty),
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
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Reorder point</span>
          <input
            className={inputClass}
            type="number"
            min={0}
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Reorder quantity</span>
          <input
            className={inputClass}
            type="number"
            min={0}
            value={reorderQty}
            onChange={(e) => setReorderQty(e.target.value)}
            required
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