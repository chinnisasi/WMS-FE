import { describe, expect, test } from 'bun:test';

import { CONFLICTS_QUEUES, parseQueueParam } from './conflicts-queues';
import { parseDrill, type DrillScreen } from './drill';
import { parseInboundQcGrn, parseInboundTab } from './inbound-tabs';
import { COMPLIANCE_PAGE_TABS } from './page-tabs';
import {
  bellLabel,
  knownNotifications,
  istTimeLabel,
  notificationCategory,
  notificationDescription,
  notificationHref,
  notificationResolvedLabel,
  relativeTimeLabel,
  type NotificationEntry,
  type NotificationLookups,
} from './notifications';

const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccdd01';
const SKU = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const UNKNOWN_SKU = '0198f7a2-1b3c-7d4e-8f90-0000000000ff';
const CONNECTION = '0198f7a2-1b3c-7d4e-8f90-00000000c0de';
const RAISED = '2026-10-06T04:30:00.000Z';
const GRN = '0198f7a2-1b3c-7d4e-8f90-0000000000b7';
const LICENCE = '0198f7a2-1b3c-7d4e-8f90-0000000001c0';

const LOOKUPS: NotificationLookups = {
  sku: (id) => (id === SKU ? { code: 'SPICE-01', uom: 'kg', uomPrecision: 3 } : null),
  warehouse: (id) => (id === W ? 'MAIN Chennai DC' : `Warehouse ${id.slice(0, 8)}`),
};

const base = { id: 'n-1', sourceId: '0198f7a2-1b3c-7d4e-8f90-000000000001', raisedAt: RAISED, resolvedAt: null, resolution: null } as const;

/** One OPEN entry per source — the union arms, as the API serves them. */
const ENTRIES: Readonly<Record<NotificationEntry['sourceType'], NotificationEntry>> = {
  'stock-adjustment': { ...base, sourceType: 'stock-adjustment', warehouseId: W, summary: { skuId: SKU, quantityDelta: -2.5, reasonCode: 'damaged' } },
  'count-variance': { ...base, sourceType: 'count-variance', warehouseId: W, summary: { skuId: SKU, delta: 7 } },
  'over-receipt': { ...base, sourceType: 'over-receipt', warehouseId: W, summary: { grnCode: 'GRN-0042', skuId: SKU, excessQty: 3 } },
  'rejected-op': { ...base, sourceType: 'rejected-op', warehouseId: null, summary: { opType: 'pick.record', problemCode: 'pick-bin-short' } },
  'reorder-breach': { ...base, sourceType: 'reorder-breach', warehouseId: W, summary: { skuId: SKU, atpQty: 1.5, pointQty: 4 } },
  'batch-alert': { ...base, sourceType: 'batch-alert', warehouseId: W, summary: { kind: 'aged', skuId: SKU, batchCode: 'LOT-7', ageDays: 40 } },
  'qc-hold': { ...base, sourceType: 'qc-hold', warehouseId: W, summary: { skuId: SKU, reason: 'Seal broken' } },
  'channel-sync': { ...base, sourceType: 'channel-sync', warehouseId: null, summary: { connectionId: CONNECTION } },
  'audit-export': { ...base, sourceType: 'audit-export', warehouseId: null, summary: { status: 'ready', rowCount: 102345 } },
  'ledger-chain-break': {
    ...base,
    sourceType: 'ledger-chain-break',
    warehouseId: W,
    summary: { kind: 'chain', firstSeq: 1042, reason: 'hash mismatch at seq 1042', detectedBy: 'anchor' },
  },
  // Story 1-2b — one entry per receipt of a QC-on-receipt client.
  'qc-receipt': { ...base, sourceType: 'qc-receipt', warehouseId: W, summary: { grnId: GRN, grnCode: 'GRN-0042', count: 3 } },
  // Story 1-6c — a client's premises licence nearing expiry.
  'licence-expiry': {
    ...base,
    sourceType: 'licence-expiry',
    warehouseId: W,
    summary: { licenceId: LICENCE, kind: 'drug-20g', number: 'MH/PUN/20G-1', holder: 'client', holderName: 'Acme Foods', siteCode: 'WH-PUN', validUntil: '2026-12-31', state: 'upcoming' },
  },
};

