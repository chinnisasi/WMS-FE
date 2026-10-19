import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ClientDto, PartnerDto } from './api/generated';
import { CLIENT_DEPARTED_REASON } from './client-departed';
import {
  EMPTY_ADDRESS,
  EMPTY_PARTNER_FORM,
  createPartnerBody,
  linkClientLabel,
  linkedClientsLabel,
  panAfterGstinEdit,
  panOfGstin,
  parseLinkClientCode,
  parsePartnerAddress,
  parsePartnerForm,
  parseReason,
  partnerFormOf,
  partnerReason,
  partnerStatusLabel,
  rolesLabel,
  unlinkedVendorLabel,
  updatePartnerBody,
  vendorsLinkedTo,
  type PartnerFormFields,
} from './partners';
import { UNREACHABLE_REASON } from './outbound-orders';

const GSTIN = '27ABCDE1234F1Z5';
const ADDRESS = { line1: '1 Road', line2: '', city: 'Pune', stateCode: '27', pincode: '411001' };

function partner(over: Partial<PartnerDto> = {}): PartnerDto {
  return {
    id: 'p-1',
    tenantId: 't-1',
    code: 'V-1',
    name: 'Prime',
    legalName: null,
    gstin: null,
    pan: null,
    roles: ['vendor'],
    registeredAddress: null,
    dispatchAddress: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    status: 'active',
    inactiveReason: null,
    links: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

function form(over: Partial<PartnerFormFields> = {}): PartnerFormFields {
  return { ...EMPTY_PARTNER_FORM, code: 'V-1', name: 'Prime', ...over };
}

function problem(code: string, status = 409, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

describe('PAN', () => {
  test('the PAN inside a GSTIN is characters 3-12', () => {
    expect(panOfGstin(GSTIN)).toBe('ABCDE1234F');
    expect(panOfGstin(' 27abcde1234f1z5 ')).toBe('ABCDE1234F');
  });

  test('a PAN that tracked the old GSTIN (or was blank) follows the new one; a hand-typed one is kept', () => {
    expect(panAfterGstinEdit(GSTIN, '29ZZZZZ9999Z1Z5', 'ABCDE1234F')).toBe('ZZZZZ9999Z');
    expect(panAfterGstinEdit('', GSTIN, '')).toBe('ABCDE1234F');
    expect(panAfterGstinEdit(GSTIN, '29ZZZZZ9999Z1Z5', 'QQQQQ1111Q')).toBe('QQQQQ1111Q');
    // A partial GSTIN mid-typing clears a tracked PAN rather than guessing.
    expect(panAfterGstinEdit(GSTIN, '27AB', 'ABCDE1234F')).toBe('');
  });
});

describe('parsePartnerForm', () => {
  test('a GSTIN with no PAN derives the PAN; blank optionals are null', () => {
    const parsed = parsePartnerForm(form({ gstin: ' 27abcde1234f1z5 ', registeredAddress: ADDRESS }));
    expect(parsed.problem).toBeNull();
    expect(parsed.partner).toMatchObject({ gstin: GSTIN, pan: 'ABCDE1234F', legalName: null, dispatchAddress: null });
    expect(parsed.partner!.registeredAddress).toEqual({ line1: '1 Road', city: 'Pune', stateCode: '27', pincode: '411001' });
  });

  test('a PAN other than the GSTIN\'s is refused before sending (the server answers pan-gstin-mismatch)', () => {
    expect(parsePartnerForm(form({ gstin: GSTIN, pan: 'ZZZZZ9999Z' })).problem).toBe(
      "The PAN ZZZZZ9999Z is not the one inside the GSTIN (ABCDE1234F) — clear the PAN to take the GSTIN's.",
    );
  });

  test('a malformed PAN, a malformed GSTIN, no role, no code are each refused', () => {
    expect(parsePartnerForm(form({ pan: 'ABCDE12345' })).problem).toContain('five letters, four digits and a letter');
    expect(parsePartnerForm(form({ gstin: '27ABC' })).problem).toContain('GSTIN is 15 characters');
    expect(parsePartnerForm(form({ roles: [] })).problem).toBe('Pick at least one role — vendor, consignee or transporter.');
    expect(parsePartnerForm(form({ code: '  ' })).problem).toBe('The code is 1-64 characters.');
  });

  test('the GSTIN\'s state must be the registered address\'s', () => {
    const parsed = parsePartnerForm(form({ gstin: GSTIN, registeredAddress: { ...ADDRESS, stateCode: '29', pincode: '560001' } }));
    expect(parsed.problem).toContain('(27) — the registered address must be in that state');
  });

  test('an address is all-or-none; blank is no address', () => {
    expect(parsePartnerAddress(EMPTY_ADDRESS, 'dispatch address')).toEqual({ address: null, problem: null });
    expect(parsePartnerAddress({ ...EMPTY_ADDRESS, line1: 'x' }, 'dispatch address').problem).toBe(
      'The dispatch address needs a city, a state and a pincode — enter it whole, or clear it.',
    );
    expect(parsePartnerAddress({ ...ADDRESS, pincode: '4110' }, 'registered address').problem).toBe('The registered address pincode is six digits.');
  });

  test('roles come out in canonical order', () => {
    expect(parsePartnerForm(form({ roles: ['transporter', 'vendor'] })).partner!.roles).toEqual(['vendor', 'transporter']);
  });
});

describe('bodies', () => {
  test('create drops absent fields rather than sending blanks or nulls', () => {
    const parsed = parsePartnerForm(form({ gstin: GSTIN }));
    expect(createPartnerBody(parsed.partner!)).toEqual({ code: 'V-1', name: 'Prime', roles: ['vendor'], gstin: GSTIN, pan: 'ABCDE1234F' });
  });

  test('the PATCH is tri-state: unchanged omitted, cleared sent as null', () => {
    const current = partner({ gstin: GSTIN, pan: 'ABCDE1234F', legalName: 'Prime Pvt Ltd', registeredAddress: { ...ADDRESS, line2: null } });
    const fields = partnerFormOf(current);
    expect(updatePartnerBody(parsePartnerForm(fields).partner!, current)).toEqual({});
    // Clear the GSTIN and the legal name — the PAN is kept (the server keeps it too).
    const cleared = parsePartnerForm({ ...fields, gstin: '', legalName: '' }).partner!;
    expect(updatePartnerBody(cleared, current)).toEqual({ gstin: null, legalName: null });
    // Clear the address group.
    const noAddress = parsePartnerForm({ ...fields, registeredAddress: EMPTY_ADDRESS }).partner!;
    expect(updatePartnerBody(noAddress, current)).toEqual({ registeredAddress: null });
    // A role added sends the full new set.
    const roles = parsePartnerForm({ ...fields, roles: ['consignee', 'vendor'] }).partner!;
    expect(updatePartnerBody(roles, current)).toEqual({ roles: ['vendor', 'consignee'] });
  });
});

describe('labels', () => {
  const clients = [
    { id: 'c-self', code: 'self', name: 'Priya', systemOwned: true, status: 'active' },
    { id: 'c-acme', code: 'ACME', name: 'Acme', systemOwned: false, status: 'active' },
  ] as unknown as ClientDto[];

  test('the self client is "Your company"; a default vendor link is starred; inactive links are left out', () => {
    expect(linkClientLabel('c-self', clients)).toBe('Your company');
    const p = partner({
      links: [
        { id: 'l-1', clientId: 'c-self', role: 'vendor', active: true, isDefault: true, clientCode: null },
        { id: 'l-2', clientId: 'c-acme', role: 'consignee', active: true, isDefault: false, clientCode: 'C-9' },
        { id: 'l-3', clientId: 'c-acme', role: 'vendor', active: false, isDefault: false, clientCode: null },
      ],
    });
    expect(linkedClientsLabel(p, clients)).toBe('Your company (Vendor, default) · ACME (Consignee)');
    expect(linkedClientsLabel(partner(), clients)).toBe('Not linked');
  });

  test('roles and status read in words', () => {
    expect(rolesLabel(['transporter', 'vendor'])).toBe('Vendor, Transporter');
    expect(partnerStatusLabel(partner())).toBe('Active');
    expect(partnerStatusLabel(partner({ status: 'inactive', inactiveReason: 'stopped trading' }))).toBe('Inactive — stopped trading');
    expect(unlinkedVendorLabel('Prime')).toBe('Prime (not linked / inactive)');
  });

  test('reason and client code: blank is none, over-long is refused', () => {
    expect(parseReason('  ')).toEqual({ reason: null, problem: null });
    expect(parseReason('x'.repeat(201)).problem).toBe('The reason is at most 200 characters.');
    expect(parseLinkClientCode(' Sup-9 ')).toEqual({ clientCode: 'Sup-9', problem: null });
  });
});

describe('vendorsLinkedTo', () => {
  test('only active vendor-role partners with an ACTIVE vendor link to the client', () => {
    const linked = partner({ id: 'a', links: [{ id: 'l', clientId: 'c-1', role: 'vendor', active: true, isDefault: false, clientCode: null }] });
    const off = partner({ id: 'b', links: [{ id: 'l', clientId: 'c-1', role: 'vendor', active: false, isDefault: false, clientCode: null }] });
    const consignee = partner({ id: 'c', roles: ['vendor', 'consignee'], links: [{ id: 'l', clientId: 'c-1', role: 'consignee', active: true, isDefault: false, clientCode: null }] });
    const inactive = partner({ id: 'd', status: 'inactive', links: linked.links });
    const other = partner({ id: 'e', links: [{ id: 'l', clientId: 'c-2', role: 'vendor', active: true, isDefault: false, clientCode: null }] });
    expect(vendorsLinkedTo([linked, off, consignee, inactive, other], 'c-1').map((p) => p.id)).toEqual(['a']);
  });
});

describe('partnerReason', () => {
  test('each partner code is worded; the transport arm is the house copy', () => {
    expect(partnerReason(problem('link-exists'), 'linked')).toBe(
      'This partner is already linked to that client in that role — switch the existing link on instead.',
    );
    expect(partnerReason(problem('partner-gstin-taken', 409, 'GSTIN 27… already belongs to partner "V-9"'), 'created')).toBe(
      'GSTIN 27… already belongs to partner "V-9"',
    );
    expect(partnerReason(problem('partner-inactive'), 'linked')).toBe('This partner is inactive — reactivate it first.');
    expect(partnerReason(problem('client-departed'), 'linked')).toBe(CLIENT_DEPARTED_REASON);
    expect(partnerReason(problem('default-vendor-conflict'), 'linked')).toContain('Another default vendor was set');
    expect(partnerReason(problem('role-denied', 403), 'saved')).toBe('Your role cannot manage partners.');
    expect(partnerReason(problem('something-new', 409), 'saved')).toBe('Partner not saved (something-new).');
    expect(partnerReason(new Error('fetch failed'), 'saved')).toBe(UNREACHABLE_REASON);
  });
});
