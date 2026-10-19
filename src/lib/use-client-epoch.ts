'use client';

import { useState } from 'react';

/**
 * Story 1-5a — a counter that moves on every client switch (the pending
 * state is not a switch). A list hook stamps its requested cursor with it,
 * so a cursor requested under one client is never replayed after a switch
 * — not even on a return to that client (All → GlowCo → All restarts from
 * page one, matching the remounted table's empty Prev/Next stack). A plain
 * `clientId` stamp cannot say that: it matches again on the way back.
 *
 * The "adjust state while rendering" pattern (the scope is compared in the
 * same render, no reset effect — frontend guide §1.5).
 */
export function useClientEpoch(clientId: string | null, pending: boolean): number {
  // `undefined` = no client resolved yet (mounted while pending): the first
  // resolved client is where the hook starts, not a switch.
  const [track, setTrack] = useState<{ clientId: string | null | undefined; epoch: number }>(() => ({
    clientId: pending ? undefined : clientId,
    epoch: 0,
  }));
  if (pending || track.clientId === clientId) return track.epoch;
  const epoch = track.clientId === undefined ? track.epoch : track.epoch + 1;
  setTrack({ clientId, epoch });
  return epoch;
}
