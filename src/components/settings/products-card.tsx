'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiCreateProduct, fetchApiEditProduct, fetchApiEditSku } from '@/lib/api/client';
import type { ProductResponse, SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CATALOG_CHANGED_EVENT, notifyCatalogChanged } from '@/lib/catalog';
import {
  parseProductAxes,
  productAxesLabel,
  productReason,
  skuAttachReason,
  variantValuesLabel,
} from '@/lib/catalog-products';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useCatalogSkus, useProducts, useSkusForProduct } from '@/lib/use-catalog';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * The products card (story 11-6) — the tenant's product→variant ranges in
 * the Settings catalog stack. A product row expands to its variant matrix
 * (UX-DR28: one row expanding, never N unrelated SKU rows), the matrix
 * attaches/detaches variants through the existing SKU edit PATCH, and the
 * create/edit product form rides the 11-3 product routes.
 *
 * No new capability: everything mutating is gated by `sku.edit` (the 11-3
 * precedent) — the capability mirror is untouched. The backend's per-command
 * role read stays the authority.
 */
export function ProductsCard() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Products</div>
        <div className="text-(--muted-foreground)">Sign in to browse your catalog.</div>
      </div>
    );
  }
  return <ProductsCardSessioned />;
}

function ProductsCardSessioned() {
  const products = useProducts();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The form below the table: a product to edit, or `creating` for a new one.
  const [editing, setEditing] = useState<ProductResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // Bumped to remount DataTable, whose Prev/Next cursor is internal state —
  // a created product lands at the top of page one, so any catalog change
  // returns the list to page one before it refetches.
  const [pageEpoch, setPageEpoch] = useState(0);

  const { onCursor } = products ?? { onCursor: undefined };
  useEffect(() => {
    const onChange = () => {
      onCursor?.(null);
      setPageEpoch((epoch) => epoch + 1);
    };
    window.addEventListener(CATALOG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, onChange);
  }, [onCursor]);

  // Story 1.5 gating, the sku-table.tsx pattern: the role is subscribed (not
  // a bare readSession() at render) so a /me bootstrap role rewrite re-renders
  // the affordances.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canEditSku = roleHasCapability(role, 'sku.edit');

  const columns: readonly DataTableColumn<ProductResponse>[] = [
    {
      key: 'name',
      header: 'Product',
      // The row's disclosure: surface-owned aria-expanded / aria-controls
      // (the 4-2b pattern), announcing the matrix it opens (UX-DR28).
      render: (product) => (
        <button
          type="button"
          aria-expanded={expandedId === product.id}
          aria-controls={expandedId === product.id ? expandedRowId(product.id) : undefined}
          onClick={() => setExpandedId((id) => (id === product.id ? null : product.id))}
          className="flex items-center gap-2 text-left underline-offset-2 hover:underline"
        >
          <span aria-hidden className="text-(--muted-foreground)">
            {expandedId === product.id ? '▾' : '▸'}
          </span>
          {product.name}
        </button>
      ),
    },
    { key: 'axes', header: 'Axes', render: (product) => productAxesLabel(product.axes) },
    {
      key: 'skuCount',
      header: 'Variants',
      numeric: true,
      render: (product) => String(product.skuCount),
    },
    ...(canEditSku
      ? [
          {
            key: 'actions',
            header: '',
            render: (product: ProductResponse) => (
              <button
                type="button"
                onClick={() => {
                  setEditing(product);
                  setOutcome(null);
                }}
                className={rowButtonClass}
              >
                Edit
              </button>
            ),
          } satisfies DataTableColumn<ProductResponse>,
        ]
      : []),
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Products</h2>
        <div className="text-(--muted-foreground)">
          A product groups the SKUs that differ on its declared axes — expand a row for its variant
          matrix. Identity only: stock, barcodes and tracking stay on the SKUs.
        </div>
      </div>

      {products.state === 'failed' ? (
        <FeedbackBanner tone="rejected" word="Products unavailable" reason={products.reason} />
      ) : null}

      {canEditSku ? (
        <div>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setOutcome(null);
            }}
            className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90"
          >
            New product
          </button>
        </div>
      ) : null}

      <DataTable<ProductResponse>
        key={pageEpoch}
        columns={columns}
        rows={products.state === 'ready' ? products.data.items : []}
        nextCursor={products.state === 'ready' ? products.data.nextCursor : null}
        onCursor={products?.onCursor}
        emptyMessage={
          products.state === 'loading' ? 'Loading products…' : 'No products yet — create one above.'
        }
        renderExpanded={(product) =>
          expandedId === product.id ? (
            <VariantMatrix product={product} canEditSku={canEditSku} onNotify={setOutcome} />
          ) : null
        }
      />

      {(creating || editing !== null) && (
        <ProductForm
          key={editing?.id ?? 'create'}
          product={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(saved, created) => {
            setCreating(false);
            setEditing(null);
            setOutcome({
              tone: 'accepted',
              word: created ? `${saved.name} created` : `${saved.name} updated`,
              reason: created
                ? 'Attach SKUs to it from its variant matrix.'
                : 'The change is live across the catalog.',
            });
            notifyCatalogChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not saved', reason })}
        />
      )}
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </section>
  );
}

