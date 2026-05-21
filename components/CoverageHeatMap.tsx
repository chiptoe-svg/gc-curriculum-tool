'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReasoningExpand } from './ReasoningExpand';
import { ConfidenceBars } from './ConfidenceBars';
import type { AnalysisFrame, CoverageScore, KUDLevel, ScaffoldingScore, ScaffoldingQuality } from '@/lib/domain/types';

// Cell-level heat gradient: green (strong) → yellow → orange → red (absent).
// Red cells in foundational courses are often intentional — the course isn't
// supposed to teach that competency yet. Red surfaces "where the coverage
// isn't" without claiming every red cell is a problem.
const LEVEL_BG: Record<KUDLevel, string> = {
  do: 'bg-emerald-700 text-white',
  understand: 'bg-yellow-500 text-black',
  know: 'bg-orange-500 text-white',
  not_addressed: 'bg-red-700 text-white',
};

const LEVEL_LABEL: Record<KUDLevel, string> = {
  do: 'Do',
  understand: 'Understand',
  know: 'Know',
  not_addressed: 'Not addressed',
};

// Column-header (per-sub-competency) gradient. Distinct from cell colors so
// the header summary doesn't blend into the cell colors below it. Slightly
// muted shades so headers read as "summary" rather than "another data row".
const SCAFFOLDING_BG: Record<ScaffoldingQuality, string> = {
  strong: 'bg-emerald-600 text-white',
  adequate: 'bg-lime-400 text-black',
  brittle: 'bg-amber-500 text-black',         // peak Do, no prep — warning
  weak: 'bg-orange-600 text-white',
  absent: 'bg-red-800 text-white',
};

const SCAFFOLDING_LABEL: Record<ScaffoldingQuality, string> = {
  strong: 'Strong',
  adequate: 'Adequate',
  brittle: 'Brittle',
  weak: 'Weak',
  absent: 'Absent',
};

interface Props {
  target: AnalysisFrame;
  courseLabel: string;
  courseScores?: CoverageScore[];
  priorCoursework: Array<{ courseLabel: string; coverage: CoverageScore[] }>;
  scaffolding: ScaffoldingScore[];
  onFlag: (target: string, note: string) => Promise<void>;
  /** 'focal-plus-priors' (default): renders course-being-analyzed as a distinct group above prior coursework.
   *  'chain': all rows render uniformly as peers; no focal/prior labeling. */
  mode?: 'focal-plus-priors' | 'chain';
}

function cumulativeSummary(
  target: AnalysisFrame,
  rows: Array<{ coverage: CoverageScore[] }>
): { do: number; understand: number; know: number; notAddressed: number; total: number } {
  const ORDER: KUDLevel[] = ['not_addressed', 'know', 'understand', 'do'];
  let doCount = 0, understandCount = 0, knowCount = 0, notCount = 0;
  for (const sc of target.subCompetencies) {
    let best: KUDLevel = 'not_addressed';
    for (const row of rows) {
      const c = row.coverage.find(x => x.subCompetencyId === sc.id);
      if (c && ORDER.indexOf(c.kudLevel) > ORDER.indexOf(best)) best = c.kudLevel;
    }
    if (best === 'do') doCount++;
    else if (best === 'understand') understandCount++;
    else if (best === 'know') knowCount++;
    else notCount++;
  }
  return {
    do: doCount,
    understand: understandCount,
    know: knowCount,
    notAddressed: notCount,
    total: target.subCompetencies.length,
  };
}

function ScaffoldingHeaderCell({
  name, score,
}: { name: string; score: ScaffoldingScore | undefined }) {
  const [open, setOpen] = useState(false);
  if (!score) {
    return (
      <th className="text-left p-2 text-xs font-medium align-bottom min-w-[160px]">
        <div className="rounded bg-slate-100 text-slate-700 px-2 py-1.5">{name}</div>
      </th>
    );
  }
  return (
    <th className="text-left p-2 text-xs align-bottom min-w-[160px]">
      <div className={`rounded ${SCAFFOLDING_BG[score.quality]} px-2 py-1.5 space-y-1`}>
        <div className="font-medium leading-snug">{name}</div>
        <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider">
          <span className="font-semibold">{SCAFFOLDING_LABEL[score.quality]}</span>
          <button
            type="button"
            className="underline underline-offset-2 hover:opacity-80"
            onClick={() => setOpen(v => !v)}
          >
            {open ? 'Hide' : 'Why?'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-1 rounded border border-border bg-muted/40 p-2 text-[11px] leading-relaxed font-normal text-foreground">
          {score.reasoning}
        </div>
      )}
    </th>
  );
}

