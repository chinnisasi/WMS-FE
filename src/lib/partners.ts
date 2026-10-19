/**
 * Story 1-3 — the business partner master on the web: one partner per GST
 * registration with the roles vendor / consignee / transporter, and its
 * client links (vendors and consignees only).
 *
 * Pure: no React, no fetch. The parsers mirror the server's shape rules
 * (wms-be `partners.command.ts`) so a body the backend could only answer 400
 * to is never sent; uniqueness, state (an inactive partner, a departed
 * client) and authority stay the server's. Every sentence here is pinned by
 * `partners.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type { ClientDto, CreatePartnerDto, PartnerAddressInputDto, PartnerDto, UpdatePartnerDto } from '@/lib/api/generated';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { GST_STATE_NAMES, GSTIN_STATE_CODES } from '@/lib/gst-states';
import { parseGstinField } from '@/lib/gstin';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/** Fired on `window` after a partner mutation so readers refetch. */
export const PARTNERS_CHANGED_EVENT = 'wms-partners-changed';

export function notifyPartnersChanged(): void {
  window.dispatchEvent(new Event(PARTNERS_CHANGED_EVENT));
}

export type PartnerRole = PartnerDto['roles'][number];
export type PartnerLink = PartnerDto['links'][number];

/** The role vocabulary, in the server's canonical order. */
export const PARTNER_ROLES: readonly PartnerRole[] = ['vendor', 'consignee', 'transporter'];
/** The roles a client link carries — a transporter is shared, never linked. */
export const LINK_ROLES: readonly PartnerLink['role'][] = ['vendor', 'consignee'];

export const PARTNER_ROLE_LABEL: Readonly<Record<PartnerRole, string>> = {
  vendor: 'Vendor',
  consignee: 'Consignee',
  transporter: 'Transporter',
};

/** The PAN shape (wms-be `PAN_RE`): five letters, four digits, a letter. */
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
/** The server's ceilings (`partners.command.ts`). */
export const MAX_PARTNER_CODE_LENGTH = 64;
export const MAX_PARTNER_NAME_LENGTH = 200;
export const MAX_CONTACT_NAME_LENGTH = 120;
export const MAX_CONTACT_PHONE_LENGTH = 20;
export const MAX_REASON_LENGTH = 200;
export const MAX_LINK_CLIENT_CODE_LENGTH = 64;

/** The PAN inside a GSTIN (characters 3-12). */
export function panOfGstin(gstin: string): string {
  return gstin.trim().toUpperCase().slice(2, 12);
}

/**
 * The PAN field after a GSTIN edit: when the PAN still equals the OLD GSTIN's
 * PAN (or is blank), it follows the new GSTIN — the server refuses a PAN that
 * differs from the GSTIN's (`pan-gstin-mismatch`). A PAN typed by hand is kept.
 */
export function panAfterGstinEdit(previousGstin: string, nextGstin: string, pan: string): string {
  const current = pan.trim().toUpperCase();
  const tracked = current === '' || (previousGstin.trim() !== '' && current === panOfGstin(previousGstin));
  if (!tracked) return pan;
  const next = nextGstin.trim().toUpperCase();
  return next.length >= 12 ? panOfGstin(next) : '';
}

/** A registered-shape address form (an unset value is ''). */
export interface PartnerAddressFields {
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly stateCode: string;
  readonly pincode: string;
}

export const EMPTY_ADDRESS: PartnerAddressFields = Object.freeze({ line1: '', line2: '', city: '', stateCode: '', pincode: '' });

export function addressFieldsOf(address: PartnerDto['registeredAddress']): PartnerAddressFields {
  return address === null
    ? EMPTY_ADDRESS
    : { line1: address.line1, line2: address.line2 ?? '', city: address.city, stateCode: address.stateCode, pincode: address.pincode };
}

function isBlankAddress(fields: PartnerAddressFields): boolean {
  return Object.values(fields).every((value) => value.trim() === '');
}

/**
 * An address form → the wire group: all blank is `null` (no address), else
 * every field but line 2 required (all-or-none), the ceilings, a GST
 * registration state, a six-digit pincode. `label` names it in the problem.
 */
