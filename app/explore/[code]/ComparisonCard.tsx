import type { ScenarioComparison } from '@/lib/ai/explore/compare';
import type { RippleLine } from '@/lib/ai/explore/scenario';

interface ComparisonCardProps {
  aCaption: string;
  bCaption: string;
  diff: ScenarioComparison;
}

function fmt(x: { k: number | null; u: number | null; d: number } | null): string {
  return x ? `D${x.d}` : '—';
}

function rippleLineText(r: RippleLine): string {
  const prefix = r.courseCode ? `${r.courseCode} · ` : '';
  return `${prefix}${r.label}: ${r.before} → ${r.after}`;
}

export function ComparisonCard({ aCaption, bCaption, diff }: ComparisonCardProps) {
  const { deltaChanges, rippleOnlyInA, rippleOnlyInB } = diff;

  return (
    <div className="rounded-md border bg-card p-3 text-sm">
      <p className="font-medium" data-testid="comparison-header">
        Comparing &ldquo;{aCaption}&rdquo; vs &ldquo;{bCaption}&rdquo;
      </p>

      {deltaChanges.length > 0 && (
        <section className="mt-2">
          <p className="font-semibold">Deltas that differ</p>
          <ul className="mt-1 space-y-0.5">
            {deltaChanges.map(({ competency, aTo, bTo }) => (
              <li key={competency}>
                {competency}: A {fmt(aTo)} vs B {fmt(bTo)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rippleOnlyInA.length > 0 && (
        <div data-testid="only-in-a" className="mt-2">
          <p className="font-semibold">Only in &ldquo;{aCaption}&rdquo;</p>
          <ul className="mt-1 space-y-0.5">
            {rippleOnlyInA.map((r) => (
              <li key={`${r.kind}-${r.label}`}>{rippleLineText(r)}</li>
            ))}
          </ul>
        </div>
      )}

      {rippleOnlyInB.length > 0 && (
        <div data-testid="only-in-b" className="mt-2">
          <p className="font-semibold">Only in &ldquo;{bCaption}&rdquo;</p>
          <ul className="mt-1 space-y-0.5">
            {rippleOnlyInB.map((r) => (
              <li key={`${r.kind}-${r.label}`}>{rippleLineText(r)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
