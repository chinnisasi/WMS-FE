'use client';

import { useRef, useState } from 'react';

import { ApiProblem, fetchApiCreatePurchaseOrder, fetchApiListKits } from '@/lib/api/client';
import type { KitResponse, PurchaseOrderDto, SkuResponse } from '@/lib/api/generated';
import { defaultFormClientId } from '@/lib/active-client';
import { withoutKits } from '@/lib/asns';
import { readSession } from '@/lib/auth';
import { clientLabel, showClients, skusOfClient, workingClients } from '@/lib/clients';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { quantityInputLabel } from '@/lib/format-quantity';
import {
  EMPTY_PO_LINE,
  MAX_PO_CODE_LENGTH,
  MAX_PO_LINES,
  isVendorRefusal,
  parsePoCreate,
  poReason,
  type PoDraftLine,
} from '@/lib/purchase-orders';
import { unlinkedVendorLabel } from '@/lib/partners';
import { useKits } from '@/lib/use-catalog';
import { readyClients } from '@/lib/use-clients';
import { usePoSkuOptions, usePoVendorOptions } from '@/lib/use-inbound';
import type { ActiveClientState } from '@/lib/use-active-client';
import { ulid } from '@/lib/ulid';

import { ReadFailure } from '@/components/shared/surface';
import { lineButtonClass as buttonClass, lineInputClass as inputClass } from '@/components/shared/line-rows';

/**
 * Story 2-1 — raise a purchase order on the web for ONE client, filled in
 * order: the client (hidden for a tenant with only its own), a vendor linked
 * to that client, a typed PO code, one optional expected date, then lines of
 * that client's active non-kit SKUs with a quantity and a unit cost in
 * rupees. The body is the existing `CreatePurchaseOrderDto` — the server
 * derives the client from the SKUs; the picker only scopes what is offered.
 *
 * Vendor and SKU options are read per picked client from the server (never
 * the tenant-wide maps). The Idempotency-Key is per draft (minted on the
 * first submit, reused on a retry, cleared on any edit), with an in-flight
 * ref against a double submit. The parent mounts it keyed by the warehouse,
 * so a switch drops the draft and its key.
 */

const NO_KITS: ReadonlySet<string> = new Set();

const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

