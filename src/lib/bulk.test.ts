import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';

import { bulkOutcome, keyFate, type BulkResult } from './bulk';

/** Story UI-2 (§3.5) — per-row bulk results, and what each outcome does to a row's key. */

const verbs = { done: 'released' };
const noun = { one: 'wave', many: 'waves' };

describe('bulkOutcome', () => {
  test('all done is accepted and counts the rows', () => {
    const results: BulkResult[] = [
      { id: 'a', label: 'W-a', kind: 'done' },
      { id: 'b', label: 'W-b', kind: 'done' },
    ];
    expect(bulkOutcome(results, verbs, noun)).toEqual({ tone: 'accepted', word: '2 waves released', reason: '2 released.' });
  });

  test('a mix is a warning and names every refused row with its reason', () => {
    const results: BulkResult[] = [
      { id: 'a', label: 'W-a', kind: 'done' },
      { id: 'b', label: 'W-b', kind: 'refused', reason: 'cutoff passed' },
      { id: 'c', label: 'W-c', kind: 'done' },
    ];
    expect(bulkOutcome(results, verbs, noun)).toEqual({
      tone: 'warning',
      word: '2 of 3 released',
      reason: '2 released · 1 refused — W-b: cutoff passed.',
    });
  });

  test('none done is rejected; rows never sent are named, not counted as refused', () => {
    const results: BulkResult[] = [
      { id: 'a', label: 'W-a', kind: 'refused', reason: 'gone' },
      { id: 'b', label: 'W-b', kind: 'not-attempted' },
    ];
    const outcome = bulkOutcome(results, verbs, noun);
    expect(outcome.tone).toBe('rejected');
    expect(outcome.word).toBe('None released');
    expect(outcome.reason).toBe('0 released · 1 refused · 1 not attempted — W-a: gone; not attempted: W-b.');
  });
});

describe('keyFate', () => {
  test('success spends the key; a server refusal drops it; no answer keeps it for a safe replay', () => {
    expect(keyFate('done')).toBe('spent');
    expect(keyFate(new ApiProblem('cutoff-passed', 409, 'Cutoff passed'))).toBe('drop');
    expect(keyFate(new TypeError('Failed to fetch'))).toBe('keep');
  });
});
