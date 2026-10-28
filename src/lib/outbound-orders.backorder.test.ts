import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { AllocationDto } from '@/lib/api/generated';
import {
  acceptanceBadgeLabel,
  allocateReason,
  allocationResultText,
  canAllocateOrder,
  lineHoldText,
  UNREACHABLE_REASON,
} from './outbound-orders';

/** Story 4-2c — the live hold text, "Allocate now" visibility and its result. */

const EACH = { uom: 'each', uomPrecision: 0 };

describe('lineHoldText — the live state while accepted (story 4-2c)', () => {
  test('a fully held line reads "Reserved n"; a short one "Awaiting stock n", naming what it holds first', () => {
    expect(lineHoldText({ reservedQty: 10, shortfallQty: 0 }, 'accepted', EACH)).toEqual({ tone: 'success', word: 'Reserved 10 each' });
    expect(lineHoldText({ reservedQty: 0, shortfallQty: 3 }, 'accepted', EACH)).toEqual({ tone: 'warning', word: 'Awaiting stock 3 each' });
    expect(lineHoldText({ reservedQty: 7, shortfallQty: 3 }, 'accepted', EACH)).toEqual({
      tone: 'warning',
      word: 'Reserved 7 each · Awaiting stock 3 each',
    });
  });

  test('an unresolved SKU names "units"; a measured unit keeps its precision', () => {
    expect(lineHoldText({ reservedQty: 0, shortfallQty: 2 }, 'accepted')?.word).toBe('Awaiting stock 2 units');
    // Code review C32 — an expired or released hold holds nothing: the whole quantity awaits stock.
    for (const reservationState of ['expired', 'released'] as const) {
      expect(lineHoldText({ qty: 4, reservedQty: 4, shortfallQty: 0, reservationId: 'r-dead', reservationState }, 'accepted', EACH)?.word).toBe('Awaiting stock 4 each');
    }
    expect(lineHoldText({ qty: 4, reservedQty: 4, shortfallQty: 0, reservationId: 'r-live', reservationState: 'held' }, 'accepted', EACH)?.word).toBe('Reserved 4 each');
    expect(lineHoldText({ reservedQty: 0, shortfallQty: 0.25 }, 'accepted', { uom: 'kg', uomPrecision: 3 })?.word).toBe('Awaiting stock 0.250 kg');
  });

  test('nothing once the order has left accepted — its holds are committed or retired', () => {
    for (const status of ['ready_to_dispatch', 'dispatched', 'cancelled'] as const) {
      expect(lineHoldText({ reservedQty: 0, shortfallQty: 3 }, status)).toBeNull();
    }
  });

  test('the acceptance badge is history: "Backordered at acceptance", whatever the live state', () => {
    expect(acceptanceBadgeLabel({ status: 'backordered' })).toBe('Backordered at acceptance');
    expect(acceptanceBadgeLabel({ status: 'open' })).toBe('Open');
  });
});

describe('canAllocateOrder — "Allocate now" visibility (story 4-2c)', () => {
  const plain = (over: Partial<{ id: string; parentLineId: string | null; reservationId: string | null; shortfallQty: number; reservationState: string | null }> = {}) => ({
    id: 'l-1',
    parentLineId: null,
    reservationId: null,
    shortfallQty: 3,
    ...over,
  });

  test('accepted with a line holding nothing and still owed → shown', () => {
    expect(canAllocateOrder({ status: 'accepted', lines: [plain()] })).toBe(true);
  });

  test('never once the order left accepted', () => {
    for (const status of ['ready_to_dispatch', 'dispatched', 'cancelled'] as const) {
      expect(canAllocateOrder({ status, lines: [plain()] })).toBe(false);
    }
  });

  test('a line that holds something (partial grant) or owes nothing does not count', () => {
    expect(canAllocateOrder({ status: 'accepted', lines: [plain({ reservationId: 'r-1' })] })).toBe(false);
    // Code review C32 — a dead (expired / released) hold is re-granted by the server, so the verb shows.
    expect(canAllocateOrder({ status: 'accepted', lines: [plain({ reservationId: 'r-1', shortfallQty: 0, reservationState: 'expired' })] })).toBe(true);
    expect(canAllocateOrder({ status: 'accepted', lines: [plain({ reservationId: 'r-1', shortfallQty: 0, reservationState: 'held' })] })).toBe(false);
    expect(canAllocateOrder({ status: 'accepted', lines: [plain({ shortfallQty: 0 })] })).toBe(false);
  });

  test('a kit parent never keys it (its reservationId is always null) — its components do', () => {
    const parent = plain({ id: 'kit', shortfallQty: 1 });
    const heldChild = plain({ id: 'c-1', parentLineId: 'kit', reservationId: 'r-1', shortfallQty: 0 });
    expect(canAllocateOrder({ status: 'accepted', lines: [parent, heldChild] })).toBe(false);
    const shortChild = plain({ id: 'c-2', parentLineId: 'kit', reservationId: null, shortfallQty: 2 });
    expect(canAllocateOrder({ status: 'accepted', lines: [parent, heldChild, shortChild] })).toBe(true);
  });
});

