import { SettingsTabs } from '@/components/settings/settings-tabs';
import { SetupChecklistCard } from '@/components/settings/setup-checklist-card';
import { SurfacePlaceholder } from '@/components/shell/surface-placeholder';
import { SETTINGS_PAGE_TABS } from '@/lib/page-tabs';

export const metadata = { title: 'Settings' };

/**
 * page-tabs (2026-10-17) — the header and the setup checklist, then the
 * cards in five grouped tabs (`SettingsTabs`). `?tab=<id>` opens one tab and
 * keys the screen, so following another tab's link remounts on it.
 *
 * Awaiting `searchParams` is load-bearing: it makes `/settings` render per
 * request (it was prerendered). `SettingsTabs` calls `useSearchParams`, which
 * in a PRERENDERED route needs a `<Suspense>` boundary or `next build` fails —
 * so removing the `await` without adding one is unsafe.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const tab = SETTINGS_PAGE_TABS.parse(await searchParams);
  return (
    <section className="flex flex-col gap-6">
      <SurfacePlaceholder
        title="Settings"
        description="Includes device enrollment, the team's users and roles, the warehouse floor setup, the clients whose goods you hold and their rate cards, the business partners (vendors, consignees and transporters) and the clients each trades with, the catalog import, and the setup checklist (which aggregates completion state across onboarding stories)."
      />
      <SetupChecklistCard />
      {/* Settings takes no drill, so the key is the tab alone. */}
      <SettingsTabs key={tab ?? 'default'} initialTab={tab} />
    </section>
  );
}