function resolved(entry: NotificationEntry, resolution: string): NotificationEntry {
  return { ...entry, resolvedAt: '2026-10-06T05:00:00.000Z', resolution } as NotificationEntry;
}

describe('notification copy', () => {
  test('a category per source (the batch alert by its kind)', () => {
    expect(Object.values(ENTRIES).map(notificationCategory)).toEqual([
      'Adjustment awaiting approval',
      'Count variance over threshold',
      'Over-receipt awaiting approval',
      'Device op rejected',
      'Reorder point breached',
      'Aged batch',
      'QC hold placed',
      'Channel sync failing',
      'Audit export',
      'Ledger integrity',
      'Held for QC on receipt',
      'Licence expiring',
    ]);
    const expiring = { ...ENTRIES['batch-alert'], summary: { kind: 'expiry_upcoming', skuId: SKU, batchCode: 'LOT-8', expiryDate: '2026-10-20T18:30:00.000Z' } } as NotificationEntry;
    expect(notificationCategory(expiring)).toBe('Batch nearing expiry');
  });

  test('a one-line description from the summary: SKU code, quantities at the unit’s precision, the warehouse label', () => {
    expect(Object.values(ENTRIES).map((entry) => notificationDescription(entry, LOOKUPS))).toEqual([
      'SPICE-01 · −2.500 kg · damaged · MAIN Chennai DC',
      'SPICE-01 · counted +7.000 kg · MAIN Chennai DC',
      'GRN-0042 · SPICE-01 · 3.000 kg over · MAIN Chennai DC',
      'pick.record · pick-bin-short',
      'SPICE-01 · ATP 1.500 kg below 4.000 kg · MAIN Chennai DC',
      'SPICE-01 · batch LOT-7 · 40 days old · MAIN Chennai DC',
      'SPICE-01 · Seal broken · MAIN Chennai DC',
      'Connection 0198f7a2 — deliveries are failing',
      'Audit export ready — 1,02,345 events',
      'Ledger chain broken at #1042 — MAIN Chennai DC',
      'GRN-0042: 3 lines held for QC on receipt · MAIN Chennai DC',
      'Form 20G MH/PUN/20G-1 — Acme Foods at WH-PUN · valid until 31 Dec 2026',
    ]);
    // The expiry arm names the IST date (18:30Z is the next IST day).
    const expiring = { ...ENTRIES['batch-alert'], summary: { kind: 'expiry_upcoming', skuId: SKU, batchCode: 'LOT-8', expiryDate: '2026-10-20T18:30:00.000Z' } } as NotificationEntry;
    expect(notificationDescription(expiring, LOOKUPS)).toBe('SPICE-01 · batch LOT-8 · expires 21 Oct 2026 · MAIN Chennai DC');
    // Unknown SKU and warehouse degrade to short ids, never a blank.
    const unknown = { ...ENTRIES['qc-hold'], warehouseId: '0198f7a2-ffff-7d4e-8f90-99aabbccdd09', summary: { skuId: UNKNOWN_SKU, reason: 'Wet' } } as NotificationEntry;
    expect(notificationDescription(unknown, LOOKUPS)).toBe('SKU 0198f7a2 · Wet · Warehouse 0198f7a2');
    // Story 1-1: a SKU carrying its client label (several clients) is named with it.
    const labelled: NotificationLookups = {
      ...LOOKUPS,
      sku: (id) => (id === SKU ? { code: 'SPICE-01', label: 'SPICE-01 · ACME', uom: 'kg', uomPrecision: 3 } : null),
    };
    expect(notificationDescription(expiring, labelled)).toBe('SPICE-01 · ACME · batch LOT-8 · expires 21 Oct 2026 · MAIN Chennai DC');
  });

  test('the audit export (9-3b): ready names its events; failed names its reason — every reason has copy', () => {
    const exportEntry = (summary: object) => ({ ...ENTRIES['audit-export'], summary }) as NotificationEntry;
    expect(notificationDescription(exportEntry({ status: 'ready', rowCount: 1 }), LOOKUPS)).toBe('Audit export ready — 1 event');
    expect(notificationDescription(exportEntry({ status: 'failed', reason: 'too-many-events' }), LOOKUPS)).toBe(
      'Audit export failed — too many events; narrow the filters or dates',
    );
    expect(notificationDescription(exportEntry({ status: 'failed', reason: 'interrupted' }), LOOKUPS)).toBe('Audit export failed — interrupted; run it again');
    expect(notificationDescription(exportEntry({ status: 'failed', reason: 'export-error' }), LOOKUPS)).toBe(
      'Audit export failed — something went wrong; run it again',
    );
    expect(notificationResolvedLabel(resolved(ENTRIES['audit-export'], 'expired'))).toBe('Resolved · expired');
  });

  test('the ledger chain break (9-3c): a chain break and a WORM mismatch name the seq and the warehouse; it resolves acknowledged', () => {
    const worm = { ...ENTRIES['ledger-chain-break'], summary: { kind: 'worm', firstSeq: 1, reason: 'WORM copy missing', detectedBy: 'reverify' } } as NotificationEntry;
    expect(notificationDescription(worm, LOOKUPS)).toBe('WORM copy mismatch at #1 — MAIN Chennai DC');
    const elsewhere = { ...ENTRIES['ledger-chain-break'], warehouseId: '0198f7a2-ffff-7d4e-8f90-99aabbccdd09' } as NotificationEntry;
    expect(notificationDescription(elsewhere, LOOKUPS)).toBe('Ledger chain broken at #1042 — Warehouse 0198f7a2');
    expect(notificationResolvedLabel(resolved(ENTRIES['ledger-chain-break'], 'acknowledged'))).toBe('Resolved · acknowledged');
  });

  test('the QC-on-receipt entry (1-2b): one line per receipt, singular for one line; it resolves released', () => {
    const one = { ...ENTRIES['qc-receipt'], warehouseId: null, summary: { grnId: GRN, grnCode: 'GRN-0007', count: 1 } } as NotificationEntry;
    expect(notificationDescription(one, LOOKUPS)).toBe('GRN-0007: 1 line held for QC on receipt');
    expect(notificationResolvedLabel(resolved(ENTRIES['qc-receipt'], 'released'))).toBe('Resolved · released');
    // Story 2-8a — a placement whose last hold closed by inspection; a manual hold inspected.
    expect(notificationResolvedLabel(resolved(ENTRIES['qc-receipt'], 'inspected'))).toBe('Resolved · inspected');
    expect(notificationResolvedLabel(resolved(ENTRIES['qc-hold'], 'inspected'))).toBe('Resolved · inspected');
  });

  test('the licence expiry (1-6c): the expired state, a head-office and a site licence; it resolves renewed, withdrawn or expired', () => {
    const licence = (summary: object) => ({ ...ENTRIES['licence-expiry'], summary: { ...ENTRIES['licence-expiry'].summary, ...summary } }) as NotificationEntry;
    const expired = licence({ state: 'expired', validUntil: '2026-10-31' });
    expect(notificationCategory(expired)).toBe('Licence expired');
    expect(notificationDescription(expired, LOOKUPS)).toBe('Form 20G MH/PUN/20G-1 — Acme Foods at WH-PUN · expired 31 Oct 2026');
    const headOffice = { ...ENTRIES['licence-expiry'], warehouseId: null, summary: { licenceId: LICENCE, kind: 'fssai-central', number: '10012345678901', holder: 'client', holderName: 'Acme Foods', validUntil: '2027-03-31', state: 'upcoming' } } as NotificationEntry;
    expect(notificationDescription(headOffice, LOOKUPS)).toBe('FSSAI central licence 10012345678901 — Acme Foods · valid until 31 Mar 2027');
    const site = licence({ holder: 'site', holderName: 'Pune DC', kind: 'fssai-registration', number: '20012345678901' });
    expect(notificationDescription(site, LOOKUPS)).toBe('FSSAI registration 20012345678901 — site WH-PUN · valid until 31 Dec 2026');
    for (const outcome of ['renewed', 'withdrawn', 'expired']) {
      expect(notificationResolvedLabel(resolved(ENTRIES['licence-expiry'], outcome))).toBe(`Resolved · ${outcome}`);
    }
  });

  test('resolved: null while open; "Resolved · {resolution}" once cleared', () => {
    expect(notificationResolvedLabel(ENTRIES['over-receipt'])).toBeNull();
    expect(notificationResolvedLabel(resolved(ENTRIES['over-receipt'], 'approved'))).toBe('Resolved · approved');
    expect(notificationResolvedLabel(resolved(ENTRIES['reorder-breach'], 'policy-removed'))).toBe('Resolved · policy removed');
    expect(notificationResolvedLabel(resolved(ENTRIES['channel-sync'], 'disconnected'))).toBe('Resolved · disconnected');
    // Never the tautology "Resolved · resolved" (a batch alert's stock ran out).
    expect(notificationResolvedLabel(resolved(ENTRIES['batch-alert'], 'resolved'))).toBe('Resolved · cleared');
  });

  test('relative time from the fetch instant, the IST absolute instant for its title, the bell’s accessible name', () => {
    const at = Date.parse(RAISED);
    expect(relativeTimeLabel(RAISED, at + 30_000)).toBe('just now');
    expect(relativeTimeLabel(RAISED, at - 5_000)).toBe('just now');
    expect(relativeTimeLabel(RAISED, at + 5 * 60_000)).toBe('5 min ago');
    expect(relativeTimeLabel(RAISED, at + 3 * 3_600_000 + 1)).toBe('3 h ago');
    expect(relativeTimeLabel(RAISED, at + 50 * 3_600_000)).toBe('2 d ago');
    expect(istTimeLabel(RAISED)).toBe('06 Oct 2026, 10:00 IST');
    expect(bellLabel(false)).toBe('Notifications');
    expect(bellLabel(true)).toBe('Notifications, new');
  });
});

