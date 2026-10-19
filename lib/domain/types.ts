// Career target definition (hardcoded for M-trial; becomes DB row in M1)
export type KUDLevel = 'know' | 'understand' | 'do' | 'not_addressed';

// Course-level entry requirement, AI-derived from the focal course's KUDs.
// Replaces career-target sub-competencies in the prereq analyzer pipeline.
export interface CoursePrereqCompetency {
  id: string;                                          // AI-generated slug, e.g. "prereq_color_science"
  name: string;
  expectedKudLevel: Exclude<KUDLevel, 'not_addressed'>;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
}
export type Confidence = 'high' | 'medium' | 'low';
export type GapStatus = 'met' | 'underdeveloped' | 'missing';
export type ScaffoldingQuality = 'strong' | 'adequate' | 'brittle' | 'weak' | 'absent';

export interface SubCompetency {
  id: string;                  // stable slug like "brand-positioning"
  name: string;
  knowDescriptor: string | null;       // null for foundational (D-only) competencies
  understandDescriptor: string | null; // null for foundational (D-only) competencies
  doDescriptor: string;
}

/**
 * P0b (competency catalog): one competency can now be required by several
 * career targets (e.g. domain-knowledge after the gc-production-literacy /
 * domain-grounding merges, migration 0057). Exactly one target carries the
 * full definition; every other target that needs the same competency lists
 * a `{ ref }` pointing at that id instead of repeating the definition.
 */
export type TargetCompetencyEntry = SubCompetency | { ref: string };

/** True for a full definition entry (not a `{ ref }` pointer). */
export function isSubCompetencyDefinition(entry: TargetCompetencyEntry): entry is SubCompetency {
  return !('ref' in entry);
}

/** The catalog competency id this entry resolves to, whether definition or ref. */
export function competencyEntryId(entry: TargetCompetencyEntry): string {
  return isSubCompetencyDefinition(entry) ? entry.id : entry.ref;
}

export interface CareerTarget {
  id: string;                  // "account-management" | "brand-strategy" | ...
  name: string;
  shortDefinition: string;
  industryContexts: string[];
  knowDescriptors: string[];
  understandDescriptors: string[];
  doDescriptors: string[];
  defensibilityNote: string;
  socCode: string | null;      // SOC code if anchored to O*NET
  subCompetencies: TargetCompetencyEntry[];
}

// AI output shapes
export interface KUDOutcomes {
  description: string;
  know: string[];
  understand: string[];
  do: string[];
}

export interface CourseKudResult {
  thresholdConcept: string;
  know: string[];
  understand: string[];
  do: string[];
  confidenceNotes: string;
}

export interface CoverageScore {
  subCompetencyId: string;
  kudLevel: KUDLevel;
  confidence: Confidence;
  reasoning: string;
}

export interface PrerequisiteCompetencyClaim {
  subCompetencyId: string;
  expectedKudLevel: Exclude<KUDLevel, 'not_addressed'>;
  rationale: string;
}

export interface PrerequisiteGap {
  subCompetencyId: string;
  expectedKudLevel: Exclude<KUDLevel, 'not_addressed'>;
  status: GapStatus;
  priorCourseworkEvidence: string;    // human-readable description of what the prior coursework actually develops
  reasoning: string;
}

export interface ScaffoldingScore {
  subCompetencyId: string;
  quality: ScaffoldingQuality;
  reasoning: string;
}

// The full result returned from /api/analyze
export interface PriorCourseAnalysis {
  courseLabel: string;
  kud: KUDOutcomes;
  coverage: CoverageScore[];
}

export interface AnalysisResult {
  priorCoursework: PriorCourseAnalysis[];  // all prior/prerequisite courses
  course: {
    courseLabel: string;
    kud: KUDOutcomes;
    prerequisiteGaps: PrerequisiteGap[];
  };
  prereqCompetencies: CoursePrereqCompetency[];  // AI-derived entry requirements for the focal course
  scaffolding: ScaffoldingScore[];   // one entry per prereq competency — judges how the prior courses collectively scaffold it
  meta: {
    aiProvider: string;
    aiModel: string;
    durationMs: number;
    costUsdCents: number;
    cachedTokens: number;
    uncachedTokens: number;
    completionTokens: number;
  };
}

export interface TargetChainCourseAnalysis {
  courseLabel: string;
  kud: KUDOutcomes;
  coverage: CoverageScore[];
}

export interface TargetChainAnalysisResult {
  careerTargetId: string;
  courses: TargetChainCourseAnalysis[];   // sorted by level ascending, then by label
  scaffolding: ScaffoldingScore[];
  meta: {
    aiProvider: string;
    aiModel: string;
    durationMs: number;
    costUsdCents: number;
    cachedTokens: number;
    uncachedTokens: number;
    completionTokens: number;
  };
}
