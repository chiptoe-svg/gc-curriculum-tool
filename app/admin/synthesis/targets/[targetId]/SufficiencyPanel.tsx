import { getTargetSufficiency } from '@/lib/program/sufficiency-read';

/**
 * Read-only demand → coverage sufficiency panel (Q1 seam). Server component;
 * rendered only when DEMAND_COVERAGE_SEAM is on (gated by the page). Shows, per
 * sub-competency, employer-weighted DEMAND vs curriculum ATTAINMENT and the gap,
 * honestly distinguishing no_demand (no employer signal) and no_coverage
 * (demanded but unmeasured) from a real shortfall.
 */

const STATUS_STYLE: Record<string, string> = {
  gap: 'bg-red-100 text-red-700',
  met: 'bg-green-100 text-green-700',
  no_coverage: 'bg-amber-100 text-amber-800',
  no_demand: 'bg-slate-100 text-slate-500',
};
const STATUS_LABEL: Record<string, string> = {
  gap: 'gap',
  met: 'met',
  no_coverage: 'no coverage',
  no_demand: 'no demand',
};

function fmt(n: number | null): string {
  return n == null ? '—' : (Number.isInteger(n) ? String(n) : n.toFixed(1));
}

function Dim({ label, demand, attainment, gap, status }: {
  label: string; demand: number | null; attainment: number | null; gap: number | null; status: string;
}) {
  return (
    <td className="px-3 py-2 text-center align-top">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-mono text-sm">
        {fmt(demand)}<span className="text-slate-400"> / </span>{fmt(attainment)}
      </div>
      <div className="mt-0.5">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.no_demand}`}>
          {status === 'gap' && gap != null ? `−${fmt(gap)}` : STATUS_LABEL[status] ?? status}
        </span>
      </div>
    </td>
  );
}

export async function SufficiencyPanel({ targetId }: { targetId: string }) {
  const rows = await getTargetSufficiency(targetId);
  const withDemand = rows.filter(r => r.status !== 'no_demand');

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Demand → coverage sufficiency <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">preview</span></h2>
        <p className="text-sm text-slate-600">
          Employer-weighted <strong>demand</strong> vs curriculum <strong>attainment</strong> (demand / attainment),
          per sub-competency. Demand is the partner-weighted average across submitted positions; attainment is the
          deepest any course reached. <span className="text-amber-700">no coverage</span> = employers want it but
          we have no coverage data yet; <span className="text-slate-500">no demand</span> = no employer signal.
        </p>
      </div>

      {withDemand.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No employer demand mapped to this target&apos;s sub-competencies yet. Once interviewed positions tag
          sub-competencies, this fills in.
        </p>
      ) : (
        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Sub-competency</th>
                <th className="px-3 py-2 text-center">Know</th>
                <th className="px-3 py-2 text-center">Understand</th>
                <th className="px-3 py-2 text-center">Do</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {withDemand.map(r => (
                <tr key={r.subCompetencyId} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium">{r.subCompetencyName}</td>
                  <Dim label="K" demand={r.k.demand} attainment={r.k.attainment} gap={r.k.gap} status={r.k.status} />
                  <Dim label="U" demand={r.u.demand} attainment={r.u.attainment} gap={r.u.gap} status={r.u.status} />
                  <Dim label="D" demand={r.d.demand} attainment={r.d.attainment} gap={r.d.gap} status={r.d.status} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
