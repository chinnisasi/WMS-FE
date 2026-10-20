'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiCreateSku } from '@/lib/api/client';
import { readSession, subscribeSession } from '@/lib/auth';
import { notifyCatalogChanged } from '@/lib/catalog';
import { clientLabel, showClients, workingClients } from '@/lib/clients';
import {
  ABC_CLASSES,
  clientsUnavailableNote,
  emptySkuCreateDraft,
  HAZARD_CLASSES,
  parseShelfLifeInput,
  parseSkuCreateDraft,
  SHELF_LIFE_LABEL,
  shelfLifeWarning,
  skuMasterReason,
  STORAGE_CLASSES,
  UOM_OPTIONS,
  type SkuCreateDraft,
} from '@/lib/sku-admin';
import { ulid } from '@/lib/ulid';
import { roleHasCapability } from '@/lib/users';
import { readyClients } from '@/lib/use-clients';
import { defaultFormClientId, hiddenByClientFilterNote } from '@/lib/active-client';
import { useActiveClient } from '@/lib/use-active-client';

import { FeedbackBanner } from '@/components/feedback/banner';
import { PackagingEditor } from '@/components/settings/packaging-editor';
import { GoodsTypeFields, HazardSelect } from '@/components/settings/goods-type-fields';
import { hazardSelectFor } from '@/lib/goods-type';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Story 1-4 — create ONE SKU on the web (the import's typed fields, its pack
 * levels and barcodes included), a Settings catalog card gated on
 * `sku.edit`: an operator, accountant or client sees nothing. The client is
 * required once the tenant holds more than its own (the server answers
 * `client-required` otherwise). Pessimistic, with a per-draft idempotency key
 * (reused across retries of an unchanged draft, cleared on any edit).
 */
export function SkuCreateCard() {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  if (!roleHasCapability(role, 'sku.edit')) return null;
  return <SkuCreateCardAllowed />;
}

