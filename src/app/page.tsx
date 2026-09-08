import { KpiTile } from '@/components/kpi-tile';
import { DataTable } from '@/components/data-table/data-table';
import { fetchApiHealth } from '@/lib/api/client';

// Health is checked per request — the Overview must reflect the api live.
export const dynamic = 'force-dynamic';

const SURFACE_COLUMNS = [
  { key: 'surface', header: 'Surface' },
  { key: 'story', header: 'Lands in' },
  { key: 'state', header: 'State' },
] as const;

export default async function OverviewPage() {
  let health: string;
  try {
    const h = await fetchApiHealth();
    health = `${h.status} · ${h.service}`;
  } catch {
    health = 'unreachable';
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Overview</h1>
        <p className="mt-1 text-sm text-(--muted-foreground)">
          KPIs reconcile to the ledger (AD-1) — no secondary &quot;estimated&quot; state exists.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Open transactions" value="—" delta="inventory · story 1.4+" />
        <KpiTile label="Inbound pending" value="—" delta="inbound · story 1.2+" />
        <KpiTile label="Conflicts to review" value="—" delta="conflicts · story 1.2+" />
        <KpiTile label="API health" value={health} delta="wms-be /api/v1" />
      </div>

      <DataTable
        columns={[...SURFACE_COLUMNS]}
        rows={[]}
        emptyMessage="List surfaces render via cursor-paginated endpoints in later stories."
      />
    </section>
  );
}