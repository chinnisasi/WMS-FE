import { afterEach, describe, expect, test } from 'bun:test';

import { render, type Rendered } from '../../lib/test/render';
import type { CatalogImportErrorResponse, CatalogImportResponse } from '../../lib/api/generated';
import { ImportResult } from './import-catalog';

/**
 * The import report's per-row error table (story 10.5's matrix row for it).
 *
 * The contract pinned here is VERBATIM: the Detail cell renders the backend's
 * `detail` string exactly as received — never paraphrased, never trimmed,
 * never re-worded by the client. When the backend refuses a row on precision
 * (story 10.2/10.5), that refusal names the field, the unit and its declared
 * places, and rewording it would strip the one sentence the operator needs to
 * fix the row. The text below is the backend's own output, copied from
 * `wms-be/src/shared/primitives/quantity.ts :: precisionRefusalDetail` for a
 * 0-place unit given 1.25.
 */

const PRECISION_REFUSAL_DETAIL =
  'reorder_point must be a whole number: base UoM "each" declares 0 decimal places, ' +
  'so 1.25 is not a quantity it can express. Record whole units, or measure ' +
  'this SKU in a unit that allows fractions.';

function error(overrides: Partial<CatalogImportErrorResponse> = {}): CatalogImportErrorResponse {
  return {
    rowNumber: 7,
    skuCode: 'SPICE-01',
    code: 'validation-failed',
    detail: PRECISION_REFUSAL_DETAIL,
    ...overrides,
  };
}

function result(errors: CatalogImportErrorResponse[]): CatalogImportResponse {
  return {
    importId: '0198f7a2-1b3c-7d4e-8f90-import00001',
    mode: 'initial',
    committedRows: 3,
    failedRows: errors.length,
    skippedRows: 0,
    errors,
  };
}

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

describe('ImportResult: the per-row error table', () => {
  test('a precision-refused row renders rowNumber, code and the backend detail VERBATIM', () => {
    view = render(<ImportResult result={result([error()])} />);

    const rows = view.container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    const cells = [...rows[0]!.querySelectorAll('td')];
    // Row | SKU code | Reason | Detail — the four columns, in order.
    expect(cells).toHaveLength(4);
    expect(cells[0]!.textContent).toBe('7');
    expect(cells[1]!.textContent).toBe('SPICE-01');
    expect(cells[2]!.textContent).toBe('validation-failed');
    // The whole point: equality, not containment — no paraphrase survives.
    expect(cells[3]!.textContent).toBe(PRECISION_REFUSAL_DETAIL);
  });

  test('a row that failed before a SKU code could be read shows the em-dash placeholder', () => {
    view = render(<ImportResult result={result([error({ skuCode: null })])} />);

    const cells = [...view.container.querySelectorAll('tbody tr td')];
    expect(cells[1]!.textContent).toBe('—');
    // The placeholder never replaces the detail.
    expect(cells[3]!.textContent).toBe(PRECISION_REFUSAL_DETAIL);
  });

  test('the summary banner states the partial commit honestly', () => {
    view = render(<ImportResult result={result([error(), error({ rowNumber: 9, skuCode: null })])} />);

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('3 committed · 2 failed');
    expect(banner).toContain('fix the rows below and re-import them as a fix run');
  });
});
