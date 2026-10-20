import { afterEach, describe, expect, test } from 'bun:test';

import { act } from 'react';

import { render, type Rendered } from '../../lib/test/render';
import type { CatalogImportErrorResponse, CatalogImportResponse } from '../../lib/api/generated';
import { ImportCatalogCard, ImportResult } from './import-catalog';
import { clearSession, writeSession } from '../../lib/auth';
import { CATALOG_IMPORT_OPTIONAL_COLUMNS, CATALOG_IMPORT_REQUIRED_COLUMNS } from '../../lib/catalog';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';

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

  test('the kit-pass overlap renders honestly: a row can be in BOTH counts, and its remedy is the kit editor', () => {
    // The kits.spec.ts fixture's shape: a row whose kit cell was refused is
    // both committed (its SKU row) and failed — the counts no longer sum to
    // the file's row count, and the fix-run remedy cannot retry the cell.
    const kitRefused = error({
      rowNumber: 3,
      skuCode: 'KIT-IMP-GHOST',
      code: 'kit-component-not-found',
      detail: 'kit_components names component "NO-SUCH-CODE" — no SKU with that code exists in this tenant or in this file.',
    });
    view = render(
      <ImportResult
        result={{
          importId: '0198f7a2-1b3c-7d4e-8f90-import00002',
          mode: 'initial',
          committedRows: 13,
          failedRows: 10,
          skippedRows: 0,
          errors: [kitRefused],
        }}
      />,
    );

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('13 committed · 10 failed');
    expect(banner).toContain('compose it with the Kit action on the SKUs table');
  });
});

describe('ImportResult: the error-report download (csvField / downloadText, moved to src/lib/csv.ts in 8-2a)', () => {
  test('downloads import-<id>-errors.csv, BOM-led, with a leading = cell guarded', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    const blobs = new Map<string, Blob>();
    const downloads: { name: string; text: Promise<string> }[] = [];
    URL.createObjectURL = ((blob: Blob) => {
      const href = `blob:test/${blobs.size}`;
      blobs.set(href, blob);
      return href;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, text: blobs.get(this.getAttribute('href') ?? '')!.text() });
    };
    try {
      const report = result([error({ skuCode: '=HYPERLINK("x")', detail: 'plain' })]);
      view = render(<ImportResult result={report} />);
      const button = [...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Download error report'))!;
      act(() => button.click());
      expect(downloads.map((d) => d.name)).toEqual([`import-${report.importId}-errors.csv`]);
      const text = await downloads[0]!.text;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text.slice(1)).toBe('row_number,sku_code,code,detail\n7,"\'=HYPERLINK(""x"")","validation-failed","plain"');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });
});

describe('ImportCatalogCard: the help lists every column the import takes (story 1-4)', () => {
  afterEach(() => {
    clearSession();
    restoreGlobals();
  });

  test('the fixed-header help names all 25 columns, the two new ones included, with their grammar', async () => {
    stubGlobal('fetch', (async () =>
      new Response(JSON.stringify({ code: 'not-found', status: 404, title: 'Unrouted' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch);
    writeSession({
      token: 'header.payload.signature',
      tenant: { id: '0198f7a2-1b3c-7d4e-8f90-112233445566', name: 'Priya Spices', gstin: null },
      user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
      expiresAt: Date.now() + 15 * 60_000,
    });
    view = render(<ImportCatalogCard />);
    await act(async () => {
      await Promise.resolve();
    });
    const text = view.container.textContent ?? '';
    for (const column of [...CATALOG_IMPORT_REQUIRED_COLUMNS, ...CATALOG_IMPORT_OPTIONAL_COLUMNS]) {
      expect(text).toContain(column);
    }
    expect(CATALOG_IMPORT_REQUIRED_COLUMNS.length + CATALOG_IMPORT_OPTIONAL_COLUMNS.length).toBe(35);
    // Story 1-6a — the goods-type cell grammars are explained.
    expect(text).toContain('barcodes, drug_schedules');
    expect(text).toContain('max_stack_layers is a whole number 1–100 (1 = do not stack)');
    expect(text).toContain('dg_class 8 needs hazard_class corrosive-acid, corrosive-base or none');
    expect(text).toContain('shelf_life_days, barcodes');
    expect(text).toContain('case:8901234567890;each:8900000000001');
    expect(text).toContain('2 to 1,000,000 base units each');
  });
});
