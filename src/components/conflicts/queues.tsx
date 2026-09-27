'use client';

import { useState } from 'react';

import { OverReceiptQueue } from '@/components/conflicts/over-receipt-queue';
import { ExcursionQueue } from '@/components/conflicts/excursion-queue';

/**
 * The Conflicts & Reviews page's queue switcher (story 12-7, UX-DR30): the
 * over-receipt decisions stay put, and the temperature-excursion review
 * queue joins them as a sibling queue rather than a new surface. Each queue
 * keeps its own status tabs and its own decision flow — the switcher is the
 * only thing shared.
 */
const QUEUES = ['over-receipts', 'excursions'] as const;
type Queue = (typeof QUEUES)[number];

const QUEUE_LABEL: Record<Queue, string> = {
  'over-receipts': 'Over-receipts',
  excursions: 'Excursions',
};

export function ConflictsQueues() {
  const [queue, setQueue] = useState<Queue>('over-receipts');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 text-xs" role="tablist" aria-label="Conflicts queue">
        {QUEUES.map((q) => (
          <button
            key={q}
            type="button"
            role="tab"
            aria-selected={queue === q}
            onClick={() => setQueue(q)}
            className={`rounded-sm border border-(--border) px-3 py-1 ${
              queue === q ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
            }`}
          >
            {QUEUE_LABEL[q]}
          </button>
        ))}
      </div>
      {queue === 'over-receipts' ? <OverReceiptQueue /> : <ExcursionQueue />}
    </div>
  );
}