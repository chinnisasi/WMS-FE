import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import {
  BIN_CLIENTS_UNAVAILABLE,
  SHARED_BIN_LABEL,
  binClientCell,
  binClientOptions,
  binClientPatch,
  binClientReason,
  binClientSavedWord,
  dedicatedClientBody,
  mergeTargetLabel,
} from './bin-clients';
import { CLIENT_DEPARTED_REASON } from './client-departed';
import { UNREACHABLE_REASON } from './outbound-orders';
import { binClassReason } from './sku-admin';

/** Story 1-5b — the dedicated-bin copy and derivations, pinned byte for byte. */

function client(over: Partial<ClientDto> = {}): ClientDto {
  return {
    id: 'c-glow',
    tenantId: 't-1',
    code: 'GLOW',
    name: 'GlowCo',
    status: 'active',
    systemOwned: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    taxDetails: {
      legalName: null,
      gstin: null,
      billingLine1: null,
      billingLine2: null,
      billingCity: null,
      billingStateCode: null,
      billingPincode: null,
    },
    registeredAddress: null,
    returnAddress: null,
    ...over,
  } as ClientDto;
}
const SELF = client({ id: 'c-self', code: 'self', name: 'Priya Spices', systemOwned: true });
const GLOW = client();
const SUSP = client({ id: 'c-susp', code: 'SUSP', name: 'Susp Co', status: 'suspended' });
const GONE = client({ id: 'c-gone', code: 'GONE', name: 'Gone Co', status: 'departed' });
const ALL = [SELF, GLOW, SUSP, GONE];

describe('binClientCell', () => {
  test('null is Shared; a client reads its short label; departed says so; unknown reads as unknown', () => {
    expect(binClientCell(null, ALL)).toBe(SHARED_BIN_LABEL);
    expect(binClientCell(undefined, ALL)).toBe('Shared');
    expect(binClientCell('c-glow', ALL)).toBe('GLOW');
    expect(binClientCell('c-self', ALL)).toBe('Priya Spices');
    expect(binClientCell('c-gone', ALL)).toBe('GONE (departed)');
    expect(binClientCell('c-x', ALL)).toBe('Unknown client');
  });
});

describe('binClientOptions', () => {
  test('Shared first, then every client taking work (suspended included); departed hidden', () => {
    expect(binClientOptions(ALL)).toEqual([
      { value: '', label: 'Shared', disabled: false },
      { value: 'c-self', label: 'Priya Spices', disabled: false },
      { value: 'c-glow', label: 'GLOW', disabled: false },
      { value: 'c-susp', label: 'SUSP', disabled: false },
    ]);
  });
  test('a CURRENT departed client is kept as a disabled option', () => {
    expect(binClientOptions(ALL, 'c-gone').at(-1)).toEqual({ value: 'c-gone', label: 'GONE (departed)', disabled: true });
  });
});

describe('binClientPatch', () => {
  test('unchanged sends nothing; a pick dedicates; Shared clears to null', () => {
    expect(binClientPatch(null, '')).toBeNull();
    expect(binClientPatch(undefined, '')).toBeNull();
    expect(binClientPatch('c-gone', 'c-gone')).toBeNull();
    expect(binClientPatch(null, 'c-glow')).toEqual({ dedicatedClientId: 'c-glow' });
    expect(binClientPatch('c-glow', '')).toEqual({ dedicatedClientId: null });
  });
});

describe('dedicatedClientBody', () => {
  test('the key rides only when a client is chosen', () => {
    expect(dedicatedClientBody('')).toEqual({});
    expect(dedicatedClientBody('c-glow')).toEqual({ dedicatedClientId: 'c-glow' });
  });
});

describe('mergeTargetLabel and the saved word', () => {
  test('a dedicated target names its client; shared or not-loaded reads the code', () => {
    expect(mergeTargetLabel({ code: 'A-01', dedicatedClientId: 'c-glow' }, ALL)).toBe('A-01 — GLOW');
    expect(mergeTargetLabel({ code: 'A-01', dedicatedClientId: null }, ALL)).toBe('A-01');
    expect(mergeTargetLabel({ code: 'A-01', dedicatedClientId: 'c-glow' }, null)).toBe('A-01');
  });
  test('the saved word speaks from the response', () => {
    expect(binClientSavedWord('A-01', 'c-glow', ALL)).toBe('A-01 dedicated to GLOW');
    expect(binClientSavedWord('A-01', null, ALL)).toBe('A-01 is shared again');
  });
  test('the unavailable note', () => {
    expect(BIN_CLIENTS_UNAVAILABLE).toBe(
      'Clients could not be loaded — the Client column and dedicated-bin editing are unavailable until they load.',
    );
  });
});

describe('binClientReason / binClassReason (the 1-5b codes)', () => {
  test('client not-found reads as the client, never the bin', () => {
    expect(binClientReason(new ApiProblem('not-found', 404, 'No client'))).toBe('That client no longer exists — refresh the page.');
  });
  test('conflict and mismatch render the server detail; departed the shared copy', () => {
    expect(binClientReason(new ApiProblem('bin-client-conflict', 409, 'Bin "A" … "S-1"'))).toBe('Bin "A" … "S-1"');
    expect(binClientReason(new ApiProblem('client-departed', 409, 'x'))).toBe(CLIENT_DEPARTED_REASON);
    expect(binClientReason(new ApiProblem('bin-client-mismatch', 400, 'dedicated to GLOW'))).toBe('dedicated to GLOW');
    expect(binClassReason(new ApiProblem('bin-client-mismatch', 400))).toBe('That bin is dedicated to another client — choose another bin.');
    expect(binClassReason(new ApiProblem('bin-client-conflict', 409))).toBe("The bin holds another client's stock or QC holds — move them first.");
    expect(binClassReason(new ApiProblem('client-departed', 409))).toBe(CLIENT_DEPARTED_REASON);
    expect(binClientReason(new Error('down'))).toBe(UNREACHABLE_REASON);
  });
});
