import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { BinResponse, LedgerEventDto, SkuResponse } from '@/lib/api/generated';
import {
  EMPTY_MOVE_DRAFT,
  MOVE_REASON_CODES,
  groupMoves,
  moveBatchLabel,
  moveBatchOptions,
  moveOriginBins,
  moveOutcome,
  moveReason,
  moveReasonCell,
  moveReasonLabel,
  moveSkuRefusal,
  moveTargetBins,
  originSkuRows,
  parseMoveDraft,
  parseSerialList,
  readMovePage,
  storageClassSatisfies,
} from '@/lib/moves';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/** Story 3-1 — the Moves page's pure decisions, pinned sentence by sentence. */

function bin(id: string, code: string, overrides: Partial<BinResponse> = {}): BinResponse {
  return {
    id,
    code,
    tenantId: 't',
    warehouseId: 'w',
    zoneId: 'z',
    capacity: 100,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    maxWeightGrams: null,
    storageClass: 'ambient',
    dedicatedClientId: null,
    type: 'shelf',
    blocked: false,
    systemOwned: false,
    retiredAt: null,
    retiredBy: null,
    ...overrides,
  } as BinResponse;
}

const A = bin('a', 'A-01');
const B = bin('b', 'B-01');
const BLOCKED = bin('blk', 'C-01', { blocked: true });
const RETIRED = bin('ret', 'D-01', { retiredAt: '2026-10-01T00:00:00.000Z' });
const SYSTEM = bin('sys', 'RECEIVING', { systemOwned: true });
const SECURE = bin('sec', 'S-01', { storageClass: 'secure' });
const FROZEN = bin('frz', 'F-01', { storageClass: 'frozen' });
const GLOW = bin('glow', 'G-01', { dedicatedClientId: 'c-glow' });

const sku = (overrides: Partial<SkuResponse> = {}) =>
  ({ id: 's1', code: 'PLAIN', uom: 'each', uomPrecision: 0, batchTracked: false, serialTracked: false, catchWeightTracked: false, storageClass: 'ambient', clientId: 'c-self', ...overrides }) as SkuResponse;

describe('the bins the form offers', () => {
  test('origins: storage bins not retired, a blocked one included, by code', () => {
    expect(moveOriginBins([B, SYSTEM, BLOCKED, RETIRED, A, SECURE], 'operator').map((x) => x.code)).toEqual(['A-01', 'B-01', 'C-01']);
    // A secure origin only for a role holding secure.move.
    expect(moveOriginBins([B, SECURE], 'ops_manager').map((x) => x.code)).toEqual(['B-01', 'S-01']);
  });

  test("targets: the device's rules plus secure for secure.move holders only", () => {
    const all = [A, B, BLOCKED, RETIRED, SYSTEM, SECURE, FROZEN, GLOW];
    expect(moveTargetBins(all, 'a', sku(), 'operator').map((x) => x.code)).toEqual(['B-01', 'F-01']);
    expect(moveTargetBins(all, 'a', sku(), 'ops_manager').map((x) => x.code)).toEqual(['B-01', 'F-01']);
    // A secure SKU: only a secure bin satisfies it, and only a holder sees it.
    expect(moveTargetBins(all, 'a', sku({ storageClass: 'secure' }), 'owner').map((x) => x.code)).toEqual(['S-01']);
    expect(moveTargetBins(all, 'a', sku({ storageClass: 'secure' }), 'operator').map((x) => x.code)).toEqual([]);
    // GlowCo's SKU may land in GlowCo's bin.
    expect(moveTargetBins(all, 'a', sku({ clientId: 'c-glow' }), 'operator').map((x) => x.code)).toEqual(['B-01', 'F-01', 'G-01']);
    // No SKU yet: only the structural rules (and secure).
    expect(moveTargetBins(all, null, null, 'operator').map((x) => x.code)).toEqual(['A-01', 'B-01', 'F-01', 'G-01']);
  });

  test('the class mirror: equal conforms; colder over warmer inside the temperature family; nothing else', () => {
    expect(storageClassSatisfies('ambient', 'frozen')).toBe(true);
    expect(storageClassSatisfies('frozen', 'chilled')).toBe(false);
    expect(storageClassSatisfies('ambient', 'hazardous')).toBe(false);
    expect(storageClassSatisfies('secure', 'secure')).toBe(true);
  });

  test("the origin's SKUs sum per SKU and drop zero rows; batches with stock only", () => {
    const rows = [
      { id: '1', warehouseId: 'w', skuId: 's1', binId: 'a', quantity: 3, createdAt: 'x' },
      { id: '2', warehouseId: 'w', skuId: 's1', binId: 'a', quantity: 2, createdAt: 'x' },
      { id: '3', warehouseId: 'w', skuId: 's2', binId: 'a', quantity: 0, createdAt: 'x' },
    ];
    expect(originSkuRows(rows)).toEqual([{ skuId: 's1', quantity: 5 }]);
    const batches = [
      { id: 'b1', code: 'L1', mfgDate: null, expiryDate: null, status: 'active', quantity: 5 },
      { id: 'b2', code: 'L2', mfgDate: null, expiryDate: null, status: 'active', quantity: 0 },
    ];
    expect(moveBatchOptions(batches).map((x) => x.code)).toEqual(['L1']);
  });
});

