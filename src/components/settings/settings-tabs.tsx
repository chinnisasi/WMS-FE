'use client';

import { useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { SETTINGS_PAGE_TABS, type SettingsTab } from '@/lib/page-tabs';

import { ClientsCard } from '@/components/settings/clients-card';
import { DevicesCard } from '@/components/settings/devices-card';
import { PartnersCard } from '@/components/settings/partners-card';
import { ImportCatalogCard } from '@/components/settings/import-catalog';
import { NotePolicyCard } from '@/components/settings/note-policy-card';
import { ProductsCard } from '@/components/settings/products-card';
import { RateCardsCard } from '@/components/settings/rate-cards-card';
import { SegregationMatrixCard } from '@/components/settings/segregation-matrix-card';
import { SkuCreateCard } from '@/components/settings/sku-create-card';
import { SkuTableCard } from '@/components/settings/sku-table';
import { UsersCard } from '@/components/settings/users-card';
import { WarehouseCreateForm, WarehouseList } from '@/components/settings/warehouse-create-form';
import { ZonesBinsSetup } from '@/components/settings/zone-bin-setup';
import { PageTabPanel, PageTabStrip, usePageTab } from '@/components/shared/page-tabs';

/**
 * The Settings cards in grouped tabs (page-tabs, user decision
 * 2026-10-17), one group mounted at a time, `?tab=` linkable:
 *   - Warehouses (the default): create form, warehouse list, zones & bins;
 *   - Catalog: import, new SKU (1-4), products, SKUs, segregation matrix;
 *   - Clients: clients, rate cards;
 *   - Partners (story 1-3): the business partner master and its client links;
 *   - Team: users & roles;
 *   - Devices: device enrollment.
 * The header and the setup checklist stay above the bar (`settings/page.tsx`);
 * the checklist's Continue links open the tab holding each step's card.
 *
 * Every card keeps its own session gate and contents; this wrapper renders
 * nothing until the session is known. Settings takes no drill.
 */
export function SettingsTabs({ initialTab = null }: { initialTab?: SettingsTab | null }) {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  return <SettingsTabsKnown initialTab={initialTab} />;
}

function SettingsTabsKnown({ initialTab }: { initialTab: SettingsTab | null }) {
  const [tab, selectTab] = usePageTab(SETTINGS_PAGE_TABS, SETTINGS_PAGE_TABS.initial(null, initialTab), false);
  return (
    <div className="flex flex-col gap-4">
      <PageTabStrip def={SETTINGS_PAGE_TABS} active={tab} drilled={false} onSelect={selectTab} />
      <PageTabPanel def={SETTINGS_PAGE_TABS} active={tab}>
        <div className="flex flex-col gap-6">
          {tab === 'warehouses' && (
            <>
              <WarehouseCreateForm />
              <WarehouseList />
              <ZonesBinsSetup />
            </>
          )}
          {tab === 'catalog' && (
            <>
              <ImportCatalogCard />
              {/* Story 1-4 — single-SKU create, gated on sku.edit inside. */}
              <SkuCreateCard />
              <ProductsCard />
              <SkuTableCard />
              <SegregationMatrixCard />
            </>
          )}
          {tab === 'clients' && (
            <>
              <ClientsCard />
              <RateCardsCard />
              {/* Story 5-6a — the credit-note maker/checker switch (owner changes it). */}
              <NotePolicyCard />
            </>
          )}
          {tab === 'partners' && <PartnersCard />}
          {tab === 'team' && <UsersCard />}
          {tab === 'devices' && <DevicesCard />}
        </div>
      </PageTabPanel>
    </div>
  );
}
