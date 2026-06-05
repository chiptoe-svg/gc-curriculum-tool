import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

const ConfidenceField = <T extends z.ZodTypeAny>(inner: T) => z.object({
  value: inner.nullable(),
  confidence: z.number().min(0).max(1),
});

export const JdExtraction = z.object({
  title: ConfidenceField(z.string().max(200)),
  responsibilities: ConfidenceField(z.string().max(4000)),
  required_qualifications: ConfidenceField(z.string().max(4000)),
  preferred_qualifications: ConfidenceField(z.string().max(4000)),
  years_experience: ConfidenceField(z.object({ min: z.number().int().min(0).max(50), max: z.number().int().min(0).max(50).nullable() })),
  education: ConfidenceField(z.string().max(500)),
  location: ConfidenceField(z.string().max(200)),
  remote_status: ConfidenceField(z.enum(['onsite', 'remote', 'hybrid'])),
  salary_range: ConfidenceField(z.object({ min: z.number(), max: z.number(), currency: z.string().max(10) })),
  reports_to: ConfidenceField(z.string().max(200)),
  extras_notes: ConfidenceField(z.string().max(8000)),
});
export type JdExtractionType = z.infer<typeof JdExtraction>;

const stringField = (maxLength: number) => ({
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['value', 'confidence'] as const,
  properties: {
    value: { type: ['string', 'null'] as const, maxLength },
    confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
  },
});

export const jdExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'responsibilities', 'required_qualifications', 'preferred_qualifications', 'years_experience', 'education', 'location', 'remote_status', 'salary_range', 'reports_to', 'extras_notes'],
  properties: {
    title: stringField(200),
    responsibilities: stringField(4000),
    required_qualifications: stringField(4000),
    preferred_qualifications: stringField(4000),
    education: stringField(500),
    location: stringField(200),
    reports_to: stringField(200),
    extras_notes: stringField(8000),
    years_experience: {
      type: 'object', additionalProperties: false, required: ['value', 'confidence'],
      properties: {
        value: {
          anyOf: [
            { type: 'null' },
            { type: 'object', additionalProperties: false, required: ['min', 'max'], properties: { min: { type: 'integer', minimum: 0, maximum: 50 }, max: { type: ['integer', 'null'] as const, minimum: 0, maximum: 50 } } },
          ],
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    remote_status: {
      type: 'object', additionalProperties: false, required: ['value', 'confidence'],
      properties: {
        value: { anyOf: [{ type: 'null' }, { type: 'string', enum: ['onsite', 'remote', 'hybrid'] as const }] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    salary_range: {
      type: 'object', additionalProperties: false, required: ['value', 'confidence'],
      properties: {
        value: {
          anyOf: [
            { type: 'null' },
            { type: 'object', additionalProperties: false, required: ['min', 'max', 'currency'], properties: { min: { type: 'number' }, max: { type: 'number' }, currency: { type: 'string', maxLength: 10 } } },
          ],
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
} as const;

/**
 * Extract structured fields from a JD text blob. Caller is responsible for
 * supplying the text — if it's a PDF, run Docling first; if it's pasted
 * text, pass it through.
 */
export async function extractJdFields(jdText: string): Promise<{
  fields: JdExtractionType;
  model: string;
  costUsdCents: number;
  durationMs: number;
}> {
  const provider = await getProviderForFunction('jd-extract');
  const systemPrompt = await loadPrompt('jd-extract');

  const result = await provider.complete<JdExtractionType>({
    systemPrompt,
    userMessage: `# Source JD\n\n${jdText.slice(0, 60_000)}`,
    schemaName: 'jd_extraction',
    jsonSchema: jdExtractionJsonSchema as unknown as object,
    validate: (raw: unknown) => JdExtraction.parse(raw),
  });

  return {
    fields: result.data,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
