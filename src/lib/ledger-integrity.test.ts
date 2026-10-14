import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ChainBreakDto, WarehouseLedgerIntegrityDto } from './api/generated';
import {
  BREAK_KIND_LABEL,
  LEDGER_INTEGRITY_ANCHOR,
  LEDGER_INTEGRITY_ROLE_DENIED,
  breakLabel,
  integrityReason,
  integrityStatus,
  isAlreadyAcknowledged,
  isIntegrityRoleDenied,
  lastAnchorLabel,
  ledgerProofFilename,
  legacyLabel,
  wormLabel,
} from './ledger-integrity';

/** Story 9-3c — the Ledger integrity section's words, pinned. */

const AT = '2026-10-14T08:33:07.412Z'; // 14 Oct 2026, 14:03 IST

function breakRow(patch: Partial<ChainBreakDto> = {}): ChainBreakDto {
  return {
    id: 'b-1',
    kind: 'chain',
    firstSeq: 42,
    anchorId: null,
    reason: 'hash mismatch at seq 42',
    detectedBy: 'anchor',
    detectedAt: AT,
    acknowledgedBy: null,
    acknowledgedAt: null,
    ...patch,
  };
}

function row(patch: Partial<WarehouseLedgerIntegrityDto> = {}): WarehouseLedgerIntegrityDto {
  return {
    warehouseId: 'w-1',
    warehouseCode: 'MAIN',
    baselined: true,
    legacyThroughSeq: 0,
    verifiedThroughSeq: null,
    verifiedAt: null,
    lastRunAt: null,
    brokenAtSeq: null,
    brokenDetectedAt: null,
    lastAnchor: null,
    wormPending: 0,
    breaks: [],
    openBreakCount: 0,
    ...patch,
  };
}

describe('the status, in priority order', () => {
  test('broken wins over verified; "· acknowledged" only when the server counts NO open break', () => {
    const broken = row({ brokenAtSeq: 42, verifiedThroughSeq: 900, verifiedAt: AT, breaks: [breakRow()], openBreakCount: 1 });
    expect(integrityStatus(broken)).toEqual({ tone: 'broken', text: 'Broken at #42' });
    const allAcked = row({ ...broken, breaks: [breakRow({ acknowledgedAt: AT, acknowledgedBy: 'u' })], openBreakCount: 0 });
    expect(integrityStatus(allAcked)).toEqual({ tone: 'broken', text: 'Broken at #42 · acknowledged' });
    // Every LISTED break acknowledged, but an older open one beyond the newest 10: not acknowledged.
    const olderOpen = row({ ...allAcked, openBreakCount: 2 });
    expect(integrityStatus(olderOpen).text).toBe('Broken at #42');
  });

  test('verified names the seq and the IST instant; otherwise "Not yet checked"', () => {
    expect(integrityStatus(row({ verifiedThroughSeq: 900, verifiedAt: AT }))).toEqual({ tone: 'verified', text: 'Verified through #900 · 14 Oct 2026, 14:03' });
    expect(integrityStatus(row({ verifiedThroughSeq: 0, verifiedAt: AT })).text).toBe('Verified through #0 · 14 Oct 2026, 14:03');
    expect(integrityStatus(row())).toEqual({ tone: 'unchecked', text: 'Not yet checked' });
  });
});

describe('the lines', () => {
  test('the pre-0026 count only when B > 0', () => {
    expect(legacyLabel(0)).toBeNull();
    expect(legacyLabel(1)).toBe('1 event verified in the pre-0026 form');
    expect(legacyLabel(12345)).toBe('12,345 events verified in the pre-0026 form');
  });

  test('the last anchor: its range and time, or none yet', () => {
    expect(lastAnchorLabel(null)).toBe('No anchor yet');
    expect(lastAnchorLabel({ fromSeq: 11, toSeq: 20, anchoredAt: AT })).toBe('Last anchor #11–#20 · 14 Oct 2026, 14:03');
  });

  test('the three WORM states (and nothing while there is no anchor)', () => {
    const copied = row({
      lastAnchor: {
        id: 'a',
        kind: 'verified',
        fromSeq: 1,
        toSeq: 2,
        digest: 'd',
        anchoredAt: AT,
        worm: { bucket: 'b', objectKey: 'k', versionId: 'v', retainUntil: '2033-10-14T08:33:07.412Z', copiedAt: AT },
      },
    });
    expect(wormLabel(copied, 'none')).toBe('WORM storage not configured');
    expect(wormLabel(copied, 's3')).toBe('Stored in WORM until 14 Oct 2033');
    expect(wormLabel(row({ ...copied, wormPending: 1 }), 's3')).toBe('1 anchor waiting for WORM copy');
    expect(wormLabel(row({ ...copied, wormPending: 3 }), 's3')).toBe('3 anchors waiting for WORM copy');
    expect(wormLabel(row(), 's3')).toBeNull();
  });

  test('a break: its kind, first seq and time; every generated kind has a word', () => {
    expect(breakLabel(breakRow())).toBe('Chain break at #42 · 14 Oct 2026, 14:03');
    expect(breakLabel(breakRow({ kind: 'worm', firstSeq: 1 }))).toBe('WORM copy break at #1 · 14 Oct 2026, 14:03');
    expect(Object.keys(BREAK_KIND_LABEL).sort()).toEqual(['chain', 'worm']);
  });

  test('the proof file name: ledger-proof-<warehouseCode>-<fromSeq>-<toSeq>.json', () => {
    expect(ledgerProofFilename('MAIN-CHN', { fromSeq: 10001, toSeq: 20000 })).toBe('ledger-proof-MAIN-CHN-10001-20000.json');
    expect(LEDGER_INTEGRITY_ANCHOR).toBe('ledger-integrity');
  });
});

describe('the refusals', () => {
  test('integrityReason maps the section’s codes; role-denied and the benign 409 are recognised', () => {
    const problem = (code: string, detail?: string) => new ApiProblem(code, 400, detail);
    expect(integrityReason(problem('role-denied'))).toBe(LEDGER_INTEGRITY_ROLE_DENIED);
    expect(integrityReason(problem('chain-break-not-found'))).toBe('That break no longer exists in this warehouse — the section is refreshed.');
    expect(integrityReason(problem('anchor-not-found'))).toBe('That anchor no longer exists in this warehouse — the list is refreshed.');
    expect(integrityReason(problem('invalid-cursor'))).toBe('That page of anchors is no longer valid — start from the first page.');
    expect(integrityReason(problem('validation-failed', 'breakId must be a uuid'))).toBe('breakId must be a uuid');
    expect(integrityReason(problem('validation-failed'))).toBe('That request was malformed.');
    expect(integrityReason(new Error('offline'))).toBe('The API is unreachable — is wms-be running?');
    expect(isIntegrityRoleDenied(problem('role-denied'))).toBe(true);
    expect(isIntegrityRoleDenied(problem('permission-denied'))).toBe(false);
    expect(isAlreadyAcknowledged(problem('chain-break-acknowledged'))).toBe(true);
    expect(isAlreadyAcknowledged(problem('conflict'))).toBe(false);
  });
});
