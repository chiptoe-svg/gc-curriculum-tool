import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { kudOutcomesSchema, kudOutcomesJsonSchema } from '@/lib/ai/schemas';
import type { KUDOutcomes } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface DraftCourseKUDArgs {
  syllabusText: string;
}

export async function draftCourseKUD({ syllabusText }: DraftCourseKUDArgs): Promise<{
  data: KUDOutcomes;
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('draft-course-outcomes');
  const provider = getProvider();
  const result = await provider.complete({
    systemPrompt,
    userMessage: `Syllabus text:\n${syllabusText}`,
    schemaName: 'kud_outcomes',
    jsonSchema: kudOutcomesJsonSchema,
    validate: (raw) => kudOutcomesSchema.parse(raw),
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
