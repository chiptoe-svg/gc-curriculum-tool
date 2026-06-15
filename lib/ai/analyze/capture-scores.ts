import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { CompletionTelemetry } from '@/lib/ai/provider';
import {
  captureProfileSchemaV2,
  captureScaleVersion,
  type CaptureProfile,
} from '@/lib/ai/capture/schema';
import { withDerivedCompetencySources } from '@/lib/ai/synthesis/source-derivation';
import type { CaptureChatContext } from '@/lib/ai/analyze/capture-chat';
import { buildCaptureChatUserMessage } from '@/lib/ai/analyze/capture-chat';
import type { captureMessages } from '@/lib/db/schema';
import type { InferSelectModel } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Shared sub-schema fragments for v2 source attribution (optional fields).
// Inlined at each finding site rather than using $defs so the object remains
// compatible with strict-mode structured-output providers that flatten refs.
// ---------------------------------------------------------------------------
const SOURCE_ENUM = { enum: ['instructor', 'materials', 'inferred'] } as const;
// OpenAI strict structured-output requires every property in `properties`
// to be listed in `required`. Optional fields (chunkId / messageId — one
// is set depending on citation type) are encoded as nullable union types
// instead. Same shape as audit-response-schema.ts's Citation.
const CITATIONS_ARRAY = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'chunkId', 'messageId', 'excerpt'],
    properties: {
      type: { enum: ['chunk', 'instructor'] },
      chunkId: { type: ['string', 'null'] },
      messageId: { type: ['string', 'null'] },
      excerpt: { type: 'string', maxLength: 200 },
    },
  },
} as const;

/**
 * JSON Schema (Draft 2020-12) for OpenAI strict structured-output.
 *
 * Mirrors the Zod `captureProfileSchema` in shape; the refinements (foundationals
 * have null K/U; above-threshold scores require evidence) are enforced
 * client-side by `captureProfileSchema.parse` since JSON Schema can't easily
 * express conditional requiredness.
 */
export const captureProfileJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'course_code',
    'scale_version',
    'generated_at',
    'overview',
    'competencies',
    'incoming_expectations',
    'verification_summary',
    'audit_notes',
    'revised_objectives_draft',
    'course_emphasis',
  ],
  properties: {
    course_code: { type: 'string', minLength: 1 },
    scale_version: { type: 'string', enum: [captureScaleVersion] },
    generated_at: { type: 'string', minLength: 1 },
    overview: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['narrative', 'at_a_glance', 'who_for', 'arc', 'source', 'citations'],
      properties: {
        narrative: { type: 'string', minLength: 40 },
        at_a_glance: { type: 'array', items: { type: 'string', minLength: 3 }, minItems: 3, maxItems: 7 },
        who_for: { type: 'string', minLength: 10 },
        arc: { type: 'string', minLength: 20 },
        source: { type: ['string', 'null'], enum: ['instructor', 'materials', 'inferred', null] },
        citations: CITATIONS_ARRAY,
      },
    },
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
          'source',
          'citations',
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
          source: SOURCE_ENUM,
          citations: CITATIONS_ARRAY,
        },
      },
    },
    incoming_expectations: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'expected_depth', 'evidenced_by', 'confidence', 'source', 'citations'],
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
          source: SOURCE_ENUM,
          citations: CITATIONS_ARRAY,
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
        'source',
        'citations',
      ],
      properties: {
        course_shape: { type: 'string', minLength: 1 },
        strongest_evidence: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
        dimensional_patterns: { type: 'array', maxItems: 4, items: { type: 'string' } },
        catalog_vs_evidence: { type: 'array', maxItems: 4, items: { type: 'string' } },
        foundationals_glance: { type: 'string', minLength: 1 },
        source: SOURCE_ENUM,
        citations: CITATIONS_ARRAY,
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
        'productive_failure_conditions',
        'source',
        'citations',
      ],
      properties: {
        prereq_gaps: { type: 'array', items: { type: 'string' } },
        objective_misalignments: { type: 'array', items: { type: 'string' } },
        cross_source_conflicts: { type: 'array', items: { type: 'string' } },
        suggested_objective_revisions: { type: 'array', items: { type: 'string' } },
        // Productive-failure conditions surfaced in Audit Area 7. The capture
        // chat probes whether the course has each condition; the scorer
        // commits to one of three states per condition plus a max-supporting-
        // depth signal that grades the contribution. Treated as required by
        // the schema for new captures; the Zod schema treats it optional so
        // pre-existing snapshots remain valid.
        productive_failure_conditions: {
          // Nullable: the model emits null when Audit Area 7 was not probed
          // (presence-as-sentinel). Unified with the v2 variant.
          type: ['object', 'null'],
          additionalProperties: false,
          required: [
            'generate_then_consolidate',
            'open_ended_problems',
            'revision_cycles',
            'structured_post_mortem',
            'structured_post_mortem_evidence',
            'abstraction_bridging',
            'abstraction_bridging_evidence',
            'max_supporting_depth',
            'notes',
          ],
          properties: {
            generate_then_consolidate: { type: 'string', enum: ['present', 'partial', 'absent'] },
            open_ended_problems: { type: 'string', enum: ['present', 'partial', 'absent'] },
            revision_cycles: { type: 'string', enum: ['present', 'partial', 'absent'] },
            structured_post_mortem: { type: 'string', enum: ['present', 'partial', 'absent'] },
            // Nullable array of citations; required-by-superRefine in Zod when
            // structured_post_mortem is above 'absent'. Model emits null otherwise.
            structured_post_mortem_evidence: { type: ['array', 'null'], items: CITATIONS_ARRAY.items },
            abstraction_bridging: { type: 'string', enum: ['present', 'partial', 'absent'] },
            // Nullable array; required-by-superRefine in Zod when abstraction_bridging
            // is above 'absent'. Model emits null otherwise.
            abstraction_bridging_evidence: { type: ['array', 'null'], items: CITATIONS_ARRAY.items },
            max_supporting_depth: { type: 'integer', minimum: 0, maximum: 5 },
            notes: { type: 'array', items: { type: 'string' } },
          },
        },
        source: SOURCE_ENUM,
        citations: CITATIONS_ARRAY,
      },
    },
    revised_objectives_draft: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },
    course_emphasis: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['competency', 'points', 'share_pct', 'centrality'],
        properties: {
          competency: { type: 'string', minLength: 1 },
          points: { type: 'integer', minimum: 0 },
          share_pct: { type: 'integer', minimum: 0, maximum: 100 },
          centrality: { type: 'string', enum: ['central', 'supporting', 'peripheral'] },
        },
      },
    },
  },
} as const;

