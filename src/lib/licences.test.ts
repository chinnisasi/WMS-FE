import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { CoverageGapDto, LicenceListItemDto } from './api/generated';
import {
  ALL_COVERED_COPY,
  DRUG_NUMBER_RE,
  FSSAI_NUMBER_RE,
  KINDS_REQUIRING_VALID_UNTIL,
  LICENCE_KINDS,
  LICENCE_KIND_LABEL,
  LICENCE_NEED_LABEL,
  coveredByLabel,
  emptyLicenceDraft,
  expiryBadge,
  gapSentence,
  knownGaps,
  knownLicences,
  licenceDateCell,
  licenceDraftOf,
  licenceReason,
  normalizeLicenceNumber,
  parseLicenceDraft,
  parseLicenceEdit,
  validUntilLabel,
  type LicenceDraft,
  ENFORCE_OFF_QUESTION,
  enforceOnQuestion,
  enforcementReason,
  enforcementStateCopy,
  unacknowledgedGapCount,
} from './licences';

const C = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';
const W = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';

function draft(extra: Partial<LicenceDraft>): LicenceDraft {
  return { ...emptyLicenceDraft(), ...extra };
}

function problem(code: string, detail?: string): ApiProblem {
  return new ApiProblem(code, 400, detail);
}

describe('the mirrors equal the backend exactly (wms-be shared/primitives/licence.ts)', () => {
  test('the regexes, byte for byte, and the kind order', () => {
    // wms-be `FSSAI_NUMBER_RE` / `DRUG_NUMBER_RE`.
    expect(FSSAI_NUMBER_RE.source).toBe('^[0-9]{14}$');
    expect(DRUG_NUMBER_RE.source).toBe('^[A-Z0-9 /.-]{1,50}$');
    expect(LICENCE_KINDS).toEqual(['drug-20b', 'drug-21b', 'drug-20g', 'ndps', 'fssai-registration', 'fssai-state', 'fssai-central']);
    expect([...KINDS_REQUIRING_VALID_UNTIL].sort()).toEqual(['fssai-central', 'fssai-registration', 'fssai-state', 'ndps']);
    expect(Object.keys(LICENCE_NEED_LABEL)).toEqual(['drug-20b', 'drug-21b', 'drug-20g', 'ndps', 'fssai']);
  });

  test('normalisation: trimmed, spaces collapsed, upper-cased', () => {
    expect(normalizeLicenceNumber('  mh/pun/20b  12 ')).toBe('MH/PUN/20B 12');
  });
});

describe('parseLicenceDraft (add)', () => {
  test('a client licence for a site, the number normalised, blanks dropped from the body', () => {
    expect(parseLicenceDraft(draft({ clientId: C, warehouseId: W, kind: 'drug-20b', number: 'mh/pun/20b  12' }))).toEqual({
      body: { clientId: C, warehouseId: W, kind: 'drug-20b', number: 'MH/PUN/20B 12' },
      problem: null,
    });
  });

  test('a head-office FSSAI licence and a site licence', () => {
    expect(parseLicenceDraft(draft({ clientId: C, kind: 'fssai-state', number: '10012345678901', validUntil: '2027-03-31', note: ' HO ' })).body).toEqual({
      clientId: C,
      kind: 'fssai-state',
      number: '10012345678901',
      validUntil: '2027-03-31',
      note: 'HO',
    });
    expect(parseLicenceDraft(draft({ holder: 'site', warehouseId: W, kind: 'fssai-registration', number: '20012345678901', validUntil: '2027-03-31' })).body).toEqual({
      warehouseId: W,
      kind: 'fssai-registration',
      number: '20012345678901',
      validUntil: '2027-03-31',
    });
  });

  test('every refusal the client knows, named by field, sends nothing', () => {
    const cases: [Partial<LicenceDraft>, string][] = [
      [{ clientId: '' }, 'Holder'],
      [{ holder: 'site', warehouseId: '' }, 'Site'],
      [{ clientId: C, kind: 'fssai-registration', number: '10012345678901', validUntil: '2027-03-31' }, 'starts with 2'],
      [{ clientId: C, kind: 'fssai-state', number: '20012345678901', validUntil: '2027-03-31' }, 'starts with 1'],
      [{ clientId: C, kind: 'fssai-state', number: '1001234567890', validUntil: '2027-03-31' }, '14 digits'],
      [{ clientId: C, kind: 'drug-20b', number: 'MH#1' }, 'Number'],
      [{ clientId: C, kind: 'drug-20b', number: 'A'.repeat(51) }, 'Number'],
      [{ clientId: C, kind: 'ndps', number: 'N-1' }, 'Valid until: required'],
      [{ clientId: C, kind: 'fssai-central', number: '10012345678901' }, 'Valid until: required'],
      [{ clientId: C, kind: 'drug-20b', number: 'A', validFrom: '2027-02-02', validUntil: '2027-02-01' }, 'on or after'],
      [{ clientId: C, kind: 'drug-20b', number: 'A', validUntil: '2027-02-30' }, 'Valid until: enter a date'],
      [{ clientId: C, kind: 'drug-20b', number: 'A', note: 'n'.repeat(201) }, 'Note'],
    ];
    for (const [extra, words] of cases) {
      const parsed = parseLicenceDraft(draft(extra));
      expect(parsed.body).toBeNull();
      expect(parsed.problem).toContain(words);
    }
  });
});

