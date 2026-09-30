'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiDeleteReorderPolicy,
  fetchApiDismissBreach,
  fetchApiSubmitSuggestedPo,
  fetchApiUpsertReorderPolicy,
} from '@/lib/api/client';
import type {
  BreachDto,
  ReorderPolicyDto,
  SkuResponse,
  SuggestedPoDto,
  VendorDto,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { quantityLabel } from '@/lib/format-quantity';
import {
  BREACH_TAB_LABEL,
  REPLENISHMENT_BREACH_STATUSES,
  SUGGESTED_PO_STATUSES,
  SUGGESTED_PO_TAB_LABEL,
  dismissAcceptedSentence,
  dismissBreachReason,
  milliToBase,
  notifyReplenishmentChanged,
  parseMilliInput,
  policyDeleteReason,
  policyDeletedSentence,
  policySavedSentence,
  policyUpsertReason,
  submitAcceptedSentence,
  submitSuggestedPoReason,
  type BreachStatus,
  type SuggestedPoStatus,
} from '@/lib/replenishment';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useSkuMap, useUserMap, useVendorMap } from '@/lib/use-inbound';
import { useOutboundWarehouses } from '@/lib/use-outbound-orders';
import {
  useReorderPolicies,
  useReplenishmentBreaches,
  useReplenishmentSuggestedPos,
} from '@/lib/use-replenishment';
import {
  readActiveWarehouseId,
  subscribeActiveWarehouse,
  writeActiveWarehouseId,
} from '@/lib/warehouses';

import { FeedbackBanner } from '@/components/feedback/banner';
import {
  ReadFailure,
  Section,
  inputClass,
  primaryClass,
  rowButtonClass,
  selectClass,
} from '@/components/outbound/shell';

/**
 * The Replenishment surface (story 6-1): the breach alert queue, the
 * suggested-PO drafts its sweeps minted (editable vendor + quantity,
 * submit / dismiss), and the per-warehouse reorder-override table over the
 * tenant's SKUs.
 *
 * Nothing on this surface orders anything by itself. The suggested-PO
 * drafts are the SYSTEM's suggestion — the only writer of a real purchase
 * order is the submit button's command (the backend re-executes PO creation
 * under `po.manage`) — and nothing fires except an explicit click; there is
 * no auto-submit path anywhere, in this view or behind it.
 *
 * Reads (the queues, the policy table) are open to every member
 * server-side; the nav gate on `replenishment.manage` is the planner
 * surface's entry (the read-only entry point is Epic 9's panel), and inside
 * the component the actions consult the capability again so a direct URL
 * renders read-only instead of a "blocked" screen. The backend's
 * per-command DB role read stays the authority.
 *
 * Wire units: replenishment quantities ride the module's MILLI wire (base
 * UoM × 10³) — `pointMilli`/`atpMilli`/`quantityMilli` and the policy
 * upsert body. Inputs accept base-unit decimals of at most three places
 * (milli admits nothing finer; `parseMilliInput` converts exactly, never
 * rounding); every rendered figure goes back out at the SKU's DECLARED
 * precision through `quantityLabel`, never as raw milli.
 */

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

export function ReplenishmentView() {
  // `null` = unknown (server render) → render nothing, no hydration mismatch.
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Replenishment">
        <div className="text-(--muted-foreground)">
          Sign in to review reorder breaches and suggested purchase orders —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <ReplenishmentSessioned />;
}

