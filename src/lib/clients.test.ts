import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ClientDto } from './api/generated';
import {
  CLIENTS_CHANGED_EVENT,
  INHERIT_CLIENT_HINT,
  clientCell,
  clientLabel,
  clientReason,
  correctClientReason,
  importClientChoice,
  importClientParam,
  importReason,
  mixedClientReason,
  parseClientDraft,
  showClients,
  singleClientImportHint,
  skusForOrderClient,
  skusOfClient,
  importedForLabel,
  clientNameProblem,
  correctionOutcome,
  NO_TAX_DETAILS,
  BILLING_STATE_OPTIONS,
  parseTaxDetailsDraft,
  taxDetailsFieldsOf,
  taxDetailsReason,
  taxDetailsSummary,
} from './clients';
import { UNREACHABLE_REASON } from './outbound-orders';

function client(over: Partial<ClientDto> = {}): ClientDto {
  return {
    id: 'c-acme',
    tenantId: 't-1',
    code: 'ACME',
    name: 'Acme Foods',
    status: 'active',
    systemOwned: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    taxDetails: NO_TAX_DETAILS,
    ...over,
  };
}
const SELF = client({ id: 'c-self', code: 'self', name: 'Priya Spices', systemOwned: true });
const ACME = client();

function problem(code: string, status: number, detail?: string, title?: string): ApiProblem {
  return new ApiProblem(code, status, detail, title);
}

describe('the client dimension is visible only with more than one client', () => {
  test('showClients', () => {
    expect(showClients(null)).toBe(false);
    expect(showClients([SELF])).toBe(false);
    expect(showClients([SELF, ACME])).toBe(true);
  });

  test('the self client reads as the company; a brand as code — name', () => {
    expect(clientLabel(SELF, 'Priya Spices')).toBe('Priya Spices (your company)');
    expect(clientLabel(SELF, null)).toBe('Your company');
    expect(clientLabel(ACME, 'Priya Spices')).toBe('ACME — Acme Foods');
  });

  test('the table cell: code for a brand, the company for self, a dash for unknown or absent', () => {
    expect(clientCell('c-acme', [SELF, ACME], 'Priya Spices')).toBe('ACME');
    expect(clientCell('c-self', [SELF, ACME], 'Priya Spices')).toBe('Priya Spices');
    expect(clientCell('c-ghost', [SELF, ACME], 'Priya Spices')).toBe('—');
    // A replayed pre-21-2b response carries no clientId.
    expect(clientCell(undefined, [SELF, ACME], 'Priya Spices')).toBe('—');
    expect(clientCell(null, [SELF, ACME], 'Priya Spices')).toBe('—');
  });

  test('the event name is the module broadcaster', () => {
    expect(CLIENTS_CHANGED_EVENT).toBe('wms-clients-changed');
  });
});

describe('the import client choice (decisions 3 and 4)', () => {
  test('one client: no picker, the exact hint line, nothing sent', () => {
    const choice = importClientChoice([SELF], 'initial', 'Priya Spices');
    expect(choice).toEqual({
      kind: 'single',
      hint: 'Importing for Priya Spices. Add clients in Settings to import for a brand.',
    });
    expect(singleClientImportHint('Priya Spices')).toBe(
      'Importing for Priya Spices. Add clients in Settings to import for a brand.',
    );
    expect(importClientParam(choice, '')).toEqual({ clientId: undefined, problem: null });
  });

  test('several clients: a required picker with NO default — an empty pick stops the submit', () => {
    const choice = importClientChoice([SELF, ACME], 'initial', 'Priya Spices');
    expect(choice).toEqual({ kind: 'pick' });
    expect(importClientParam(choice, '')).toEqual({
      clientId: undefined,
      problem: 'Choose the client this import is for.',
    });
    expect(importClientParam(choice, 'c-acme')).toEqual({ clientId: 'c-acme', problem: null });
    // The self client may be chosen explicitly.
    expect(importClientParam(choice, 'c-self')).toEqual({ clientId: 'c-self', problem: null });
  });

  test('fix mode sends NO clientId, whatever was picked — the server inherits the latest run\'s client', () => {
    const inherit = importClientChoice([SELF, ACME], 'fix', 'Priya Spices');
    expect(inherit).toEqual({ kind: 'inherit', hint: INHERIT_CLIENT_HINT });
    expect(importClientParam(inherit, '')).toEqual({ clientId: undefined, problem: null });
    expect(importClientParam(inherit, 'c-acme')).toEqual({ clientId: undefined, problem: null });
  });

  test('the result names the client the server reports', () => {
    expect(importedForLabel([SELF, ACME] as never, 'c-acme', 'Priya Spices')).toBe('ACME — Acme Foods');
    expect(importedForLabel([SELF, ACME] as never, 'c-self', 'Priya Spices')).toBe('Priya Spices (your company)');
    expect(importedForLabel([SELF, ACME] as never, null, 'Priya Spices')).toBeNull();
  });
});

