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
    // Per-dimension plain-language "what this level looks like here" sentences,
    // authored by the scorer. nullable → OpenAI strict-mode / foundational K/U;
    // optional → pre-feature snapshots that predate the field.
    k_says: z.string().nullable().optional(),
    u_says: z.string().nullable().optional(),
    d_says: z.string().nullable().optional(),
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
// Conditions: generate_then_consolidate, open_ended_problems, revision_cycles,
// structured_post_mortem (probe d), abstraction_bridging (probe e, added
// 2026-06-14) — the transfer-conversion condition (can students apply a
// principle across varied surface forms to a genuinely new context?).
export const productiveFailureConditionsSchema = z.object({
  generate_then_consolidate: productiveFailureConditionEnum,
  open_ended_problems: productiveFailureConditionEnum,
  revision_cycles: productiveFailureConditionEnum,
  structured_post_mortem: productiveFailureConditionEnum,
  // Required when structured_post_mortem is above 'absent' (see superRefine).
  // Nullable for OpenAI strict-mode; the model emits null when reflection is
  // 'absent'. Mirrors the evidence-above-zero discipline on K/U/D.
  structured_post_mortem_evidence: z.array(CaptureProfileCitation).nullable().optional(),
  // Transfer-conversion condition (Audit Area 7 probe e, added 2026-06-14).
  // OPTIONAL in Zod so pre-feature immutable snapshots (which lack the key)
  // still parse — a missing field reads as "not assessed for this condition",
  // never as 'absent'. New captures always emit it (the strict request schema
  // marks it required). Evidence required when non-absent, mirroring post-mortem.
  abstraction_bridging: productiveFailureConditionEnum.optional(),
  abstraction_bridging_evidence: z.array(CaptureProfileCitation).nullable().optional(),
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
  if (pf.abstraction_bridging !== undefined && pf.abstraction_bridging !== 'absent') {
    const ev = pf.abstraction_bridging_evidence;
    if (!ev || ev.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['abstraction_bridging_evidence'],
        message: 'abstraction_bridging above "absent" requires at least one resolvable citation (mirrors the K/U/D evidence-above-zero rule). With no graded artifact showing abstraction across varied cases applied to a new context, rate it "absent".',
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

// ---------------------------------------------------------------------------
// Class structure — weekly rhythm, topic list, grading overview
// Added 2026-06-08. Nullable/optional for backward-compat: pre-2026-06-08
// snapshots won't have it. Populated by v3+ synthesis; null means "not yet
// captured" — falls back to sheet/catalog data at wiki-render time.
// ---------------------------------------------------------------------------
export const classStructureSchema = z.object({
  /** Ordered list of the units / topic areas / lab subjects covered. */
  topics: z.array(z.string().min(1)).min(1),
  /**
   * The weekly rhythm / meeting format, e.g.
   * "weekly 2-hour lab + 1-hour lecture" or "twice-weekly studio sessions".
   */
  cadence: z.string().min(5),
  /**
   * Plain-prose grading overview, e.g.
   * "Three tests, two major projects, a cumulative final, plus weekly graded labs."
   * Prose only — no numeric sub-object. Emit "Graded; breakdown not documented."
   * rather than null when the course is clearly graded but breakdown is absent.
   */
  assessment: z.string().min(10),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureClassStructure = z.infer<typeof classStructureSchema>;

// ---------------------------------------------------------------------------
// Major project item — one major graded project in the course
// ---------------------------------------------------------------------------
export const majorProjectItemSchema = z.object({
  /** Short human-readable title, e.g. "Brand Color Report" or "Prepress Packaging Spec". */
  title: z.string().min(1),
  /** 1-3 sentences describing what students produce and what they decide. */
  description: z.string().min(10),
  /**
   * The competency statements this project develops.
   * Must match or paraphrase entries in the profile's `competencies` array.
   * Projects ARE the evidence for K/U/D scores; linking them closes the loop.
   */
  competencies: z.array(z.string().min(1)).min(1),
  /** Concrete list of what students hand in (files, documents, artifacts). Optional on legacy snapshots. */
  deliverables: z.array(z.string().min(1)).optional(),
  /** 1-2 sentences on why this project is formative for students. Optional on legacy snapshots. */
  what_it_develops: z.string().min(1).max(500).optional(),
  /** Portion of course grade (0–100). Null when not determinable from materials. Optional on legacy snapshots. */
  weight_pct: z.number().min(0).max(100).nullable().optional(),
  /** Approximate span in whole weeks. Null when not determinable. Optional on legacy snapshots. */
  duration_weeks: z.number().int().min(1).nullable().optional(),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureProjectItem = z.infer<typeof majorProjectItemSchema>;

/**
 * A faculty override of one competency's K/U/D scores recorded at review time:
 * what changed (AI value → faculty value, per dimension) and why. Frozen into
 * the snapshot as a permanent audit record. See
 * docs/superpowers/specs/2026-06-16-kud-override-rationale-design.md.
 */
export const reviewerOverrideSchema = z.object({
  statement: z.string(),
  changes: z.array(z.object({
    dim: z.enum(['k', 'u', 'd']),
    from: z.number(),
    to: z.number(),
  })).min(1),
  reason: z.string().min(1),
});
export type ReviewerOverride = z.infer<typeof reviewerOverrideSchema>;

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
  /**
   * Weekly rhythm, topic list, and grading overview.
   * Nullable: pre-2026-06-08 snapshots won't have it.
   * Populated by v3+ synthesis; null means "not yet captured" — falls back to
   * sheet/catalog data at wiki-render time.
   */
  class_structure: classStructureSchema.nullable().optional(),
  /**
   * Faculty rationales for any upward K/U/D override made at review time.
   * Nullable/optional: pre-2026-06-16 profiles + profiles with no upward edits
   * won't have it. Populated by ProfileReviewPanel at save; frozen into snapshots.
   */
  reviewer_overrides: z.array(reviewerOverrideSchema).nullable().optional(),
  /**
   * Major graded projects in the course.
   * Nullable: pre-2026-06-08 snapshots won't have it.
   * When null at wiki-render time, falls back to sheet `majorProjects[]` list
   * labeled "from the course sheet — not yet captured."
   */
  major_projects: z.array(majorProjectItemSchema).nullable().optional(),
});
export type CaptureProfile = z.infer<typeof captureProfileSchema>;

// ---------------------------------------------------------------------------
// V2 synthesis variant (A9, 2026-06-12): provenance is REQUIRED on every
// competency. The base schema keeps source/citations optional for legacy
// snapshots (pre-Stage-4 captures have neither); the v2 synthesis path —
// the only live path — must not produce new findings without them. A v2
// result missing either fails validation and retries, turning a silent
// provenance gap into a visible one. `citations` may be EMPTY (a genuinely
// inferred finding has none); post-parse, `withDerivedCompetencySources`
// re-derives `source` from the citation set so the flag can't be misclaimed.
// ---------------------------------------------------------------------------
export const captureCompetencySchemaV2 = captureCompetencySchema.superRefine((c, ctx) => {
  if (c.source === undefined) {
    ctx.addIssue({ code: 'custom', message: 'v2 findings must carry a source flag (instructor | materials | inferred)' });
  }
  if (c.citations === undefined) {
    ctx.addIssue({ code: 'custom', message: 'v2 findings must carry a citations array (empty is allowed only for inferred findings)' });
  }
  if (c.source !== undefined && c.source !== 'inferred' && (c.citations === undefined || c.citations.length === 0)) {
    ctx.addIssue({ code: 'custom', message: `source '${c.source}' requires at least one resolvable citation — with none, the finding is 'inferred'` });
  }
});

export const captureProfileSchemaV2 = captureProfileSchema.extend({
  competencies: z.array(captureCompetencySchemaV2).min(1),
});

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