function SkuCreateCardAllowed() {
  // Story 1-5a — a new SKU's client defaults to the active one (one clients read).
  const active = useActiveClient();
  const clientsState = active.clients;
  const clients = readyClients(clientsState);
  const clientsNote = clientsUnavailableNote(clientsState);
  const multiClient = showClients(clients);
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SkuCreateDraft>(emptySkuCreateDraft);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  function edit(patch: Partial<SkuCreateDraft>) {
    keyRef.current = null;
    setDraft((current) => ({ ...current, ...patch }));
  }

  // The shelf-life warning reads the chosen client's policy (the only client
  // when the tenant has one).
  const policyClient =
    clients === null ? undefined : multiClient ? clients.find((client) => client.id === draft.clientId) : clients[0];
  const shelfWarning = shelfLifeWarning(
    parseShelfLifeInput(draft.shelfLifeDays).value,
    policyClient?.receivingPolicy?.minShelfLifeDays,
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || inFlight.current || clientsNote !== null) return;
    const parsed = parseSkuCreateDraft(draft, multiClient);
    if (parsed.body === null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: parsed.problem ?? 'Check the form.' });
      return;
    }
    inFlight.current = true;
    setPending(true);
    keyRef.current ??= ulid();
    try {
      const created = await fetchApiCreateSku(session.tenant.id, parsed.body, keyRef.current);
      keyRef.current = null;
      setDraft(emptySkuCreateDraft());
      setOpen(false);
      setOutcome({
        tone: 'accepted',
        word: `${created.sku.code} created`,
        reason:
          // Story 1-5a — created for another client than the active one: the SKU table hides it.
          hiddenByClientFilterNote(active, created.sku.clientId, clients, tenantName) ??
          (created.sku.uomConversions.length > 0
            ? 'It lists in the SKU table with its pack levels — refresh handhelds to scan its case and pallet barcodes.'
            : 'It lists in the SKU table below.'),
      });
      notifyCatalogChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: skuMasterReason(error) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm" aria-label="Create a SKU">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">New SKU</h2>
        <div className="text-(--muted-foreground)">
          Create one SKU — the same fields as an import row, with its pack levels and barcodes. The code and base
          unit cannot change later.
        </div>
      </div>
      {!open ? (
        <div>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setOutcome(null);
              // Story 1-5a — the active client is the default pick (an event, not a reset effect).
              if (multiClient && draft.clientId === '') {
                const clientId = defaultFormClientId(active, workingClients(clients), '');
                if (clientId !== '') setDraft((current) => ({ ...current, clientId }));
              }
            }}
            className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90"
          >
            New SKU
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} aria-label="New SKU" className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            {multiClient ? (
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelClass}>Client</span>
                <select
                  className={inputClass}
                  value={draft.clientId}
                  required
                  onChange={(e) => edit({ clientId: e.target.value })}
                >
                  <option value="" disabled>
                    Choose a client
                  </option>
                  {(workingClients(clients) ?? []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {clientLabel(client, tenantName)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Code</span>
              <input className={inputClass} value={draft.code} required maxLength={64} onChange={(e) => edit({ code: e.target.value })} />
            </label>
            <label className="flex flex-[2] flex-col gap-1">
              <span className={labelClass}>Name</span>
              <input className={inputClass} value={draft.name} required maxLength={200} onChange={(e) => edit({ name: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Base unit</span>
              <select
                className={inputClass}
                value={draft.uom}
                onChange={(e) => edit(rebaseDraft(draft, e.target.value))}
              >
                {UOM_OPTIONS.map((uom) => (
                  <option key={uom} value={uom}>
                    {uom}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>GST %</span>
              <input className={inputClass} type="text" inputMode="decimal" value={draft.gstPercent} required onChange={(e) => edit({ gstPercent: e.target.value })} />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>HSN</span>
              <input className={inputClass} value={draft.hsn} maxLength={32} placeholder="—" onChange={(e) => edit({ hsn: e.target.value })} />
            </label>
            <label className="flex flex-[2] flex-col gap-1">
              <span className={labelClass}>Barcode</span>
              <input
                className={inputClass}
                value={draft.barcode}
                maxLength={64}
                placeholder="Blank — generated"
                onChange={(e) => edit({ barcode: e.target.value })}
              />
            </label>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            {(
              [
                ['weightGrams', 'Weight (g)'],
                ['lengthMm', 'Length (mm)'],
                ['widthMm', 'Width (mm)'],
                ['heightMm', 'Height (mm)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex flex-1 flex-col gap-1">
                <span className={labelClass}>{label}</span>
                <input className={inputClass} type="text" inputMode="numeric" value={draft[key]} placeholder="—" onChange={(e) => edit({ [key]: e.target.value })} />
              </label>
            ))}
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Origin</span>
              <input className={inputClass} value={draft.countryOfOrigin} maxLength={2} placeholder="IN" onChange={(e) => edit({ countryOfOrigin: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Storage class</span>
              <select className={inputClass} value={draft.storageClass} onChange={(e) => edit({ storageClass: e.target.value })}>
                {STORAGE_CLASSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {/* Story 1-6a — decision 7: a mapped DG class sets the hazard (not
                sent — the server derives it); class 8 chooses acid, base or none. */}
            <HazardSelect
              dgClass={draft.goods.dgClass}
              value={draft.hazardClass}
              onChange={(hazardClass) => edit({ hazardClass })}
              hazardClasses={HAZARD_CLASSES}
            />
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>ABC class</span>
              <select className={inputClass} value={draft.abcClass} onChange={(e) => edit({ abcClass: e.target.value })}>
                <option value="">Not classified</option>
                {ABC_CLASSES.map((value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Reorder point</span>
              <input className={inputClass} type="text" inputMode="decimal" value={draft.reorderPoint} placeholder="0" onChange={(e) => edit({ reorderPoint: e.target.value })} />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Reorder quantity</span>
              <input className={inputClass} type="text" inputMode="decimal" value={draft.reorderQty} placeholder="0" onChange={(e) => edit({ reorderQty: e.target.value })} />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>{SHELF_LIFE_LABEL}</span>
              <input className={inputClass} type="text" inputMode="numeric" value={draft.shelfLifeDays} placeholder="—" onChange={(e) => edit({ shelfLifeDays: e.target.value })} />
            </label>
          </div>
          {shelfWarning !== null ? (
            <div role="status" className="text-xs text-(--warning)">
              {shelfWarning}
            </div>
          ) : null}
          <GoodsTypeFields
            draft={draft.goods}
            onChange={(goods) => edit({ goods })}
            // A create has no stored hazard: class 8 starts on "choose", a free class on "No rule".
            onDgClassChange={(dgClass) => edit({ hazardClass: hazardSelectFor(dgClass, { dgClass: '', hazardClass: '' }) })}
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.batchTracked} onChange={(e) => edit({ batchTracked: e.target.checked })} />
              Batch tracked
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.serialTracked} onChange={(e) => edit({ serialTracked: e.target.checked })} />
              Serial tracked
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.catchWeightTracked} onChange={(e) => edit({ catchWeightTracked: e.target.checked })} />
              Catch weight
            </label>
          </div>
          <PackagingEditor
            baseUom={draft.uom}
            levels={draft.levels}
            barcodes={draft.barcodes}
            onLevels={(levels) => edit({ levels })}
            onBarcodes={(barcodes) => edit({ barcodes })}
          />
          {clientsNote !== null ? (
            <div role="status" className="text-xs text-(--muted-foreground)">
              {clientsNote}
            </div>
          ) : null}
          <div className="flex flex-1 justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-sm border border-(--border) px-3 py-2 text-sm hover:bg-(--muted)">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || clientsNote !== null}
              className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Creating…' : 'Create SKU'}
            </button>
          </div>
        </form>
      )}
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </section>
  );
}

/**
 * A base-unit change: levels equal to the new base unit are dropped, and a
 * barcode row that named the OLD base unit or a dropped level loses its level
 * (the operator re-picks it) — a level must never silently change meaning.
 */
export function rebaseDraft(draft: SkuCreateDraft, uom: string): Partial<SkuCreateDraft> {
  const dropped = new Set(draft.levels.filter((level) => level.uom === uom).map((level) => level.uom));
  return {
    uom,
    levels: draft.levels.filter((level) => level.uom !== uom),
    barcodes: draft.barcodes.map((row) =>
      row.uom === draft.uom || dropped.has(row.uom) ? { ...row, uom: '' } : row,
    ),
  };
}
