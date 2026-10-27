import { PageHeader } from '@/components/shared/page-header';

/**
 * Shared placeholder for the non-functional surface routes (Story 1.1).
 * Later stories fill these in — the IA skeleton just makes them reachable.
 * Story UI-1: it draws the shared `PageHeader`, so Settings reads like
 * every other page.
 */
export function SurfacePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return <PageHeader title={title} description={description} />;
}
