'use client';

import { useEffect, useState } from 'react';

interface Target { id: string; name: string; }
interface PfConditions {
  generate_then_consolidate: 'present' | 'partial' | 'absent';
  open_ended_problems: 'present' | 'partial' | 'absent';
  revision_cycles: 'present' | 'partial' | 'absent';
  structured_post_mortem: 'present' | 'partial' | 'absent';
  max_supporting_depth: number;
  notes: string[];
}
interface Cell {
  snapshotId: string;
  courseCode: string;
  sequenceIndex: number;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  pfConditions: PfConditions | null;
}
interface Row {
  subCompetency: { id: string; name: string; descriptorD: string | null };
  cells: Cell[];
  scaffoldingStatus: 'well_scaffolded' | 'top_heavy' | 'bottom_heavy' | 'coverage_only' | 'brittle_scaffold' | 'not_addressed';
  phases: { introduction: boolean; practice: boolean; integration: boolean };
  cumulativePfScore: number;
  pfStatus: 'well_developed' | 'developing' | 'thin' | 'absent';
}
interface CourseHeader {
  snapshotId: string;
  courseCode: string;
  courseTitle: string;
  level: number;
  sequenceIndex: number;
}
interface Payload {
  target: { id: string; name: string };
  courses: CourseHeader[];
  rows: Row[];
}

const D_PALETTE = ['bg-stone-100', 'bg-amber-100', 'bg-amber-200', 'bg-orange-200', 'bg-orange-300', 'bg-rose-300'];

function depthBg(d: number | null): string {
  if (d === null || d === undefined) return 'bg-stone-50';
  return D_PALETTE[Math.max(0, Math.min(5, d))] ?? 'bg-stone-100';
}

function pfDotColor(pf: PfConditions | null): string {
  if (!pf) return 'bg-stone-300';
  const w = (v: 'present' | 'partial' | 'absent') => v === 'present' ? 1 : v === 'partial' ? 0.5 : 0;
  const total = w(pf.generate_then_consolidate) + w(pf.open_ended_problems) + w(pf.revision_cycles) + w(pf.structured_post_mortem);
  if (total >= 3) return 'bg-emerald-500';
  if (total >= 1.5) return 'bg-amber-400';
  return 'bg-rose-500';
}

function statusChip(s: Row['scaffoldingStatus']): { label: string; cls: string } {
  switch (s) {
    case 'well_scaffolded':  return { label: 'well-scaffolded', cls: 'bg-emerald-100 text-emerald-900' };
    case 'top_heavy':        return { label: 'top-heavy',       cls: 'bg-amber-100 text-amber-900' };
    case 'bottom_heavy':     return { label: 'bottom-heavy',    cls: 'bg-amber-100 text-amber-900' };
    case 'coverage_only':    return { label: 'coverage-only',   cls: 'bg-orange-100 text-orange-900' };
    case 'brittle_scaffold': return { label: 'brittle',         cls: 'bg-rose-100 text-rose-900' };
    case 'not_addressed':    return { label: 'not addressed',   cls: 'bg-stone-100 text-stone-700' };
  }
}

function pfChip(s: Row['pfStatus'], cum: number): { label: string; cls: string } {
  const label = `${s.replace('_', '-')} · ${cum.toFixed(2)}`;
  switch (s) {
    case 'well_developed': return { label, cls: 'bg-emerald-100 text-emerald-900' };
    case 'developing':     return { label, cls: 'bg-amber-100 text-amber-900' };
    case 'thin':           return { label, cls: 'bg-orange-100 text-orange-900' };
    case 'absent':         return { label, cls: 'bg-stone-100 text-stone-700' };
  }
}

interface Props {
  slug: string;
  targets: Target[];
  selectedTargetId: string;
}

export function ScaffoldingStripClient({ slug, targets, selectedTargetId }: Props) {
  const [targetId, setTargetId] = useState(selectedTargetId);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targetId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/program/scaffolding?slug=${encodeURIComponent(slug)}&target=${encodeURIComponent(targetId)}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => { throw new Error(e.error ?? `HTTP ${r.status}`); }))
      .then((payload: Payload) => setData(payload))
      .catch(e => setError(e instanceof Error ? e.message : 'fetch failed'))
      .finally(() => setLoading(false));
  }, [targetId, slug]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Career target</label>
        <select
          value={targetId}
          onChange={e => setTargetId(e.target.value)}
          className="rounded border border-input bg-background px-2 py-1 text-sm"
        >
          {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      {data && (
        <div className="overflow-x-auto rounded border bg-card">
          <table className="text-xs">
            <thead>
              <tr className="bg-muted/40">
                <th className="sticky left-0 z-10 bg-muted/40 px-2 py-2 text-left font-medium min-w-[220px]">Sub-competency</th>
                {data.courses.map(c => (
                  <th key={c.snapshotId} className="px-2 py-2 text-left font-medium min-w-[120px]">
                    <div className="font-mono">{c.courseCode}</div>
                    <div className="text-[10px] font-normal text-muted-foreground truncate max-w-[120px]">{c.courseTitle}</div>
                  </th>
                ))}
                <th className="px-2 py-2 text-left font-medium min-w-[220px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => {
                const status = statusChip(r.scaffoldingStatus);
                const pf = pfChip(r.pfStatus, r.cumulativePfScore);
                const cellBySnap = new Map(r.cells.map(c => [c.snapshotId, c]));
                return (
                  <tr key={r.subCompetency.id} className="border-t">
                    <td className="sticky left-0 z-10 bg-card px-2 py-1.5">{r.subCompetency.name}</td>
                    {data.courses.map(c => {
                      const cell = cellBySnap.get(c.snapshotId);
                      if (!cell) return <td key={c.snapshotId} className="px-1 py-0.5"><div className="h-6 w-full rounded bg-stone-50 border border-dashed border-stone-200" /></td>;
                      return (
                        <td key={c.snapshotId} className="px-1 py-0.5">
                          <div
                            className={`relative h-6 w-full rounded ${depthBg(cell.dDepth)} ring-1 ring-stone-300`}
                            title={`K=${cell.kDepth ?? '·'} U=${cell.uDepth ?? '·'} D=${cell.dDepth}`}
                          >
                            <span className={`absolute left-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${pfDotColor(cell.pfConditions)}`} />
                            {cell.pfConditions?.structured_post_mortem === 'present' && (
                              <span className="absolute right-0.5 top-0 text-[8px] font-bold text-emerald-700">R</span>
                            )}
                            {cell.pfConditions?.structured_post_mortem === 'partial' && (
                              <span className="absolute right-0.5 top-0 text-[8px] font-bold text-amber-700">r</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1">
                      <div className="flex flex-col gap-0.5">
                        <span className={`inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${status.cls}`}>{status.label}</span>
                        <span className={`inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${pf.cls}`}>{pf.label}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-[11px] text-muted-foreground">
        <p><span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />green dot = ≥3 PF conditions present · <span className="inline-block h-2 w-2 rounded-full bg-amber-400 mx-1.5 align-middle" />amber = ≥1.5 · <span className="inline-block h-2 w-2 rounded-full bg-rose-500 mx-1.5 align-middle" />red = &lt;1.5 or no data</p>
        <p>R = structured post-mortem present · r = partial · cell background = D depth (0–5, light→saturated)</p>
      </div>
    </div>
  );
}
