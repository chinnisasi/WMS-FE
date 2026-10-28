'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { fetchApiCancelOrderWithRestock } from '@/lib/api/client';
import type {
  CancelWithRestockResponse,
  RestockLineDto,
  RestockPlanLineDto,
  RestockedEntryDto,
  SkuResponse,
} from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { notifyOutboundChanged } from '@/lib/outbound';
import {
  cancelWithRestockReason,
  defaultRestockDestination,
  orderStatusLabel,
  parseRestockDestination,
  RESTOCK_BOOKING_WINDOW,
  RESTOCK_DESTINATION_LABEL,
  restockBinOptionLabel,
  restockBinOptions,
  restockLineLabel,
  restockManifestedRefusal,
  restockOutcome,
  restockQuantityLabel,
  restockRecallWarnings,
  restockVoidNotice,
  type OrderStatus,
  type RestockDestination,
} from '@/lib/outbound-orders';
import { useRestockPlan, useOutboundSkus } from '@/lib/use-outbound-orders';
import { useWarehouseBins } from '@/lib/use-inventory';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { Field } from '@/components/shared/field';
import { LoadingStatus, SkeletonBar } from '@/components/shared/skeleton';
import { StatusChip } from '@/components/shared/status-chip';
import { SubmitButton } from '@/components/shared/submit-button';
import { buttonClass, destructiveClass, labelClass, primaryClass, ReadFailure, selectClass } from '@/components/shared/surface';

/** The order the dialog cancels — a snapshot, so a list refetch that drops the row never unmounts the result. */
export interface CancelTarget {
  readonly id: string;
  readonly label: string;
  readonly status: OrderStatus;
}

type SkuMap = Readonly<Record<string, SkuResponse>> | null;

/**
 * Story 4-2b (decision 14, A8, A9) — the one Cancel dialog, shared by the
 * orders list and the pack/dispatch panel. It reads the restock plan and
 * shows what goes back: each draw's SKU, quantity, origin bin, batch and the
 * serials to scan back; the label a confirm voids; a manifested shipment as a
 * refusal with no Confirm (it comes back as a return). The destination is
 * "Back to the bins they were picked from" or "All into one bin" — a packed
 * order, and any plan carrying a recalled lot, opens on one bin and needs
 * that bin before Confirm.
 *
 * The Idempotency-Key is per DRAFT (the ref form): minted only once the
 * inputs parse, reused on a retry of the same destination, cleared the moment
 * the destination or the bin changes. A pre-render double click is a no-op
 * (the synchronous in-flight ref). Esc closes, never while in flight.
 *
 * After the cancel it shows the put-back list from the RESPONSE and the
 * voided label, then Close.
 */
