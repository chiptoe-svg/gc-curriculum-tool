import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { insertRun } from '@/lib/db/queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import {
  kudOutcomesSchema, kudOutcomesJsonSchema,
  coverageScoresSchema, coverageScoresJsonSchema,
  prerequisiteClaimsSchema, prerequisiteClaimsJsonSchema,
  prerequisiteGapsSchema, prerequisiteGapsJsonSchema,
} from '@/lib/ai/schemas';
import type { AnalysisResult, CareerTarget, KUDOutcomes, CoverageScore, PrerequisiteCompetencyClaim, PrerequisiteGap, UpstreamCourseAnalysis } from '@/lib/domain/types';

// Vercel Hobby plan caps function duration at 60s by default; with 2N+4
// sequential AI calls (N upstream courses), analyses with N=4 run ~60-90s.
// Without this the function times out before the response is sent.
export const maxDuration = 120;

// Max syllabus length caps the OpenAI cost-per-request. ~20K chars ≈ 5K tokens
// per syllabus; with 2N+4 AI calls per request the upper-bound cost stays well
// under $0.50 even on the worst-case input. Without this cap a 500KB paste
// would consume the full daily budget in a single request.
const MAX_SYLLABUS_LEN = 20000;
const MAX_UPSTREAM_COURSES = 8; // cap chain length to keep cost bounded

const courseInputSchema = z.object({
  courseLabel: z.string().min(1).max(200),
  syllabusText: z.string().min(50).max(MAX_SYLLABUS_LEN),
});

const requestSchema = z.object({
  careerTargetId: z.string().min(1).max(100),
  upstreamChain: z.array(courseInputSchema).min(1).max(MAX_UPSTREAM_COURSES),
  downstream: courseInputSchema,
});

function hashIp(req: Request): string {
  // On Vercel (and most reverse proxies), the trusted client IP is the LAST
  // entry in X-Forwarded-For — the proxy appends it. Taking [0] would let a
  // client spoof the IP via their own forwarded header and bypass rate limits.
  const xff = req.headers.get('x-forwarded-for');
  const parts = xff?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const ip = parts[parts.length - 1] ?? req.headers.get('x-real-ip') ?? 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}

