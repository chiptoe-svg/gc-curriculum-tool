import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getTargetById } from '@/lib/domain/seed-targets';
import { insertRun } from '@/lib/db/queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import {
  kudOutcomesSchema, kudOutcomesJsonSchema,
  coverageScoresSchema, coverageScoresJsonSchema,
  prerequisiteClaimsSchema, prerequisiteClaimsJsonSchema,
  prerequisiteGapsSchema, prerequisiteGapsJsonSchema,
} from '@/lib/ai/schemas';
import type { AnalysisResult, KUDOutcomes, CoverageScore, PrerequisiteCompetencyClaim, PrerequisiteGap, UpstreamCourseAnalysis } from '@/lib/domain/types';

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

function buildTargetContext(target: ReturnType<typeof getTargetById>): string {
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

  const target = getTargetById(careerTargetId);
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
  const started = Date.now();

  // Helper to score coverage for a single course
  const scoreFor = async (courseLabel: string, kud: KUDOutcomes): Promise<CoverageScore[]> => {
    const userMsg = `Career target:\n${targetContext}\n\nCourse: ${courseLabel}\n\nCourse description: ${kud.description}\n\nKnow outcomes:\n${kud.know.map(b => `- ${b}`).join('\n')}\n\nUnderstand outcomes:\n${kud.understand.map(b => `- ${b}`).join('\n')}\n\nDo outcomes:\n${kud.do.map(b => `- ${b}`).join('\n')}`;
    const call = await provider.complete({
      systemPrompt: scorePrompt,
      userMessage: userMsg,
      schemaName: 'coverage_scores',
      jsonSchema: coverageScoresJsonSchema,
      validate: (raw) => coverageScoresSchema.parse((raw as { scores: unknown }).scores),
    });
    totalCost += call.costUsdCents;
    return call.data;
  };

  // Calls 1..N: Draft KUD for each upstream course in the chain
  const upstreamKuds: KUDOutcomes[] = [];
  for (const course of upstreamChain) {
    const call = await provider.complete({
      systemPrompt: draftPrompt,
      userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${course.syllabusText}`,
      schemaName: 'kud_outcomes',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    });
    totalCost += call.costUsdCents;
    upstreamKuds.push(call.data);
  }

  // Call N+1: Draft downstream KUD
  const downstreamKudCall = await provider.complete({
    systemPrompt: draftPrompt,
    userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${downstream.syllabusText}`,
    schemaName: 'kud_outcomes',
    jsonSchema: kudOutcomesJsonSchema,
    validate: (raw) => kudOutcomesSchema.parse(raw),
  });
  totalCost += downstreamKudCall.costUsdCents;
  const downstreamKud: KUDOutcomes = downstreamKudCall.data;

  // Calls N+2..2N+1: Score coverage for each upstream course
  const upstreamCoverages: CoverageScore[][] = [];
  for (let i = 0; i < upstreamChain.length; i++) {
    const coverage = await scoreFor(upstreamChain[i]!.courseLabel, upstreamKuds[i]!);
    upstreamCoverages.push(coverage);
  }

  // Call 2N+2: Score coverage for downstream
  const downstreamCoverage = await scoreFor(downstream.courseLabel, downstreamKud);

  // Call 2N+3: Suggest prerequisites for downstream
  const prereqMsg = `Career target:\n${targetContext}\n\nDownstream course outcomes:\nDescription: ${downstreamKud.description}\nKnow: ${downstreamKud.know.join('; ')}\nUnderstand: ${downstreamKud.understand.join('; ')}\nDo: ${downstreamKud.do.join('; ')}`;
  const prereqCall = await provider.complete({
    systemPrompt: prereqPrompt,
    userMessage: prereqMsg,
    schemaName: 'prerequisite_claims',
    jsonSchema: prerequisiteClaimsJsonSchema,
    validate: (raw) => prerequisiteClaimsSchema.parse((raw as { claims: unknown }).claims),
  });
  totalCost += prereqCall.costUsdCents;
  const prereqs: PrerequisiteCompetencyClaim[] = prereqCall.data;

  // Call 2N+4: Analyze gaps with combined upstream chain context
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
  totalCost += gapCall.costUsdCents;
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
