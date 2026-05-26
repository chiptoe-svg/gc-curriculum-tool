import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

export interface DigestInput {
  fileName: string;
  extractedText: string;
}

export interface DigestResult {
  digest: string;
  model: string;
}

/**
 * Produce a structured per-material digest. Applied to every material in
 * Stage 2a (not just long reference ones — that was the v1 reference-
 * compression flow, generalized here). Light-tier; one call per material.
 */
export async function generateMaterialDigest(input: DigestInput): Promise<DigestResult> {
  const provider = await getProviderForFunction('material-digest');
  const systemPrompt = await loadPrompt('material-digest');

  const jsonSchema = {
    type: 'object',
    properties: { digest: { type: 'string' } },
    required: ['digest'],
    additionalProperties: false,
  };

  const userMessage = [
    `File name: ${input.fileName}`,
    '',
    'Material content begins:',
    '---',
    input.extractedText,
    '---',
    'End of material content.',
    '',
    'Return JSON: { "digest": "<the markdown digest>" }',
  ].join('\n');

  const { data } = await provider.complete<{ digest: string }>({
    systemPrompt,
    userMessage,
    schemaName: 'material_digest',
    jsonSchema,
    validate: (raw) => {
      const r = raw as { digest?: unknown };
      if (typeof r.digest !== 'string' || r.digest.trim().length === 0) {
        throw new Error('material-digest: empty or non-string digest in response');
      }
      return { digest: r.digest };
    },
  });

  return { digest: data.digest, model: provider.model };
}
