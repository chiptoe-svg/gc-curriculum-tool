import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { prerequisiteGapsSchema, prerequisiteGapsJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, PrerequisiteCompetencyClaim, PrerequisiteGap } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface AnalyzeGapsArgs {
  targetContext: string;
  prereqs: PrerequisiteCompetencyClaim[];
  priorCoursework: Array<{ courseLabel: string; coverage: CoverageScore[] }>;
}

export async function analyzeGaps({ targetContext, prereqs, priorCoursework }: AnalyzeGapsArgs): Promise<{
  data: PrerequisiteGap[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('analyze-prerequisite-gaps');
  const provider = getProvider();
  const priorText = priorCoursework.map((c, i) => {
    const lines = c.coverage.map(
      s => `  - ${s.subCompetencyId}: ${s.kudLevel} (confidence ${s.confidence}) — ${s.reasoning}`
    ).join('\n');
    return `[Prior course ${i + 1}: ${c.courseLabel}]\n${lines}`;
  }).join('\n\n');
  const userMessage = `Career target:\n${targetContext}\n\nPrerequisite competencies for the course being analyzed:\n${prereqs.map(p => `- ${p.subCompetencyId} (expects ${p.expectedKudLevel}): ${p.rationale}`).join('\n')}\n\nPrior coursework (any order):\n\n${priorText}`;
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'prerequisite_gaps',
    jsonSchema: prerequisiteGapsJsonSchema,
    validate: (raw) => prerequisiteGapsSchema.parse((raw as { gaps: unknown }).gaps),
  });
  return {
    data: result.data,
    telemetry: {
      costUsdCents: result.costUsdCents,
      cachedTokens: result.cachedTokens,
      uncachedPromptTokens: result.uncachedPromptTokens,
      completionTokens: result.completionTokens,
    },
  };
}
