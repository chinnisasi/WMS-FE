'use client';

import { useEffect, useState } from 'react';
import { istDateOf } from '@/lib/rate-cards';

/**
 * Story 4-2a — today's IST date (`YYYY-MM-DD`) for render: the ship-by
 * chips (Due today / Overdue) and the date input's min. Read once at mount
 * and re-read every minute, so a page left open across IST midnight moves on
 * (a render-time `Date.now()` is impure — the house lint refuses it). Lives
 * under `components/shared/` so the portal may use it.
 */
export function useTodayIst(): string {
  const [today, setToday] = useState(() => istDateOf(Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setToday(istDateOf(Date.now())), 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}
