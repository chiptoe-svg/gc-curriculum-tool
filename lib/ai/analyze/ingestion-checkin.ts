import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

export interface CheckInInput {
  catalog: {
    code: string;
    title: string;
    learningObjectives: string[];
    majorProjects: string[];
  };
  materials: Array<{
    fileName: string;
    ferpaRisk: 'low' | 'medium' | 'high';
    autoSetAside: boolean;
    setAsideReason: string | null;
    digestSnippet: string;
  }>;
}

export type CheckInHighlight = {
  kind: 'missing' | 'set-aside' | 'ferpa';
  text: string;
};

export interface CheckInResult {
  message: string | null;
  highlights: CheckInHighlight[];
  model: string;
}

/**
 * Pre-audit curation review. Returns either silence (message=null) or a
 * short heads-up about a specific materials issue (missing core source,
 * stacked auto-set-asides, kept high-FERPA risk, near-empty digest clusters).
 * Light-tier; one call per page open.
 */
export async function generateIngestionCheckIn(input: CheckInInput): Promise<CheckInResult> {
  const provider = await getProviderForFunction('ingestion-checkin');
  const systemPrompt = await loadPrompt('ingestion-checkin');

  const jsonSchema = {
    type: 'object',
    properties: {
      message: { type: ['string', 'null'] },
      highlights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { enum: ['missing', 'set-aside', 'ferpa'] },
            text: { type: 'string' },
          },
          required: ['kind', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['message', 'highlights'],
    additionalProperties: false,
  };

  const userMessage = JSON.stringify(input);

  const { data } = await provider.complete<{ message: string | null; highlights: CheckInHighlight[] }>({
    systemPrompt,
    userMessage,
    schemaName: 'ingestion_checkin',
    jsonSchema,
    validate: (raw) => {
      const r = raw as { message?: unknown; highlights?: unknown };
      const message = r.message === null || typeof r.message === 'string' ? r.message ?? null : null;
      const highlights = Array.isArray(r.highlights) ? (r.highlights as CheckInHighlight[]) : [];
      return { message, highlights };
    },
  });

  return { message: data.message, highlights: data.highlights, model: provider.model };
}
