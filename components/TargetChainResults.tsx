'use client';

import { KUDCard } from './KUDCard';
import { CoverageHeatMap } from './CoverageHeatMap';
import { Separator } from './ui/separator';
import type { CareerTarget, TargetChainAnalysisResult } from '@/lib/domain/types';

interface Props {
  target: CareerTarget;
  result: TargetChainAnalysisResult;
  onFlag: (target: string, note: string, flagType: 'target_chain_coverage' | 'target_chain_scaffolding') => Promise<void>;
}

export function TargetChainResults({ target, result, onFlag }: Props) {
  const first = result.courses[0];
  const rest = result.courses.slice(1);
  if (!first) return null;

  return (
    <section className="space-y-8">
      <Separator />

      <div className="space-y-4">
        <h3 className="text-base font-medium">Course Know / Understand / Do outcomes</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {result.courses.map((c) => (
            <KUDCard key={c.courseLabel} courseLabel={c.courseLabel} kud={c.kud} />
          ))}
        </div>
      </div>

      <CoverageHeatMap
        target={target}
        courseLabel={first.courseLabel}
        courseScores={first.coverage}
        priorCoursework={rest.map(c => ({ courseLabel: c.courseLabel, coverage: c.coverage }))}
        scaffolding={result.scaffolding}
        onFlag={(t, n) => onFlag(t, n, 'target_chain_coverage')}
        mode="chain"
      />

      <footer className="text-xs text-muted-foreground pt-6 border-t">
        Analysis run with {result.meta.aiProvider} ({result.meta.aiModel}) in {(result.meta.durationMs / 1000).toFixed(1)}s. Cost ≈ ${(result.meta.costUsdCents / 10000).toFixed(2)}. {result.courses.length} courses in chain.
        {(result.meta.cachedTokens + result.meta.uncachedTokens) > 0 && (
          <> Cache hit: {((result.meta.cachedTokens / (result.meta.cachedTokens + result.meta.uncachedTokens)) * 100).toFixed(0)}%.</>
        )}
      </footer>
    </section>
  );
}
