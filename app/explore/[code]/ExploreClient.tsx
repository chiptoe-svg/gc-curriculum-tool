'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  CustomTargetSpec,
  TargetCompetency,
  ExploreAnalysis,
  AlignmentRow,
  Recommendation,
  WhatIfResult,
} from '@/lib/ai/explore/schema';
import { AskTab } from './AskTab';

interface SnapshotListItem {
  id: string;
  caption: string | null;
  createdAt: string;
  hasIncomingExpectations: boolean;
}

interface TargetListItem {
  id: string;
  kind: 'custom' | 'downstream';
  caption: string | null;
  createdAt: string;
  authoredAgainstSnapshotId: string | null;
}

interface AnalysisListItem {
  id: string;
  snapshotId: string;
  targetId: string;
  createdAt: string;
  recommendationCount: number;
}

interface DownstreamCandidate {
  code: string;
  title: string;
  hasSnapshot: boolean;
  hasIncomingExpectations: boolean;
  snapshotId: string | null;
  snapshotCaption: string | null;
}

interface Props {
  courseCode: string;
  courseTitle: string;
  slug: string;
  snapshots: SnapshotListItem[];
  initialSnapshotId: string;
  initialTargets: TargetListItem[];
  initialAnalyses: AnalysisListItem[];
  /**
   * When set (typically via `?tab=ask` deep-link), initialize the mode toggle
   * to this value so the user lands directly in the chat surface.
   */
  initialMode?: Mode;
}

