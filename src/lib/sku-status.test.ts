import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { RejectedOpResponse } from '@/lib/api/generated';
import { ASN_IMPORT_REASON_LABEL, asnImportReasonLabel } from './asn-import';
import { asnReason } from './asns';
import { kitReason } from './catalog-kits';
import { setMappingsReason } from './channels';
import { importReason } from './clients';
import { createReason, UNREACHABLE_REASON } from './outbound-orders';
import { portalAsnReason } from './portal';
import { submitSuggestedPoReason } from './replenishment';
import {
  discardFailedWord,
  discardLabel,
  rejectedOpBadge,
  rejectedOpGuidance,
  rejectedOpResolvedOutcome,
  rejectedOpSummary,
} from './review-queue';
import {
  MAX_SKU_INACTIVE_REASON_LENGTH,
  SKU_DEACTIVATE_COPY,
  inactiveSkuCodes,
  orderSkuOptionLabel,
  parseSkuInactiveReason,
  skuInactiveMarker,
  skuStatusLabel,
  withoutInactive,
} from './sku-status';
import { skuStatusReason } from './sku-status-reason';

/**
 * Story 1-4b — SKU deactivation on the web: the status label, the reason
 * parse, the inactive marker, the inactive-aware pickers (with their
 * keep-sets), every `sku-inactive` reason arm, and the review queue's
 * Acknowledge row.
 */

function inactive(codes: string[], detail?: string, status = 409): ApiProblem {
  return new ApiProblem('sku-inactive', status, detail, 'SKU inactive', { skuCodes: codes });
}

describe('the status label and marker', () => {
  test('Active, Inactive, Inactive — {reason}', () => {
    expect(skuStatusLabel({ status: 'active', inactiveReason: null })).toBe('Active');
    expect(skuStatusLabel({ status: 'inactive', inactiveReason: null })).toBe('Inactive');
    expect(skuStatusLabel({ status: 'inactive', inactiveReason: 'discontinued' })).toBe('Inactive — discontinued');
  });

  test('the marker names an inactive SKU only; a mapping row says it publishes 0', () => {
    expect(skuInactiveMarker({ status: 'active' })).toBeNull();
    expect(skuInactiveMarker(undefined)).toBeNull();
    expect(skuInactiveMarker({ status: 'inactive' })).toBe('Inactive');
    expect(skuInactiveMarker({ status: 'inactive' }, 'mapping')).toBe('Inactive — publishes 0');
  });

  test('the deactivate copy covers decisions 1, 3 and 11', () => {
    const copy = SKU_DEACTIVATE_COPY.join(' ');
    expect(copy).toContain('purchase orders, ASNs and kits refuse it');
    expect(copy).toContain('sell down existing stock only');
    expect(copy).toContain('channels show 0');
    expect(copy).toContain('channel buffers');
    expect(copy).toContain('will not fill');
  });
});

describe('the reason parse', () => {
  test('blank is no reason; trimmed; 500 code points is the limit', () => {
    expect(parseSkuInactiveReason('   ')).toEqual({ reason: null, problem: null });
    expect(parseSkuInactiveReason('  end of line ')).toEqual({ reason: 'end of line', problem: null });
    expect(parseSkuInactiveReason('𝒳'.repeat(MAX_SKU_INACTIVE_REASON_LENGTH)).problem).toBeNull();
    expect(parseSkuInactiveReason('𝒳'.repeat(MAX_SKU_INACTIVE_REASON_LENGTH + 1)).problem).toContain('500');
  });
});

describe('the pickers', () => {
  const skus = [
    { id: 'a', code: 'A', status: 'active' as const },
    { id: 'b', code: 'B', status: 'inactive' as const },
    { id: 'c', code: 'C', status: 'inactive' as const },
  ];

  test('document pickers drop inactive SKUs except the keep-set (SKUs already on the document)', () => {
    expect(withoutInactive(skus).map((sku) => sku.id)).toEqual(['a']);
    expect(withoutInactive(skus, new Set(['c'])).map((sku) => sku.id)).toEqual(['a', 'c']);
  });

  test('order entry keeps an inactive SKU, labelled (decision 10)', () => {
    expect(orderSkuOptionLabel({ code: 'A', status: 'active' })).toBe('A');
    expect(orderSkuOptionLabel({ code: 'B', status: 'inactive' })).toBe('B — inactive, sells existing stock only');
    expect(orderSkuOptionLabel({ code: 'B', status: 'inactive' }, 'B Blue tee')).toBe('B Blue tee — inactive, sells existing stock only');
  });
});

