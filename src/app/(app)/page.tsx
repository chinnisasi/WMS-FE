import { OverviewDashboard } from '@/components/overview/overview-dashboard';
import { fetchApiHealth } from '@/lib/api/client';

// Health is checked per request — the Overview must reflect the api live.
export const dynamic = 'force-dynamic';

/**
 * The Overview (story 9-1). A thin server component: it probes the api's
 * health (a small status line now, no longer a tile) and hands off to the
 * client dashboard, which reads the session, the active warehouse and the
 * per-warehouse KPI tiles.
 */
export default async function OverviewPage() {
  let health: string;
  try {
    // A hung backend must not hold the render — 3s ceiling, then "unreachable".
    const h = await fetchApiHealth({ signal: AbortSignal.timeout(3000) });
    health = `${h.status} · ${h.service}`;
  } catch {
    health = 'unreachable';
  }

  return <OverviewDashboard health={health} />;
}