export function parsePartnerAddress(
  fields: PartnerAddressFields,
  label: string,
): { address: PartnerAddressInputDto | null; problem: string | null } {
  if (isBlankAddress(fields)) return { address: null, problem: null };
  const t = {
    line1: fields.line1.trim(),
    line2: fields.line2.trim(),
    city: fields.city.trim(),
    stateCode: fields.stateCode.trim(),
    pincode: fields.pincode.trim(),
  };
  const missing = (
    [
      ['line1', 'an address line 1'],
      ['city', 'a city'],
      ['stateCode', 'a state'],
      ['pincode', 'a pincode'],
    ] as const
  ).filter(([key]) => t[key] === '');
  if (missing.length > 0) {
    const labels = missing.map(([, text]) => text);
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    return { address: null, problem: `The ${label} needs ${list} — enter it whole, or clear it.` };
  }
  if ([...t.line1].length > 200 || [...t.line2].length > 200) return { address: null, problem: `A ${label} line is at most 200 characters.` };
  if ([...t.city].length > 100) return { address: null, problem: `The ${label} city is at most 100 characters.` };
  if (!GSTIN_STATE_CODES.includes(t.stateCode)) return { address: null, problem: `Choose the ${label} state from the list.` };
  if (!/^\d{6}$/.test(t.pincode)) return { address: null, problem: `The ${label} pincode is six digits.` };
  return {
    address: { line1: t.line1, ...(t.line2 === '' ? {} : { line2: t.line2 }), city: t.city, stateCode: t.stateCode, pincode: t.pincode },
    problem: null,
  };
}

/** The partner form (create and edit share it). */
export interface PartnerFormFields {
  readonly code: string;
  readonly name: string;
  readonly legalName: string;
  readonly gstin: string;
  readonly pan: string;
  readonly roles: readonly PartnerRole[];
  readonly registeredAddress: PartnerAddressFields;
  readonly dispatchAddress: PartnerAddressFields;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail: string;
}

export const EMPTY_PARTNER_FORM: PartnerFormFields = Object.freeze<PartnerFormFields>({
  code: '',
  name: '',
  legalName: '',
  gstin: '',
  pan: '',
  roles: ['vendor'],
  registeredAddress: EMPTY_ADDRESS,
  dispatchAddress: EMPTY_ADDRESS,
  contactName: '',
  contactPhone: '',
  contactEmail: '',
});

export function partnerFormOf(partner: PartnerDto): PartnerFormFields {
  return {
    code: partner.code,
    name: partner.name,
    legalName: partner.legalName ?? '',
    gstin: partner.gstin ?? '',
    pan: partner.pan ?? '',
    roles: [...partner.roles],
    registeredAddress: addressFieldsOf(partner.registeredAddress),
    dispatchAddress: addressFieldsOf(partner.dispatchAddress),
    contactName: partner.contactName ?? '',
    contactPhone: partner.contactPhone ?? '',
    contactEmail: partner.contactEmail ?? '',
  };
}

/** The validated values of a partner form (null = absent / cleared). */
export interface ParsedPartner {
  readonly code: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly gstin: string | null;
  readonly pan: string | null;
  readonly roles: PartnerRole[];
  readonly registeredAddress: PartnerAddressInputDto | null;
  readonly dispatchAddress: PartnerAddressInputDto | null;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The form → the validated values, or the first problem. Mirrors the
 * server's order: code, name, legal name, roles, GSTIN, PAN (derived from the
 * GSTIN when blank; a different PAN is refused), the addresses, the GSTIN's
 * state against the registered state, the contact.
 */
