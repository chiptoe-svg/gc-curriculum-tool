/**
 * Project → course skill → catalog competency → O*NET items (spec
 * docs/superpowers/specs/2026-10-22-project-skill-trail-design.md). Pure.
 * Links 1–2 are an exact join on normalized statement text; which competency a
 * statement feeds is the coverage scorer's decision (matched_competency).
 */
import { cosineSimilarity } from '@/lib/ai/embeddings';

export const TRAIL_SIMILARITY_FLOOR = 0.5;
export const TRAIL_TOP_N = 3;

export function normalizeStatement(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface TrailCell { competencyId: string; competencyName: string; matched: string; k: number | null; u: number | null; d: number }
export interface TrailItem { label: string; source: 'onet_element' | 'onet_task'; provisional: boolean; similarity: number }
export interface TrailSkill { statement: string; competencies: Array<{ id: string; name: string; k: number | null; u: number | null; d: number; onet: TrailItem[] }> }
export interface TrailProject { title: string; skills: TrailSkill[] }
export interface Candidate { label: string; source: 'onet_element' | 'onet_task'; provisional: boolean; vector: number[] }

export function buildProjectTrail(input: {
  projects: unknown; statements: string[]; cells: TrailCell[];
  nearest: (statement: string, competencyId: string) => TrailItem[];
}): TrailProject[] {
  if (!Array.isArray(input.projects)) return [];
  const canonical = new Map(input.statements.map(s => [normalizeStatement(s), s]));
  const cellsBy = new Map<string, TrailCell[]>();
  for (const c of input.cells) {
    const k = normalizeStatement(c.matched);
    const a = cellsBy.get(k);
    if (a) a.push(c); else cellsBy.set(k, [c]);
  }
  const out: TrailProject[] = [];
  for (const p of input.projects as Array<{ title?: unknown; competencies?: unknown }>) {
    if (!p || typeof p.title !== 'string') continue;
    const named = Array.isArray(p.competencies) ? p.competencies.filter((x): x is string => typeof x === 'string') : [];
    const skills: TrailSkill[] = named.map(raw => {
      const key = normalizeStatement(raw);
      const statement = canonical.get(key) ?? raw.trim();
      const competencies = (cellsBy.get(key) ?? [])
        .slice().sort((a, b) => a.competencyId.localeCompare(b.competencyId))
        .map(c => ({ id: c.competencyId, name: c.competencyName, k: c.k, u: c.u, d: c.d, onet: input.nearest(statement, c.competencyId) }));
      return { statement, competencies };
    });
    out.push({ title: p.title, skills });
  }
  return out;
}

export function nearestItems(vector: number[] | undefined, candidates: Candidate[], floor = TRAIL_SIMILARITY_FLOOR, n = TRAIL_TOP_N): TrailItem[] {
  if (!vector) return [];
  return candidates
    .filter(c => c.vector.length === vector.length) // a vector from another model is skipped, never a crash
    .map(c => ({ label: c.label, source: c.source, provisional: c.provisional, similarity: cosineSimilarity(vector, c.vector) }))
    .filter(i => i.similarity >= floor)
    .sort((a, b) => b.similarity - a.similarity || a.label.localeCompare(b.label))
    .slice(0, n);
}
