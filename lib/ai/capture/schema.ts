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

// ---------------------------------------------------------------------------
// v2 source attribution — added in Stage 4, optional for backward-compat.
// Pre-v2 profiles (no source/citations) remain valid; v2 synthesis populates
// these fields when it has multi-source evidence to track.
// ---------------------------------------------------------------------------

export const CaptureProfileSource = z.enum(['instructor', 'materials', 'inferred']);
export type CaptureProfileSourceType = z.infer<typeof CaptureProfileSource>;

// chunkId / messageId now accept null in addition to undefined — OpenAI
// strict-mode JSON schema can't encode "optional," so the model emits
// null for the unused slot. See lib/ai/analyze/capture-scores.ts
// CITATIONS_ARRAY for the corresponding JSON schema shape.
//
// Provenance discipline (tightened 2026-06-03): every citation MUST resolve
// to a real source. A chunk citation requires a chunkId; an instructor
// citation requires a real messageId (either the full UUID stored in
// capture_messages.id, or the 8-char hex prefix the synthesis transcript
// exposes via `id=<prefix>` — both lookup paths work via getMessageById).
// The "excerpt alone is enough" allowance was a synthesizer-side escape
// that masked hallucinated citations as ground-truth; rejected here at
// validate-time. Findings that can't be grounded in a real chunk/turn
// shouldn't be made.
//
// Synthetic positional ids (`user_3`, `turn_5`, `msg_2`, etc.) fail both
// shape tests below and are rejected.
const FULL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_HEX_RE = /^[0-9a-f]{8}$/i;
export const CaptureProfileCitation = z.object({
  type: z.enum(['chunk', 'instructor']),
  chunkId: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  excerpt: z.string().max(200),
}).superRefine((c, ctx) => {
  if (c.type === 'chunk') {
    if (typeof c.chunkId !== 'string' || c.chunkId.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'chunk citation requires a chunkId — excerpt-only citations are not allowed (would mask hallucinated provenance)',
      });
    }
    return;
  }
  // type === 'instructor' — messageId must be a UUID or its 8-char hex
  // prefix (the form the transcript exposes to the synthesizer).
  const ok = typeof c.messageId === 'string'
    && (FULL_UUID_RE.test(c.messageId) || SHORT_HEX_RE.test(c.messageId));
  if (!ok) {
    ctx.addIssue({
      code: 'custom',
      message: 'instructor citation requires a real messageId (full UUID or 8-char hex prefix as shown in the transcript) — synthetic ids like "user_3" are not allowed',
    });
  }
});
export type CaptureProfileCitationType = z.infer<typeof CaptureProfileCitation>;
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
    source: CaptureProfileSource.optional(),
    citations: z.array(CaptureProfileCitation).optional(),
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

const productiveFailureConditionEnum = z.enum(['present', 'partial', 'absent']);

// Productive-failure conditions probed in Audit Area 7 of the capture chat.
// Surfaces the course's pedagogical structure (not the K/U/D depths) so the
// program-level problem-solving lens and scaffolding analysis can aggregate
// across snapshots. Conditions are graded, not binary — see capture-scores.md
// and docs/background.html §8 for the reasoning.
export const productiveFailureConditionsSchema = z.object({
  generate_then_consolidate: productiveFailureConditionEnum,
  open_ended_problems: productiveFailureConditionEnum,
  revision_cycles: productiveFailureConditionEnum,
  structured_post_mortem: productiveFailureConditionEnum,
  // Required when structured_post_mortem is above 'absent' (see superRefine).
  // Nullable for OpenAI strict-mode; the model emits null when reflection is
  // 'absent'. Mirrors the evidence-above-zero discipline on K/U/D.
  structured_post_mortem_evidence: z.array(CaptureProfileCitation).nullable().optional(),
  max_supporting_depth: z.number().int().min(0).max(5),
  notes: z.array(z.string()),
}).superRefine((pf, ctx) => {
  if (pf.structured_post_mortem !== 'absent') {
    const ev = pf.structured_post_mortem_evidence;
    if (!ev || ev.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['structured_post_mortem_evidence'],
        message: 'structured_post_mortem above "absent" requires at least one resolvable citation (mirrors the K/U/D evidence-above-zero rule). With no graded post-mortem artifact to cite, rate it "absent".',
      });
    }
  }
});
export type ProductiveFailureConditions = z.infer<typeof productiveFailureConditionsSchema>;

