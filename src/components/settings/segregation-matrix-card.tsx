'use client';

import { useSyncExternalStore } from 'react';

import type { SegregationPairResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { useSegregationMatrix } from '@/lib/use-segregation-matrix';

import { ReadFailure } from '@/components/outbound/shell';

/**
 * The segregation matrix card (story 12-7) — a read-only 7×7 grid rendered
 * ENTIRELY from the endpoint (`GET /tenants/{t}/catalog/segregation-matrix`):
 * the grid equals the server's matrix exactly, the endpoint is the only
 * source, nothing hardcoded. The FE's compatibility test is dumb —
 * `compatible(a, b) = !incompatible.includes(pair)` — so widening the
 * backend's predicate flows here with nothing to drift.
 *
 * Null is not on the grid: a null hazard class is not a class (the 12-2
 * narrowing) and carries no rule in either direction — the endpoint
 * enumerates no null pairs, and the SKU/Hazard columns are where a null
 * renders.
 */

/**
 * `compatible(a, b) = !incompatible.includes(pair)` — zero logic of the
 * card's own, exactly the sentence the endpoint's contract promises: the
 * pairs arrive fully expanded (explosive's universal rule included) under
 * the server's sorted-key convention, so a symmetric membership check is
 * the whole client-side rule.
 */
function isIncompatible(a: string, b: string, incompatible: readonly SegregationPairResponse[]): boolean {
  return incompatible.some((pair) => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a));
}

export function SegregationMatrixCard() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Segregation matrix</div>
        <div className="text-(--muted-foreground)">Sign in to view the segregation matrix.</div>
      </div>
    );
  }
  return <SegregationMatrixCardSessioned />;
}

function SegregationMatrixCardSessioned() {
  const matrix = useSegregationMatrix();

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Segregation matrix</h2>
        <div className="text-(--muted-foreground)">
          Which hazard classes may share a bin — the server&apos;s own segregation rule, read
          verbatim. A cell marked <span className="font-mono">NO</span> means the two classes never
          co-locate; a null-class SKU (no rule) may sit beside anything.
        </div>
      </div>

      {matrix.state === 'failed' ? (
        <ReadFailure word="Matrix unavailable" reason={matrix.reason} onRetry={matrix.reload} />
      ) : matrix.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <caption className="sr-only">Hazard class segregation matrix</caption>
            <thead>
              <tr>
                <th scope="col" className="border border-(--border) px-2 py-1 text-left">
                  class
                </th>
                {matrix.data.classes.map((cls) => (
                  <th key={cls} scope="col" className="border border-(--border) px-2 py-1 font-mono">
                    {cls}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.data.classes.map((row) => (
                <tr key={row}>
                  <th scope="row" className="border border-(--border) px-2 py-1 text-left font-mono">
                    {row}
                  </th>
                  {matrix.data.classes.map((col) => {
                    const incompatible = isIncompatible(row, col, matrix.data.incompatible);
                    return (
                      <td
                        key={col}
                        className={`border border-(--border) px-2 py-1 text-center ${
                          incompatible ? 'font-medium' : 'text-(--muted-foreground)'
                        }`}
                      >
                        {incompatible ? 'NO' : 'ok'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}