export interface GenerateCaptureProfileResult {
  profile: CaptureProfile;
  telemetry: CompletionTelemetry;
  model: string;
}

// ---------------------------------------------------------------------------
// v2 synthesis path (capture-synthesis.md prompt + capture_messages transcript)
// ---------------------------------------------------------------------------

type CaptureMessageRow = InferSelectModel<typeof captureMessages>;

// v2-only schema variant: productive_failure_conditions can be null when
// Audit Area 7 wasn't probed in the transcript. OpenAI strict mode requires
// the field to stay in `required` (we can't omit it from required like the
// previous implementation did), so we keep it required and widen its type
// to "object or null." The synthesis prompt is responsible for emitting
// null when Area 7 was not probed.
export const captureProfileJsonSchemaV2 = (() => {
  const cloned = JSON.parse(JSON.stringify(captureProfileJsonSchema)) as {
    required: string[];
    properties: Record<string, unknown> & {
      audit_notes: {
        properties: { productive_failure_conditions: { type?: string | string[] } };
      };
    };
  };

  // Widen PF block to nullable (safety net — v1 already has this).
  const pf = cloned.properties.audit_notes.properties.productive_failure_conditions;
  pf.type = ['object', 'null'];

  // -------------------------------------------------------------------------
  // New fields: class_structure + major_projects (2026-06-08).
  // Only in V2 — v1 schema is frozen for legacy-snapshot compatibility.
  // Strict-mode discipline: every property in `properties` must be in
  // `required`; optional fields use type: ['T', 'null'].
  // -------------------------------------------------------------------------
  cloned.required.push('class_structure', 'major_projects');

  (cloned.properties as Record<string, unknown>).class_structure = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['topics', 'cadence', 'assessment', 'source', 'citations'],
    properties: {
      topics: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
      cadence: { type: 'string', minLength: 5 },
      assessment: { type: 'string', minLength: 10 },
      source: { type: ['string', 'null'], enum: ['instructor', 'materials', 'inferred', null] },
      citations: CITATIONS_ARRAY,
    },
  };

  (cloned.properties as Record<string, unknown>).major_projects = {
    type: ['array', 'null'],
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'competencies', 'source', 'citations'],
      properties: {
        title: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 10 },
        competencies: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        source: { type: ['string', 'null'], enum: ['instructor', 'materials', 'inferred', null] },
        citations: CITATIONS_ARRAY,
      },
    },
  };

  return cloned;
})();

export interface V2SynthesisContext {
  chatContext: CaptureChatContext;
  sessionId: string;
  transcript: CaptureMessageRow[];
}

