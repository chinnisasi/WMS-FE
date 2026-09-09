import { WarehouseCreateForm, WarehouseList } from '@/components/settings/warehouse-create-form';
import { DevicesCard } from '@/components/settings/devices-card';
import { ImportCatalogCard } from '@/components/settings/import-catalog';
import { SetupChecklistCard } from '@/components/settings/setup-checklist-card';
import { SkuTableCard } from '@/components/settings/sku-table';
import { UsersCard } from '@/components/settings/users-card';
import { ZonesBinsSetup } from '@/components/settings/zone-bin-setup';
import { SurfacePlaceholder } from '@/components/shell/surface-placeholder';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <section className="flex flex-col gap-6">
      <SurfacePlaceholder
        title="Settings"
        description="Includes device enrollment, the team's users and roles, the warehouse floor setup, the catalog import, and the setup checklist (which aggregates completion state across onboarding stories)."
      />
      <SetupChecklistCard />
      <WarehouseCreateForm />
      <ZonesBinsSetup />
      <ImportCatalogCard />
      <SkuTableCard />
      <UsersCard />
      <WarehouseList />
      <DevicesCard />
    </section>
  );
}