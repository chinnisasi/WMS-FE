import { describe, expect, test } from 'bun:test';

import {
  allocationPolicyWarnings,
  allocationReason,
  parseAllocationPolicyDraft,
  untrackedAllocationNote,
} from './allocation-policy';

describe('story 4-3a: the allocation policy lib', () => {
  test('the draft parse: blank sends null explicitly; whole days 1–3650; anything else is refused before a key is minted', () => {
    expect(parseAllocationPolicyDraft({ allocationRule: 'fifo', minDays: '  ' })).toEqual({
      body: { allocationRule: 'fifo', minOutboundShelfLifeDays: null },
      problem: null,
    });
    expect(parseAllocationPolicyDraft({ allocationRule: 'fefo', minDays: ' 90 ' }).body).toEqual({ allocationRule: 'fefo', minOutboundShelfLifeDays: 90 });
    expect(parseAllocationPolicyDraft({ allocationRule: 'fefo', minDays: '1' }).body?.minOutboundShelfLifeDays).toBe(1);
    expect(parseAllocationPolicyDraft({ allocationRule: 'fefo', minDays: '3650' }).body?.minOutboundShelfLifeDays).toBe(3650);
    for (const bad of ['0', '3651', '1.5', '-1', 'abc', '9e1']) {
      expect(parseAllocationPolicyDraft({ allocationRule: 'fefo', minDays: bad }).body).toBeNull();
    }
  });

  test('the warnings: none without a minimum; undated stock only when expiry is not required; above-receiving always names both', () => {
    expect(allocationPolicyWarnings({ minDays: null, expiryRequired: false, receivingMinDays: null, undatedBatchesOnHand: 5 })).toEqual([]);
    expect(allocationPolicyWarnings({ minDays: 30, expiryRequired: true, receivingMinDays: 60, undatedBatchesOnHand: 5 })).toEqual([]);
    const both = allocationPolicyWarnings({ minDays: 90, expiryRequired: false, receivingMinDays: null, undatedBatchesOnHand: 1 });
    expect(both[0]).toBe('1 batch on hand has no expiry date — the minimum cannot limit it. Turn on "Expiry date required" in the receiving policy.');
    expect(both[1]).toBe(
      'Receiving accepts any remaining shelf life, but the outbound minimum is 90 days: goods may be accepted that can never ship — stock received below it stays on hand and is never shipped.',
    );
    expect(allocationPolicyWarnings({ minDays: 90, expiryRequired: true, receivingMinDays: 90, undatedBatchesOnHand: 2 })).toEqual([]);
  });

  test('the untracked note counts', () => {
    expect(untrackedAllocationNote(0)).toBe("Every one of this client's SKUs is batch-tracked.");
    expect(untrackedAllocationNote(1)).toContain('1 of this client');
  });

  test('allocationReason: the A5 wording; absent keys print nothing', () => {
    expect(allocationReason({ batchCode: 'L1', batchExpiryDate: '2027-03-31', allocationRule: 'fefo', minOutboundShelfLifeDays: 90 })).toBe(
      'batch L1 · exp 31 Mar 2027 · earliest expiry first · needs ≥ 90 days',
    );
    expect(allocationReason({ batchCode: 'L7', batchExpiryDate: null, batchReceivedOn: '2026-01-03', allocationRule: 'fifo', minOutboundShelfLifeDays: null })).toBe(
      'batch L7 · lot first received 3 Jan 2026 · oldest first',
    );
    // A dated lot under FIFO names its first receipt — the fact FIFO chose on.
    expect(allocationReason({ batchCode: 'L3', batchExpiryDate: '2027-03-31', batchReceivedOn: '2026-01-03', allocationRule: 'fifo', minOutboundShelfLifeDays: null })).toBe(
      'batch L3 · lot first received 3 Jan 2026 · oldest first',
    );
    expect(allocationReason({ batchCode: null, allocationRule: 'fefo', minOutboundShelfLifeDays: 30 })).toBe('earliest expiry first · needs ≥ 30 days');
    expect(allocationReason({})).toBeNull();
  });
});
