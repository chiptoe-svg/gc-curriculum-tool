import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findResidualIdentifiers } from './deterministic';

/**
 * A material set aside by the retired FERPA hold or by the retired
 * `Canvas: Discussions` policy rule (privacy-scrub spec 2026-10-05). These
 * are released by the backfill once their text is scrubbed.
 */
export function isRetiredPrivacyHold(row: { autoSetAside: boolean; setAsideReason: string | null }): boolean {
  if (!row.autoSetAside || row.setAsideReason === null) return false;
  return row.setAsideReason.startsWith('FERPA risk detected') || row.setAsideReason === 'Contains student posts';
}

const WIKI_EXTENSIONS = new Set(['.md', '.json']);

/** Every .md / .json file under the wiki clone, as sorted relative paths; .git is skipped. */
export async function listWikiFiles(root: string, dir = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const rel = dir ? path.join(dir, e.name) : e.name;
    if (e.isDirectory()) out.push(...await listWikiFiles(root, rel));
    else if (WIKI_EXTENSIONS.has(path.extname(e.name))) out.push(rel);
  }
  return out.sort();
}

/** Wiki files that contain an email or student-ID pattern (hits = distinct patterns). */
export async function scanWikiForIdentifiers(root: string): Promise<Array<{ path: string; hits: number }>> {
  const found: Array<{ path: string; hits: number }> = [];
  for (const rel of await listWikiFiles(root)) {
    const hits = findResidualIdentifiers(await fs.readFile(path.join(root, rel), 'utf8')).length;
    if (hits > 0) found.push({ path: rel, hits });
  }
  return found;
}

export interface BackfillArgs {
  mode: 'dry-run' | 'apply';
  course: string | null;
  wiki: boolean;
}

/**
 * Pure CLI-argument parser for scripts/privacy/backfill-scrub.ts (fix round 1,
 * 2026-10-05): a script that overwrites production data must not silently
 * treat a malformed flag as "no filter" (= whole DB). A bare trailing
 * `--course` or one immediately followed by another flag is an error, not a
 * null course.
 */
export function parseBackfillArgs(argv: string[]): BackfillArgs | { error: string } {
  const dry = argv.includes('--dry-run');
  const apply = argv.includes('--apply');
  if (dry === apply) {
    return { error: 'Pass exactly one of --dry-run or --apply.' };
  }
  const wiki = argv.includes('--wiki');
  if (wiki && dry) {
    return { error: '--wiki republishes pages; use it only with --apply.' };
  }
  const ci = argv.indexOf('--course');
  let course: string | null = null;
  if (ci >= 0) {
    const value = argv[ci + 1];
    if (value === undefined || value.startsWith('--')) {
      return { error: '--course requires a value, e.g. --course "GC 3620".' };
    }
    course = value;
  }
  return { mode: dry ? 'dry-run' : 'apply', course, wiki };
}
