import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import type { ClientInvoiceDto } from '../../lib/api/generated';
import { clearSession, writeSession } from '../../lib/auth';
import { CHARGE_CODES, chargeLabel, type MeteredChargeCode } from '../../lib/rate-cards';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { PrintableClientInvoice } from '../compliance/client-invoices';
import { RateCardsCard } from './rate-cards-card';

/**
 * Story 21-11b (retro F2) — one charge-label source. The invoices printed
 * storage as "per 1,000 units/day" while the rate cards and usage printed
 * "per 1,000 units per day". All three now go through `basisLabel`, so a
 * helper-level test would check nothing: this pins the RENDERED rate text of
 * a rate-card row, a usage row and an invoice line, per charge code.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const AS_OF = '2026-10-20T04:30:00.000Z';

const SELF = {
  id: 'c-self',
  tenantId: TENANT_ID,
  code: 'self',
  name: 'Priya Logistics',
  status: 'active',
  systemOwned: true,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};
const ACME = { ...SELF, id: 'c-acme', code: 'ACME', name: 'Acme Foods', systemOwned: false };

// Story 5-5a — `ChargeCode` widened to every label-able code (the minimum, the
// ad-hoc and adjustment lines); this test pins the four METERED charges' one
// rate-text source, so it is keyed on `MeteredChargeCode` (CHARGE_CODES' type).
const BASIS: Readonly<Record<MeteredChargeCode, string>> = {
  storage: 'per_thousand_units_per_day',
  inbound_handling: 'per_receipt_line',
  pick: 'per_pick',
  outbound_handling: 'per_order',
};
const PAISE: Readonly<Record<MeteredChargeCode, number>> = { storage: 330, inbound_handling: 150, pick: 300, outbound_handling: 1200 };

const CARD = {
  id: 'card-a',
  tenantId: TENANT_ID,
  clientId: ACME.id,
  status: 'active',
  effectiveFrom: '2026-08-15',
  effectiveTo: null,
  lines: CHARGE_CODES.map((code) => ({ chargeCode: code, basis: BASIS[code], amountPaise: PAISE[code] })),
  createdBy: 'u-1',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  activatedBy: 'u-1',
  activatedAt: '2026-08-15T00:00:00.000Z',
  cancelledBy: null,
  cancelledAt: null,
};

function usageFixture(from: string, to: string): Record<string, unknown> {
  return {
    clientId: ACME.id,
    from,
    to,
    asOf: AS_OF,
    storageCompleteThrough: to,
    segments: [
      {
        rateCardId: CARD.id,
        fromDate: from,
        toDate: to,
        storageMeasuredThrough: to,
        lines: CHARGE_CODES.map((code) => ({
          chargeCode: code,
          basis: BASIS[code],
          uom: code === 'storage' ? 'each' : null,
          quantity: '2',
          ratePaise: PAISE[code],
          amountPaise: PAISE[code] * 2,
        })),
      },
    ],
    totals: { billedPaise: 3960, unbilledLines: 0 },
  };
}

const INVOICE = {
  id: 'inv-1',
  clientId: ACME.id,
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  status: 'issued',
  invoiceNo: '29/S2627/000001',
  fyLabel: 'FY-2627',
  supplierGstin: '29AAACT1234A1Z5',
  placeOfSupply: '27',
  supplyType: 'inter',
  totals: { subtotal: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, roundOff: 0, payable: 0 },
  issuedAt: '2026-10-07T04:30:00.000Z',
  statusNote: null,
  replacesInvoiceId: null,
  createdAt: '2026-10-07T04:00:00.000Z',
  gaps: [],
  warnings: [],
  party: {
    supplier: {
      name: 'Priya Logistics',
      gstin: '29AAACT1234A1Z5',
      stateCode: '29',
      stateName: 'Karnataka',
      address: null,
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
  },
  lines: CHARGE_CODES.map((code, index) => ({
    id: `01900000-0000-7000-8000-00000000a00${index}`,
    rateCardId: CARD.id,
    segmentFrom: '2026-09-01',
    segmentTo: '2026-09-30',
    chargeCode: code,
    basis: BASIS[code],
    uom: code === 'storage' ? 'each' : null,
    quantity: '2',
    unitAmountPaise: PAISE[code],
    amountPaise: PAISE[code] * 2,
    sac: '996729',
    gstBps: 1800,
    placeOfSupply: '27',
    supplyType: 'inter',
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
  })),
} as unknown as ClientInvoiceDto;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let view: Rendered | undefined;

beforeEach(() => {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname.endsWith('/clients')) return json(200, { items: [SELF, ACME] });
    if (pathname.endsWith('/usage')) return json(200, usageFixture(url.searchParams.get('from')!, url.searchParams.get('to')!));
    if (pathname.endsWith('/client-invoices')) return json(200, { items: [], nextCursor: null });
    if (pathname.endsWith('/rate-cards/in-force')) return json(200, { rateCard: CARD, asOf: AS_OF });
    if (pathname.endsWith('/rate-cards')) return json(200, { items: [CARD] });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
  writeSession({
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role: 'ops_manager', status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  });
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** The text of `column` (by header) in the `tbody` row whose first cell starts with `rowStart`. */
function cell(table: Element, rowStart: string, column: (header: string) => boolean): string {
  const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
  const index = headers.findIndex(column);
  expect(index).toBeGreaterThanOrEqual(0);
  const row = [...table.querySelectorAll('tbody tr')].find((tr) => (tr.querySelector('td')?.textContent ?? '').startsWith(rowStart));
  expect(row).toBeDefined();
  return row!.querySelectorAll('td')[index]?.textContent?.trim() ?? '';
}

describe('charge labels — one source', () => {
  test('a rate-card row, a usage row and an invoice line render the same rate text for every charge', async () => {
    view = render(<RateCardsCard />);
    await settle();
    const usage = view.container.querySelector('[aria-label="Usage"] table')!;
    expect(usage).not.toBeNull();
    const cards = [...view.container.querySelectorAll('table')].find((table) => table.closest('[aria-label="Usage"]') === null)!;
    const cardHeaders = [...cards.querySelectorAll('thead th')].map((th) => th.textContent ?? '');

    const invoiceView = render(<PrintableClientInvoice invoice={INVOICE} />);
    try {
      const invoice = [...invoiceView.container.querySelectorAll('article[data-print-root] table')].find((table) =>
        [...table.querySelectorAll('thead th')].some((th) => th.textContent === 'Rate'),
      );
      expect(invoice).toBeDefined();

      for (const code of CHARGE_CODES) {
        const label = chargeLabel(code);
        // The rate-card row prints the amount under a header naming the basis.
        const header = cardHeaders.find((text) => text.startsWith(`${label} (`))!;
        expect(header).toBeDefined();
        const basis = header.slice(label.length + 2, -1);
        const amount = [...cards.querySelectorAll('tbody tr')]
          .map((row) => row.querySelectorAll('td')[cardHeaders.indexOf(header)]?.textContent?.trim() ?? '')
          .find((text) => text !== '')!;
        const cardText = `${amount} ${basis}`;

        const usageText = cell(usage, label, (text) => text === 'Rate');
        const invoiceText = cell(invoice!, label, (text) => text === 'Rate');
        expect(usageText).toBe(cardText);
        expect(invoiceText).toBe(cardText);
      }
      // The storage wording is the rate-card vocabulary (decision 1).
      expect(cell(invoice!, 'Storage', (text) => text === 'Rate')).toBe('₹3.30 per 1,000 units per day');
    } finally {
      invoiceView.unmount();
    }
  });
});
