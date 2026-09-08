import { SurfacePlaceholder } from '@/components/shell/surface-placeholder';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <section className="flex flex-col gap-6">
      <SurfacePlaceholder
        title="Settings"
        description="Includes device enrollment and the setup checklist (which aggregates completion state across onboarding stories)."
      />
      <div className="flex flex-col gap-2 text-sm">
        <div className="rounded-md border border-(--border) p-3">
          <div className="font-medium">Device enrollment</div>
          <div className="text-(--muted-foreground)">Scanner pairing lands in a later epic.</div>
        </div>
        <div className="rounded-md border border-(--border) p-3">
          <div className="font-medium">Setup checklist</div>
          <div className="text-(--muted-foreground)">Steps check off as tenants/bins/catalog/users complete (stories 1.2–1.5).</div>
        </div>
      </div>
    </section>
  );
}
