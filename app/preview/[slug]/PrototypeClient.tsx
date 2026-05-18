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
  const [labels, setLabels] = useState<{ up: string; down: string }>({ up: 'Upstream', down: 'Downstream' });
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(input: AnalyzeInput) {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setLabels({ up: input.upstream.courseLabel || 'Upstream', down: input.downstream.courseLabel || 'Downstream' });
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
          The full tool will be a living record of the GC curriculum — courses, career targets, and the AI analysis that maps how well one builds toward the other. This prototype lets you test the analysis on any two courses you choose. Paste the syllabus of an earlier course and a later course in the sequence, pick a career target, and the AI will draft course-level Know / Understand / Do outcomes, score coverage against the target&apos;s sub-competencies, and identify whether the later course&apos;s prerequisites are actually met by the earlier one.
        </p>
        <p className="text-sm text-muted-foreground">
          Every AI score includes the reasoning behind it — click it open. If the reasoning is wrong, flag it with a note. Flags get used to tune the prompts before the full tool ships.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-medium mb-3">How to use</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed">
          <li>Paste an <strong>upstream</strong> course&apos;s syllabus (or click a sample button to load an example).</li>
          <li>Paste a <strong>downstream</strong> course&apos;s syllabus.</li>
          <li>Pick the career target you want to evaluate alignment against ({CAREER_TARGETS.length} options).</li>
          <li>Click <strong>Analyze</strong>. The analysis takes 30–60 seconds. Six AI calls run sequentially.</li>
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
          <div className="grid md:grid-cols-2 gap-4">
            <KUDCard courseLabel={labels.up} kud={result.upstream.kud} />
            <KUDCard courseLabel={labels.down} kud={result.downstream.kud} />
          </div>
          <CoverageHeatMap
            target={target}
            upstreamLabel={labels.up}
            upstreamScores={result.upstream.coverage}
            downstreamLabel={labels.down}
            downstreamScores={result.downstream.coverage}
            onFlag={(t, n) => handleFlag(t, n, 'coverage')}
          />
          <PrerequisiteGapPanel
            target={target}
            gaps={result.downstream.prerequisiteGaps}
            onFlag={(t, n) => handleFlag(t, n, 'prerequisite_gap')}
          />
          <footer className="text-xs text-muted-foreground pt-6 border-t">
            Analysis run with {result.meta.aiProvider} ({result.meta.aiModel}) in {(result.meta.durationMs / 1000).toFixed(1)}s. Cost ≈ ${(result.meta.costUsdCents / 10000).toFixed(2)}.
          </footer>
        </section>
      )}

      <footer className="pt-12 border-t text-sm text-muted-foreground">
        This is a prototype. The full tool ships in ~3 months. Feedback: <a className="underline" href="mailto:chiptoe@mac.com">chiptoe@mac.com</a>.
      </footer>
    </main>
  );
}
