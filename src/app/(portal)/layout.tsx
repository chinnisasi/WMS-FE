import { PortalShell } from '@/components/portal/portal-shell';

/**
 * Story 21-7 — the client portal's route group: its own shell, never the
 * operator `AppShell` (no sidebar, no warehouse switcher, no operator fetch).
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
