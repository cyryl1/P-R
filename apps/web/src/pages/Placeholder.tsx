export function Placeholder({ title, phase }: { title: string; phase: number }) {
  return (
    <section>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase {phase}.</p>
    </section>
  );
}
