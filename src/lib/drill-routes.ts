import type { ReportingDrillDto } from '@/lib/api/generated';
import type { DrillList } from '@/lib/drill';
import type { Capability } from '@/lib/users';

/**
 * Story 9-1 — where a dashboard figure's drill lands on the web; story 9-1b
 * — the link says exactly which list and which warehouse it means.
 *
 * Every Overview figure names the API list behind it (`drill.apiPath`, ids
 * filled in, relative to /api/v1) and the exact query that reproduces it.
 * This is the ONE map from that API route to the screen that shows the same
 * rows. The href carries the drill's FULL query plus two keys of its own:
 *
 *   - `list` — the section discriminator. Three `/compliance` drills share
 *     identical keys (e-way bills, invoices, the manual-pricing share), and
 *     the putaway drill's single key is a subset of the goods-receipt
 *     drill's; without `list` the target could not tell them apart.
 *   - `warehouseId` — taken from a path-scoped apiPath (`…/warehouses/{w}/…`).
 *     The PATH warehouse is the figure's: a query naming a DIFFERENT
 *     warehouse makes the drill unlinkable (null), never a link that reads
 *     another warehouse's rows. The API path was the only
 *     carrier of an outbound or ledger drill's warehouse; dropping it made
 *     the target fall back to whichever warehouse the viewer had active.
 *
 * Matched on the route's suffix with the tenant/warehouse ids stripped. An
 * apiPath this map does not know renders no link (never a guess) — and so
 * do the three outbound fact lists (picklist lines, pack failures, backorder
 * refusals): no web screen shows those rows, and a link to a screen that
 * cannot show the drill would be a claim the page does not keep.
 *
 * The channel-connections drill (`reconciles: false`, an empty query) is the
 * one linked drill with no `list`: `/channels` has a single list and no
 * filter to apply, so it links the bare route.
 */
interface RouteEntry {
  readonly pattern: RegExp;
  readonly route: string;
  readonly screen: string;
  /** The section the screen drills into; null only for the filterless channels link. */
  readonly list: DrillList | null;
  /** A capability the target section needs — no link without it (9-1b decision 5). */
  readonly capability?: Capability;
}

const ROUTES: readonly RouteEntry[] = [
  {
    pattern: /^\/tenants\/[^/]+\/warehouses\/[^/]+\/inventory\/events$/,
    route: '/inventory/ledger',
    screen: 'Ledger',
    list: 'ledger',
  },
  {
    pattern: /^\/tenants\/[^/]+\/warehouses\/[^/]+\/outbound\/orders$/,
    route: '/outbound',
    screen: 'Outbound',
    list: 'orders',
  },
  {
    pattern: /^\/tenants\/[^/]+\/receiving\/over-receipts$/,
    route: '/conflicts',
    screen: 'Conflicts & Reviews',
    list: 'over-receipts',
    capability: 'review.decide',
  },
  { pattern: /^\/tenants\/[^/]+\/receiving\/goods-receipts$/, route: '/inbound', screen: 'Inbound', list: 'grns' },
  { pattern: /^\/tenants\/[^/]+\/putaway\/tasks$/, route: '/inbound', screen: 'Inbound', list: 'putaway' },
  {
    pattern: /^\/tenants\/[^/]+\/replenishment\/batch-alerts$/,
    route: '/replenishment',
    screen: 'Replenishment',
    list: 'batch-alerts',
  },
  { pattern: /^\/tenants\/[^/]+\/channels\/connections$/, route: '/channels', screen: 'Channels', list: null },
  { pattern: /^\/tenants\/[^/]+\/eway\/bills$/, route: '/compliance', screen: 'Compliance', list: 'eway' },
  { pattern: /^\/tenants\/[^/]+\/invoices$/, route: '/compliance', screen: 'Compliance', list: 'invoices' },
];

const PATH_WAREHOUSE = /^\/tenants\/[^/]+\/warehouses\/([^/]+)\//;

function entryFor(apiPath: string): RouteEntry | undefined {
  return ROUTES.find((entry) => entry.pattern.test(apiPath));
}

/** The web route for an API list path, or null when none is known. */
export function webRouteFor(apiPath: string): string | null {
  return entryFor(apiPath)?.route ?? null;
}

/**
 * The tile's href: the screen, then `list`, then the path's warehouse (for a
 * path-scoped drill whose query has none), then the drill's full query in
 * its own key order — stable, so the same figure always links the same URL.
 * Capability-blind; a rendered link goes through `drillLinkHref`.
 */
export function drillHref(drill: Pick<ReportingDrillDto, 'apiPath' | 'query'>): string | null {
  const entry = entryFor(drill.apiPath);
  if (entry === undefined) return null;
  const params = new URLSearchParams();
  if (entry.list !== null) params.set('list', entry.list);
  const pathWarehouse = PATH_WAREHOUSE.exec(drill.apiPath)?.[1];
  if (pathWarehouse !== undefined) {
    const queried = drill.query.warehouseId;
    if (queried !== undefined && queried !== pathWarehouse) return null;
    params.set('warehouseId', pathWarehouse);
  }
  for (const [key, value] of Object.entries(drill.query)) {
    if (key === 'warehouseId' && pathWarehouse !== undefined) continue;
    params.append(key, value);
  }
  const search = params.toString();
  return search.length === 0 ? entry.route : `${entry.route}?${search}`;
}

/**
 * The href a tile RENDERS: `drillHref`, or null when the target section
 * needs a capability the viewer lacks (9-1b decision 5 — the over-receipt
 * tab is gated on `review.decide`, while the Overview is open to every
 * member; a link to a list the viewer cannot see would be a dead end).
 */
export function drillLinkHref(
  drill: Pick<ReportingDrillDto, 'apiPath' | 'query'>,
  can: (capability: Capability) => boolean,
): string | null {
  const entry = entryFor(drill.apiPath);
  if (entry === undefined) return null;
  if (entry.capability !== undefined && !can(entry.capability)) return null;
  return drillHref(drill);
}

/** The link copy for a drill's screen — "Open Outbound" — or null when there is no screen. */
export function drillLinkText(apiPath: string): string | null {
  const entry = entryFor(apiPath);
  return entry === undefined ? null : `Open ${entry.screen}`;
}