describe('click-through links', () => {
  test('each source opens its screen: open and resolved', () => {
    const expected: Record<NotificationEntry['sourceType'], [string, string]> = {
      'over-receipt': [`/conflicts?list=over-receipts&warehouseId=${W}&status=pending`, `/conflicts?list=over-receipts&warehouseId=${W}`],
      'batch-alert': [`/replenishment?list=batch-alerts&warehouseId=${W}&kind=aged`, `/replenishment?list=batch-alerts&warehouseId=${W}&kind=aged`],
      'stock-adjustment': ['/conflicts?queue=adjustment-pendings', '/conflicts?queue=adjustment-pendings'],
      'count-variance': ['/conflicts?queue=variances', '/conflicts?queue=variances'],
      'rejected-op': ['/conflicts?queue=rejected-ops', '/conflicts?queue=rejected-ops'],
      'reorder-breach': ['/replenishment', '/replenishment'],
      'qc-hold': ['/inbound?tab=qc-holds', '/inbound?tab=qc-holds'],
      'channel-sync': ['/channels', '/channels'],
      // Story 9-3b — the "Your exports" list, never a download.
      'audit-export': ['/reports#audit-exports', '/reports#audit-exports'],
      // Story 9-3c — the Ledger integrity section.
      'ledger-chain-break': ['/reports#ledger-integrity', '/reports#ledger-integrity'],
      // Story 1-2b — the QC holds tab narrowed to the receipt.
      'qc-receipt': [`/inbound?tab=qc-holds&grnId=${GRN}`, `/inbound?tab=qc-holds&grnId=${GRN}`],
      // Story 1-6c — Compliance → Licences.
      'licence-expiry': ['/compliance?tab=licences', '/compliance?tab=licences'],
    };
    for (const [sourceType, entry] of Object.entries(ENTRIES)) {
      const [open, done] = expected[sourceType as NotificationEntry['sourceType']];
      expect(notificationHref(entry)).toBe(open);
      expect(notificationHref(resolved(entry, 'x'))).toBe(done);
    }
    // An over-receipt raised before its event carried a warehouse.
    expect(notificationHref({ ...ENTRIES['over-receipt'], warehouseId: null } as NotificationEntry)).toBe('/conflicts?list=over-receipts&status=pending');
  });

  test('every drill link parses under 9-1b’s parseDrill — a typed drill on its screen, never unsupported', () => {
    const screenOf: Record<string, DrillScreen> = { '/conflicts': 'conflicts', '/replenishment': 'replenishment' };
    const expiring = { ...ENTRIES['batch-alert'], summary: { kind: 'expiry_upcoming', skuId: SKU, batchCode: 'LOT-8', expiryDate: '2026-10-20T18:30:00.000Z' } } as NotificationEntry;
    const all = [
      ...Object.values(ENTRIES),
      ...Object.values(ENTRIES).map((entry) => resolved(entry, 'x')),
      expiring,
      { ...ENTRIES['over-receipt'], warehouseId: null } as NotificationEntry,
    ];
    let drills = 0;
    let queues = 0;
    for (const entry of all) {
      const href = notificationHref(entry);
      const [path, query] = href.split('?') as [string, string | undefined];
      if (query === undefined) continue;
      const params = Object.fromEntries(new URLSearchParams(query).entries());
      if (params.list === undefined && path === '/inbound') {
        // inbound-tabs — a tab link: not a drill, and a tab Inbound knows.
        expect(parseDrill('inbound', params)).toBeNull();
        expect(parseInboundTab(params)).not.toBeNull();
        if (entry.sourceType === 'qc-hold') expect(parseInboundTab(params)).toBe('qc-holds');
        if (entry.sourceType === 'qc-receipt') {
          expect(parseInboundTab(params)).toBe('qc-holds');
          expect(parseInboundQcGrn(params)).toBe(GRN);
        }
        continue;
      }
      if (params.list === undefined && path === '/compliance') {
        // page-tabs — a tab link (1-6c's Licences): not a drill, a tab Compliance knows.
        expect(parseDrill('compliance', params)).toBeNull();
        expect(COMPLIANCE_PAGE_TABS.parse(params)).toBe('licences');
        continue;
      }
      if (params.list === undefined) {
        queues += 1;
        // A queue link: not a drill (parseDrill reads a plain visit), and
        // the queue is one Conflicts & Reviews knows.
        expect(path).toBe('/conflicts');
        expect(parseDrill('conflicts', params)).toBeNull();
        expect(CONFLICTS_QUEUES as readonly (string | null)[]).toContain(parseQueueParam(params));
        continue;
      }
      drills += 1;
      const drill = parseDrill(screenOf[path]!, params);
      expect(drill).not.toBeNull();
      expect(drill).not.toBe('unsupported');
      expect(typeof drill === 'object' && drill !== null ? drill.list : null).toBe(params.list as never);
    }
    expect(drills).toBe(6);
    expect(queues).toBe(6);
    expect(parseDrill('conflicts', Object.fromEntries(new URLSearchParams(notificationHref(ENTRIES['over-receipt']).split('?')[1]).entries()))).toEqual({
      list: 'over-receipts',
      warehouseId: W,
      status: 'pending',
    });
  });
});

