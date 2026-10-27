import { PageHeader } from '@/components/shared/page-header';
import { Ledger } from '@/components/inventory/ledger';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';

export const metadata = { title: 'Ledger' };

/**
 * The Ledger page (story 9-1b): one warehouse's ledger timeline — the
 * active warehouse's, or an Overview drill's (`list=ledger`, keyed so Clear
 * remounts). Reached from Inventory and from the Overview tiles; no nav entry.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const drill = parseDrill('ledger', await searchParams);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ledger" description="Every stock movement in the order it was recorded — the record every figure reconciles to." />
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <Ledger key={drillKey(drill)} drill={drill} />
    </div>
  );
}
