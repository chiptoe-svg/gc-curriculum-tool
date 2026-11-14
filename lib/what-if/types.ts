// Shared types for what-ifs (design: docs/superpowers/specs/2026-11-13-what-if-course-changes-design.md).
export type Kud = { k: number | null; u: number | null; d: number | null };
export type Confidence = 'low' | 'medium' | 'high';
export type OwnerKind = 'personal' | 'department';
export interface PredictedSubCompDepth { subCompetencyId: string; k: number | null; u: number | null; d: number | null }

export interface WhatIfEstimate {
  changeItems: Array<{ kind: 'added' | 'removed' | 'changed'; description: string }>;
  movedRatings: Array<{ statement: string; after: Kud; confidence: Confidence; reason: string }>;
  newCompetencies: Array<{ statement: string; type: 'technical' | 'foundational'; predicted: Kud;
    subCompetencyId: string | null; confidence: Confidence; reason: string }>;
  incomingChanges: Array<{ kind: 'new' | 'raised' | 'dropped'; statement: string;
    expected: Kud | null; subCompetencyId: string | null }>;
}

export interface WhatIfRating {
  statement: string;
  type: 'technical' | 'foundational';
  status: 'approved' | 'moved' | 'new';
  kud: Kud;                        // what the page shows
  before: Kud | null;              // approved values; null when status is 'new'
  confidence: Confidence | null;   // null when status is 'approved'
  reason: string | null;
  subCompetencyId: string | null;  // set only for a linked 'new' rating
  linked: boolean;                 // false for a 'new' rating with no valid catalog link
}
export interface WhatIfProfile {
  ratings: WhatIfRating[];
  incomingChanges: Array<WhatIfEstimate['incomingChanges'][number] & { linked: boolean }>;
}

export interface KnockOn {
  laterCourses: Array<{ courseCode: string; subCompetencyId: string; label: string; effect: 'closed' | 'opened' }>;
  earlierCourses: Array<{ statement: string; label: string | null;
    status: 'met' | 'not_met' | 'not_known'; deliveredBy: string[] }>;
  careerTargets: Array<{ targetName: string; label: string; before: string; after: string; direction: 'up' | 'down' }>;
  notComputed: string[];           // statements for which no effects could be computed
}
export interface WhatIfProse { description: string; whatChanges: string; neighbors: string; questions: string[] }

export type UsageKind = 'chat' | 'quick_estimate' | 'estimate' | 'page';
export type WhatIfUsage = Partial<Record<UsageKind,
  { calls: number; costUsdCents: number; promptTokens: number; completionTokens: number }>>;
