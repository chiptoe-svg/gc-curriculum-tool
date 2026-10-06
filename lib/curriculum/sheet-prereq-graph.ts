/**
 * Prerequisite map read from the GC course sheet's `courses.prerequisites`
 * lines. Directly linked courses only. Spec:
 * docs/superpowers/specs/2026-10-06-interview-course-context-brief-design.md §1.
 * Now the FALLBACK source only: lib/curriculum/prereq-map.ts uses the Clemson
 * catalog (synced into course_catalog_* tables) first, and these sheet pairs
 * only for courses with no catalog row.
 */
import { extractPrereqCodes } from '@/lib/capture/prereq-codes';

export interface PrereqPair { focal: string; prereq: string }

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

export function sheetPrereqPairsFrom(
  rows: ReadonlyArray<{ code: string; prerequisites: string | null }>,
): PrereqPair[] {
  const canonical = new Map(rows.map(r => [norm(r.code), r.code]));
  const pairs: PrereqPair[] = [];
  for (const r of rows) {
    for (const found of extractPrereqCodes(r.prerequisites ?? '', r.code)) {
      const prereq = canonical.get(norm(found));
      if (!prereq || norm(prereq) === norm(r.code)) continue;
      pairs.push({ focal: r.code, prereq });
    }
  }
  return mergePrereqPairs(pairs);
}

export function prereqsOf(pairs: ReadonlyArray<PrereqPair>, code: string): string[] {
  const c = norm(code);
  return [...new Set(pairs.filter(p => norm(p.focal) === c).map(p => p.prereq))].sort();
}

export function dependentsOf(pairs: ReadonlyArray<PrereqPair>, code: string): string[] {
  const c = norm(code);
  return [...new Set(pairs.filter(p => norm(p.prereq) === c).map(p => p.focal))].sort();
}

export function mergePrereqPairs(...lists: ReadonlyArray<ReadonlyArray<PrereqPair>>): PrereqPair[] {
  const seen = new Set<string>();
  const out: PrereqPair[] = [];
  for (const list of lists) for (const p of list) {
    const k = `${norm(p.focal)}|${norm(p.prereq)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}
