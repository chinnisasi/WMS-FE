/**
 * Story 2-1 — raising a purchase order on the web: the pure half of the PO
 * create form (the draft parser, the expected-date wire form, the refusal
 * mapper and the created banner).
 *
 * Pure: no React, no fetch — every sentence and derivation is pinned by
 * `purchase-orders.test.ts` (a claim left in JSX is a claim nothing can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import type { CreatePurchaseOrderDto, PurchaseOrderDto, PurchaseOrderLineInputDto } from '@/lib/api/generated';
import { isRealDate, istDayStart } from '@/lib/audit';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { parseQuantityInput } from '@/lib/format-quantity';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { parseRupees } from '@/lib/rupees';
import { skuInactiveSentence } from '@/lib/sku-status';

/** The backend's bounds, mirrored from `CreatePurchaseOrderDto`: `@ArrayMaxSize(200)` lines, a `@Length(1, 64)` code. */
export const MAX_PO_LINES = 200;
export const MAX_PO_CODE_LENGTH = 64;
/** `purchase_order_lines.unit_cost_paise` is an int4 column. */
export const MAX_UNIT_COST_PAISE = 2_147_483_647;

/** One draft line as the form holds it: the SKU, the typed quantity, the typed unit cost in rupees. */
export interface PoDraftLine {
  readonly skuId: string;
  readonly qty: string;
  readonly unitCost: string;
}

export const EMPTY_PO_LINE: PoDraftLine = { skuId: '', qty: '', unitCost: '' };

export interface PoCreateDraft {
  readonly clientId: string;
  readonly vendorId: string;
  readonly code: string;
  /** An IST calendar date `YYYY-MM-DD` (the date input's value); '' = none. */
  readonly expectedDate: string;
  readonly lines: readonly PoDraftLine[];
}

/** The SKU options the form offers (the picked client's active non-kit SKUs). */
export interface PoSkuOption {
  readonly id: string;
  readonly code: string;
}

/**
 * The one expected date → the wire instant every line carries (decision 2):
 * IST midnight starting that day, Z-suffixed — `2026-10-25` →
 * `2026-10-24T18:30:00.000Z` (the API refuses an offset form). Blank is none.
 * A past date is allowed (it can backdate a paper PO).
 */
export function poExpectedDate(date: string): { expectedDate: string | null; problem: string | null } {
  const trimmed = date.trim();
  if (trimmed === '') return { expectedDate: null, problem: null };
  if (!isRealDate(trimmed)) return { expectedDate: null, problem: 'The expected date is not a real date.' };
  return { expectedDate: new Date(istDayStart(trimmed)).toISOString(), problem: null };
}

/** The unit-cost refusal for a blank, zero or sub-paise cost (the DTO's `@Min(1)` paise). */
export const MIN_UNIT_COST_PROBLEM = 'Enter a unit cost of at least ₹0.01.';

/**
 * The create body (the existing `CreatePurchaseOrderDto` — no `clientId`:
 * the server derives the client from the SKUs), or ONE form-level problem
 * naming the line (nothing is sent while one stands). Fully empty rows are
 * dropped; a line's number is its row on screen. Precision and the quantity
 * ceiling are the server's to refuse (`validation-failed`, naming the unit).
 * A repeated SKU is refused here only — the API accepts it, but on one PO it
 * is almost always a slip.
 */
