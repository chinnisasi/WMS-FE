import { describe, expect, test } from 'bun:test';

import { parseDrill } from './drill';
import {
  DEFAULT_INBOUND_TAB,
  INBOUND_TABS,
  inboundQcHoldsHref,
  inboundTabHref,
  initialInboundTab,
  parseInboundQcGrn,
  parseInboundTab,
  sumTabCounts,
  tabCountLabel,
} from './inbound-tabs';

describe('inbound-tabs', () => {
  test('the five tabs, in page order, with the Purchase orders tab first', () => {
    expect(INBOUND_TABS.map((t) => t.label)).toEqual([
      'Purchase orders',
      'Advance shipment notices',
      'Goods receipts',
      'Awaiting putaway',
      'QC holds',
    ]);
    expect(DEFAULT_INBOUND_TAB).toBe('pos');
  });

  test('?tab= parses a known id; anything else is ignored', () => {
    expect(parseInboundTab({ tab: 'qc-holds' })).toBe('qc-holds');
    expect(parseInboundTab({ tab: 'nope' })).toBeNull();
    expect(parseInboundTab({ tab: ['grns', 'pos'] })).toBeNull();
    expect(parseInboundTab({})).toBeNull();
  });

  test('a tab link is a plain visit, never a drill', () => {
    const params = Object.fromEntries(new URL(`http://x${inboundTabHref('putaway')}`).searchParams);
    expect(parseDrill('inbound', params)).toBeNull();
    expect(parseInboundTab(params)).toBe('putaway');
  });

  test('a drill opens on its own list\'s tab; otherwise the ?tab= pick, else the first tab', () => {
    const grns = parseDrill('inbound', { list: 'grns', blind: 'true' });
    expect(initialInboundTab(grns, 'qc-holds')).toBe('grns');
    expect(initialInboundTab(null, 'qc-holds')).toBe('qc-holds');
    expect(initialInboundTab(null, null)).toBe('pos');
    expect(initialInboundTab('unsupported', null)).toBe('pos');
  });

  test('a count reads N, or N+ when the page had more behind it', () => {
    expect(tabCountLabel({ count: 0, more: false })).toBe('0');
    expect(tabCountLabel({ count: 7, more: false })).toBe('7');
    expect(tabCountLabel({ count: 200, more: true })).toBe('200+');
  });

  test('partial counts sum, and any part with more makes the sum N+', () => {
    expect(sumTabCounts([])).toEqual({ count: 0, more: false });
    expect(sumTabCounts([{ count: 3, more: false }, { count: 4, more: false }])).toEqual({ count: 7, more: false });
    expect(sumTabCounts([{ count: 100, more: true }, { count: 2, more: false }])).toEqual({ count: 102, more: true });
  });

  test('story 1-2b — the QC holds tab narrowed to one receipt: href and parse round-trip; anything malformed opens the whole list', () => {
    const grn = '0198f7a2-1b3c-7d4e-8f90-0000000000b7';
    expect(inboundQcHoldsHref()).toBe('/inbound?tab=qc-holds');
    expect(inboundQcHoldsHref(grn)).toBe(`/inbound?tab=qc-holds&grnId=${grn}`);
    const params = Object.fromEntries(new URLSearchParams(inboundQcHoldsHref(grn).split('?')[1]).entries());
    expect(parseInboundQcGrn(params)).toBe(grn);
    // Not a drill: no `list`, a plain visit.
    expect(parseDrill('inbound', params)).toBeNull();
    expect(parseInboundQcGrn({ tab: 'qc-holds', grnId: 'GRN-0042' })).toBeNull();
    expect(parseInboundQcGrn({ tab: 'qc-holds', grnId: [grn, grn] })).toBeNull();
    expect(parseInboundQcGrn({ tab: 'grns', grnId: grn })).toBeNull();
    expect(parseInboundQcGrn({ tab: 'qc-holds' })).toBeNull();
  });
});