function ReplenishmentSessioned() {
  const warehouses = useOutboundWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  const items = warehouses.state === 'ready' ? warehouses.data.items : [];
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at render)
  // so a /me bootstrap role rewrite re-renders the affordances.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'replenishment.manage');

  if (warehouses.state === 'loading') {
    return (
      <Section title="Replenishment">
        <div className="text-(--muted-foreground)">Loading warehouses…</div>
      </Section>
    );
  }
  if (warehouses.state === 'failed') {
    return (
      <Section title="Replenishment">
        <ReadFailure
          word="Warehouses unavailable"
          reason={warehouses.reason}
          onRetry={warehouses.reload}
        />
      </Section>
    );
  }

  // The warehouse every section reads: the sidebar switcher's pick when it
  // still belongs to this tenant, else the tenant's first warehouse.
  const warehouseId =
    activeId !== null && items.some((w) => w.id === activeId) ? activeId : (items[0]?.id ?? null);
  const warehouse = items.find((w) => w.id === warehouseId);

  if (tenantId === null || warehouseId === null) {
    return (
      <Section title="Replenishment">
        <div className="text-(--muted-foreground)">
          Create a warehouse first — reorder points are evaluated per warehouse.
        </div>
      </Section>
    );
  }

  const warehouseLabel = warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`;

  return (
    <div className="flex flex-col gap-4">
      {items.length > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-(--muted-foreground)">Warehouse</span>
            <select
              className={`${selectClass} w-auto py-1`}
              value={warehouseId}
              onChange={(e) => writeActiveWarehouseId(tenantId, e.target.value)}
            >
              {items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <BreachQueue
        key={`breaches-${warehouseId}`}
        tenantId={tenantId}
        warehouseId={warehouseId}
        warehouseLabel={warehouseLabel}
        canManage={canManage}
      />
      <SuggestedPoQueue
        key={`drafts-${warehouseId}`}
        tenantId={tenantId}
        warehouseId={warehouseId}
        warehouseLabel={warehouseLabel}
        canManage={canManage}
      />
      <PolicyTable
        key={`policies-${warehouseId}`}
        tenantId={tenantId}
        warehouseId={warehouseId}
        canManage={canManage}
      />
    </div>
  );
}

/** One shared tab strip (the variance queue's shape). */
function StatusTabs<T extends string>({
  statuses,
  labels,
  value,
  ariaLabel,
  onSelect,
}: {
  statuses: readonly T[];
  labels: Record<T, string>;
  value: T;
  ariaLabel: string;
  onSelect: (next: T) => void;
}) {
  return (
    <div className="flex gap-1 text-xs" role="tablist" aria-label={ariaLabel}>
      {statuses.map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={value === s}
          onClick={() => onSelect(s)}
          className={`rounded-sm border border-(--border) px-2 py-1 ${
            value === s ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
          }`}
        >
          {labels[s]}
        </button>
      ))}
    </div>
  );
}

/* ── section 1: the breach alert queue ────────────────────────────────── */

function BreachQueue({
  tenantId,
  warehouseId,
  warehouseLabel,
  canManage,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseLabel: string | null;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<BreachStatus>('open');
  const queue = useReplenishmentBreaches(warehouseId, tab);
  const skus = useSkuMap();
  const users = useUserMap();
  // The outcome banner belongs to the tab it spoke about (keyed state, not a
  // reset effect): a tab switch shows DIFFERENT rows, and a stale
  // "Dismissed" would invite the misread that the newly displayed open
  // breaches are just gone.
  const [outcomeFor, setOutcomeFor] = useState<{
    tab: BreachStatus;
    outcome: Exclude<Outcome, null>;
  } | null>(null);
  const outcome: Outcome = outcomeFor?.tab === tab ? outcomeFor.outcome : null;
  function showOutcome(next: Exclude<Outcome, null> | null) {
    setOutcomeFor(next === null ? null : { tab, outcome: next });
  }
  // The synchronous re-entry guard: a pre-render double-click fires both
  // handlers before `disabled` renders, and one fresh-key repeat would 409
  // right after the first dismissal landed (the variance-queue pattern).
  const dismissInFlight = useRef<Set<string>>(new Set());
  const [dismissing, setDismissing] = useState<ReadonlySet<string>>(new Set());

  async function dismiss(entry: BreachDto) {
    if (dismissInFlight.current.has(entry.id)) return;
    dismissInFlight.current.add(entry.id);
    setDismissing((prev) => new Set(prev).add(entry.id));
    showOutcome(null);
    try {
      await fetchApiDismissBreach(tenantId, entry.id, ulid());
      showOutcome({
        tone: 'accepted',
        word: 'Breach dismissed',
        reason: dismissAcceptedSentence(),
      });
      // One event, every reader of the module refetches (the breach row's
      // own tab reads `dismissed` now).
      notifyReplenishmentChanged();
    } catch (error) {
      showOutcome({
        tone: 'rejected',
        word: 'Not dismissed',
        reason: dismissBreachReason(error),
      });
      // A 409 means the breach left open state in between (a sweep recovered
      // it, a submit actioned it) — the reload IS that refusal's recovery.
      if (error instanceof ApiProblem && error.status === 409) {
        queue.reload();
      }
    } finally {
      dismissInFlight.current.delete(entry.id);
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  }

  return (
    <Section title="Reorder breaches">
      <div className="-mt-2 text-xs text-(--muted-foreground)">
        ATP fell below the effective reorder point while the sweep was watching. A breach closes
        when a sweep sees the level recovered, when its suggested PO is submitted (`actioned`), or
        when you dismiss it here — dismissal never discards the draft.
      </div>
      <StatusTabs
        statuses={REPLENISHMENT_BREACH_STATUSES}
        labels={BREACH_TAB_LABEL}
        value={tab}
        ariaLabel="Breach status"
        onSelect={setTab}
      />
      {queue.state === 'failed' ? (
        <ReadFailure word="Breaches unavailable" reason={queue.reason} onRetry={queue.reload} />
      ) : queue.state === 'ready' && queue.data.items.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          No {BREACH_TAB_LABEL[tab].toLowerCase()} breaches — the warehouse sits at or above its
          reorder points.
        </div>
      ) : queue.state === 'ready' ? (
        <div className="flex flex-col gap-2">
          {queue.data.items.map((entry) => (
            <BreachCard
              key={entry.id}
              entry={entry}
              sku={skus?.[entry.skuId] ?? null}
              warehouseLabel={warehouseLabel}
              resolvedBy={entry.resolvedBy === null ? null : (users?.[entry.resolvedBy]?.email ?? null)}
              canManage={canManage}
              dismissing={dismissing.has(entry.id)}
              onDismiss={dismiss}
            />
          ))}
        </div>
      ) : (
        <div className="p-3 text-(--muted-foreground)">Loading…</div>
      )}
      {queue.state === 'ready' && queue.data.nextCursor !== null && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => queue.onCursor(queue.data.nextCursor)}
            className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted)"
          >
            Next
          </button>
        </div>
      )}
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </Section>
  );
}

/**
 * One breach card. Quantities render at the row's own SKU's declared
 * precision; an unresolvable SKU keeps the unit-agnostic fallback.
 */
function BreachCard({
  entry,
  sku,
  warehouseLabel,
  resolvedBy,
  canManage,
  dismissing,
  onDismiss,
}: {
  entry: BreachDto;
  sku: SkuResponse | null;
  warehouseLabel: string | null;
  resolvedBy: string | null;
  canManage: boolean;
  dismissing: boolean;
  onDismiss: (entry: BreachDto) => void;
}) {
  const qty = (milli: number) => quantityLabel(milliToBase(milli), sku);
  return (
    <article className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs">{sku?.code ?? '(unknown SKU)'}</span>
        {warehouseLabel !== null && (
          <span className="font-mono text-xs text-(--muted-foreground)">{warehouseLabel}</span>
        )}
        {entry.status === 'open' && (
          <span className="rounded-sm border border-(--border) px-2 py-0.5 text-xs">open</span>
        )}
      </div>
      <div className="data flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <span>ATP {qty(entry.atpMilli)}</span>
        <span>reorder point {qty(entry.pointMilli)}</span>
        <time dateTime={entry.breachAt}>{new Date(entry.breachAt).toLocaleString()}</time>
      </div>
      {entry.status !== 'open' && (
        <div className="flex flex-wrap gap-x-2 text-xs text-(--muted-foreground)">
          <span>now {BREACH_TAB_LABEL[entry.status].toLowerCase()}</span>
          {resolvedBy !== null && <span>· dismissed by {resolvedBy}</span>}
          {entry.resolvedAt !== null && (
            <time dateTime={entry.resolvedAt}>{new Date(entry.resolvedAt).toLocaleString()}</time>
          )}
        </div>
      )}
      {entry.status === 'open' && canManage && (
        <div className="flex flex-wrap justify-end">
          <button
            type="button"
            disabled={dismissing}
            onClick={() => onDismiss(entry)}
            className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted) disabled:opacity-60"
          >
            {dismissing ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      )}
    </article>
  );
}

/* ── section 2: the suggested-PO draft queue ───────────────────────────── */

function SuggestedPoQueue({
  tenantId,
  warehouseId,
  warehouseLabel,
  canManage,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseLabel: string | null;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<SuggestedPoStatus>('draft');
  const queue = useReplenishmentSuggestedPos(warehouseId, tab);
  const skus = useSkuMap();
  const vendors = useVendorMap();
  const [outcomeFor, setOutcomeFor] = useState<{
    tab: SuggestedPoStatus;
    outcome: Exclude<Outcome, null>;
  } | null>(null);
  const outcome: Outcome = outcomeFor?.tab === tab ? outcomeFor.outcome : null;
  function showOutcome(next: Exclude<Outcome, null> | null) {
    setOutcomeFor(next === null ? null : { tab, outcome: next });
  }
  const submitInFlight = useRef<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(new Set());

  async function submit(draft: SuggestedPoDto, vendorPick: string, qtyRaw: string) {
    if (submitInFlight.current.has(draft.id)) return;
    // The quantity parses BEFORE anything is sent: the card's base-unit
    // decimal → milli, never rounded. A blank input keeps the draft's own
    // quantity; a 0 (grammar-admitted) goes to the server, whose positivity
    // refusal is the documented authority.
    const trimmed = qtyRaw.trim();
    let quantityMilli = draft.quantityMilli;
    if (trimmed !== '') {
      const parsed = parseMilliInput(trimmed);
      if (parsed === null) {
        showOutcome({
          tone: 'rejected',
          word: 'Not submitted',
          reason: 'The quantity must be a decimal of at most three places — nothing was sent.',
        });
        return;
      }
      quantityMilli = parsed;
    }
    submitInFlight.current.add(draft.id);
    setSubmitting((prev) => new Set(prev).add(draft.id));
    showOutcome(null);
    try {
      const response = await fetchApiSubmitSuggestedPo(
        tenantId,
        draft.id,
        // The card's own values — the PO mints with exactly what the card
        // shows: the picked vendor (absent for '' — impossible here, the
        // button is disabled when no vendor resolves) and the parsed
        // quantity.
        {
          ...(vendorPick === '' ? {} : { vendorId: vendorPick }),
          quantityMilli,
        },
        ulid(),
      );
      // The FLAT carrier: `response.purchaseOrder` IS the minted PO.
      showOutcome({
        tone: 'accepted',
        word: `${response.purchaseOrder.code} submitted`,
        reason: submitAcceptedSentence(response),
      });
      notifyReplenishmentChanged();
      queue.reload();
    } catch (error) {
      showOutcome({
        tone: 'rejected',
        word: 'Not submitted',
        reason: submitSuggestedPoReason(error),
      });
      // A 409 — the draft already moved (a submit replayed first, or the
      // inner PO command refused the re-execution): the reload leaves the
      // row what the server says it is (draft stays draft on a refusal).
      if (error instanceof ApiProblem && error.status === 409) {
        queue.reload();
      }
    } finally {
      submitInFlight.current.delete(draft.id);
      setSubmitting((prev) => {
        const next = new Set(prev);
        next.delete(draft.id);
        return next;
      });
    }
  }

  return (
    <Section title="Suggested purchase orders">
      <div className="-mt-2 text-xs text-(--muted-foreground)">
        One draft per breach, drafted when the breach opened. Nothing is ordered automatically —
        editing and submitting are yours; a submit mints a real purchase order on the inbound path
        and marks its breach actioned.
      </div>
      <StatusTabs
        statuses={SUGGESTED_PO_STATUSES}
        labels={SUGGESTED_PO_TAB_LABEL}
        value={tab}
        ariaLabel="Suggested PO status"
        onSelect={setTab}
      />
      {queue.state === 'failed' ? (
        <ReadFailure word="Drafts unavailable" reason={queue.reason} onRetry={queue.reload} />
      ) : queue.state === 'ready' && queue.data.items.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          No {SUGGESTED_PO_TAB_LABEL[tab].toLowerCase()} suggested POs.
        </div>
      ) : queue.state === 'ready' ? (
        <div className="flex flex-col gap-2">
          {queue.data.items.map((draft) => (
            <SuggestedPoCard
              key={draft.id}
              draft={draft}
              sku={skus?.[draft.skuId] ?? null}
              vendors={vendors}
              warehouseLabel={warehouseLabel}
              canManage={canManage}
              submitting={submitting.has(draft.id)}
              onSubmit={submit}
            />
          ))}
        </div>
      ) : (
        <div className="p-3 text-(--muted-foreground)">Loading…</div>
      )}
      {queue.state === 'ready' && queue.data.nextCursor !== null && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => queue.onCursor(queue.data.nextCursor)}
            className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted)"
          >
            Next
          </button>
        </div>
      )}
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </Section>
  );
}

/**
 * One suggested-PO card. A draft is editable (vendor + quantity) and a
 * submit fires ONLY from its button — the card is the surface's entire
 * contribution to the submit-never-auto rule. A draft whose suggested
 * vendor is null and whose picker stays empty offers no submit at all
 * (§7: an action the server would refuse for a state the row shows is not
 * offered — the 400's remedy is picking a vendor).
 */
function SuggestedPoCard({
  draft,
  sku,
  vendors,
  warehouseLabel,
  canManage,
  submitting,
  onSubmit,
}: {
  draft: SuggestedPoDto;
  sku: SkuResponse | null;
  vendors: Readonly<Record<string, VendorDto>> | null;
  warehouseLabel: string | null;
  canManage: boolean;
  submitting: boolean;
  onSubmit: (draft: SuggestedPoDto, vendorPick: string, qtyRaw: string) => Promise<void>;
}) {
  const qtyLabel = quantityLabel(milliToBase(draft.quantityMilli), sku);
  const [vendorPick, setVendorPick] = useState(draft.vendorId ?? '');
  const [qtyRaw, setQtyRaw] = useState('');
  const options =
    vendors === null
      ? []
      : Object.values(vendors).sort((a, b) => a.code.localeCompare(b.code));
  const effectiveVendor = vendorPick !== '' ? vendorPick : draft.vendorId;
  const isDraft = draft.status === 'draft';

  return (
    <article className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs">{sku?.code ?? '(unknown SKU)'}</span>
        {warehouseLabel !== null && (
          <span className="font-mono text-xs text-(--muted-foreground)">{warehouseLabel}</span>
        )}
      </div>
      <div className="data flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <span>suggested quantity {qtyLabel}</span>
        {draft.status === 'submitted' && draft.submittedPoId !== null && (
          <span className="font-mono text-xs">PO {draft.submittedPoId.slice(0, 8)}…</span>
        )}
        <time dateTime={draft.createdAt}>{new Date(draft.createdAt).toLocaleString()}</time>
      </div>
      {isDraft && canManage && (
        <div className="flex flex-wrap items-end justify-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-(--muted-foreground)">Vendor</span>
            <select
              className={`${selectClass} w-auto py-1 text-xs`}
              value={vendorPick}
              onChange={(e) => setVendorPick(e.target.value)}
            >
              {draft.vendorId === null && <option value="">No vendor chosen</option>}
              {/* A suggested vendor the vendor map cannot resolve keeps its
                  own option so the select still shows it selected. */}
              {draft.vendorId !== null && vendors?.[draft.vendorId] === undefined && (
                <option value={draft.vendorId}>{draft.vendorId.slice(0, 8)}…</option>
              )}
              {options.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name} ({vendor.code})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-(--muted-foreground)">
              Quantity — {quantityHint(sku?.uomPrecision ?? null)}
            </span>
            <input
              type="number"
              className={`${inputClass} w-40 py-1 text-xs`}
              inputMode="decimal"
              step={sku?.uomPrecision === 0 || sku?.uomPrecision === undefined ? '1' : '0.001'}
              min="0"
              aria-label="Quantity"
              placeholder={String(milliToBase(draft.quantityMilli))}
              value={qtyRaw}
              onChange={(e) => setQtyRaw(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={submitting || effectiveVendor === null}
            onClick={() =>
              void onSubmit(
                draft,
                vendorPick === '' ? (draft.vendorId ?? '') : vendorPick,
                qtyRaw,
              )
            }
            className="rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit as purchase order'}
          </button>
        </div>
      )}
      {isDraft && canManage && effectiveVendor === null && (
        <div className="text-xs text-(--muted-foreground)">
          This draft carries no vendor — pick one from your vendor list before the PO can be minted.
        </div>
      )}
      {!isDraft && (
        <div className="text-xs text-(--muted-foreground)">
          {SUGGESTED_PO_TAB_LABEL[draft.status]} — nothing editable; a suggestion is set once its
          breach's PO is submitted.
        </div>
      )}
    </article>
  );
}

/** The quantity input's precision hint, when the row's UoM is readable. */
function quantityHint(precision: number | null): string {
  if (precision === null) return 'up to three decimals';
  return precision === 0 ? 'whole units' : 'decimals to 3 places';
}

/* ── section 3: the reorder-override table ─────────────────────────────── */

function PolicyTable({
  tenantId,
  warehouseId,
  canManage,
}: {
  tenantId: string;
  warehouseId: string;
  canManage: boolean;
}) {
  const policies = useReorderPolicies(warehouseId);
  const skus = useSkuMap();
  const [outcome, setOutcome] = useState<Outcome>(null);
  // One re-entry guard for the table's own edits, keyed by SKU (the
  // Set-of-in-flight shape, checked in both arms).
  const editInFlight = useRef<Set<string>>(new Set());
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [busySku, setBusySku] = useState<string | null>(null);

  const skuList =
    skus === null
      ? []
      : Object.values(skus).sort((a, b) => a.code.localeCompare(b.code));
  const overrideOf = (skuId: string): ReorderPolicyDto | undefined =>
    policies.state === 'ready' ? policies.data.items.find((p) => p.skuId === skuId) : undefined;

  async function saveOverride(sku: SkuResponse, pointRaw: string, qtyRaw: string) {
    if (editInFlight.current.has(sku.id)) return;
    const point = parseMilliInput(pointRaw);
    if (point === null) {
      setOutcome({
        tone: 'rejected',
        word: 'Not saved',
        reason: 'The reorder point must be a decimal of at most three places — nothing was sent.',
      });
      return;
    }
    const qty = parseMilliInput(qtyRaw);
    if (qty === null) {
      setOutcome({
        tone: 'rejected',
        word: 'Not saved',
        reason: 'The reorder quantity must be a decimal of at most three places — nothing was sent.',
      });
      return;
    }
    editInFlight.current.add(sku.id);
    setBusySku(sku.id);
    try {
      await fetchApiUpsertReorderPolicy(
        tenantId,
        {
          warehouseId,
          skuId: sku.id,
          reorderPoint: point,
          reorderQty: qty,
        },
        ulid(),
      );
      setOutcome({ tone: 'accepted', word: `${sku.code} override saved`, reason: policySavedSentence() });
      setEditingSku(null);
      notifyReplenishmentChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not saved', reason: policyUpsertReason(error) });
    } finally {
      editInFlight.current.delete(sku.id);
      setBusySku(null);
    }
  }

  async function removeOverride(sku: SkuResponse, policyId: string) {
    if (editInFlight.current.has(sku.id)) return;
    editInFlight.current.add(sku.id);
    setBusySku(sku.id);
    try {
      await fetchApiDeleteReorderPolicy(tenantId, policyId, ulid());
      setOutcome({ tone: 'accepted', word: `${sku.code} override removed`, reason: policyDeletedSentence() });
      setEditingSku(null);
      notifyReplenishmentChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not removed', reason: policyDeleteReason(error) });
    } finally {
      editInFlight.current.delete(sku.id);
      setBusySku(null);
    }
  }

  return (
    <Section title="Reorder points">
      <div className="-mt-2 text-xs text-(--muted-foreground)">
        The tenant-wide defaults come from each SKU (Settings); a per-warehouse override replaces
        them for exactly this warehouse. The sweep opens a breach whenever ATP falls below the
        effective point of a SKU that has one.
      </div>
      {policies.state === 'failed' ? (
        <ReadFailure word="Overrides unavailable" reason={policies.reason} onRetry={policies.reload} />
      ) : policies.state === 'loading' ? (
        <div className="p-3 text-(--muted-foreground)">Loading…</div>
      ) : policies.data.truncated && (
        <div className="rounded-md border border-(--border) p-3 text-xs text-(--muted-foreground)">
          More overrides exist than this table can walk — the list is truncated; some rows may show
          the SKU default where an override governs.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-(--border) text-left text-(--muted-foreground)">
              <th className="px-2 py-1.5 font-medium">SKU</th>
              <th className="px-2 py-1.5 text-right font-medium data">Default point</th>
              <th className="px-2 py-1.5 text-right font-medium data">Default quantity</th>
              <th className="px-2 py-1.5 text-right font-medium data">Override (this warehouse)</th>
              {canManage && <th className="px-2 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {skuList.map((sku) => {
              const override = overrideOf(sku.id);
              return (
                <tr key={sku.id} className="border-b border-(--border)/60">
                  <td className="px-2 py-1.5">
                    <span className="font-mono">{sku.code}</span>
                    <span className="text-(--muted-foreground)"> · {sku.name}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right data">
                    {sku.reorderPoint}
                    <span className="text-(--muted-foreground)"> {sku.uom}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right data">
                    {sku.reorderQty}
                    <span className="text-(--muted-foreground)"> {sku.uom}</span>
                  </td>
                  {editingSku === sku.id && canManage ? (
                    <PolicyEditRow
                      sku={sku}
                      // Prefilled from the GOVERNING values: the override when
                      // one exists, else the SKU default.
                      initialPointRaw={
                        override === undefined
                          ? String(sku.reorderPoint)
                          : String(milliToBase(override.reorderPoint))
                      }
                      initialQtyRaw={
                        override === undefined
                          ? String(sku.reorderQty)
                          : String(milliToBase(override.reorderQty))
                      }
                      hasOverride={override !== undefined}
                      busy={busySku === sku.id}
                      onCancel={() => setEditingSku(null)}
                      onSave={(pointRaw, qtyRaw) => void saveOverride(sku, pointRaw, qtyRaw)}
                      onRemove={
                        override === undefined
                          ? () => undefined
                          : () => void removeOverride(sku, override.id)
                      }
                    />
                  ) : (
                    <>
                      <td className="px-2 py-1.5 text-right data">
                        {override === undefined ? (
                          <span className="text-(--muted-foreground)">—</span>
                        ) : (
                          <>
                            {milliToBase(override.reorderPoint)} {sku.uom} ·{' '}
                            {milliToBase(override.reorderQty)} {sku.uom}
                          </>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            className={rowButtonClass}
                            onClick={() => setEditingSku(sku.id)}
                          >
                            Edit
                          </button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
            {skuList.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-2 py-3 text-(--muted-foreground)">
                  No SKUs yet — import the catalog first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </Section>
  );
}

/**
 * One row's inline edit cells (a fragment of two `<td>`): the point and
 * quantity inputs prefilled from the governing values, plus Save / Remove /
 * Cancel. The shape is the sku-table precedent — decimal input mode, a step
 * admitting milli granularity and nothing finer, the parse and its refusal
 * handled by the table's save arm.
 */
function PolicyEditRow({
  sku,
  initialPointRaw,
  initialQtyRaw,
  hasOverride,
  busy,
  onSave,
  onRemove,
  onCancel,
}: {
  sku: SkuResponse;
  initialPointRaw: string;
  initialQtyRaw: string;
  hasOverride: boolean;
  busy: boolean;
  onSave: (pointRaw: string, qtyRaw: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [pointRaw, setPointRaw] = useState(initialPointRaw);
  const [qtyRaw, setQtyRaw] = useState(initialQtyRaw);
  const whole = sku.uomPrecision === 0;
  const step = whole ? '1' : '0.001';
  const hint = whole
    ? 'whole units — this SKU is counted in whole pieces'
    : 'a decimal of at most three places';
  return (
    <>
      <td className="px-2 py-1.5 text-right">
        <div className="flex flex-col items-end gap-1">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step={step}
            aria-label={`Reorder point for ${sku.code}`}
            title={`Reorder point — ${hint}`}
            className={`${inputClass} w-32 py-1 text-right text-xs`}
            value={pointRaw}
            onChange={(e) => setPointRaw(e.target.value)}
          />
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step={step}
            aria-label={`Reorder quantity for ${sku.code}`}
            title={`Reorder quantity — ${hint}`}
            className={`${inputClass} w-32 py-1 text-right text-xs`}
            value={qtyRaw}
            onChange={(e) => setQtyRaw(e.target.value)}
          />
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        <div className="flex justify-end gap-1">
          <button type="button" disabled={busy} onClick={() => onSave(pointRaw, qtyRaw)} className={primaryClass}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {hasOverride && (
            <button type="button" disabled={busy} onClick={onRemove} className={rowButtonClass}>
              Remove
            </button>
          )}
          <button type="button" disabled={busy} onClick={onCancel} className={rowButtonClass}>
            Cancel
          </button>
        </div>
      </td>
    </>
  );
}