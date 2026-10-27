import { useCallback, useRef, useState } from 'react';

import { ulid } from '@/lib/ulid';

/**
 * Story UI-2 (UI-PATTERNS §4, W10) — the idempotent-submit rules every form
 * re-implemented, in one place:
 *
 *   - the Idempotency-Key is minted on the FIRST submit of a draft;
 *   - a retry of the unchanged draft reuses it (a lost response replays
 *     safely instead of creating twice);
 *   - any edit (`invalidate`) and any success clear it, so the next draft
 *     is a new command;
 *   - a synchronous in-flight ref refuses a second submit before React has
 *     re-rendered the disabled button (SYSTEM-DESIGN gotcha 7).
 *
 * The key rules are the pure `keyedSubmitState` below, pinned by
 * `use-keyed-submit.test.ts`; the hook only holds the state.
 */
export interface KeyState {
  readonly key: string | null;
}

export const keyedSubmitState = {
  /** The key this submit sends: the draft's existing key, else a new one. */
  keyFor(state: KeyState, mint: () => string): KeyState & { readonly key: string } {
    return { key: state.key ?? mint() };
  },
  /** After the command settles: success spends the key; a failure keeps it for a retry of the same draft. */
  settle(state: KeyState, ok: boolean): KeyState {
    return ok ? { key: null } : state;
  },
  /** Any edit makes a new draft. */
  invalidate(): KeyState {
    return { key: null };
  },
};

export function useKeyedSubmit(): {
  readonly busy: boolean;
  /** Runs `command` with the draft's key; resolves false when refused as a double submit. `command` returning normally is success; throwing is failure (rethrown). */
  run<T>(command: (key: string) => Promise<T>): Promise<{ readonly sent: false } | { readonly sent: true; readonly value: T }>;
  /** Call on every edit of the draft. */
  invalidate(): void;
} {
  const keyRef = useRef<KeyState>({ key: null });
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const invalidate = useCallback(() => {
    keyRef.current = keyedSubmitState.invalidate();
  }, []);

  const run = useCallback(async <T,>(command: (key: string) => Promise<T>) => {
    if (inFlight.current) return { sent: false as const };
    inFlight.current = true;
    setBusy(true);
    const withKey = keyedSubmitState.keyFor(keyRef.current, ulid);
    keyRef.current = withKey;
    try {
      const value = await command(withKey.key);
      keyRef.current = keyedSubmitState.settle(keyRef.current, true);
      return { sent: true as const, value };
    } catch (error) {
      keyRef.current = keyedSubmitState.settle(keyRef.current, false);
      throw error;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run, invalidate };
}