function buildTargetContext(target: CareerTarget | null): string {
  if (!target) return '';
  const lines: string[] = [
    `Career Target: ${target.name}`,
    `Definition: ${target.shortDefinition}`,
    `Defensibility note: ${target.defensibilityNote}`,
    '',
    'Sub-competencies:',
  ];
  for (const sc of target.subCompetencies) {
    lines.push(`- id=${sc.id} :: ${sc.name}`);
    lines.push(`    Know: ${sc.knowDescriptor}`);
    lines.push(`    Understand: ${sc.understandDescriptor}`);
    lines.push(`    Do: ${sc.doDescriptor}`);
  }
  return lines.join('\n');
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { careerTargetId, upstreamChain, downstream } = parsed.data;

  const target = await getTargetById(careerTargetId);
  if (!target) {
    return NextResponse.json({ error: `unknown careerTargetId: ${careerTargetId}` }, { status: 400 });
  }

  // Rate limit + cost cap
  const ipHash = hashIp(req);
  const rl = await checkIpRateLimit(ipHash);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limit exceeded — try again in an hour' }, { status: 429 });
  }
  const cap = await checkDailyCap();
  if (!cap.ok) {
    return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });
  }

  const provider = getProvider();
  const targetContext = buildTargetContext(target);

  const draftPrompt = await loadPrompt('draft-outcomes');
  const scorePrompt = await loadPrompt('score-coverage');
  const prereqPrompt = await loadPrompt('suggest-prerequisites');
  const gapPrompt = await loadPrompt('analyze-prerequisite-gaps');

  let totalCost = 0;
  let totalCached = 0;
  let totalUncached = 0;
  let totalCompletion = 0;
  const started = Date.now();

  // Accumulate telemetry from a completed call result
  function accum(call: { costUsdCents: number; cachedTokens: number; uncachedPromptTokens: number; completionTokens: number }) {
    totalCost += call.costUsdCents;
    totalCached += call.cachedTokens;
    totalUncached += call.uncachedPromptTokens;
    totalCompletion += call.completionTokens;
  }

  // ── Round 1 (parallel): N upstream KUD drafts + 1 downstream KUD draft ──────
  // All share the same system prompt (draftPrompt) and the same career-target
  // context prefix in the user message, enabling prefix-cache hits on calls 2+.
  const round1 = await Promise.all([
    ...upstreamChain.map(course =>
      provider.complete({
        systemPrompt: draftPrompt,
        userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${course.syllabusText}`,
        schemaName: 'kud_outcomes',
        jsonSchema: kudOutcomesJsonSchema,
        validate: (raw) => kudOutcomesSchema.parse(raw),
      })
    ),
    provider.complete({
      systemPrompt: draftPrompt,
      userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${downstream.syllabusText}`,
      schemaName: 'kud_outcomes',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    }),
  ]);

  // N upstream KUD results, then the downstream KUD result
  const upstreamKudCalls = round1.slice(0, upstreamChain.length);
  const downstreamKudCall = round1[upstreamChain.length]!;
  const upstreamKuds: KUDOutcomes[] = upstreamKudCalls.map(c => { accum(c); return c.data; });
  accum(downstreamKudCall);
  const downstreamKud: KUDOutcomes = downstreamKudCall.data;

  // ── Round 2 (parallel): N upstream coverage + 1 downstream coverage + 1 prereq suggestion ──
  // Coverage calls all share scorePrompt and the career-target prefix.
  // The prereq-suggestion call only depends on downstreamKud (from round 1),
  // so it runs in parallel with the coverage calls rather than waiting for them.
  const scoreUserMsg = (courseLabel: string, kud: KUDOutcomes) =>
    `Career target:\n${targetContext}\n\nCourse: ${courseLabel}\n\nCourse description: ${kud.description}\n\nKnow outcomes:\n${kud.know.map(b => `- ${b}`).join('\n')}\n\nUnderstand outcomes:\n${kud.understand.map(b => `- ${b}`).join('\n')}\n\nDo outcomes:\n${kud.do.map(b => `- ${b}`).join('\n')}`;

  const prereqMsg = `Career target:\n${targetContext}\n\nDownstream course outcomes:\nDescription: ${downstreamKud.description}\nKnow: ${downstreamKud.know.join('; ')}\nUnderstand: ${downstreamKud.understand.join('; ')}\nDo: ${downstreamKud.do.join('; ')}`;

  // Fire all coverage calls and the prereq-suggestion call simultaneously.
  // TypeScript can't infer mixed-tuple types from a spread + fixed item in one
  // Promise.all, so we run them as two typed Promise.all calls that themselves
  // run concurrently via a wrapping Promise.all.
  const [coverageCalls, prereqCall] = await Promise.all([
    Promise.all([
      ...upstreamChain.map((course, i) =>
        provider.complete({
          systemPrompt: scorePrompt,
          userMessage: scoreUserMsg(course.courseLabel, upstreamKuds[i]!),
          schemaName: 'coverage_scores',
          jsonSchema: coverageScoresJsonSchema,
          validate: (raw) => coverageScoresSchema.parse((raw as { scores: unknown }).scores),
        })
      ),
      provider.complete({
        systemPrompt: scorePrompt,
        userMessage: scoreUserMsg(downstream.courseLabel, downstreamKud),
        schemaName: 'coverage_scores',
        jsonSchema: coverageScoresJsonSchema,
        validate: (raw) => coverageScoresSchema.parse((raw as { scores: unknown }).scores),
      }),
    ]),
    provider.complete({
      systemPrompt: prereqPrompt,
      userMessage: prereqMsg,
      schemaName: 'prerequisite_claims',
      jsonSchema: prerequisiteClaimsJsonSchema,
      validate: (raw) => prerequisiteClaimsSchema.parse((raw as { claims: unknown }).claims),
    }),
  ] as const);

  // N upstream coverage results + 1 downstream coverage result
  const upstreamCoverageCalls = coverageCalls.slice(0, upstreamChain.length);
  const downstreamCoverageCall = coverageCalls[upstreamChain.length]!;
  const upstreamCoverages: CoverageScore[][] = upstreamCoverageCalls.map(c => { accum(c); return c.data; });
  accum(downstreamCoverageCall);
  const downstreamCoverage: CoverageScore[] = downstreamCoverageCall.data;
  accum(prereqCall);
  const prereqs: PrerequisiteCompetencyClaim[] = prereqCall.data;

  // ── Round 3: Gap analysis (depends on all of round 2) ───────────────────────
  const chainCoverageText = upstreamChain.map((course, i) => {
    const coverageLines = (upstreamCoverages[i] ?? []).map(
      c => `  - ${c.subCompetencyId}: ${c.kudLevel} (confidence ${c.confidence}) — ${c.reasoning}`
    ).join('\n');
    return `[Upstream course ${i + 1}: ${course.courseLabel}]\n${coverageLines}`;
  }).join('\n\n');

  const gapMsg = `Career target:\n${targetContext}\n\nDownstream prerequisite competencies:\n${prereqs.map(p => `- ${p.subCompetencyId} (expects ${p.expectedKudLevel}): ${p.rationale}`).join('\n')}\n\nUpstream chain (in sequence order, earliest first):\n\n${chainCoverageText}`;
  const gapCall = await provider.complete({
    systemPrompt: gapPrompt,
    userMessage: gapMsg,
    schemaName: 'prerequisite_gaps',
    jsonSchema: prerequisiteGapsJsonSchema,
    validate: (raw) => prerequisiteGapsSchema.parse((raw as { gaps: unknown }).gaps),
  });
  accum(gapCall);
  const gaps: PrerequisiteGap[] = gapCall.data;

  // Assemble the upstream chain result
  const upstreamChainResult: UpstreamCourseAnalysis[] = upstreamChain.map((course, i) => ({
    courseLabel: course.courseLabel,
    kud: upstreamKuds[i]!,
    coverage: upstreamCoverages[i]!,
  }));

  const result: AnalysisResult = {
    upstreamChain: upstreamChainResult,
    downstream: {
      courseLabel: downstream.courseLabel,
      kud: downstreamKud,
      coverage: downstreamCoverage,
      prerequisiteCompetencies: prereqs,
      prerequisiteGaps: gaps,
    },
    careerTargetId,
    meta: {
      aiProvider: provider.name,
      aiModel: provider.model,
      durationMs: Date.now() - started,
      costUsdCents: totalCost,
      cachedTokens: totalCached,
      uncachedTokens: totalUncached,
      completionTokens: totalCompletion,
    },
  };

  // Persist run + record spend. If either fails after completed AI work, we
  // still return the result to the client — losing the run log is preferable
  // to losing the user's analysis. The cost is slightly under-recorded on DB
  // failure, which is acceptable for a prototype.
  let runId: string | null = null;
  try {
    const inserted = await insertRun({
      ipHash,
      careerTargetId,
      upstreamCourseLabel: upstreamChain.map(c => c.courseLabel).join(', '),
      downstreamCourseLabel: downstream.courseLabel,
      upstreamSyllabus: upstreamChain.map(c => `[${c.courseLabel}]\n${c.syllabusText}`).join('\n\n---\n\n'),
      downstreamSyllabus: downstream.syllabusText,
      result,
      aiProvider: provider.name,
      aiModel: provider.model,
      costUsdCents: totalCost,
      durationMs: result.meta.durationMs,
    });
    runId = inserted.id;
    await recordSpend(totalCost);
  } catch (err) {
    console.error('analyze: persistence failed after successful AI calls', err);
  }

  return NextResponse.json({ ...result, runId });
}
