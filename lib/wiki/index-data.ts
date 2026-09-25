/**
 * Data for the wiki index page (/wiki). Reads the frontmatter of every narrative
 * page in the wiki repo so the index can be a designed, linked map of the
 * program rather than a rendering of index.md (which is written for agents and
 * keeps its [[wikilinks]] for the MCP surface).
 *
 * Read-only. Never touches raw/.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '@/lib/wiki/markdown-helpers';
import { wikiRepoPath } from '@/lib/wiki/git-ops';

export interface WikiCourse {
  slug: string;
  /** "GC 1010", "MKT 3310", "GC 4900AP" — derived from the slug. */
  code: string;
  title: string;
  description: string;
  /** 0 = outside the GC sequence (e.g. MKT); 1–4 = thousand-level of the course. */
  level: number;
  /** ISO date of the last capture, from last_snapshot_path, or null. */
  lastCaptured: string | null;
  /** True when the page's evidence bands include materials_supported. */
  materialsSupported: boolean;
}

export interface WikiEntry {
  slug: string;
  title: string;
  description: string;
}

export interface WikiLogEntry {
  date: string; // ISO timestamp
  text: string; // everything after the em dash
}

export interface WikiIndexData {
  courses: WikiCourse[];
  targets: WikiEntry[];
  competencies: WikiEntry[];
  concepts: WikiEntry[];
  recent: WikiLogEntry[];
}

/** The program's own framing of the sequence (3-Act), keyed by course level. */
export function levelGroup(level: number): { key: string; title: string; range: string } {
  if (level >= 4) return { key: 'specialty', title: 'Specialty and application', range: '4000 level' };
  if (level === 3) return { key: 'integration', title: 'Integration and mastery', range: '3000 level' };
  if (level >= 1) return { key: 'foundations', title: 'Foundations and agency', range: '1000 and 2000 level' };
  return { key: 'related', title: 'Related courses outside GC', range: '' };
}

export function codeFromSlug(slug: string): string {
  const m = /^([a-z]+)-(\d{4}[a-z]*)$/i.exec(slug);
  if (!m || !m[1] || !m[2]) return slug.toUpperCase();
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function dateFromSnapshotPath(p: unknown): string | null {
  const m = typeof p === 'string' ? /(\d{4}-\d{2}-\d{2})_/.exec(p) : null;
  return m?.[1] ?? null;
}

function bandsInclude(v: unknown, band: string): boolean {
  if (Array.isArray(v)) return v.includes(band);
  return typeof v === 'string' && v.includes(band);
}

async function readPages(root: string, type: string): Promise<Array<{ slug: string; fm: Record<string, unknown> }>> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(path.join(root, type))).filter(f => f.endsWith('.md') && f !== 'index.md');
  } catch {
    return [];
  }
  const out: Array<{ slug: string; fm: Record<string, unknown> }> = [];
  for (const f of files.sort()) {
    const raw = await fs.readFile(path.join(root, type, f), 'utf8');
    const { frontmatter } = parseFrontmatter(raw);
    if (str(frontmatter.type) === 'index') continue;
    out.push({ slug: f.replace(/\.md$/, ''), fm: frontmatter as Record<string, unknown> });
  }
  return out;
}

function toEntry({ slug, fm }: { slug: string; fm: Record<string, unknown> }): WikiEntry {
  return { slug, title: str(fm.title) || slug, description: str(fm.description) };
}

export async function loadRecent(root: string, limit = 5): Promise<WikiLogEntry[]> {
  let raw = '';
  try {
    raw = await fs.readFile(path.join(root, 'log.md'), 'utf8');
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const entries: WikiLogEntry[] = [];
  for (const line of raw.split('\n').reverse()) {
    const m = /^(\d{4}-\d{2}-\d{2}T[^ ]+)\s+—\s+(.+)$/.exec(line.trim());
    const date = m?.[1]; const text = m?.[2];
    if (!date || !text || seen.has(text)) continue;
    seen.add(text);
    entries.push({ date, text });
    if (entries.length >= limit) break;
  }
  return entries.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function loadWikiIndex(root: string = wikiRepoPath()): Promise<WikiIndexData> {
  const [courses, targets, competencies, concepts, recent] = await Promise.all([
    readPages(root, 'courses'),
    readPages(root, 'targets'),
    readPages(root, 'competencies'),
    readPages(root, 'concepts'),
    loadRecent(root),
  ]);
  return {
    courses: courses
      .map(({ slug, fm }) => ({
        slug,
        code: codeFromSlug(slug),
        title: str(fm.title) || slug,
        description: str(fm.description),
        level: typeof fm.level === 'number' ? fm.level : Number(fm.level) || 0,
        lastCaptured: dateFromSnapshotPath(fm.last_snapshot_path),
        materialsSupported: bandsInclude(fm.evidence_bands, 'materials_supported'),
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    targets: targets.map(toEntry),
    competencies: competencies.map(toEntry),
    concepts: concepts.map(toEntry),
    recent,
  };
}
