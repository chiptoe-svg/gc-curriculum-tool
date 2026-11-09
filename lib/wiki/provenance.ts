/**
 * Provenance for wiki pages built from other pages (competency, target and
 * concept pages), so each claim can be checked against raw evidence.
 *
 * Pure, deterministic and idempotent; no AI. A claim line that names a course
 * gets `[Source: raw/snapshots/<course>/<file>.json]` for that course's latest
 * snapshot (the file its course page cites as `last_snapshot_path`); a target
 * bullet cites the courses that reach the depth it states for that competency.
 * The page's frontmatter gets `sources:` (every cited file) and a quoted
 * `date:`. Paths are vault-relative.
 *
 * Depths on competency and target pages come from the program coverage
 * scoring (snapshot_competency_coverage), which is not in raw/; the cited
 * snapshot is the evidence the scorer read, not a copy of its numbers.
 *
 * Asked for by the second-brain citation check (2026-11-09): these pages
 * cited nothing, so 695 of their claims could not be checked.
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const SOURCE_TAG_RE = /\s*\[Source: [^\]]+\]/g;
const MAX_SOURCES_PER_CLAIM = 3;

export interface ProvenanceContext {
  /** Course slug → vault-relative path of its latest snapshot JSON. */
  courseSources: Map<string, string>;
  /** Competency slug → the courses listed on its page, with their D depth. */
  competencyCourses: Map<string, Array<{ course: string; d: number }>>;
}

function frontmatterScalar(content: string, key: string): string | null {
  const block = content.match(FRONTMATTER_RE)?.[1];
  if (!block) return null;
  const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m?.[1] ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function setFrontmatterLine(content: string, key: string, value: string): string {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return content;
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  const line = `${key}: ${value}`;
  const block = re.test(m[1]!) ? m[1]!.replace(re, line) : `${m[1]!}\n${line}`;
  return content.replace(FRONTMATTER_RE, `---\n${block}\n---\n`);
}

/** Wikilink targets in a line, in order (`[[slug]]` or `[[slug|label]]`). */
function linkedSlugs(line: string): string[] {
  return [...line.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map(m => m[1]!.trim());
}

/** Build the context from wiki pages (course pages and competency pages). */
export function buildProvenanceContext(pages: Array<{ path: string; content: string }>): ProvenanceContext {
  const courseSources = new Map<string, string>();
  const competencyCourses = new Map<string, Array<{ course: string; d: number }>>();
  for (const p of pages) {
    const slug = p.path.replace(/^.*\//, '').replace(/\.md$/, '');
    if (p.path.startsWith('courses/')) {
      const snap = frontmatterScalar(p.content, 'last_snapshot_path');
      if (snap && snap.startsWith('raw/')) courseSources.set(slug, snap);
    } else if (p.path.startsWith('competencies/')) {
      const rows: Array<{ course: string; d: number }> = [];
      for (const line of p.content.split('\n')) {
        const m = line.match(/^\s*-\s*\[\[([^\]|]+)[^\]]*\]\][^\n]*?\bK\d\/U\d\/D(\d)/);
        if (m) rows.push({ course: m[1]!.trim(), d: Number(m[2]) });
      }
      competencyCourses.set(slug, rows);
    }
  }
  return { courseSources, competencyCourses };
}

/** Add or replace `date: "YYYY-MM-DD"` from the page's timestamp. */
export function stampDate(content: string): string {
  const ts = frontmatterScalar(content, 'timestamp');
  const day = ts?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return day ? setFrontmatterLine(content, 'date', `"${day}"`) : content;
}

/** Remove `[Source: …]` tags (for the reader-facing render). */
export function stripSourceTags(markdown: string): string {
  return markdown.replace(SOURCE_TAG_RE, '');
}

function sourcesForLine(line: string, type: string, ctx: ProvenanceContext): string[] {
  const slugs = linkedSlugs(line);
  if (type === 'target') {
    const comp = slugs[0];
    const stated = line.match(/\(D(\d)\)/)?.[1];
    const rows = comp ? ctx.competencyCourses.get(comp) ?? [] : [];
    if (!stated || !rows.length) return [];
    const exact = rows.filter(r => r.d === Number(stated));
    const max = Math.max(...rows.map(r => r.d));
    const pick = exact.length ? exact : rows.filter(r => r.d === max);
    return pick.map(r => ctx.courseSources.get(r.course)).filter((s): s is string => !!s);
  }
  return slugs.map(s => ctx.courseSources.get(s)).filter((s): s is string => !!s);
}

/**
 * Stamp per-claim sources, a `sources:` list and a quoted `date:` onto a
 * competency, target or concept page. Other page types only get the date.
 */
export function stampProvenance(content: string, ctx: ProvenanceContext): string {
  const type = frontmatterScalar(content, 'type') ?? '';
  let out = stampDate(content);
  if (!['competency', 'target', 'concept'].includes(type)) return out;

  const fm = out.match(FRONTMATTER_RE)?.[0] ?? '';
  const body = out.slice(fm.length);
  const all = new Set<string>();
  const lines = body.split('\n').map(line => {
    // Claims are list items and prose paragraphs; skip headings and blank lines.
    if (!line.trim() || /^\s*#/.test(line)) return line;
    const bare = line.replace(SOURCE_TAG_RE, '');
    const srcs = [...new Set(sourcesForLine(bare, type, ctx))].slice(0, MAX_SOURCES_PER_CLAIM);
    srcs.forEach(s => all.add(s));
    return srcs.length ? `${bare.replace(/\s+$/, '')}${srcs.map(s => ` [Source: ${s}]`).join('')}` : bare;
  });
  out = fm + lines.join('\n');
  if (all.size) out = setFrontmatterLine(out, 'sources', `[${[...all].sort().join(', ')}]`);
  return out;
}