describe('the draft', () => {
  const draft = { ...EMPTY_MOVE_DRAFT, fromBinId: 'a', skuId: 's1', qty: '20', toBinId: 'b', reasonCode: 'consolidate' as const };

  test('a plain move: every optional arm explicit null', () => {
    expect(parseMoveDraft(draft, sku(), false)).toEqual({
      body: { skuId: 's1', fromBinId: 'a', toBinId: 'b', qty: 20, batchCode: null, serials: null, reasonCode: 'consolidate', note: null },
      problem: null,
    });
  });

  test('each problem, in order — nothing is sent', () => {
    expect(parseMoveDraft(EMPTY_MOVE_DRAFT, null, false).problem).toBe('Pick the bin the stock leaves.');
    expect(parseMoveDraft({ ...draft, skuId: '' }, null, false).problem).toBe('Pick the SKU to move.');
    expect(parseMoveDraft(draft, sku({ code: 'KIT' }), true).problem).toBe('KIT is a kit — a kit holds no stock; move its component SKUs.');
    expect(parseMoveDraft(draft, sku({ code: 'CW', catchWeightTracked: true }), false).problem).toBe(
      'CW is catch-weight — its cases carry no bin, so it cannot be moved here yet.',
    );
    expect(parseMoveDraft({ ...draft, qty: '0' }, sku(), false).problem).toBe('Type the quantity to move — a positive number.');
    expect(parseMoveDraft({ ...draft, qty: '1e3' }, sku(), false).problem).toBe('Type the quantity to move — a positive number.');
    expect(parseMoveDraft(draft, sku({ code: 'LOT', batchTracked: true }), false).problem).toBe('LOT is batch-tracked — pick the batch you move.');
    expect(parseMoveDraft({ ...draft, serials: ' ' }, sku({ code: 'SER', serialTracked: true }), false).problem).toBe(
      'SER is serial-tracked — list the serial of every unit you move.',
    );
    expect(parseMoveDraft({ ...draft, toBinId: '' }, sku(), false).problem).toBe('Pick the bin the stock goes to.');
    expect(parseMoveDraft({ ...draft, toBinId: 'a' }, sku(), false).problem).toBe('The origin and the target are the same bin — pick another target.');
    expect(parseMoveDraft({ ...draft, reasonCode: '' }, sku(), false).problem).toBe('Pick a reason for the move.');
    expect(parseMoveDraft({ ...draft, reasonCode: 'other', note: '  ' }, sku(), false).problem).toBe('The reason “Other” needs a note saying why.');
    expect(parseMoveDraft({ ...draft, reasonCode: 'other', note: 'x'.repeat(201) }, sku(), false).problem).toBe('Keep the note to 200 characters.');
  });

  test('a fractional quantity, a batch, serials (deduped, the count as qty, no batch) and a trimmed note', () => {
    expect(parseMoveDraft({ ...draft, qty: '2.5' }, sku({ uom: 'kg', uomPrecision: 3 }), false).body?.qty).toBe(2.5);
    expect(parseMoveDraft({ ...draft, batchCode: 'L1' }, sku({ batchTracked: true }), false).body).toMatchObject({ batchCode: 'L1', serials: null });
    expect(parseMoveDraft({ ...draft, qty: '', serials: 'S1\nS2,\n' }, sku({ serialTracked: true, batchTracked: true }), false).body).toMatchObject({
      qty: 2,
      serials: ['S1', 'S2'],
      batchCode: null,
    });
    // A duplicate is an error, never silently dropped.
    expect(parseMoveDraft({ ...draft, qty: '', serials: 'S1\nS2, S1\n' }, sku({ serialTracked: true }), false).problem).toBe('S1 is listed twice — one serial per unit.');
    expect(parseMoveDraft({ ...draft, qty: '', serials: 'S1,S2,S1,S2' }, sku({ serialTracked: true }), false).problem).toBe('S1, S2 are listed twice — one serial per unit.');
    expect(parseMoveDraft({ ...draft, reasonCode: 'other', note: '  shelf collapsed ' }, sku(), false).body?.note).toBe('shelf collapsed');
    const many = Array.from({ length: 501 }, (_, i) => `Q${i}`).join('\n');
    expect(parseMoveDraft({ ...draft, serials: many }, sku({ serialTracked: true }), false).problem).toBe('A move carries at most 500 serials (got 501) — split it.');
    expect(parseSerialList(' a ,b\n\na')).toEqual({ serials: ['a', 'b'], duplicates: ['a'] });
  });

  test('the SKU refusal; the reason vocabulary and labels', () => {
    expect(moveSkuRefusal(sku(), false)).toBeNull();
    expect(MOVE_REASON_CODES.map(moveReasonLabel)).toEqual(['Consolidate', 'Re-slot', 'Make room', 'Found misplaced', 'Client request', 'Other']);
    expect(moveReasonLabel('newer')).toBe('newer');
    expect(moveReasonLabel(null)).toBe('—');
  });
});

