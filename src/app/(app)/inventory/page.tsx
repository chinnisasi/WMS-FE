import { PageHeader } from '@/components/shared/page-header';
import { InventoryScreen } from '@/components/inventory/inventory-screen';
import { INVENTORY_PAGE_TABS } from '@/lib/page-tabs';
import { parseRecallParam } from '@/lib/recalls';

export const metadata = { title: 'Inventory' };

/**
 * The Inventory page (inventory-screen, 2026-10-17): Stock · Batches ·
 * Ledger behind the shared page tabs. `?tab=<id>` opens one tab and joins the
 * remount key. The page parses no drill — a stray `list=` is ignored; ledger
 * drills (the Overview tile, every "View ledger" link) stay on
 * `/inventory/ledger`, so the key's drill half is always `none`.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tab = INVENTORY_PAGE_TABS.parse(params);
  // Story 3-7a — `?tab=recalls&recall=RCL-000001` opens one recall (a plain URL parameter, the §1.8 rule).
  const recall = tab === 'recalls' ? parseRecallParam(params) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inventory" description="What is on hand, in which bin, for which client — the batches behind it, and the recalls that stop them." />
      <InventoryScreen key={`none|${tab ?? 'default'}${recall === null ? '' : `|${recall}`}`} initialTab={tab} initialRecall={recall} />
    </div>
  );
}
