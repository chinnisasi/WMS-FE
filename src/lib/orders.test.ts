import { describe, expect, test } from 'bun:test';

import {
  CLIENT_ORDER_REF_RE,
  clientOrderRefBody,
  isFollowOn,
  MAX_CLIENT_ORDER_REF_LENGTH,
  nextFollowOnLabel,
  orderLabel,
  orderRootLabel,
  parseClientOrderRef,
  parseOrderSearch,
  shortOrderId,
} from './orders';

const ID = '0198f7a2-1b3c-7d4e-8f90-0c1d2e3f4a5b';

describe('the order label (story 4-1b)', () => {
  test('shortOrderId is the LAST eight characters — the backend’s right(id::text, 8), never the timestamp head', () => {
    expect(shortOrderId(ID)).toBe('2e3f4a5b');
    expect(shortOrderId(ID)).toBe(ID.slice(-8));
    expect(shortOrderId(ID)).not.toBe(ID.slice(0, 8));
  });

  test('clientOrderRef ?? externalEventId ?? shortOrderId — a blank or absent value never wins', () => {
    expect(orderLabel({ id: ID, clientOrderRef: 'SO-1042', externalEventId: 'AMZ-9' })).toBe('SO-1042');
    expect(orderLabel({ id: ID, clientOrderRef: null, externalEventId: 'AMZ-9' })).toBe('AMZ-9');
    expect(orderLabel({ id: ID, clientOrderRef: null, externalEventId: null })).toBe('2e3f4a5b');
    // An older stored response carries no clientOrderRef key at all.
    expect(orderLabel({ id: ID, externalEventId: null })).toBe('2e3f4a5b');
    expect(orderLabel({ id: ID, clientOrderRef: '', externalEventId: '' })).toBe('2e3f4a5b');
  });
});

describe('the backorder label suffix (story 4-2c)', () => {
  const ROOT = '0198f7a2-0000-7000-8000-0000a1b2c3d4';
  const FOLLOW_ON = '0198f7a9-9999-7999-8999-9999deadbeef';

  test('a follow-on reads its root label plus -BO{seq}: 1042-BO1, AMZ-9-BO2', () => {
    expect(orderLabel({ id: FOLLOW_ON, clientOrderRef: '1042', followOnRootOrderId: ROOT, followOnSeq: 1 })).toBe('1042-BO1');
    expect(orderLabel({ id: FOLLOW_ON, externalEventId: 'AMZ-9', followOnRootOrderId: ROOT, followOnSeq: 2 })).toBe('AMZ-9-BO2');
  });

  test('an unnamed chain takes the ROOT’s short id, never the follow-on’s own: …a1b2c3d4 → a1b2c3d4-BO2', () => {
    expect(orderLabel({ id: FOLLOW_ON, clientOrderRef: null, externalEventId: null, followOnRootOrderId: ROOT, followOnSeq: 2 })).toBe('a1b2c3d4-BO2');
    expect(orderRootLabel({ id: FOLLOW_ON, followOnRootOrderId: ROOT, followOnSeq: 2 })).toBe('a1b2c3d4');
  });

  test('a root order (null or absent follow-on fields) reads exactly as before', () => {
    expect(orderLabel({ id: ROOT, clientOrderRef: '1042', followOnRootOrderId: null, followOnSeq: null })).toBe('1042');
    expect(orderLabel({ id: ROOT })).toBe('a1b2c3d4');
    expect(isFollowOn({ followOnSeq: null })).toBe(false);
    expect(isFollowOn({})).toBe(false);
    expect(isFollowOn({ followOnSeq: 1 })).toBe(true);
  });

  test('nextFollowOnLabel names the follow-on a short dispatch opens: 1042 → 1042-BO1; 1042-BO1 → 1042-BO2', () => {
    expect(nextFollowOnLabel({ id: ROOT, clientOrderRef: '1042' })).toBe('1042-BO1');
    expect(nextFollowOnLabel({ id: FOLLOW_ON, clientOrderRef: '1042', followOnRootOrderId: ROOT, followOnSeq: 1 })).toBe('1042-BO2');
    expect(nextFollowOnLabel({ id: ROOT })).toBe('a1b2c3d4-BO1');
  });
});

describe('the client order number field (story 4-1b)', () => {
  test('CLIENT_ORDER_REF_RE agrees with the backend CHECK on its probes: 64 accepted; 65, controls, edge spaces, non-ASCII refused', () => {
    // The same probes wms-be test/order-client-ref.spec.ts runs against the column CHECK.
    const accepted = ['A', 'SO-1042', 'so-1042', 'SO 1042/B#7', `S${'x'.repeat(62)}Z`];
    const refused = [`S${'x'.repeat(63)}Z`, '', ' SO-1', 'SO-1 ', 'SO\t1', 'SO\n1', 'SO-é', 'SO-１', '\u007f'];
    for (const probe of accepted) expect({ probe, ok: CLIENT_ORDER_REF_RE.test(probe) }).toEqual({ probe, ok: true });
    for (const probe of refused) expect({ probe, ok: CLIENT_ORDER_REF_RE.test(probe) }).toEqual({ probe, ok: false });
    expect(MAX_CLIENT_ORDER_REF_LENGTH).toBe(64);
  });

  test('parseClientOrderRef: trimmed; blank and spaces-only are absent; a refused shape is a problem naming the field', () => {
    expect(parseClientOrderRef('  SO-1042 ')).toEqual({ ref: 'SO-1042', problem: null });
    expect(parseClientOrderRef('')).toEqual({ ref: null, problem: null });
    expect(parseClientOrderRef('    ')).toEqual({ ref: null, problem: null });
    expect(parseClientOrderRef('x'.repeat(65))).toEqual({ ref: null, problem: 'Client order number is at most 64 characters (this one is 65).' });
    expect(parseClientOrderRef('SO\t1').problem).toBe(
      'Client order number takes plain letters, digits, spaces and punctuation only — no tabs, line breaks or accented characters.',
    );
    expect(parseClientOrderRef('SO-é', 'Your order number').problem).toMatch(/^Your order number takes plain letters/);
    // 64 after the trim is fine, whatever the padding.
    expect(parseClientOrderRef(`  ${'x'.repeat(64)}  `).ref).toHaveLength(64);
  });

  test('clientOrderRefBody: the key only when given', () => {
    expect(clientOrderRefBody('SO-1')).toEqual({ clientOrderRef: 'SO-1' });
    expect(clientOrderRefBody(null)).toEqual({});
  });

  test('parseOrderSearch: trimmed; blank is no search; over 200 (a channel reference’s cap) is a problem and nothing is searched', () => {
    expect(parseOrderSearch('  SO-1042 ')).toEqual({ reference: 'SO-1042', problem: null });
    expect(parseOrderSearch('   ')).toEqual({ reference: null, problem: null });
    expect(parseOrderSearch('x'.repeat(200))).toEqual({ reference: 'x'.repeat(200), problem: null });
    expect(parseOrderSearch('x'.repeat(201))).toEqual({ reference: null, problem: 'A search is at most 200 characters.' });
  });
});