export const captureAuditNotesSchema = z.object({
  prereq_gaps: z.array(z.string()),
  objective_misalignments: z.array(z.string()),
  cross_source_conflicts: z.array(z.string()),
  suggested_objective_revisions: z.array(z.string()),
  // PRESENCE CONTRACT (authoritative): null/omitted ⇒ Audit Area 7 was NOT
  // assessed ("no data"); a PRESENT block ⇒ assessed, and its conditions are
  // real judgments — an 'absent' condition then means "we looked, there's
  // none", NOT "not probed". Downstream scoring treats null as a distinct
  // no-data state (excluded from rollups), never as 0. Snapshots created
  // before PF_CONTRACT_EPOCH are reclassified to no-data (their pre-fix block
  // may be fabricated-absent).
  productive_failure_conditions: productiveFailureConditionsSchema.nullable().optional(),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
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
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureIncomingExpectation = z.infer<typeof incomingExpectationSchema>;

/**
 * One entry in the `course_emphasis` ranking. Attributes graded-work points
 * to a competency so faculty can see which competencies the course
 * actually weights through point allocation (independent of depth scoring,
 * which measures student capability per competency).
 */
export const courseEmphasisItemSchema = z.object({
  /** The competency statement this entry attributes points to. Must match (or paraphrase closely to) one of the entries in the `competencies` array. */
  competency: z.string().min(1),
  /** Total graded-work points attributed to this competency across all assignments + rubric criteria evidencing it. */
  points: z.number().int().min(0),
  /** Share of total attributed points (0–100). Sum across all entries should be ~100. */
  share_pct: z.number().int().min(0).max(100),
  /** Derived from share_pct: ≥20% = central, 5–19% = supporting, <5% = peripheral. */
  centrality: z.enum(['central', 'supporting', 'peripheral']),
});
export type CaptureCourseEmphasisItem = z.infer<typeof courseEmphasisItemSchema>;

export const verificationSummarySchema = z.object({
  course_shape: z.string().min(1),
  strongest_evidence: z.array(z.string()).min(1).max(5),
  dimensional_patterns: z.array(z.string()).max(4),
  catalog_vs_evidence: z.array(z.string()).max(4),
  foundationals_glance: z.string().min(1),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureVerificationSummary = z.infer<typeof verificationSummarySchema>;

export const courseOverviewSchema = z.object({
  /** 2-3 paragraphs, conversational. "In this course, students…" voice. */
  narrative: z.string().min(40),
  /** 3-7 single-line bullets capturing course character (pedagogy, format, distinctive choices). */
  at_a_glance: z.array(z.string().min(3)).min(3).max(7),
  /** 1-line target student description. "Designed for juniors heading into the brand-strategy track." */
  who_for: z.string().min(10),
  /** 1-2 sentence semester trajectory. "Students start by X, then Y, finally Z." */
  arc: z.string().min(20),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureCourseOverview = z.infer<typeof courseOverviewSchema>;

export const captureProfileSchema = z.object({
  course_code: z.string().min(1),
  scale_version: z.literal(captureScaleVersion),
  generated_at: z.string(),
  // Nullable for backward compat: snapshots taken before 2026-05-31 won't have it.
  // V2 captures always populate it; v1 captures get null and the Review panel
  // shows a "this is a legacy snapshot — re-audit to add an overview" hint.
  overview: courseOverviewSchema.nullable().optional(),
  competencies: z.array(captureCompetencySchema).min(1),
  incoming_expectations: z.array(incomingExpectationSchema).max(10),
  verification_summary: verificationSummarySchema,
  audit_notes: captureAuditNotesSchema,
  revised_objectives_draft: z.array(z.string()).nullable(),
  /**
   * Point-weight ranking of competencies — what the course actually emphasizes
   * through graded work (independent of K/U/D depth, which measures student
   * capability). Helps faculty see when stated importance diverges from
   * actual point allocation. Sort desc by `points`. Centrality is auto-
   * derived from `share_pct`: ≥20% = central, 5–19% = supporting, <5% =
   * peripheral. Nullable because pre-2026-06-03 profiles don't have this
   * field, and courses without per-assignment point values can legitimately
   * be empty.
   */
  course_emphasis: z.array(courseEmphasisItemSchema).nullable(),
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
