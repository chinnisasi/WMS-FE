'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { fetchApiAcceptBlindReturn, fetchApiGetReturn, fetchApiListOrders, fetchApiRejectBlindReturn } from '@/lib/api/client';
import type { OrderEntryDto, ReturnAuthorizationDto, SkuResponse } from '@/lib/api/generated';
import { clientFilterKey } from '@/lib/active-client';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { clientLabel } from '@/lib/clients';
import { orderLabel, shortOrderId } from '@/lib/orders';
import { readReason } from '@/lib/outbound-orders';
import {
  CLIENT_PROMPTED_WARNING,
  MATCH_KIND_LABEL,
  MAX_REJECT_NOTE_LENGTH,
  NOT_OUR_GOODS_HINT,
  NO_ORDER_WARNING,
  RETURNS_CHANGED_EVENT,
  REJECT_REASON_OPTIONS,
  RETURN_ORIGIN_LABEL,
  REVIEW_STATUS_LABEL,
  blindAcceptedOutcome,
  blindRejectedOutcome,
  blindReviewReason,
  blindReviewRefusalReloads,
  clientPromptedConfirmLabel,
  notifyReturnsChanged,
  openRmaFlagText,
  openRmaForSuggestion,
  parcelReferenceText,
  parseRejectDraft,
  previewBlindLinks,
  receiptLineText,
  receivedAgainstNote,
  sameParcelText,
  type RejectDraft,
  type RejectReasonCode,
} from '@/lib/returns';
import { readyClients } from '@/lib/use-clients';
import { useActiveClient } from '@/lib/use-active-client';
import { useOutboundSkus } from '@/lib/use-outbound-orders';
import { usePendingBlindReturns, useReturnable } from '@/lib/use-returns';
import { ulid } from '@/lib/ulid';

import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { EmptyState } from '@/components/shared/empty-state';
import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, primaryClass, ReadFailure, Section, selectClass } from '@/components/outbound/shell';
import { StatusChip } from '@/components/shared/status-chip';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

/** The one dialog open on the tab (one at a time — nothing outside may replace an in-flight key, guide §2.4). */
type OpenDialog =
  | { kind: 'accept'; rmaId: string }
  | { kind: 'reject'; rmaId: string; preset: RejectDraft; againstCode: string | null };

type DetailRead =
  | { state: 'loading' }
  | { state: 'ready'; detail: ReturnAuthorizationDto }
  | { state: 'failed'; reason: string };

/**
 * Story 4-7b — the Unannounced tab (`returns.manage`): the active warehouse's
 * unannounced parcels still awaiting review, newest first — parcels the
 * handheld received with no RMA, booked into the Returns bin under a blind
 * RMA whose units nothing can decide until it is accepted. Each card reads
 * its detail (receipts, the open-RMA flag, the same-parcel list) and offers
 * Accept (link the suggested order, another dispatched order found by
 * reference, or "No order") and Reject (reverse the booking). Refreshes on
 * `RETURNS_CHANGED_EVENT`; no polling.
 */
