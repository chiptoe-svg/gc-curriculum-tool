import { z } from 'zod';

/**
 * K/U/D depth triple for a single competency.
 *
 * `k` and `u` are nullable: foundational competencies (Agency, Attention to Detail,
 * Resilience, Curiosity, Communication) score on Do only — K/U are stored as null per the
 * KUD+ framework rather than zero (zero would imply the course tried and failed to develop
 * those dimensions). `d` is always present (non-nullable) for every competency kind.
 *
 * Note: `incomingDemandSchema` intentionally differs — all three dimensions are nullable
 * there, because a prerequisite expectation may be unknown on any dimension.
 */
export const kudSchema = z.object({
  k: z.number().int().min(0).max(5).nullable(),
  u: z.number().int().min(0).max(5).nullable(),
  d: z.number().int().min(0).max(5),
});

export const incomingDemandSchema = z.object({
  label: z.string().min(1),
  subCompetencyId: z.string().nullable(),
  k: z.number().int().min(0).max(5).nullable(),
  u: z.number().int().min(0).max(5).nullable(),
  d: z.number().int().min(0).max(5).nullable(),
});

export const changeObjectSchema = z.object({
  prose: z.string().min(1),
  activity: z.string().min(1),
  artifact: z.enum(['graded', 'ungraded', 'formative', 'none']),
  competencies: z.array(z.string().min(1)),
  rubricCriteria: z.array(z.string().min(1)),
  assumesIncoming: z.array(incomingDemandSchema),
});

export const predictedDeltaSchema = z.object({
  competency: z.string().min(1),
  from: kudSchema,
  to: kudSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  rationale: z.string().min(1),
});

export const rippleLineSchema = z.object({
  kind: z.enum(['downstream_gap', 'upstream_gap', 'career_fit']),
  // Intentionally `.nullable().optional()`: `career_fit` lines may reference no specific
  // course/sub-comp; `downstream_gap` lines are produced without a `courseCode` (stamped
  // later by the orchestrator), so absent-or-null are both valid.
  courseCode: z.string().nullable().optional(),
  subCompetencyId: z.string().nullable().optional(),
  label: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1),
});

export const scenarioSchema = z.object({
  id: z.string().min(1),
  courseCode: z.string().min(1),
  baselineSnapshotId: z.string().min(1),
  change: changeObjectSchema,
  predictedDeltas: z.array(predictedDeltaSchema),
  computedRipple: z.array(rippleLineSchema),
  agentNotes: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type Kud = z.infer<typeof kudSchema>;
export type ChangeObject = z.infer<typeof changeObjectSchema>;
export type PredictedDelta = z.infer<typeof predictedDeltaSchema>;
export type RippleLine = z.infer<typeof rippleLineSchema>;
export type IncomingDemand = z.infer<typeof incomingDemandSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
