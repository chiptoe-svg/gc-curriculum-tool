'use client';

import { useEffect, useState } from 'react';
import { PrototypeForm, type AnalyzeInput } from '@/components/PrototypeForm';
import { KUDCard } from '@/components/KUDCard';
import { CoverageHeatMap } from '@/components/CoverageHeatMap';
import { PrerequisiteGapPanel } from '@/components/PrerequisiteGapPanel';
import { Separator } from '@/components/ui/separator';
import type { AnalysisResult, CareerTarget } from '@/lib/domain/types';

export function PrototypeClient({ slug }: { slug: string }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetsMap, setTargetsMap] = useState<Map<string, CareerTarget>>(new Map());

  useEffect(() => {
    fetch('/api/targets')
      .then((r) => r.json())
      .then((data: CareerTarget[]) => {
        setTargetsMap(new Map(data.map((t) => [t.id, t])));
      })
      .catch(() => {
        // Silently fail — UI degrades gracefully (no target name shown)
      });
  }, []);

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

  const target = result ? (targetsMap.get(result.careerTargetId) ?? null) : null;

  const targetCount = targetsMap.size || 5; // fallback to 5 while loading

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-12 space-y-10">
      {/* Admin tools banner */}
      <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground flex items-center justify-between gap-4">
        <span>Re-sync courses from the Google Sheet &middot; Edit career target definitions.</span>
        <a
          href={`/preview/${slug}/targets`}
          className="text-foreground underline underline-offset-2 font-medium whitespace-nowrap"
        >
          Open admin &rarr;
        </a>
      </div>

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Clemson GC — Curriculum Tool Prototype</p>
        <h1 className="text-4xl font-semibold leading-tight">A working preview of how the curriculum tool will analyze courses.</h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          The full tool will be a living record of the GC curriculum — courses, career targets, and the AI analysis that maps how well one builds toward the other. This prototype lets you test the analysis on a course and its prior coursework. Paste the syllabus of the course you want to analyze, add the syllabi of any prerequisite or prior courses students are expected to have taken, pick a career target, and the AI will draft course-level Know / Understand / Do outcomes, score coverage against the target&apos;s sub-competencies, and identify whether the course&apos;s prerequisites are actually met by the prior coursework.
        </p>
        <p className="text-sm text-muted-foreground">
          Every AI score includes the reasoning behind it — click it open. If the reasoning is wrong, flag it with a note. Flags get used to tune the prompts before the full tool ships.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-medium mb-3">How to use</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed">
          <li>Paste the syllabus of the <strong>course you want to analyze</strong> at the top, with a label like &ldquo;GC 4060.&rdquo;</li>
          <li>In <strong>Prior coursework</strong>, paste each prior or expected prior course&apos;s syllabus — formal prerequisites or courses students are expected to have taken before this one. Add as many as needed. Order doesn&apos;t matter.</li>
          <li>Pick the career target you want to evaluate alignment against ({targetCount} options).</li>
          <li>Click <strong>Analyze</strong>. The analysis takes ~30 seconds.</li>
          <li>Review the drafted KUD outcomes, the coverage heat map, and the prerequisite gap analysis. Click any reasoning to read it and flag if wrong.</li>
        </ol>
      </section>

      <PrototypeForm slug={slug} onAnalyze={handleAnalyze} isAnalyzing={analyzing} />

      {error && (
        <div className="rounded border border-destructive bg-destructive/5 text-destructive p-4 text-sm">
          {error}
        </div>
      )}

      {result && target && (
        <section className="space-y-8">
          <Separator />

          {/* Course KUD card FIRST — visually distinguished */}
          <div className="space-y-4">
            <h3 className="text-base font-medium">Course being analyzed — Know / Understand / Do outcomes</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <KUDCard courseLabel={result.course.courseLabel} kud={result.course.kud} />
            </div>
          </div>

          {/* Prior coursework KUD cards BELOW — peers, no hierarchy among them */}
          <div className="space-y-4">
            <h3 className="text-base font-medium text-muted-foreground">Prior coursework — Know / Understand / Do outcomes</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {result.priorCoursework.map((c, i) => (
                <KUDCard key={i} courseLabel={c.courseLabel} kud={c.kud} />
              ))}
            </div>
          </div>

          <CoverageHeatMap
            target={target}
            courseLabel={result.course.courseLabel}
            courseScores={result.course.coverage}
            priorCoursework={result.priorCoursework.map(c => ({ courseLabel: c.courseLabel, coverage: c.coverage }))}
            scaffolding={result.scaffolding}
            onFlag={(t, n) => handleFlag(t, n, 'coverage')}
          />
          <PrerequisiteGapPanel
            target={target}
            courseLabel={result.course.courseLabel}
            gaps={result.course.prerequisiteGaps}
            onFlag={(t, n) => handleFlag(t, n, 'prerequisite_gap')}
          />
          <footer className="text-xs text-muted-foreground pt-6 border-t">
            Analysis run with {result.meta.aiProvider} ({result.meta.aiModel}) in {(result.meta.durationMs / 1000).toFixed(1)}s. Cost ≈ ${(result.meta.costUsdCents / 10000).toFixed(2)}.{' '}
            {result.priorCoursework.length} prior course{result.priorCoursework.length !== 1 ? 's' : ''}.{' '}
            {(result.meta.cachedTokens + result.meta.uncachedTokens) > 0 && (
              <>Cache hit: {((result.meta.cachedTokens / (result.meta.cachedTokens + result.meta.uncachedTokens)) * 100).toFixed(0)}%.</>
            )}
          </footer>
        </section>
      )}

      <footer className="pt-12 border-t text-sm text-muted-foreground">
        This is a prototype — see the <a className="underline" href="https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/vision/gc-curriculum-tool-vision.html" target="_blank" rel="noopener noreferrer">vision for the full tool</a>.
      </footer>
    </main>
  );
}
