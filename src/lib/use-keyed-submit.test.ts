import { describe, expect, test } from 'bun:test';

import { keyedSubmitState } from './use-keyed-submit';

/** Story UI-2 (W10) — the Idempotency-Key lifecycle of one draft. */

describe('keyedSubmitState', () => {
  let n = 0;
  const mint = () => `k${++n}`;

  test('the first submit mints; a retry of the unchanged draft after a failure reuses the key', () => {
    const first = keyedSubmitState.keyFor({ key: null }, mint);
    const failed = keyedSubmitState.settle(first, false);
    const retry = keyedSubmitState.keyFor(failed, mint);
    expect(retry.key).toBe(first.key);
  });

  test('success spends the key: the next submit is a new command', () => {
    const sent = keyedSubmitState.keyFor({ key: null }, mint);
    const done = keyedSubmitState.settle(sent, true);
    expect(done.key).toBeNull();
    expect(keyedSubmitState.keyFor(done, mint).key).not.toBe(sent.key);
  });

  test('an edit makes a new draft with a new key', () => {
    const sent = keyedSubmitState.keyFor({ key: null }, mint);
    const failed = keyedSubmitState.settle(sent, false);
    const edited = keyedSubmitState.invalidate();
    expect(edited.key).toBeNull();
    expect(keyedSubmitState.keyFor(edited, mint).key).not.toBe(failed.key);
  });
});
