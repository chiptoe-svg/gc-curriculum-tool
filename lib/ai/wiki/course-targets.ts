/**
 * Course page target fields, set in code from the data, never by the model
 * (2026-11-22). The source is the skill tree: the share of the course's skills
 * that feed each career target (lib/skill-tree/course-target-shares.ts,
 * docs/superpowers/specs/2026-11-22-course-target-bars-design.md).
 *
 *   contributes_to_targets: [a, b]          targets above 0%, largest share first
 *   target_skill_shares: {a: 100, b: 38}    every target, same order
 *
 * The OKF tags are derived from contributes_to_targets, so callers re-derive
 * them after stamping. Pure helpers; the loader is in
 * lib/db/course-target-shares-queries.ts.
 */

import { deriveTags, readFrontmatterScalar, setFrontmatterLine } from '@/lib/ai/wiki/okf-frontmatter';
import type { CourseTargetShares } from '@/lib/skill-tree/course-target-shares';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
// The key line plus any indented YAML list or map items that follow it.
const fieldRe = (key: string) => new RegExp(`^${key}:.*(?:\\n[ \\t]+.*)*$`, 'm');

function setField(fm: string, key: string, line: string): string {
  const re = fieldRe(key);
  return re.test(fm) ? fm.replace(re, line) : `${fm}\n${line}`;
}

/** Course page front matter for these shares (replace or append both fields). Pages without front matter are returned unchanged. */
export function stampCourseTargetShares(content: string, shares: CourseTargetShares): string {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return content;
  const has = shares.totalSkills > 0;
  const targets = has ? shares.targets.filter(t => t.pct > 0).map(t => t.targetId) : [];
  const map = has ? shares.targets.map(t => `${t.targetId}: ${t.pct}`).join(', ') : '';
  let fm = setField(m[1]!, 'contributes_to_targets', `contributes_to_targets: [${targets.join(', ')}]`);
  fm = setField(fm, 'target_skill_shares', `target_skill_shares: {${map}}`);
  return content.replace(FRONTMATTER_RE, `---\n${fm}\n---\n`);
}

/** Shares for a course with no skills in the tree. */
export const NO_SHARES: CourseTargetShares = { totalSkills: 0, confirmedPlacements: 0, totalPlacements: 0, targets: [] };

/**
 * Backfill: stamp every course page (not courses/index.md) from the shares,
 * keep OKF tags in step, and return only the pages whose content changed.
 * A course with no entry gets empty fields.
 */
export function backfillCourseTargetShares(
  pages: Array<{ path: string; content: string }>,
  sharesBySlug: Map<string, CourseTargetShares>,
): Array<{ path: string; content: string }> {
  const changed: Array<{ path: string; content: string }> = [];
  for (const p of pages) {
    const m = p.path.match(/^courses\/(.+)\.md$/);
    if (!m || m[1] === 'index') continue;
    let next = stampCourseTargetShares(p.content, sharesBySlug.get(m[1]!) ?? NO_SHARES);
    if (readFrontmatterScalar(next, 'tags') !== null) next = setFrontmatterLine(next, 'tags', `[${deriveTags('course', next).join(', ')}]`);
    if (next !== p.content) changed.push({ path: p.path, content: next });
  }
  return changed;
}
