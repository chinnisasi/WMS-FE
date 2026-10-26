import type { ReactNode } from 'react';

/**
 * Story UI-1 (UI-PATTERNS §2, W1) — the top of every in-shell page: the
 * page's one `<h1>` (the nav label), one muted sentence of purpose, an
 * optional meta row (scope, "as of", a status indicator) and, on the right,
 * at most one primary and two secondary actions. Portal-allowed: no hook.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3" data-testid="page-header">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && <p className="max-w-prose text-sm text-(--muted-foreground)">{description}</p>}
        {meta !== undefined && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--muted-foreground)">{meta}</div>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
