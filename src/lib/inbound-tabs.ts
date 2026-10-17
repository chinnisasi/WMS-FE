import type { ParsedDrill, SearchParamsRecord } from '@/lib/drill';

/**
 * The Inbound page's tabs (inbound-tabs, 2026-10-17): one card at a time
 * instead of five stacked. `?tab=<id>` opens a tab — a notification's
 * click-through, a shared link, a reload — and is not a drill key: a link
 * carrying it has no `list`, so `parseDrill` reads it as a plain visit.
 * Anything but one known id is ignored (the page opens on the first tab).
 */
export const INBOUND_TABS = [
  { id: 'pos', label: 'Purchase orders' },
  { id: 'asns', label: 'Advance shipment notices' },
  { id: 'grns', label: 'Goods receipts' },
  { id: 'putaway', label: 'Awaiting putaway' },
  { id: 'qc-holds', label: 'QC holds' },
] as const;

export type InboundTab = (typeof INBOUND_TABS)[number]['id'];

export const DEFAULT_INBOUND_TAB: InboundTab = 'pos';

const TAB_IDS: readonly string[] = INBOUND_TABS.map((tab) => tab.id);

export function parseInboundTab(params: SearchParamsRecord): InboundTab | null {
  const value = params.tab;
  return typeof value === 'string' && TAB_IDS.includes(value) ? (value as InboundTab) : null;
}

/** The link that opens Inbound on one tab. */
export function inboundTabHref(tab: InboundTab): string {
  return `/inbound?tab=${tab}`;
}

/**
 * The tab a page opens on: a 9-1b drill names its own list's tab
 * (`list=grns` → Goods receipts, `list=putaway` → Awaiting putaway);
 * otherwise the `?tab=` pick, else the first tab.
 */
export function initialInboundTab(drill: ParsedDrill, tab: InboundTab | null): InboundTab {
  if (drill !== null && drill !== 'unsupported') {
    if (drill.list === 'grns') return 'grns';
    if (drill.list === 'putaway') return 'putaway';
  }
  return tab ?? DEFAULT_INBOUND_TAB;
}

/**
 * Tab counts (inbound-tabs): the open / actionable items behind each tab —
 * open POs, ASNs still to receive (announced + partially received), tasks
 * awaiting putaway, open QC holds. Goods receipts are history and carry no
 * count. The lists are keyset-paged with no total, so a count is read from
 * one page at the route's maximum size; a full page with more behind it
 * reads "N+" — never a misleadingly small number.
 */
export type CountedInboundTab = Exclude<InboundTab, 'grns'>;

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
