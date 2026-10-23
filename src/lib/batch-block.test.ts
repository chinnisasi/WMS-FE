import { describe, expect, test } from 'bun:test';

import type { BlockBatchDto } from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import {
  BATCH_BLOCK_REASONS,
  batchBlockOutcome,
  batchBlockReason,
  batchBlockStale,
  batchLifecycleLabel,
  batchUnpromisable,
  parseBlockDraft,
  parseUnblockDraft,
} from './batch-block';

const active = { status: 'active', blockedReason: null, blockedNote: null, blockedAt: null, blockedByName: null, expired: false };
const blocked = { status: 'blocked', blockedReason: 'qc-failed', blockedNote: null, blockedAt: '2026-10-22T20:00:00.000Z', blockedByName: 'ravi', expired: false };

describe('the batch block vocabulary (story 3-3a)', () => {
  test('the server vocabulary, in its order — both ways against the generated union', () => {
    expect(BATCH_BLOCK_REASONS).toEqual(['recall', 'qc-failed', 'contamination', 'client-instruction', 'expiry-review', 'other']);
    const generated: readonly BlockBatchDto['reason'][] = BATCH_BLOCK_REASONS;
    expect(generated).toHaveLength(6);
  });
});

describe('batchLifecycleLabel', () => {
  test('active, expired, blocked (by whom, the IST date), blocked and expired', () => {
    expect(batchLifecycleLabel(active)).toBe('Active');
    expect(batchLifecycleLabel({ ...active, expired: true })).toBe('Expired');
    // 20:00 UTC on the 22nd is the 23rd in IST.
    expect(batchLifecycleLabel(blocked)).toBe('Blocked — failed QC (by ravi, 23 Oct 2026)');
    expect(batchLifecycleLabel({ ...blocked, expired: true })).toBe('Blocked — failed QC (by ravi, 23 Oct 2026) · Expired');
    expect(batchLifecycleLabel({ ...blocked, blockedByName: null, blockedAt: null })).toBe('Blocked — failed QC');
    // The block's note follows the reason.
    expect(batchLifecycleLabel({ ...blocked, blockedReason: 'other', blockedNote: 'Label misprint' })).toBe('Blocked — other: Label misprint (by ravi, 23 Oct 2026)');
  });

  test('unpromisable = blocked or expired (the server flag, never a client expiry copy)', () => {
    expect(batchUnpromisable(active)).toBe(false);
    expect(batchUnpromisable(blocked)).toBe(true);
    expect(batchUnpromisable({ ...active, expired: true })).toBe(true);
  });
});

describe('the drafts', () => {
  test('block: a reason is required; `other` needs a note; the note is trimmed, ≤ 500 code points, absent when blank', () => {
    expect(parseBlockDraft({ reason: '', note: 'x' })).toEqual({ kind: 'refused', problem: 'Pick a reason for the block.' });
    expect(parseBlockDraft({ reason: 'other', note: '   ' })).toEqual({ kind: 'refused', problem: 'Say why in the note — the reason is Other.' });
    expect(parseBlockDraft({ reason: 'recall', note: '  ' })).toEqual({ kind: 'ok', body: { reason: 'recall' } });
    expect(parseBlockDraft({ reason: 'other', note: ' Label misprint ' })).toEqual({ kind: 'ok', body: { reason: 'other', note: 'Label misprint' } });
    expect(parseBlockDraft({ reason: 'recall', note: 'é'.repeat(500) }).kind).toBe('ok');
    expect(parseBlockDraft({ reason: 'recall', note: 'x'.repeat(501) })).toEqual({ kind: 'refused', problem: 'The note is at most 500 characters.' });
  });

  test('unblock: the note is required (trimmed, 1–500)', () => {
    expect(parseUnblockDraft('   ')).toEqual({ kind: 'refused', problem: 'Say why the block is lifted — a note is required.' });
    expect(parseUnblockDraft(' Recall withdrawn ')).toEqual({ kind: 'ok', body: { note: 'Recall withdrawn' } });
    expect(parseUnblockDraft('x'.repeat(501)).kind).toBe('refused');
  });
});

describe('refusals and outcomes', () => {
  test('a fixed sentence per code; the transport arm; an unknown code shows the server detail', () => {
    expect(batchBlockReason(new ApiProblem('batch-already-blocked', 409, 'd'))).toBe('This batch is already blocked — refresh the batches.');
    expect(batchBlockReason(new ApiProblem('batch-not-blocked', 409, 'd'))).toBe('This batch is not blocked any more — refresh the batches.');
    expect(batchBlockReason(new ApiProblem('role-denied', 403, 'd'))).toBe('Your role cannot block or unblock batches.');
    expect(batchBlockReason(new ApiProblem('idempotency-key-reuse', 422, 'd'))).toBe('This request was already sent with different details — close and try again.');
    expect(batchBlockStale(new ApiProblem('batch-already-blocked', 409, 'd'))).toBe(true);
    expect(batchBlockStale(new ApiProblem('batch-not-blocked', 409, 'd'))).toBe(true);
    expect(batchBlockStale(new ApiProblem('conflict', 409, 'd'))).toBe(false);
    expect(batchBlockReason(new ApiProblem('validation-failed', 400, 'reason must be one of …'))).toBe('reason must be one of …');
    expect(batchBlockReason(new Error('offline'))).toContain('could not be reached');
  });

  test('the banner words; an unblocked batch past expiry says it is still not promised', () => {
    const batch = { id: 'b', skuId: 's', code: 'LOT-A', mfgDate: null, expiryDate: null, status: 'blocked' as const, blockedReason: 'recall' as const, blockedNote: null, blockedAt: null, blockedBy: null, blockedByName: null, expired: false };
    expect(batchBlockOutcome('block', { batch }).word).toBe('Blocked');
    expect(batchBlockOutcome('block', { batch }).reason).toContain('in every warehouse');
    expect(batchBlockOutcome('unblock', { batch: { ...batch, status: 'active', blockedReason: null } }).reason).toBe('Batch LOT-A is unblocked — its stock is promisable again.');
    expect(batchBlockOutcome('unblock', { batch: { ...batch, status: 'active', blockedReason: null, expired: true } }).reason).toContain('past its expiry');
  });
});
