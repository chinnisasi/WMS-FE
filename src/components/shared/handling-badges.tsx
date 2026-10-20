import { handlingBadges, type GoodsTypeView } from '@/lib/goods-type';

/**
 * Story 1-6a — a SKU's handling warnings (fragile, high value, DG, stack
 * limit) as a wrapping group of small badges where goods are handled: the
 * pack bench, the order detail, the picklist. Text, never colour alone; it
 * renders NOTHING when the SKU carries no warning (or is not loaded yet).
 */
export function HandlingBadges({ sku }: { sku: GoodsTypeView | null | undefined }) {
  const badges = handlingBadges(sku);
  if (badges.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1" aria-label={`Handling: ${badges.join(', ')}`}>
      {badges.map((badge) => (
        <span
          key={badge}
          data-handling-badge=""
          className="rounded-sm border border-(--warning) px-1.5 py-0.5 text-[11px] font-medium text-(--warning)"
        >
          {badge}
        </span>
      ))}
    </span>
  );
}