describe('a source this build does not know (a newer backend)', () => {
  const future = { ...base, sourceType: 'task-assignment', warehouseId: W, summary: { taskId: 'x' } };

  test('knownNotifications drops it and keeps every known arm, in order', () => {
    const items = [ENTRIES['qc-hold'], future, ENTRIES['channel-sync'], null, 'junk'];
    expect(knownNotifications(items)).toEqual([ENTRIES['qc-hold'], ENTRIES['channel-sync']]);
  });

  test('the switches never crash on it: a generic category, no description, the list page', () => {
    const entry = future as unknown as NotificationEntry;
    expect(notificationCategory(entry)).toBe('Notification');
    expect(notificationDescription(entry, LOOKUPS)).toBe('');
    expect(notificationHref(entry)).toBe('/notifications');
  });

  test('the ?queue= parameter: only a known queue id, one value', () => {
    expect(parseQueueParam({ queue: 'variances' })).toBe('variances');
    expect(parseQueueParam({ queue: 'nope' })).toBeNull();
    expect(parseQueueParam({ queue: ['variances', 'rejected-ops'] })).toBeNull();
    expect(parseQueueParam({})).toBeNull();
    // A queue link beside a drill list is not a lawful drill (unknown key).
    expect(parseDrill('conflicts', { list: 'over-receipts', queue: 'variances' })).toBe('unsupported');
  });
});
