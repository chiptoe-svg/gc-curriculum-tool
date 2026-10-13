import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { STRATA, type BundleSummary, type CardFields } from '@/lib/catalog/bundles';

export const BUNDLE_CARD_PROMPT_VERSION = 'bundle-card-draft@1';

const cardSchema = z.object({
  stratum: z.enum(STRATA),
  includes: z.string().min(1),
  excludes: z.string().min(1),
  distinctions: z.string().min(1),
  positive_examples: z.array(z.string().min(1)).min(2).max(3),
  negative_examples: z.array(z.string().min(1)).min(2).max(3),
});

export const CARD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stratum', 'includes', 'excludes', 'distinctions', 'positive_examples', 'negative_examples'],
  properties: {
    stratum: { type: 'string', enum: [...STRATA] },
    includes: { type: 'string', minLength: 1 },
    excludes: { type: 'string', minLength: 1 },
    distinctions: { type: 'string', minLength: 1 },
    positive_examples: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string', minLength: 1 } },
    negative_examples: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string', minLength: 1 } },
  },
} as const;

export function buildCardUserMessage(bundle: BundleSummary, catalog: BundleSummary[]): string {
  const others = catalog.filter(b => b.id !== bundle.id).map(b => ({ id: b.id, name: b.name, know: b.knowDescriptor, understand: b.understandDescriptor, do: b.doDescriptor }));
  return [
    `**Bundle id:** ${bundle.id}`,
    `**Name:** ${bundle.name}`,
    `**Know:** ${bundle.knowDescriptor}`,
    `**Understand:** ${bundle.understandDescriptor}`,
    `**Do:** ${bundle.doDescriptor}`,
    '',
    '**The rest of the catalog (for excludes and distinctions):**',
    JSON.stringify(others, null, 2),
    '',
    'Write this bundle\'s card per the system instructions.',
  ].join('\n');
}

export async function draftBundleCard(bundle: BundleSummary, catalog: BundleSummary[]): Promise<{ card: CardFields; model: string; costUsdCents: number }> {
  const provider = await getProviderForFunction('bundle-card-draft');
  const systemPrompt = await loadPrompt('bundle-card-draft');
  const result = await provider.complete<z.infer<typeof cardSchema>>({
    systemPrompt,
    userMessage: buildCardUserMessage(bundle, catalog),
    schemaName: 'bundle_card_v1',
    jsonSchema: CARD_JSON_SCHEMA as unknown as object,
    validate: (raw: unknown) => cardSchema.parse(raw),
  });
  const d = result.data;
  return {
    card: { stratum: d.stratum, includes: d.includes, excludes: d.excludes, distinctions: d.distinctions, positiveExamples: d.positive_examples, negativeExamples: d.negative_examples },
    model: provider.model,
    costUsdCents: result.costUsdCents,
  };
}
