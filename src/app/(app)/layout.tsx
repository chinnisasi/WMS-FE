import { AppShell } from '@/components/shell/app-shell';

/**
 * App surfaces (Overview, Inventory, … Settings) share the web shell. Auth
 * routes (`/login`, `/register`) live in the sibling `(auth)` group without
 * the sidebar.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}