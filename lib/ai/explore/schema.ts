import { z } from 'zod';

/**
 * Target specs describe "what should be" — the goal a course is being
 * compared against. Two kinds in v1:
 *
 *   - custom:     instructor-defined KUD+ goals
 *   - downstream: union of incoming_expectations from courses that list
 *                 this course as a prereq
 *
 * Career-path mode is deliberately deferred until career-target data is
 * cleaned up; the schema doesn't model it.
 */

const depthSchema = z.number().int().min(0).max(5);
const depthOrNullSchema = depthSchema.nullable();

export const targetDepthSchema = z.object({
  k: depthOrNullSchema,
  u: depthOrNullSchema,
  d: depthSchema,
});
export type TargetDepth = z.infer<typeof targetDepthSchema>;

export const targetCompetencySchema = z.object({
  statement: z.string().min(1),
  type: z.enum(['technical', 'foundational']),
  target_depth: targetDepthSchema,
  rationale: z.string().min(1),
});
export type TargetCompetency = z.infer<typeof targetCompetencySchema>;

// kind: 'custom'
export const customTargetSpecSchema = z.object({
  kind: z.literal('custom'),
  competencies: z.array(targetCompetencySchema).min(1),
});
export type CustomTargetSpec = z.infer<typeof customTargetSpecSchema>;

// kind: 'downstream'
export const downstreamCourseEntrySchema = z.object({
  code: z.string(),
  title: z.string(),
  snapshot_id: z.string().uuid(),
  // Copy of that snapshot's incoming_expectations at build time, so the
  // analysis is reproducible even if downstream snapshots change later.
  incoming_expectations: z.array(z.object({
    statement: z.string(),
    expected_depth: targetDepthSchema,
    evidenced_by: z.array(z.string()),
    confidence: z.enum(['high', 'medium', 'low']),
  })),
});
export type DownstreamCourseEntry = z.infer<typeof downstreamCourseEntrySchema>;

export const downstreamTargetSpecSchema = z.object({
  kind: z.literal('downstream'),
  courses: z.array(downstreamCourseEntrySchema).min(1),
});
export type DownstreamTargetSpec = z.infer<typeof downstreamTargetSpecSchema>;

export const targetSpecSchema = z.discriminatedUnion('kind', [
  customTargetSpecSchema,
  downstreamTargetSpecSchema,
]);
export type TargetSpec = z.infer<typeof targetSpecSchema>;

// ----- Analysis output (from the comparator) -----

export const alignmentRowSchema = z.object({
  target_statement: z.string(),
  matched_snapshot_competency: z.string().nullable(),
  target_depth: targetDepthSchema,
  snapshot_depth: targetDepthSchema.nullable(),
  status: z.enum(['covered', 'partial', 'underdeveloped', 'missing']),
  delta_notes: z.string(),
});
export type AlignmentRow = z.infer<typeof alignmentRowSchema>;

export const recommendationSchema = z.object({
  priority: z.number().int().min(1),
  change: z.string().min(1),
  impact: z.string().min(1),
  would_affect: z.array(z.object({
    competency: z.string(),
    from_depth: targetDepthSchema,
    to_depth: targetDepthSchema,
  })),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const exploreAnalysisSchema = z.object({
  snapshot_id: z.string(),
  target_spec_id: z.string(),
  generated_at: z.string(),
  alignment: z.array(alignmentRowSchema),
  recommendations: z.array(recommendationSchema).min(0).max(4),
  audit_notes: z.object({
    gaps_addressed_by_recommendations: z.array(z.string()),
    gaps_not_addressed: z.array(z.string()),
    strengths_relative_to_target: z.array(z.string()),
  }),
});
export type ExploreAnalysis = z.infer<typeof exploreAnalysisSchema>;
