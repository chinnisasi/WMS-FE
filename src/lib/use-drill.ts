'use client';

import { useState } from 'react';

import { drillKey, type Drill } from '@/lib/drill';

/**
 * Story 9-1b — the drill a list hook's effect depends on, keyed on its
 * CANONICAL key (`drillKey`), never its object identity. A server-component
 * refresh hands the screen a fresh but equal drill object; depending on the
 * object would refetch on every refresh. The held value only changes when
 * the key does (the "adjust state while rendering" pattern — no effect).
 */
export function useKeyedDrill<D extends Drill>(drill: D | null): D | null {
  const key = drillKey(drill);
  const [held, setHeld] = useState<{ key: string; drill: D | null }>({ key, drill });
  if (held.key !== key) {
    setHeld({ key, drill });
    return drill;
  }
  return held.drill;
}
