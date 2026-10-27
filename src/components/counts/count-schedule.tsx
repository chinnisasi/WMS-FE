'use client';

import { useRef, useState } from 'react';

import { fetchApiDeleteCountPolicy, fetchApiUpsertCountPolicies } from '@/lib/api/client';
import {
  ABC_CLASSES,
  abcClassLabel,
  countPolicyReason,
  intervalLabel,
  notifyCountsChanged,
  parseIntervalDays,
  policyRemovedSentence,
  policySavedSentence,
  type AbcClass,
} from '@/lib/counts';
import { useCountPolicies } from '@/lib/use-counts';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, Section, inputClass, rowButtonClass } from '@/components/shared/surface';
import { ConfirmRow } from '@/components/settings/confirm-row';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

const thClass = 'h-10 border-b border-(--border) px-3 text-left font-medium text-(--foreground)';

/**
 * Story 3-5a — the warehouse's ABC count schedule: one row per class, its
 * interval or "Not scheduled". With `counts.manage`, a class is set (PUT, a
 * key per save) or removed (DELETE, a key per removal); removing stops the
 * scheduler minting that class's counts, and its open counts stay.
 */
export function CountSchedule({ tenantId, warehouseId, canManage }: { tenantId: string; warehouseId: string; canManage: boolean }) {
  const policies = useCountPolicies(warehouseId);
  const [drafts, setDrafts] = useState<Readonly<Partial<Record<AbcClass, string>>>>({});
  const [busy, setBusy] = useState<AbcClass | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [confirming, setConfirming] = useState<AbcClass | null>(null);
  const sending = useRef(false);

  async function run(abcClass: AbcClass, write: () => Promise<unknown>, done: string, failWord: string, action: 'save' | 'remove') {
    if (sending.current) return;
    sending.current = true;
    setBusy(abcClass);
    setOutcome(null);
    try {
      await write();
      setOutcome({ tone: 'accepted', word: action === 'save' ? 'Saved' : 'Removed', reason: done });
      setDrafts((current) => ({ ...current, [abcClass]: undefined }));
      notifyCountsChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: failWord, reason: countPolicyReason(error, action) });
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  function save(abcClass: AbcClass) {
    const days = parseIntervalDays(drafts[abcClass] ?? '');
    if (days === null) {
      setOutcome({ tone: 'rejected', word: 'Not saved', reason: 'Enter a whole number of days from 1 to 3650.' });
      return;
    }
    void run(
      abcClass,
      () => fetchApiUpsertCountPolicies(tenantId, warehouseId, [{ abcClass, intervalDays: days }], ulid()),
      policySavedSentence(abcClass, days),
      'Not saved',
      'save',
    );
  }


  return (
    <Section title="Schedule">
      <div className="text-xs text-(--muted-foreground)">
        Bins holding stock of a scheduled class are counted at most this often. A class with no interval is never counted on a schedule.
      </div>
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
      {policies.state === 'loading' && <div className="text-(--muted-foreground)">Loading the schedule…</div>}
      {policies.state === 'failed' && <ReadFailure word="Schedule not loaded" reason={policies.reason} onRetry={policies.reload} />}
      {policies.state === 'ready' && (
        <div className="overflow-x-auto rounded-md border border-(--border)">
          <table className="w-full border-collapse text-sm" data-testid="count-schedule">
            <thead className="bg-(--muted)">
              <tr>
                <th scope="col" className={thClass}>Class</th>
                <th scope="col" className={thClass}>Interval</th>
                {canManage && (
                  <th scope="col" className={thClass}>
                    <span className="sr-only">Change</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {ABC_CLASSES.map((abcClass) => {
                const current = policies.data.find((policy) => policy.abcClass === abcClass);
                return (
                  <tr key={abcClass} data-class={abcClass} className="h-10 border-b border-(--border) last:border-b-0">
                    <td className="px-3 py-1 font-medium">{abcClassLabel(abcClass)}</td>
                    <td className="px-3 py-1">{current === undefined ? 'Not scheduled' : intervalLabel(current.intervalDays)}</td>
                    {canManage && (
                      <td className="px-3 py-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            aria-label={`${abcClassLabel(abcClass)} interval in days`}
                            className={`${inputClass} w-24 py-1`}
                            inputMode="numeric"
                            placeholder="days"
                            value={drafts[abcClass] ?? ''}
                            onChange={(e) => setDrafts((d) => ({ ...d, [abcClass]: e.target.value }))}
                          />
                          <button type="button" className={rowButtonClass} disabled={busy !== null} onClick={() => save(abcClass)}>
                            {current === undefined ? 'Schedule' : 'Change'}
                          </button>
                          {current !== undefined && (
                            <button type="button" className={rowButtonClass} disabled={busy !== null || confirming !== null} onClick={() => setConfirming(abcClass)}>
                              Remove
                            </button>
                          )}
                        </div>
                        {confirming === abcClass && current !== undefined && (
                          <ConfirmRow<unknown>
                            key={`remove-${abcClass}`}
                            question={`Stop scheduling ${abcClassLabel(abcClass)} counts? Open counts stay.`}
                            confirmLabel="Remove schedule"
                            ariaLabel={`Confirm remove ${abcClassLabel(abcClass)} schedule`}
                            run={(key) => fetchApiDeleteCountPolicy(tenantId, warehouseId, abcClass, key)}
                            reason={(error) => countPolicyReason(error, 'remove')}
                            onClose={() => setConfirming(null)}
                            onDone={() => {
                              setConfirming(null);
                              setOutcome({ tone: 'accepted', word: 'Removed', reason: policyRemovedSentence(abcClass) });
                              notifyCountsChanged();
                            }}
                            onRejected={(reason) => {
                              setConfirming(null);
                              setOutcome({ tone: 'rejected', word: 'Not removed', reason });
                            }}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
