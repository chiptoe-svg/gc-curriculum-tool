import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProvider } from '@/lib/ai/provider';
import type { CompletionTelemetry } from '@/lib/ai/provider';
import {
  captureProfileSchema,
  captureScaleVersion,
  type CaptureProfile,
} from '@/lib/ai/capture/schema';
import type { ChatMessage, CaptureChatContext } from '@/lib/ai/analyze/capture-chat';
import { buildCaptureChatUserMessage } from '@/lib/ai/analyze/capture-chat';

/**
 * JSON Schema (Draft 2020-12) for OpenAI strict structured-output.
 *
 * Mirrors the Zod `captureProfileSchema` in shape; the refinements (foundationals
 * have null K/U; above-threshold scores require evidence) are enforced
 * client-side by `captureProfileSchema.parse` since JSON Schema can't easily
 * express conditional requiredness.
 */
const captureProfileJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'course_code',
    'scale_version',
    'generated_at',
    'competencies',
    'incoming_expectations',
    'verification_summary',
    'audit_notes',
    'revised_objectives_draft',
  ],
  properties: {
    course_code: { type: 'string', minLength: 1 },
    scale_version: { type: 'string', enum: [captureScaleVersion] },
    generated_at: { type: 'string', minLength: 1 },
    competencies: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'statement',
          'type',
          'k_depth',
          'u_depth',
          'd_depth',
          'evidence_k',
          'evidence_u',
          'evidence_d',
          'rationale',
        ],
        properties: {
          statement: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['technical', 'foundational'] },
          k_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          u_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          d_depth: { type: 'integer', minimum: 0, maximum: 5 },
          evidence_k: { type: ['string', 'null'] },
          evidence_u: { type: ['string', 'null'] },
          evidence_d: { type: ['string', 'null'] },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
    incoming_expectations: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'expected_depth', 'evidenced_by', 'confidence'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          expected_depth: {
            type: 'object',
            additionalProperties: false,
            required: ['k', 'u', 'd'],
            properties: {
              k: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              u: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              d: { type: 'integer', minimum: 0, maximum: 5 },
            },
          },
          evidenced_by: { type: 'array', minItems: 1, items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    verification_summary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'course_shape',
        'strongest_evidence',
        'dimensional_patterns',
        'catalog_vs_evidence',
        'foundationals_glance',
      ],
      properties: {
        course_shape: { type: 'string', minLength: 1 },
        strongest_evidence: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
        dimensional_patterns: { type: 'array', maxItems: 4, items: { type: 'string' } },
        catalog_vs_evidence: { type: 'array', maxItems: 4, items: { type: 'string' } },
        foundationals_glance: { type: 'string', minLength: 1 },
      },
    },
    audit_notes: {
      type: 'object',
      additionalProperties: false,
      required: [
        'prereq_gaps',
        'objective_misalignments',
        'cross_source_conflicts',
        'suggested_objective_revisions',
      ],
      properties: {
        prereq_gaps: { type: 'array', items: { type: 'string' } },
        objective_misalignments: { type: 'array', items: { type: 'string' } },
        cross_source_conflicts: { type: 'array', items: { type: 'string' } },
        suggested_objective_revisions: { type: 'array', items: { type: 'string' } },
      },
    },
    revised_objectives_draft: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },
  },
} as const;

function formatTranscript(history: ChatMessage[]): string {
  if (history.length === 0) return '**Transcript:** (no conversation; scoring from materials only)';
  const lines = history.map(m =>
    `[${m.role === 'user' ? 'Instructor' : 'Auditor'}] ${m.content}`,
  );
  return ['**Transcript:**', ...lines].join('\n\n');
}

export interface GenerateCaptureProfileResult {
  profile: CaptureProfile;
  telemetry: CompletionTelemetry;
  model: string;
}

/**
 * Run the scoring call: given the course context and the audit transcript,
 * produce a structured Course Outcome Profile that satisfies the v1 depth
 * scale rules.
 *
 * Throws if the provider returns content that fails the Zod refinements
 * (foundational with non-null K/U, above-zero score without evidence, etc.).
 * The caller can show that error to the reviewer — the scoring layer is
 * deterministic and tight by design.
 */
export async function generateCaptureProfile(
  context: CaptureChatContext,
  history: ChatMessage[],
): Promise<GenerateCaptureProfileResult> {
  const provider = getProvider();
  const systemPrompt = await loadPrompt('capture-scores');

  const userMessage = [
    buildCaptureChatUserMessage(context),
    '',
    '---',
    '',
    formatTranscript(history),
    '',
    '---',
    '',
    'Produce the Course Outcome Profile JSON now. Conform exactly to the',
    'schema. Score all five baseline foundational competencies (Agency,',
    'Attention to Detail, Resilience, Curiosity, Communication) plus any',
    'additional foundationals the materials evidence. Keep technical',
    'competencies in the 5–15 range. Above-zero scores require an evidence',
    'excerpt; foundationals must have null k_depth and u_depth.',
  ].join('\n');

  const result = await provider.complete<CaptureProfile>({
    systemPrompt,
    userMessage,
    schemaName: 'course_capture_profile_v1',
    jsonSchema: captureProfileJsonSchema as unknown as object,
    validate: (raw: unknown) => captureProfileSchema.parse(raw),
  });

  return {
    profile: result.data,
    telemetry: {
      costUsdCents: result.costUsdCents,
      durationMs: result.durationMs,
      cachedTokens: result.cachedTokens,
      uncachedPromptTokens: result.uncachedPromptTokens,
      completionTokens: result.completionTokens,
    },
    model: provider.model,
  };
}
