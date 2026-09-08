'use client';

import Link from 'next/link';

import { useSetupChecklist } from '@/lib/use-setup-checklist';

/**
 * The setup checklist card (mockup `key-web-overview.html` setup-checklist
 * section): "N of M done" badge, progress bar, tick rows with honest detail
 * lines, and a Continue link per pending step (deep links point at /settings
 * until stories 1.4/1.5 build their surfaces). The flags come from the
 * backend, computed on read — no stored step rows to go stale.
 */
export function SetupChecklistCard() {
  const checklist = useSetupChecklist();

  // Signed out / still loading / tenant switched mid-flight: quiet chrome —
  // the warehouse cards above carry the "sign in to configure" affordances.
  if (checklist === null) return null;

  const { steps } = checklist;
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Setup checklist</h2>
        <span className="rounded-full border border-(--border) bg-(--muted) px-2 py-0.5 text-xs tabular-nums text-(--muted-foreground)">
          {doneCount} of {total} done
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
          className="h-2 flex-1 overflow-hidden rounded-full bg-(--muted)"
        >
          <span
            className="block h-full rounded-full bg-(--accent)"
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="text-xs tabular-nums text-(--muted-foreground)">{percent}%</span>
      </div>
      <ul className="flex flex-col">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2 border-t border-(--border) py-2 first:border-t-0">
            <span
              aria-hidden
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                step.done
                  ? 'bg-(--accent) text-(--accent-foreground)'
                  : 'border border-(--border) bg-(--background)'
              }`}
            >
              {step.done ? '✓' : ''}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{step.label}</span>
              <span className="block text-(--muted-foreground)">
                {step.detail}
                {!step.done && (
                  <>
                    {' · '}
                    <Link href={step.href} className="text-(--primary) underline underline-offset-2">
                      Continue →
                    </Link>
                  </>
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}