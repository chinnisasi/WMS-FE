'use client';

import { FeedbackBanner } from '@/components/feedback/banner';
import { LoadingStatus } from '@/components/shared/skeleton';
import { ReadFailure } from '@/components/shared/surface';
import {
  ORDER_SHELF_LIFE_NOTE,
  orderShelfLifeApplies,
  orderShelfLifeLineText,
  orderShelfLifeLineWarning,
  orderShelfLifeResolutionText,
  orderShelfLifeRuleText,
} from '@/lib/order-shelf-life';
import { useOrderShelfLife } from '@/lib/use-outbound-orders';

/**
 * Story 4-3b (decision 8) — the order detail's "Customer shelf life" section:
 * the rule that applies (the consignee's, resolved from the order's GSTIN,
 * and the client minimum) and, per line, qualifying vs reserved stock if it
 * were waved today, a shortfall warning with what to do next (A7), and an
 * unjudgeable line's fix; for an order naming a GSTIN that matched no rule,
 * one muted line saying why. Renders nothing for an order with no GSTIN and
 * no client minimum (or a backend that predates the read — a 404).
 */
export function CustomerShelfLifeSection({ orderId }: { orderId: string }) {
  const read = useOrderShelfLife(orderId);
  if (read.state === 'loading') return <LoadingStatus label="Loading the customer shelf life…" />;
  if (read.state === 'failed') {
    return <ReadFailure word="Customer shelf life unavailable" reason={read.reason} onRetry={read.reload} />;
  }
  if (read.data === null || !orderShelfLifeApplies(read.data)) return null;
  const rule = orderShelfLifeRuleText(read.data);
  const resolution = orderShelfLifeResolutionText(read.data);
  return (
    <section
      aria-label="Customer shelf life"
      className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--background) p-3"
      data-testid="customer-shelf-life"
    >
      <h3 className="text-xs font-medium">Customer shelf life</h3>
      {rule !== null && (
        <p className="text-xs" data-testid="customer-shelf-life-rule">
          {rule}
        </p>
      )}
      {resolution !== null && (
        <p className="text-xs text-(--muted-foreground)" data-testid="customer-shelf-life-resolution">
          {resolution}
        </p>
      )}
      {rule !== null && (
      <ul className="flex flex-col gap-1">
        {read.data.lines.map((line) => {
          const warning = orderShelfLifeLineWarning(line);
          return (
            <li key={line.orderLineId} className="flex flex-col gap-1 text-xs" data-testid="customer-shelf-life-line">
              <span className="data">{orderShelfLifeLineText(line)}</span>
              {warning !== null && <FeedbackBanner tone="warning" word="Short on shelf life" reason={warning} />}
            </li>
          );
        })}
      </ul>
      )}
      {rule !== null && <p className="text-xs text-(--muted-foreground)">{ORDER_SHELF_LIFE_NOTE}</p>}
    </section>
  );
}
