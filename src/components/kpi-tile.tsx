import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * KPI tile — 28px semibold tabular-nums value, muted label, delta caption
 * (DESIGN.md components.kpi-tile). Values reconcile to the ledger (AD-1);
 * there is no secondary "estimated" state.
 *
 * Story 9-1 opt-ins, each absent by default so an existing caller renders
 * byte-for-byte as before:
 *   - `href` — a visible link to the screen behind the number (the drill),
 *     reading `linkText` ("Open Outbound"; default "Open the list");
 *   - `valueCaption` — a small label over the number ("Today (IST)");
 *   - `secondary` — a second caption line (the 7-day figure, a share);
 *   - `unavailable` — the server could not compute the tile: the value reads
 *     the WORD "Unavailable" (never colour alone) and no caption is shown;
 *   - `children` — tile-specific notes below (counting-since, a sync list).
 * With any opt-in the tile carries an accessible name of label plus value.
 */
export function KpiTile({
  label,
  value,
  delta,
  href,
  linkText,
  valueCaption,
  secondary,
  unavailable,
  children,
}: {
  label: string;
  value: string;
  delta?: string;
  href?: string | null;
  linkText?: string;
  valueCaption?: string;
  secondary?: string;
  unavailable?: boolean;
  children?: ReactNode;
}) {
  const optedIn =
    (href !== undefined && href !== null) ||
    secondary !== undefined ||
    valueCaption !== undefined ||
    unavailable !== undefined ||
    children !== undefined;
  if (!optedIn) {
    return (
      <div className="rounded-md border border-(--border) bg-(--card) p-4">
        <div className="text-xs text-(--muted-foreground)">{label}</div>
        <div className="kpi mt-1 text-(--card-foreground)">{value}</div>
        {delta ? <div className="mt-1 text-xs text-(--muted-foreground)">{delta}</div> : null}
      </div>
    );
  }

  const shown = unavailable === true ? 'Unavailable' : value;
  const name = `${label}: ${shown}`;
  return (
    <div
      role="group"
      aria-label={name}
      data-unavailable={unavailable === true ? 'true' : undefined}
      className="flex flex-col rounded-md border border-(--border) bg-(--card) p-4"
    >
      <div className="text-xs text-(--muted-foreground)">{label}</div>
      {valueCaption !== undefined && unavailable !== true ? (
        <div className="mt-1 text-xs text-(--muted-foreground)">{valueCaption}</div>
      ) : null}
      <div className="kpi mt-1 text-(--card-foreground)">{shown}</div>
      {unavailable !== true && delta ? (
        <div className="mt-1 text-xs text-(--muted-foreground)">{delta}</div>
      ) : null}
      {unavailable !== true && secondary !== undefined ? (
        <div className="data mt-1 text-xs text-(--muted-foreground)">{secondary}</div>
      ) : null}
      {children}
      {href !== undefined && href !== null ? (
        <Link
          href={href}
          aria-label={`${linkText ?? 'Open the list'} — ${name}`}
          className="mt-2 self-start rounded-sm text-xs text-(--primary) underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ring)"
        >
          {linkText ?? 'Open the list'}
        </Link>
      ) : null}
    </div>
  );
}
