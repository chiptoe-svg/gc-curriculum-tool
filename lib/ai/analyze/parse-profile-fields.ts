import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { profileFieldsSchema, profileFieldsJsonSchema } from '@/lib/ai/schemas';
import type { ProfileFields } from '@/lib/ai/schemas';

export async function parseProfileFields(syllabusText: string): Promise<ProfileFields> {
  const systemPrompt = await loadPrompt('parse-profile-fields');
  const provider = await getProviderForFunction('parse-profile-fields');
  const result = await provider.complete({
    systemPrompt,
    userMessage: `Syllabus text:\n${syllabusText}`,
    schemaName: 'profile_fields',
    jsonSchema: profileFieldsJsonSchema,
    validate: (raw) => profileFieldsSchema.parse(raw),
  });
  return result.data;
}