describe('parseClientDraft mirrors the backend shape rules', () => {
  test('trims and uppercases the code, trims the name', () => {
    expect(parseClientDraft(' acme-foods ', ' Acme Foods ')).toEqual({
      body: { code: 'ACME-FOODS', name: 'Acme Foods' },
      problem: null,
    });
  });

  test('refuses the reserved code, a malformed code and an empty or over-long name', () => {
    expect(parseClientDraft('self', 'x').problem).toMatch(/reserved/);
    expect(parseClientDraft('AC ME', 'x').problem).toMatch(/2–32 characters/);
    expect(parseClientDraft('A', 'x').problem).toMatch(/2–32 characters/);
    expect(parseClientDraft('-ACME', 'x').problem).toMatch(/2–32 characters/);
    expect(parseClientDraft('ACME', '   ').problem).toMatch(/1–200/);
    expect(parseClientDraft('ACME', 'x'.repeat(201)).problem).toMatch(/1–200/);
    expect(parseClientDraft('ACME', 'x'.repeat(200)).problem).toBeNull();
    // Code points, not UTF-16 units: 200 astral characters are 400 units but 200 characters.
    expect(parseClientDraft('ACME', '😀'.repeat(200)).problem).toBeNull();
    expect(parseClientDraft('ACME', '😀'.repeat(201)).problem).toMatch(/1–200/);
  });

  test('clientNameProblem — the rename form refuses whitespace-only with the house sentence', () => {
    expect(clientNameProblem('   ')).toBe('A client name is 1–200 characters.');
    expect(clientNameProblem(' Acme ')).toBeNull();
  });

  test('correctionOutcome names every SKU the server moved', () => {
    const clients = [
      { id: 'c-self', code: 'self', name: 'Priya', systemOwned: true },
      { id: 'c-acme', code: 'ACME', name: 'Acme', systemOwned: false },
    ] as never;
    expect(correctionOutcome([{ code: 'A', clientId: 'c-acme' }], clients, 'Priya')).toEqual({
      word: 'A moved',
      reason: 'It now belongs to ACME.',
    });
    expect(correctionOutcome([{ code: 'KIT', clientId: 'c-self' }, { code: 'C1', clientId: 'c-self' }], clients, 'Priya')).toEqual({
      word: '2 SKUs moved',
      reason: 'KIT and the SKUs that share its kit or product (C1) now belong to Priya.',
    });
  });
});

describe('skusForOrderClient — the order form offers the first line\'s client only', () => {
  const skus = [
    { id: 's-a1', clientId: 'c-acme' },
    { id: 's-a2', clientId: 'c-acme' },
    { id: 's-s1', clientId: 'c-self' },
    { id: 's-old' },
  ];
  test('no first pick: everything; a first pick: only its client', () => {
    expect(skusForOrderClient(skus, '')).toBe(skus);
    expect(skusForOrderClient(skus, 's-a1').map((s) => s.id)).toEqual(['s-a1', 's-a2']);
    expect(skusForOrderClient(skus, 's-s1').map((s) => s.id)).toEqual(['s-s1']);
  });
  test('a first pick with no known client restricts nothing', () => {
    expect(skusForOrderClient(skus, 's-old')).toBe(skus);
    expect(skusForOrderClient(skus, 's-ghost')).toBe(skus);
  });
});

describe('the refusal mappers branch on the code', () => {
  test('clientReason', () => {
    expect(clientReason(problem('duplicate-client-code', 409, 'Client code "ACME" already exists'), 'created')).toBe(
      'Client code "ACME" already exists',
    );
    expect(clientReason(problem('duplicate-client-code', 409), 'created')).toBe('Another client already uses that code.');
    expect(clientReason(problem('role-denied', 403), 'created')).toBe('Only an owner can manage clients.');
    expect(clientReason(problem('not-found', 404), 'renamed')).toBe('That client no longer exists — refresh the page.');
    expect(clientReason(problem('validation-failed', 400, 'self cannot be renamed'), 'renamed')).toBe('self cannot be renamed');
    expect(clientReason(problem('weird', 500), 'renamed')).toBe('Client not renamed (weird).');
    expect(clientReason(new Error('offline'), 'created')).toBe(UNREACHABLE_REASON);
    // A session/tenant mismatch, not another tenant's client.
    expect(clientReason(problem('permission-denied', 403), 'created')).toBe(
      'Your session belongs to another tenant — sign in again.',
    );
  });

  test('correctClientReason names the history rule plainly', () => {
    // The server names the SKU (perhaps a kit partner or product sibling) and what it carries.
    expect(correctClientReason(problem('sku-has-history', 409, 'SKU "V2" already has ledger events'))).toBe(
      'SKU "V2" already has ledger events',
    );
    expect(correctClientReason(problem('mixed-client', 409, 'kit KIT-1 mixes ACME, self'))).toBe('kit KIT-1 mixes ACME, self');
    expect(correctClientReason(problem('role-denied', 403))).toBe("Only an owner can correct a SKU's client.");
    expect(correctClientReason(problem('not-found', 404))).toBe('That SKU or client no longer exists — refresh the page.');
    expect(correctClientReason(new Error('offline'))).toBe(UNREACHABLE_REASON);
  });

  test('importReason covers client-required and the unknown client', () => {
    expect(importReason(problem('client-required', 400))).toBe(
      'Choose the client this import is for — this tenant holds more than one client.',
    );
    expect(importReason(problem('not-found', 404))).toBe('That client no longer exists — refresh the page and choose again.');
    expect(importReason(problem('validation-failed', 400, 'fix run keeps ACME'))).toBe('fix run keeps ACME');
    expect(importReason(problem('unsupported-file-type', 415))).toBe('Only .csv and .xlsx files can be imported.');
    expect(importReason(new Error('offline'))).toBe(UNREACHABLE_REASON);
  });

  test('mixedClientReason renders the server detail, with a fallback', () => {
    expect(mixedClientReason(problem('mixed-client', 409, 'The order mixes SKUs of clients ACME, self'))).toBe(
      'The order mixes SKUs of clients ACME, self',
    );
    expect(mixedClientReason(problem('mixed-client', 409))).toMatch(/more than one client/);
  });
});

