import type { ReportingDrillDto } from '@/lib/api/generated';

/**
 * Story 9-1 — where a dashboard figure's drill lands on the web.
 *
 * Every Overview figure names the API list behind it (`drill.apiPath`, ids
 * filled in, relative to /api/v1) and the exact query that reproduces it.
 * This is the ONE map from that API route to the screen that shows the same
 * rows. The FULL drill query rides into the href as search params now, so
 * story 9-1b only has to teach those screens to READ them — no tile changes.
 *
 * Matched on the route's suffix with the tenant/warehouse ids stripped. An
 * apiPath this map does not know renders no link (never a guess) — and so
 * do the three outbound fact lists (picklist lines, pack failures, backorder
 * refusals): no web screen shows those rows yet, and a link to a screen that
 * cannot show the drill would be a claim the page does not keep.
 */
const ROUTES: readonly { readonly pattern: RegExp; readonly route: string; readonly screen: string }[] = [
  { pattern: /^\/tenants\/[^/]+\/warehouses\/[^/]+\/inventory\/events$/, route: '/inventory', screen: 'Inventory' },
  { pattern: /^\/tenants\/[^/]+\/warehouses\/[^/]+\/outbound\/orders$/, route: '/outbound', screen: 'Outbound' },
  { pattern: /^\/tenants\/[^/]+\/receiving\/over-receipts$/, route: '/conflicts', screen: 'Conflicts & Reviews' },
  { pattern: /^\/tenants\/[^/]+\/receiving\/goods-receipts$/, route: '/inbound', screen: 'Inbound' },
  { pattern: /^\/tenants\/[^/]+\/putaway\/tasks$/, route: '/inbound', screen: 'Inbound' },
  { pattern: /^\/tenants\/[^/]+\/replenishment\/batch-alerts$/, route: '/replenishment', screen: 'Replenishment' },
  { pattern: /^\/tenants\/[^/]+\/channels\/connections$/, route: '/channels', screen: 'Channels' },
  { pattern: /^\/tenants\/[^/]+\/eway\/bills$/, route: '/compliance', screen: 'Compliance' },
  { pattern: /^\/tenants\/[^/]+\/invoices$/, route: '/compliance', screen: 'Compliance' },
];

/** The web route for an API list path, or null when none is known. */
export function webRouteFor(apiPath: string): string | null {
  return ROUTES.find((entry) => entry.pattern.test(apiPath))?.route ?? null;
}

/**
 * The tile's href: the screen plus the drill's full query, in the drill's
 * own key order (stable, so the same figure always links the same URL).
 */
export function drillHref(drill: Pick<ReportingDrillDto, 'apiPath' | 'query'>): string | null {
  const route = webRouteFor(drill.apiPath);
  if (route === null) return null;
  const search = new URLSearchParams(Object.entries(drill.query)).toString();
  return search.length === 0 ? route : `${route}?${search}`;
}

/** The link copy for a drill's screen — "Open Outbound" — or null when there is no screen. */
export function drillLinkText(apiPath: string): string | null {
  const entry = ROUTES.find((candidate) => candidate.pattern.test(apiPath));
  return entry === undefined ? null : `Open ${entry.screen}`;
}
