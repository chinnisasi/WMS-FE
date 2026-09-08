import { WarehouseCreateForm, WarehouseList } from '@/components/settings/warehouse-create-form';
import { ImportCatalogCard } from '@/components/settings/import-catalog';
import { SetupChecklistCard } from '@/components/settings/setup-checklist-card';
import { SkuTableCard } from '@/components/settings/sku-table';
import { ZonesBinsSetup } from '@/components/settings/zone-bin-setup';
import { SurfacePlaceholder } from '@/components/shell/surface-placeholder';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <section className="flex flex-col gap-6">
      <SurfacePlaceholder
        title="Settings"
        description="Includes device enrollment, the warehouse floor setup, the catalog import, and the setup checklist (which aggregates completion state across onboarding stories)."
      />
      <SetupChecklistCard />
      <WarehouseCreateForm />
      <ZonesBinsSetup />
      <ImportCatalogCard />
      <SkuTableCard />
      <WarehouseList />
      <div className="flex flex-col gap-2 text-sm">
        <div className="rounded-md border border-(--border) p-3">
          <div className="font-medium">Device enrollment</div>
          <div className="text-(--muted-foreground)">Scanner pairing lands in a later epic.</div>
        </div>
      </div>
    </section>
  );
}