type Mode = 'custom' | 'downstream' | 'ask';
type Stage = 'authoring' | 'editing-target' | 'ready-to-analyze' | 'analyzing' | 'viewing-analysis';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusChip({ status }: { status: AlignmentRow['status'] }) {
  const cfg = {
    covered: { color: 'bg-green-100 text-green-800', label: '✓ covered' },
    partial: { color: 'bg-amber-100 text-amber-800', label: '◐ partial' },
    underdeveloped: { color: 'bg-orange-100 text-orange-800', label: '↓ underdeveloped' },
    missing: { color: 'bg-red-100 text-red-800', label: '✕ missing' },
  } as const;
  const c = cfg[status];
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${c.color}`}>
      {c.label}
    </span>
  );
}

function DepthMini({ depth, label }: { depth: { k: number | null; u: number | null; d: number } | null; label: string }) {
  if (!depth) return <span className="text-[10px] text-muted-foreground">{label}: —</span>;
  return (
    <span className="text-[10px] text-muted-foreground font-mono">
      {label}: K={depth.k ?? '—'} U={depth.u ?? '—'} D={depth.d}
    </span>
  );
}

export function ExploreClient({
  courseCode,
  courseTitle,
  slug,
  snapshots,
  initialSnapshotId,
  initialTargets,
  initialAnalyses,
  initialMode,
}: Props) {
  const [snapshotId, setSnapshotId] = useState<string>(initialSnapshotId);
  const [mode, setMode] = useState<Mode>(initialMode ?? 'custom');
  const [targets, setTargets] = useState<TargetListItem[]>(initialTargets);
  const [analyses, setAnalyses] = useState<AnalysisListItem[]>(initialAnalyses);

  // Authoring state (custom mode)
  const [prose, setProse] = useState('');
  const [draftingTarget, setDraftingTarget] = useState(false);
  const [draftedTarget, setDraftedTarget] = useState<CustomTargetSpec | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [authorError, setAuthorError] = useState<string | null>(null);

  // Downstream state
  const [downstreamCandidates, setDownstreamCandidates] = useState<DownstreamCandidate[]>([]);
  const [downstreamSelected, setDownstreamSelected] = useState<Set<string>>(new Set());
  const [loadingDownstream, setLoadingDownstream] = useState(false);
  const [buildingDownstream, setBuildingDownstream] = useState(false);

  // Selected target + analysis
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisView, setAnalysisView] = useState<ExploreAnalysis | null>(null);

  const fetchDownstreamCandidates = useCallback(async () => {
    setLoadingDownstream(true);
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/downstream-candidates?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) return;
      const json = await res.json() as { candidates: DownstreamCandidate[] };
      setDownstreamCandidates(json.candidates);
    } finally {
      setLoadingDownstream(false);
    }
  }, [courseCode, slug]);

  useEffect(() => {
    if (mode === 'downstream' && downstreamCandidates.length === 0) {
      void fetchDownstreamCandidates();
    }
  }, [mode, downstreamCandidates.length, fetchDownstreamCandidates]);

  async function handleDraftCustom() {
    if (!prose.trim()) return;
    setDraftingTarget(true);
    setAuthorError(null);
    setDraftedTarget(null);
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/draft-custom?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prose, snapshotId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthorError((json as { error?: string }).error ?? 'draft failed');
        return;
      }
      const { target } = json as { target: CustomTargetSpec };
      setDraftedTarget(target);
    } catch (e) {
      setAuthorError(e instanceof Error ? e.message : 'draft failed');
    } finally {
      setDraftingTarget(false);
    }
  }

  async function handleSaveTarget(spec: CustomTargetSpec | { kind: 'downstream'; courses: Array<{ code: string; title: string; snapshot_id: string; incoming_expectations: unknown[] }> }, caption: string | null, proseInput: string | null) {
    setSavingTarget(true);
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/targets?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spec,
          caption,
          proseInput,
          authoredAgainstSnapshotId: snapshotId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthorError((json as { error?: string }).error ?? 'save failed');
        return null;
      }
      const { target } = json as { target: TargetListItem };
      setTargets(prev => [target, ...prev]);
      setSelectedTargetId(target.id);
      setDraftedTarget(null);
      setProse('');
      setDownstreamSelected(new Set());
      return target.id;
    } finally {
      setSavingTarget(false);
    }
  }

  async function handleRunAnalysis(targetId: string) {
    setRunningAnalysis(true);
    setAnalysisError(null);
    setAnalysisView(null);
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/analyze?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId, targetId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAnalysisError((json as { error?: string; detail?: string }).error ?? 'analysis failed');
        return;
      }
      const { analysis } = json as { analysis: { id: string; snapshotId: string; targetId: string; createdAt: string; analysis: ExploreAnalysis } };
      setAnalyses(prev => [
        { id: analysis.id, snapshotId: analysis.snapshotId, targetId: analysis.targetId, createdAt: analysis.createdAt, recommendationCount: analysis.analysis.recommendations.length },
        ...prev,
      ]);
      setAnalysisView(analysis.analysis);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : 'analysis failed');
    } finally {
      setRunningAnalysis(false);
    }
  }

  async function handleBuildDownstream() {
    if (downstreamSelected.size === 0) return;
    setBuildingDownstream(true);
    setAuthorError(null);
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/build-downstream?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ downstreamCodes: Array.from(downstreamSelected) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthorError((json as { error?: string }).error ?? 'build failed');
        return;
      }
      const { target } = json as { target: { kind: 'downstream'; courses: Array<{ code: string; title: string; snapshot_id: string; incoming_expectations: unknown[] }> } };
      const caption = `Downstream: ${target.courses.map(c => c.code).join(', ')}`;
      await handleSaveTarget(target, caption, null);
    } finally {
      setBuildingDownstream(false);
    }
  }

  function updateDraftedDepth(idx: number, dim: 'k' | 'u' | 'd', val: number | null) {
    if (!draftedTarget) return;
    const comps = draftedTarget.competencies.slice();
    const existing = comps[idx];
    if (!existing) return;
    comps[idx] = { ...existing, target_depth: { ...existing.target_depth, [dim]: val } };
    setDraftedTarget({ ...draftedTarget, competencies: comps });
  }

  function updateDraftedStatement(idx: number, statement: string) {
    if (!draftedTarget) return;
    const comps = draftedTarget.competencies.slice();
    const existing = comps[idx];
    if (!existing) return;
    comps[idx] = { ...existing, statement };
    setDraftedTarget({ ...draftedTarget, competencies: comps });
  }

  function removeDraftedCompetency(idx: number) {
    if (!draftedTarget) return;
    const comps = draftedTarget.competencies.filter((_, i) => i !== idx);
    setDraftedTarget({ ...draftedTarget, competencies: comps });
  }

  const selectedTarget = targets.find(t => t.id === selectedTargetId);

  return (
    <div className="space-y-5">
      {/* Snapshot picker */}
      <section className="rounded-md border bg-card px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Snapshot</p>
          <select
            value={snapshotId}
            onChange={e => setSnapshotId(e.target.value)}
            className="mt-1 rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {snapshots.map(s => (
              <option key={s.id} value={s.id}>
                {s.caption || 'Snapshot'} · {formatDate(s.createdAt)}
                {!s.hasIncomingExpectations && ' (no incoming expectations)'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Mode</p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setMode('custom')}
              className={'rounded-md border px-3 py-1.5 text-xs font-medium ' + (mode === 'custom' ? 'border-primary bg-primary/10 text-foreground' : 'border-input bg-background text-muted-foreground')}
            >Custom target</button>
            <button
              type="button"
              onClick={() => setMode('downstream')}
              className={'rounded-md border px-3 py-1.5 text-xs font-medium ' + (mode === 'downstream' ? 'border-primary bg-primary/10 text-foreground' : 'border-input bg-background text-muted-foreground')}
            >Downstream courses</button>
            <button
              type="button"
              onClick={() => setMode('ask')}
              className={'rounded-md border px-3 py-1.5 text-xs font-medium ' + (mode === 'ask' ? 'border-primary bg-primary/10 text-foreground' : 'border-input bg-background text-muted-foreground')}
              title="Ask about this course or anything else in the program — answers come from the curriculum wiki"
            >💬 Ask about this course</button>
          </div>
        </div>
      </section>

      {mode === 'ask' && (
        <AskTab courseCode={courseCode} courseTitle={courseTitle} slug={slug} />
      )}

      {/* Saved targets */}
      {targets.filter(t => t.kind === mode).length > 0 && (
        <section className="rounded-md border bg-card px-4 py-3">
          <h3 className="text-sm font-semibold mb-2">Saved {mode} targets ({targets.filter(t => t.kind === mode).length})</h3>
          <ul className="space-y-1">
            {targets.filter(t => t.kind === mode).map(t => (
              <li key={t.id} className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedTargetId(t.id)}
                  className={'text-xs text-left flex-1 hover:text-foreground ' + (selectedTargetId === t.id ? 'font-medium text-foreground' : 'text-muted-foreground')}
                >
                  {t.caption || `${t.kind} target`} · {formatDate(t.createdAt)}
                </button>
                {selectedTargetId === t.id && (
                  <button
                    type="button"
                    onClick={() => void handleRunAnalysis(t.id)}
                    disabled={runningAnalysis}
                    className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {runningAnalysis ? 'Running…' : 'Run analysis'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* CUSTOM authoring */}
      {mode === 'custom' && !draftedTarget && (
        <section className="rounded-md border bg-card px-4 py-4 space-y-3">
          <header>
            <h3 className="text-sm font-semibold">New custom target</h3>
            <p className="text-xs text-muted-foreground">
              Describe in plain language what you want students to be able to do. The AI will propose a structured target you can edit before saving.
            </p>
          </header>
          <textarea
            value={prose}
            onChange={e => setProse(e.target.value)}
            rows={5}
            placeholder="e.g., I want students to leave able to defend a brand color choice to a non-technical client using measurement data and a written rationale."
            className="w-full resize-y rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleDraftCustom}
              disabled={!prose.trim() || draftingTarget}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {draftingTarget ? 'Drafting…' : 'Draft target'}
            </button>
          </div>
          {authorError && <p className="text-xs text-destructive">{authorError}</p>}
        </section>
      )}

      {/* CUSTOM editing drafted target */}
      {mode === 'custom' && draftedTarget && (
        <section className="rounded-md border bg-card px-4 py-4 space-y-3">
          <header className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Review and edit proposed target ({draftedTarget.competencies.length} competencies)</h3>
              <p className="text-xs text-muted-foreground">Adjust depths, statements, or remove any items before saving.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setDraftedTarget(null); setProse(''); }}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-muted"
              >Discard</button>
              <button
                type="button"
                onClick={() => {
                  const caption = prompt('Caption for this target (optional)') ?? null;
                  void handleSaveTarget(draftedTarget, caption, prose);
                }}
                disabled={savingTarget}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >{savingTarget ? 'Saving…' : 'Save target'}</button>
            </div>
          </header>
          <div className="space-y-3">
            {draftedTarget.competencies.map((c, i) => (
              <div key={i} className="rounded-md border bg-muted/20 px-3 py-2 space-y-2">
                <div className="flex items-start gap-2">
                  <span className={'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ' + (c.type === 'foundational' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')}>{c.type}</span>
                  <textarea
                    value={c.statement}
                    onChange={e => updateDraftedStatement(i, e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => removeDraftedCompetency(i)}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >remove</button>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <DepthSlider label="Know" value={c.target_depth.k} disabled={c.type === 'foundational'} onChange={v => updateDraftedDepth(i, 'k', v)} />
                  <DepthSlider label="Understand" value={c.target_depth.u} disabled={c.type === 'foundational'} onChange={v => updateDraftedDepth(i, 'u', v)} />
                  <DepthSlider label="Do" value={c.target_depth.d ?? 0} onChange={v => updateDraftedDepth(i, 'd', v ?? 0)} />
                </div>
                <p className="text-[11px] italic text-muted-foreground">{c.rationale}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* DOWNSTREAM picker */}
      {mode === 'downstream' && (
        <section className="rounded-md border bg-card px-4 py-4 space-y-3">
          <header>
            <h3 className="text-sm font-semibold">Downstream courses</h3>
            <p className="text-xs text-muted-foreground">
              Courses that list <span className="font-mono">{courseCode}</span> as a prereq. Select the ones to build a target from; only courses with captured snapshots can be used.
            </p>
          </header>
          {loadingDownstream ? (
            <p className="text-xs italic text-muted-foreground">Loading candidates…</p>
          ) : downstreamCandidates.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No courses found that list this course as a prereq.</p>
          ) : (
            <ul className="space-y-1">
              {downstreamCandidates.map(c => (
                <li key={c.code} className="flex items-center justify-between gap-3 rounded border bg-muted/10 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={!c.hasIncomingExpectations}
                      checked={downstreamSelected.has(c.code)}
                      onChange={e => {
                        const next = new Set(downstreamSelected);
                        if (e.target.checked) next.add(c.code); else next.delete(c.code);
                        setDownstreamSelected(next);
                      }}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-sm font-medium">{c.code}</span>
                    <span className="text-xs text-muted-foreground">— {c.title}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {c.hasSnapshot
                      ? c.hasIncomingExpectations
                        ? `snapshot ${c.snapshotCaption ?? 'available'}`
                        : 'snapshot lacks incoming_expectations — re-capture'
                      : 'no snapshot yet'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleBuildDownstream}
              disabled={downstreamSelected.size === 0 || buildingDownstream}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {buildingDownstream ? 'Building…' : `Build target from ${downstreamSelected.size} course${downstreamSelected.size === 1 ? '' : 's'}`}
            </button>
          </div>
          {authorError && <p className="text-xs text-destructive">{authorError}</p>}
        </section>
      )}

      {/* Analysis result */}
      {analysisError && (
        <p className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">{analysisError}</p>
      )}

      {analysisView && selectedTargetId && (
        <>
          <AnalysisResult analysis={analysisView} />
          <WhatIfPanel
            courseCode={courseCode}
            slug={slug}
            snapshotId={snapshotId}
            targetId={selectedTargetId}
            analysisId={analyses.find(a => a.targetId === selectedTargetId && a.snapshotId === snapshotId)?.id ?? null}
          />
        </>
      )}

      {/* Past analyses */}
      {analyses.length > 0 && !analysisView && (
        <section className="rounded-md border bg-card px-4 py-3">
          <h3 className="text-sm font-semibold mb-1">Past analyses ({analyses.length})</h3>
          <p className="text-xs text-muted-foreground">Each analysis is preserved with its snapshot + target stamp. Pick a saved target above and click &ldquo;Run analysis&rdquo; for a fresh run.</p>
          <ul className="mt-2 space-y-1 text-xs">
            {analyses.slice(0, 10).map(a => (
              <li key={a.id} className="border-l-2 border-muted pl-2 text-muted-foreground">
                {formatDate(a.createdAt)} · {a.recommendationCount} recommendation{a.recommendationCount === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DepthSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xs italic text-muted-foreground">(not scored)</p>
      </div>
    );
  }
  if (value === null) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <button type="button" onClick={() => onChange(0)} className="text-xs text-muted-foreground hover:text-foreground">+ score</button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-mono text-xs">{value}</p>
      </div>
      <input
        type="range"
        min={0}
        max={5}
        step={1}
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="w-full"
      />
    </div>
  );
}

function AnalysisResult({ analysis }: { analysis: ExploreAnalysis }) {
  const statusCounts = {
    covered: analysis.alignment.filter(a => a.status === 'covered').length,
    partial: analysis.alignment.filter(a => a.status === 'partial').length,
    underdeveloped: analysis.alignment.filter(a => a.status === 'underdeveloped').length,
    missing: analysis.alignment.filter(a => a.status === 'missing').length,
  };
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
        <h2 className="text-sm font-semibold">Analysis</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>✓ {statusCounts.covered}</span>
          <span>◐ {statusCounts.partial}</span>
          <span>↓ {statusCounts.underdeveloped}</span>
          <span>✕ {statusCounts.missing}</span>
        </div>
      </header>

      {/* Recommendations */}
      {analysis.recommendations.length > 0 && (
        <div className="rounded-md border bg-card px-4 py-3 space-y-3">
          <h3 className="text-sm font-semibold">Top recommendations</h3>
          {analysis.recommendations.slice().sort((a, b) => a.priority - b.priority).map((r, i) => (
            <RecommendationCard key={i} rec={r} />
          ))}
        </div>
      )}

      {/* Alignment table */}
      <div className="rounded-md border bg-card">
        <header className="border-b px-4 py-2">
          <h3 className="text-sm font-semibold">Alignment per target item</h3>
        </header>
        <ul className="divide-y">
          {analysis.alignment.map((row, i) => (
            <AlignmentRowView key={i} row={row} />
          ))}
        </ul>
      </div>

      {/* Audit notes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <AuditList title="Gaps addressed" items={analysis.audit_notes.gaps_addressed_by_recommendations} />
        <AuditList title="Gaps not addressed" items={analysis.audit_notes.gaps_not_addressed} />
        <AuditList title="Strengths vs target" items={analysis.audit_notes.strengths_relative_to_target} />
      </div>
    </section>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">#{rec.priority}</span>
        <p className="text-sm font-medium">{rec.change}</p>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">→ {rec.impact}</p>
      {rec.would_affect.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Affects {rec.would_affect.length} competenc{rec.would_affect.length === 1 ? 'y' : 'ies'}</summary>
          <ul className="mt-1 space-y-1 pl-3 text-muted-foreground">
            {rec.would_affect.map((w, i) => (
              <li key={i} className="border-l-2 border-muted pl-2">
                <span className="font-medium">{w.competency}</span>
                <span className="ml-2 font-mono text-[10px]">
                  {w.from_depth.k ?? '—'}/{w.from_depth.u ?? '—'}/{w.from_depth.d} → {w.to_depth.k ?? '—'}/{w.to_depth.u ?? '—'}/{w.to_depth.d}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AlignmentRowView({ row }: { row: AlignmentRow }) {
  return (
    <li className="px-4 py-2 space-y-1">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-snug flex-1">{row.target_statement}</p>
        <StatusChip status={row.status} />
      </div>
      <div className="flex items-center gap-4">
        <DepthMini depth={row.target_depth} label="Target" />
        {row.snapshot_depth && <DepthMini depth={row.snapshot_depth} label="Snapshot" />}
      </div>
      {row.matched_snapshot_competency && (
        <p className="text-[11px] text-muted-foreground italic">matched: {row.matched_snapshot_competency}</p>
      )}
      <p className="text-xs text-muted-foreground">{row.delta_notes}</p>
    </li>
  );
}

function AuditList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-xs italic text-muted-foreground">(none)</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs leading-snug">
          {items.map((it, i) => (
            <li key={i} className="border-l-2 border-muted pl-2">{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WhatIfPanel({
  courseCode,
  slug,
  snapshotId,
  targetId,
  analysisId,
}: {
  courseCode: string;
  slug: string;
  snapshotId: string;
  targetId: string;
  analysisId: string | null;
}) {
  const [prose, setProse] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; changeProse: string; result: WhatIfResult; createdAt: string }>>([]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/what-if?slug=${encodeURIComponent(slug)}&targetId=${encodeURIComponent(targetId)}`);
      if (!res.ok) return;
      const json = await res.json() as { whatIfs: Array<{ id: string; changeProse: string; result: WhatIfResult; createdAt: string }> };
      setHistory(json.whatIfs);
    } catch {}
  }, [courseCode, slug, targetId]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function handleSimulate() {
    if (!prose.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/what-if?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId, targetId, changeProse: prose, analysisId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError((json as { error?: string; detail?: string }).error ?? 'simulation failed');
        return;
      }
      const { whatIf } = json as { whatIf: { id: string; changeProse: string; result: WhatIfResult; createdAt: string } };
      setResult(whatIf.result);
      setHistory(prev => [whatIf, ...prev]);
      setProse('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'simulation failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-md border bg-amber-50/40 px-4 py-4 space-y-3 shadow-sm">
      <header>
        <h3 className="text-sm font-semibold">What-if scenarios</h3>
        <p className="text-xs text-muted-foreground">
          Propose a change in plain language. The system predicts which competencies would shift and whether the alignment improves. Doesn&apos;t modify the snapshot — pure simulation.
        </p>
      </header>
      <textarea
        value={prose}
        onChange={e => setProse(e.target.value)}
        rows={3}
        placeholder='e.g., "Add a 25-point oral defense to the Brand Color Report rubric scored on rationale articulation."'
        className="w-full resize-y rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleSimulate}
          disabled={!prose.trim() || running}
          className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
        >
          {running ? 'Simulating…' : 'Simulate change'}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && <WhatIfResultView result={result} />}

      {history.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Past what-ifs for this target ({history.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {history.map(h => (
              <li key={h.id} className="rounded border bg-card px-2 py-1.5">
                <p className="font-medium leading-snug">{h.changeProse}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {h.result.worth_doing.replace('_', ' ')} · {new Date(h.createdAt).toLocaleDateString()}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground italic">{h.result.verdict}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function WhatIfResultView({ result }: { result: WhatIfResult }) {
  const worthCfg = {
    high_value: { color: 'bg-green-100 text-green-800', label: 'high value' },
    modest_value: { color: 'bg-amber-100 text-amber-800', label: 'modest value' },
    low_value: { color: 'bg-slate-100 text-slate-700', label: 'low value' },
    counterproductive: { color: 'bg-red-100 text-red-800', label: 'counterproductive' },
  } as const;
  const w = worthCfg[result.worth_doing];
  return (
    <div className="rounded-md border bg-card px-3 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${w.color}`}>{w.label}</span>
        <p className="text-sm font-medium flex-1">{result.verdict}</p>
      </div>

      {result.competency_changes.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Competency depths</h4>
          <ul className="mt-1 space-y-1 text-xs">
            {result.competency_changes.map((c, i) => (
              <li key={i} className="border-l-2 border-muted pl-2">
                <span className="font-medium">{c.competency}</span>
                <span className="ml-2 font-mono text-[10px]">
                  {c.from_depth.k ?? '—'}/{c.from_depth.u ?? '—'}/{c.from_depth.d} → {c.to_depth.k ?? '—'}/{c.to_depth.u ?? '—'}/{c.to_depth.d}
                </span>
                <p className="text-muted-foreground">{c.rationale}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.alignment_deltas.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Alignment shifts</h4>
          <ul className="mt-1 space-y-1 text-xs">
            {result.alignment_deltas.map((d, i) => (
              <li key={i} className="border-l-2 border-muted pl-2">
                <span className="font-medium">{d.target_statement}</span>
                <span className="ml-2 text-[10px] font-mono">
                  {d.before_status} → {d.after_status}
                </span>
                <p className="text-muted-foreground">{d.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.caveats.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Caveats</h4>
          <ul className="mt-1 space-y-1 text-xs">
            {result.caveats.map((c, i) => (
              <li key={i} className="border-l-2 border-amber-300 pl-2 text-muted-foreground">{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