export function BlindReviewQueue({
  tenantId,
  warehouseId,
  warehouseLabel,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseLabel: string | null;
}) {
  const active = useActiveClient();
  const pending = usePendingBlindReturns(warehouseId, active.filter);
  const skus = useOutboundSkus();
  const skuMap = skus.state === 'ready' ? skus.data : null;
  const clients = readyClients(active.clients);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The cursors walked so far (the page on screen is the last); a change returns to page one.
  const [cursors, setCursors] = useState<readonly string[]>([]);

  const { onCursor } = pending;
  useEffect(() => {
    const onChange = () => {
      onCursor(null);
      setCursors([]);
    };
    window.addEventListener(RETURNS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RETURNS_CHANGED_EVENT, onChange);
  }, [onCursor]);

  const skuCode = (skuId: string): string | null => skuMap?.[skuId]?.code ?? null;
  const rows = pending.state === 'ready' ? pending.data.items : [];
  // A dialog whose card left the page (reviewed elsewhere, paged away) is
  // closed — never kept to reappear with a stale key. A guarded set-state
  // during render, not an effect.
  if (dialog !== null && pending.state === 'ready' && !rows.some((row) => row.id === dialog.rmaId)) {
    setDialog(null);
  }

  function clientOf(clientId: string): string | null {
    const client = clients?.find((entry) => entry.id === clientId);
    return client === undefined ? null : clientLabel(client, active.tenantName);
  }

  return (
    <Section title="Unannounced">
      <div className="max-w-3xl text-(--muted-foreground)">
        {warehouseLabel === null ? 'Unannounced parcels' : `${warehouseLabel} — unannounced parcels`} received on the handheld with no return
        authorization, newest first. Accept one (with its order, or none) to open its units to a disposition, or reject it to reverse the
        booking.
      </div>
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
      {pending.state === 'failed' && <ReadFailure word="Unannounced returns unavailable" reason={pending.reason} onRetry={pending.reload} />}
      {pending.state === 'loading' && <div className="text-(--muted-foreground)">Loading unannounced parcels…</div>}
      {pending.state === 'ready' && rows.length === 0 && <EmptyState kind="first-use">No unannounced parcels awaiting review</EmptyState>}
      {pending.state === 'ready' && rows.length > 0 && (
        <div className="flex flex-col gap-3" key={clientFilterKey(active.filter)}>
          {rows.map((rma) => (
            <BlindReviewCard
              key={rma.id}
              tenantId={tenantId}
              warehouseId={warehouseId}
              warehouseLabel={warehouseLabel}
              rma={rma}
              clientName={clientOf(rma.clientId)}
              skus={skuMap}
              skuCode={skuCode}
              dialog={dialog !== null && dialog.rmaId === rma.id ? dialog : null}
              anotherDialogOpen={dialog !== null && dialog.rmaId !== rma.id}
              onOpen={(next) => {
                setOutcome(null);
                setDialog(next);
              }}
              onClose={() => setDialog(null)}
              onSettled={(next, reload) => {
                setDialog(null);
                setOutcome(next);
                if (reload) pending.reload();
              }}
            />
          ))}
          {(cursors.length > 0 || pending.data.nextCursor !== null) && (
            <div className="flex gap-2">
              {cursors.length > 0 && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={dialog !== null}
                  onClick={() => {
                    const back = cursors.slice(0, -1);
                    setCursors(back);
                    onCursor(back.at(-1) ?? null);
                  }}
                >
                  Previous
                </button>
              )}
              {pending.data.nextCursor !== null && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={dialog !== null}
                  onClick={() => {
                    const next = pending.data.nextCursor!;
                    setCursors([...cursors, next]);
                    onCursor(next);
                  }}
                >
                  Next
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function BlindReviewCard({
  tenantId,
  warehouseId,
  warehouseLabel,
  rma,
  clientName,
  skus,
  skuCode,
  dialog,
  anotherDialogOpen,
  onOpen,
  onClose,
  onSettled,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseLabel: string | null;
  rma: ReturnAuthorizationDto;
  clientName: string | null;
  skus: Readonly<Record<string, SkuResponse>> | null;
  skuCode: (skuId: string) => string | null;
  dialog: OpenDialog | null;
  anotherDialogOpen: boolean;
  onOpen: (dialog: OpenDialog) => void;
  onClose: () => void;
  onSettled: (outcome: Outcome, reload: boolean) => void;
}) {
  const [read, setRead] = useState<DetailRead>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetchApiGetReturn(tenantId, rma.id, { signal: controller.signal })
      .then((detail) => setRead({ state: 'ready', detail }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRead({ state: 'failed', reason: readReason(error, 'this parcel') });
      });
    return () => controller.abort();
  }, [tenantId, rma.id]);

  const detail = read.state === 'ready' ? read.detail : null;
  const receipts = detail?.receipts ?? [];
  const firstReceipt = receipts[0] ?? null;
  const openRma = detail === null ? null : openRmaForSuggestion(detail);
  const sameParcel = detail === null ? null : sameParcelText(detail);
  const suggestedOrderId = rma.suggestedOrderId ?? null;
  const busy = dialog !== null || anotherDialogOpen;

  return (
    <article className="flex flex-col gap-2 rounded-sm border border-(--border) p-3 text-sm" data-testid="blind-review-card" aria-label={`Unannounced return ${rma.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{rma.code}</span>
        <StatusChip tone="info">{RETURN_ORIGIN_LABEL.blind}</StatusChip>
        <StatusChip tone="warning">{REVIEW_STATUS_LABEL.pending}</StatusChip>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-(--muted-foreground)">Client</dt>
        <dd>{clientName ?? '—'}</dd>
        <dt className="text-(--muted-foreground)">Warehouse</dt>
        <dd>{warehouseLabel ?? '—'}</dd>
        <dt className="text-(--muted-foreground)">Operator</dt>
        <dd>{firstReceipt === null ? '—' : (firstReceipt.operatorEmail ?? 'unknown operator')}</dd>
        <dt className="text-(--muted-foreground)">Received (IST)</dt>
        <dd>
          {firstReceipt === null ? (
            '—'
          ) : (
            <time dateTime={firstReceipt.occurredAt}>{istDateTimeLabel(firstReceipt.occurredAt)}</time>
          )}
        </dd>
        <dt className="text-(--muted-foreground)">Parcel reference</dt>
        <dd className="font-mono">{parcelReferenceText(rma)}</dd>
        <dt className="text-(--muted-foreground)">Suggested order</dt>
        <dd data-testid="suggested-order">
          {suggestedOrderId === null ? (
            'No match'
          ) : (
            <>
              <SuggestedOrderLabel orderId={suggestedOrderId} />
              {rma.matchKind !== null && rma.matchKind !== undefined && (
                <span className="text-(--muted-foreground)"> — {MATCH_KIND_LABEL[rma.matchKind]}</span>
              )}
            </>
          )}
        </dd>
      </dl>
      {rma.clientPrompted === true && (
        <div role="note" className="rounded-sm border border-(--warning) bg-(--warning)/10 px-2 py-1 text-xs" data-testid="client-prompted-warning">
          ⚠ {CLIENT_PROMPTED_WARNING}
        </div>
      )}
      {read.state === 'loading' && <div className="text-xs text-(--muted-foreground)">Loading the parcel’s units…</div>}
      {read.state === 'failed' && <div className="text-xs text-(--muted-foreground)">Units unavailable — {read.reason}</div>}
      {detail !== null && (
        <ul className="flex flex-col gap-0.5 text-xs" data-testid="blind-review-lines">
          {receipts.flatMap((receipt) =>
            receipt.lines.map((line) => (
              <li key={line.id}>
                <span className="font-mono">{skus?.[line.skuId]?.code ?? line.skuId}</span>{' '}
                <span className="text-(--muted-foreground)">{receiptLineText(line)}</span>
              </li>
            )),
          )}
        </ul>
      )}
      {openRma !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-(--warning) bg-(--warning)/10 px-2 py-1 text-xs" data-testid="open-rma-flag">
          <span>⚠ {openRmaFlagText(openRma.code)}</span>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              onOpen({ kind: 'reject', rmaId: rma.id, preset: { reasonCode: 'duplicate', note: receivedAgainstNote(openRma.code) }, againstCode: openRma.code })
            }
          >
            Reject as received against {openRma.code}
          </button>
        </div>
      )}
      {sameParcel !== null && (
        <div className="text-xs text-(--muted-foreground)" data-testid="same-parcel">
          {sameParcel}
        </div>
      )}
      <div className="text-xs text-(--muted-foreground)">{NO_ORDER_WARNING}</div>
      {dialog === null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryClass} disabled={busy} onClick={() => onOpen({ kind: 'accept', rmaId: rma.id })}>
            Accept…
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => onOpen({ kind: 'reject', rmaId: rma.id, preset: { reasonCode: '', note: '' }, againstCode: null })}
          >
            Reject…
          </button>
        </div>
      )}
      {dialog?.kind === 'accept' && (
        <AcceptDialog
          tenantId={tenantId}
          warehouseId={warehouseId}
          rma={detail ?? rma}
          clientName={clientName}
          skuCode={skuCode}
          onCancel={onClose}
          onSettled={onSettled}
        />
      )}
      {dialog?.kind === 'reject' && (
        <RejectDialog
          tenantId={tenantId}
          rma={rma}
          preset={dialog.preset}
          againstCode={dialog.againstCode}
          onCancel={onClose}
          onSettled={onSettled}
        />
      )}
    </article>
  );
}

/** The suggested order by its reference (from the returnable read), else its id's short form. */
function SuggestedOrderLabel({ orderId }: { orderId: string }) {
  const returnable = useReturnable(orderId);
  const label = returnable.state === 'ready' && returnable.data.orderReference !== null ? returnable.data.orderReference : `…${shortOrderId(orderId)}`;
  return <span className="font-mono">{label}</span>;
}

type Choice = 'suggested' | 'other' | 'none' | null;
type Search = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; items: readonly OrderEntryDto[] } | { state: 'failed'; reason: string };

/** The order search's page: a reference names one order (or a backorder chain), so a short page is plenty. */
const ORDER_SEARCH_LIMIT = 20;

function AcceptDialog({
  tenantId,
  warehouseId,
  rma,
  clientName,
  skuCode,
  onCancel,
  onSettled,
}: {
  tenantId: string;
  warehouseId: string;
  rma: ReturnAuthorizationDto;
  clientName: string | null;
  skuCode: (skuId: string) => string | null;
  onCancel: () => void;
  onSettled: (outcome: Outcome, reload: boolean) => void;
}) {
  const suggestedOrderId = rma.suggestedOrderId ?? null;
  const [choice, setChoice] = useState<Choice>(suggestedOrderId === null ? null : 'suggested');
  const [reference, setReference] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const searchSeq = useRef(0);
  // The key belongs to the confirmation and the order it sends: reused by a
  // retry of the same order, new when the order changes (it is in the hash).
  const keyRef = useRef<{ key: string; orderId: string | null } | null>(null);
  const groupName = useId();
  const prompted = rma.clientPrompted === true;

  const chosenOrderId = choice === 'suggested' ? suggestedOrderId : choice === 'other' ? picked : null;

  async function runSearch() {
    const trimmed = reference.trim();
    if (trimmed === '') {
      setSearch({ state: 'idle' });
      setProblem('Type an order reference to search.');
      return;
    }
    setProblem(null);
    const seq = ++searchSeq.current;
    setSearch({ state: 'loading' });
    try {
      // A23 — the search is scoped to the parcel's client, its warehouse and dispatched orders; the server re-checks all three.
      const page = await fetchApiListOrders(tenantId, warehouseId, {
        reference: trimmed,
        clientId: rma.clientId,
        status: 'dispatched',
        limit: ORDER_SEARCH_LIMIT,
      });
      if (seq !== searchSeq.current) return;
      setSearch({ state: 'ready', items: page.items });
      setPicked(page.items.length === 1 ? page.items[0]!.id : null);
    } catch (error) {
      if (seq !== searchSeq.current) return;
      setSearch({ state: 'failed', reason: readReason(error, 'orders') });
    }
  }

  async function accept() {
    if (inFlight.current) return;
    if (choice === null) {
      setProblem('Choose the order to link — the suggestion, another order, or “No order”.');
      return;
    }
    if (choice === 'other' && picked === null) {
      setProblem('Search an order by its reference and pick it — or choose “No order”.');
      return;
    }
    if (prompted && !confirmed) {
      setProblem('Tick the confirmation — the operator chose this client at a barcode another client also uses.');
      return;
    }
    const orderId = chosenOrderId;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      if (keyRef.current === null || keyRef.current.orderId !== orderId) keyRef.current = { key: ulid(), orderId };
      const result = await fetchApiAcceptBlindReturn(tenantId, rma.id, orderId, keyRef.current.key);
      notifyReturnsChanged();
      onSettled({ tone: 'accepted', ...blindAcceptedOutcome(result, skuCode) }, false);
    } catch (error) {
      const reason = blindReviewReason(error);
      if (blindReviewRefusalReloads(error)) {
        onSettled({ tone: 'rejected', word: 'Not accepted', reason }, true);
      } else {
        setProblem(reason);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label={`Accept ${rma.code}`} className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3 text-xs">
      <div className="font-medium">Accept {rma.code} — link it to an order?</div>
      {suggestedOrderId !== null && (
        <label className="flex items-center gap-2">
          <input type="radio" name={groupName} checked={choice === 'suggested'} onChange={() => setChoice('suggested')} disabled={busy} />
          <span>
            The suggested order <SuggestedOrderLabel orderId={suggestedOrderId} />
            {rma.matchKind !== null && rma.matchKind !== undefined && <span className="text-(--muted-foreground)"> ({MATCH_KIND_LABEL[rma.matchKind]})</span>}
          </span>
        </label>
      )}
      <label className="flex items-center gap-2">
        <input type="radio" name={groupName} checked={choice === 'other'} onChange={() => setChoice('other')} disabled={busy} />
        <span>Another order, by its reference</span>
      </label>
      {choice === 'other' && (
        <div className="flex flex-col gap-1 pl-5">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              aria-label="Order reference"
              placeholder="Client order number or channel reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              className={`${inputClass} max-w-xs py-1`}
              disabled={busy}
            />
            <button type="button" className={buttonClass} onClick={() => void runSearch()} disabled={busy}>
              Search
            </button>
          </div>
          {search.state === 'loading' && <div className="text-(--muted-foreground)">Searching…</div>}
          {search.state === 'failed' && <div className="text-(--muted-foreground)">Search failed — {search.reason}</div>}
          {search.state === 'ready' && search.items.length === 0 && (
            <div className="text-(--muted-foreground)">No dispatched order of this client in this warehouse has that reference.</div>
          )}
          {search.state === 'ready' &&
            search.items.map((order) => (
              <label key={order.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${groupName}-order`}
                  checked={picked === order.id}
                  onChange={() => setPicked(order.id)}
                  disabled={busy}
                />
                <span className="font-mono">{orderLabel(order)}</span>
              </label>
            ))}
        </div>
      )}
      <label className="flex items-center gap-2">
        <input type="radio" name={groupName} checked={choice === 'none'} onChange={() => setChoice('none')} disabled={busy} />
        <span>No order</span>
      </label>
      {choice === 'none' && <div className="pl-5 text-(--muted-foreground)">{NO_ORDER_WARNING}</div>}
      {chosenOrderId !== null && <LinkPreview key={chosenOrderId} orderId={chosenOrderId} rma={rma} skuCode={skuCode} />}
      {prompted && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} aria-label="Confirm the client" />
          <span>{clientPromptedConfirmLabel(clientName)}</span>
        </label>
      )}
      {problem !== null && (
        <div role="alert" className="text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} disabled={busy || (prompted && !confirmed)} onClick={() => void accept()}>
          {busy ? 'Accepting…' : 'Accept'}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}

/** Which lines an accept with this order will link — the existing returnable read, previewed (the response rules). */
function LinkPreview({
  orderId,
  rma,
  skuCode,
}: {
  orderId: string;
  rma: ReturnAuthorizationDto;
  skuCode: (skuId: string) => string | null;
}) {
  const returnable = useReturnable(orderId);
  if (returnable.state === 'loading') return <div className="text-(--muted-foreground)">Reading what the order can still take back…</div>;
  if (returnable.state === 'failed') return <div className="text-(--muted-foreground)">Couldn’t preview the links — {returnable.reason}</div>;
  const preview = previewBlindLinks(rma.lines, returnable.data);
  return (
    <div className="flex flex-col gap-0.5" data-testid="link-preview">
      <div className="text-(--muted-foreground)">Lines this order can take back (the server decides on Accept):</div>
      <ul className="flex flex-col gap-0.5 pl-3">
        {preview.map((line) => (
          <li key={line.rmaLineId}>
            <span className="font-mono">{skuCode(line.skuId) ?? line.skuId}</span> × <span className="data">{line.qty}</span> —{' '}
            {line.links ? 'links to the order' : 'stays unlinked (no order line can take it)'}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RejectDialog({
  tenantId,
  rma,
  preset,
  againstCode,
  onCancel,
  onSettled,
}: {
  tenantId: string;
  rma: ReturnAuthorizationDto;
  preset: RejectDraft;
  againstCode: string | null;
  onCancel: () => void;
  onSettled: (outcome: Outcome, reload: boolean) => void;
}) {
  const [draft, setDraft] = useState<RejectDraft>(preset);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // The key belongs to the confirmation and its body: reused by a retry of the same body, new after an edit.
  const keyRef = useRef<{ key: string; body: string } | null>(null);

  async function reject() {
    if (inFlight.current) return;
    const parsed = parseRejectDraft(draft);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const bodyKey = JSON.stringify(parsed.body);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      if (keyRef.current === null || keyRef.current.body !== bodyKey) keyRef.current = { key: ulid(), body: bodyKey };
      const result = await fetchApiRejectBlindReturn(tenantId, rma.id, parsed.body, keyRef.current.key);
      notifyReturnsChanged();
      onSettled({ tone: 'accepted', ...blindRejectedOutcome(result) }, false);
    } catch (error) {
      const reason = blindReviewReason(error);
      if (blindReviewRefusalReloads(error)) {
        onSettled({ tone: 'rejected', word: 'Not rejected', reason }, true);
      } else {
        setProblem(reason);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label={`Reject ${rma.code}`} className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3 text-xs">
      <div className="font-medium">Reject {rma.code} — its units are reversed out of the Returns bin.</div>
      <label className="flex w-fit flex-col gap-1">
        <span className="text-(--muted-foreground)">Reason</span>
        <select
          aria-label="Reject reason"
          className={`${selectClass} w-auto py-1`}
          value={draft.reasonCode}
          disabled={busy}
          onChange={(e) => {
            setDraft({ ...draft, reasonCode: e.target.value as RejectReasonCode | '' });
            setProblem(null);
          }}
        >
          <option value="">Pick a reason</option>
          {REJECT_REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {draft.reasonCode === 'not-our-goods' && (
        <div className="text-(--muted-foreground)" data-testid="not-our-goods-hint">
          {NOT_OUR_GOODS_HINT}.
        </div>
      )}
      {draft.reasonCode === 'duplicate' && againstCode !== null && (
        <div className="text-(--muted-foreground)" data-testid="received-against-hint">
          Receive these units against {againstCode} on the handheld.
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-(--muted-foreground)">Note{draft.reasonCode === 'other' ? ' (required)' : ' (optional)'}</span>
        <textarea
          aria-label="Reject note"
          maxLength={MAX_REJECT_NOTE_LENGTH}
          rows={2}
          value={draft.note}
          disabled={busy}
          onChange={(e) => {
            setDraft({ ...draft, note: e.target.value });
            setProblem(null);
          }}
          className={`${inputClass} max-w-md py-1`}
        />
      </label>
      {problem !== null && (
        <div role="alert" className="text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} disabled={busy} onClick={() => void reject()}>
          {busy ? 'Rejecting…' : 'Reject and reverse'}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