export function CancelOrderDialog({
  tenantId,
  warehouseId,
  order,
  onClose,
}: {
  tenantId: string;
  warehouseId: string;
  order: CancelTarget;
  onClose: () => void;
}) {
  const plan = useRestockPlan(order.id);
  const skus = useOutboundSkus();
  const skuMap: SkuMap = skus.state === 'ready' ? skus.data : null;
  // null: untouched — the default follows the plan (A8).
  const [chosen, setChosen] = useState<RestockDestination | null>(null);
  const [binId, setBinId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CancelWithRestockResponse | null>(null);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);

  const ready = plan.state === 'ready' ? plan.data : null;
  const liveStatus: OrderStatus = ready?.orderStatus ?? order.status;
  const lines = ready?.lines ?? [];
  const destination: RestockDestination = chosen ?? defaultRestockDestination(liveStatus, lines);
  // The bins load only once one bin is the choice.
  const bins = useWarehouseBins(destination === 'bin' && lines.length > 0 ? warehouseId : null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never while in flight: closing would drop the draft's key mid-request.
      if (event.key === 'Escape' && !inFlight.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    root.current?.focus();
  }, []);

  /** The focus trap: Tab and Shift+Tab cycle inside the dialog. */
  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || root.current === null) return;
    const focusable = [
      ...root.current.querySelectorAll<HTMLElement>('select, input, button, [href], [tabindex]:not([tabindex="-1"])'),
    ].filter((el) => !(el as HTMLButtonElement).disabled && el !== root.current);
    if (focusable.length === 0) return;
    const firstEl = focusable[0]!;
    const lastEl = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === firstEl || active === root.current)) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && active === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  }

  /** A changed destination is a different request: the old key must never carry it. */
  function chooseDestination(next: RestockDestination) {
    keyRef.current = null;
    setProblem(null);
    setChosen(next);
  }

  function chooseBin(next: string) {
    keyRef.current = null;
    setProblem(null);
    setBinId(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    // Nothing to put back → nothing to choose: the origin body.
    const parsed = parseRestockDestination(lines.length === 0 ? 'origin' : destination, binId);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const body = JSON.stringify(parsed.body);
    // Minted only now that the inputs parse; reused on a retry of the same body.
    if (keyRef.current === null || keyRef.current.body !== body) keyRef.current = { key: ulid(), body };
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetchApiCancelOrderWithRestock(tenantId, order.id, parsed.body, keyRef.current.key);
      keyRef.current = null;
      if (mounted.current) setResult(response);
      notifyOutboundChanged();
    } catch (error) {
      if (!mounted.current) return;
      setProblem(cancelWithRestockReason(error));
      // The plan may have moved under the refusal (a manifest, a pick that
      // landed mid-cancel): re-read it so the dialog shows the truth.
      plan.reload();
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const title = `Cancel order ${order.label}`;
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={trapTab}
      className="flex max-w-3xl flex-col gap-3 rounded-md border border-(--border) bg-(--background) p-4 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-(--ring)"
      data-testid="cancel-order-dialog"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium">
          Cancel order <span className="font-mono">{order.label}</span>
        </h3>
        <p className="text-xs text-(--muted-foreground)">
          Cancelling releases every hold the order has and books every picked unit back into stock.
        </p>
      </div>

      {result !== null ? (
        <CancelResult response={result} label={order.label} skuMap={skuMap} onClose={onClose} />
      ) : plan.state === 'loading' ? (
        <div className="flex flex-col gap-2" data-testid="restock-plan-loading">
          <LoadingStatus label="Loading what goes back…" />
          <SkeletonBar className="h-3 w-2/3" />
          <SkeletonBar className="h-3 w-1/2" />
          <SkeletonBar className="h-3 w-3/5" />
        </div>
      ) : plan.state === 'failed' ? (
        <div className="flex flex-col gap-2">
          <ReadFailure word="What goes back could not be read" reason={plan.reason} onRetry={plan.reload} />
          <div>
            <button type="button" className={buttonClass} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : liveStatus !== 'accepted' && liveStatus !== 'ready_to_dispatch' ? (
        <div className="flex flex-col gap-2">
          <FeedbackBanner
            tone="warning"
            word={`Order reads ${orderStatusLabel(liveStatus).toLowerCase()}`}
            reason={
              liveStatus === 'cancelled'
                ? 'It was already cancelled — there is nothing left to cancel.'
                : 'It has left the warehouse — when the parcel comes back, receive it as a return.'
            }
          />
          <div>
            <button type="button" className={buttonClass} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : ready !== null && ready.shipment !== null && ready.shipment.status === 'manifested' ? (
        <div className="flex flex-col gap-2" data-testid="restock-manifested">
          <FeedbackBanner tone="rejected" word="Cannot cancel here" reason={restockManifestedRefusal(ready.shipment)} />
          <div>
            <button type="button" className={buttonClass} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
          {lines.length === 0 ? (
            <p className="text-xs text-(--muted-foreground)" data-testid="restock-nothing-picked">
              Nothing has been picked for this order yet — there is nothing to put back.
            </p>
          ) : (
            <PlanLines lines={lines} skuMap={skuMap} />
          )}

          {ready !== null && ready.shipment !== null && ready.shipment.status === 'labelled' && (
            <p
              role="status"
              className="rounded-sm border border-(--warning) bg-(--warning)/10 px-2 py-1 text-xs"
              data-testid="restock-void-notice"
            >
              {restockVoidNotice(ready.shipment)}
            </p>
          )}

          {restockRecallWarnings(lines).map((warning) => (
            <FeedbackBanner key={warning} tone="warning" word="Recalled lot" reason={warning} />
          ))}

          {lines.length > 0 && (
            <fieldset className="flex flex-col gap-2" disabled={busy}>
              <legend className={labelClass}>Where the units go back</legend>
              {(['origin', 'bin'] as const).map((value) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`restock-destination-${order.id}`}
                    value={value}
                    checked={destination === value}
                    onChange={() => chooseDestination(value)}
                  />
                  <span>{RESTOCK_DESTINATION_LABEL[value]}</span>
                </label>
              ))}
              {destination === 'bin' && (
                <div className="flex flex-col gap-1 pl-6 sm:w-96">
                  {bins.state === 'failed' ? (
                    <ReadFailure word="Bins unavailable" reason={bins.reason} onRetry={bins.reload} />
                  ) : (
                    <Field
                      label="Restock bin"
                      hint={
                        liveStatus === 'ready_to_dispatch'
                          ? 'The parcel is at the bench, not in the bins — choose where its units will go.'
                          : 'Storage bins of this warehouse. The bin’s own checks (class, client, room, segregation) decide on Confirm.'
                      }
                    >
                      {(control) => (
                        <select
                          {...control}
                          className={selectClass}
                          value={binId}
                          disabled={bins.state !== 'ready'}
                          onChange={(e) => chooseBin(e.target.value)}
                        >
                          <option value="">{bins.state === 'ready' ? 'Pick a bin…' : 'Loading bins…'}</option>
                          {bins.state === 'ready' &&
                            restockBinOptions(bins.data).map((bin) => (
                              <option key={bin.id} value={bin.id} disabled={bin.blocked}>
                                {restockBinOptionLabel(bin)}
                              </option>
                            ))}
                        </select>
                      )}
                    </Field>
                  )}
                </div>
              )}
            </fieldset>
          )}

          {lines.length > 0 && (
            <p className="text-xs font-medium" data-testid="restock-booking-window">
              {RESTOCK_BOOKING_WINDOW}
            </p>
          )}

          {problem !== null && <FeedbackBanner tone="rejected" word="Not cancelled" reason={problem} />}

          <div className="flex flex-wrap gap-2">
            <SubmitButton
              busy={busy}
              ready={lines.length === 0 || destination === 'origin' || binId !== ''}
              label={lines.length === 0 ? 'Cancel order' : 'Cancel and restock'}
              busyLabel="Cancelling…"
              notReadyReason="Pick the bin every unit goes back to."
              className={destructiveClass}
            />
            <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>
              Keep the order
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** The plan's lines: what goes back, from where, and the serials to scan back. */
function PlanLines({ lines, skuMap }: { lines: readonly RestockPlanLineDto[]; skuMap: SkuMap }) {
  return (
    <div className="overflow-x-auto rounded-sm border border-(--border)">
      <table className="w-full border-collapse text-xs" data-testid="restock-plan-lines">
        <thead className="bg-(--muted)">
          <tr>
            <th scope="col" className="h-8 border-b border-(--border) px-3 text-left font-medium">
              SKU
            </th>
            <th scope="col" className="data h-8 border-b border-(--border) px-3 text-right font-medium">
              To put back
            </th>
            <th scope="col" className="h-8 border-b border-(--border) px-3 text-left font-medium">
              Picked from
            </th>
            <th scope="col" className="h-8 border-b border-(--border) px-3 text-left font-medium">
              Batch
            </th>
            <th scope="col" className="h-8 border-b border-(--border) px-3 text-left font-medium">
              Serials to scan back
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={`${line.orderLineId}|${line.fromBinId}|${line.batchId ?? ''}`}
              className="h-8 border-b border-(--border) last:border-b-0"
              data-testid="restock-plan-line"
            >
              <td className="px-3 py-1">
                <span className="flex flex-col">
                  <span className="font-mono">{line.skuCode}</span>
                  <span className="text-(--muted-foreground)">{line.skuName}</span>
                </span>
              </td>
              <td className="data px-3 py-1 text-right">{restockQuantityLabel(line, skuMap?.[line.skuId])}</td>
              <td className="px-3 py-1 font-mono">{line.fromBinCode}</td>
              <td className="px-3 py-1">
                <span className="flex flex-wrap items-center gap-1">
                  <span className="font-mono">{line.batchCode ?? '—'}</span>
                  {line.recallCode !== null && (
                    <StatusChip tone="danger" glyph="!">
                      Recall {line.recallCode}
                    </StatusChip>
                  )}
                </span>
              </td>
              <td className="px-3 py-1 font-mono">
                {line.serialNumbers.length === 0 ? '—' : line.serialNumbers.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The cancel's answer: the outcome, the put-back list from the response, the voided label, then Close. */
function CancelResult({
  response,
  label,
  skuMap,
  onClose,
}: {
  response: CancelWithRestockResponse;
  label: string;
  skuMap: SkuMap;
  onClose: () => void;
}) {
  const restock = response.restock;
  return (
    <div className="flex flex-col gap-3" data-testid="cancel-order-result">
      <FeedbackBanner {...restockOutcome(response, label)} />
      {restock !== null && restock.lines.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Put back</span>
          <PutBackList lines={restock.lines} skuMap={skuMap} />
          <p className="text-xs font-medium">{RESTOCK_BOOKING_WINDOW}</p>
        </div>
      )}
      {restock !== null && restock.voidedShipment !== null && (
        <p className="text-xs" data-testid="restock-voided-label">
          Label <span className="font-mono">{restock.voidedShipment.carrierName}</span>{' '}
          <span className="font-mono">{restock.voidedShipment.trackingNumber}</span> voided.
        </p>
      )}
      <div>
        <button type="button" className={primaryClass} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** "SKU × qty → bin (batch)" per line, with its serial count and recall, as a list. */
function PutBackList({
  lines,
  skuMap,
}: {
  lines: readonly (RestockLineDto | RestockedEntryDto)[];
  skuMap: SkuMap;
}) {
  return (
    <ul className="flex flex-col gap-1 rounded-sm border border-(--border) p-2 text-xs" data-testid="put-back-list">
      {lines.map((line) => (
        <li
          key={`${line.orderLineId}|${line.toBinId}|${line.batchId ?? ''}`}
          className="flex flex-wrap items-center gap-2"
          data-testid="put-back-line"
        >
          <span className="data font-mono">{restockLineLabel(line, skuMap?.[line.skuId])}</span>
          <span className="text-(--muted-foreground)">{line.skuName}</span>
          {line.serialCount > 0 && (
            <StatusChip tone="neutral">
              {line.serialCount} {line.serialCount === 1 ? 'serial' : 'serials'}
            </StatusChip>
          )}
          {line.recallCode !== null && (
            <StatusChip tone="danger" glyph="!">
              Recall {line.recallCode} — stays blocked
            </StatusChip>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Story 4-2b (A9) — a cancelled order's "Put back" section: what the cancel
 * booked back into stock, per line and bin, read from the restock plan's
 * `restocked` list — so the list stays readable after the dialog closes (the
 * handheld's words and the review queue's guidance point here). Renders
 * nothing for an order the cancel restocked nothing for.
 */
export function PutBackSection({ orderId }: { orderId: string }) {
  const plan = useRestockPlan(orderId);
  const skus = useOutboundSkus();
  const skuMap: SkuMap = skus.state === 'ready' ? skus.data : null;
  if (plan.state === 'loading') return <LoadingStatus label="Loading the put-back list…" />;
  if (plan.state === 'failed') {
    return <ReadFailure word="Put-back list unavailable" reason={plan.reason} onRetry={plan.reload} />;
  }
  const restocked = plan.data.restocked;
  if (restocked.length === 0) return null;
  const at = restocked[0]!.restockedAt;
  return (
    <section
      aria-label="Put back"
      className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--background) p-3"
      data-testid="put-back-section"
    >
      <h3 className="text-xs font-medium">Put back</h3>
      <p className="text-xs text-(--muted-foreground)">
        Booked back into stock when the order was cancelled (
        <time dateTime={at}>{istDateTimeLabel(at)}</time>) — put each unit back in the bin named.
      </p>
      <PutBackList lines={restocked} skuMap={skuMap} />
    </section>
  );
}
