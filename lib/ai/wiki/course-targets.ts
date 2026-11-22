/**
 * Course page `contributes_to_targets` (2026-11-22): set in code from the
 * data, never by the model. The course-page writer gets no target membership
 * in its input, so the model guessed — 16 of 19 live course pages said `[]`
 * while every course fed all five targets. The source of truth is the same one
 * the target pages use: each target's contributing courses (loadTargetSubstrate).
 * Pure helpers here; the loader lives in update.ts.
 */

import { deriveTags, readFrontmatterScalar, setFrontmatterLine } from '@/lib/ai/wiki/okf-frontmatter';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const KEY = 'contributes_to_targets';
// The key line plus any indented YAML list items that follow it.
const FIELD_RE = new RegExp(`^${KEY}:.*(?:\\n[ \\t]+-.*)*$`, 'm');

/** Set `contributes_to_targets: [a, b]` in a page's frontmatter (replace or append). Pages without frontmatter are returned unchanged. */
export function stampCourseTargets(content: string, targets: string[]): string {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return content;
  const line = `${KEY}: [${targets.join(', ')}]`;
  const body = FIELD_RE.test(m[1]!) ? m[1]!.replace(FIELD_RE, line) : `${m[1]!}\n${line}`;
  return content.replace(FRONTMATTER_RE, `---\n${body}\n---\n`);
}

/**
 * Invert target → contributing course slugs into course slug → sorted target
 * slugs. A paired lecture/lab code folds onto its parent course page.
 */
export function courseTargetMap(
  coursesByTarget: Record<string, string[]>,
  pairedToParent: Map<string, string>,
): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const [target, courses] of Object.entries(coursesByTarget)) {
    for (const c of courses) {
      const page = pairedToParent.get(c) ?? c;
      if (!sets.has(page)) sets.set(page, new Set());
      sets.get(page)!.add(target);
    }
  }
  return new Map([...sets].map(([c, s]) => [c, [...s].sort()]));
}

/** The `contributing_courses` list of a target page's frontmatter (inline `[a, b]` or YAML items). */
export function contributingCoursesOf(targetPage: string): string[] {
  const fm = targetPage.match(FRONTMATTER_RE)?.[1] ?? '';
  const m = fm.match(/^contributing_courses:(.*(?:\n[ \t]+-.*)*)$/m);
  if (!m) return [];
  return m[1]!.replace(/#.*$/gm, '').split(/[\[\],\n]/).map(s => s.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
}

/**
 * Backfill (no AI, no database): set every course page's contributes_to_targets
 * from the wiki's own target pages — the same lists the published "Builds toward"
 * section already reads. Returns only the course pages whose content changed.
 */
export function backfillCourseTargets(pages: Array<{ path: string; content: string }>): Array<{ path: string; content: string }> {
  const coursesByTarget: Record<string, string[]> = {};
  for (const p of pages) {
    const m = p.path.match(/^targets\/(.+)\.md$/);
    if (m && m[1] !== 'index') coursesByTarget[m[1]!] = contributingCoursesOf(p.content);
  }
  const map = courseTargetMap(coursesByTarget, new Map());
  const changed: Array<{ path: string; content: string }> = [];
  for (const p of pages) {
    const m = p.path.match(/^courses\/(.+)\.md$/);
    if (!m || m[1] === 'index') continue;
    let next = stampCourseTargets(p.content, map.get(m[1]!) ?? []);
    // OKF tags are derived from contributes_to_targets; keep them in step.
    if (readFrontmatterScalar(next, 'tags') !== null) next = setFrontmatterLine(next, 'tags', `[${deriveTags('course', next).join(', ')}]`);
    if (next !== p.content) changed.push({ path: p.path, content: next });
  }
  return changed;
}
