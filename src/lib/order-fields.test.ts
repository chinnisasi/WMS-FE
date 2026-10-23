import { afterEach, describe, expect, test } from 'bun:test';
import {
  codAmountProblem,
  compareOrderUrgency,
  formatInrPaise,
  formatShipBy,
  manifestCodLabel,
  maxShipByDate,
  orderTypeLabel,
  parseShipByDate,
  paymentLine,
  priorityChip,
  shipByLabel,
  shipByStatus,
} from './order-fields';
import { emptyOrderFieldsDraft, parseOrderFieldsDraft } from './order-fields-form';
import { istDateOf } from './rate-cards';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('order fields (story 4-2a)', () => {
  test('the module is import-free (A15)', () => {
    const source = readFileSync(join(import.meta.dir, 'order-fields.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bfrom\s+['"]/);
  });

  test('formatInrPaise: Indian grouping, paise always shown (the handheld copy is byte-identical)', () => {
    expect(formatInrPaise(149900)).toBe('₹1,499.00');
    expect(formatInrPaise(1)).toBe('₹0.01');
    expect(formatInrPaise(12345678)).toBe('₹1,23,456.78');
    expect(formatInrPaise(1_000_000_000)).toBe('₹1,00,00,000.00');
    expect(formatInrPaise(2500)).toBe('₹25.00');
  });

  test('the priority chip shows for high and urgent only', () => {
    expect([priorityChip('normal'), priorityChip('high'), priorityChip('urgent'), priorityChip(null), priorityChip(undefined)]).toEqual([null, 'High', 'Urgent', null, null]);
  });

  test('ship-by: DD Mon; Overdue before today, Due today on it — only while accepted or ready to dispatch', () => {
    expect(formatShipBy('2026-10-24')).toBe('24 Oct');
    expect(shipByStatus('2026-10-22', '2026-10-23', 'accepted')).toBe('Overdue');
    expect(shipByStatus('2026-10-23', '2026-10-23', 'ready_to_dispatch')).toBe('Due today');
    expect(shipByStatus('2026-10-24', '2026-10-23', 'accepted')).toBeNull();
    expect(shipByStatus('2026-10-22', '2026-10-23', 'dispatched')).toBeNull();
    expect(shipByStatus('2026-10-22', '2026-10-23', 'cancelled')).toBeNull();
    expect(shipByStatus(null, '2026-10-23', 'accepted')).toBeNull();
    expect(shipByLabel('2026-10-23', '2026-10-23', 'accepted')).toBe('23 Oct · Due today');
    expect(shipByLabel(null, '2026-10-23')).toBe('—');
  });

  test('the payment line (A14): COD ₹x, else Prepaid with a type, else — (legacy)', () => {
    expect(paymentLine({ codAmountPaise: 149900, orderType: 'b2c' })).toBe('COD ₹1,499.00');
    expect(paymentLine({ codAmountPaise: null, orderType: 'b2b' })).toBe('Prepaid');
    expect(paymentLine({ codAmountPaise: null, orderType: null })).toBe('—');
    expect(paymentLine({})).toBe('—');
    expect(orderTypeLabel('b2b')).toBe('B2B');
    expect(orderTypeLabel(null)).toBe('—');
  });

  test('the manifest COD line; an absent figure reads as none', () => {
    expect(manifestCodLabel({ codShipmentCount: 2, codTotalPaise: 299800 })).toBe('2 COD · collect ₹2,998.00');
    expect(manifestCodLabel({ codShipmentCount: 0, codTotalPaise: 0 })).toBe('No COD');
    expect(manifestCodLabel({})).toBe('No COD');
  });

  test('compareOrderUrgency: due first, then priority, then ship-by (none last), then oldest', () => {
    const today = '2026-11-10';
    const rows = [
      { id: 'a', createdAt: '2026-11-01T00:00:00Z', priority: 'normal', shipByDate: null },
      { id: 'b', createdAt: '2026-11-02T00:00:00Z', priority: 'urgent', shipByDate: null },
      { id: 'c', createdAt: '2026-11-03T00:00:00Z', priority: 'high', shipByDate: '2026-11-17' },
      { id: 'd', createdAt: '2026-11-04T00:00:00Z', priority: 'normal', shipByDate: '2026-11-09' },
      { id: 'e', createdAt: '2026-11-05T00:00:00Z', priority: 'normal', shipByDate: '2026-11-11' },
      { id: 'f', createdAt: '2026-11-00T00:00:00Z', priority: undefined, shipByDate: undefined },
    ];
    expect([...rows].sort((x, y) => compareOrderUrgency(x, y, today)).map((r) => r.id)).toEqual(['d', 'b', 'c', 'e', 'f', 'a']);
  });

  test('parseShipByDate and codAmountProblem mirror the server bounds', () => {
    const today = '2026-11-10';
    expect(parseShipByDate('', today)).toEqual({ date: null });
    expect(parseShipByDate(' 2026-11-10 ', today)).toEqual({ date: '2026-11-10' });
    expect(parseShipByDate(maxShipByDate(today), today)).toEqual({ date: '2027-11-10' });
    expect('problem' in parseShipByDate('2027-11-11', today)).toBe(true);
    expect('problem' in parseShipByDate('2026-11-09', today)).toBe(true);
    expect('problem' in parseShipByDate('2026-02-30', today)).toBe(true);
    expect(codAmountProblem(1)).toBeNull();
    expect(codAmountProblem(0)).not.toBeNull();
    expect(codAmountProblem(1_000_000_001)).not.toBeNull();
  });

  test('the form parse: untouched sends no key; B2C beside a GSTIN and portal Urgent are refused; COD rupees → paise', () => {
    const today = '2026-11-10';
    const base = { todayIst: today, hasBuyerGstin: false, surface: 'staff' as const };
    expect(parseOrderFieldsDraft(emptyOrderFieldsDraft(), base)).toEqual({ body: {}, problem: null });
    expect(parseOrderFieldsDraft({ ...emptyOrderFieldsDraft(), orderType: 'b2c' }, { ...base, hasBuyerGstin: true }).problem).not.toBeNull();
    expect(parseOrderFieldsDraft({ ...emptyOrderFieldsDraft(), priority: 'urgent' }, { ...base, surface: 'portal' }).problem).toBe(
      'Urgent priority is set by the warehouse — choose Normal or High.',
    );
    expect(
      parseOrderFieldsDraft({ orderType: 'b2b', priority: 'urgent', shipByDate: today, cod: true, codRupees: '1499.00' }, base),
    ).toEqual({ body: { orderType: 'b2b', priority: 'urgent', shipByDate: today, codAmountPaise: 149900 }, problem: null });
    expect(parseOrderFieldsDraft({ ...emptyOrderFieldsDraft(), cod: true, codRupees: '' }, base).problem).not.toBeNull();
    expect(parseOrderFieldsDraft({ ...emptyOrderFieldsDraft(), cod: true, codRupees: '1.001' }, base).problem).not.toBeNull();
  });
});

describe('the IST clock (A13)', () => {
  const realNow = Date.now;
  const realTz = process.env.TZ;
  afterEach(() => {
    Date.now = realNow;
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
  });

  test('at 19:00Z (00:30 IST the next day) under a non-IST TZ, "today" is the IST date: Due today and the input min follow it', () => {
    process.env.TZ = 'America/New_York';
    const at = Date.parse('2026-10-23T19:00:00.000Z');
    Date.now = () => at;
    const today = istDateOf(Date.now());
    expect(today).toBe('2026-10-24');
    expect(shipByStatus('2026-10-24', today, 'accepted')).toBe('Due today');
    expect(shipByStatus('2026-10-23', today, 'accepted')).toBe('Overdue');
    expect('problem' in parseShipByDate('2026-10-23', today)).toBe(true);
    expect(parseShipByDate('2026-10-24', today)).toEqual({ date: '2026-10-24' });
  });
});
