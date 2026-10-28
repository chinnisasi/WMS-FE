import { paymentLine, priorityChip, shipByLabel, shipByStatus } from '@/lib/order-fields';
import { StatusChip } from './status-chip';

/**
 * Story 4-2a — the order fields at a glance, shared by every order surface
 * (staff list and detail, the wave picker, picklists, pack and dispatch, the
 * portal). Text always — a chip is never colour alone. `todayIst` is passed
 * in (the IST date of `Date.now()`); the Overdue / Due today word shows only
 * while the order is still to ship (A14).
 */
export function PriorityChip({ priority }: { readonly priority: string | null | undefined }) {
  const chip = priorityChip(priority);
  if (chip === null) return null;
  return (
    <StatusChip tone="warning" data-testid="priority-chip">
      {chip}
    </StatusChip>
  );
}

export function ShipByChip({
  shipByDate,
  todayIst,
  orderStatus,
  open = true,
}: {
  readonly shipByDate: string | null | undefined;
  readonly todayIst: string;
  readonly orderStatus?: string;
  /** False once the work is done (a picklist with nothing left to pick): the date alone, never Overdue / Due today. */
  readonly open?: boolean;
}) {
  if (shipByDate === null || shipByDate === undefined) return null;
  const status = open ? shipByStatus(shipByDate, todayIst, orderStatus) : null;
  return (
    <StatusChip tone={status === null ? 'neutral' : 'warning'} data-testid="ship-by-chip">
      Ship by {open ? shipByLabel(shipByDate, todayIst, orderStatus) : shipByLabel(shipByDate, todayIst, 'dispatched')}
    </StatusChip>
  );
}

/** Priority, ship-by and the payment line in one row. */
export function OrderFieldChips({
  order,
  todayIst,
  showPayment = true,
}: {
  readonly order: {
    readonly priority?: string | null;
    readonly shipByDate?: string | null;
    readonly codAmountPaise?: number | null;
    readonly orderType?: string | null;
    readonly status?: string;
  };
  readonly todayIst: string;
  readonly showPayment?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="order-field-chips">
      <PriorityChip priority={order.priority} />
      <ShipByChip shipByDate={order.shipByDate} todayIst={todayIst} {...(order.status === undefined ? {} : { orderStatus: order.status })} />
      {showPayment && (
        <span className="data text-xs" data-testid="payment-line">
          {paymentLine(order)}
        </span>
      )}
    </span>
  );
}

/**
 * Story 4-2c — the "Backorder" chip on a backorder follow-on (an order a short
 * dispatch opened for the unshipped remainder): `followOnSeq` set. Nothing on
 * a root order. Informational (outline), with its place in the chain in the
 * title. Portal-allowed: no hook.
 */
export function BackorderChip({ followOnSeq }: { readonly followOnSeq?: number | null }) {
  if (followOnSeq === null || followOnSeq === undefined) return null;
  return (
    <StatusChip tone="info" glyph="↳" title={`Backorder ${followOnSeq} — the rest of an order that shipped short`} data-testid="backorder-chip">
      Backorder
    </StatusChip>
  );
}
