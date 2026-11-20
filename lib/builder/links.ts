// A course's catalog levels and the skills behind them (spec 2026-11-20-links-drive-coverage-design.md).
// Skills are never changed. Levels come from competency_levels (faculty level, else AI level, else the scorer's
// level unless faculty rejected every link, else 'needs_level'); this attaches the links that count toward each
// competency and lists the skills with no counting link and the embedding suggestions. A link counts when it is
// confirmed, or proposed by a judgment (the scorer, an AI judge, faculty). An embedding match alone is only a
// suggestion and does not count until someone confirms it (background §11). Pure.
import type { CompetencyDepth, LevelMethod, LinkedSkill, Skill } from './types';

export interface LinkRow { skillRef: string; competencyId: string; source: LinkedSkill['source']; status: LinkedSkill['status']; similarity: number | null }
export interface LevelRow { competencyId: string; k: number | null; u: number | null; d: number; method: LevelMethod; rationale: string | null; source: string | null }

export function rollUp(
  skills: readonly Skill[], links: readonly LinkRow[], levels: readonly LevelRow[],
): { depths: CompetencyDepth[]; unmapped: Skill[]; suggestions: Array<LinkedSkill & { competencyId: string }> } {
  const byRef = new Map(skills.map(s => [s.skillRef, s]));
  const counts = (l: LinkRow) => l.status === 'confirmed' || (l.status === 'proposed' && l.source !== 'embedding');
  const live = links.filter(l => counts(l) && byRef.has(l.skillRef));
  const byComp = new Map<string, LinkRow[]>();
  for (const l of live) byComp.set(l.competencyId, [...(byComp.get(l.competencyId) ?? []), l]);
  const depths: CompetencyDepth[] = levels.map(v => {
    const linked: LinkedSkill[] = (byComp.get(v.competencyId) ?? []).map(l => ({ ...byRef.get(l.skillRef)!, source: l.source, status: l.status, similarity: l.similarity }));
    return {
      competencyId: v.competencyId, k: v.k, u: v.u, d: v.d, source: v.source, links: linked, method: v.method,
      rationale: v.method === 'faculty' || v.method === 'ai' ? v.rationale : null,
      soft: v.method === 'scoring' && linked.length > 0 && linked.every(s => s.status === 'proposed'),
    };
  });
  const mapped = new Set(live.map(l => l.skillRef));
  const suggestions = links
    .filter(l => l.status === 'proposed' && l.source === 'embedding' && byRef.has(l.skillRef))
    .map(l => ({ ...byRef.get(l.skillRef)!, source: l.source, status: l.status, similarity: l.similarity, competencyId: l.competencyId }))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  return { depths, unmapped: skills.filter(s => !mapped.has(s.skillRef)), suggestions };
}