describe('parseLicenceEdit', () => {
  test('sends the four editable fields; a blank date or note clears (null)', () => {
    const licence = {
      id: 'l-1', holder: 'client', clientId: C, warehouseId: null, kind: 'drug-20b', number: 'A-1',
      validFrom: '2026-01-01', validUntil: null, note: 'x', status: 'active', createdAt: '', updatedAt: '',
    } as const;
    const start = licenceDraftOf(licence);
    expect(start).toMatchObject({ holder: 'client', clientId: C, warehouseId: '', kind: 'drug-20b', validFrom: '2026-01-01', validUntil: '', note: 'x' });
    expect(parseLicenceEdit({ ...start, validFrom: '', note: '' })).toEqual({
      body: { number: 'A-1', validFrom: null, validUntil: null, note: null },
      problem: null,
    });
    // Clearing an FSSAI expiry is refused client-side too.
    expect(parseLicenceEdit({ ...start, kind: 'fssai-state', number: '10012345678901', validUntil: '' }).problem).toContain('Valid until: required');
  });
});

describe('gaps and badges', () => {
  const labels = { client: (id: string) => (id === C ? 'ACME' : '?'), site: (id: string) => (id === W ? 'WH-PUN' : '?') };

  test('a gap reads from its coveredBy: client and site, singular and plural', () => {
    const client: CoverageGapDto = { holder: 'client', clientId: C, warehouseId: W, need: 'drug-20g', coveredBy: ['drug-20g'], skuCount: 2 };
    expect(gapSentence(client, labels)).toBe('ACME at WH-PUN — client licence needed: Form 20G (2 SKUs)');
    const site: CoverageGapDto = { holder: 'site', warehouseId: W, need: 'fssai', coveredBy: ['fssai-registration', 'fssai-state', 'fssai-central'], skuCount: 1 };
    expect(gapSentence(site, labels)).toBe(
      'WH-PUN — site licence needed: FSSAI registration, FSSAI state licence or FSSAI central licence (1 SKU)',
    );
    expect(coveredByLabel(['ndps'])).toBe('NDPS licence');
    expect(ALL_COVERED_COPY).toBe('All drug and food goods are covered');
  });

  test('unknown needs and kinds from a newer backend are dropped at the mapping', () => {
    const gaps = [
      { holder: 'site', warehouseId: W, need: 'ayush', coveredBy: ['ayush-licence'], skuCount: 1 },
      { holder: 'site', warehouseId: W, need: 'fssai', coveredBy: ['fssai-state', 'fssai-hotel'], skuCount: 1 },
    ] as unknown as CoverageGapDto[];
    expect(knownGaps(gaps)).toEqual([{ holder: 'site', warehouseId: W, need: 'fssai', coveredBy: ['fssai-state'], skuCount: 1 }]);
    const items = [{ id: 'a', kind: 'drug-20b' }, { id: 'b', kind: 'homoeo-20c' }] as unknown as LicenceListItemDto[];
    expect(knownLicences(items).map((item) => item.id)).toEqual(['a']);
  });

  test('the badge is the server’s state and days, worded', () => {
    expect(expiryBadge({ expiryState: 'valid', daysLeft: 200 })).toEqual({ tone: 'ok', text: 'Valid' });
    expect(expiryBadge({ expiryState: 'upcoming', daysLeft: 60 })).toEqual({ tone: 'warning', text: 'Expires in 60 days' });
    expect(expiryBadge({ expiryState: 'upcoming', daysLeft: 1 })).toEqual({ tone: 'warning', text: 'Expires in 1 day' });
    expect(expiryBadge({ expiryState: 'upcoming', daysLeft: 0 })).toEqual({ tone: 'warning', text: 'Expires today' });
    expect(expiryBadge({ expiryState: 'expired', daysLeft: -3 })).toEqual({ tone: 'warning', text: 'Expired 3 days ago' });
    expect(expiryBadge({ expiryState: 'withdrawn', daysLeft: null })).toEqual({ tone: 'muted', text: 'Withdrawn' });
  });

  test('dates in IST words; the drug form’s date is the retention due date', () => {
    expect(licenceDateCell('2026-11-01')).toBe('1 Nov 2026');
    expect(licenceDateCell(null)).toBe('—');
    expect(validUntilLabel('drug-20b')).toBe('Valid until / retention due');
    expect(validUntilLabel('ndps')).toBe('Valid until');
    expect(validUntilLabel('fssai-state')).toBe('Valid until');
    expect(LICENCE_KIND_LABEL['drug-21b']).toBe('Form 21B');
  });
});

