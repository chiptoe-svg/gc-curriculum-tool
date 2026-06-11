import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { profileFieldsSchema, profileFieldsJsonSchema } from '@/lib/ai/schemas';
import type { ProfileFields } from '@/lib/ai/schemas';

export interface ParseProfileFieldsResult {
  fields: ProfileFields;
  costUsdCents: number;
}

export async function parseProfileFields(syllabusText: string): Promise<ParseProfileFieldsResult> {
  const systemPrompt = await loadPrompt('parse-profile-fields');
  const provider = await getProviderForFunction('parse-profile-fields');
  const result = await provider.complete({
    systemPrompt,
    userMessage: `Syllabus text:\n${syllabusText}`,
    schemaName: 'profile_fields',
    jsonSchema: profileFieldsJsonSchema,
    validate: (raw) => profileFieldsSchema.parse(raw),
  });
  return { fields: result.data, costUsdCents: result.costUsdCents };
}
