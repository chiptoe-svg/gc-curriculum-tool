// Career target definition (hardcoded for M-trial; becomes DB row in M1)
export type KUDLevel = 'know' | 'understand' | 'do' | 'not_addressed';
export type Confidence = 'high' | 'medium' | 'low';
export type GapStatus = 'met' | 'underdeveloped' | 'missing';

export interface SubCompetency {
  id: string;                  // stable slug like "brand-positioning"
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
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
  subCompetencies: SubCompetency[];
}

// AI output shapes
export interface KUDOutcomes {
  description: string;
  know: string[];
  understand: string[];
  do: string[];
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
  upstreamEvidence: string;    // human-readable description of what upstream actually develops
  reasoning: string;
}

// The full result returned from /api/analyze
export interface UpstreamCourseAnalysis {
  courseLabel: string;
  kud: KUDOutcomes;
  coverage: CoverageScore[];
}

export interface AnalysisResult {
  upstreamChain: UpstreamCourseAnalysis[];  // ordered earliest → latest
  downstream: {
    courseLabel: string;
    kud: KUDOutcomes;
    coverage: CoverageScore[];
    prerequisiteCompetencies: PrerequisiteCompetencyClaim[];
    prerequisiteGaps: PrerequisiteGap[];
  };
  careerTargetId: string;
  meta: {
    aiProvider: string;
    aiModel: string;
    durationMs: number;
    costUsdCents: number;
  };
}
