import { ApiProblem } from '@/lib/api/client';
import type { AddLicenceDto, CoverageGapDto, EditLicenceDto, LicenceDto, LicenceListItemDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { formatIstDate } from '@/lib/rate-cards';

/**
 * Story 1-6c — the drug and FSSAI licences' copy, labels, draft parsing and
 * refusal wording, pure so every sentence is pinned by `licences.test.ts`.
 *
 * The web mirrors NO coverage rule: which kinds close a gap comes on the gap
 * itself (`coveredBy`), and the expiry badge (`expiryState`, `daysLeft`) is
 * the server's for its own IST date — the browser clock is never read.
 */

export type LicenceKind = LicenceDto['kind'];
export type LicenceNeed = CoverageGapDto['need'];
export type LicenceExpiryState = LicenceListItemDto['expiryState'];

/** The statutory form's name. A `Record` over the generated union: a new kind fails this file's compile until it has a label. */
export const LICENCE_KIND_LABEL: Readonly<Record<LicenceKind, string>> = {
  'drug-20b': 'Form 20B',
  'drug-21b': 'Form 21B',
  'drug-20g': 'Form 20G',
  ndps: 'NDPS licence',
  'fssai-registration': 'FSSAI registration',
  'fssai-state': 'FSSAI state licence',
  'fssai-central': 'FSSAI central licence',
};

/** What a need is for. */
export const LICENCE_NEED_LABEL: Readonly<Record<LicenceNeed, string>> = {
  'drug-20b': 'Schedule G, H and H1 drugs',
  'drug-21b': 'Schedule C and C1 drugs',
  'drug-20g': 'Schedule X drugs',
  ndps: 'NDPS drugs',
  fssai: 'food',
};

/** The kinds in the backend's order (`LICENCE_KINDS`). */
export const LICENCE_KINDS = Object.keys(LICENCE_KIND_LABEL) as LicenceKind[];

const KNOWN_KINDS: ReadonlySet<string> = new Set(LICENCE_KINDS);
const KNOWN_NEEDS: ReadonlySet<string> = new Set(Object.keys(LICENCE_NEED_LABEL));

/** The FSSAI tiers — one number family, a 14-digit number. */
export const FSSAI_KINDS: readonly LicenceKind[] = ['fssai-registration', 'fssai-state', 'fssai-central'];

/** Kinds with a fixed term: `validUntil` required (wms-be `KINDS_REQUIRING_VALID_UNTIL`). */
export const KINDS_REQUIRING_VALID_UNTIL: readonly LicenceKind[] = ['ndps', ...FSSAI_KINDS];

/** wms-be `shared/primitives/licence.ts` `FSSAI_NUMBER_RE` — byte for byte (pinned by the test). */
export const FSSAI_NUMBER_RE = /^[0-9]{14}$/;
/** wms-be `shared/primitives/licence.ts` `DRUG_NUMBER_RE` — byte for byte (pinned by the test). */
export const DRUG_NUMBER_RE = /^[A-Z0-9 /.-]{1,50}$/;
/** The backend's `LICENCE_NOTE_MAX`. */
export const LICENCE_NOTE_MAX = 200;

/** Trimmed, spaces collapsed, upper-cased — the backend's normalisation. */
export function normalizeLicenceNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** A real calendar date `YYYY-MM-DD`. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Why a (normalised) number is not a number of its kind, or null. Mirrors the backend's `licenceNumberProblem`. */
export function licenceNumberProblem(kind: LicenceKind, number: string): string | null {
  if (FSSAI_KINDS.includes(kind)) {
    if (!FSSAI_NUMBER_RE.test(number)) return 'An FSSAI number is 14 digits.';
    if (kind === 'fssai-registration' && !number.startsWith('2')) {
      return 'An FSSAI registration number starts with 2 — a number starting with 1 is a state or central licence.';
    }
    if (kind !== 'fssai-registration' && !number.startsWith('1')) {
      return 'An FSSAI state or central licence number starts with 1 — a number starting with 2 is a registration.';
    }
    return null;
  }
  if (!DRUG_NUMBER_RE.test(number)) {
    return 'A licence number is 1–50 characters of A–Z, 0–9, space, "/", "." and "-".';
  }
  return null;
}

/** The form's draft — everything as the inputs hold it. */
export interface LicenceDraft {
  /** `client` — a brand's licence; `site` — the 3PL's own site's. */
  readonly holder: 'client' | 'site';
  /** The client (a client licence). */
  readonly clientId: string;
  /** The site (required for a site licence; optional for a client's — its premises). */
  readonly warehouseId: string;
  readonly kind: LicenceKind;
  readonly number: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly note: string;
}

export function emptyLicenceDraft(): LicenceDraft {
  return { holder: 'client', clientId: '', warehouseId: '', kind: 'drug-20b', number: '', validFrom: '', validUntil: '', note: '' };
}

/** The edit form's starting draft from a stored licence. */
export function licenceDraftOf(licence: LicenceDto): LicenceDraft {
  return {
    holder: licence.holder,
    clientId: licence.clientId ?? '',
    warehouseId: licence.warehouseId ?? '',
    kind: licence.kind,
    number: licence.number,
    validFrom: licence.validFrom ?? '',
    validUntil: licence.validUntil ?? '',
    note: licence.note ?? '',
  };
}

type Fields = { number: string; validFrom: string | null; validUntil: string | null; note: string | null };

/** The rules the client knows (the backend's, mirrored): number, dates, the note. Sends nothing when a problem is set. */
function parseFields(draft: LicenceDraft): { fields: Fields; problem: null } | { fields: null; problem: string } {
  const number = normalizeLicenceNumber(draft.number);
  const numberProblem = licenceNumberProblem(draft.kind, number);
  if (numberProblem !== null) return { fields: null, problem: `Number: ${numberProblem}` };
  const validFrom = draft.validFrom.trim() === '' ? null : draft.validFrom.trim();
  const validUntil = draft.validUntil.trim() === '' ? null : draft.validUntil.trim();
  if (validFrom !== null && !isIsoDate(validFrom)) return { fields: null, problem: 'Valid from: enter a date.' };
  if (validUntil !== null && !isIsoDate(validUntil)) return { fields: null, problem: 'Valid until: enter a date.' };
  if (validUntil === null && KINDS_REQUIRING_VALID_UNTIL.includes(draft.kind)) {
    return { fields: null, problem: `Valid until: required for ${LICENCE_KIND_LABEL[draft.kind]} — FSSAI and NDPS licences carry a fixed term.` };
  }
  if (validFrom !== null && validUntil !== null && validUntil < validFrom) {
    return { fields: null, problem: 'Valid until: on or after Valid from.' };
  }
  const note = draft.note.trim() === '' ? null : draft.note.trim();
  if (note !== null && [...note].length > LICENCE_NOTE_MAX) {
    return { fields: null, problem: `Note: at most ${LICENCE_NOTE_MAX} characters.` };
  }
  return { fields: { number, validFrom, validUntil, note }, problem: null };
}

/** The add body, or the first problem (named by field). An unset optional field is dropped from the body. */
export function parseLicenceDraft(draft: LicenceDraft): { body: AddLicenceDto; problem: null } | { body: null; problem: string } {
  if (draft.holder === 'client' && draft.clientId === '') return { body: null, problem: 'Holder: choose a client.' };
  if (draft.holder === 'site' && draft.warehouseId === '') return { body: null, problem: 'Site: choose the site that holds it.' };
  const parsed = parseFields(draft);
  if (parsed.fields === null) return { body: null, problem: parsed.problem };
  const { number, validFrom, validUntil, note } = parsed.fields;
  return {
    body: {
      ...(draft.holder === 'client' ? { clientId: draft.clientId } : {}),
      ...(draft.warehouseId === '' ? {} : { warehouseId: draft.warehouseId }),
      kind: draft.kind,
      number,
      ...(validFrom === null ? {} : { validFrom }),
      ...(validUntil === null ? {} : { validUntil }),
      ...(note === null ? {} : { note }),
    },
    problem: null,
  };
}

/** The edit body — the four editable fields, a blank one cleared (null). Kind, holder and site are fixed. */
export function parseLicenceEdit(draft: LicenceDraft): { body: EditLicenceDto; problem: null } | { body: null; problem: string } {
  const parsed = parseFields(draft);
  if (parsed.fields === null) return { body: null, problem: parsed.problem };
  return { body: parsed.fields, problem: null };
}

/** The list's rows this build can draw (an unknown kind from a newer backend is dropped). */
export function knownLicences(items: readonly LicenceListItemDto[]): LicenceListItemDto[] {
  return items.filter((item) => KNOWN_KINDS.has(item.kind));
}

/** The gaps this build can word: an unknown need is dropped, unknown kinds leave `coveredBy`. */
export function knownGaps(gaps: readonly CoverageGapDto[]): CoverageGapDto[] {
  return gaps
    .filter((gap) => KNOWN_NEEDS.has(gap.need))
    .map((gap) => ({ ...gap, coveredBy: gap.coveredBy.filter((kind) => KNOWN_KINDS.has(kind)) }));
}

/** `Form 20G`; `FSSAI registration, FSSAI state licence or FSSAI central licence`. */
export function coveredByLabel(kinds: readonly LicenceKind[]): string {
  const labels = kinds.map((kind) => LICENCE_KIND_LABEL[kind]);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/**
 * One gap as a sentence:
 * `ACME at WH-PUN — client licence needed: Form 20G (2 SKUs)`;
 * `WH-PUN — site licence needed: FSSAI registration, … (1 SKU)`.
 */
export function gapSentence(gap: CoverageGapDto, labels: { client: (id: string) => string; site: (id: string) => string }): string {
  const skus = `${gap.skuCount} ${gap.skuCount === 1 ? 'SKU' : 'SKUs'}`;
  const needed = `${coveredByLabel(gap.coveredBy)} (${skus})`;
  return gap.holder === 'client' && gap.clientId !== undefined
    ? `${labels.client(gap.clientId)} at ${labels.site(gap.warehouseId)} — client licence needed: ${needed}`
    : `${labels.site(gap.warehouseId)} — site licence needed: ${needed}`;
}

export const ALL_COVERED_COPY = 'All drug and food goods are covered';

/** The server's badge, worded: `Valid`, `Expires in 12 days`, `Expires today`, `Expired 3 days ago`, `Withdrawn`. */
export function expiryBadge(item: Pick<LicenceListItemDto, 'expiryState' | 'daysLeft'>): { tone: 'ok' | 'warning' | 'muted'; text: string } {
  switch (item.expiryState) {
    case 'upcoming': {
      const days = item.daysLeft ?? 0;
      return { tone: 'warning', text: days === 0 ? 'Expires today' : `Expires in ${days} ${days === 1 ? 'day' : 'days'}` };
    }
    case 'expired': {
      const days = Math.abs(item.daysLeft ?? 0);
      return { tone: 'warning', text: `Expired ${days} ${days === 1 ? 'day' : 'days'} ago` };
    }
    case 'withdrawn':
      return { tone: 'muted', text: 'Withdrawn' };
    case 'valid':
      return { tone: 'ok', text: 'Valid' };
    default:
      return { tone: 'muted', text: '—' };
  }
}

/** A `YYYY-MM-DD` cell (`1 Nov 2026`), or `—`. */
export function licenceDateCell(date: string | null): string {
  return date === null ? '—' : formatIstDate(date);
}

/** The until column's heading per kind: a drug form's date is the retention due date (decision 6). */
export function validUntilLabel(kind: LicenceKind): string {
  return FSSAI_KINDS.includes(kind) || kind === 'ndps' ? 'Valid until' : 'Valid until / retention due';
}

export type LicenceAction = 'add' | 'edit' | 'withdraw' | 'read';

/** Every route arm, worded for the action that met it (the house mapper skeleton, `IMPLEMENTATION-GUIDE` §3). */
export function licenceReason(error: unknown, action: LicenceAction): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'licence-number-taken':
        return 'Another active licence of this family already carries that number — withdraw it first, or correct the number.';
      case 'licence-withdrawn':
        return 'This licence was withdrawn — it can no longer change. Add a new licence instead.';
      case 'client-departed':
        return 'That client has departed — it can hold no new licence. Reactivate it in Settings → Clients first.';
      case 'not-found':
        return action === 'add'
          ? 'That client or site no longer exists — refresh the page.'
          : 'That licence no longer exists — refresh the list.';
      case 'role-denied':
        return action === 'read' ? 'Licences are not available to this session.' : 'Only an owner can manage licences.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — edit and save again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the licence and try again.';
      default:
        return error.detail ?? `Licence ${action === 'read' ? 'not loaded' : 'not saved'} (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** Cross-surface invalidation (`IMPLEMENTATION-GUIDE` §1.4). */
export const LICENCES_CHANGED_EVENT = 'wms-licences-changed';
export function notifyLicencesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LICENCES_CHANGED_EVENT));
}
