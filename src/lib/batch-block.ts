/**
 * Story 3-3a — block / unblock a batch, the web's pure half: the reason
 * vocabulary in words, the batch's status line ("Blocked — recall (by ravi,
 * 23 Oct 2026)", "Expired"), the two drafts' rules (a reason; `other` needs a
 * note; an unblock always says why; notes 1–500 characters) and the refusals
 * by code. `expired` is the SERVER's judgement (`BatchListItemDto.expired`) —
 * the web never re-derives a batch's expiry for its label.
 */
import type { BatchBlockResponse, BlockBatchDto, UnblockBatchDto } from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import { istDateLabel } from '@/lib/audit-exports';

export type BatchBlockReason = BlockBatchDto['reason'];

/** The server's vocabulary, in its order (a new reason must be labelled to compile). */
export const BATCH_BLOCK_REASON_LABEL: Readonly<Record<BatchBlockReason, string>> = {
  recall: 'Recall',
  'qc-failed': 'Failed QC',
  contamination: 'Contamination',
  'client-instruction': 'Client instruction',
  'expiry-review': 'Expiry review',
  other: 'Other (say what in the note)',
};

export const BATCH_BLOCK_REASONS = Object.keys(BATCH_BLOCK_REASON_LABEL) as readonly BatchBlockReason[];

/** The server's note ceiling (code points, after trimming). */
export const BATCH_BLOCK_NOTE_MAX = 500;

/** The lifecycle facts a status line reads (list rows and the detail alike). */
export interface BatchLifecycleFacts {
  readonly status: string;
  readonly blockedReason: string | null;
  /** The block's note — shown after the reason. */
  readonly blockedNote: string | null;
  readonly blockedAt: string | null;
  readonly blockedByName: string | null;
  readonly expired: boolean;
}

/** The reason inside a status line ("Blocked — failed QC …"). */
const BATCH_BLOCK_REASON_SHORT: Readonly<Record<BatchBlockReason, string>> = {
  recall: 'recall',
  'qc-failed': 'failed QC',
  contamination: 'contamination',
  'client-instruction': 'client instruction',
  'expiry-review': 'expiry review',
  other: 'other',
};

function reasonWord(reason: string | null): string {
  if (reason === null) return 'no reason';
  return Object.prototype.hasOwnProperty.call(BATCH_BLOCK_REASON_SHORT, reason) ? BATCH_BLOCK_REASON_SHORT[reason as BatchBlockReason] : reason;
}

/**
 * The batch's status in words: "Active", "Expired", "Blocked — recall: <the
 * note> (by ravi, 23 Oct 2026)", and "… · Expired" when a blocked batch is also past
 * its expiry. Both blocked and expired stock stay on hand and are never
 * promised or default-drawn.
 */
export function batchLifecycleLabel(batch: BatchLifecycleFacts): string {
  if (batch.status === 'blocked') {
    const by = [batch.blockedByName === null ? null : `by ${batch.blockedByName}`, batch.blockedAt === null ? null : istDateLabel(batch.blockedAt)]
      .filter((part): part is string => part !== null)
      .join(', ');
    const note = batch.blockedNote === null || batch.blockedNote === '' ? '' : `: ${batch.blockedNote}`;
    const blocked = `Blocked — ${reasonWord(batch.blockedReason)}${note}${by === '' ? '' : ` (${by})`}`;
    return batch.expired ? `${blocked} · Expired` : blocked;
  }
  if (batch.expired) return 'Expired';
  return batch.status === 'active' ? 'Active' : batch.status;
}

/** True when the batch's stock is on hand but not promisable (blocked or expired). */
export function batchUnpromisable(batch: Pick<BatchLifecycleFacts, 'status' | 'expired'>): boolean {
  return batch.status === 'blocked' || batch.expired;
}

function codePoints(text: string): number {
  return [...text].length;
}

export interface BlockDraft {
  readonly reason: BatchBlockReason | '';
  readonly note: string;
}

export type ParsedDraft<T> = { readonly kind: 'ok'; readonly body: T } | { readonly kind: 'refused'; readonly problem: string };

/** The block draft → its body, or the sentence that refuses it (the server's own rules, mirrored). */
export function parseBlockDraft(draft: BlockDraft): ParsedDraft<BlockBatchDto> {
  if (draft.reason === '') return { kind: 'refused', problem: 'Pick a reason for the block.' };
  const note = draft.note.trim();
  if (draft.reason === 'other' && note === '') return { kind: 'refused', problem: 'Say why in the note — the reason is Other.' };
  if (codePoints(note) > BATCH_BLOCK_NOTE_MAX) return { kind: 'refused', problem: `The note is at most ${BATCH_BLOCK_NOTE_MAX} characters.` };
  return { kind: 'ok', body: note === '' ? { reason: draft.reason } : { reason: draft.reason, note } };
}

/** The unblock draft → its body: lifting a block always says why. */
export function parseUnblockDraft(note: string): ParsedDraft<UnblockBatchDto> {
  const trimmed = note.trim();
  if (trimmed === '') return { kind: 'refused', problem: 'Say why the block is lifted — a note is required.' };
  if (codePoints(trimmed) > BATCH_BLOCK_NOTE_MAX) return { kind: 'refused', problem: `The note is at most ${BATCH_BLOCK_NOTE_MAX} characters.` };
  return { kind: 'ok', body: { note: trimmed } };
}

const UNREACHABLE = 'The server could not be reached — nothing was changed. Try again.';

/** A refusal in words, by code — never the server's prose for a known code. */
export function batchBlockReason(error: unknown): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE;
  switch (error.code) {
    case 'batch-already-blocked':
      return 'This batch is already blocked — refresh the batches.';
    case 'batch-not-blocked':
      return 'This batch is not blocked any more — refresh the batches.';
    case 'role-denied':
      return 'Your role cannot block or unblock batches.';
    case 'not-found':
      return 'The batch no longer exists — refresh the batches.';
    case 'idempotency-key-reuse':
      return 'This request was already sent with different details — close and try again.';
    case 'conflict':
      return 'Another change to this batch is in flight — refresh and try again.';
    case 'request-failed':
      return UNREACHABLE;
    default:
      return error.detail ?? error.message;
  }
}

/**
 * The two refusals that mean "the batch moved on under you" (someone else
 * blocked or unblocked it): the list and the detail re-read, the dialog closes.
 */
export function batchBlockStale(error: unknown): boolean {
  return error instanceof ApiProblem && (error.code === 'batch-already-blocked' || error.code === 'batch-not-blocked');
}

/** The banner after a block or unblock. */
export function batchBlockOutcome(kind: 'block' | 'unblock', response: BatchBlockResponse): { readonly word: string; readonly reason: string } {
  const { batch } = response;
  if (kind === 'block') {
    return {
      word: 'Blocked',
      reason: `Batch ${batch.code} is blocked (${reasonWord(batch.blockedReason)}) in every warehouse — its stock stays on hand but is no longer promised or picked by default. Orders already reserved against it stand.`,
    };
  }
  return {
    word: 'Unblocked',
    reason: batch.expired
      ? `Batch ${batch.code} is unblocked, but it is past its expiry — its stock is still not promised.`
      : `Batch ${batch.code} is unblocked — its stock is promisable again.`,
  };
}
