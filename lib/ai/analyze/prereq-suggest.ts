import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { prerequisiteClaimsSchema, prerequisiteClaimsJsonSchema } from '@/lib/ai/schemas';
import type { KUDOutcomes, PrerequisiteCompetencyClaim } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface SuggestPrereqsArgs {
  targetContext: string;
  courseKud: KUDOutcomes;
}

export async function suggestPrereqs({ targetContext, courseKud }: SuggestPrereqsArgs): Promise<{
  data: PrerequisiteCompetencyClaim[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('suggest-prerequisites');
  const provider = getProvider();
  const userMessage = `Career target:\n${targetContext}\n\nCourse outcomes:\nDescription: ${courseKud.description}\nKnow: ${courseKud.know.join('; ')}\nUnderstand: ${courseKud.understand.join('; ')}\nDo: ${courseKud.do.join('; ')}`;
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'prerequisite_claims',
    jsonSchema: prerequisiteClaimsJsonSchema,
    validate: (raw) => prerequisiteClaimsSchema.parse((raw as { claims: unknown }).claims),
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