describe('the answer and the refusals', () => {
  test('the outcome is built from the response', () => {
    expect(
      moveOutcome(
        { moveId: 'm', events: [{ seq: 1, skuId: 's', quantity: 1, fromBinId: 'a', toBinId: 'b', batchRef: null, serialRef: 'x', occurredAt: 't' }, { seq: 2, skuId: 's', quantity: 1, fromBinId: 'a', toBinId: 'b', batchRef: null, serialRef: 'y', occurredAt: 't' }] },
        { sku: 'SER', from: 'A-01', to: 'B-01', precision: 0 },
      ),
    ).toBe('Moved 2 SER A-01 → B-01.');
  });

  const problem = (code: string, status = 409, detail?: string) => new ApiProblem(code, status, detail, 'Title');

  test('every code the matrix names, and the gate codes, in words', () => {
    expect(moveReason(problem('move-source-short', 409, 'Bin "A-01" holds 4.'))).toBe('Bin "A-01" holds 4.');
    expect(moveReason(problem('move-source-short'))).toBe('The origin bin holds less than that — move what is on hand.');
    expect(moveReason(problem('move-scope-quarantined'))).toBe('That stock is under a reconcile quarantine — it cannot move until the quarantine is resolved.');
    expect(moveReason(problem('bin-not-movable'))).toBe('A system bin (Receiving, QC-hold, In-Transit, Returns) moves only by its own task — pick a storage bin.');
    expect(moveReason(problem('bin-retired'))).toBe('That bin is retired — pick another.');
    expect(moveReason(problem('bin-blocked'))).toBe('The target bin is blocked — pick another.');
    for (const code of ['bin-full', 'bin-overweight', 'bin-volume-exceeded', 'bin-item-oversize']) {
      expect(moveReason(problem(code))).toBe('The target bin has no room for this — pick another.');
      expect(moveReason(problem(code, 409, `Bin "B" ${code}.`))).toBe(`Bin "B" ${code}.`);
    }
    for (const code of ['bin-storage-mismatch', 'bin-client-mismatch', 'bin-segregation-conflict', 'bin-occupancy-conflict']) {
      expect(moveReason(problem(code))).toBe('The target bin cannot take this stock — pick another.');
    }
    expect(moveReason(problem('kit-cannot-hold-stock'))).toBe('A kit holds no stock — move its component SKUs.');
    expect(moveReason(problem('serial-elsewhere'))).toBe('A serial is in another bin — check the serials against the origin.');
    expect(moveReason(problem('serial-unknown', 404))).toBe('A serial is unknown for this SKU — check the serials.');
    expect(moveReason(problem('conflict'))).toBe('The same move is still being processed — try again to read the result.');
  });

  test('the house set, the default and the transport arm', () => {
    expect(moveReason(problem('not-found', 404))).toBe('A bin, the SKU or the batch no longer exists — reload and pick again.');
    expect(moveReason(problem('role-denied', 403))).toBe('Your role cannot move this stock.');
    expect(moveReason(problem('role-denied', 403, 'Role "operator" lacks secure.move'))).toBe('Role "operator" lacks secure.move');
    expect(moveReason(problem('permission-denied', 403))).toBe('That warehouse belongs to another tenant — sign in again.');
    expect(moveReason(problem('idempotency-key-reuse', 422))).toBe('This move was already sent with different details — change something and send it again.');
    expect(moveReason(problem('unauthenticated', 401))).toBe('Your session expired — sign in again.');
    expect(moveReason(problem('validation-failed', 400))).toBe('Check the move and try again.');
    expect(moveReason(problem('validation-failed', 400, 'note must be at most 200'))).toBe('note must be at most 200');
    expect(moveReason(problem('brand-new', 409))).toBe('Not moved (brand-new).');
    expect(moveReason(new Error('boom'))).toBe(UNREACHABLE_REASON);
  });
});

