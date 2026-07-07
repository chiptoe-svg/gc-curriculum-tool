export interface NeighborCompetency { statement: string; type: 'technical' | 'foundational'; k_depth: number | null; u_depth: number | null; d_depth: number; }
export interface NeighborIncoming { statement: string; expected_depth: { k: number | null; u: number | null; d: number }; }
export interface NeighborProfile { courseCode: string; competencies: NeighborCompetency[]; incoming_expectations: NeighborIncoming[]; }
export interface EdgePair { relyingCourseCode: string; prereqCourseCode: string; }

export interface NeighborContext {
  focal: NeighborProfile;
  upstream: NeighborProfile[];   // courses the focal relies on
  downstream: NeighborProfile[]; // courses that rely on the focal
}

export function assembleNeighborContext(input: {
  focalCourseCode: string;
  profiles: Record<string, NeighborProfile>;
  edgePairs: EdgePair[];
}): NeighborContext {
  const focal = input.profiles[input.focalCourseCode];
  if (!focal) throw new Error(`no profile for focal course ${input.focalCourseCode}`);
  const upstreamCodes = new Set(input.edgePairs.filter(e => e.relyingCourseCode === input.focalCourseCode).map(e => e.prereqCourseCode));
  const downstreamCodes = new Set(input.edgePairs.filter(e => e.prereqCourseCode === input.focalCourseCode).map(e => e.relyingCourseCode));
  const pick = (codes: Set<string>) => [...codes].map(c => input.profiles[c]).filter((p): p is NeighborProfile => !!p);
  return { focal, upstream: pick(upstreamCodes), downstream: pick(downstreamCodes) };
}
