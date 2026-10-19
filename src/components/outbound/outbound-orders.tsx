'use client';

import Link from 'next/link';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';

import { fetchApiCancelOrder, fetchApiCreateOrder } from '@/lib/api/client';
import type { OrderEntryDto, ReturnAuthorizationDto, SkuResponse } from '@/lib/api/generated';
import { quantityInputLabel, sharedQuantityUom } from '@/lib/format-quantity';
import { buyerGstinStateMismatch } from '@/lib/gst-states';
import { GSTIN_HELP, parseGstinField } from '@/lib/gstin';
import { notifyOutboundChanged, OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import {
  canCancelOrder,
  cancelOutcome,
  cancelReason,
  channelRefLabel,
  createOutcome,
  createReason,
  destinationSummary,
  emptyDestinationFields,
  filterPage,
  groupKitLines,
  holdStateLabel,
  legalNameBody,
  legalNameProblem,
  kitParentHoldLabel,
  lineQuantityLabel,
  lineTotals,
  ORDER_STATUSES,
  orderSourceLabel,
  orderStatusLabel,
  orderTotalsLabel,
  pageFilterCount,
  parseDestinationFields,
  parseDraftLines,
  RATE_HELP,
  showsLegalName,
  type DestinationFields,
  type DraftLine,
  type Outcome,
  type OrderStatus,
} from '@/lib/outbound-orders';
import { ledgerDocHref, type OrdersDrill } from '@/lib/drill';
import { useOrderDetail, useOutboundOrders, useOutboundSkus } from '@/lib/use-outbound-orders';
import {
  clientCell,
  clientChangeQuestion,
  clientLabel,
  linesKeptForClient,
  orderClientProblem,
  orderableClients,
  orderSkuOptions,
  PICK_CLIENT_FIRST,
  showClients,
  skusOfClient,
  skuClientDeparted,
  RETURNS_CLIENT_DEPARTED,
} from '@/lib/clients';
import { readyClients, useClients } from '@/lib/use-clients';
import { clientFilterKey, defaultFormClientId, hiddenByClientFilterNote, type ClientFilter } from '@/lib/active-client';
import { useActiveClient, type ActiveClientState } from '@/lib/use-active-client';
import { readSession, subscribeSession } from '@/lib/auth';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { canCreateReturn, RETURN_CREATED_REASON, returnCreatedWord } from '@/lib/returns';

import { StateSelect } from '@/components/address/state-select';
import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { AllClientsNote, ClientFilterChip } from '@/components/shared/client-filter-chip';
import { DrillBanner } from '@/components/shared/drill-banner';
import { ReturnCreateForm } from '@/components/returns/return-create-form';
import { FeedbackBanner } from '@/components/feedback/banner';
import type { OutboundSurfaceProps } from '@/components/outbound/outbound';
import {
  buttonClass,
  inputClass,
  labelClass,
  primaryClass,
  ReadFailure,
  Section,
  selectClass,
} from '@/components/outbound/shell';

/**
 * The Outbound orders surface (story 4.2b) — the first web consumer of the
 * order lifecycle stories 4.1-4.6 shipped: the active warehouse's orders
 * newest-first, a row that expands into its per-line ordered / reserved /
 * shortfall quantities and hold state, manual multi-line entry, and cancel.
 *
 * The session, the warehouse and the role are resolved once by `outbound.tsx`
 * and passed in — this surface used to walk the warehouse list itself and
 * render a second picker beside the waves surface's.
 *
 * Gating hides, never blocks: the list and the expanded detail are readable
 * by every role, while the create form and the cancel affordance render only
 * for `orders.manage` (Owner + Ops Manager — deliberately not Operator). The
 * nav entry itself stays ungated. The backend's per-command role read is the
 * authority either way.
 *
 * Story 9-1b — drilled (`drill` set): the drill's rows, server-filtered,
 * under the banner; the page-scoped status filter is hidden and never
 * applied (the server already filtered). Decision 7: the row actions
 * (cancel) stay; the page-level create form is hidden while drilled.
 */
export function OutboundOrders({
  tenantId,
  warehouseId,
  warehouseLabel,
  role,
  drill = null,
}: OutboundSurfaceProps & { readonly drill?: OrdersDrill | null }) {
  const canManageOrders = roleHasCapability(role, 'orders.manage');
  // Story 13-1 — "Create return" on a dispatched order's detail.
  const canManageReturns = roleHasCapability(role, 'returns.manage');
  // Story 1-5a — the screen's one active-client read: the list is filtered by
  // it, the create form defaults to it; a drill ignores it (decision 11).
  const active = useActiveClient();
  return (
    <Section title="Orders">
      {drill !== null && <DrillBanner drill={drill} />}
      {drill !== null ? <AllClientsNote active={active} /> : <ClientFilterChip active={active} tenantName={active.tenantName} />}
      <div className="text-(--muted-foreground)">
        {warehouseLabel === null
          ? 'Outbound orders'
          : `${warehouseLabel} — newest first. Acceptance reserves stock line by line.`}
      </div>
      {canManageOrders && drill === null && <OrderCreateForm tenantId={tenantId} warehouseId={warehouseId} active={active} />}
      <OrdersTable
        tenantId={tenantId}
        warehouseId={warehouseId}
        canManageOrders={canManageOrders}
        canManageReturns={canManageReturns}
        drill={drill}
        clientFilter={active.filter}
        clientsState={active.clients}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Manual entry                                                        */
/* ------------------------------------------------------------------ */

interface DraftRow extends DraftLine {
  /** Stable across removals — an index key would move focus and IME state. */
  readonly id: string;
}

function emptyRow(): DraftRow {
  return { id: ulid(), skuId: '', quantity: '', rate: '' };
}

/**
 * Manual multi-line order entry (capability `orders.manage`). Acceptance
 * reserves `min(qty, atp)` per line, so a line above ATP still comes back
 * 201 — the result reads as accepted with a named shortfall, never as a
 * failure.
 *
 * The `Idempotency-Key` is minted once per DRAFT, not per attempt: a create
 * that times out after the server committed is then safe to retry, because
 * the replay returns the original response instead of raising a second
 * order. Editing the draft mints a fresh key — the same key with a changed
 * body is what the backend answers 422 `idempotency-key-reuse` to — and so
 * does a successful submit, which clears the draft.
 */
function OrderCreateForm({
  tenantId,
  warehouseId,
  active,
}: {
  tenantId: string;
  warehouseId: string;
  active: ActiveClientState;
}) {
  const skus = useOutboundSkus();
  // Story 1-1 — client first. A SKU code is unique per client, so with more
  // than one client the form asks which client the order is for before any
  // line, and every line offers only that client's SKUs. With one client the
  // select is not shown and nothing changes. No `clientId` is sent: the
  // server derives it from the lines, so the request hash is unchanged.
  const clientsState = active.clients;
  // Story 1-2a decision 5 — every client but a DEPARTED one takes new orders
  // (a suspended client still ships); the one-client rule runs over them.
  const allClients = readyClients(clientsState);
  const clients = orderableClients(allClients);
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  // Story 1-5a — until the viewer picks, the client defaults to the active
  // one (when it takes orders): derived at render, never a reset effect.
  const [pickedClientId, setClientId] = useState<string | null>(null);
  const clientId = pickedClientId ?? defaultFormClientId(active, clients, '');
  // A create for another client than the filtered one is hidden by the filter — say so.
  const [hiddenNote, setHiddenNote] = useState<string | null>(null);
  // A client change that would clear picked lines waits on a confirm row.
  const [pendingClient, setPendingClient] = useState<string | null>(null);
  const [draft, setDraft] = useState<readonly DraftRow[]>([emptyRow()]);
  // Story 11-1: the destination is required at create, so the form owns one
  // fieldset shared by every line — one shipment, one address.
  const [destination, setDestination] = useState<DestinationFields>(emptyDestinationFields());
  // Story 8-1c: the buyer's GSTIN, in its OWN state — `DestinationFields` is
  // shared with the warehouse origin form, which has no buyer.
  const [consigneeGstin, setConsigneeGstin] = useState('');
  // Story 8-1d: the registered buyer's legal / trade name — printed as the
  // invoice's buyer and the e-way bill's toTrdName. Offered once a buyer
  // GSTIN is typed; kept (not sent) while the GSTIN is blank.
  const [consigneeLegalName, setConsigneeLegalName] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const rateHelpId = useId();
  const gstinHelpId = useId();
  const legalNameHelpId = useId();
  const buyerStateWarningId = useId();
  // Story 8-1d: a buyer GSTIN from another state than the ship-to is legal,
  // so this only WARNS, inline — the invoice will carry pos-discrepancy and
  // the e-way bill will be blocked ship-to-differs.
  const buyerStateMismatch = buyerGstinStateMismatch(consigneeGstin, destination.state);
  const skuMap = skus.state === 'ready' ? skus.data : null;
  const skuList: readonly SkuResponse[] =
    skuMap === null ? [] : Object.values(skuMap).sort((a, b) => a.code.localeCompare(b.code));
  const pickClient = showClients(clients);
  // One working client among departed ones: no select, but only its SKUs.
  const soleClientId =
    allClients !== null && clients !== null && clients.length === 1 && allClients.length > 1 ? clients[0]!.id : null;
  const skuOptions =
    soleClientId === null ? orderSkuOptions(skuList, clients, clientId) : skusOfClient(skuList, soleClientId);
  const pendingCleared =
    pendingClient === null ? 0 : draft.length - linesKeptForClient(draft, skuList, pendingClient).length;

  /** Apply a client: lines of any other client go (at least one row stays). */
  function applyClient(next: string) {
    setPendingClient(null);
    setClientId(next);
    const kept = linesKeptForClient(draft, skuList, next);
    if (kept.length !== draft.length) editDraft(() => (kept.length === 0 ? [emptyRow()] : kept));
  }

  /** A client change that would clear picked lines asks first. */
  function chooseClient(next: string) {
    if (next === clientId) return;
    if (linesKeptForClient(draft, skuList, next).length === draft.length) {
      applyClient(next);
      return;
    }
    setPendingClient(next);
  }

  /**
   * Story 1-5a — the first edit pins the client the draft was started for:
   * a later switcher change must not move the client under drafted lines
   * (only an explicit pick, through the confirm row, changes it).
   */
  function pinClient() {
    // Functional: an explicit pick queued in the same handler (`applyClient`) wins.
    if (clientId !== '') setClientId((picked) => picked ?? clientId);
  }

  /** Any draft edit invalidates the key the previous attempt would replay. */
  function editDraft(next: (rows: readonly DraftRow[]) => readonly DraftRow[]) {
    pinClient();
    setIdempotencyKey(null);
    setDraft(next);
  }

  /** The destination is part of the hashed payload — an address edit is a
   * draft edit, and mints a fresh key the same way a line edit does. */
  function editDestination(next: DestinationFields) {
    pinClient();
    setIdempotencyKey(null);
    setDestination(next);
  }

  /** `consigneeGstin` is in the backend's request hash too — an edit mints a
   * fresh key, exactly as a line or address edit does. */
  function editConsigneeGstin(next: string) {
    pinClient();
    setIdempotencyKey(null);
    setConsigneeGstin(next);
  }

  /** The legal name joins the backend's request hash when sent — an edit
   * mints a fresh key, like every other field of the body. */
  function editConsigneeLegalName(next: string) {
    pinClient();
    setIdempotencyKey(null);
    setConsigneeLegalName(next);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const clientProblem = orderClientProblem(clients, clientId);
    if (clientProblem !== null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: clientProblem });
      return;
    }
    const parsed = parseDraftLines(draft);
    if (parsed.problem !== null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: parsed.problem });
      return;
    }
    // Nothing is requested that the backend would only answer 400 to: the
    // destination's shape is decided here first (the server re-checks it
    // behind its replay lookup — the DTO's word is never trusted twice).
    const address = parseDestinationFields(destination, 'destination');
    if (address.problem !== null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: address.problem });
      return;
    }
    // Lines → address → GSTIN, all before the key is minted and before
    // setPending(true): a refused shape sends nothing and keeps the button.
    const buyer = parseGstinField(consigneeGstin, 'Buyer GSTIN');
    if (buyer.problem !== null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: buyer.problem });
      return;
    }
    // The legal name's cap, counted as the backend counts it (code points
    // after the trim) — only when it would be sent.
    const legalProblem = legalNameProblem(buyer.gstin, consigneeLegalName);
    if (legalProblem !== null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: legalProblem });
      return;
    }
    // Reused across retries of an unchanged draft; minted afresh otherwise.
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setOutcome(null);
    setHiddenNote(null);
    try {
      const { order } = await fetchApiCreateOrder(
        tenantId,
        {
          warehouseId,
          source: 'manual',
          lines: [...parsed.lines],
          destination: address.destination!,
          // Blank = absent: no key at all, never `''`.
          ...(buyer.gstin === undefined ? {} : { consigneeGstin: buyer.gstin }),
          // Sent only beside a GSTIN, and only when non-blank.
          ...legalNameBody(buyer.gstin, consigneeLegalName),
        },
        key,
      );
      setDraft([emptyRow()]);
      setDestination(emptyDestinationFields());
      setConsigneeGstin('');
      setConsigneeLegalName('');
      setIdempotencyKey(null);
      setOutcome(createOutcome(order, (skuId) => skuMap?.[skuId], parsed.lines));
      setHiddenNote(hiddenByClientFilterNote(active, order.clientId, allClients, tenantName));
      notifyOutboundChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: createReason(error) });
    } finally {
      setPending(false);
    }
  }

  if (skus.state === 'loading' || clientsState.state === 'loading') {
    return (
      <div className="rounded-sm border border-(--border) p-3 text-xs text-(--muted-foreground)">
        Loading SKUs…
      </div>
    );
  }
  if (skus.state === 'failed') {
    // No SKUs, no honest picker — the form is not offered rather than
    // offered empty.
    return (
      <div className="rounded-sm border border-(--border) p-3">
        <ReadFailure word="SKUs unavailable" reason={skus.reason} onRetry={skus.reload} />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Raise an order — acceptance reserves each line against available stock. A line above what is
        available is accepted and backordered for the remainder.
      </div>
      {clientsState.state === 'failed' && (
        // Degrades to every SKU (the server still refuses a mixed-client
        // order 409 `mixed-client`), and says so — never silently.
        <div className="flex flex-wrap items-center gap-2 text-xs text-(--muted-foreground)" data-testid="order-clients-note">
          <span>Clients not loaded — every SKU is offered; an order is still for one client.</span>
          <button type="button" className={buttonClass} onClick={clientsState.reload}>
            Retry clients
          </button>
        </div>
      )}
      {pickClient && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 sm:max-w-md">
            <span className={labelClass}>Client</span>
            <select
              className={selectClass}
              value={pendingClient ?? clientId}
              onChange={(e) => chooseClient(e.target.value)}
              required
            >
              <option value="" disabled>
                Choose a client…
              </option>
              {(clients ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {clientLabel(client, tenantName)}
                </option>
              ))}
            </select>
          </label>
          {pendingClient !== null && (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="order-client-confirm">
              <span>
                {clientChangeQuestion(
                  pendingCleared,
                  (() => {
                    const next = (clients ?? []).find((client) => client.id === pendingClient);
                    return next === undefined ? 'that client' : clientLabel(next, tenantName);
                  })(),
                )}
              </span>
              <button type="button" className={buttonClass} onClick={() => applyClient(pendingClient)}>
                Change client
              </button>
              <button type="button" className={buttonClass} onClick={() => setPendingClient(null)}>
                Keep {(() => {
                  const current = (clients ?? []).find((client) => client.id === clientId);
                  return current === undefined ? 'the client' : clientLabel(current, tenantName);
                })()}
              </button>
            </div>
          )}
        </div>
      )}
      <fieldset className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
        <legend className="px-1 text-xs text-(--muted-foreground)">Ship to</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-[2] flex-col gap-1">
            <span className={labelClass}>Contact name</span>
            <input
              className={inputClass}
              value={destination.contactName}
              onChange={(e) => editDestination({ ...destination, contactName: e.target.value })}
              required
              maxLength={120}
              placeholder="Priya Sharma"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Phone</span>
            <input
              className={inputClass}
              value={destination.phone}
              onChange={(e) => editDestination({ ...destination, phone: e.target.value })}
              required
              maxLength={20}
              placeholder="+91 98450 12345"
            />
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-[2] flex-col gap-1">
            <span className={labelClass}>Address line 1</span>
            <input
              className={inputClass}
              value={destination.line1}
              onChange={(e) => editDestination({ ...destination, line1: e.target.value })}
              required
              maxLength={200}
              placeholder="12, Peenya Industrial Area"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Address line 2 (optional)</span>
            <input
              className={inputClass}
              value={destination.line2}
              onChange={(e) => editDestination({ ...destination, line2: e.target.value })}
              maxLength={200}
              placeholder="Gate 3"
            />
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>City</span>
            <input
              className={inputClass}
              value={destination.city}
              onChange={(e) => editDestination({ ...destination, city: e.target.value })}
              required
              maxLength={100}
              placeholder="Bengaluru"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>State</span>
            <StateSelect
              className={selectClass}
              value={destination.state}
              onChange={(state) => editDestination({ ...destination, state })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Pincode</span>
            <input
              className={inputClass}
              value={destination.pincode}
              onChange={(e) => editDestination({ ...destination, pincode: e.target.value })}
              required
              // Text, never a number input: the pincode keeps its leading
              // zeros (`110001`), and `type="number"` would strip them.
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="560066"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 sm:max-w-xs">
          <span className={labelClass}>Buyer GSTIN (optional, B2B)</span>
          <input
            className={inputClass}
            value={consigneeGstin}
            onChange={(e) => editConsigneeGstin(e.target.value)}
            // No `pattern`: `parseGstinField` is the only shape gate.
            maxLength={20}
            autoCapitalize="characters"
            spellCheck={false}
            autoComplete="off"
            placeholder="27AAPCD1234K1Z5"
            aria-describedby={buyerStateMismatch === null ? gstinHelpId : `${gstinHelpId} ${buyerStateWarningId}`}
          />
          <span id={gstinHelpId} className="text-xs text-(--muted-foreground)">{GSTIN_HELP}</span>
          {buyerStateMismatch !== null && (
            // Non-blocking: the submit stays enabled. Glyph + word, never colour alone.
            <span id={buyerStateWarningId} data-testid="buyer-state-mismatch" className="text-xs text-(--warning)">
              ⚠ Warning: {buyerStateMismatch}
            </span>
          )}
        </label>
        {showsLegalName(consigneeGstin) && (
          <label className="flex flex-col gap-1 sm:max-w-md">
            <span className={labelClass}>Buyer legal name (optional)</span>
            <input
              className={inputClass}
              value={consigneeLegalName}
              onChange={(e) => editConsigneeLegalName(e.target.value)}
              // No maxLength: it counts UTF-16 units before the trim, the
              // backend counts code points after it — `legalNameProblem` does.
              autoComplete="off"
              placeholder="Mysore Spices Pvt Ltd"
              aria-describedby={legalNameHelpId}
            />
            <span id={legalNameHelpId} className="text-xs text-(--muted-foreground)">
              The registered legal or trade name, printed as the buyer on the invoice and the e-way bill. Blank prints the contact name.
            </span>
          </label>
        )}
      </fieldset>
      <div className="flex flex-col gap-2">
        {draft.map((row, index) => (
          <div key={row.id} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-[3] flex-col gap-1">
              <span className={labelClass}>SKU</span>
              <select
                className={selectClass}
                value={row.skuId}
                onChange={(e) =>
                  editDraft((rows) =>
                    rows.map((r) => (r.id === row.id ? { ...r, skuId: e.target.value } : r)),
                  )
                }
                required
              >
                <option value="" disabled>
                  {pickClient && clientId === '' ? PICK_CLIENT_FIRST : 'Pick a SKU…'}
                </option>
                {/* Story 1-1 — an order is for ONE client: every line offers
                    the chosen client's SKUs (every SKU with one client). */}
                {skuOptions.map((sku) => (
                  <option key={sku.id} value={sku.id}>
                    {sku.code} {sku.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Quantity</span>
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                // The input constrains NOTHING: no `min` (the backend accepts
                // sub-1 fractions down to 0.001) and `step="any"` (a step
                // value would make the browser refuse a too-fine entry with
                // its generic step-mismatch copy — the backend's precision
                // refusal naming unit and precision is the authority, and it
                // renders under the error contract). `parseDraftLines` and
                // the server decide everything.
                step="any"
                value={row.quantity}
                onChange={(e) =>
                  editDraft((rows) =>
                    rows.map((r) => (r.id === row.id ? { ...r, quantity: e.target.value } : r)),
                  )
                }
                required
                placeholder="1"
                title={quantityInputLabel(skuMap?.[row.skuId]?.uomPrecision ?? 0)}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Rate ₹ (optional)</span>
              <input
                className={inputClass}
                // Text, not a number input: `parseRupees` is the one rupee
                // grammar, and a blank must stay blank (unpriced).
                type="text"
                inputMode="decimal"
                value={row.rate ?? ''}
                onChange={(e) =>
                  editDraft((rows) =>
                    rows.map((r) => (r.id === row.id ? { ...r, rate: e.target.value } : r)),
                  )
                }
                placeholder="125.50"
                aria-describedby={rateHelpId}
              />
            </label>
            <button
              type="button"
              aria-label={`Remove line ${index + 1}`}
              disabled={draft.length === 1}
              onClick={() => editDraft((rows) => rows.filter((r) => r.id !== row.id))}
              className={buttonClass}
            >
              Remove
            </button>
          </div>
        ))}
        <p id={rateHelpId} className="text-xs text-(--muted-foreground)">
          {RATE_HELP}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => editDraft((rows) => [...rows, emptyRow()])}
          className={buttonClass}
        >
          Add line
        </button>
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Creating…' : 'Create order'}
        </button>
      </div>
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
      {hiddenNote !== null && (
        <div role="status" data-testid="hidden-by-client-filter" className="text-xs text-(--muted-foreground)">
          {hiddenNote}
        </div>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

function OrdersTable({
  tenantId,
  warehouseId,
  canManageOrders,
  canManageReturns = false,
  drill,
  clientFilter,
  clientsState,
}: {
  tenantId: string;
  warehouseId: string;
  canManageOrders: boolean;
  /** Story 13-1 — threaded down to the expanded detail's "Create return". */
  canManageReturns?: boolean;
  drill: OrdersDrill | null;
  /** Story 1-5a — the active-client filter (the hook ignores it while drilled). */
  clientFilter: ClientFilter;
  /** The screen's one clients read (the client column). */
  clientsState: ActiveClientState['clients'];
}) {
  const orders = useOutboundOrders(warehouseId, clientFilter, drill);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Bumped to remount DataTable, whose Prev/Next cursor is internal state —
  // without it the table would still offer Prev on what is now page one.
  const [pageEpoch, setPageEpoch] = useState(0);

  const { onCursor } = orders;
  useEffect(() => {
    // A create or a cancel invalidates the keyset position (a new order
    // lands at the top of page one), so any outbound change returns the list
    // to page one before it refetches. Otherwise the banner reports an
    // acceptance the page on screen demonstrably cannot show.
    const onChange = () => {
      onCursor(null);
      setPageEpoch((epoch) => epoch + 1);
    };
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, [onCursor]);

  const loaded = orders.state === 'ready' ? orders.data.items : [];
  // Drilled: the server already filtered; the page-scoped filter never applies.
  const rows = drill === null ? filterPage(loaded, statusFilter) : loaded;
  // Story 21-2b — the client column, only once the tenant holds more than
  // its own client.
  const clients = readyClients(clientsState);
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );

  async function confirmCancel(orderId: string) {
    setBusyId(orderId);
    setOutcome(null);
    try {
      const { order } = await fetchApiCancelOrder(tenantId, orderId, ulid());
      setOutcome(cancelOutcome(order));
      setConfirmId(null);
      notifyOutboundChanged();
    } catch (error) {
      // The refusal stays on screen with the confirmation still open — its
      // two real causes (a committed reservation, a drawn pick line) are
      // invisible in every field this client holds, so the server's own
      // words are what gets rendered.
      setOutcome({ tone: 'rejected', word: 'Not cancelled', reason: cancelReason(error) });
    } finally {
      setBusyId(null);
    }
  }

  const columns: readonly DataTableColumn<OrderEntryDto>[] = [
    {
      key: 'id',
      header: 'Order',
      render: (order) => (
        <button
          type="button"
          aria-expanded={expandedId === order.id}
          aria-controls={expandedId === order.id ? expandedRowId(order.id) : undefined}
          onClick={() => setExpandedId((id) => (id === order.id ? null : order.id))}
          className="flex items-center gap-2 text-left underline-offset-2 hover:underline"
        >
          <span aria-hidden className="text-(--muted-foreground)">
            {expandedId === order.id ? '▾' : '▸'}
          </span>
          <span className="font-mono text-xs">{order.id}</span>
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (order) => (
        <span className="rounded-full border border-(--border) bg-(--muted) px-2 py-0.5 text-xs text-(--muted-foreground)">
          {orderStatusLabel(order.status)}
        </span>
      ),
    },
    ...(showClients(clients)
      ? [
          {
            key: 'client',
            header: 'Client',
            render: (order: OrderEntryDto) => clientCell(order.clientId, clients ?? [], tenantName),
          } satisfies DataTableColumn<OrderEntryDto>,
        ]
      : []),
    { key: 'source', header: 'Source', render: (order) => orderSourceLabel(order.source) },
    {
      // Story 11-1: the one address line the list works from first — city
      // and pincode. Pre-11.1 rows read `destination: null` and render a dash.
      key: 'destination',
      header: 'Ship to',
      render: (order) => destinationSummary(order),
    },
    {
      key: 'channel',
      header: 'Channel refs',
      render: (order) => <span className="font-mono text-xs">{channelRefLabel(order)}</span>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (order) => <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (order) => <time dateTime={order.updatedAt}>{new Date(order.updatedAt).toLocaleString()}</time>,
    },
    ...(canManageOrders
      ? [
          {
            key: 'actions',
            header: '',
            render: (order: OrderEntryDto) =>
              // No affordance at all for a state the backend would refuse:
              // ready_to_dispatch, dispatched and cancelled are downstream or
              // already done.
              canCancelOrder(order.status) ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    // Any cancel in flight disables every row: `busyId` and
                    // the outcome banner are single, so two concurrent
                    // cancels would leave one of them unreported.
                    disabled={busyId !== null}
                    onClick={() => setConfirmId(order.id)}
                    className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              ) : null,
          } satisfies DataTableColumn<OrderEntryDto>,
        ]
      : []),
  ];

  const confirmTarget = confirmId === null ? null : (loaded.find((o) => o.id === confirmId) ?? null);

  return (
    <div className="flex flex-col gap-2">
      {/* Drilled: no page-scoped status control — the server filtered. */}
      {drill === null && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="flex flex-col gap-1">
            {/* The list API offers cursor + limit and nothing else — no status
                filter, no sort, no search. Naming the scope in the control is
                what keeps it from implying it searched the whole warehouse. */}
            <span className="text-xs text-(--muted-foreground)">Filter this page</span>
            <select
              className={`${selectClass} w-auto py-1`}
              value={statusFilter ?? ''}
              onChange={(e) => setStatusFilter(e.target.value === '' ? null : (e.target.value as OrderStatus))}
            >
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {orderStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-(--muted-foreground)">
            {pageFilterCount(rows.length, loaded.length)}
          </span>
        </div>
      )}

      {confirmTarget !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
          <div className="text-xs text-(--muted-foreground)">
            Cancelling order <span className="font-mono">{confirmTarget.id}</span> releases every
            reservation it still holds. A stock hold a picklist already claimed is refused by the
            server, and the order stays as it is.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => confirmCancel(confirmTarget.id)}
              className={primaryClass}
            >
              {busyId === confirmTarget.id ? 'Cancelling…' : 'Cancel this order'}
            </button>
            <button type="button" onClick={() => setConfirmId(null)} className={buttonClass}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {orders.state === 'failed' ? (
        <ReadFailure word="Orders unavailable" reason={orders.reason} onRetry={orders.reload} />
      ) : (
        <DataTable<OrderEntryDto>
          // Story 1-5a — a client switch remounts the table (no Prev onto another client's cursor).
          key={`${pageEpoch}|${clientFilterKey(drill === null ? clientFilter : null)}`}
          columns={columns}
          rows={rows}
          nextCursor={orders.state === 'ready' ? orders.data.nextCursor : null}
          onCursor={orders.onCursor}
          renderExpanded={(order) =>
            expandedId === order.id ? (
              <OrderDetailPanel orderId={order.id} warehouseId={warehouseId} canManageReturns={canManageReturns} />
            ) : null
          }
          emptyMessage={
            orders.state === 'loading'
              ? 'Loading orders…'
              : loaded.length === 0
                ? 'No orders in this warehouse yet.'
                : 'No orders on this page match that status.'
          }
        />
      )}
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </div>
  );
}

/**
 * One order's lines, fetched when the row expands. A failure is reported on
 * this row alone — the list around it is untouched, and an empty line list
 * would read as "this order has no lines", which is never true.
 *
 * Exported for the story 11-6 component test, which pins the kit
 * parent/child grouping on this panel alone rather than driving the whole
 * surface (its list, filter and warehouse picker are out of scope there).
 */
export function OrderDetailPanel({
  orderId,
  warehouseId,
  canManageReturns = false,
}: {
  orderId: string;
  /** Story 9-3a — the order's warehouse (threaded from `OrdersTable`): its "View ledger" link. */
  warehouseId?: string;
  /**
   * Story 13-1 — `returns.manage` (threaded from `OutboundOrders`): a
   * dispatched order offers "Create return", an inline form that reads the
   * returnable quantities only when opened — never on expand.
   */
  canManageReturns?: boolean;
}) {
  const detail = useOrderDetail(orderId);
  const skus = useOutboundSkus();
  // Story 1-2a — a departed client's order offers no "Create return" (the
  // server refuses 409 `client-departed`); the words say why.
  const detailClients = readyClients(useClients());
  const [creatingReturn, setCreatingReturn] = useState(false);
  const [createdReturn, setCreatedReturn] = useState<ReturnAuthorizationDto | null>(null);
  // The SKU map only decorates: a line falls back to its raw `skuId` rather
  // than blocking the quantities, which are what this panel exists for.
  const skuMap = skus.state === 'ready' ? skus.data : null;

  if (detail.state === 'loading') {
    return <div className="text-xs text-(--muted-foreground)">Loading lines…</div>;
  }
  if (detail.state === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2">
        <div role="alert" className="text-xs text-(--destructive)">
          {detail.reason}
        </div>
        <button type="button" onClick={detail.reload} className={`${buttonClass} text-xs`}>
          Retry
        </button>
      </div>
    );
  }

  // The totals count the TOP-LEVEL lines only — a kit's children share their
  // parent's quantity, so summing the exploded flat list would double-count
  // every kit order's contents. The same groups feed the line list.
  const groups = groupKitLines(detail.data.lines);

  return (
    <div className="flex flex-col gap-2">
      {warehouseId !== undefined && (
        // Story 9-3a — the order's pick, pack and dispatch events. The label
        // is the order's real handle: its channel ref, else the id the list shows.
        <div className="text-xs">
          <Link
            href={ledgerDocHref('order', orderId, warehouseId, detail.data.externalEventId ?? orderId)}
            className="text-(--primary) underline underline-offset-2"
          >
            View ledger
          </Link>
        </div>
      )}
      {canManageReturns && canCreateReturn(detail.data.status) && skuClientDeparted(detail.data, detailClients) && (
        <div className="text-xs text-(--muted-foreground)" data-testid="return-client-departed">
          {RETURNS_CLIENT_DEPARTED}
        </div>
      )}
      {canManageReturns && canCreateReturn(detail.data.status) && !skuClientDeparted(detail.data, detailClients) && !creatingReturn && (
        <div>
          <button
            type="button"
            onClick={() => {
              setCreatedReturn(null);
              setCreatingReturn(true);
            }}
            className={`${buttonClass} py-1 text-xs`}
          >
            Create return
          </button>
        </div>
      )}
      {createdReturn !== null && (
        <FeedbackBanner
          tone="accepted"
          word={returnCreatedWord(createdReturn)}
          reason={RETURN_CREATED_REASON}
          action={
            <Link href="/returns" className="text-xs text-(--primary) underline underline-offset-2">
              View returns
            </Link>
          }
        />
      )}
      {creatingReturn && (
        <ReturnCreateForm
          orderId={orderId}
          skus={skuMap}
          onCreated={(rma) => {
            setCreatingReturn(false);
            setCreatedReturn(rma);
          }}
          onClose={() => setCreatingReturn(false)}
        />
      )}
      <div className="text-xs text-(--muted-foreground)">
        {orderTotalsLabel(
          lineTotals(groups.map(({ line }) => line)),
          sharedQuantityUom(detail.data.lines, (skuId) => skuMap?.[skuId]),
        )}
      </div>
      {/* Story 11-6 — an exploded kit renders as its parent line with the
          component children grouped beneath it, not as a flat line list.
          Plain orders group into single-line groups and render exactly as
          before; waves/pick/pack already see the child lines and are not
          touched. */}
      <ul className="flex flex-col gap-1">
        {groups.map(({ line, children }) => (
          <li key={line.id} className="flex flex-col gap-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{skuMap?.[line.skuId]?.code ?? line.skuId}</span>
              <span className="text-(--muted-foreground)">{skuMap?.[line.skuId]?.name ?? ''}</span>
              {/* The line's own SKU names the unit and its precision — a
                  column mixing units has no single one. */}
              <span className="data">{lineQuantityLabel(line, skuMap?.[line.skuId])}</span>
              <span
                className={
                  line.status === 'backordered'
                    ? 'rounded-full border border-(--destructive) px-2 py-0.5 text-(--destructive)'
                    : 'rounded-full border border-(--border) px-2 py-0.5 text-(--muted-foreground)'
                }
              >
                {line.status === 'backordered' ? 'Backordered' : 'Open'}
              </span>
              {/* A kit parent's reservationId is always null — the holds it
                  earns belong to its children — so the ordinary hold label
                  would read "No hold" and imply it got nothing. The label
                  stays honest about the holds' state: a dispatched or
                  cancelled order's holds are retired, a backordered kit
                  holds nothing. */}
              <span className="text-(--muted-foreground)">
                {children.length > 0
                  ? kitParentHoldLabel(line, detail.data.status)
                  : `Hold: ${holdStateLabel(line)}`}
              </span>
            </div>
            {children.length > 0 ? (
              <ul className="flex flex-col gap-1 border-l border-(--border) pl-3">
                {children.map((child) => (
                  <li key={child.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span aria-hidden className="text-(--muted-foreground)">
                      └
                    </span>
                    <span className="font-mono">{skuMap?.[child.skuId]?.code ?? child.skuId}</span>
                    <span className="text-(--muted-foreground)">{skuMap?.[child.skuId]?.name ?? ''}</span>
                    <span className="data">{lineQuantityLabel(child, skuMap?.[child.skuId])}</span>
                    <span
                      className={
                        child.status === 'backordered'
                          ? 'rounded-full border border-(--destructive) px-2 py-0.5 text-(--destructive)'
                          : 'rounded-full border border-(--border) px-2 py-0.5 text-(--muted-foreground)'
                      }
                    >
                      {child.status === 'backordered' ? 'Backordered' : 'Open'}
                    </span>
                    <span className="text-(--muted-foreground)">Hold: {holdStateLabel(child)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

