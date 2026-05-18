'use client';

import { useState } from 'react';
import { PrototypeForm, type AnalyzeInput } from '@/components/PrototypeForm';
import { KUDCard } from '@/components/KUDCard';
import { CoverageHeatMap } from '@/components/CoverageHeatMap';
import { PrerequisiteGapPanel } from '@/components/PrerequisiteGapPanel';
import { Separator } from '@/components/ui/separator';
import { CAREER_TARGETS, getTargetById } from '@/lib/domain/seed-targets';
import type { AnalysisResult } from '@/lib/domain/types';

export function PrototypeClient() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(input: AnalyzeInput) {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Analysis failed: ${resp.status} ${text.slice(0, 200)}`);
      }
      const body = (await resp.json()) as AnalysisResult & { runId?: string };
      setResult(body);
      if (body.runId) setRunId(body.runId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFlag(target: string, note: string, flagType: 'coverage' | 'prerequisite_gap' | 'kud_draft') {
    if (!runId) return;
    await fetch('/api/flag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, flagType, target, note }) });
  }

  const target = result ? getTargetById(result.careerTargetId) : null;

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-12 space-y-10">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Clemson GC — Curriculum Tool Prototype</p>
        <h1 className="text-4xl font-semibold leading-tight">A working preview of how the curriculum tool will analyze courses.</h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          The full tool will be a living record of the GC curriculum — courses, career targets, and the AI analysis that maps how well one builds toward the other. This prototype lets you test the analysis on a full course chain. Paste the syllabi of the upstream courses in sequence order, add a downstream course, pick a career target, and the AI will draft course-level Know / Understand / Do outcomes, score coverage against the target&apos;s sub-competencies, and identify whether the downstream course&apos;s prerequisites are actually met across the chain.
        </p>
        <p className="text-sm text-muted-foreground">
          Every AI score includes the reasoning behind it — click it open. If the reasoning is wrong, flag it with a note. Flags get used to tune the prompts before the full tool ships.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-medium mb-3">How to use</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed">
          <li>Paste each <strong>upstream</strong> course&apos;s syllabus in sequence order (earliest first). Click &ldquo;Add upstream course&rdquo; to add more rows. Up to {8}.</li>
          <li>Paste the <strong>downstream</strong> course&apos;s syllabus.</li>
          <li>Pick the career target you want to evaluate alignment against ({CAREER_TARGETS.length} options).</li>
          <li>Click <strong>Analyze</strong>. The analysis takes 30–90 seconds depending on chain length.</li>
          <li>Review the drafted KUD outcomes, the coverage heat map, and the prerequisite gap analysis. Click any reasoning to read it and flag if wrong.</li>
        </ol>
      </section>

      <PrototypeForm onAnalyze={handleAnalyze} isAnalyzing={analyzing} />

      {error && (
        <div className="rounded border border-destructive bg-destructive/5 text-destructive p-4 text-sm">
          {error}
        </div>
      )}

      {result && target && (
        <section className="space-y-8">
          <Separator />

          {/* KUD cards: upstream chain first, then downstream */}
          <div className="space-y-4">
            <h3 className="text-base font-medium text-muted-foreground">Upstream courses — Know / Understand / Do outcomes</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {result.upstreamChain.map((course, i) => (
                <KUDCard key={i} courseLabel={course.courseLabel} kud={course.kud} />
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-medium">Downstream course — Know / Understand / Do outcomes</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <KUDCard courseLabel={result.downstream.courseLabel} kud={result.downstream.kud} />
            </div>
          </div>

          <CoverageHeatMap
            target={target}
            upstreamChain={result.upstreamChain.map(c => ({ courseLabel: c.courseLabel, coverage: c.coverage }))}
            downstreamLabel={result.downstream.courseLabel}
            downstreamScores={result.downstream.coverage}
            onFlag={(t, n) => handleFlag(t, n, 'coverage')}
          />
          <PrerequisiteGapPanel
            target={target}
            gaps={result.downstream.prerequisiteGaps}
            onFlag={(t, n) => handleFlag(t, n, 'prerequisite_gap')}
          />
          <footer className="text-xs text-muted-foreground pt-6 border-t">
            Analysis run with {result.meta.aiProvider} ({result.meta.aiModel}) in {(result.meta.durationMs / 1000).toFixed(1)}s. Cost ≈ ${(result.meta.costUsdCents / 10000).toFixed(2)}.{' '}
            {result.upstreamChain.length} upstream course{result.upstreamChain.length !== 1 ? 's' : ''} in chain.{' '}
            {(result.meta.cachedTokens + result.meta.uncachedTokens) > 0 && (
              <>Cache hit: {((result.meta.cachedTokens / (result.meta.cachedTokens + result.meta.uncachedTokens)) * 100).toFixed(0)}%.</>
            )}
          </footer>
        </section>
      )}

      <footer className="pt-12 border-t text-sm text-muted-foreground">
        This is a prototype. The full tool ships in ~3 months. Feedback: <a className="underline" href="mailto:chiptoe@mac.com">chiptoe@mac.com</a>.
      </footer>
    </main>
  );
}