describe('allocationResultText — the "Allocate now" result (story 4-2c)', () => {
  const base: AllocationDto = { orderId: 'o-1', warehouseId: 'w-1', allocated: [], stillShort: [], skipped: [] };
  const allocated = (reservedQty: number, qty = reservedQty) => ({ orderLineId: 'l', skuId: 's', skuCode: 'TEA-1', qty, reservedQty });
  const short = (shortQty: number) => ({ orderLineId: 'l2', skuId: 's2', skuCode: 'MUG-2', shortQty });

  test('"Reserved x of y units; z still awaiting stock" — y = x + z', () => {
    const text = allocationResultText({ ...base, allocated: [allocated(5), allocated(2)], stillShort: [short(3)] });
    expect(text.reason).toBe('Reserved 7 of 10 units; 3 still awaiting stock.');
    expect(text.tone).toBe('warning');
  });

  test('everything reserved reads as settled', () => {
    const text = allocationResultText({ ...base, allocated: [allocated(4)] });
    expect(text).toMatchObject({ tone: 'accepted', word: 'Reserved', reason: 'Reserved 4 of 4 units; nothing is awaiting stock.' });
  });

  test('an empty result is calm — "no stock is free", never an error', () => {
    const text = allocationResultText({ ...base, stillShort: [short(3)] });
    expect(text.tone).toBe('warning');
    expect(text.reason).toContain('Nothing could be reserved yet — no stock is free for these lines');
  });

  test('each skipped line is named with a plain-language reason', () => {
    const text = allocationResultText({
      ...base,
      allocated: [allocated(1, 1)],
      stillShort: [short(2)],
      skipped: [
        { orderLineId: 'a', skuId: 'a', skuCode: 'OLD-1', reason: 'sku-inactive' },
        { orderLineId: 'b', skuId: 'b', skuCode: 'DRUG-1', reason: 'licence-not-covered' },
        { orderLineId: 'c', skuId: 'c', skuCode: 'HOT-1', reason: 'contended' },
      ],
    });
    expect(text.skipped).toEqual([
      'OLD-1: not reserved — the SKU is inactive and its free stock does not cover the line in full (an inactive SKU sells existing stock only).',
      'DRUG-1: not reserved — no valid licence covers it at this warehouse today.',
      'HOT-1: not reserved — another order was reserving the same stock at that moment — try again.',
    ]);
  });

  test('nothing eligible at all: "Nothing to reserve"', () => {
    expect(allocationResultText(base)).toMatchObject({ tone: 'accepted', word: 'Nothing to reserve' });
  });
});

describe('allocateReason — the refusals (story 4-2c)', () => {
  test('each arm has its own words; the open wave is named by its short id', () => {
    expect(allocateReason(new ApiProblem('order-not-accepted', 409))).toContain('no longer accepted');
    expect(allocateReason(new ApiProblem('order-on-open-wave', 409, undefined, undefined, { waveId: '0198f7a2-1b3c-7d4e-8f90-0000deadbeef' }))).toBe(
      'This order is on wave …deadbeef — the wave plans its stock. Cancel the wave to re-plan it, then allocate.',
    );
    expect(allocateReason(new ApiProblem('order-on-open-wave', 409))).toContain('an open wave');
    expect(allocateReason(new ApiProblem('reservation-store-unavailable', 503))).toContain('nothing was reserved');
    expect(allocateReason(new ApiProblem('not-found', 404))).toContain('no longer exists');
    expect(allocateReason(new TypeError('fetch failed'))).toBe(UNREACHABLE_REASON);
  });
});
