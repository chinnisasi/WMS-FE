import type { OrderShelfLifeDto } from '@/lib/api/generated';
import { formatIstDate } from '@/lib/rate-cards';

/**
 * Story 4-3b — the order detail's "Customer shelf life" section, as words.
 * Every sentence lives here (and is tested), never in JSX.
 */

export type OrderShelfLifeLine = OrderShelfLifeDto['lines'][number];

/** The section renders only when a consignee rule or a client minimum applies. */
export function orderShelfLifeApplies(read: OrderShelfLifeDto): boolean {
  return read.consignee !== null || read.clientMinShelfLifeDays !== null;
}

/** The rule sentence: the consignee's rule (if any) and the client minimum (if any), and the date judged on. */
export function orderShelfLifeRuleText(read: OrderShelfLifeDto): string {
  const parts: string[] = [];
  if (read.consignee !== null) {
    const terms: string[] = [];
    if (read.consignee.minShelfLifeDays !== null) terms.push(`≥ ${read.consignee.minShelfLifeDays} days`);
    if (read.consignee.minShelfLifePercent !== null) terms.push(`≥ ${read.consignee.minShelfLifePercent} % of total shelf life`);
    parts.push(`${read.consignee.name} (${read.consignee.code}) needs ${terms.join(' and ')} left`);
  }
  if (read.clientMinShelfLifeDays !== null) parts.push(`the client's minimum is ${read.clientMinShelfLifeDays} days`);
  const rule = parts.join('; ');
  return `${rule.charAt(0).toUpperCase()}${rule.slice(1)}. If waved today (${formatIstDate(read.judgedOn)}).`;
}

/** One line's figures: what qualifies against what the line holds. */
export function orderShelfLifeLineText(line: OrderShelfLifeLine): string {
  const min = line.effectiveMinDays === null ? '' : ` · needs ≥ ${line.effectiveMinDays} days`;
  const base = line.shelfLifeBaseDays === null ? '' : ` · total shelf life ${line.shelfLifeBaseDays} d`;
  return (
    `${line.skuCode}: ${line.qualifyingOnHand} qualifying on hand (${line.qualifyingUnclaimed} not claimed by other waves) · ${line.reservedQty} reserved` +
    `${line.belowConsigneeMinimumOnHand > 0 ? ` · ${line.belowConsigneeMinimumOnHand} below the consignee's rule` : ''}${min}${base}`
  );
}

/** A7 — what ops does next about a short line. */
export const SHELF_LIFE_RECOVERY =
  'Receive fresher stock and regenerate the wave (cancel this wave first), or cancel the order line. The reserved units stay held until then.';

/** A line's warning, or null when it is covered. Unjudgeable names the SKU and the fix. */
export function orderShelfLifeLineWarning(line: OrderShelfLifeLine): string | null {
  if (!line.judgeable) {
    return `${line.skuCode} has no total shelf life, so the consignee's percent rule cannot be met — set the SKU's total shelf life in the catalog. ${SHELF_LIFE_RECOVERY}`;
  }
  if (line.shortfallQty !== null && line.shortfallQty > 0 && line.shortfallCause !== null) {
    return `${line.shortfallQty} reserved unit(s) planned short — not enough stock meets the shelf-life rule. ${SHELF_LIFE_RECOVERY}`;
  }
  if (line.plannedQty === null && line.qualifyingUnclaimed < line.reservedQty) {
    return `Only ${line.qualifyingUnclaimed} of the ${line.reservedQty} reserved unit(s) have qualifying stock not already claimed — a wave now would plan the rest short. ${SHELF_LIFE_RECOVERY}`;
  }
  return null;
}

/** The section's footnote. */
export const ORDER_SHELF_LIFE_NOTE =
  'Qualifying on hand ignores other orders’ claims; “not claimed” subtracts what open waves already plan to pick. Undated or unattributed stock of a batch-tracked SKU never meets a consignee rule.';
