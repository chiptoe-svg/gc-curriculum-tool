// Pure choice of match candidates for one required skill (same rule as scripts/catalog/judge-required-skills.ts).
import type { Candidate } from './types';

export interface SkillRow { course: string; statement: string; ref: string }

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Top `top` developed skills from courses other than `required.course`, by cosine; one per distinct skill ref. */
export function pickCandidates(required: SkillRow, developed: SkillRow[], vecs: Map<string, number[]>, top: number): Candidate[] {
  const rv = vecs.get(required.ref);
  if (!rv) return [];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const ranked = developed.filter(d => d.course !== required.course && vecs.has(d.ref))
    .map(d => ({ d, similarity: cosine(rv, vecs.get(d.ref)!) })).sort((a, b) => b.similarity - a.similarity);
  for (const { d, similarity } of ranked) {
    if (seen.has(d.ref)) continue;
    seen.add(d.ref);
    if (seen.size > top) break;
    out.push({ requiredRef: required.ref, suppliedRef: d.ref, suppliedCourse: d.course, suppliedStatement: d.statement, similarity, pFully: null, pPartly: null });
  }
  return out;
}
