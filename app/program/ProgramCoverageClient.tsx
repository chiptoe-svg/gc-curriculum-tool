'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  MatrixCourse,
  MatrixSubCompetency,
  MatrixCoverageCell,
} from '@/lib/db/program-coverage-queries';

interface MatrixData {
  courses: MatrixCourse[];
  targets: Array<{ id: string; name: string; displayOrder: number }>;
  subCompetencies: MatrixSubCompetency[];
  cells: MatrixCoverageCell[];
}

interface Props {
  slug: string;
  initialData: MatrixData;
}

interface SelectedCell {
  course: MatrixCourse;
  subCompetency: MatrixSubCompetency;
  cell: MatrixCoverageCell | null;  // null when not yet scored
}

// Convert a max(K/U/D) depth into a Tailwind background class.
function depthColor(maxDepth: number | null): string {
  if (maxDepth === null) return 'bg-slate-100';   // not scored yet
  if (maxDepth === 0) return 'bg-slate-50';        // not present
  if (maxDepth === 1) return 'bg-orange-100';
  if (maxDepth === 2) return 'bg-orange-200';
  if (maxDepth === 3) return 'bg-amber-300';
  if (maxDepth === 4) return 'bg-lime-400';
  if (maxDepth === 5) return 'bg-emerald-500';
  return 'bg-slate-100';
}

function depthText(maxDepth: number | null): string {
  if (maxDepth === null) return 'text-slate-400';
  if (maxDepth === 0) return 'text-slate-300';
  if (maxDepth >= 5) return 'text-white';
  if (maxDepth >= 4) return 'text-slate-900';
  return 'text-slate-700';
}

function maxOf(c: MatrixCoverageCell | null): number | null {
  if (!c) return null;
  const vals = [c.kDepth, c.uDepth, c.dDepth].filter((v): v is number => v !== null);
  if (vals.length === 0) return c.dDepth;
  return Math.max(...vals);
}

// "Upper-depth" lens (internal value 'problem-solving'; user-facing label is
// "Upper-depth", renamed 2026-06-04). It is an UPPER-DEPTH OPPORTUNITY MAP: it
// shows where problem-solving CAN form (U/D upper depths), reading depth ALONE.
// It is NOT the problem-solving-formation diagnostic — that requires depth ×
// productive-failure × reflection × sequence, which is the Phase 1B Scaffolding
// view. Labeling this view "problem-solving" overclaimed; see the deep-dive's
// "upper-depth opportunity map" framing.
// The U-4/5 anchors ("reasons through novel cases / critiques the principle")
// and D-4/5 anchors ("adapts to new conditions / performs creatively with
// critical judgment") are the depth surface that defines problem-solving
// competence within a domain. K is excluded because K alone is recall —
// necessary but insufficient.
//
// The lens is graded, not binary: it doesn't hide lower-depth cells, it
// re-weights the visual emphasis so the D=4 and D=5 territory stands out
// and the D≤2 territory recedes. Per docs/background.html §8, problem-
// solving capacity contributes in degrees across the depth range; the
// lens visualizes that distribution.
function psDepthOf(c: MatrixCoverageCell | null): number | null {
  if (!c) return null;
  const vals = [c.uDepth, c.dDepth].filter((v): v is number => v !== null);
  if (vals.length === 0) return c.dDepth;
  return Math.max(...vals);
}

function psColor(d: number | null): string {
  if (d === null) return 'bg-slate-100';
  if (d === 0) return 'bg-slate-50';
  if (d === 1) return 'bg-slate-100';        // de-emphasized: low PF contribution
  if (d === 2) return 'bg-slate-200';        // de-emphasized
  if (d === 3) return 'bg-amber-200';         // emerging
  if (d === 4) return 'bg-lime-400';          // problem-solving territory
  if (d === 5) return 'bg-emerald-600';       // mastery / creative judgment
  return 'bg-slate-100';
}

function psText(d: number | null): string {
  if (d === null) return 'text-slate-400';
  if (d <= 2) return 'text-slate-500';
  if (d === 3) return 'text-amber-900';
  if (d === 4) return 'text-slate-900';
  return 'text-white';
}

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type Lens = 'coverage' | 'problem-solving';

