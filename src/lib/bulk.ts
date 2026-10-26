import { ApiProblem } from '@/lib/api/client';

/**
 * Story UI-2 (UI-PATTERNS §3.5, W6) — bulk means N commands, each with its
 * own Idempotency-Key, and a result per row. Never an all-or-nothing claim
 * the API does not make. Pure, pinned by `bulk.test.ts`.
 */

export type BulkResult =
  | { readonly id: string; readonly label: string; readonly kind: 'done' }
  | { readonly id: string; readonly label: string; readonly kind: 'refused'; readonly reason: string }
  | { readonly id: string; readonly label: string; readonly kind: 'not-attempted' };

export interface BulkOutcome {
  readonly tone: 'accepted' | 'warning' | 'rejected';
  readonly word: string;
  readonly reason: string;
}

/**
 * "2 released · 1 refused" with every refusal named by its row. All done is
 * accepted; none done is rejected; a mix is a warning — part of it happened.
 */
export function bulkOutcome(
  results: readonly BulkResult[],
  verbs: { readonly done: string },
  noun: { readonly one: string; readonly many: string },
): BulkOutcome {
  const done = results.filter((r) => r.kind === 'done').length;
  const refused = results.filter((r): r is Extract<BulkResult, { kind: 'refused' }> => r.kind === 'refused');
  const skipped = results.filter((r) => r.kind === 'not-attempted');
  const counts = [
    `${done} ${verbs.done}`,
    ...(refused.length > 0 ? [`${refused.length} refused`] : []),
    ...(skipped.length > 0 ? [`${skipped.length} not attempted`] : []),
  ].join(' · ');
  const details = [
    ...refused.map((r) => `${r.label}: ${r.reason}`),
    ...(skipped.length > 0 ? [`not attempted: ${skipped.map((r) => r.label).join(', ')}`] : []),
  ];
  const total = results.length;
  const tone = done === total ? 'accepted' : done === 0 ? 'rejected' : 'warning';
  const word =
    tone === 'accepted'
      ? `${total} ${total === 1 ? noun.one : noun.many} ${verbs.done}`
      : tone === 'rejected'
        ? `None ${verbs.done}`
        : `${done} of ${total} ${verbs.done}`;
  return { tone, word, reason: details.length === 0 ? `${counts}.` : `${counts} — ${details.join('; ')}.` };
}

/**
 * What happens to a row's Idempotency-Key after its command settles:
 *   - success → the key is spent (and the row leaves the selection);
 *   - the server answered with a refusal (any `ApiProblem`) → dropped, so a
 *     retry after the cause is fixed mints a new key instead of replaying
 *     the stored refusal;
 *   - no answer (network, timeout) → kept: the command may have landed, and
 *     a retry with the same key is the safe replay.
 */
export function keyFate(outcome: 'done' | unknown): 'spent' | 'drop' | 'keep' {
  if (outcome === 'done') return 'spent';
  return outcome instanceof ApiProblem ? 'drop' : 'keep';
}
