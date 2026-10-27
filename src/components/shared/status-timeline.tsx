/**
 * Story UI-1 (UI-PATTERNS §7, part of W11) — a document's lifecycle as a
 * vertical stepper. Each step is a glyph AND a word (never colour alone):
 * ✓ done, ● current (`aria-current="step"`), ○ upcoming, ✕ stopped. A time
 * shows only where the caller knows one — the timeline never implies an
 * event happened at a time nobody recorded. Portal-allowed: no hook.
 */
export type TimelineStepState = 'done' | 'current' | 'upcoming' | 'stopped';

export interface TimelineStep {
  readonly label: string;
  readonly state: TimelineStepState;
  /** A display time (already formatted, IST), or absent. */
  readonly time?: string;
}

const GLYPH: Readonly<Record<TimelineStepState, string>> = { done: '✓', current: '●', upcoming: '○', stopped: '✕' };
const STATE_WORD: Readonly<Record<TimelineStepState, string>> = {
  done: 'done',
  current: 'current step',
  upcoming: 'not yet',
  stopped: 'stopped',
};
const GLYPH_CLASS: Readonly<Record<TimelineStepState, string>> = {
  done: 'border-(--accent) bg-(--accent) text-(--accent-foreground)',
  current: 'border-(--primary) bg-(--primary) text-(--primary-foreground)',
  upcoming: 'border-(--border) bg-(--background) text-(--muted-foreground)',
  stopped: 'border-(--destructive) bg-(--destructive) text-(--destructive-foreground)',
};

export function StatusTimeline({ steps, label }: { readonly steps: readonly TimelineStep[]; readonly label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col" data-testid="status-timeline">
      {steps.map((step, index) => (
        <li
          key={step.label}
          aria-current={step.state === 'current' ? 'step' : undefined}
          data-state={step.state}
          className="relative flex gap-3 pb-3 last:pb-0"
        >
          {index < steps.length - 1 && (
            <span aria-hidden className="absolute top-6 left-[11px] h-[calc(100%-1.5rem)] w-px bg-(--border)" />
          )}
          <span
            aria-hidden
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${GLYPH_CLASS[step.state]}`}
          >
            {GLYPH[step.state]}
          </span>
          <span className="flex flex-col">
            <span className={step.state === 'upcoming' ? 'text-(--muted-foreground)' : 'font-medium'}>
              {step.label}
              <span className="sr-only"> — {STATE_WORD[step.state]}</span>
            </span>
            {step.time !== undefined && <span className="data text-xs text-(--muted-foreground)">{step.time}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