export function parsePartnerForm(fields: PartnerFormFields): { partner: ParsedPartner; problem: null } | { partner: null; problem: string } {
  const fail = (problem: string) => ({ partner: null, problem }) as const;
  const code = fields.code.trim();
  if (code === '' || [...code].length > MAX_PARTNER_CODE_LENGTH) return fail(`The code is 1-${MAX_PARTNER_CODE_LENGTH} characters.`);
  const name = fields.name.trim();
  if (name === '' || [...name].length > MAX_PARTNER_NAME_LENGTH) return fail(`The name is 1-${MAX_PARTNER_NAME_LENGTH} characters.`);
  const legalName = blankToNull(fields.legalName);
  if (legalName !== null && [...legalName].length > MAX_PARTNER_NAME_LENGTH) return fail(`The legal name is at most ${MAX_PARTNER_NAME_LENGTH} characters.`);
  const roles = PARTNER_ROLES.filter((role) => fields.roles.includes(role));
  if (roles.length === 0) return fail('Pick at least one role — vendor, consignee or transporter.');
  const gstinParse = parseGstinField(fields.gstin, 'GSTIN');
  if (gstinParse.problem !== null) return fail(gstinParse.problem);
  const gstin = gstinParse.gstin ?? null;
  let pan = blankToNull(fields.pan)?.toUpperCase() ?? null;
  if (pan !== null && !PAN_RE.test(pan)) return fail('The PAN is five letters, four digits and a letter (e.g. ABCDE1234F).');
  if (gstin !== null) {
    const derived = panOfGstin(gstin);
    if (pan === null) {
      if (!PAN_RE.test(derived)) return fail(`This GSTIN does not carry a PAN in characters 3-12 ("${derived}").`);
      pan = derived;
    } else if (pan !== derived) {
      return fail(`The PAN ${pan} is not the one inside the GSTIN (${derived}) — clear the PAN to take the GSTIN's.`);
    }
  }
  const registered = parsePartnerAddress(fields.registeredAddress, 'registered address');
  if (registered.problem !== null) return fail(registered.problem);
  const dispatch = parsePartnerAddress(fields.dispatchAddress, 'dispatch address');
  if (dispatch.problem !== null) return fail(dispatch.problem);
  if (gstin !== null && registered.address !== null && gstin.slice(0, 2) !== registered.address.stateCode) {
    const named = GST_STATE_NAMES[gstin.slice(0, 2)] ?? gstin.slice(0, 2);
    return fail(`This GSTIN is registered in ${named} (${gstin.slice(0, 2)}) — the registered address must be in that state. A registration in another state is another partner.`);
  }
  const contactName = blankToNull(fields.contactName);
  if (contactName !== null && [...contactName].length > MAX_CONTACT_NAME_LENGTH) return fail(`The contact name is at most ${MAX_CONTACT_NAME_LENGTH} characters.`);
  const contactPhone = blankToNull(fields.contactPhone);
  if (contactPhone !== null && contactPhone.length > MAX_CONTACT_PHONE_LENGTH) return fail(`The contact phone is at most ${MAX_CONTACT_PHONE_LENGTH} characters.`);
  const contactEmail = blankToNull(fields.contactEmail)?.toLowerCase() ?? null;
  if (contactEmail !== null && !EMAIL_SHAPE.test(contactEmail)) return fail('The contact email is not an email address.');
  return {
    partner: {
      code,
      name,
      legalName,
      gstin,
      pan,
      roles,
      registeredAddress: registered.address,
      dispatchAddress: dispatch.address,
      contactName,
      contactPhone,
      contactEmail,
    },
    problem: null,
  };
}

/** The create body: absent optional fields are dropped, never sent as `''` or null. */
export function createPartnerBody(parsed: ParsedPartner): CreatePartnerDto {
  return {
    code: parsed.code,
    name: parsed.name,
    roles: [...parsed.roles],
    ...(parsed.legalName === null ? {} : { legalName: parsed.legalName }),
    ...(parsed.gstin === null ? {} : { gstin: parsed.gstin }),
    ...(parsed.pan === null ? {} : { pan: parsed.pan }),
    ...(parsed.registeredAddress === null ? {} : { registeredAddress: parsed.registeredAddress }),
    ...(parsed.dispatchAddress === null ? {} : { dispatchAddress: parsed.dispatchAddress }),
    ...(parsed.contactName === null ? {} : { contactName: parsed.contactName }),
    ...(parsed.contactPhone === null ? {} : { contactPhone: parsed.contactPhone }),
    ...(parsed.contactEmail === null ? {} : { contactEmail: parsed.contactEmail }),
  };
}

function sameAddress(a: PartnerAddressInputDto | null, b: PartnerDto['registeredAddress']): boolean {
  if (a === null || b === null) return a === null && b === null;
  return a.line1 === b.line1 && (a.line2 ?? null) === (b.line2 ?? null) && a.city === b.city && a.stateCode === b.stateCode && a.pincode === b.pincode;
}

/**
 * The tri-state PATCH body: only the fields that changed against the stored
 * partner — an unchanged field is omitted, a cleared one is sent `null`.
 * An empty body means nothing changed.
 */
export function updatePartnerBody(parsed: ParsedPartner, current: PartnerDto): UpdatePartnerDto {
  const body: UpdatePartnerDto = {};
  if (parsed.code !== current.code) body.code = parsed.code;
  if (parsed.name !== current.name) body.name = parsed.name;
  if (parsed.legalName !== current.legalName) body.legalName = parsed.legalName;
  if (parsed.gstin !== current.gstin) body.gstin = parsed.gstin;
  if (parsed.pan !== current.pan) body.pan = parsed.pan;
  const currentRoles = PARTNER_ROLES.filter((role) => current.roles.includes(role));
  if (parsed.roles.join(',') !== currentRoles.join(',')) body.roles = [...parsed.roles];
  if (!sameAddress(parsed.registeredAddress, current.registeredAddress)) body.registeredAddress = parsed.registeredAddress;
  if (!sameAddress(parsed.dispatchAddress, current.dispatchAddress)) body.dispatchAddress = parsed.dispatchAddress;
  if (parsed.contactName !== current.contactName) body.contactName = parsed.contactName;
  if (parsed.contactPhone !== current.contactPhone) body.contactPhone = parsed.contactPhone;
  if (parsed.contactEmail !== current.contactEmail) body.contactEmail = parsed.contactEmail;
  return body;
}

