// A course's catalog levels from its skills, links and roll-ups (spec 2026-11-15-skill-competency-links-design.md).
// Skills are never changed: a competency's level is the roll-up stored for it (AI or faculty), else the highest
// linked skill, dimension by dimension. A link counts unless it is rejected; a skill with no counting link is
// reported as unmapped. Pure.
import type { CompetencyDepth, LinkedSkill, Skill } from './types';

export interface LinkRow { skillRef: string; competencyId: string; source: LinkedSkill['source']; status: LinkedSkill['status']; similarity: number | null }
export interface RollupRow { competencyId: string; k: number | null; u: number | null; d: number | null; method: 'ai' | 'faculty'; rationale: string | null }

const maxN = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

export function rollUp(
  skills: readonly Skill[], links: readonly LinkRow[], rollups: readonly RollupRow[], foundational: ReadonlySet<string>,
): { depths: CompetencyDepth[]; unmapped: Skill[] } {
  const byRef = new Map(skills.map(s => [s.skillRef, s]));
  const live = links.filter(l => l.status !== 'rejected' && byRef.has(l.skillRef));
  const byComp = new Map<string, LinkRow[]>();
  for (const l of live) byComp.set(l.competencyId, [...(byComp.get(l.competencyId) ?? []), l]);
  const stored = new Map(rollups.map(r => [r.competencyId, r]));
  const ids = new Set([...byComp.keys(), ...stored.keys()]);
  const depths: CompetencyDepth[] = [];
  for (const id of ids) {
    const ls = byComp.get(id) ?? [];
    const linked: LinkedSkill[] = ls.map(l => ({ ...byRef.get(l.skillRef)!, source: l.source, status: l.status, similarity: l.similarity }));
    const r = stored.get(id);
    let k: number | null = null, u: number | null = null, d: number | null = null;
    if (r) ({ k, u, d } = r);
    else for (const s of linked) { k = maxN(k, s.k); u = maxN(u, s.u); d = maxN(d, s.d); }
    if (foundational.has(id)) { k = null; u = null; }
    // A trait-only skill (no Do level) linked to a full competency still says something only through K and U.
    if (d == null && k == null && u == null) continue;
    depths.push({
      competencyId: id, k, u, d, links: linked, method: r?.method ?? 'max', rationale: r?.rationale ?? null,
      soft: !r && linked.length > 0 && linked.every(s => s.status === 'proposed'),
    });
  }
  const mapped = new Set(live.map(l => l.skillRef));
  return { depths, unmapped: skills.filter(s => !mapped.has(s.skillRef)) };
}
