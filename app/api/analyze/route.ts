import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getTargetById } from '@/lib/domain/seed-targets';
import { insertRun } from '@/lib/db/queries';
import {
  kudOutcomesSchema, kudOutcomesJsonSchema,
  coverageScoresSchema, coverageScoresJsonSchema,
  prerequisiteClaimsSchema, prerequisiteClaimsJsonSchema,
  prerequisiteGapsSchema, prerequisiteGapsJsonSchema,
} from '@/lib/ai/schemas';
import type { AnalysisResult, KUDOutcomes, CoverageScore, PrerequisiteCompetencyClaim, PrerequisiteGap } from '@/lib/domain/types';

const requestSchema = z.object({
  careerTargetId: z.string(),
  upstream: z.object({
    courseLabel: z.string().optional(),
    syllabusText: z.string().min(50),
  }),
  downstream: z.object({
    courseLabel: z.string().optional(),
    syllabusText: z.string().min(50),
  }),
});

function hashIp(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
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

  // Persist run
  const { id: runId } = await insertRun({
    ipHash: hashIp(req),
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

  return NextResponse.json({ ...result, runId });
}
