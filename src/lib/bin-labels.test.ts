import { afterEach, describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { binLabelsBody, binLabelsFilename, binLabelsRefusal, binPrintBlock, isBarcodableCode } from '@/lib/bin-labels';

const live = { code: 'A-01-01', retiredAt: null, systemOwned: false };

describe('bin labels (story 2-10a)', () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = savedTz;
  });

  test('isBarcodableCode mirrors the server: printable ASCII, non-empty, no leading or trailing space', () => {
    for (const ok of ['A-01-01', 'A 01', 'A^1~_>B']) expect(isBarcodableCode(ok)).toBe(true);
    for (const bad of ['', ' A', 'A ', 'A\t1', 'Ä-01', 'क-01', 'A\u007f']) expect(isBarcodableCode(bad)).toBe(false);
  });

  test('binPrintBlock: retired, system and unbarcodable rows say why; a live row is printable', () => {
    expect(binPrintBlock(live)).toBeNull();
    expect(binPrintBlock({ ...live, retiredAt: '2026-10-01T00:00:00.000Z' })).toContain('Retired');
    expect(binPrintBlock({ ...live, systemOwned: true })).toContain('System bin');
    expect(binPrintBlock({ ...live, code: 'Ä-01' })).toContain('barcode cannot carry');
  });

  test('the filename: bin-labels-<WH>-<YYYYMMDD>.<ext>, the warehouse code folded to [A-Za-z0-9._-]', () => {
    expect(binLabelsFilename('BLR-1', 'zpl', '2026-10-21T10:00:00.000Z')).toBe('bin-labels-BLR-1-20261021.zpl');
    expect(binLabelsFilename('BL R/1"é', 'pdf', '2026-10-21T10:00:00.000Z')).toBe('bin-labels-BL-R-1---20261021.pdf');
  });

  test('the filename date is the IST date at the boundary — for a viewer outside IST between 00:00 and 05:30 IST too', () => {
    process.env.TZ = 'America/New_York';
    // 00:30 IST on 22 Oct = 19:00 UTC on 21 Oct = 15:00 in New York, 21 Oct.
    const justAfter = Date.parse('2026-10-21T19:00:00.000Z');
    expect(new Date(justAfter).getDate()).toBe(21); // the viewer's own calendar says the 21st
    expect(binLabelsFilename('W1', 'pdf', justAfter)).toBe('bin-labels-W1-20261022.pdf');
    // Exactly on the edge, and one millisecond before it.
    expect(binLabelsFilename('W1', 'pdf', '2026-10-21T18:30:00.000Z')).toBe('bin-labels-W1-20261022.pdf');
    expect(binLabelsFilename('W1', 'pdf', '2026-10-21T18:29:59.999Z')).toBe('bin-labels-W1-20261021.pdf');
  });

  test('the body: size only on a thermal label; the A4 sheet is always a PDF with no size', () => {
    expect(binLabelsBody({ binIds: ['b1', 'b2'] }, 'zpl', '2x1')).toEqual({ binIds: ['b1', 'b2'], format: 'zpl', layout: 'label', size: '2x1' });
    expect(binLabelsBody({ zoneId: 'z1' }, 'pdf', '4x2')).toEqual({ zoneId: 'z1', format: 'pdf', layout: 'label', size: '4x2' });
    expect(binLabelsBody({ zoneId: 'z1' }, 'pdf', 'a4')).toEqual({ zoneId: 'z1', format: 'pdf', layout: 'a4' });
  });

  test('refusals branch on code and list extensions.binCodes — never the detail', () => {
    const detail = 'SERVER PROSE THAT MUST NOT RENDER';
    for (const code of ['bin-retired', 'bin-not-printable', 'bin-code-not-barcodable', 'bin-code-too-long-for-label']) {
      const refusal = binLabelsRefusal(new ApiProblem(code, 422, detail, undefined, { binCodes: ['A-1', 'B-2'] }));
      expect(refusal.binCodes).toEqual(['A-1', 'B-2']);
      expect(refusal.reason).not.toContain(detail);
    }
    expect(binLabelsRefusal(new ApiProblem('bin-code-too-long-for-label', 422, detail, undefined, { binCodes: ['X'] })).reason).toBe(
      'These bin codes are too long for this paper at a scannable bar width — a 4 × 2 in label carries 28 characters, a 2 × 1 in label 11, an A4 sheet cell 18:',
    );
    expect(binLabelsRefusal(new ApiProblem('too-many-labels', 422, detail, undefined, { count: 1234 })).reason).toContain('1234 printable bins');
    expect(binLabelsRefusal(new ApiProblem('no-bins-to-print', 404, detail)).reason).toContain('no printable bins');
    expect(binLabelsRefusal(new ApiProblem('not-found', 404, detail)).reason).toContain('reload');
    expect(binLabelsRefusal(new ApiProblem('role-denied', 403, detail)).reason).toBe('Your role cannot print labels.');
    expect(binLabelsRefusal(new ApiProblem('something-new', 500, detail)).reason).not.toContain(detail);
    expect(binLabelsRefusal(new TypeError('Failed to fetch'))).toEqual({ reason: UNREACHABLE_REASON, binCodes: [] });
  });
});
