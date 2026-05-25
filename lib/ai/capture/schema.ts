import { z } from 'zod';

/**
 * Course Outcome Profile schema for the CourseCapture flow.
 *
 * The profile is self-contained: it describes what a course actually develops
 * in students, with K/U/D depth ratings (0–5) on discovered technical
 * competencies plus the five baseline foundational competencies scored on D
 * only (Agency, Attention to Detail, Resilience, Curiosity, Communication).
 *
 * Foundational competencies score on Do only — K and U are always null.
 * d_depth = 0 with a rationale is valid for foundationals the course does not
 * develop; that's a meaningful signal, not missing data.
 *
 * Above-zero depth values must be backed by an evidence excerpt from the
 * course materials. Foundationals with d_depth = 0 may omit evidence_d.
 *
 * The depth-scale anchors live in lib/ai/prompts/shared/depth-scale.md so the
 * AI prompt and the human reviewer panel both read from one source.
 */

export const captureScaleVersion = 'v1' as const;
export type CaptureScaleVersion = typeof captureScaleVersion;

export const baselineFoundationalCompetencies = [
  'Agency',
  'Attention to Detail',
  'Resilience',
  'Curiosity',
  'Communication',
] as const;
export type BaselineFoundationalCompetency = (typeof baselineFoundationalCompetencies)[number];

const competencyTypeSchema = z.enum(['technical', 'foundational']);
export type CompetencyType = z.infer<typeof competencyTypeSchema>;

const depthSchema = z.number().int().min(0).max(5);

export const captureCompetencySchema = z
  .object({
    statement: z.string().min(1),
    type: competencyTypeSchema,
    k_depth: depthSchema.nullable(),
    u_depth: depthSchema.nullable(),
    d_depth: depthSchema,
    evidence_k: z.string().nullable(),
    evidence_u: z.string().nullable(),
    evidence_d: z.string().nullable(),
    rationale: z.string().min(1),
  })
  .refine(
    (c) => c.type !== 'foundational' || (c.k_depth === null && c.u_depth === null),
    { message: 'Foundational competencies must have null k_depth and u_depth.' },
  )
  .refine(
    (c) => c.k_depth === null || c.k_depth <= 1 || (c.evidence_k !== null && c.evidence_k.length > 0),
    { message: 'k_depth > 1 requires an evidence_k excerpt.' },
  )
  .refine(
    (c) => c.u_depth === null || c.u_depth === 0 || (c.evidence_u !== null && c.evidence_u.length > 0),
    { message: 'u_depth > 0 requires an evidence_u excerpt.' },
  )
  .refine(
    (c) => c.d_depth === 0 || (c.evidence_d !== null && c.evidence_d.length > 0),
    { message: 'd_depth > 0 requires an evidence_d excerpt.' },
  );
export type CaptureCompetency = z.infer<typeof captureCompetencySchema>;

export const captureAuditNotesSchema = z.object({
  prereq_gaps: z.array(z.string()),
  objective_misalignments: z.array(z.string()),
  cross_source_conflicts: z.array(z.string()),
  suggested_objective_revisions: z.array(z.string()),
});
export type CaptureAuditNotes = z.infer<typeof captureAuditNotesSchema>;

const depthOrNullSchema = z.number().int().min(0).max(5).nullable();

export const incomingExpectationSchema = z.object({
  statement: z.string().min(1),
  expected_depth: z.object({
    k: depthOrNullSchema,
    u: depthOrNullSchema,
    d: depthSchema,
  }),
  evidenced_by: z.array(z.string()).min(1),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type CaptureIncomingExpectation = z.infer<typeof incomingExpectationSchema>;

export const verificationSummarySchema = z.object({
  course_shape: z.string().min(1),
  strongest_evidence: z.array(z.string()).min(1).max(5),
  dimensional_patterns: z.array(z.string()).max(4),
  catalog_vs_evidence: z.array(z.string()).max(4),
  foundationals_glance: z.string().min(1),
});
export type CaptureVerificationSummary = z.infer<typeof verificationSummarySchema>;

export const captureProfileSchema = z.object({
  course_code: z.string().min(1),
  scale_version: z.literal(captureScaleVersion),
  generated_at: z.string(),
  competencies: z.array(captureCompetencySchema).min(1),
  incoming_expectations: z.array(incomingExpectationSchema).max(10),
  verification_summary: verificationSummarySchema,
  audit_notes: captureAuditNotesSchema,
  revised_objectives_draft: z.array(z.string()).nullable(),
});
export type CaptureProfile = z.infer<typeof captureProfileSchema>;

export type CaptureReviewerStatus = 'ai_drafted' | 'confirmed' | 'edited';

/**
 * The auditor returns this alongside its prose reply on every chat turn so
 * the instructor can decide when to stop the conversation. `score` is a
 * 0–100 self-assessment of how defensibly the profile could be generated
 * right now. `covered` and `remaining` are short labels (3–8 words each)
 * for what's locked in vs. still being probed.
 */
export const captureReadinessSchema = z.object({
  score: z.number().int().min(0).max(100),
  covered: z.array(z.string()),
  remaining: z.array(z.string()),
  good_enough_to_generate: z.boolean(),
});
export type CaptureReadiness = z.infer<typeof captureReadinessSchema>;

export const captureChatReplySchema = z.object({
  reply: z.string().min(1),
  readiness: captureReadinessSchema,
});
export type CaptureChatReply = z.infer<typeof captureChatReplySchema>;
