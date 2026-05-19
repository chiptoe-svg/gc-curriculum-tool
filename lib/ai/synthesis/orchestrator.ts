import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  careerTargets,
  partnerSubmissions,
  partners,
  synthesisRuns,
} from '@/lib/db/schema';
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import {
  synthesisResultSchema,
  synthesisResultJsonSchema,
  type SynthesisResult,
} from './schema';
import { buildSynthesisUserMessage, type SubmissionInput } from './prompt-builder';
import { salaryDistributionForTarget } from './queries';
import { logPartnerEvent } from '@/lib/partners/queries';

export interface PersistedRun {
  id: string;
  result: SynthesisResult;
  model: string;
  costUsdCents: number;
  submissionCount: number;
}

export async function synthesizeTarget(targetId: string): Promise<PersistedRun> {
  // 1. Cost guard
  const cap = await checkDailyCap();
  if (!cap.ok) {
    throw new Error(`Daily cap exceeded (${cap.spentCents}¢). Synthesis blocked.`);
  }

  // 2. Load the career target
  const targetRows = await db.select()
    .from(careerTargets)
    .where(eq(careerTargets.id, targetId))
    .limit(1);
  const target = targetRows[0];
  if (!target) throw new Error(`Career target not found: ${targetId}`);

  // 3. Load submissions with partner identity, excluding weight=0 partners
  const subRows = await db.select({
    submission: partnerSubmissions,
    partner: partners,
  })
    .from(partnerSubmissions)
    .innerJoin(partners, eq(partnerSubmissions.partnerId, partners.id))
    .where(and(
      eq(partnerSubmissions.careerTargetId, targetId),
      eq(partnerSubmissions.status, 'submitted'),
    ))
    .orderBy(desc(partnerSubmissions.submittedAt));

  const submissions: SubmissionInput[] = subRows
    .filter(r => r.partner.weight > 0)
    .map(r => ({
      partnerId: r.submission.partnerId,
      firstName: r.partner.firstName,
      lastName: r.partner.lastName,
      company: r.partner.company,
      weight: r.partner.weight,
      positionTitle: r.submission.positionTitle,
      responsibilities: r.submission.responsibilities,
      requiredSkills: r.submission.requiredSkills,
      niceToHaveSkills: r.submission.niceToHaveSkills,
      interviewQuestions: r.submission.interviewQuestions,
      additionalNotes: r.submission.additionalNotes,
      salaryRangeLow: r.submission.salaryRangeLow,
      salaryRangeHigh: r.submission.salaryRangeHigh,
      salaryCurrency: r.submission.salaryCurrency,
    }));

  if (submissions.length === 0) {
    throw new Error(`No submissions to synthesize for target ${targetId}.`);
  }

  // 4. Compute deterministic salary distribution (SQL — not LLM math)
  const salaryDistribution = await salaryDistributionForTarget(targetId);

  // 5. Build prompt + user message
  const systemPrompt = await loadPrompt('synthesize-target');
  const userMessage = buildSynthesisUserMessage({
    target: {
      id: target.id,
      name: target.name,
      shortDefinition: target.shortDefinition,
      knowDescriptors: target.knowDescriptors,
      understandDescriptors: target.understandDescriptors,
      doDescriptors: target.doDescriptors,
    },
    submissions,
    salaryDistribution,
  });

  // 6. Call provider with structured-outputs JSON schema
  const provider = getProvider();
  const completion = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'SynthesisResult',
    jsonSchema: synthesisResultJsonSchema,
    validate: raw => synthesisResultSchema.parse(raw),
  });

  // 7. Mix in the deterministic salary distribution (overwrite anything the LLM emitted)
  const result: SynthesisResult = {
    ...completion.data,
    salaryDistribution,
  };

  // 8. Persist + record spend. submissionCount reflects what was actually synthesized
  //    (post-weight-filter), so the staleness check compares apples-to-apples when
  //    more weight>0 submissions arrive.
  const submissionCount = submissions.length;
  const [inserted] = await db.insert(synthesisRuns).values({
    careerTargetId: targetId,
    submissionCount,
    result,
    model: provider.model,
    costUsdCents: completion.costUsdCents,
  }).returning({ id: synthesisRuns.id });
  if (!inserted) throw new Error('synthesizeTarget: synthesis_runs insert returned no row');

  await recordSpend(completion.costUsdCents);
  await logPartnerEvent(null, 'synthesis_run_completed', {
    targetId,
    costUsdCents: completion.costUsdCents,
    submissionCount,
    model: provider.model,
  });

  return {
    id: inserted.id,
    result,
    model: provider.model,
    costUsdCents: completion.costUsdCents,
    submissionCount,
  };
}

export async function getLatestRun(targetId: string) {
  const rows = await db.select()
    .from(synthesisRuns)
    .where(eq(synthesisRuns.careerTargetId, targetId))
    .orderBy(desc(synthesisRuns.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
