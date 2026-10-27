import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import type { OrderImportStep } from '../../lib/api/client';
import { ApiProblem } from '../../lib/api/client';
import type { OrderImportResult } from '../../lib/order-import';
import { render, type Rendered } from '../../lib/test/render';
import { OrderImport } from './order-import';

/**
 * Story 4-1c — the shared panel's claims the pure tests cannot make:
 *   1. Import is offered only after a Check of the picked file;
 *   2. A13 — the key lives with the CHECKED file: an Import retried after a
 *      refusal, and after re-picking the same file (name, size,
 *      last-modified), reuses it; another file gets a new one;
 *   3. A3 — an unfinished run keeps "Import again" enabled under the SAME key;
 *      a complete one disables Import;
 *   4. at most 100 refused rows render; the rest are in the report.
 */

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  expect(found).toBeDefined();
  return found!;
}

async function press(container: HTMLElement, text: string): Promise<void> {
  const target = button(container, text);
  await act(async () => {
    target.click();
  });
  await settle();
}

function pick(container: HTMLElement, file: File): void {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Order file"]')!;
  act(() => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const csv = (name: string, lastModified = 1): File => new File(['order_ref,sku,quantity\n'], name, { type: 'text/csv', lastModified });

function result(dryRun: boolean, over: Partial<OrderImportResult> = {}): OrderImportResult {
  return {
    importId: dryRun ? null : 'imp-1',
    dryRun,
    warehouseId: 'wh-1',
    fileSha256: 'ab'.repeat(32),
    rowCount: 2,
    orderCount: 2,
    acceptedCount: 2,
    refusedCount: 0,
    complete: true,
    notAttemptedCount: 0,
    orders: [
      { orderId: dryRun ? null : 'o-1', clientOrderRef: 'SO-1', lineCount: 1, firstRow: 2, replayed: false },
      { orderId: dryRun ? null : 'o-2', clientOrderRef: 'SO-2', lineCount: 1, firstRow: 3, replayed: false },
    ],
    errors: [],
    ...over,
  } as OrderImportResult;
}

function mount(replies: (OrderImportResult | Error)[]): { calls: { file: string; step: OrderImportStep }[]; imported: OrderImportResult[] } {
  const calls: { file: string; step: OrderImportStep }[] = [];
  const imported: OrderImportResult[] = [];
  view = render(
    <OrderImport
      surface="portal"
      warehouseId="wh-1"
      todayIst="2026-10-30"
      run={async (file, _warehouse, step) => {
        calls.push({ file: file.name, step });
        const next = replies.shift() ?? result(step.dryRun);
        if (next instanceof Error) throw next;
        return next;
      }}
      onImported={(r) => imported.push(r)}
      onClose={() => undefined}
    />,
  );
  return { calls, imported };
}

const keyOf = (step: OrderImportStep): string | null => (step.dryRun ? null : step.idempotencyKey);

describe('OrderImport (story 4-1c)', () => {
  test('Import waits for a Check; a refused Import and a re-picked same file reuse the key; another file gets a new one; a complete import disables Import', async () => {
    const { calls, imported } = mount([result(true), new ApiProblem('conflict', 409), result(false, { complete: false, notAttemptedCount: 1, acceptedCount: 1 })]);
    const c = view!.container;
    expect(button(c, 'Import').disabled).toBe(true);
    pick(c, csv('a.csv'));
    expect(button(c, 'Import').disabled).toBe(true);
    await press(c, 'Check file');
    expect(calls[0]).toEqual({ file: 'a.csv', step: { dryRun: true } });
    await press(c, 'Import');
    expect(c.textContent).toContain('still in flight');
    const first = keyOf(calls[1]!.step);
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // Re-pick the SAME file (a new File object): the checked result and the key survive.
    pick(c, csv('a.csv'));
    await press(c, 'Import');
    expect(keyOf(calls[2]!.step)).toBe(first);
    expect(c.textContent).toContain('1 of 2 orders processed');
    // Unfinished: "Import again" under the same key, then complete.
    await press(c, 'Import again');
    expect(keyOf(calls[3]!.step)).toBe(first);
    expect(imported.at(-1)!.complete).toBe(true);
    expect(button(c, 'Import').disabled).toBe(true);
    // Another file: no result shown, a new key at its Import.
    pick(c, csv('a.csv', 2));
    expect(c.querySelector('[data-testid="order-import-result"]')).toBeNull();
    await press(c, 'Check file');
    await press(c, 'Import');
    expect(keyOf(calls.at(-1)!.step)).not.toBe(first);
  });

  test('at most 100 refused rows render; the rest are in the report', async () => {
    const errors = Array.from({ length: 130 }, (_, i) => ({ rowNumber: i + 2, orderRef: `SO-${i}`, sku: 'X', quantity: '1', code: 'unknown-sku' as const, detail: 'No SKU.' }));
    mount([result(true, { errors, acceptedCount: 0, refusedCount: 130, orders: [] })]);
    const c = view!.container;
    pick(c, csv('big.csv'));
    await press(c, 'Check file');
    expect(c.querySelectorAll('table[aria-label="Refused rows"] tbody tr')).toHaveLength(100);
    expect(c.textContent).toContain('Showing the first 100 of 130 refused rows');
    expect(c.textContent).toContain('Download error report (.csv)');
  });
});