function parseLevel(label: string): number {
  const m = label.match(/GC\s+(\d)/i);
  return m ? parseInt(m[1]!, 10) : 0;
}

export function CoverageHeatMap({ target, courseLabel, courseScores, priorCoursework, scaffolding, onFlag, mode }: Props) {
  const cellFor = (scores: CoverageScore[], subId: string) => scores.find(s => s.subCompetencyId === subId);
  const scaffoldFor = (subId: string) => scaffolding.find(s => s.subCompetencyId === subId);

  const allRows = [
    ...(courseScores ? [{ coverage: courseScores }] : []),
    ...priorCoursework.map(p => ({ coverage: p.coverage })),
  ];
  const s = cumulativeSummary(target, allRows);
  const courseCount = 1 + priorCoursework.length;

  // In chain mode, build a single sorted list of all courses as uniform peers.
  const chainRows: Array<{ label: string; coverage: CoverageScore[]; key: string }> =
    mode === 'chain'
      ? [
          ...(courseScores ? [{ label: courseLabel || 'Course', coverage: courseScores, key: 'focal' }] : []),
          ...priorCoursework.map((p, i) => ({
            label: p.courseLabel || `Prior course ${i + 1}`,
            coverage: p.coverage,
            key: `prior-${i}`,
          })),
        ].sort((a, b) => parseLevel(a.label) - parseLevel(b.label))
      : [];

  // Scaffolding roll-up — how many sub-competencies land at each quality
  const sc = { strong: 0, adequate: 0, brittle: 0, weak: 0, absent: 0 };
  for (const x of scaffolding) sc[x.quality]++;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{target.name}</CardTitle>
        <p className="text-sm text-muted-foreground leading-relaxed pt-2">
          Across the courses below, each entry requirement is reached at{' '}
          <strong className="text-foreground">Do level in {s.do} of {s.total}</strong> sub-competencies
          {s.understand > 0 && <>, <strong className="text-foreground">Understand in {s.understand}</strong></>}
          {s.know > 0 && <>, <strong className="text-foreground">Know in {s.know}</strong></>}
          {s.notAddressed > 0 && <>; <strong className="text-foreground">{s.notAddressed} {s.notAddressed === 1 ? 'is' : 'are'} not addressed</strong></>}.
        </p>
        {scaffolding.length > 0 && (
          <p className="text-sm text-muted-foreground leading-relaxed pt-1">
            Scaffolding quality across these courses:{' '}
            <strong className="text-foreground">{sc.strong} strong</strong>
            {sc.adequate > 0 && <>, <strong className="text-foreground">{sc.adequate} adequate</strong></>}
            {sc.brittle > 0 && <>, <strong className="text-foreground">{sc.brittle} brittle</strong> (peak level reached, but no preparatory coverage)</>}
            {sc.weak > 0 && <>, <strong className="text-foreground">{sc.weak} weak</strong></>}
            {sc.absent > 0 && <>, <strong className="text-foreground">{sc.absent} absent</strong></>}.
            Column headers show the scaffolding judgment per sub-competency — click <em>Why?</em> on any header to see the AI&apos;s reasoning.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left p-2 sticky left-0 bg-background text-sm font-normal text-muted-foreground"> </th>
                {target.subCompetencies.map(sc => (
                  <ScaffoldingHeaderCell key={sc.id} name={sc.name} score={scaffoldFor(sc.id)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {mode === 'chain' ? (
                // Chain mode: all courses as uniform peers, ordered by level, no group headers.
                chainRows.map(({ label, coverage, key }) => (
                  <tr key={key}>
                    <td className="p-2 font-medium text-sm align-top">{label}</td>
                    {target.subCompetencies.map(sc => {
                      const c = cellFor(coverage, sc.id);
                      if (!c) {
                        return <td key={sc.id} className="p-2 align-top"><div className="rounded p-2 bg-slate-200 text-slate-700 text-xs">No data</div></td>;
                      }
                      return (
                        <td key={sc.id} className="p-2 align-top">
                          <div className={`rounded p-2 ${LEVEL_BG[c.kudLevel]}`}>
                            <div className="flex justify-between items-center gap-2">
                              <span className="font-semibold text-xs">{LEVEL_LABEL[c.kudLevel]}</span>
                              <ConfidenceBars level={c.confidence} />
                            </div>
                            <div className="mt-2">
                              <ReasoningExpand
                                reasoning={c.reasoning}
                                flagContext={`${label} • ${sc.name} • ${LEVEL_LABEL[c.kudLevel]}`}
                                onFlag={(note) => onFlag(`${key}.${sc.id}`, note)}
                              />
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                // Default (focal-plus-priors) mode: focal course group above prior coursework group.
                // The focal course row is omitted when courseScores is not provided (course-centric prereq mode).
                <>
                  {courseScores && (
                    <>
                      <tr aria-hidden="true">
                        <td colSpan={target.subCompetencies.length + 1} className="pt-3 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                          Course being analyzed
                        </td>
                      </tr>
                      <tr key="course">
                        <td className="p-2 font-bold text-sm align-top border-l-4 border-slate-900/40">{courseLabel || 'Course'}</td>
                        {target.subCompetencies.map(sc => {
                          const c = cellFor(courseScores, sc.id);
                          if (!c) {
                            return <td key={sc.id} className="p-2 align-top"><div className="rounded p-2 bg-slate-200 text-slate-700 text-xs">No data</div></td>;
                          }
                          return (
                            <td key={sc.id} className="p-2 align-top">
                              <div className={`rounded p-2 ring-2 ring-slate-900/30 ${LEVEL_BG[c.kudLevel]}`}>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="font-semibold text-xs">{LEVEL_LABEL[c.kudLevel]}</span>
                                  <ConfidenceBars level={c.confidence} />
                                </div>
                                <div className="mt-2">
                                  <ReasoningExpand
                                    reasoning={c.reasoning}
                                    flagContext={`${courseLabel} • ${sc.name} • ${LEVEL_LABEL[c.kudLevel]}`}
                                    onFlag={(note) => onFlag(`course.${sc.id}`, note)}
                                  />
                                </div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    </>
                  )}

                  {priorCoursework.length > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={target.subCompetencies.length + 1} className="pt-5 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-medium border-t border-slate-300">
                        Prior coursework
                      </td>
                    </tr>
                  )}

                  {priorCoursework.map(({ courseLabel: priorLabel, coverage }, index) => (
                    <tr key={`prior-${index}`}>
                      <td className="p-2 font-medium text-sm align-top">{priorLabel || `Prior course ${index + 1}`}</td>
                      {target.subCompetencies.map(sc => {
                        const c = cellFor(coverage, sc.id);
                        if (!c) {
                          return <td key={sc.id} className="p-2 align-top"><div className="rounded p-2 bg-slate-200 text-slate-700 text-xs">No data</div></td>;
                        }
                        return (
                          <td key={sc.id} className="p-2 align-top">
                            <div className={`rounded p-2 ${LEVEL_BG[c.kudLevel]}`}>
                              <div className="flex justify-between items-center gap-2">
                                <span className="font-semibold text-xs">{LEVEL_LABEL[c.kudLevel]}</span>
                                <ConfidenceBars level={c.confidence} />
                              </div>
                              <div className="mt-2">
                                <ReasoningExpand
                                  reasoning={c.reasoning}
                                  flagContext={`${priorLabel} • ${sc.name} • ${LEVEL_LABEL[c.kudLevel]}`}
                                  onFlag={(note) => onFlag(`prior-${index}.${sc.id}`, note)}
                                />
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
