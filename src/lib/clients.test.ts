import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ClientDto } from './api/generated';
import {
  CLIENTS_CHANGED_EVENT,
  INHERIT_CLIENT_HINT,
  clientCell,
  clientLabel,
  clientReason,
  clientStatusAction,
  clientStatusLabel,
  clientStatusQuestion,
  clientStatusSuccess,
  clientStatusTarget,
  clientStatusWord,
  clientStatusActionLabel,
  clientStatusRefusedWord,
  clientTakesWork,
  workingClients,
  skusOfWorkingClients,
  skuClientDeparted,
  orderableClients,
  departureBlockers,
  departureBlockerLine,
  CLIENT_DEPARTED_REASON,
  contactEmailProblem,
  parseContactDraft,
  contactRolesLabel,
  contactDraftDirty,
  emptyContactFields,
  contactReason,
  parseRegisteredAddress,
  parseReturnAddress,
  registeredAddressLine,
  addressesReason,
  percentToBps,
  bpsToPercent,
  parseReceivingPolicyDraft,
  deriveExpiryLabel,
  DERIVE_EXPIRY_LABEL,
  receivingPolicyFieldsOf,
  receivingToleranceLabel,
  qcOnReceiptLabel,
  expiryRequiredLabel,
  minShelfLifeLabel,
  untrackedSkusNote,
  QC_NOT_HELD_NOTE,
  receivingPolicySaved,
  receivingPolicyFieldOf,
  receivingPolicyReason,
  receivingPolicyReadReason,
  correctClientReason,
  importClientChoice,
  importClientParam,
  importReason,
  mixedClientReason,
  parseClientDraft,
  showClients,
  singleClientImportHint,
  skusOfClient,
  skuDisplayLabel,
  clientShortLabel,
  clientOfSku,
  narrowToClient,
  withSkuClient,
  orderSkuOptions,
  orderClientProblem,
  linesKeptForClient,
  clientChangeQuestion,
  PICK_CLIENT_FIRST,
  CATALOG_CODES_PER_CLIENT_HELP,
  KIT_CELL_CLIENT_HELP,
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
    registeredAddress: null,
    returnAddress: null,
    emailReplyTo: null,
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

describe('story 1-1 — a SKU is named with its client once the tenant has more than one', () => {
  const BETA = client({ id: 'c-beta', code: 'BETA', name: 'Beta Brands' });
  const tshirtA = { code: 'TSHIRT-M', clientId: 'c-acme' };
  const tshirtB = { code: 'TSHIRT-M', clientId: 'c-beta' };
  test('more than one client: CODE · client code, the own company by its name', () => {
    expect(skuDisplayLabel(tshirtA, [SELF, ACME, BETA])).toBe('TSHIRT-M · ACME');
    expect(skuDisplayLabel(tshirtB, [SELF, ACME, BETA])).toBe('TSHIRT-M · BETA');
    expect(skuDisplayLabel({ code: 'OWN-1', clientId: 'c-self' }, [SELF, ACME])).toBe('OWN-1 · Priya Spices');
    expect(clientShortLabel(client({ systemOwned: true, name: '' }))).toBe('Your company');
  });
  test('one client, clients not loaded, or the SKU\'s client unknown: the bare code', () => {
    expect(skuDisplayLabel(tshirtA, [SELF])).toBe('TSHIRT-M');
    expect(skuDisplayLabel(tshirtA, null)).toBe('TSHIRT-M');
    expect(skuDisplayLabel({ code: 'OLD' }, [SELF, ACME])).toBe('OLD');
    expect(skuDisplayLabel({ code: 'OLD', clientId: null }, [SELF, ACME])).toBe('OLD');
    expect(skuDisplayLabel({ code: 'GHOST', clientId: 'c-gone' }, [SELF, ACME])).toBe('GHOST');
  });
  test('withSkuClient suffixes any text under the same rule', () => {
    expect(withSkuClient('Serum 30 ml', { clientId: 'c-acme' }, [SELF, ACME])).toBe('Serum 30 ml · ACME');
    expect(withSkuClient('Serum 30 ml', { clientId: 'c-acme' }, [SELF])).toBe('Serum 30 ml');
  });
  test('clientOfSku and narrowToClient narrow a picker to a chosen SKU\'s client', () => {
    const skus = [
      { id: 's-a1', clientId: 'c-acme' },
      { id: 's-a2', clientId: 'c-acme' },
      { id: 's-b1', clientId: 'c-beta' },
      { id: 's-old' },
    ];
    expect(clientOfSku(skus, 's-a1')).toBe('c-acme');
    expect(clientOfSku(skus, '')).toBeNull();
    expect(clientOfSku(skus, null)).toBeNull();
    expect(clientOfSku(skus, 's-old')).toBeNull();
    expect(clientOfSku(skus, 's-ghost')).toBeNull();
    expect(narrowToClient(skus, 'c-acme').map((s) => s.id)).toEqual(['s-a1', 's-a2']);
    expect(narrowToClient(skus, null)).toBe(skus);
  });
});

describe('story 1-1 — the catalog import help', () => {
  test('codes and barcodes are per client; kit cells name this client\'s SKUs', () => {
    expect(CATALOG_CODES_PER_CLIENT_HELP).toBe(
      'SKU codes and barcodes are unique per client: two clients may both own a code or a barcode, but one client cannot hold it twice.',
    );
    expect(KIT_CELL_CLIENT_HELP).toBe("naming this client's SKUs");
  });
});

describe('story 1-1 — order entry is client-first', () => {
  const BETA = client({ id: 'c-beta', code: 'BETA', name: 'Beta Brands' });
  const skus = [
    { id: 's-a1', clientId: 'c-acme' },
    { id: 's-b1', clientId: 'c-beta' },
    { id: 's-old' },
  ];
  test('several clients: none until one is picked, then only its SKUs', () => {
    expect(orderSkuOptions(skus, [SELF, ACME, BETA], '')).toEqual([]);
    expect(orderSkuOptions(skus, [SELF, ACME, BETA], 'c-acme').map((s) => s.id)).toEqual(['s-a1']);
    expect(orderClientProblem([SELF, ACME], '')).toBe('Choose the client this order is for.');
    expect(orderClientProblem([SELF, ACME], 'c-acme')).toBeNull();
    expect(PICK_CLIENT_FIRST).toBe('Pick a client first');
  });
  test('one client, or the clients not loaded: every SKU, no problem', () => {
    expect(orderSkuOptions(skus, [SELF], '')).toBe(skus);
    expect(orderSkuOptions(skus, null, '')).toBe(skus);
    expect(orderClientProblem([SELF], '')).toBeNull();
    expect(orderClientProblem(null, '')).toBeNull();
  });
  test('a client change keeps blank lines and the next client\'s lines only', () => {
    const rows = [
      { id: 'r1', skuId: 's-a1' },
      { id: 'r2', skuId: '' },
      { id: 'r3', skuId: 's-b1' },
    ];
    expect(linesKeptForClient(rows, skus, 'c-beta').map((r) => r.id)).toEqual(['r2', 'r3']);
    expect(linesKeptForClient(rows, skus, 'c-acme').map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(clientChangeQuestion(1, 'BETA')).toBe(
      "Change the client to BETA? This clears the line already picked — it is another client's SKU.",
    );
    expect(clientChangeQuestion(3, 'BETA')).toBe(
      "Change the client to BETA? This clears the 3 lines already picked — they are another client's SKUs.",
    );
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
    // Story 1-1: the target client already holds a moving SKU's code or barcode.
    expect(correctClientReason(problem('duplicate-sku-code', 409, 'BETA already has a SKU coded TSHIRT-M'))).toBe(
      'BETA already has a SKU coded TSHIRT-M',
    );
    expect(correctClientReason(problem('duplicate-sku-code', 409))).toBe(
      'That client already has a SKU with this code — rename one first.',
    );
    // Story 1-4: every barcode of the SKU moves, and so does its product.
    expect(correctClientReason(problem('duplicate-barcode', 409))).toBe(
      "That client already has a SKU with one of this SKU's barcodes — clear or change one first.",
    );
    expect(correctClientReason(problem('duplicate-barcode', 409, 'Barcode "890" of SKU "A" already belongs to SKU "B" (its case barcode)'))).toBe(
      'Barcode "890" of SKU "A" already belongs to SKU "B" (its case barcode)',
    );
    expect(correctClientReason(problem('duplicate-product-name', 409))).toBe(
      "That client already has a product with this SKU's product name — rename one first.",
    );
    expect(correctClientReason(problem('barcode-is-code', 409))).toBe(
      "One of this SKU's barcodes equals a SKU code in that client — change the barcode first.",
    );
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

describe('story 21-10 — suspend and reactivate', () => {
  test('clientReason: every arm the status action can meet', () => {
    // Story 1-2a changed these words: a departed client CAN be reactivated now.
    expect(clientReason(problem('client-not-active', 409, 'Client "GONE" has departed — a departed client can only be reactivated.'), 'suspended')).toBe(
      'A departed client can only be reactivated.',
    );
    expect(clientReason(problem('validation-failed', 400, 'The self client cannot be suspended or reactivated'), 'suspended')).toBe(
      'The self client cannot be suspended or reactivated',
    );
    expect(clientReason(problem('role-denied', 403), 'suspended')).toBe('Only an owner can manage clients.');
    expect(clientReason(problem('permission-denied', 403), 'reactivated')).toBe(
      'Your session belongs to another tenant — sign in again.',
    );
    expect(clientReason(problem('not-found', 404), 'reactivated')).toBe('That client no longer exists — refresh the page.');
    expect(clientReason(problem('idempotency-key-reuse', 422), 'suspended')).toBe('This submission was already processed.');
    expect(clientReason(problem('conflict', 409), 'suspended')).toBe(
      'The same submission is still in flight — retry to read the settled result.',
    );
    expect(clientReason(problem('validation-failed', 400), 'suspended')).toBe('That status change is not allowed.');
    expect(clientReason(problem('validation-failed', 400), 'created')).toBe('Check the code and name and try again.');
    // Outside a status action the departed wording never applies — the server's detail does.
    expect(clientReason(problem('client-not-active', 409, 'Client GONE is departed'), 'renamed')).toBe('Client GONE is departed');
    expect(clientReason(problem('client-not-active', 409), 'created')).toBe('This client is not active.');
    expect(clientReason(problem('weird', 500), 'suspended')).toBe('Client not suspended (weird).');
    expect(clientReason(problem('weird', 500), 'reactivated')).toBe('Client not reactivated (weird).');
    expect(clientReason(new Error('offline'), 'reactivated')).toBe(UNREACHABLE_REASON);
  });

  test('the status labels, the eligible action per row, and the PATCH target', () => {
    expect(clientStatusLabel('active')).toBe('Active');
    expect(clientStatusLabel('suspended')).toBe('Suspended');
    expect(clientStatusLabel('departed')).toBe('Departed');
    // Story 1-2a: a LIST per row — depart joins suspend; a departed client reactivates.
    expect(clientStatusAction(ACME)).toEqual(['suspend', 'depart']);
    expect(clientStatusAction(client({ status: 'suspended' }))).toEqual(['reactivate', 'depart']);
    expect(clientStatusAction(client({ status: 'departed' }))).toEqual(['reactivate']);
    expect(clientStatusAction(SELF)).toEqual([]);
    expect(clientStatusTarget('suspend')).toBe('suspended');
    expect(clientStatusTarget('reactivate')).toBe('active');
    expect(clientStatusTarget('depart')).toBe('departed');
  });

  test('the confirmation and success copy', () => {
    expect(clientStatusQuestion('suspend', 'Acme Foods')).toBe(
      'Suspend Acme Foods? Its portal users are signed out on their next action and cannot sign in or announce shipments; no new portal users can be invited and no new rate card can be drafted or activated. Warehouse work and billing continue (it cannot see invoices in the portal while suspended). Open ASNs stay open.',
    );
    expect(clientStatusQuestion('reactivate', 'Acme Foods')).toBe('Reactivate Acme Foods? Its portal users can sign in again.');
    expect(clientStatusSuccess(client({ status: 'suspended' }))).toBe('Acme Foods is suspended.');
    expect(clientStatusSuccess(ACME)).toBe('Acme Foods is active again.');
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

describe('story 1-2a — departure, no new work, contacts and addresses', () => {
  const GONE = client({ id: 'c-gone', code: 'GONE', name: 'Gone Brand', status: 'departed' });
  const SUSP = client({ id: 'c-susp', code: 'SUSP', name: 'Suspended Brand', status: 'suspended' });

  test('clientTakesWork: every status but departed; the pickers drop only departed clients and their SKUs', () => {
    expect(clientTakesWork(ACME)).toBe(true);
    expect(clientTakesWork(SUSP)).toBe(true);
    expect(clientTakesWork(GONE)).toBe(false);
    expect(workingClients([SELF, ACME, SUSP, GONE])?.map((c) => c.code)).toEqual(['self', 'ACME', 'SUSP']);
    expect(workingClients(null)).toBeNull();
    const skus = [
      { id: 's1', code: 'A', clientId: 'c-acme' },
      { id: 's2', code: 'G', clientId: 'c-gone' },
      { id: 's3', code: 'S', clientId: 'c-susp' },
      { id: 's4', code: 'X', clientId: null },
    ];
    expect(skusOfWorkingClients(skus, [SELF, ACME, SUSP, GONE]).map((s) => s.id)).toEqual(['s1', 's3', 's4']);
    expect(skusOfWorkingClients(skus, null)).toEqual(skus);
    expect(skuClientDeparted(skus[1]!, [GONE])).toBe(true);
    expect(skuClientDeparted(skus[0]!, [ACME, GONE])).toBe(false);
  });

  test('decision 5: a suspended client is offered on the order form; a departed one is not', () => {
    expect(orderableClients([SELF, ACME, SUSP, GONE])?.map((c) => c.code)).toEqual(['self', 'ACME', 'SUSP']);
  });

  test('single-client gates count ALL clients: self + one departed client still shows a picker, never a forced default', () => {
    expect(importClientChoice([SELF, GONE], 'initial', 'Priya Spices')).toEqual({ kind: 'pick' });
  });

  test('the depart and departed-reactivate copy, the success words per target', () => {
    expect(clientStatusQuestion('depart', 'Gone Brand')).toBe(
      'Depart Gone Brand? It takes no new work from now on: no new orders, purchase orders, shipment notices, returns, SKUs, imports or channel mappings, and stock that turns up for it is refused until it is reactivated. Its portal users are signed out now. Its history, reports and invoices stay. It can depart only once nothing is left open for it.',
    );
    expect(clientStatusQuestion('reactivate', 'Gone Brand', 'departed')).toBe(
      'Reactivate Gone Brand? It takes work again; its portal users sign in again to use the portal.',
    );
    expect(clientStatusSuccess(GONE)).toBe('Gone Brand has departed — it takes no new work, and its history stays.');
    expect(clientStatusWord(GONE)).toBe('GONE departed');
    expect(clientStatusWord(SUSP)).toBe('SUSP suspended');
    expect(clientStatusWord(ACME)).toBe('ACME reactivated');
    expect(clientStatusActionLabel('depart')).toBe('Depart');
    expect(clientStatusRefusedWord('depart')).toBe('Not departed');
  });

  test('departureBlockers reads extensions.blockers; words per kind; codes with "and N more"; an unknown kind has a fallback', () => {
    const refusal = new ApiProblem('client-not-wound-down', 409, 'Client "GONE" cannot depart', undefined, {
      blockers: [
        { kind: 'stock', count: 4 },
        { kind: 'open-orders', count: 3, codes: ['SO-104', 'SO-109'] },
        { kind: 'open-rmas', count: 1, codes: ['RMA-7'] },
        { kind: 'brand-new-kind', count: 2 },
        { kind: 7, count: 'x' },
      ],
    });
    const blockers = departureBlockers(refusal)!;
    expect(blockers.map(departureBlockerLine)).toEqual([
      'Stock on hand in 4 SKUs',
      '3 open orders: SO-104, SO-109 and 1 more',
      '1 open return: RMA-7',
      '2 other open items (brand-new-kind)',
    ]);
    expect(departureBlockerLine({ kind: 'pending-adjustments', count: 1, codes: [] })).toBe('1 stock adjustment awaiting approval');
    // Story 3-7a — an open live recall blocks the departure.
    expect(departureBlockerLine({ kind: 'open-recalls', count: 2, codes: ['RCL-000001', 'RCL-000002'] })).toBe('2 open recalls: RCL-000001, RCL-000002');
    expect(departureBlockerLine({ kind: 'channel-mappings', count: 2, codes: ['EXT-1', 'EXT-2'] })).toBe(
      '2 channel mappings of its SKUs: EXT-1, EXT-2',
    );
    expect(departureBlockerLine({ kind: 'unsettled-invoices', count: 2, codes: ['2026-09'] })).toBe(
      '2 unsettled client invoices: 2026-09 and 1 more',
    );
    expect(departureBlockers(problem('client-not-active', 409))).toBeNull();
    expect(departureBlockers(new Error('offline'))).toBeNull();
    expect(departureBlockers(new ApiProblem('client-not-wound-down', 409, 'x', undefined, {}))).toBeNull();
  });

  test('client-departed is worded by every clients-module reason; the new status codes too', () => {
    const departed = problem('client-departed', 409, 'Client GONE has departed');
    expect(clientReason(departed, 'renamed')).toBe(CLIENT_DEPARTED_REASON);
    expect(correctClientReason(departed)).toBe(CLIENT_DEPARTED_REASON);
    expect(importReason(departed)).toBe(CLIENT_DEPARTED_REASON);
    expect(clientReason(problem('client-not-wound-down', 409, 'Client "GONE" cannot depart while work remains'), 'departed')).toBe(
      'Client "GONE" cannot depart while work remains',
    );
    expect(clientReason(problem('client-not-wound-down', 409), 'departed')).toBe('This client still has open work — it cannot depart yet.');
    expect(clientReason(problem('weird', 500), 'departed')).toBe('Client not departed (weird).');
  });

  test('contactEmailProblem mirrors the server rule: trim, lower-case, a dot in the domain, at most 254', () => {
    expect(contactEmailProblem(' Asha@Acme.Example ')).toBeNull();
    expect(contactEmailProblem('')).toBe('An email is required.');
    expect(contactEmailProblem('asha@acme')).toBe('Enter an email address like name@company.com.');
    expect(contactEmailProblem('@acme.example')).toBe('Enter an email address like name@company.com.');
    expect(contactEmailProblem('as ha@acme.example')).toBe('Enter an email address like name@company.com.');
    expect(contactEmailProblem('asha@acme.')).toBe('Enter an email address like name@company.com.');
    expect(contactEmailProblem(`${'a'.repeat(250)}@x.io`)).toBe('An email is at most 254 characters.');
  });

  test('parseContactDraft: trimmed, lower-cased, a blank phone is null, roles in vocabulary order', () => {
    expect(parseContactDraft({ name: ' Asha ', email: ' Asha@Acme.Example ', phone: '  ', roles: ['returns', 'operations'], emailEvents: ['order.dispatched'] })).toEqual({
      body: { name: 'Asha', email: 'asha@acme.example', phone: null, roles: ['operations', 'returns'] },
      problem: null,
    });
    expect(parseContactDraft({ name: '  ', email: 'a@b.co', phone: '', roles: [], emailEvents: [] }).problem).toBe('A contact name is 1–120 characters.');
    expect(parseContactDraft({ name: 'A', email: 'a@b.co', phone: '0'.repeat(21), roles: [], emailEvents: [] }).problem).toBe(
      'A phone is at most 20 characters.',
    );
    expect(contactRolesLabel([])).toBe('General');
    expect(contactRolesLabel(['operations', 'billing'])).toBe('Operations, Billing');
    expect(contactDraftDirty(emptyContactFields(), emptyContactFields())).toBe(false);
    expect(contactDraftDirty({ ...emptyContactFields(), roles: ['billing'] }, emptyContactFields())).toBe(true);
    // Story 5-2b — ticking or unticking an email event is an edit; the order is not.
    expect(contactDraftDirty({ ...emptyContactFields(), emailEvents: ['receipt.recorded'] }, emptyContactFields())).toBe(true);
    expect(
      contactDraftDirty(
        { ...emptyContactFields(), emailEvents: ['order.dispatched', 'receipt.recorded'] },
        { ...emptyContactFields(), emailEvents: ['receipt.recorded', 'order.dispatched'] },
      ),
    ).toBe(false);
  });

  test('contactReason words the contact codes', () => {
    expect(contactReason(problem('primary-contact-required', 409))).toBe('This is the primary contact — make another contact primary first.');
    expect(contactReason(problem('duplicate-contact-email', 409))).toBe('Another contact of this client already uses that email.');
    expect(contactReason(problem('contact-limit', 409))).toBe('A client holds at most 20 contacts — remove one first.');
    expect(contactReason(problem('validation-failed', 400, 'email must be an email address'))).toBe('email must be an email address');
    expect(contactReason(new Error('offline'))).toBe(UNREACHABLE_REASON);
  });

  test('the registered address: required fields, a state off the list, a pincode; the return address uses the shipment parser', () => {
    const ok = { line1: ' 4th Floor ', line2: '', city: 'Mumbai', stateCode: '27', pincode: '400001' };
    expect(parseRegisteredAddress(ok)).toEqual({
      address: { line1: '4th Floor', city: 'Mumbai', stateCode: '27', pincode: '400001' },
      problem: null,
    });
    expect(parseRegisteredAddress({ ...ok, city: '', pincode: '' }).problem).toBe('The registered address needs a city and a pincode.');
    expect(parseRegisteredAddress({ ...ok, stateCode: '99' }).problem).toBe('Choose a state from the list.');
    expect(parseRegisteredAddress({ ...ok, pincode: '4000' }).problem).toBe('The pincode is six digits, as text — leading zeros are part of it.');
    expect(parseReturnAddress({ contactName: '', phone: '', line1: 'x', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' }).problem).toBe(
      'The return address needs a contact name and a phone.',
    );
    expect(registeredAddressLine(client())).toBe('Not set');
    expect(registeredAddressLine(client({ registeredAddress: { line1: 'L1', line2: null, city: 'Mumbai', stateCode: '27', pincode: '400001' } }))).toBe(
      'L1, Mumbai, Maharashtra 400001',
    );
    expect(addressesReason(problem('validation-failed', 400, 'registeredAddress.stateCode must be a GST registration state code'))).toBe(
      'registeredAddress.stateCode must be a GST registration state code',
    );
  });
});

describe('story 1-2b — the receiving policy', () => {
  const p = (code: string, status: number, detail?: string) => new ApiProblem(code, status, detail);

  test('percentToBps by decimal string arithmetic — never float multiplication', () => {
    expect(percentToBps('5')).toEqual({ bps: 500, problem: null });
    expect(percentToBps('2.5')).toEqual({ bps: 250, problem: null });
    expect(percentToBps('0.01')).toEqual({ bps: 1, problem: null });
    expect(percentToBps('100')).toEqual({ bps: 10000, problem: null });
    expect(percentToBps('0')).toEqual({ bps: 0, problem: null });
    expect(percentToBps(' 7.25 ')).toEqual({ bps: 725, problem: null });
    expect(percentToBps('007')).toEqual({ bps: 700, problem: null });
    expect(percentToBps('.5')).toEqual({ bps: 50, problem: null });
    // 1.005 * 100 in floats is 100.49999… — a string conversion refuses it, never 100.
    expect(percentToBps('1.005')).toEqual({ bps: null, problem: 'The tolerance takes at most two decimal places (0.01 %).' });
    expect(percentToBps('100.01')).toEqual({ bps: null, problem: 'The tolerance is at most 100 %.' });
    expect(percentToBps('1000')).toEqual({ bps: null, problem: 'The tolerance is at most 100 %.' });
    const shape = 'Enter the tolerance as a percent from 0 to 100, e.g. 5 or 2.5.';
    for (const bad of ['', '  ', 'abc', '-1', '5%', '1e2', '.', '1.2.3']) expect(percentToBps(bad)).toEqual({ bps: null, problem: shape });
  });

  test('bpsToPercent by integer arithmetic', () => {
    expect(bpsToPercent(250)).toBe('2.5');
    expect(bpsToPercent(500)).toBe('5');
    expect(bpsToPercent(1)).toBe('0.01');
    expect(bpsToPercent(0)).toBe('0');
    expect(bpsToPercent(10000)).toBe('100');
    expect(bpsToPercent(725)).toBe('7.25');
    expect(bpsToPercent(5)).toBe('0.05');
    for (const bps of [0, 1, 9, 10, 99, 100, 101, 250, 999, 5000, 10000]) expect(percentToBps(bpsToPercent(bps)).bps).toBe(bps);
  });

  test('the form → the full-replace body; a minimum only beside Expiry required; problems per field', () => {
    // Story 2-4b — the form carries the derivation switch and sends it (explicit pin update).
    const fields = { tolerancePercent: '2.5', qcOnReceipt: true, expiryRequired: true, minShelfLifeDays: '90', deriveExpiry: true };
    expect(parseReceivingPolicyDraft(fields)).toEqual({
      body: { receivingToleranceBps: 250, qcOnReceipt: true, expiryRequired: true, minShelfLifeDays: 90, deriveExpiry: true },
      problems: null,
    });
    expect(parseReceivingPolicyDraft({ ...fields, deriveExpiry: false }).body?.deriveExpiry).toBe(false);
    expect(parseReceivingPolicyDraft({ ...fields, minShelfLifeDays: ' ' }).body?.minShelfLifeDays).toBeNull();
    // Without Expiry required the minimum is never sent (the backend 400s the pair).
    expect(parseReceivingPolicyDraft({ ...fields, expiryRequired: false }).body).toEqual({
      receivingToleranceBps: 250,
      qcOnReceipt: true,
      expiryRequired: false,
      minShelfLifeDays: null,
      deriveExpiry: true,
    });
    const days = 'The minimum shelf life is a whole number of days from 1 to 3650, or blank for none.';
    for (const bad of ['0', '3651', '1.5', 'x', '-3']) {
      expect(parseReceivingPolicyDraft({ ...fields, minShelfLifeDays: bad })).toEqual({ body: null, problems: { minShelfLife: days } });
    }
    expect(parseReceivingPolicyDraft({ ...fields, tolerancePercent: '1.005', minShelfLifeDays: '0' })).toEqual({
      body: null,
      problems: { tolerance: 'The tolerance takes at most two decimal places (0.01 %).', minShelfLife: days },
    });
    // Story 2-4b — an older answer without the switch reads as on; a sent one is kept.
    expect(receivingPolicyFieldsOf({ receivingToleranceBps: 1, qcOnReceipt: false, expiryRequired: false, minShelfLifeDays: null })).toEqual({
      tolerancePercent: '0.01',
      qcOnReceipt: false,
      expiryRequired: false,
      minShelfLifeDays: '',
      deriveExpiry: true,
    });
    expect(receivingPolicyFieldsOf({ receivingToleranceBps: 0, qcOnReceipt: false, expiryRequired: false, minShelfLifeDays: null, deriveExpiry: false }).deriveExpiry).toBe(false);
    expect(deriveExpiryLabel(undefined)).toBe("On — mfg date + the SKU's shelf life when no expiry is typed");
    expect(deriveExpiryLabel(false)).toBe("Off — only the label's typed expiry is used");
    expect(DERIVE_EXPIRY_LABEL).toBe("Set expiry from the SKU's shelf life when the label's expiry is not typed");
  });

  test('the read-only words, the panel notes and the saved outcome', () => {
    expect(receivingToleranceLabel(0)).toBe('None — any quantity over the PO or ASN waits for approval');
    expect(receivingToleranceLabel(250)).toBe('2.5 % — excess within it books at once');
    expect(qcOnReceiptLabel(true)).toBe('On — every booked line is held for QC until released');
    expect(qcOnReceiptLabel(false)).toBe('Off');
    expect(expiryRequiredLabel(true)).toBe('Required on batch-tracked lines');
    expect(expiryRequiredLabel(false)).toBe('Not required');
    expect(minShelfLifeLabel(null)).toBe('None');
    expect(minShelfLifeLabel(1)).toBe('1 day');
    expect(minShelfLifeLabel(90)).toBe('90 days');
    expect(untrackedSkusNote(3)).toBe("Expiry rules apply to batch-tracked SKUs only — 3 of this client's SKUs are untracked and receive as before.");
    expect(untrackedSkusNote(1)).toBe("Expiry rules apply to batch-tracked SKUs only — 1 of this client's SKUs is untracked and receives as before.");
    expect(untrackedSkusNote(0)).toBe("Expiry rules apply to batch-tracked SKUs only — every one of this client's SKUs is batch-tracked.");
    expect(QC_NOT_HELD_NOTE).toBe('Serial-tracked and catch-weight SKUs are not QC-held on receipt — they book unheld.');
    expect(receivingPolicySaved('ACME')).toEqual({
      word: "ACME's receiving policy saved",
      reason: 'It applies to every receipt submitted from now on — web, handheld and offline replay.',
    });
  });

  test('a validation-failed names its field (the backend detail); the reasons branch on code', () => {
    const tol = p('validation-failed', 400, 'receivingToleranceBps must be a whole number of basis points from 0 to 10000 (got 10001).');
    const min = p('validation-failed', 400, 'minShelfLifeDays needs expiryRequired — a minimum remaining life is judged against a required expiry date.');
    expect(receivingPolicyFieldOf(tol)).toBe('tolerance');
    expect(receivingPolicyFieldOf(min)).toBe('minShelfLife');
    expect(receivingPolicyFieldOf(p('validation-failed', 400, 'qcOnReceipt must be true or false'))).toBeNull();
    expect(receivingPolicyFieldOf(p('role-denied', 403, 'receivingToleranceBps'))).toBeNull();
    expect(receivingPolicyFieldOf(new Error('x'))).toBeNull();
    // The structured `field` member (the command's refusal) wins over the prose.
    expect(receivingPolicyFieldOf(new ApiProblem('validation-failed', 400, 'some other words', undefined, { field: 'minShelfLifeDays' }))).toBe('minShelfLife');
    expect(receivingPolicyFieldOf(new ApiProblem('validation-failed', 400, 'receivingToleranceBps …', undefined, { field: 'expiryRequired' }))).toBeNull();
    expect(receivingPolicyReason(tol)).toBe(tol.detail!);
    expect(receivingPolicyReason(p('validation-failed', 400))).toBe('Check the receiving policy and try again.');
    expect(receivingPolicyReason(p('role-denied', 403))).toBe('Only an owner can set a client’s receiving policy.');
    expect(receivingPolicyReason(p('not-found', 404))).toBe('That client no longer exists — refresh the page.');
    expect(receivingPolicyReason(p('permission-denied', 403))).toBe('Your session belongs to another tenant — sign in again.');
    expect(receivingPolicyReason(p('idempotency-key-reuse', 422))).toBe(
      'This submission was already processed with different details — edit and save again.',
    );
    expect(receivingPolicyReason(p('conflict', 409))).toBe('The same submission is still in flight — retry to read the settled result.');
    expect(receivingPolicyReason(p('unauthenticated', 401))).toBe('Your session expired — sign in again.');
    expect(receivingPolicyReason(p('mystery', 500))).toBe('Receiving policy not saved (mystery).');
    expect(receivingPolicyReason(new TypeError('fetch failed'))).toBe('The API is unreachable — is wms-be running?');
    expect(receivingPolicyReadReason(p('not-found', 404))).toBe('That client no longer exists — refresh the page.');
    expect(receivingPolicyReadReason(p('unauthenticated', 401))).toBe('Your session expired — sign in again.');
    expect(receivingPolicyReadReason(p('permission-denied', 403))).toBe('Your session belongs to another tenant — sign in again.');
    expect(receivingPolicyReadReason(p('mystery', 500, 'boom'))).toBe('boom');
    expect(receivingPolicyReadReason(p('mystery', 500))).toBe('Receiving policy not loaded (mystery).');
    expect(receivingPolicyReadReason(new TypeError('x'))).toBe('The API is unreachable — is wms-be running?');
  });
});
