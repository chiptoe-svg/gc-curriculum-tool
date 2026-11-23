/**
 * Share of a course's skills that feed each career target (2026-11-22,
 * docs/superpowers/specs/2026-11-22-course-target-bars-design.md).
 *
 * A skill is a distinct (courseCode, skillRef) with at least one counted
 * placement in the skill tree (the tree's own `counts` rule: confirmed, or
 * proposed by something other than a bare embedding match). It feeds a
 * target when one of its placements, followed up through parent skills to a
 * master node, lands on a competency in that target's membership. Leaves on a
 * merged node count under the survivor; a retired node or ancestor drops the
 * placement. Pure, so the wiki page and the wiki writer read the same numbers.
 */
import { counts, resolveNode } from './read';
import type { Tree, TreeNode } from './types';

export interface TargetShare { targetId: string; skills: number; pct: number }
export interface CourseTargetShares { totalSkills: number; confirmedPlacements: number; totalPlacements: number; targets: TargetShare[] }
export interface Membership { targetId: string; competencyId: string }

/** The master's competency id for a placement's node, or null if it never reaches a live master. */
function masterCompetency(byId: Map<string, TreeNode>, tree: Tree, nodeId: string): string | null {
  const seen = new Set<string>();
  let cur: string | null = resolveNode(tree, nodeId);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = byId.get(cur);
    if (!n || n.retired) return null;
    if (n.competencyId) return n.competencyId;
    cur = n.parentId ? resolveNode(tree, n.parentId) : null;
  }
  return null;
}

export function courseTargetShares(tree: Tree, membership: Membership[], courseCodes: string[]): CourseTargetShares {
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const codes = new Set(courseCodes);
  const targetsOf = new Map<string, Set<string>>();
  const targetIds = [...new Set(membership.map(m => m.targetId))];
  for (const m of membership) {
    if (!targetsOf.has(m.competencyId)) targetsOf.set(m.competencyId, new Set());
    targetsOf.get(m.competencyId)!.add(m.targetId);
  }

  const skills = new Set<string>();
  const skillsByTarget = new Map<string, Set<string>>(targetIds.map(t => [t, new Set()]));
  let totalPlacements = 0;
  let confirmedPlacements = 0;
  for (const l of tree.leaves) {
    if (!codes.has(l.courseCode) || !counts(l)) continue;
    const comp = masterCompetency(byId, tree, l.nodeId);
    if (!comp) continue;
    const key = `${l.courseCode}\u0000${l.skillRef}`;
    skills.add(key);
    totalPlacements++;
    if (l.status === 'confirmed') confirmedPlacements++;
    for (const t of targetsOf.get(comp) ?? []) skillsByTarget.get(t)!.add(key);
  }

  const total = skills.size;
  const targets = targetIds
    .map(targetId => {
      const n = skillsByTarget.get(targetId)!.size;
      return { targetId, skills: n, pct: total ? Math.round((100 * n) / total) : 0 };
    })
    .sort((a, b) => b.pct - a.pct || a.targetId.localeCompare(b.targetId));
  return { totalSkills: total, confirmedPlacements, totalPlacements, targets };
}