export function PoCreateForm({
  warehouseId,
  active,
  tenantName,
  onCancel,
  onCreated,
}: {
  warehouseId: string;
  /** The screen's active client (the default) and its one clients read. */
  active: ActiveClientState;
  tenantName: string | null;
  onCancel: () => void;
  onCreated: (po: PurchaseOrderDto) => void;
}) {
  const clientsFailed = active.clients.state === 'failed';
  const clients = readyClients(active.clients);
  const working = workingClients(clients);
  // A tenant with only its own client sees no picker: that client is the one.
  // The gate counts ALL clients (a self + one departed client still shows a
  // picker); only the OPTIONS drop a departed client.
  const soleClient = clients !== null && !showClients(clients) ? (clients[0]?.id ?? '') : '';
  // Until the viewer picks (or edits the draft, which pins it), the client is
  // the active one — derived at render, so a form mounted while the clients
  // load still lands on it. A single working client is the default otherwise.
  const [pickedClient, setPickedClient] = useState<string | null>(null);
  const fallbackClient = working !== null && working.length === 1 ? working[0]!.id : '';
  const formClient = pickedClient ?? defaultFormClientId(active, working, fallbackClient);
  const clientId = soleClient !== '' ? soleClient : formClient;
  const client = clients?.find((entry) => entry.id === clientId) ?? null;

  // The picked vendor, with the name it had (so a re-read that drops it can still name it).
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null);
  const vendorId = vendor?.id ?? '';
  const [code, setCode] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<PoDraftLine[]>([EMPTY_PO_LINE]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per DRAFT: a create that timed out after the server committed must
  // replay on a retry, never raise a second PO.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const inFlight = useRef(false);

  const vendors = usePoVendorOptions(clientId);
  const skuRead = usePoSkuOptions(clientId);
  // A kit can never be received (FR-38): the picker never offers one. Until
  // the kit list is read nothing is hidden — the server's 409 still stands.
  const kits = useKits();
  const kitIds: ReadonlySet<string> = kits.state === 'ready' ? new Set(Object.keys(kits.data)) : NO_KITS;
  // The SKU options are ready only once the kits are too: before that a kit
  // cannot be told apart and would be offered.
  const skusReady = skuRead.state === 'ready' && kits.state === 'ready';
  const skuOptions: readonly SkuResponse[] =
    skuRead.state === 'ready' && skusReady ? withoutKits(skusOfClient(skuRead.data, clientId), kitIds) : [];
  const skuById: Readonly<Record<string, SkuResponse>> =
    skuRead.state === 'ready' ? Object.fromEntries(skuRead.data.map((sku) => [sku.id, sku])) : {};
  // A vendor that dropped out of a re-read (its link switched off) is no
  // longer chosen: the submit waits for a fresh pick.
  const vendorChoice = vendors.state === 'ready' && vendors.data.some((entry) => entry.id === vendorId) ? vendorId : '';

  function edited() {
    // The first edit pins the client the draft was started for: a later
    // switcher change must not move it under drafted lines.
    if (soleClient === '' && formClient !== '') setPickedClient((picked) => picked ?? formClient);
    setIdempotencyKey(null);
    setProblem(null);
  }

  function edit<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      edited();
      setter(value);
    };
  }

  function pickClient(next: string | null) {
    setPickedClient(next);
    // Another client's vendors and SKUs never fit: both start over.
    setVendor(null);
    setLines([EMPTY_PO_LINE]);
    setIdempotencyKey(null);
    setProblem(null);
  }

  /** After a kit refusal: re-read the kits (the house recovery is a refetch), name the draft's kits. */
  async function kitCodesOfDraft(tenantId: string): Promise<string[]> {
    try {
      const fresh = await fetchAllPages<KitResponse>((options) => fetchApiListKits(tenantId, options));
      const kitSet = new Set(fresh.map((kit) => kit.skuId));
      return [...new Set(lines.filter((line) => kitSet.has(line.skuId)).map((line) => skuById[line.skuId]?.code ?? line.skuId))];
    } catch {
      // The refusal still renders, without the codes.
      return [];
    }
  }

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parsePoCreate(
      { clientId, vendorId: vendorChoice, code, expectedDate, lines },
      warehouseId,
      skuOptions,
    );
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { purchaseOrder } = await fetchApiCreatePurchaseOrder(session.tenant.id, parsed.body, key);
      setIdempotencyKey(null);
      onCreated(purchaseOrder);
    } catch (error) {
      // The draft is kept as typed; a stale option is re-read.
      if (error instanceof ApiProblem && error.code === 'kit-cannot-hold-stock') {
        setProblem(poReason(error, await kitCodesOfDraft(session.tenant.id)));
        kits.reload();
        skuRead.reload();
      } else if (error instanceof ApiProblem && error.code === 'client-departed') {
        // The picked client takes no new work: drop it (and its vendor and
        // lines), re-read the clients so it leaves the picker, keep the words.
        pickClient(null);
        setProblem(poReason(error));
        active.clients.reload();
      } else {
        setProblem(poReason(error));
        if (isVendorRefusal(error)) vendors.reload();
        if (error instanceof ApiProblem && error.code === 'sku-inactive') skuRead.reload();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const clientName = client === null ? 'this client' : clientLabel(client, tenantName);
  const vendorsReady = vendors.state === 'ready' && vendors.data.length > 0;

  return (
    <form
      aria-label="Raise a purchase order"
      // The parser is the only gate: the quantity's `step` (the SKU's
      // precision) drives the spinner but must not block the submit —
      // precision is the server's to refuse, naming the unit (guide §6/§7).
      noValidate
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-xs font-medium">Raise a purchase order</div>
      {/* Nothing is editable while a create is in flight: an edit would clear
          the key, and a retry after a dropped-but-committed create must replay. */}
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      {clientsFailed ? (
        <div role="alert" className="text-xs text-(--destructive)">
          Client list unavailable — reload the page to raise a purchase order.
        </div>
      ) : (
        <>
          {soleClient === '' && (
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Client"
                value={formClient}
                onChange={(event) => pickClient(event.target.value)}
                className={inputClass}
              >
                <option value="">Pick the client…</option>
                {(working ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {clientLabel(entry, tenantName)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {clientId === '' ? (
            <div className="text-xs text-(--muted-foreground)">
              Pick the client first — a purchase order carries one client&apos;s SKUs, from a vendor linked to that client.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {vendors.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading vendors…</span>}
                {vendors.state === 'failed' && (
                  <ReadFailure word="Vendors unavailable" reason={vendors.reason} onRetry={vendors.reload} />
                )}
                {vendors.state === 'ready' && vendors.data.length === 0 && (
                  <span className="text-xs text-(--muted-foreground)">
                    No vendor is linked to {clientName} yet — link one under Settings → Partners.
                  </span>
                )}
                {vendorsReady && (
                  <select
                    aria-label="Vendor"
                    value={vendorId}
                    onChange={(event) => {
                      const picked = vendors.data.find((entry) => entry.id === event.target.value);
                      edit(setVendor)(picked === undefined ? null : { id: picked.id, name: picked.name });
                    }}
                    className={inputClass}
                  >
                    <option value="">Pick the vendor…</option>
                    {vendors.data.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.code} — {entry.name}
                      </option>
                    ))}
                    {/* The draft's vendor stays named when a re-read dropped it — not choosable. */}
                    {vendor !== null && vendorChoice === '' && (
                      <option value={vendor.id} disabled>
                        {unlinkedVendorLabel(vendor.name)}
                      </option>
                    )}
                  </select>
                )}
                <input
                  type="text"
                  aria-label="PO code"
                  placeholder="PO code"
                  maxLength={MAX_PO_CODE_LENGTH}
                  value={code}
                  onChange={(event) => edit(setCode)(event.target.value)}
                  className={`${inputClass} min-w-40`}
                />
                <label className="flex items-center gap-1 text-xs text-(--muted-foreground)">
                  Expected
                  <input
                    type="date"
                    aria-label="Expected date"
                    value={expectedDate}
                    onChange={(event) => edit(setExpectedDate)(event.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              {skuRead.state === 'failed' ? (
                <ReadFailure word="SKUs unavailable" reason={skuRead.reason} onRetry={skuRead.reload} />
              ) : kits.state === 'failed' ? (
                <ReadFailure word="Kit list unavailable" reason={kits.reason} onRetry={kits.reload} />
              ) : !skusReady ? (
                <div className="text-xs text-(--muted-foreground)">Loading SKUs…</div>
              ) : (
                <PoLineRows lines={lines} options={skuOptions} skus={skuById} onChange={edit(setLines)} />
              )}
            </>
          )}
        </>
      )}
      </fieldset>
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Discard
        </button>
        <button type="submit" disabled={busy || clientsFailed || clientId === '' || vendorChoice === ''} className={primaryClass}>
          Raise
        </button>
      </div>
    </form>
  );
}

/**
 * The PO draft's line rows: SKU (the picked client's offered SKUs), the
 * ordered quantity (its step from the SKU's precision) and the unit cost in
 * rupees. PO-local on purpose — the shared `LineRows` is the portal's too.
 */
function PoLineRows({
  lines,
  options,
  skus,
  onChange,
}: {
  lines: readonly PoDraftLine[];
  options: readonly SkuResponse[];
  skus: Readonly<Record<string, SkuResponse>>;
  onChange: (next: PoDraftLine[]) => void;
}) {
  const set = (index: number, patch: Partial<PoDraftLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, index) => {
        const sku = skus[line.skuId];
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Line ${index + 1} SKU`}
              value={line.skuId}
              onChange={(event) => set(index, { skuId: event.target.value })}
              className={inputClass}
            >
              <option value="">Pick a SKU…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} — {option.name}
                </option>
              ))}
              {/* A row's SKU stays listed when a re-read dropped it (the parser then names the line). */}
              {line.skuId !== '' && !options.some((option) => option.id === line.skuId) && (
                <option value={line.skuId}>{sku?.code ?? line.skuId}</option>
              )}
            </select>
            <input
              type="number"
              aria-label={`Line ${index + 1} quantity`}
              title={sku === undefined ? undefined : quantityInputLabel(sku.uomPrecision)}
              min={0}
              step={sku === undefined || sku.uomPrecision === 0 ? 1 : 10 ** -sku.uomPrecision}
              value={line.qty}
              onChange={(event) => set(index, { qty: event.target.value })}
              className={`${inputClass} w-28`}
            />
            {sku !== undefined && <span className="text-xs text-(--muted-foreground)">{sku.uom}</span>}
            <label className="flex items-center gap-1 text-xs text-(--muted-foreground)">
              ₹
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Line ${index + 1} unit cost (₹)`}
                placeholder="Unit cost"
                value={line.unitCost}
                onChange={(event) => set(index, { unitCost: event.target.value })}
                className={`${inputClass} w-24`}
              />
            </label>
            {lines.length > 1 && (
              <button type="button" onClick={() => onChange(lines.filter((_, i) => i !== index))} className={buttonClass}>
                Remove
              </button>
            )}
          </div>
        );
      })}
      <div>
        <button
          type="button"
          disabled={lines.length >= MAX_PO_LINES}
          onClick={() => onChange([...lines, EMPTY_PO_LINE])}
          className={buttonClass}
        >
          Add line
        </button>
      </div>
    </div>
  );
}