describe('story 21-5 — the client tax details', () => {
  const STORED = {
    legalName: 'Acme Foods Private Limited',
    gstin: '27AAACA1234A1Z5',
    billingLine1: '5 FC Road',
    billingLine2: null,
    billingCity: 'Pune',
    billingStateCode: '27',
    billingPincode: '411001',
  };

  test('the form round-trips the stored values; only CHANGED fields are sent; an emptied field is null', () => {
    const fields = taxDetailsFieldsOf(client({ taxDetails: STORED }));
    expect(fields.billingLine2).toBe('');
    expect(parseTaxDetailsDraft(fields, STORED)).toEqual({ body: {}, problem: null });
    expect(parseTaxDetailsDraft({ ...fields, billingLine2: ' Floor 2 ', legalName: '' }, STORED)).toEqual({
      body: { legalName: null, billingLine2: 'Floor 2' },
      problem: null,
    });
    // The GSTIN is uppercased before it is compared.
    expect(parseTaxDetailsDraft({ ...fields, gstin: '27aaaca1234a1z5' }, STORED)).toEqual({ body: {}, problem: null });
  });

  test('refuses what the server would 400: GSTIN shape and prefix, a GSTIN in another state, a bad pincode, an unknown state', () => {
    const fields = taxDetailsFieldsOf(client({ taxDetails: STORED }));
    expect(parseTaxDetailsDraft({ ...fields, gstin: '27ABC' }, STORED).problem).toContain('15 characters');
    expect(parseTaxDetailsDraft({ ...fields, gstin: '99AAACA1234A1Z5', billingStateCode: '' }, STORED).problem).toContain('not a GST registration state code');
    expect(parseTaxDetailsDraft({ ...fields, gstin: '29AAACA1234A1Z5' }, STORED).problem).toBe(
      "This GSTIN is registered in Karnataka (29) — a registered client is billed in its GSTIN's state, so pick that state.",
    );
    expect(parseTaxDetailsDraft({ ...fields, billingPincode: '4110' }, STORED).problem).toBe('A pincode is six digits.');
    expect(parseTaxDetailsDraft({ ...fields, billingStateCode: '99' }, STORED).problem).toBe('Choose a state from the list.');
    expect(parseTaxDetailsDraft({ ...fields, legalName: 'x'.repeat(201) }, STORED).problem).toBe('Legal name is at most 200 characters.');
  });

  test('the summary names what an invoice still needs; the state options are the registration codes', () => {
    expect(taxDetailsSummary(client({ taxDetails: STORED }))).toBe('Acme Foods Private Limited · 27AAACA1234A1Z5 · Maharashtra');
    expect(taxDetailsSummary(client({ taxDetails: { ...STORED, gstin: null } }))).toBe('Acme Foods Private Limited · Unregistered · Maharashtra');
    expect(taxDetailsSummary(client())).toBe('Missing legal name and billing address — needed to invoice');
    expect(taxDetailsSummary(client({ systemOwned: true }))).toBe('—');
    expect(BILLING_STATE_OPTIONS.find((option) => option.code === '27')).toEqual({ code: '27', label: '27 — Maharashtra' });
    expect(BILLING_STATE_OPTIONS.some((option) => option.code === '99')).toBe(false);
  });

  test('the refusal mapper', () => {
    expect(taxDetailsReason(new ApiProblem('validation-failed', 400, 'gstin bad'))).toBe('gstin bad');
    expect(taxDetailsReason(new ApiProblem('role-denied', 403))).toBe('Only an owner or an accountant can set tax details.');
    expect(taxDetailsReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('skusOfClient — the ASN form offers the chosen client\'s SKUs only (story 21-6)', () => {
  const skus = [
    { id: 's1', clientId: 'acme' },
    { id: 's2', clientId: 'beta' },
    { id: 's3', clientId: 'acme' },
    { id: 's4', clientId: null },
  ];

  test('nothing until a client is picked; then exactly that client\'s SKUs', () => {
    expect(skusOfClient(skus, '')).toEqual([]);
    expect(skusOfClient(skus, 'acme').map((sku) => sku.id)).toEqual(['s1', 's3']);
    expect(skusOfClient(skus, 'beta').map((sku) => sku.id)).toEqual(['s2']);
  });
});
