'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReasoningExpand } from './ReasoningExpand';
import { ConfidenceBars } from './ConfidenceBars';
import type { CareerTarget, CoverageScore, KUDLevel } from '@/lib/domain/types';

// True heat gradient: green (strong) → yellow → orange → red (absent).
// Curriculum context note: red cells in foundational courses (GC 1010,
// 1020) are often *intentional* — the course isn't supposed to teach that
// competency yet. Red surfaces "where the coverage isn't" without claiming
// every red cell is a problem.
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

interface Props {
  target: CareerTarget;
  courseLabel: string;
  courseScores: CoverageScore[];
  priorCoursework: Array<{ courseLabel: string; coverage: CoverageScore[] }>;
  onFlag: (target: string, note: string) => Promise<void>;
}

// Highest level any course (analyzed + priors) reaches for each sub-competency.
// Used to summarize cumulative coverage in plain English.
function cumulativeSummary(
  target: CareerTarget,
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

export function CoverageHeatMap({ target, courseLabel, courseScores, priorCoursework, onFlag }: Props) {
  const cellFor = (scores: CoverageScore[], subId: string) => scores.find(s => s.subCompetencyId === subId);

  const allRows = [{ coverage: courseScores }, ...priorCoursework.map(p => ({ coverage: p.coverage }))];
  const s = cumulativeSummary(target, allRows);
  const courseCount = 1 + priorCoursework.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>How well do these {courseCount} courses build toward <em>{target.name}</em>?</CardTitle>
        <p className="text-sm text-muted-foreground leading-relaxed pt-2">
          Across the courses below, this career target is reached at{' '}
          <strong className="text-foreground">Do level in {s.do} of {s.total}</strong> sub-competencies
          {s.understand > 0 && <>, <strong className="text-foreground">Understand in {s.understand}</strong></>}
          {s.know > 0 && <>, <strong className="text-foreground">Know in {s.know}</strong></>}
          {s.notAddressed > 0 && <>; <strong className="text-foreground">{s.notAddressed} {s.notAddressed === 1 ? 'is' : 'are'} not addressed</strong></>}.
          Red cells in foundational courses are often intentional — they're not expected to teach that competency yet.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left p-2 sticky left-0 bg-background text-sm font-normal text-muted-foreground"> </th>
                {target.subCompetencies.map(sc => (
                  <th key={sc.id} className="text-left p-2 text-xs font-medium align-bottom min-w-[140px]">
                    {sc.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Row-group label for the analyzed course */}
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

              {/* Row-group label for prior coursework */}
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
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
