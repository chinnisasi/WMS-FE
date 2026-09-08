/**
 * KPI tile — 28px semibold tabular-nums value, muted label, delta caption
 * (DESIGN.md components.kpi-tile). Values reconcile to the ledger (AD-1);
 * there is no secondary "estimated" state.
 */
export function KpiTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string;
}) {
  return (
    <div className="rounded-md border border-(--border) bg-(--card) p-4">
      <div className="text-xs text-(--muted-foreground)">{label}</div>
      <div className="kpi mt-1 text-(--card-foreground)">{value}</div>
      {delta ? <div className="mt-1 text-xs text-(--muted-foreground)">{delta}</div> : null}
    </div>
  );
}