import { describe, expect, test } from 'bun:test';

import { parseDrill } from './drill';
import { DEFAULT_INBOUND_TAB, INBOUND_TABS, inboundTabHref, initialInboundTab, parseInboundTab } from './inbound-tabs';

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
});