/**
 * One product's variant matrix, fetched when the row expands — the attached
 * SKUs joined with the product's declared axes client-side (`GET
 * /catalog/skus?productId=` grew no read additions for this card). A failure
 * is reported on this row alone — the list around it is untouched, and an
 * empty variant list must never read as "loading".
 */
function VariantMatrix({
  product,
  canEditSku,
  onNotify,
}: {
  product: ProductResponse;
  canEditSku: boolean;
  onNotify: (outcome: Outcome) => void;
}) {
  const variants = useSkusForProduct(product.id);
  const allSkus = useCatalogSkus();
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  // The whole catalog as the picker's option set — UNATTACHED SKUs only. The
  // server's attach arm has no current-attachment guard, so offering a SKU
  // that belongs to another product would move it off that product silently
  // (its matrix would lose the variant); the frozen matrix says "choose an
  // unattached SKU". A guaranteed refusal is filtered out of the options,
  // not validated at submit.
  const attachCandidates: readonly SkuResponse[] =
    allSkus.state === 'ready'
      ? Object.values(allSkus.data)
          .filter((sku) => sku.productId === null)
          .sort((a, b) => a.code.localeCompare(b.code))
      : [];

  async function detach(sku: SkuResponse) {
    const session = readSession();
    if (session === null) return;
    setPendingId(sku.id);
    setAttachError(null);
    try {
      // Detach rides the SKU edit PATCH: `productId: null` clears the values
      // with it — a `variantValues` key must NOT ride a detach.
      await fetchApiEditSku(session.tenant.id, sku.id, { productId: null }, ulid());
      onNotify({
        tone: 'accepted',
        word: `${sku.code} detached`,
        reason: 'The SKU is unattached; its values are cleared with the detach.',
      });
      notifyCatalogChanged();
    } catch (error) {
      setAttachError(skuAttachReason(error));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section role="region" aria-label={`Variants for ${product.name}`} className="flex flex-col gap-2">
      {variants.state === 'loading' ? (
        <div className="text-xs text-(--muted-foreground)">Loading variants…</div>
      ) : variants.state === 'failed' ? (
        <div className="flex flex-col items-start gap-2">
          {/* The row's own failure, inline on the row — the list untouched. */}
          <div role="alert" className="text-xs text-(--destructive)">
            {variants.reason}
          </div>
          <button type="button" onClick={variants.reload} className={rowButtonClass}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {variants.data.map((sku) => (
              <li key={sku.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono">{sku.code}</span>
                <span className="text-(--muted-foreground)">{sku.name}</span>
                <span className="font-mono text-(--muted-foreground)">{sku.barcode}</span>
                <span className="data">{variantValuesLabel(sku.variantValues, product.axes)}</span>
                {canEditSku ? (
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => detach(sku)}
                    className={rowButtonClass}
                  >
                    {pendingId === sku.id ? 'Detaching…' : 'Detach'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {variants.data.length === 0 ? (
            <div className="text-xs text-(--muted-foreground)">
              No variants attached to this product yet.
            </div>
          ) : null}
          {canEditSku ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setAttachOpen(true);
                  setAttachError(null);
                }}
                disabled={attachCandidates.length === 0}
                className={rowButtonClass}
              >
                Attach variant
              </button>
              {attachCandidates.length === 0 && allSkus.state === 'ready' ? (
                <span className="text-xs text-(--muted-foreground)">
                  {Object.keys(allSkus.data).length === 0
                    ? 'No SKUs yet — import your catalog first.'
                    : 'Every SKU is already attached to a product — detach one first, then attach it here.'}
                </span>
              ) : null}
            </div>
          ) : null}
          {attachError !== null && (
            <div role="alert" className="text-xs text-(--destructive)">
              {attachError}
            </div>
          )}
          {attachOpen && canEditSku ? (
            <AttachVariantForm
              product={product}
              candidates={attachCandidates}
              onClose={() => setAttachOpen(false)}
              onAttached={(sku) => {
                setAttachOpen(false);
                setAttachError(null);
                onNotify({
                  tone: 'accepted',
                  word: `${sku.code} attached`,
                  reason: 'The SKU now carries this product’s variant values.',
                });
                notifyCatalogChanged();
              }}
              onRejected={(reason) => setAttachError(reason)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The attach form: one unattached SKU + a value for each axis the product
 * declares. Values are sent exactly as typed — the backend's refusal naming
 * `variantValues` and the axis (or the duplicate-values conflict, which
 * names the SKU it collides with) renders through `skuAttachReason`.
 */
function AttachVariantForm({
  product,
  candidates,
  onClose,
  onAttached,
  onRejected,
}: {
  product: ProductResponse;
  candidates: readonly SkuResponse[];
  onClose: () => void;
  onAttached: (sku: SkuResponse) => void;
  onRejected: (reason: string) => void;
}) {
  const [skuId, setSkuId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    if (skuId === '') {
      onRejected('Pick the SKU to attach.');
      return;
    }
    // Values must cover the product's axes exactly — the backend refuses a
    // blank or missing one naming the axis, and the client refuses a blank
    // first, the same way it refuses an empty destination field.
    const blank = product.axes.find((axis) => (values[axis] ?? '').trim() === '');
    if (blank !== undefined) {
      onRejected(`Fill in a ${blank} value for the variant.`);
      return;
    }
    setPending(true);
    try {
      const updated = await fetchApiEditSku(
        session.tenant.id,
        skuId,
        {
          productId: product.id,
          variantValues: Object.fromEntries(
            product.axes.map((axis) => [axis, (values[axis] ?? '').trim()]),
          ),
        },
        ulid(),
      );
      onAttached(updated);
    } catch (error) {
      onRejected(skuAttachReason(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-sm border border-(--border) p-3"
      aria-label={`Attach a variant to ${product.name}`}
    >
      <div className="text-xs text-(--muted-foreground)">
        Attaching a variant to <span className="font-medium">{product.name}</span> — the SKU must
        carry a value on every axis.
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>SKU</span>
          <select
            className={inputClass}
            value={skuId}
            onChange={(e) => setSkuId(e.target.value)}
            required
          >
            <option value="" disabled>
              Pick a SKU…
            </option>
            {candidates.map((sku) => (
              <option key={sku.id} value={sku.id}>
                {sku.code} {sku.name}
              </option>
            ))}
          </select>
        </label>
        {product.axes.map((axis) => (
          <label key={axis} className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>{axis}</span>
            <input
              className={inputClass}
              value={values[axis] ?? ''}
              onChange={(e) => setValues((current) => ({ ...current, [axis]: e.target.value }))}
              required
              maxLength={64}
            />
          </label>
        ))}
      </div>
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
          {pending ? 'Attaching…' : 'Attach'}
        </button>
      </div>
    </form>
  );
}

/**
 * The product create/edit form below the table (the `SkuEditForm` pattern):
 * the name is always editable; the axes only while no SKU is attached — for
 * an attached product the axes field renders disabled and the PATCH omits
 * them, so the guaranteed 409 `product-has-variants` is never even asked for.
 */
function ProductForm({
  product,
  onClose,
  onSaved,
  onRejected,
}: {
  product: ProductResponse | null;
  onClose: () => void;
  onSaved: (product: ProductResponse, created: boolean) => void;
  onRejected: (reason: string) => void;
}) {
  const created = product === null;
  const [name, setName] = useState(product?.name ?? '');
  // The prefill speaks the INPUT grammar (comma-separated — what
  // `parseProductAxes` splits on), not the table cell's display join
  // (`productAxesLabel`'s "size · colour"): a saved edit round-trips the
  // product's existing axes verbatim. Display and entry are different
  // grammars and live at different sites.
  const [axes, setAxes] = useState(product ? product.axes.join(', ') : '');
  const [pending, setPending] = useState(false);
  const axesLocked = !created && (product?.skuCount ?? 0) > 0;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    const parsed = parseAxesOrReject(axes, onRejected);
    if (parsed === null) return;
    setPending(true);
    try {
      const trimmedName = name.trim();
      if (created) {
        const saved = await fetchApiCreateProduct(
          session.tenant.id,
          { name: trimmedName, axes: [...parsed] },
          ulid(),
        );
        onSaved(saved, true);
      } else {
        // Axes ride only when they are editable — an attached product's
        // PATCH carries the name alone.
        const saved = await fetchApiEditProduct(
          session.tenant.id,
          product.id,
          axesLocked ? { name: trimmedName } : { name: trimmedName, axes: [...parsed] },
          ulid(),
        );
        onSaved(saved, false);
      }
    } catch (error) {
      onRejected(productReason(error, created ? 'created' : 'updated'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        {created
          ? 'New product — a name and 1–3 variant axes. SKUs attach through the variant matrix.'
          : `Editing ${product.name} — the name is always editable; the axes only while no SKU is attached.`}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
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
          <span className={labelClass}>Axes (comma-separated, 1–3)</span>
          <input
            className={inputClass}
            value={axes}
            onChange={(e) => setAxes(e.target.value)}
            required
            disabled={axesLocked}
            placeholder="size, colour"
          />
        </label>
      </div>
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
          {pending ? 'Saving…' : created ? 'Create product' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/** The form's axes field → the wire array, refusing the shape client-side. */
function parseAxesOrReject(
  raw: string,
  onRejected: (reason: string) => void,
): readonly string[] | null {
  const parsed = parseProductAxes(raw);
  if (parsed.problem !== null) {
    onRejected(parsed.problem);
    return null;
  }
  return parsed.axes;
}