import { loadPrompt } from '@/lib/ai/prompts/load';
import { chunkLlmComplete } from '@/lib/ai/analyze/chunk-llm-provider';

export interface ContextualizeInput {
  materialDigest: string;
  sectionTitle: string;
  chunkText: string;
}

export interface ContextualizeResult {
  blurb: string;
  model: string;
}

/**
 * Produce a 1–2 sentence position blurb describing where this chunk sits
 * in the broader material. The blurb is prepended to the chunk before
 * embedding so the resulting vector encodes position + content (Anthropic
 * contextual-retrieval pattern). Light-tier; one call per detail chunk.
 */
export async function contextualizeChunk(input: ContextualizeInput): Promise<ContextualizeResult> {
  const systemPrompt = await loadPrompt('chunk-contextualize');

  const jsonSchema = {
    type: 'object',
    properties: { blurb: { type: 'string' } },
    required: ['blurb'],
    additionalProperties: false,
  };

  const sectionLabel = input.sectionTitle.trim() || '(no heading)';
  const userMessage = [
    'MATERIAL DIGEST:',
    input.materialDigest,
    '',
    `SECTION TITLE: ${sectionLabel}`,
    '',
    'CHUNK TEXT:',
    input.chunkText,
    '',
    'Return JSON: { "blurb": "<one to two sentences>" }',
  ].join('\n');

  const { data, model } = await chunkLlmComplete<{ blurb: string }>('chunk-contextualize', {
    systemPrompt,
    userMessage,
    schemaName: 'chunk_context',
    jsonSchema,
    validate: (raw) => {
      const r = raw as { blurb?: unknown };
      if (typeof r.blurb !== 'string' || r.blurb.trim().length === 0) {
        throw new Error('chunk-contextualize: empty blurb');
      }
      return { blurb: r.blurb };
    },
  });

  return { blurb: data.blurb, model };
}