export function parsePoCreate(
  draft: PoCreateDraft,
  warehouseId: string,
  skuOptions: readonly PoSkuOption[],
): { body: CreatePurchaseOrderDto | null; problem: string | null } {
  const refuse = (problem: string) => ({ body: null, problem });
  if (draft.clientId === '') return refuse('Pick the client first.');
  if (draft.vendorId === '') return refuse('Choose the vendor this purchase order is for.');
  const code = draft.code.trim();
  if (code.length === 0) return refuse('Enter the PO code.');
  if (code.length > MAX_PO_CODE_LENGTH) return refuse(`The PO code is at most ${MAX_PO_CODE_LENGTH} characters.`);
  const expected = poExpectedDate(draft.expectedDate);
  if (expected.problem !== null) return refuse(expected.problem);

  const filled = draft.lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.skuId !== '' || line.qty.trim() !== '' || line.unitCost.trim() !== '');
  if (filled.length === 0) return refuse('Add at least one line — a SKU, a quantity and a unit cost.');
  if (filled.length > MAX_PO_LINES) return refuse(`A purchase order carries at most ${MAX_PO_LINES} lines.`);

  const codeOf = new Map(skuOptions.map((option) => [option.id, option.code]));
  const firstLineOf = new Map<string, number>();
  const lines: PurchaseOrderLineInputDto[] = [];
  for (const { line, number } of filled) {
    if (line.skuId === '') return refuse(`Line ${number} needs a SKU.`);
    const skuCode = codeOf.get(line.skuId);
    if (skuCode === undefined) {
      return refuse(`Line ${number}: that SKU is no longer offered for this client — pick another.`);
    }
    const earlier = firstLineOf.get(line.skuId);
    if (earlier !== undefined) {
      return refuse(`Line ${number} repeats ${skuCode} from line ${earlier} — put the whole quantity on one line.`);
    }
    firstLineOf.set(line.skuId, number);
    // The decimal-literal grammar (never `Number()`); precision is the
    // server's to refuse, naming the unit — nothing is rounded here.
    const qty = parseQuantityInput(line.qty);
    if (qty === null || qty <= 0) return refuse(`Line ${number}: enter a quantity greater than zero.`);
    if (line.unitCost.trim() === '') return refuse(`Line ${number}: ${MIN_UNIT_COST_PROBLEM}`);
    const cost = parseRupees(line.unitCost);
    if ('problem' in cost) return refuse(`Line ${number}: ${cost.problem}`);
    if (cost.paise < 1) return refuse(`Line ${number}: ${MIN_UNIT_COST_PROBLEM}`);
    if (cost.paise > MAX_UNIT_COST_PAISE) return refuse(`Line ${number}: that unit cost is too large.`);
    lines.push({
      skuId: line.skuId,
      orderedQty: qty,
      unitCostPaise: cost.paise,
      // Blank stays ABSENT — never `null` or `''`.
      ...(expected.expectedDate === null ? {} : { expectedDate: expected.expectedDate }),
    });
  }
  return { body: { warehouseId, vendorId: draft.vendorId, code, lines }, problem: null };
}

/** The refusals that name the vendor (the form re-reads its vendor options after one). */
const VENDOR_REFUSAL_CODES: ReadonlySet<string> = new Set(['vendor-not-linked', 'vendor-inactive', 'partner-not-vendor']);

/** Whether a refusal names the vendor (the form re-reads its vendor options after one). */
export function isVendorRefusal(error: unknown): boolean {
  return error instanceof ApiProblem && VENDOR_REFUSAL_CODES.has(error.code);
}

/**
 * The PO create's refusals, branching on the problem `code` — never on
 * prose. `kitCodes` are the draft's SKU codes a fresh kit read marks as kits
 * (the form re-reads the kits after a `kit-cannot-hold-stock`); none known →
 * a sentence without codes.
 */
export function poReason(error: unknown, kitCodes: readonly string[] = []): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      // A duplicate code (the detail names it) and a same-key race (it says
      // "retry") share the code; the server's detail tells them apart.
      case 'conflict':
        return error.detail ?? 'The same submission is still in flight — retry to read the settled result.';
      case 'kit-cannot-hold-stock':
        return kitCodes.length === 0
          ? 'A SKU on this purchase order is a kit — order its component SKUs instead.'
          : `${kitCodes.join(', ')} ${kitCodes.length === 1 ? 'is a kit' : 'are kits'} — order ${kitCodes.length === 1 ? 'its' : 'their'} component SKUs instead.`;
      case 'sku-inactive':
        return skuInactiveSentence(error, 'a new purchase order');
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
      case 'mixed-client':
      case 'vendor-not-linked':
      case 'vendor-inactive':
      case 'partner-not-vendor':
      case 'not-found':
      case 'validation-failed':
        return error.detail ?? 'Check the purchase order and try again.';
      case 'role-denied':
        return 'Your role cannot raise purchase orders.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — refresh and try again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `The purchase order was not raised (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The banner after a 201: built from the RESPONSE (the PO the server created), never the request. */
export function poCreatedOutcome(po: Pick<PurchaseOrderDto, 'code' | 'lines' | 'vendorSnapshot'>): {
  tone: 'accepted';
  word: string;
  reason: string;
} {
  const lines = `${po.lines.length} line${po.lines.length === 1 ? '' : 's'}`;
  const vendor = po.vendorSnapshot?.name;
  return {
    tone: 'accepted',
    word: `PO ${po.code} raised`,
    reason: vendor === undefined ? `${lines} ordered.` : `${lines} ordered from ${vendor}.`,
  };
}

/** Vendor options sorted by code (the form's picker order). */
export function sortedByCode<T extends { readonly code: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
