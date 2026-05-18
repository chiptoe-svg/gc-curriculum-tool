'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReasoningExpand } from './ReasoningExpand';
import type { CareerTarget, CoverageScore, KUDLevel } from '@/lib/domain/types';

const LEVEL_BG: Record<KUDLevel, string> = {
  do: 'bg-emerald-700 text-white',
  understand: 'bg-yellow-600 text-white',
  know: 'bg-amber-400 text-black',
  not_addressed: 'bg-slate-700 text-slate-200',
};

const LEVEL_LABEL: Record<KUDLevel, string> = {
  do: 'Do',
  understand: 'Understand',
  know: 'Know',
  not_addressed: '—',
};

interface Props {
  target: CareerTarget;
  upstreamLabel: string;
  upstreamScores: CoverageScore[];
  downstreamLabel: string;
  downstreamScores: CoverageScore[];
  onFlag: (target: string, note: string) => Promise<void>;
}

export function CoverageHeatMap({ target, upstreamLabel, upstreamScores, downstreamLabel, downstreamScores, onFlag }: Props) {
  const cellFor = (scores: CoverageScore[], subId: string) => scores.find(s => s.subCompetencyId === subId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coverage of <em>{target.name}</em></CardTitle>
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
              {([
                { label: upstreamLabel || 'Upstream', scores: upstreamScores, side: 'upstream' as const },
                { label: downstreamLabel || 'Downstream', scores: downstreamScores, side: 'downstream' as const },
              ]).map(({ label, scores, side }) => (
                <tr key={side}>
                  <td className="p-2 font-medium text-sm align-top">{label}</td>
                  {target.subCompetencies.map(sc => {
                    const c = cellFor(scores, sc.id);
                    if (!c) {
                      return <td key={sc.id} className="p-2 align-top"><div className="rounded p-2 bg-slate-200 text-slate-700 text-xs">No data</div></td>;
                    }
                    return (
                      <td key={sc.id} className="p-2 align-top">
                        <div className={`rounded p-2 ${LEVEL_BG[c.kudLevel]}`}>
                          <div className="flex justify-between items-baseline gap-2">
                            <span className="font-semibold text-xs">{LEVEL_LABEL[c.kudLevel]}</span>
                            <span className="text-[10px] uppercase tracking-wider opacity-80">{c.confidence}</span>
                          </div>
                          <div className="mt-2">
                            <ReasoningExpand
                              reasoning={c.reasoning}
                              flagContext={`${label} • ${sc.name} • ${LEVEL_LABEL[c.kudLevel]}`}
                              onFlag={(note) => onFlag(`${side}.${sc.id}`, note)}
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
