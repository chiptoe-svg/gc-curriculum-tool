/**
 * Prerequisite map read from the GC course sheet's `courses.prerequisites`
 * lines. Directly linked courses only. Spec:
 * docs/superpowers/specs/2026-10-06-interview-course-context-brief-design.md §1.
 * The Clemson catalog (via MCP) is the planned authoritative source.
 */
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
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

export async function loadSheetPrereqPairs(): Promise<PrereqPair[]> {
  const rows = await db.select({ code: courses.code, prerequisites: courses.prerequisites }).from(courses);
  return sheetPrereqPairsFrom(rows);
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
