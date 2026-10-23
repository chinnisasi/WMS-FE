'use client';

import { useId } from 'react';
import { inputClass, labelClass, selectClass } from '@/components/shared/surface';
import { maxShipByDate } from '@/lib/order-fields';
import type { OrderFieldsDraft } from '@/lib/order-fields-form';

/**
 * Story 4-2a — the order header fields on a create form (the staff create and
 * the portal create share it; `components/shared/` is portal-allowed). The
 * caller owns the draft and its edit wrapper, which must clear the
 * idempotency key (every field joins the backend's request hash when sent).
 * The portal offers Normal and High only (Urgent is the warehouse's).
 */
export function OrderFieldsFieldset({
  draft,
  onDraft,
  todayIst,
  surface,
}: {
  readonly draft: OrderFieldsDraft;
  readonly onDraft: (next: OrderFieldsDraft) => void;
  readonly todayIst: string;
  readonly surface: 'staff' | 'portal';
}) {
  const codHelpId = useId();
  return (
    <fieldset className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" data-testid="order-fields">
      <legend className="sr-only">Order type, priority, ship-by and payment</legend>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Order type</span>
        <select
          className={selectClass}
          value={draft.orderType}
          onChange={(e) => onDraft({ ...draft, orderType: e.target.value as OrderFieldsDraft['orderType'] })}
        >
          <option value="">From the buyer GSTIN</option>
          <option value="b2b">B2B</option>
          <option value="b2c">B2C</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Priority</span>
        <select
          className={selectClass}
          value={draft.priority}
          onChange={(e) => onDraft({ ...draft, priority: e.target.value as OrderFieldsDraft['priority'] })}
        >
          <option value="">Normal</option>
          <option value="high">High</option>
          {surface === 'staff' && <option value="urgent">Urgent</option>}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Ship by (optional)</span>
        <input
          className={inputClass}
          type="date"
          min={todayIst}
          max={maxShipByDate(todayIst)}
          value={draft.shipByDate}
          onChange={(e) => onDraft({ ...draft, shipByDate: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.cod} onChange={(e) => onDraft({ ...draft, cod: e.target.checked })} />
        <span>Cash on delivery</span>
      </label>
      {draft.cod && (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Amount to collect ₹</span>
          <input
            className={inputClass}
            type="text"
            inputMode="decimal"
            value={draft.codRupees}
            onChange={(e) => onDraft({ ...draft, codRupees: e.target.value })}
            placeholder="1499.00"
            aria-describedby={codHelpId}
          />
          <span id={codHelpId} className="text-xs text-(--muted-foreground)">
            What the courier collects — may include shipping and charges.
          </span>
        </label>
      )}
    </fieldset>
  );
}