/** The client a link names, as a short label — the tenant's own client is "Your company". */
export function linkClientLabel(clientId: string, clients: readonly ClientDto[] | null): string {
  const client = clients?.find((c) => c.id === clientId);
  if (client === undefined) return `Client …${clientId.slice(-8)}`;
  return client.systemOwned ? 'Your company' : client.code;
}

/** The partner's roles in a cell ("Vendor, Consignee"). */
export function rolesLabel(roles: readonly PartnerRole[]): string {
  return PARTNER_ROLES.filter((role) => roles.includes(role))
    .map((role) => PARTNER_ROLE_LABEL[role])
    .join(', ');
}

/** The linked-clients cell: each ACTIVE link's client, a default vendor starred. */
export function linkedClientsLabel(partner: Pick<PartnerDto, 'links'>, clients: readonly ClientDto[] | null): string {
  const active = partner.links.filter((link) => link.active);
  if (active.length === 0) return 'Not linked';
  return active
    .map((link) => `${linkClientLabel(link.clientId, clients)} (${PARTNER_ROLE_LABEL[link.role]}${link.isDefault ? ', default' : ''})`)
    .join(' · ');
}

export function partnerStatusLabel(partner: Pick<PartnerDto, 'status' | 'inactiveReason'>): string {
  if (partner.status === 'active') return 'Active';
  return partner.inactiveReason === null ? 'Inactive' : `Inactive — ${partner.inactiveReason}`;
}

/** The deactivation reason field → the wire value (blank = none). */
export function parseReason(text: string): { reason: string | null; problem: string | null } {
  const reason = blankToNull(text);
  if (reason !== null && [...reason].length > MAX_REASON_LENGTH) return { reason: null, problem: `The reason is at most ${MAX_REASON_LENGTH} characters.` };
  return { reason, problem: null };
}

/** The client's own code for a link → the wire value (blank = none; case kept). */
export function parseLinkClientCode(text: string): { clientCode: string | null; problem: string | null } {
  const clientCode = blankToNull(text);
  if (clientCode !== null && [...clientCode].length > MAX_LINK_CLIENT_CODE_LENGTH) {
    return { clientCode: null, problem: `The client's code is at most ${MAX_LINK_CLIENT_CODE_LENGTH} characters.` };
  }
  return { clientCode, problem: null };
}

/**
 * The vendors a replenishment draft may be submitted with: active partners
 * holding the vendor role with an ACTIVE vendor link to the draft's client.
 */
export function vendorsLinkedTo(partners: readonly PartnerDto[], clientId: string): PartnerDto[] {
  return partners.filter(
    (partner) =>
      partner.status === 'active' &&
      partner.roles.includes('vendor') &&
      partner.links.some((link) => link.clientId === clientId && link.role === 'vendor' && link.active),
  );
}

/** The fallback option for a draft whose vendor is not (or no longer) offered. */
export function unlinkedVendorLabel(name: string): string {
  return `${name} (not linked / inactive)`;
}

/** Every partner refusal, branched on `code`. */
export function partnerReason(error: unknown, action: 'saved' | 'created' | 'linked' | 'deactivated' | 'reactivated'): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'partner-code-taken':
        return error.detail ?? 'Another partner already uses that code.';
      case 'partner-gstin-taken':
        return error.detail ?? 'Another partner already holds that GSTIN — one partner is one GST registration.';
      case 'pan-gstin-mismatch':
        return error.detail ?? "The PAN is not the one inside the GSTIN — clear the PAN to take the GSTIN's.";
      case 'gstin-state-mismatch':
        return error.detail ?? "The GSTIN is registered in another state than the registered address.";
      case 'partner-role-in-use':
        return error.detail ?? 'That role still has active client links — switch them off first.';
      case 'link-exists':
        return 'This partner is already linked to that client in that role — switch the existing link on instead.';
      case 'link-client-code-taken':
        return error.detail ?? 'The client already uses that code for another partner.';
      case 'partner-inactive':
        return 'This partner is inactive — reactivate it first.';
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
      case 'default-vendor-conflict':
        return 'Another default vendor was set for this client at the same time — reload and try again.';
      case 'link-role-invalid':
        return error.detail ?? 'That role cannot be linked to a client.';
      case 'not-found':
        return 'That partner, link or client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot manage partners.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the fields and try again.';
      default:
        return error.detail ?? `Partner not ${action} (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
