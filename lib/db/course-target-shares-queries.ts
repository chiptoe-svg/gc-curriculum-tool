/**
 * Loaders for the course → career-target skill shares (pure math in
 * lib/skill-tree/course-target-shares.ts). Read-only. A paired lecture/lab
 * code's leaves fold into its parent course page (loadPairedSlugMap).
 * Both return null on any read failure so callers can fall back.
 */
import { db } from '@/lib/db/client';
import { careerTargetMembership } from '@/lib/db/schema';
import { loadTree } from '@/lib/db/skill-tree-queries';
import { loadPairedSlugMap } from '@/lib/ai/wiki/paired-links';
import { courseTargetShares, type CourseTargetShares, type Membership } from '@/lib/skill-tree/course-target-shares';
import type { Tree } from '@/lib/skill-tree/types';

const slugOf = (code: string) => code.trim().toLowerCase().replace(/\s+/g, '-');

async function loadInputs(): Promise<{ tree: Tree; membership: Membership[] }> {
  const tree = await loadTree();
  const membership = (await db.select({ targetId: careerTargetMembership.careerTargetId, competencyId: careerTargetMembership.competencyId })
    .from(careerTargetMembership));
  // An empty tree (0074 not applied: loadTree returns EMPTY_TREE) or empty
  // membership is "no data", not "every course feeds nothing": refuse, so the
  // writer and backfill leave the fields alone and the page keeps its list.
  if (tree.nodes.length === 0) throw new Error('skill tree is empty');
  if (membership.length === 0) throw new Error('no career target membership');
  return { tree, membership };
}

/** Leaf course codes grouped by the course page they show on. */
function codesByPage(tree: Tree, pairedSlugs: Map<string, string>): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const l of tree.leaves) {
    const page = pairedSlugs.get(slugOf(l.courseCode)) ?? slugOf(l.courseCode);
    if (!out.has(page)) out.set(page, new Set());
    out.get(page)!.add(l.courseCode);
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

function warn(err: unknown): null {
  console.warn(`[course-target-shares] unavailable: ${err instanceof Error ? err.message : String(err)}`);
  return null;
}

/** One course page's shares (its own code plus any paired codes). */
export async function loadCourseTargetShares(courseCode: string): Promise<CourseTargetShares | null> {
  try {
    const [{ tree, membership }, pairedSlugs] = await Promise.all([loadInputs(), loadPairedSlugMap()]);
    const codes = codesByPage(tree, pairedSlugs).get(slugOf(courseCode)) ?? [courseCode];
    return courseTargetShares(tree, membership, codes);
  } catch (err) {
    return warn(err);
  }
}

/** Course page slug → shares, for every course page that has skills in the tree. */
export async function loadAllCourseTargetShares(pairedSlugs: Map<string, string>): Promise<Map<string, CourseTargetShares> | null> {
  try {
    const { tree, membership } = await loadInputs();
    return new Map([...codesByPage(tree, pairedSlugs)].map(([page, codes]) => [page, courseTargetShares(tree, membership, codes)]));
  } catch (err) {
    return warn(err);
  }
}
