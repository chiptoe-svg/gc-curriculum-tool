'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrototypeForm, type AnalyzeInput } from '@/components/PrototypeForm';
import { TargetChainForm, type TargetChainAnalyzeInput, type CourseChoice, type TargetOption as TargetChainTargetOption } from '@/components/TargetChainForm';
import { TargetChainResults } from '@/components/TargetChainResults';
import type { AnalysisTab } from '@/components/TabSwitcher';
import { KUDCard } from '@/components/KUDCard';
import { CoverageHeatMap } from '@/components/CoverageHeatMap';
import { PrerequisiteGapPanel } from '@/components/PrerequisiteGapPanel';
import { Separator } from '@/components/ui/separator';
import type { AnalysisResult, TargetChainAnalysisResult, CareerTarget, AnalysisFrame } from '@/lib/domain/types';

export function PrototypeClient({ slug }: { slug: string }) {
  const search = useSearchParams();
  const tab: AnalysisTab = search?.get('tab') === 'target' ? 'target' : 'prereqs';

  const [analyzing, setAnalyzing] = useState(false);
  const [prereqResult, setPrereqResult] = useState<AnalysisResult | null>(null);
  const [chainResult, setChainResult] = useState<TargetChainAnalysisResult | null>(null);
  // Separate run IDs per tab — both results stay mounted when switching tabs,
  // so a shared runId would let a flag from one tab attach to the other's run.
  const [prereqRunId, setPrereqRunId] = useState<string | null>(null);
  const [chainRunId, setChainRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetsList, setTargetsList] = useState<CareerTarget[]>([]);
  const [courses, setCourses] = useState<CourseChoice[]>([]);

  useEffect(() => {
    fetch('/api/targets').then(r => r.json()).then((data: CareerTarget[]) => setTargetsList(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'target') return;
    // Load all courses for the checkbox list. The /api/courses endpoints are
    // slug-gated, so the preview slug must ride along on every request.
    const slugQuery = `slug=${encodeURIComponent(slug)}`;
    fetch(`/api/courses?${slugQuery}`).then(r => r.json()).then(async (codes: Array<{ code: string; title: string; level: number; track: string }>) => {
      // For checkbox list we need the syllabus text too — fetch each course's record. To avoid 28 sequential fetches at page-load, we batch in parallel:
      const detailed = await Promise.all(codes.map(async (c) => {
        const r = await fetch(`/api/courses/${encodeURIComponent(c.code)}?${slugQuery}`);
        if (!r.ok) return null;
        const j = await r.json();
        return {
          code: c.code,
          title: c.title,
          level: c.level,
          track: c.track,
          syllabusText: formatSyllabusFromApi(j),
        } as CourseChoice;
      }));
      setCourses(detailed.filter((c): c is CourseChoice => c !== null));
    }).catch(() => {});
  }, [tab]);

  const targetsMap = new Map(targetsList.map(t => [t.id, t]));

  async function handlePrereqAnalyze(input: AnalyzeInput) {
    setAnalyzing(true); setError(null); setPrereqResult(null);
    try {
      const resp = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!resp.ok) throw new Error(`Analysis failed: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      const body = (await resp.json()) as AnalysisResult & { runId?: string };
      setPrereqResult(body);
      if (body.runId) setPrereqRunId(body.runId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleChainAnalyze(input: TargetChainAnalyzeInput) {
    setAnalyzing(true); setError(null); setChainResult(null);
    try {
      const resp = await fetch('/api/analyze/target-chain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!resp.ok) throw new Error(`Analysis failed: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      const body = (await resp.json()) as TargetChainAnalysisResult & { runId?: string };
      setChainResult(body);
      if (body.runId) setChainRunId(body.runId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFlag(target: string, note: string, flagType: string) {
    const runId = flagType.startsWith('target_chain_') ? chainRunId : prereqRunId;
    if (!runId) return;
    await fetch('/api/flag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, flagType, target, note }) });
  }

  const prereqFrame: AnalysisFrame | null = prereqResult
    ? {
        name: `Entry requirements for ${prereqResult.course.courseLabel}`,
        subCompetencies: prereqResult.prereqCompetencies.map(p => ({ id: p.id, name: p.name })),
      }
    : null;
  const chainTarget = chainResult ? targetsMap.get(chainResult.careerTargetId) ?? null : null;

  const targetCount = targetsList.length || 5;
  const simpleTargetOptions: TargetChainTargetOption[] = targetsList.map(t => ({ id: t.id, name: t.name }));
  const targetForPreview: CareerTarget | null = (() => {
    if (tab !== 'target') return null;
    const id = chainResult?.careerTargetId ?? simpleTargetOptions[0]?.id;
    return id ? targetsMap.get(id) ?? null : null;
  })();

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-12 space-y-10">
      <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground flex items-center justify-between gap-4">
        <span>Re-sync courses from the Google Sheet &middot; Edit career target definitions.</span>
        <a href={`/preview/${slug}/targets`} className="text-foreground underline underline-offset-2 font-medium whitespace-nowrap">
          Open admin →
        </a>
      </div>

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Clemson GC — Curriculum Tool Prototype</p>
        <h1 className="text-4xl font-semibold leading-tight">A working preview of how the curriculum tool will analyze courses.</h1>

        {/* Three-tool overview */}
        <div className="grid sm:grid-cols-3 gap-4 pt-2">
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Tool 1</span>
            <p className="text-sm font-semibold">Course Builder</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Upload materials, edit learning objectives and projects, generate and accept Know / Understand / Do outcomes for a course. Approved courses unlock the analysis tools.</p>
            <a
              href={`/preview/${slug}/courses`}
              className="inline-block text-xs underline underline-offset-2 text-foreground hover:text-muted-foreground pt-1"
            >
              Open Course Builder →
            </a>
          </div>

          <div className={`rounded-lg border p-4 space-y-1.5 ${tab === 'prereqs' ? 'border-foreground bg-muted/60' : 'border-border bg-muted/30'}`}>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Tool 2</span>
            <p className="text-sm font-semibold">Prereq Analyzer</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Given a focal course and its prior coursework, score how well the prereqs collectively cover each entry requirement the focal course expects — with cited reasoning.</p>
            <a href="?tab=prereqs" className="inline-block text-xs underline underline-offset-2 text-foreground hover:text-muted-foreground pt-1">
              {tab === 'prereqs' ? 'Active below ↓' : 'Open this tool ↓'}
            </a>
          </div>

          <div className={`rounded-lg border p-4 space-y-1.5 ${tab === 'target' ? 'border-foreground bg-muted/60' : 'border-border bg-muted/30'}`}>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Tool 3</span>
            <p className="text-sm font-semibold">Career Target Alignment</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Evaluate how a chain of courses builds toward one of five career targets — Account Management, Brand Strategy, Production &amp; Ops, Creative Generalist, or AI Workflow — using KUD coverage scoring.</p>
            <a href="?tab=target" className="inline-block text-xs underline underline-offset-2 text-foreground hover:text-muted-foreground pt-1">
              {tab === 'target' ? 'Active below ↓' : 'Open this tool ↓'}
            </a>
          </div>
        </div>
      </header>

      {tab === 'target' && (
        <TargetChainForm
          slug={slug}
          targets={simpleTargetOptions}
          courses={courses}
          fullTarget={targetForPreview}
          onAnalyze={handleChainAnalyze}
          isAnalyzing={analyzing}
        />
      )}

      {tab === 'prereqs' && (
        <PrototypeForm slug={slug} onAnalyze={handlePrereqAnalyze} isAnalyzing={analyzing} />
      )}

      {error && (
        <div className="rounded border border-destructive bg-destructive/5 text-destructive p-4 text-sm">{error}</div>
      )}

      {tab === 'target' && chainResult && chainTarget && (
        <TargetChainResults
          target={chainTarget}
          result={chainResult}
          onFlag={(t, n, ft) => handleFlag(t, n, ft)}
        />
      )}

      {tab === 'prereqs' && prereqResult && prereqFrame && (
        <section className="space-y-8">
          <Separator />
          <div className="space-y-4">
            <h3 className="text-base font-medium">Course being analyzed — Know / Understand / Do outcomes</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <KUDCard courseLabel={prereqResult.course.courseLabel} kud={prereqResult.course.kud} />
            </div>
          </div>
          <div className="space-y-4">
            <h3 className="text-base font-medium text-muted-foreground">Prior coursework — Know / Understand / Do outcomes</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {prereqResult.priorCoursework.map((c, i) => (
                <KUDCard key={i} courseLabel={c.courseLabel} kud={c.kud} />
              ))}
            </div>
          </div>
          <CoverageHeatMap
            target={prereqFrame}
            courseLabel={prereqResult.course.courseLabel}
            priorCoursework={prereqResult.priorCoursework.map(c => ({ courseLabel: c.courseLabel, coverage: c.coverage }))}
            scaffolding={prereqResult.scaffolding}
            onFlag={(t, n) => handleFlag(t, n, 'coverage')}
          />
          <PrerequisiteGapPanel
            target={prereqFrame}
            courseLabel={prereqResult.course.courseLabel}
            gaps={prereqResult.course.prerequisiteGaps}
            onFlag={(t, n) => handleFlag(t, n, 'prerequisite_gap')}
          />
          <footer className="text-xs text-muted-foreground pt-6 border-t">
            Analysis run with {prereqResult.meta.aiProvider} ({prereqResult.meta.aiModel}) in {(prereqResult.meta.durationMs / 1000).toFixed(1)}s. Cost ≈ ${(prereqResult.meta.costUsdCents / 10000).toFixed(2)}.{' '}
            {prereqResult.priorCoursework.length} prior course{prereqResult.priorCoursework.length !== 1 ? 's' : ''}.{' '}
            {(prereqResult.meta.cachedTokens + prereqResult.meta.uncachedTokens) > 0 && (
              <>Cache hit: {((prereqResult.meta.cachedTokens / (prereqResult.meta.cachedTokens + prereqResult.meta.uncachedTokens)) * 100).toFixed(0)}%.</>
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

// Format a course-record API response into the labeled-markdown syllabus the
// /api/analyze endpoints accept. Mirrors what lib/courses/formatCourseSyllabus
// already does for prereq form usage.
function formatSyllabusFromApi(r: {
  description: string | null;
  prerequisites: string | null;
  learningObjectives: string[] | null;
  majorProjects: string[] | null;
  skillsRequired: string[] | null;
}): string {
  const parts: string[] = [];
  if (r.description) parts.push(`Description:\n${r.description}`);
  if (r.prerequisites) parts.push(`Prerequisites:\n${r.prerequisites}`);
  if (r.learningObjectives && r.learningObjectives.length > 0) parts.push(`Learning objectives:\n${r.learningObjectives.map(o => `- ${o}`).join('\n')}`);
  if (r.majorProjects && r.majorProjects.length > 0) parts.push(`Major projects:\n${r.majorProjects.map(p => `- ${p}`).join('\n')}`);
  if (r.skillsRequired && r.skillsRequired.length > 0) parts.push(`Skills:\n${r.skillsRequired.map(s => `- ${s}`).join('\n')}`);
  return parts.join('\n\n');
}
