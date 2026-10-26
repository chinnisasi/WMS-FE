import type { HTMLAttributes, ReactNode } from 'react';

import type { StatusTone } from '@/lib/status-tone';

export type { StatusTone };

/**
 * Story UI-1 (UI-PATTERNS §9.2, W2) — the one status chip. Every status pill
 * in the app draws with it, so a state looks the same on every surface.
 *
 * - `tone` is the meaning: `success` settled, `warning` look then decide,
 *   `danger` refused, `info` in progress, `neutral` informational.
 * - `variant="outline"` (default) is informational: the tone's border and a
 *   10% tint, with `--foreground` text — never the tone's own colour as small
 *   text on white. `neutral` sits on `--background` so it keeps 4.83:1 inside
 *   a tinted row (muted-on-muted is 4.40:1).
 * - `variant="solid"` marks a blocking state: the tone's fill and its paired
 *   `-foreground` token (DESIGN.md: never white on a dark fill).
 *
 * The word is always rendered as given (sentence case is the caller's), and
 * a glyph, when given, is decoration beside it (`aria-hidden`) — never
 * colour alone, never a glyph alone. Portal-allowed: no hook.
 */
export type StatusVariant = 'outline' | 'solid';

const OUTLINE: Readonly<Record<StatusTone, string>> = {
  neutral: 'border-(--border) bg-(--background) text-(--muted-foreground)',
  success: 'border-(--accent) bg-(--accent)/10 text-(--foreground) font-medium',
  warning: 'border-(--warning) bg-(--warning)/10 text-(--foreground) font-medium',
  danger: 'border-(--destructive) bg-(--destructive)/10 text-(--foreground) font-medium',
  info: 'border-(--primary) bg-(--primary)/10 text-(--foreground) font-medium',
};

const SOLID: Readonly<Record<StatusTone, string>> = {
  neutral: 'border-(--muted-foreground) bg-(--muted-foreground) text-(--background) font-medium',
  success: 'border-(--accent) bg-(--accent) text-(--accent-foreground) font-medium',
  warning: 'border-(--warning) bg-(--warning) text-(--warning-foreground) font-medium',
  danger: 'border-(--destructive) bg-(--destructive) text-(--destructive-foreground) font-medium',
  info: 'border-(--primary) bg-(--primary) text-(--primary-foreground) font-medium',
};

export function statusChipClass(tone: StatusTone, variant: StatusVariant = 'outline'): string {
  return `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${
    variant === 'solid' ? SOLID[tone] : OUTLINE[tone]
  }`;
}

export function StatusChip({
  tone,
  variant = 'outline',
  glyph,
  children,
  className,
  ...rest
}: {
  readonly tone: StatusTone;
  readonly variant?: StatusVariant;
  readonly glyph?: string;
  readonly children: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
  return (
    <span {...rest} data-tone={tone} className={`${statusChipClass(tone, variant)}${className ? ` ${className}` : ''}`}>
      {glyph !== undefined && <span aria-hidden>{glyph}</span>}
      {children}
    </span>
  );
}
