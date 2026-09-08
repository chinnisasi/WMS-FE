/**
 * Shared placeholder for the non-functional surface routes (Story 1.1).
 * Later stories fill these in — the IA skeleton just makes them reachable.
 */
export function SurfacePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 max-w-prose text-sm text-(--muted-foreground)">{description}</p>
    </section>
  );
}