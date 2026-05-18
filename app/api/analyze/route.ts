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
import type { AnalysisResult, KUDOutcomes, CoverageScore, PrerequisiteCompetencyClaim, PrerequisiteGap } from '@/lib/domain/types';

// Vercel Hobby plan caps function duration at 60s by default; with 6
// sequential AI calls the analysis frequently runs 30-60s. Without this
// the function times out before the response is sent.
export const maxDuration = 60;

// Max syllabus length caps the OpenAI cost-per-request. ~20K chars ≈ 5K tokens
// per syllabus; with 6 AI calls per request the upper-bound cost stays well
// under $0.50 even on the worst-case input. Without this cap a 500KB paste
// would consume the full daily budget in a single request.
const MAX_SYLLABUS_LEN = 20000;

const requestSchema = z.object({
  careerTargetId: z.string().min(1).max(100),
  upstream: z.object({
    courseLabel: z.string().max(200).optional(),
    syllabusText: z.string().min(50).max(MAX_SYLLABUS_LEN),
  }),
  downstream: z.object({
    courseLabel: z.string().max(200).optional(),
    syllabusText: z.string().min(50).max(MAX_SYLLABUS_LEN),
  }),
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
  const { careerTargetId, upstream, downstream } = parsed.data;

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

  // Call 1: Draft upstream KUD
  const upstreamKudCall = await provider.complete({
    systemPrompt: draftPrompt,
    userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${upstream.syllabusText}`,
    schemaName: 'kud_outcomes',
    jsonSchema: kudOutcomesJsonSchema,
    validate: (raw) => kudOutcomesSchema.parse(raw),
  });
  totalCost += upstreamKudCall.costUsdCents;
  const upstreamKud: KUDOutcomes = upstreamKudCall.data;

  // Call 2: Draft downstream KUD
  const downstreamKudCall = await provider.complete({
    systemPrompt: draftPrompt,
    userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${downstream.syllabusText}`,
    schemaName: 'kud_outcomes',
    jsonSchema: kudOutcomesJsonSchema,
    validate: (raw) => kudOutcomesSchema.parse(raw),
  });
  totalCost += downstreamKudCall.costUsdCents;
  const downstreamKud: KUDOutcomes = downstreamKudCall.data;

  // Calls 3 & 4: Score coverage for both courses
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

  const upstreamCoverage = await scoreFor(upstream.courseLabel ?? 'Upstream course', upstreamKud);
  const downstreamCoverage = await scoreFor(downstream.courseLabel ?? 'Downstream course', downstreamKud);

  // Call 5: Suggest prerequisites for downstream
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

  // Call 6: Analyze gaps
  const gapMsg = `Career target:\n${targetContext}\n\nDownstream prerequisite competencies:\n${prereqs.map(p => `- ${p.subCompetencyId} (expects ${p.expectedKudLevel}): ${p.rationale}`).join('\n')}\n\nUpstream course coverage (KUD level per sub-competency):\n${upstreamCoverage.map(c => `- ${c.subCompetencyId}: ${c.kudLevel} (confidence ${c.confidence}) — ${c.reasoning}`).join('\n')}`;
  const gapCall = await provider.complete({
    systemPrompt: gapPrompt,
    userMessage: gapMsg,
    schemaName: 'prerequisite_gaps',
    jsonSchema: prerequisiteGapsJsonSchema,
    validate: (raw) => prerequisiteGapsSchema.parse((raw as { gaps: unknown }).gaps),
  });
  totalCost += gapCall.costUsdCents;
  const gaps: PrerequisiteGap[] = gapCall.data;

  const result: AnalysisResult = {
    upstream: { kud: upstreamKud, coverage: upstreamCoverage },
    downstream: { kud: downstreamKud, coverage: downstreamCoverage, prerequisiteCompetencies: prereqs, prerequisiteGaps: gaps },
    careerTargetId,
    meta: {
      aiProvider: provider.name,
      aiModel: provider.model,
      durationMs: Date.now() - started,
      costUsdCents: totalCost,
    },
  };

  // Persist run + record spend. If either fails after 30-60s of completed
  // AI work, we still return the result to the client — losing the run log
  // is preferable to losing the user's analysis. The cost is slightly
  // under-recorded on DB failure, which is acceptable for a prototype.
  let runId: string | null = null;
  try {
    const inserted = await insertRun({
      ipHash,
      careerTargetId,
      upstreamCourseLabel: upstream.courseLabel ?? null,
      downstreamCourseLabel: downstream.courseLabel ?? null,
      upstreamSyllabus: upstream.syllabusText,
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
