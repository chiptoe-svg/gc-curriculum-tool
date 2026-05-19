import type { SalaryDistribution, UnmappedLabel } from '@/lib/ai/synthesis/queries';

interface Props {
  submissions: number;
  partners: number;
  weightedSum: number;
  salary: SalaryDistribution;
  unmapped: UnmappedLabel[];
}

function formatSalary(n?: number): string {
  if (n == null) return '—';
  return `$${Math.round(n / 1000)}k`;
}

export function HeaderStats({ submissions, partners, weightedSum, salary, unmapped }: Props) {
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Submissions" value={String(submissions)} />
        <Stat label="Unique partners" value={String(partners)} />
        <Stat label="Weighted sum" value={String(weightedSum)} hint="∑ of partners.weight (distinct partners)" />
        <Stat
          label="Salary (p25 · p50 · p75)"
          value={`${formatSalary(salary.p25)} · ${formatSalary(salary.p50)} · ${formatSalary(salary.p75)}`}
          hint={salary.n === 0 ? 'no salary data yet' : `n = ${salary.n}`}
        />
      </div>

      {unmapped.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-800">
            Unmapped labels from partners
          </div>
          <p className="mt-1 text-xs text-amber-900">
            These are roles partners described but couldn&apos;t fit into your current targets. Worth a look — may indicate emerging targets.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unmapped.map(u => (
              <li key={u.label} className="rounded bg-white px-2 py-1 text-xs text-slate-700">
                {u.label} <span className="text-slate-400">×{u.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
