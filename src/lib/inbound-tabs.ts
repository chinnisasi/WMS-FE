import type { ParsedDrill, SearchParamsRecord } from '@/lib/drill';
import { definePageTabs } from '@/lib/page-tabs';

/**
 * The Inbound page's tabs (inbound-tabs, 2026-10-17): one card at a time
 * instead of five stacked. Since page-tabs it is one definition on the
 * shared module (`lib/page-tabs.ts`), which holds the parse, href and
 * initial-tab rules for every tabbed page; the count helpers below stay
 * Inbound's own.
 */
export const INBOUND_TABS = [
  // Story 2-3b (decision 10) — the dock calendar comes first (the truck is
  // booked before it arrives); it has no count, and the page still opens on
  // Purchase orders: Dock schedule is `?tab=dock`.
  { id: 'dock', label: 'Dock schedule' },
  // Story 2-3a — the gate-in (the vehicle visit) comes first in the order of
  // the work, but the page still opens on Purchase orders (decision 9):
  // Gate-in is reached at `?tab=gate-ins`.
  { id: 'gate-ins', label: 'Gate-in' },
  { id: 'pos', label: 'Purchase orders' },
  { id: 'asns', label: 'Advance shipment notices' },
  { id: 'grns', label: 'Goods receipts' },
  { id: 'putaway', label: 'Awaiting putaway' },
  { id: 'qc-holds', label: 'QC holds' },
  // Story 2-8b — returns to vendor: DAMAGED stock going back to its vendor.
  { id: 'rtvs', label: 'Returns to vendor' },
] as const;

export type InboundTab = (typeof INBOUND_TABS)[number]['id'];

export const INBOUND_PAGE_TABS = definePageTabs<InboundTab>({
  route: '/inbound',
  label: 'Inbound lists',
  tabs: INBOUND_TABS,
  // A 9-1b drill opens on its own list's tab.
  drillTabs: { grns: 'grns', putaway: 'putaway' },
  // Decision 9 — the bare `/inbound` stays Purchase orders (every existing
  // link and pin is unchanged); Gate-in is `?tab=gate-ins`.
  defaultTab: 'pos',
});

export const DEFAULT_INBOUND_TAB: InboundTab = INBOUND_PAGE_TABS.defaultTab;

export function parseInboundTab(params: SearchParamsRecord): InboundTab | null {
  return INBOUND_PAGE_TABS.parse(params);
}

/**
 * The link that opens Inbound on one tab (the shared href rule: the default
 * tab, Purchase orders, is the bare `/inbound`). `notifications.ts` links QC
 * holds with it.
 */
export function inboundTabHref(tab: InboundTab): string {
  return INBOUND_PAGE_TABS.href(tab);
}

/**
 * The tab a page opens on: a 9-1b drill names its own list's tab
 * (`list=grns` → Goods receipts, `list=putaway` → Awaiting putaway);
 * otherwise the `?tab=` pick, else the default tab (Purchase orders).
 */
export function initialInboundTab(drill: ParsedDrill, tab: InboundTab | null): InboundTab {
  return INBOUND_PAGE_TABS.initial(drill, tab);
}

/**
 * Tab counts (inbound-tabs): the open / actionable items behind each tab —
 * open POs, ASNs still to receive (announced + partially received), tasks
 * awaiting putaway, open QC holds, open returns to vendor (draft + picked —
 * story 2-8b). Goods receipts are history and carry no
 * count. The lists are keyset-paged with no total, so a count is read from
 * one page at the route's maximum size; a full page with more behind it
 * reads "N+" — never a misleadingly small number.
 */
export type CountedInboundTab = Exclude<InboundTab, 'grns' | 'gate-ins' | 'dock'>;

/**
 * Story 2-3a — every tab with a pill: the client-filtered counts above, plus
 * Gate-in, whose count (gate-ins not gated out, one multi-status read) takes
 * NO client — a truck can carry several — and so renders even while the
 * client filter is pending.
 */
export type PilledInboundTab = CountedInboundTab | 'gate-ins';

export interface TabCount {
  readonly count: number;
  /** The page was full and more lie beyond it. */
  readonly more: boolean;
}

export function tabCountLabel(count: TabCount): string {
  return count.more ? `${count.count}+` : String(count.count);
}

/** Sums partial counts (ASNs read per status); `more` if any part had more. */
export function sumTabCounts(parts: readonly TabCount[]): TabCount {
  return {
    count: parts.reduce((sum, part) => sum + part.count, 0),
    more: parts.some((part) => part.more),
  };
}

const QC_GRN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Story 1-2b — the QC holds tab narrowed to one goods receipt's holds
 * (`?tab=qc-holds&grnId=<uuid>`): the `qc-receipt` notification links here.
 * A plain URL parameter beside the tab (guide §1.8), not a drill: no `list`,
 * so `parseDrill` reads a plain visit. Without a GRN it is the tab's link.
 */
export function inboundQcHoldsHref(grnId: string | null = null): string {
  const tab = inboundTabHref('qc-holds');
  return grnId === null ? tab : `${tab}${tab.includes('?') ? '&' : '?'}grnId=${encodeURIComponent(grnId)}`;
}

/**
 * The GRN the QC holds tab opens narrowed to: one well-formed uuid on the QC
 * holds tab, else null (a repeated or malformed value, or another tab, opens
 * the unfiltered list).
 */
export function parseInboundQcGrn(params: SearchParamsRecord): string | null {
  if (parseInboundTab(params) !== 'qc-holds') return null;
  const raw = params['grnId'];
  if (typeof raw !== 'string') return null;
  return QC_GRN_UUID_RE.test(raw) ? raw.toLowerCase() : null;
}
