import { describe, expect, test } from 'bun:test';

import { csvField, csvNumber } from './csv';

describe('csvField — text cells, guarded', () => {
  test('quotes every field and doubles embedded quotes', () => {
    expect(csvField('Acme "Foods"')).toBe('"Acme ""Foods"""');
    expect(csvField('')).toBe('""');
  });

  test('a leading =, +, -, @ — and (21-5b) a leading tab or carriage return — is neutralized with an apostrophe', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvField(`${lead}SUM(A1)`)).toBe(`"'${lead}SUM(A1)"`);
    }
    // Only a LEADING character is a vector.
    expect(csvField('A-01-01')).toBe('"A-01-01"');
    expect(csvField('a\tb')).toBe('"a\tb"');
  });
});

describe('csvNumber — number cells, plain and never guarded', () => {
  test('a signed decimal string is written as-is, so a spreadsheet reads a number', () => {
    expect(csvNumber('-40')).toBe('-40');
    expect(csvNumber('1234.567')).toBe('1234.567');
    expect(csvNumber(12)).toBe('12');
  });

  test('anything that is not exactly a decimal falls back to the guarded text field', () => {
    expect(csvNumber('-1+1')).toBe(`"'-1+1"`);
    expect(csvNumber('=1')).toBe(`"'=1"`);
    expect(csvNumber('1e3')).toBe('"1e3"');
    expect(csvNumber('')).toBe('""');
  });
});