/**
 * Render one transcript row for the synthesis prompt. The assistant's content
 * column for v2 turns is a JSON-stringified AuditResponse
 * (finding + question + citations + readiness) — we surface `finding` (the
 * scoring-relevant prose) and the row's `citations` jsonb column. Tool-role
 * rows are summarized; the citation/finding signal is already on the
 * assistant turn that requested the tool call.
 */
function formatTranscriptRow(row: CaptureMessageRow): string | null {
  const idShort = row.id.slice(0, 8);
  if (row.role === 'user') {
    return `USER (turn ${row.turnIndex}, id=${idShort}): ${row.content ?? '(empty)'}`;
  }
  if (row.role === 'assistant') {
    let assistantText = row.content ?? '';
    if (assistantText.length > 0) {
      try {
        const parsed = JSON.parse(assistantText) as { finding?: unknown; question?: unknown };
        const finding = typeof parsed.finding === 'string' ? parsed.finding : '';
        const question = typeof parsed.question === 'string' ? parsed.question : '';
        assistantText = [finding && `Finding: ${finding}`, question && `Question: ${question}`]
          .filter(Boolean)
          .join('\n');
      } catch {
        // Non-JSON assistant content (legacy v1-style row) — fall through with raw text.
      }
    }
    const cites = (row.citations ?? [])
      .map(c => {
        const ref = c.chunkId
          ? `chunk=${c.chunkId.slice(0, 8)}`
          : c.messageId
            ? `msg=${c.messageId.slice(0, 8)}`
            : '?';
        return `[${c.type}:${ref}] "${c.excerpt.slice(0, 140)}"`;
      })
      .join(' | ');
    return [
      `ASSISTANT (turn ${row.turnIndex}, id=${idShort}):`,
      assistantText || '(no prose)',
      `CITATIONS: ${cites || '(none)'}`,
    ].join('\n');
  }
  if (row.role === 'tool') {
    const tools = (row.toolResult ?? []).map(t => t.toolCallId.slice(0, 8)).join(',');
    return `TOOL (turn ${row.turnIndex}): result for [${tools || '?'}] — see preceding ASSISTANT citations`;
  }
  return null;
}

function formatV2Transcript(rows: CaptureMessageRow[]): string {
  const lines = rows.map(formatTranscriptRow).filter((s): s is string => s !== null);
  if (lines.length === 0) {
    return '**Audit transcript:** (no v2 turns recorded — synthesizing from materials + catalog only)';
  }
  return ['**Audit transcript (chronological; each ASSISTANT turn lists the citations it relied on):**', ...lines].join('\n\n');
}

function buildV2SynthesisUserMessage(context: V2SynthesisContext): string {
  return [
    buildCaptureChatUserMessage(context.chatContext),
    '',
    '---',
    '',
    formatV2Transcript(context.transcript),
    '',
    '---',
    '',
    'Produce the Course Outcome Profile JSON now. Conform exactly to the',
    'schema. Score all five baseline foundational competencies (Agency,',
    'Attention to Detail, Resilience, Curiosity, Communication) plus any',
    'additional foundationals the materials evidence. Keep technical',
    'competencies in the 5–15 range. Above-zero scores require an evidence',
    'excerpt; foundationals must have null k_depth and u_depth. Populate',
    'citations[] verbatim from the assistant turns that established each',
    "finding, then derive source per the mechanical rule (instructor-only →",
    "'instructor', chunk-only → 'materials', mixed-or-empty → 'inferred').",
    'Emit productive_failure_conditions only if Audit Area 7 was probed.',
  ].join('\n');
}

/**
 * v2 synthesis: reads the v2 capture-synthesis prompt + the full session
 * transcript from capture_messages, emits a CaptureProfile with source +
 * citations on each finding. Same JSON schema shape as v1 modulo the optional
 * productive_failure_conditions block.
 */
export async function generateCaptureProfileV2(
  context: V2SynthesisContext,
): Promise<GenerateCaptureProfileResult> {
  const provider = await getProviderForFunction('capture-scores');
  const systemPrompt = await loadPrompt('capture-synthesis');
  const userMessage = buildV2SynthesisUserMessage(context);

  const result = await provider.complete<CaptureProfile>({
    systemPrompt,
    userMessage,
    schemaName: 'course_capture_profile_v2',
    // A9 (2026-06-12): v2 validation REQUIRES source + citations on every
    // competency (legacy schema stays loose for old snapshots) — a missing
    // provenance field fails validation and retries instead of slipping
    // through silently.
    jsonSchema: captureProfileJsonSchemaV2 as unknown as object,
    validate: (raw: unknown) => captureProfileSchemaV2.parse(raw),
  });

  return {
    // Provenance is derived, not self-reported: re-derive each competency's
    // `source` from its citation set so a "materials" claim with no
    // resolvable citations is honestly downgraded to 'inferred'.
    profile: withDerivedCompetencySources(result.data),
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
