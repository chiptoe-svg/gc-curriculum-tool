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
// Machine labels (hidden from readers by stripSourceTags):
//   [Source: <raw path>]  the file a claim can be checked against (one per course)
//   [Synthesis]           the claim generalizes across the sources that follow it
//   [Catalog: <kind>]     catalog wording (course sheet, competency descriptor,
//                         career target), not evidence of what is taught
const SOURCE_TAG_RE = /\s*\[(?:Source: [^\]]+|Synthesis|Catalog: [^\]]+)\]/g;
/** Sections that hold navigation, not claims. */
const SKIP_SECTIONS = new Set(['cross-references', 'concepts', 'source snapshots', 'related']);

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
  if (type === 'target' && /^\s*-\s/.test(line)) {
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

/** Catalog label for a line, by page type and section; null when the line is not catalog text. */
function catalogLabel(type: string, section: string, line: string): string | null {
  if (type === 'course' && section === 'syllabus') {
    if (/^\s*\*\*[^*]+:\*\*\s*$/.test(line) || /^\s*\*\*(Links|Signature projects):\*\*/.test(line)) return null;
    return 'course sheet';
  }
  if (type === 'competency' && section === 'definition') return 'competency descriptor';
  if (type === 'target' && section === 'what this person does') return 'career target';
  return null;
}

/**
 * Stamp provenance onto a page. Competency, target and concept pages get
 * per-claim sources, [Synthesis] on program-wide prose and on lines naming
 * several courses, a `sources:` list, and a quoted `date:`. Course pages get
 * [Catalog: course sheet] on their Syllabus section and the date.
 */
export function stampProvenance(content: string, ctx: ProvenanceContext): string {
  const type = frontmatterScalar(content, 'type') ?? '';
  let out = stampDate(content);
  const derived = ['competency', 'target', 'concept'].includes(type);
  if (!derived && type !== 'course') return out;

  const fm = out.match(FRONTMATTER_RE)?.[0] ?? '';
  const bareLines = out.slice(fm.length).split('\n').map(l => l.replace(SOURCE_TAG_RE, ''));
  // Every course the page names, for program-wide prose that names none.
  const pageSources = [...new Set(bareLines.flatMap(l => linkedSlugs(l).map(s => ctx.courseSources.get(s)).filter((x): x is string => !!x)))].sort();

  const all = new Set<string>();
  let section = '';
  const lines = bareLines.map(bare => {
    const h = bare.match(/^##\s+(.+?)\s*$/);
    if (h) { section = h[1]!.toLowerCase(); return bare; }
    if (!bare.trim() || /^\s*#/.test(bare) || SKIP_SECTIONS.has(section)) return bare;
    const end = bare.replace(/\s+$/, '');
    const cat = catalogLabel(type, section, bare);
    if (cat) return `${end} [Catalog: ${cat}]`;
    if (!derived) return bare;
    const isItem = /^\s*-\s/.test(bare);
    let srcs = [...new Set(sourcesForLine(bare, type, ctx))];
    const courseLinks = new Set(linkedSlugs(bare).filter(s => ctx.courseSources.has(s)));
    let synthesis = courseLinks.size >= 2;
    if (!isItem && !srcs.length && !(type === 'concept' && section === 'the idea')) {
      srcs = pageSources;
      synthesis = srcs.length > 0;
    }
    if (!srcs.length) return bare;
    srcs.forEach(x => all.add(x));
    return `${end}${synthesis ? ' [Synthesis]' : ''}${srcs.map(x => ` [Source: ${x}]`).join('')}`;
  });
  out = fm + lines.join('\n');
  if (all.size) out = setFrontmatterLine(out, 'sources', `[${[...all].sort().join(', ')}]`);
  return out;
}