describe('licenceReason — every route arm', () => {
  test('the licence codes, the house set, and the transport arm', () => {
    expect(licenceReason(problem('licence-number-taken'), 'add')).toContain('already carries that number');
    expect(licenceReason(problem('licence-withdrawn'), 'edit')).toContain('withdrawn');
    expect(licenceReason(problem('client-departed'), 'add')).toContain('departed');
    expect(licenceReason(problem('not-found'), 'add')).toContain('client or site');
    expect(licenceReason(problem('not-found'), 'withdraw')).toContain('licence no longer exists');
    expect(licenceReason(problem('role-denied'), 'add')).toBe('Only an owner can manage licences.');
    expect(licenceReason(problem('role-denied'), 'read')).toBe('Licences are not available to this session.');
    expect(licenceReason(problem('permission-denied'), 'add')).toContain('another tenant');
    expect(licenceReason(problem('idempotency-key-reuse'), 'edit')).toContain('already processed');
    expect(licenceReason(problem('conflict'), 'withdraw')).toContain('in flight');
    expect(licenceReason(problem('unauthenticated'), 'read')).toContain('sign in again');
    expect(licenceReason(problem('validation-failed', 'number: An FSSAI number is 14 digits.'), 'add')).toBe('number: An FSSAI number is 14 digits.');
    expect(licenceReason(problem('teapot'), 'add')).toBe('Licence not saved (teapot).');
    expect(licenceReason(problem('teapot'), 'read')).toBe('Licence not loaded (teapot).');
    expect(licenceReason(new TypeError('fetch failed'), 'add')).toBe('The API is unreachable — is wms-be running?');
  });
});

describe('story 1-6d — the enforcement switch copy', () => {
  test('the turn-on question names the known gaps (singular and plural) or asks plainly', () => {
    expect(enforceOnQuestion(3)).toBe(
      'Turn on with 3 known coverage gaps? Uncovered receipts, including goods on open POs and ASNs, will go to review, and orders will be refused.',
    );
    expect(enforceOnQuestion(1)).toContain('Turn on with 1 known coverage gap?');
    expect(enforceOnQuestion(0)).toBe('Turn on licence enforcement? Uncovered receipts will go to review, and orders will be refused.');
    expect(ENFORCE_OFF_QUESTION).toContain('Turn off licence enforcement?');
    expect(enforcementStateCopy(true)).toContain('On —');
    expect(enforcementStateCopy(false)).toContain('Off —');
  });

  test('unacknowledgedGapCount reads only the 409 arm, from its extensions', () => {
    expect(unacknowledgedGapCount(new ApiProblem('licence-gaps-unacknowledged', 409, 'x', undefined, { gapCount: 2 }))).toBe(2);
    expect(unacknowledgedGapCount(new ApiProblem('licence-gaps-unacknowledged', 409))).toBeNull();
    expect(unacknowledgedGapCount(new ApiProblem('conflict', 409, undefined, undefined, { gapCount: 2 }))).toBeNull();
    expect(unacknowledgedGapCount(new Error('x'))).toBeNull();
    expect(enforcementReason(new ApiProblem('role-denied', 403))).toBe('Only an owner can turn licence enforcement on or off.');
  });
});