export function ProgramCoverageClient({ slug, initialData }: Props) {
  const [data, setData] = useState<MatrixData>(initialData);
  const [activeTargetId, setActiveTargetId] = useState<string>(
    initialData.targets[0]?.id ?? '',
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [scoringCell, setScoringCell] = useState<string | null>(null);
  const [scoringError, setScoringError] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>('coverage');

  // For each (snapshot, target) pair, fast-lookup of cells indexed by
  // sub-competency. The matrix view drives off this.
  const cellsByKey = useMemo(() => {
    const map = new Map<string, MatrixCoverageCell>();
    for (const c of data.cells) {
      map.set(`${c.snapshotId}:${c.careerTargetId}:${c.subCompetencyId}`, c);
    }
    return map;
  }, [data.cells]);

  const visibleSubs = useMemo(
    () => data.subCompetencies.filter(s => s.careerTargetId === activeTargetId),
    [data.subCompetencies, activeTargetId],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshStatus(null);
    try {
      const res = await fetch(`/api/program/coverage/refresh?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setRefreshStatus(`Refresh failed: ${(json as { error?: string }).error ?? res.status}`);
        return;
      }
      const { scored, failed } = json as { scored: number; failed: number };
      setRefreshStatus(`Scored ${scored} pair${scored === 1 ? '' : 's'}${failed > 0 ? `, ${failed} failed` : ''}.`);
      // Re-fetch matrix data to pick up new cells.
      const dataRes = await fetch(`/api/program/coverage?slug=${encodeURIComponent(slug)}`);
      if (dataRes.ok) setData(await dataRes.json());
    } catch (e) {
      setRefreshStatus(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [slug]);

  const handleScoreCell = useCallback(async (snapshotId: string, targetId: string) => {
    const key = `${snapshotId}:${targetId}`;
    setScoringCell(key);
    setScoringError(null);
    try {
      const res = await fetch(
        `/api/program/coverage/refresh/${encodeURIComponent(snapshotId)}/${encodeURIComponent(targetId)}?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (!res.ok) {
        setScoringError((json as { error?: string; detail?: string }).error ?? 'scoring failed');
        return;
      }
      // Re-fetch matrix to pick up the new cells.
      const dataRes = await fetch(`/api/program/coverage?slug=${encodeURIComponent(slug)}`);
      if (dataRes.ok) setData(await dataRes.json());
    } catch (e) {
      setScoringError(e instanceof Error ? e.message : 'scoring failed');
    } finally {
      setScoringCell(null);
    }
  }, [slug]);

  // Problem-solving lens rollup: for the active target, aggregate across all
  // snapshots to find the program's cumulative reach per sub-competency on
  // the U/D dimensions. The user-visible signal is graded, not binary —
  // per the degrees-not-thresholds principle from background.html §8.
  // Note: this hook must be declared BEFORE any conditional early returns
  // (the no-snapshots and no-targets guards below) to satisfy the rules of
  // hooks. The body handles the empty cases internally.
  const psRollup = useMemo(() => {
    const activeTargetRow = data.targets.find(t => t.id === activeTargetId);
    if (!activeTargetRow) return null;
    const subs = data.subCompetencies.filter(s => s.careerTargetId === activeTargetId);
    let reachedDeep = 0;     // max(U,D) ≥ 4 across any snapshot
    let reachedPracticed = 0; // max(U,D) === 3
    let reachedShallow = 0;   // max(U,D) === 1 or 2
    let absent = 0;           // max(U,D) === 0 or no scored cell
    for (const s of subs) {
      let best = 0;
      let anyCell = false;
      for (const c of data.cells) {
        if (c.careerTargetId !== activeTargetId || c.subCompetencyId !== s.id) continue;
        anyCell = true;
        const d = psDepthOf(c) ?? 0;
        if (d > best) best = d;
      }
      if (!anyCell || best === 0) absent++;
      else if (best >= 4) reachedDeep++;
      else if (best === 3) reachedPracticed++;
      else reachedShallow++;
    }
    return { total: subs.length, reachedDeep, reachedPracticed, reachedShallow, absent };
  }, [activeTargetId, data.targets, data.subCompetencies, data.cells]);

  if (data.courses.length === 0) {
    return (
      <div className="rounded-md border bg-card px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">No snapshots yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Capture and snapshot at least one course before the coverage matrix has anything to show.{' '}
          <Link href={`/capture/GC%201010?slug=${encodeURIComponent(slug)}`} className="underline hover:text-foreground">
            Start with a course
          </Link>.
        </p>
      </div>
    );
  }

  if (data.targets.length === 0) {
    return (
      <div className="rounded-md border bg-card px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">No career targets defined</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The matrix scores courses against career targets and their sub-competencies. Define those first in the prototype area.
        </p>
      </div>
    );
  }

  const activeTarget = data.targets.find(t => t.id === activeTargetId);
  const scoredPairs = new Set(data.cells.map(c => `${c.snapshotId}:${c.careerTargetId}`));
  const totalPairs = data.courses.length * data.targets.length;
  const scoredCount = scoredPairs.size;

  return (
    <div className="space-y-5">
      {/* Status & refresh */}
      <section className="rounded-md border bg-card px-4 py-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{data.courses.length} course{data.courses.length === 1 ? '' : 's'}</span> with snapshots ·
            {' '}
            <span className="font-medium text-foreground">{data.targets.length} career target{data.targets.length === 1 ? '' : 's'}</span> ·
            {' '}
            <span className="font-medium text-foreground">{scoredCount}/{totalPairs}</span> pairs scored
          </p>
          {refreshStatus && <p className="mt-1 text-muted-foreground">{refreshStatus}</p>}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || scoredCount === totalPairs}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {refreshing ? 'Scoring…' : scoredCount === totalPairs ? 'Up to date' : `Score ${totalPairs - scoredCount} stale pair${totalPairs - scoredCount === 1 ? '' : 's'}`}
        </button>
      </section>

      {/* Lens toggle */}
      <section className="rounded-md border bg-card px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Lens:</span>
          <div className="flex rounded-md border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setLens('coverage')}
              className={'px-3 py-1.5 ' + (lens === 'coverage' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted/50 text-foreground')}
              title="Show K/U/D coverage colored by max depth across all three dimensions"
            >
              Coverage
            </button>
            <button
              type="button"
              onClick={() => setLens('problem-solving')}
              className={'px-3 py-1.5 border-l ' + (lens === 'problem-solving' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted/50 text-foreground')}
              title="Upper-depth opportunity map: emphasizes the U/D upper-range depths where problem-solving CAN form. Reads depth alone — whether the program actually builds problem-solving (productive failure × reflection × sequence) is the Scaffolding view (Phase 1B). Per docs/background.html §8."
            >
              Upper-depth
            </button>
          </div>
        </div>
        {lens === 'problem-solving' && psRollup && (
          <div className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{psRollup.reachedDeep}</span>
            <span> of {psRollup.total} sub-competencies reach the upper-range U/D depth (≥4) across the program. </span>
            <span className="text-amber-700">{psRollup.reachedPracticed}</span>
            <span> practiced (=3), </span>
            <span className="text-slate-500">{psRollup.reachedShallow}</span>
            <span> shallow (1–2), </span>
            <span className="text-slate-400">{psRollup.absent}</span>
            <span> absent.</span>
          </div>
        )}
      </section>

      {/* Target tabs */}
      <section className="border-b">
        <div className="flex gap-1 overflow-x-auto">
          {data.targets.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTargetId(t.id)}
              className={
                'px-3 py-2 text-xs font-medium border-b-2 -mb-px ' + (t.id === activeTargetId
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground')
              }
            >
              {t.name}
            </button>
          ))}
        </div>
      </section>

      {/* Matrix */}
      {activeTarget && (
        <section className="rounded-md border bg-card overflow-x-auto">
          {visibleSubs.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              {activeTarget.name} has no sub-competencies defined yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-3 py-2 sticky left-0 bg-muted/30 font-semibold text-muted-foreground">Course</th>
                  {visibleSubs.map(s => (
                    <th
                      key={s.id}
                      className="px-2 py-2 font-medium text-muted-foreground border-l align-bottom"
                      style={{ minWidth: '88px', maxWidth: '120px' }}
                      title={s.name}
                    >
                      <div className="text-[10px] leading-tight">{s.name}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.courses.map(course => (
                  <tr key={course.snapshotId} className="border-t">
                    <th className="text-left px-3 py-2 sticky left-0 bg-card border-r" style={{ minWidth: '120px' }}>
                      <div className="font-mono text-[11px] text-foreground">{course.courseCode}</div>
                      <div className="text-[10px] text-muted-foreground truncate" style={{ maxWidth: '140px' }} title={course.courseTitle}>{course.courseTitle}</div>
                    </th>
                    {visibleSubs.map(s => {
                      const key = `${course.snapshotId}:${activeTargetId}:${s.id}`;
                      const cell = cellsByKey.get(key) ?? null;
                      const isSelected = selected?.cell?.snapshotId === course.snapshotId && selected?.subCompetency.id === s.id;
                      // Lens dispatch: 'coverage' colors by max(K,U,D); 'problem-solving'
                      // colors by max(U,D) with the lower-depth bands faded so the
                      // upper-depth territory stands out as the problem-solving surface.
                      const colorClass = lens === 'problem-solving'
                        ? psColor(psDepthOf(cell)) + ' ' + psText(psDepthOf(cell))
                        : depthColor(maxOf(cell)) + ' ' + depthText(maxOf(cell));
                      return (
                        <td
                          key={s.id}
                          onClick={() => setSelected({ course, subCompetency: s, cell })}
                          className={
                            'px-2 py-2 text-center border-l cursor-pointer transition '
                            + colorClass + ' '
                            + (isSelected ? 'ring-2 ring-primary ring-inset' : 'hover:opacity-80')
                          }
                          title={cell?.rationale || (cell === null ? 'Not scored yet — click to score' : '')}
                        >
                          {cell ? (
                            <div className="font-mono text-[11px]">
                              {cell.kDepth ?? '—'}/{cell.uDepth ?? '—'}/{cell.dDepth}
                            </div>
                          ) : (
                            <div className="text-[10px] italic text-muted-foreground">—</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* Legend */}
      <section className="rounded-md border bg-muted/20 px-4 py-3">
        {lens === 'coverage' ? (
          <>
            <div className="flex items-center gap-4 flex-wrap text-[11px]">
              <span className="text-muted-foreground">Cell color = max(K, U, D):</span>
              {[0, 1, 2, 3, 4, 5].map(n => (
                <span key={n} className="flex items-center gap-1">
                  <span className={`inline-block h-4 w-6 rounded ${depthColor(n)} ${depthText(n)} text-center font-mono leading-4`}>{n}</span>
                  <span className="text-muted-foreground">{
                    n === 0 ? 'not present' :
                    n === 1 ? 'mentioned' :
                    n === 2 ? 'introduced' :
                    n === 3 ? 'practiced' :
                    n === 4 ? 'demonstrated' :
                    'mastered'
                  }</span>
                </span>
              ))}
              <span className="flex items-center gap-1 ml-auto">
                <span className={`inline-block h-4 w-6 rounded ${depthColor(null)}`}></span>
                <span className="text-muted-foreground">not scored</span>
              </span>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Each cell shows K/U/D scores. Click a cell for details and evidence. Click &ldquo;Score&rdquo; to run the AI scorer on missing pairs.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-4 flex-wrap text-[11px]">
              <span className="text-muted-foreground">Cell color = max(U, D), graded:</span>
              {[0, 1, 2, 3, 4, 5].map(n => (
                <span key={n} className="flex items-center gap-1">
                  <span className={`inline-block h-4 w-6 rounded ${psColor(n)} ${psText(n)} text-center font-mono leading-4`}>{n}</span>
                  <span className="text-muted-foreground">{
                    n === 0 ? 'absent' :
                    n === 1 ? 'shallow' :
                    n === 2 ? 'shallow' :
                    n === 3 ? 'practiced' :
                    n === 4 ? 'novel cases' :
                    'creative judgment'
                  }</span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              This <strong>upper-depth opportunity map</strong> emphasizes the U/D upper-range depths — where the <em>opportunity</em> for problem-solving formation appears. It reads <strong>depth alone</strong>; whether a course actually builds transferable problem-solving (productive failure × structured reflection × sequence) is the Scaffolding view (Phase 1B), not this map. U-4/5 = reasons through and critiques principles in novel cases; D-4/5 = adapts to new conditions, performs with creative judgment. Lower depths are de-emphasized but not hidden — they contribute in degrees, per <a href="https://chiptoe-svg.github.io/gc-curriculum-tool/docs/background.html#problem-solving" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">background.html §8</a>. K is excluded (recall alone doesn&rsquo;t indicate problem-solving).
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground italic">
              v2 (planned): weight the contribution of each contributing snapshot by its productive-failure conditions (Audit Area 7 of CourseCapture) so this view also reflects whether the courses that reach upper depths do so through the kind of pedagogy that produces transferable problem-solving rather than memorization at depth.
            </p>
          </>
        )}
      </section>

      {/* Cell detail drawer */}
      {selected && (
        <CellDetailDrawer
          selected={selected}
          targetName={data.targets.find(t => t.id === activeTargetId)?.name ?? ''}
          slug={slug}
          scoring={scoringCell === `${selected.course.snapshotId}:${activeTargetId}`}
          onClose={() => setSelected(null)}
          onScore={() => handleScoreCell(selected.course.snapshotId, activeTargetId)}
        />
      )}
      {scoringError && (
        <p className="text-xs text-destructive">Scoring error: {scoringError}</p>
      )}
    </div>
  );
}

function CellDetailDrawer({
  selected,
  targetName,
  slug,
  scoring,
  onClose,
  onScore,
}: {
  selected: SelectedCell;
  targetName: string;
  slug: string;
  scoring: boolean;
  onClose: () => void;
  onScore: () => void;
}) {
  const { course, subCompetency, cell } = selected;
  return (
    <section className="rounded-md border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {course.courseCode} × {targetName}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold">{subCompetency.name}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          close
        </button>
      </header>
      <div className="px-4 py-3 space-y-3 text-xs">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Course</p>
          <p className="mt-0.5 text-sm">{course.courseTitle}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Snapshot {course.snapshotCaption || ''} · {fmtDate(course.snapshotCreatedAt)}
          </p>
        </div>

        {cell ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <DepthCell label="Know" value={cell.kDepth} />
              <DepthCell label="Understand" value={cell.uDepth} />
              <DepthCell label="Do" value={cell.dDepth} />
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Confidence</p>
              <p className="mt-0.5">{cell.confidence}</p>
            </div>

            {cell.matchedCompetency && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Matched snapshot competency</p>
                <p className="mt-0.5 leading-snug">{cell.matchedCompetency}</p>
              </div>
            )}

            {cell.evidenceExcerpt && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
                <blockquote className="mt-0.5 border-l-2 border-muted pl-2 italic text-muted-foreground">
                  {cell.evidenceExcerpt}
                </blockquote>
              </div>
            )}

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rationale</p>
              <p className="mt-0.5 leading-snug text-muted-foreground">{cell.rationale}</p>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t">
              <Link
                href={`/capture/${encodeURIComponent(course.courseCode)}?slug=${encodeURIComponent(slug)}`}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                View snapshot →
              </Link>
              <button
                type="button"
                onClick={onScore}
                disabled={scoring}
                className="ml-auto rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                {scoring ? 'Re-scoring…' : 'Re-score this pair'}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="italic text-muted-foreground">This (snapshot, target) pair has not been scored yet.</p>
            <button
              type="button"
              onClick={onScore}
              disabled={scoring}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {scoring ? 'Scoring…' : 'Score this pair'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function DepthCell({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm italic text-muted-foreground">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-mono ${value >= 4 ? 'text-emerald-700' : value >= 2 ? 'text-amber-700' : 'text-slate-600'}`}>{value}</p>
    </div>
  );
}
