import Link from 'next/link';

import { SurfacePlaceholder } from '@/components/shell/surface-placeholder';

export const metadata = { title: 'Inventory' };

export default function InventoryPage() {
  return (
    <div className="flex flex-col gap-3">
      <SurfacePlaceholder
        title="Inventory"
        description="IA skeleton surface — functionality lands in a later story."
      />
      {/* Story 9-1b — the ledger timeline is the first inventory read on the web. */}
      <p className="text-sm">
        <Link href="/inventory/ledger" className="text-(--primary) underline underline-offset-2">
          Open the Ledger
        </Link>{' '}
        <span className="text-(--muted-foreground)">— every stock movement in a warehouse, newest first.</span>
      </p>
    </div>
  );
}
