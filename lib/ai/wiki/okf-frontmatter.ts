/**
 * Pure OKF-v0.1 frontmatter projection for the gc-curriculum-wiki layer.
 * No I/O, no AI. Deterministic + idempotent. Consumed by update.ts (ongoing
 * regen post-stamp) and scripts/wiki-backfill-okf.ts (one-time migration).
 *
 * Postgres remains the source of truth; this only normalizes the markdown
 * face's frontmatter to the OKF vocabulary. Domain relation keys
 * (develops_competencies, contributes_to_targets, evidence_bands, input_hash,
 * …) are preserved untouched.
 */
import { WIKI_PAGE_TYPES, type WikiPageType } from './schema';

export const OKF_REQUIRED_KEYS = ['type', 'title', 'description', 'slug', 'tags', 'timestamp', 'resource'] as const;

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const DEFAULT_BASE = 'http://130.127.162.180:3000';

/** Public origin used in `resource:` URLs. Env-overridable; LAN default. */
export function okfBase(): string {
  return process.env.WIKI_PUBLIC_ORIGIN ?? DEFAULT_BASE;
}

/** Singular frontmatter `type` → plural section dir used in /wiki/<dir>/<slug>. */
const TYPE_TO_DIR: Record<string, string> = {
  course: 'courses', competency: 'competencies', target: 'targets', concept: 'concepts',
};

function blockOf(content: string): string | null {
  const m = content.match(FRONTMATTER_RE);
  return m ? m[1]! : null;
}

/** Read a scalar `key: value` (unquoted) from a page's frontmatter. */
export function readFrontmatterScalar(content: string, key: string): string | null {
  const block = blockOf(content);
  if (block === null) return null;
  const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m && m[1] ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function scalarInBlock(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m && m[1] ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function listInBlock(block: string, key: string): string[] {
  const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m || !m[1]) return [];
  const v = m[1].trim();
  if (v.startsWith('[')) return v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  return v && v !== 'null' ? [v] : [];
}

function setLine(block: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  return re.test(block) ? block.replace(re, line) : `${block}\n${line}`;
}

function removeLine(block: string, key: string): string {
  return block.replace(new RegExp(`^${key}:\\s*.*$\\n?`, 'm'), '');
}

/** Set or replace `key: value` in a page's frontmatter block (public; used by the backfill for description). */
export function setFrontmatterLine(content: string, key: string, value: string): string {
  const block = blockOf(content);
  if (block === null) return content;
  return content.replace(FRONTMATTER_RE, `---\n${setLine(block, key, value)}\n---\n`);
}

/** Deterministic OKF tags for a page, from its type + relation keys in its block. */
export function deriveTags(type: string, contentOrBlock: string): string[] {
  const block = blockOf(contentOrBlock) ?? contentOrBlock;
  switch (type) {
    case 'course': {
      const level = scalarInBlock(block, 'level');
      return ['course', ...(level ? [`level-${level}`] : []), ...listInBlock(block, 'contributes_to_targets')];
    }
    case 'competency': {
      const ct = scalarInBlock(block, 'career_target');
      return ['competency', ...(ct && ct !== 'null' ? [ct] : [])];
    }
    case 'target': return ['target'];
    case 'concept': return ['concept'];
    default: return [type];
  }
}

export function okfResource(type: string, slug: string, base: string = okfBase()): string {
  if (type === 'index') return `${base}/wiki`; // root dashboard → wiki home
  const dir = TYPE_TO_DIR[type] ?? type;
  return `${base}/wiki/${dir}/${slug}`;
}

export interface OkfStampOpts { slug: string; timestamp?: string; base?: string; }

/**
 * Idempotent: stamp the OKF MACHINE fields into a page's frontmatter —
 * title (from a legacy `name`), timestamp (explicit opt, else renamed from a
 * legacy `updated_at`), canonical slug, deterministic tags, resource URL.
 * Does NOT touch `description` (author/backfill owned) or any domain key.
 * Same input → same output.
 */
export function stampOkfFrontmatter(content: string, opts: OkfStampOpts): string {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return content;
  let block = m[1]!;
  const type = scalarInBlock(block, 'type') ?? '';

  // name → title (only when title absent)
  const name = scalarInBlock(block, 'name');
  if (name !== null && scalarInBlock(block, 'title') === null) {
    block = setLine(block, 'title', `"${name}"`);
  }
  block = removeLine(block, 'name');

  // timestamp: explicit opt wins; else rename updated_at preserving its value.
  const ts = opts.timestamp ?? scalarInBlock(block, 'updated_at');
  if (ts) block = setLine(block, 'timestamp', ts);
  block = removeLine(block, 'updated_at');

  block = setLine(block, 'slug', opts.slug);
  block = setLine(block, 'tags', `[${deriveTags(type, block).join(', ')}]`);
  block = setLine(block, 'resource', okfResource(type, opts.slug, opts.base));

  return content.replace(FRONTMATTER_RE, `---\n${block}\n---\n`);
}

// ---------------------------------------------------------------------------
// Section index builder (pure) — see Task 2 for tests.
// ---------------------------------------------------------------------------

export interface IndexEntry { slug: string; title: string; description: string; }

const SECTION_META: Record<WikiPageType, { title: string; noun: string }> = {
  courses: { title: 'Courses', noun: 'course' },
  competencies: { title: 'Competencies', noun: 'competency' },
  targets: { title: 'Targets', noun: 'career-target' },
  concepts: { title: 'Concepts', noun: 'concept' },
};

/**
 * Deterministic OKF `index` page for a section. Courses sort by slug; other
 * sections sort by title. `timestamp` is supplied by the caller (the max member
 * timestamp) so the page is stable across rebuilds when nothing changed.
 */
export function buildSectionIndex(
  type: WikiPageType, entries: IndexEntry[], timestamp: string, base: string = okfBase(),
): string {
  const meta = SECTION_META[type];
  const sorted = [...entries].sort((a, b) =>
    type === 'courses' ? a.slug.localeCompare(b.slug) : a.title.localeCompare(b.title));
  const fm = [
    '---',
    'type: index',
    `title: "${meta.title}"`,
    `description: "Index of ${meta.noun} pages in the GC curriculum wiki."`,
    `slug: ${type}`,
    `tags: [index, ${type}]`,
    `timestamp: ${timestamp}`,
    `resource: ${base}/wiki/${type}`,
    '---',
    '',
    `# ${meta.title}`,
    '',
  ];
  const lines = sorted.map(e => `- [[${e.slug}]]${e.description ? ` — ${e.description}` : ''}`);
  return fm.join('\n') + lines.join('\n') + '\n';
}

export { WIKI_PAGE_TYPES };