describe('the recent moves', () => {
  const event = (overrides: Partial<LedgerEventDto>): LedgerEventDto =>
    ({
      id: 'e',
      seq: 1,
      type: 'stock.moved',
      skuId: 's1',
      quantityDelta: 20,
      fromBinId: 'a',
      toBinId: 'b',
      batchRef: null,
      serialRef: null,
      actorUserId: 'u1',
      occurredAt: '2026-10-22T09:00:00.000Z',
      recordedAt: '2026-10-22T09:00:01.000Z',
      referenceDoc: { kind: 'bin-move', moveId: 'm1', reasonCode: 'consolidate' },
      ...overrides,
    }) as LedgerEventDto;

  test("a serial move's events become one row; moves keep the page order; the note rides along", () => {
    const moves = groupMoves([
      event({ id: 'e3', referenceDoc: { kind: 'bin-move', moveId: 'm2', reasonCode: 'other', note: 'shelf' }, quantityDelta: 1, serialRef: 'x', batchRef: 'lot' }),
      event({ id: 'e2', referenceDoc: { kind: 'bin-move', moveId: 'm2', reasonCode: 'other', note: 'shelf' }, quantityDelta: 1, serialRef: 'y', batchRef: 'lot' }),
      event({ id: 'e1' }),
    ]);
    expect(moves.map((m) => [m.moveId, m.quantity, m.serialCount, m.batchRefs])).toEqual([
      ['m2', 2, 2, ['lot']],
      ['m1', 20, 0, []],
    ]);
    expect(moveReasonCell(moves[0]!)).toBe('Other — “shelf”');
    expect(moveReasonCell(moves[1]!)).toBe('Consolidate');
    expect(moveBatchLabel(moves[0]!, (id) => (id === 'lot' ? 'L1' : null))).toBe('L1 · 2 serials');
    expect(moveBatchLabel(moves[1]!, () => null)).toBe('—');
    expect(moveBatchLabel({ batchRefs: ['0198aaaa-bbbb-7ccc-8ddd-eeeeffff0001'], serialCount: 0 }, () => null)).toBe('ffff0001');
  });
});

describe('readMovePage — whole moves across ledger page boundaries', () => {
  const ev = (id: string, moveId: string) => ({ id, referenceDoc: { kind: 'bin-move', moveId } }) as unknown as LedgerEventDto;
  const ids = (items: readonly LedgerEventDto[]) => items.map((item) => item.id);

  test('a serial move straddling a boundary is finished on this page and skipped at the head of the next', async () => {
    const pages: Record<string, { items: LedgerEventDto[]; nextCursor: string | null }> = {
      first: { items: [ev('a', 'm1'), ev('b', 'm2'), ev('c', 'm2')], nextCursor: 'c1' },
      c1: { items: [ev('d', 'm2'), ev('e', 'm3')], nextCursor: 'c2' },
      c2: { items: [ev('f', 'm4')], nextCursor: null },
    };
    const reads: (string | null)[] = [];
    const fetchPage = async (cursor: string | null) => {
      reads.push(cursor);
      return pages[cursor ?? 'first']!;
    };
    const one = await readMovePage(fetchPage, null, null);
    expect(ids(one.items)).toEqual(['a', 'b', 'c', 'd']);
    expect(one.nextCursor).toBe('c1');
    expect(one.trailingMoveId).toBe('m2');
    const two = await readMovePage(fetchPage, 'c1', 'm2');
    expect(ids(two.items)).toEqual(['e']);
    expect(two.nextCursor).toBe('c2');
    const three = await readMovePage(fetchPage, 'c2', 'm3');
    expect(ids(three.items)).toEqual(['f']);
    expect(three.nextCursor).toBeNull();
    expect(reads).toEqual([null, 'c1', 'c1', 'c2', 'c2']);
  });

  test('a move filling a whole following page reads on, and the next cursor is past it', async () => {
    const pages: Record<string, { items: LedgerEventDto[]; nextCursor: string | null }> = {
      first: { items: [ev('a', 'm1'), ev('b', 'm2')], nextCursor: 'c1' },
      c1: { items: [ev('c', 'm2'), ev('d', 'm2')], nextCursor: 'c2' },
      c2: { items: [ev('e', 'm3')], nextCursor: null },
    };
    const fetchPage = async (cursor: string | null) => pages[cursor ?? 'first']!;
    const one = await readMovePage(fetchPage, null, null);
    expect(ids(one.items)).toEqual(['a', 'b', 'c', 'd']);
    expect(one.nextCursor).toBe('c2');
    const two = await readMovePage(fetchPage, 'c2', 'm2');
    expect(ids(two.items)).toEqual(['e']);
    expect(two.nextCursor).toBeNull();
  });
});
