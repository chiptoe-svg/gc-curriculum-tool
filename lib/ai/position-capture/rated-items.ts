import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

export const RatedItemsList = z.object({
  items: z.array(z.object({
    name: z.string().min(1).max(150),
    description: z.string().min(1).max(400),
    evidence_source: z.string().min(1).max(300),
    sub_competency_id: z.string().nullable(),   // A2 — mappable join key
  })).length(10),
});
export type RatedItemsListType = z.infer<typeof RatedItemsList>;

export const ratedItemsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array', minItems: 10, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'description', 'evidence_source', 'sub_competency_id'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 150 },
          description: { type: 'string', minLength: 1, maxLength: 400 },
          evidence_source: { type: 'string', minLength: 1, maxLength: 300 },
          sub_competency_id: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

export interface GenerateRatedItemsInput {
  positionTitle: string;
  company: string;
  targetContext: {
    name: string;
    description: string;
    subCompetencies: Array<{ id: string; name: string; description: string }>;
  };
  structuredInputs: Record<string, unknown>;  // pages 1-4 data
}

export async function generateRatedItems(input: GenerateRatedItemsInput): Promise<{
  items: RatedItemsListType['items'];
  model: string;
  costUsdCents: number;
  durationMs: number;
}> {
  const provider = await getProviderForFunction('position-rated-items');
  const systemPrompt = await loadPrompt('position-rated-items');

  const userMessage = [
    `# Position`,
    `**${input.positionTitle}** at ${input.company}`,
    '',
    `# Career target`,
    `**${input.targetContext.name}** — ${input.targetContext.description}`,
    '',
    `# Sub-competencies`,
    ...input.targetContext.subCompetencies.map(sc => `- [${sc.id}] ${sc.name}: ${sc.description}`),
    '',
    `# Page 1-4 inputs`,
    '```json',
    JSON.stringify(input.structuredInputs, null, 2),
    '```',
    '',
    'Emit the 10 items now per the schema.',
  ].join('\n');

  const result = await provider.complete<RatedItemsListType>({
    systemPrompt,
    userMessage,
    schemaName: 'position_rated_items',
    jsonSchema: ratedItemsJsonSchema as unknown as object,
    validate: (raw: unknown) => RatedItemsList.parse(raw),
  });

  return {
    items: result.data.items,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
