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
  scaffoldingStatus: 'well_scaffolded' | 'top_heavy' | 'bottom_heavy' | 'coverage_only' | 'no_introduction' | 'brittle_scaffold' | 'not_addressed';
  phases: { introduction: boolean; practice: boolean; integration: boolean };
  cumulativePfScore: number;
  pfStatus: 'well_developed' | 'developing' | 'thin' | 'absent' | 'no_data';
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

function depthBg(d: number | null): string {
  if (d === null || d === undefined) return 'pg-dnone';
  return 'pg-d' + Math.max(0, Math.min(5, d));
}

function pfDotColor(pf: PfConditions | null): string {
  if (!pf) return 'bg-[#B9B4C4]';
  const w = (v: 'present' | 'partial' | 'absent') => v === 'present' ? 1 : v === 'partial' ? 0.5 : 0;
  const total = w(pf.generate_then_consolidate) + w(pf.open_ended_problems) + w(pf.revision_cycles) + w(pf.structured_post_mortem);
  if (total >= 3) return 'bg-[#2F6B3A]';
  if (total >= 1.5) return 'bg-[#B57600]';
  return 'bg-[#9B2C2C]';
}

function statusChip(s: Row['scaffoldingStatus']): { label: string; cls: string } {
  switch (s) {
    case 'well_scaffolded':  return { label: 'well-scaffolded', cls: 'pg-cue-done' };
    case 'top_heavy':        return { label: 'top-heavy',       cls: 'pg-cue-input' };
    case 'bottom_heavy':     return { label: 'bottom-heavy',    cls: 'pg-cue-input' };
    case 'coverage_only':    return { label: 'coverage-only',   cls: 'pg-cue-input' };
    case 'no_introduction':  return { label: 'no intro',        cls: 'pg-cue-issue' };
    case 'brittle_scaffold': return { label: 'brittle',         cls: 'pg-cue-issue' };
    case 'not_addressed':    return { label: 'not addressed',   cls: 'pg-cue-none' };
  }
}

function pfChip(s: Row['pfStatus'], cum: number): { label: string; cls: string } {
  if (s === 'no_data') {
    return { label: 'no PF data', cls: 'pg-cue-none' };
  }
  const label = `${s.replaceAll('_', '-')} · ${cum.toFixed(2)}`;
  switch (s) {
    case 'well_developed': return { label, cls: 'pg-cue-done' };
    case 'developing':     return { label, cls: 'pg-cue-draft' };
    case 'thin':           return { label, cls: 'pg-cue-input' };
    case 'absent':         return { label, cls: 'pg-cue-none' };
    default: {
      const _exhaustive: never = s;
      return { label: String(_exhaustive), cls: 'pg-cue-none' };
    }
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
    <div className="pg-stack">
      <div className="pg-row">
        <label className="pg-label">Career target</label>
        <select
          value={targetId}
          onChange={e => setTargetId(e.target.value)}
          className="pg-select"
        >
          {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {loading && <span className="pg-meta">Loading…</span>}
        {error && <span className="pg-err">{error}</span>}
      </div>

      {data && (
        <div className="pg-card pg-matrix">
          <table className="pg-table">
            <thead>
              <tr>
                <th className="pg-sticky min-w-[220px]">Sub-competency</th>
                {data.courses.map(c => (
                  <th key={c.snapshotId} className="min-w-[120px]" style={{ textAlign: 'left' }}>
                    <div className="pg-code">{c.courseCode}</div>
                    <div className="text-xs font-normal truncate max-w-[120px]">{c.courseTitle}</div>
                  </th>
                ))}
                <th className="min-w-[220px]" style={{ textAlign: 'left' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => {
                const status = statusChip(r.scaffoldingStatus);
                const pf = pfChip(r.pfStatus, r.cumulativePfScore);
                const cellBySnap = new Map(r.cells.map(c => [c.snapshotId, c]));
                return (
                  <tr key={r.subCompetency.id}>
                    <td className="pg-sticky">{r.subCompetency.name}</td>
                    {data.courses.map(c => {
                      const cell = cellBySnap.get(c.snapshotId);
                      if (!cell) return <td key={c.snapshotId} className="px-1 py-0.5"><div className="h-6 w-full rounded border border-dashed" style={{ borderColor: '#DCD9E2', background: '#FBFBFA' }} /></td>;
                      return (
                        <td key={c.snapshotId} className="px-1 py-0.5">
                          <div
                            className={`relative h-6 w-full rounded ${depthBg(cell.dDepth)}`}
                            title={`K=${cell.kDepth ?? '·'} U=${cell.uDepth ?? '·'} D=${cell.dDepth}`}
                          >
                            <span className={`absolute left-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${pfDotColor(cell.pfConditions)}`} title="Productive-failure conditions are assessed at the course level and shown against each sub-competency this course contributes to." />
                            {cell.pfConditions?.structured_post_mortem === 'present' && (
                              <span className="absolute right-0.5 top-0 text-[8px] font-bold text-[#2F6B3A]">R</span>
                            )}
                            {cell.pfConditions?.structured_post_mortem === 'partial' && (
                              <span className="absolute right-0.5 top-0 text-[8px] font-bold text-[#8A5A00]">r</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1">
                      <div className="flex flex-col gap-0.5">
                        <span className={`pg-cue ${status.cls}`}>{status.label}</span>
                        <span className={`pg-cue ${pf.cls}`}>{pf.label}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="pg-meta" style={{ padding: '8px 16px 12px' }}>
            PF dots reflect course-level productive-failure conditions applied to each sub-competency the course contributes to. &ldquo;no PF data&rdquo; means Audit Area 7 was not assessed for that course (distinct from &ldquo;absent&rdquo;).
          </p>
        </div>
      )}

      <div className="pg-meta" style={{ display: 'grid', gap: 4 }}>
        <p><span className="inline-block h-2 w-2 rounded-full bg-[#2F6B3A] mr-1.5 align-middle" />green dot = ≥3 PF conditions present · <span className="inline-block h-2 w-2 rounded-full bg-[#B57600] mx-1.5 align-middle" />amber = ≥1.5 · <span className="inline-block h-2 w-2 rounded-full bg-[#9B2C2C] mx-1.5 align-middle" />red = &lt;1.5 · <span className="inline-block h-2 w-2 rounded-full bg-[#B9B4C4] mx-1.5 align-middle" />grey = PF not assessed</p>
        <p>R = structured post-mortem present · r = partial · cell background = D depth (0–5, light→saturated)</p>
      </div>
    </div>
  );
}
