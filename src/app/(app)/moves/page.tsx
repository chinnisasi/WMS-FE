import { PageHeader } from '@/components/shared/page-header';
import { MovesScreen } from '@/components/moves/moves-screen';

export const metadata = { title: 'Moves' };

/** Story 3-1 — the Moves page: the move form and the recent moves (`components/moves/`). */
export default function MovesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Moves" description="Bin-to-bin moves of stock already in the warehouse." />
      <MovesScreen />
    </div>
  );
}