describe('the sku-inactive reason arms', () => {
  test('the codes ride extensions.skuCodes', () => {
    expect(inactiveSkuCodes(inactive(['X', 'Y']))).toEqual(['X', 'Y']);
    expect(inactiveSkuCodes(new ApiProblem('sku-inactive', 409))).toEqual([]);
  });

  test('ASN, kit, mapping and import name the codes', () => {
    expect(asnReason(inactive(['X']))).toContain('SKU X is inactive');
    expect(kitReason(inactive(['X', 'Y']))).toContain('SKUs X, Y are inactive');
    expect(setMappingsReason(inactive(['X']))).toContain('a new channel mapping');
    expect(importReason(inactive(['X']))).toContain('SKU X is inactive');
  });

  test('the portal answers in its own fixed words', () => {
    expect(portalAsnReason(inactive(['X']))).toBe('A SKU on this notice is no longer active with the warehouse — remove it and send the rest.');
  });

  test('order create renders the sell-down detail; order-catalog-changed asks to submit again', () => {
    expect(createReason(inactive(['X'], 'An inactive SKU sells existing stock only — … ordered 30, available 10.'))).toContain('available 10');
    expect(createReason(new ApiProblem('order-catalog-changed', 409))).toContain('submit again');
  });

  test('the suggested-PO submit arm runs ahead of the verbatim 409 branch', () => {
    const reason = submitSuggestedPoReason(inactive(['X'], 'verbatim detail'));
    expect(reason).toContain('SKU X is inactive');
    expect(reason).not.toContain('verbatim detail');
    // Any other 409 is still verbatim.
    expect(submitSuggestedPoReason(new ApiProblem('vendor-not-linked', 409, 'not linked', 'Vendor not linked'))).toBe('Vendor not linked — not linked');
  });

  test('the ASN import label', () => {
    expect(ASN_IMPORT_REASON_LABEL['sku-inactive']).toBe('Inactive SKU — reactivate it to announce shipments');
    expect(asnImportReasonLabel('sku-inactive')).toBe('Inactive SKU — reactivate it to announce shipments');
  });

  test('the status route mapper', () => {
    expect(skuStatusReason(new ApiProblem('role-denied', 403), 'deactivated')).toBe('Your role cannot edit the catalog.');
    expect(skuStatusReason(new ApiProblem('validation-failed', 400, 'reason is at most 500 characters.'), 'deactivated')).toBe(
      'reason is at most 500 characters.',
    );
    expect(skuStatusReason(new Error('down'), 'reactivated')).toBe(UNREACHABLE_REASON);
  });
});

describe('the review queue: grn.inactive-sku-received', () => {
  const entry = {
    opType: 'grn.inactive-sku-received',
    classification: 'rejected',
    problemCode: 'sku-inactive',
    payload: {
      grnId: '01900000-0000-7000-8000-00000000abcd',
      grnCode: 'GRN-0042',
      lines: [
        { skuId: 's-1', skuCode: 'INA', qty: 12, uom: 'each' },
        { skuId: 's-2', skuCode: 'INA2', qty: 3, uom: 'kg' },
      ],
    },
  } as unknown as RejectedOpResponse;

  test('a flagged badge, an Acknowledge button and its outcome words', () => {
    expect(rejectedOpBadge(entry)).toBe('flagged');
    expect(discardLabel(entry)).toBe('Acknowledge');
    expect(discardFailedWord(entry)).toBe('Not acknowledged');
    expect(rejectedOpResolvedOutcome(entry, 'discarded').word).toBe('Acknowledged');
    const refused = { ...entry, opType: 'grn.lines-refused' } as RejectedOpResponse;
    expect(rejectedOpBadge(refused)).toBe('refused');
    expect(discardLabel(refused)).toBe('Discard');
    expect(rejectedOpResolvedOutcome(refused, 'discarded').word).toBe('Discarded');
  });

  test('the summary and the guidance name each booked line', () => {
    expect(rejectedOpSummary(entry)).toEqual({
      heading: 'GRN-0042 — 2 lines of inactive SKUs booked',
      lines: ['INA × 12 each — booked, SKU inactive', 'INA2 × 3 kg — booked, SKU inactive'],
    });
    expect(rejectedOpGuidance(entry)).toEqual([
      'Booked — INA is inactive; check why it arrived',
      'Booked — INA2 is inactive; check why it arrived',
    ]);
  });
});
