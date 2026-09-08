/**
 * Honest feedback banner: glyph + word + one reason line, on the shared
 * radius/border tokens. Accepted (accent green) and rejected (destructive)
 * variants — no celebratory animation, no color-only signals.
 */
export function FeedbackBanner({
  tone,
  word,
  reason,
}: {
  tone: 'accepted' | 'rejected';
  word: string;
  reason: string;
}) {
  const accepted = tone === 'accepted';
  return (
    <div
      role={accepted ? 'status' : 'alert'}
      className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-sm ${
        accepted
          ? 'border-(--accent) bg-(--accent)/10 text-(--foreground)'
          : 'border-(--destructive) bg-(--destructive)/10 text-(--foreground)'
      }`}
    >
      <span className="flex items-center gap-2 font-medium">
        <span
          aria-hidden
          className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-(--accent-foreground) ${
            accepted ? 'bg-(--accent)' : 'bg-(--destructive) text-(--destructive-foreground)'
          }`}
        >
          {accepted ? '✓' : '!'}
        </span>
        {word}
      </span>
      <span className="text-(--muted-foreground)">{reason}</span>
    </div>
  );
}