import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ClientInvoiceDto } from '../../lib/api/generated';
import { PrintableClientInvoice } from './client-invoices';

/**
 * Story 5-6a — golden G6: the printed client invoice's markup, captured on the
 * 4-7a base BEFORE credit and debit notes existed, must stay byte-identical.
 * Notes are printed by their own `PrintableClientInvoiceNote`; nothing about
 * the invoice's own print may move. The markup is pinned by its sha256 and
 * length (captured literals), for an issued invoice (two copies) and a draft.
 */

const PARTY = {
  supplier: {
    name: 'Three PL Co',
    gstin: '29AAACT1234A1Z5',
    stateCode: '29',
    stateName: 'Karnataka',
    address: { line1: '12 Peenya Industrial Area', line2: null, city: 'Bengaluru', state: 'Karnataka', pincode: '560066' },
    warehouseCode: 'BLR1',
  },
  recipient: {
    name: 'Acme Foods',
    code: 'ACME',
    legalName: 'Acme Foods Private Limited',
    gstin: '27AAACA1234A1Z5',
    stateCode: '27',
    stateName: 'Maharashtra',
    address: { line1: '5 FC Road', line2: null, city: 'Pune', stateCode: '27', pincode: '411001' },
  },
};

function fixture(status: 'issued' | 'draft'): ClientInvoiceDto {
  return {
    id: '01900000-0000-7000-8000-00000000b001',
    clientId: '01900000-0000-7000-8000-00000000c001',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status,
    invoiceNo: status === 'draft' ? null : '29/S2627/000001',
    fyLabel: status === 'draft' ? null : 'FY-2627',
    supplierGstin: '29AAACT1234A1Z5',
    placeOfSupply: '27',
    supplyType: 'inter',
    totals: { subtotal: 1494, cgst: 0, sgst: 0, igst: 269, tax: 269, roundOff: 37, payable: 1800 },
    issuedAt: status === 'draft' ? null : '2026-10-07T04:30:00.000Z',
    statusNote: null,
    replacesInvoiceId: null,
    createdAt: '2026-10-07T04:00:00.000Z',
    gaps: [],
    warnings: [],
    party: PARTY,
    lines: [
      {
        id: '01900000-0000-7000-8000-00000000a001',
        rateCardId: '01900000-0000-7000-8000-00000000d001',
        segmentFrom: '2026-09-01',
        segmentTo: '2026-09-30',
        chargeCode: 'storage',
        basis: 'per_thousand_units_per_day',
        uom: 'each',
        quantity: '1500',
        unitAmountPaise: 330,
        amountPaise: 495,
        sac: '996729',
        gstBps: 1800,
        placeOfSupply: '27',
        supplyType: 'inter',
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 89,
      },
      {
        id: '01900000-0000-7000-8000-00000000a002',
        rateCardId: '01900000-0000-7000-8000-00000000d001',
        segmentFrom: '2026-09-01',
        segmentTo: '2026-09-30',
        chargeCode: 'inbound_handling',
        basis: 'per_receipt_line',
        uom: null,
        quantity: '3',
        unitAmountPaise: 333,
        amountPaise: 999,
        sac: '996719',
        gstBps: 1800,
        placeOfSupply: '27',
        supplyType: 'inter',
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 180,
      },
    ],
  } as ClientInvoiceDto;
}

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('golden G6: the printed client invoice is unchanged by credit/debit notes', () => {
  test('an issued invoice (two copies)', () => {
    const markup = renderToStaticMarkup(<PrintableClientInvoice invoice={fixture('issued')} />);
    expect({ length: markup.length, sha256: sha(markup) }).toEqual({ length: 8377, sha256: '8f0e39f96fb2a36d15ea2b901044a5f321d51d47850e8fd9ba27c0b90307377c' });
  });

  test('a draft (one copy, "DRAFT — not a tax invoice")', () => {
    const markup = renderToStaticMarkup(<PrintableClientInvoice invoice={fixture('draft')} />);
    expect({ length: markup.length, sha256: sha(markup) }).toEqual({ length: 4185, sha256: '5e16ba4d47630102bf47f2fea47735b37b1128d8954c8b3aa6dae3a10502d965' });
  });
});
