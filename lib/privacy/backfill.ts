import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findResidualIdentifiers, countRedactionMarkers } from './deterministic';
import { isSyllabusFileName } from '@/lib/capture/materials-policy';

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

/** The columns the backfill reads at the start of the run. */
export interface BackfillRow {
  id: string;
  courseCode: string;
  fileName: string;
  isSyllabus: boolean | null;
  extractedText: string | null;
  extractionStatus: string;
  digest: string | null;
  autoSetAside: boolean;
  setAsideReason: string | null;
}

/** Side effects of one --apply row, injected so the ordering is unit-testable. */
export interface BackfillDeps {
  getMaterial(id: string): Promise<{ retiredAt: Date | null; extractedText: string | null; digest: string | null } | null>;
  /** updateExtractionResult with the row's own text (the single writer scrubs it). */
  writeText(row: BackfillRow): Promise<{ outcome: 'stored'; extractedText?: string } | { outcome: 'scrub_failed'; extractedText?: undefined; reason: string }>;
  /** scrubForRecord(...).text; throws on failure. */
  scrubDigest(digest: string, opts: { fileName: string; isSyllabus: boolean }): Promise<string>;
  setDigest(id: string, digest: string | null): Promise<void>;
  deleteVectors(courseCode: string, id: string): Promise<void>;
  markIndexFailed(id: string): Promise<void>;
  releaseHold(id: string): Promise<void>;
  enqueue(id: string): Promise<void>;
}

export type BackfillRowOutcome =
  | { kind: 'skipped' }
  | {
      kind: 'done';
      storedText?: string;
      textChanged: boolean;
      digestChanged: boolean;
      digestError?: string;
      failed: boolean;
      failReason?: string;
      released: boolean;
      /** Enqueued for re-index. */
      reindex: boolean;
      /** Vectors were deleted: refresh this course's program index. */
      touched: boolean;
    };

const hasPlaceholders = (text: string | null | undefined): boolean => {
  if (!text) return false;
  const c = countRedactionMarkers(text);
  return c['student-name'] + c['student-id'] + c.email > 0;
};

/**
 * One row of the backfill's --apply pass (final review 2026-10-05).
 *
 * Invariant: once a row is processed, every stored copy derived from the
 * material — extracted_text, digest, course chunks — is scrubbed or absent,
 * and a re-run after a crash at any step converges to that state.
 *
 *   - The row is re-read first and skipped if it was retired, deleted, or
 *     re-extracted since the run's initial read (a concurrent ingest owns it).
 *   - After the scrubbed write and BEFORE enqueue: delete the material's
 *     vectors and clear its digest (the re-index regenerates the digest from
 *     the scrubbed text). Text-NULL rows keep a scrubbed digest (nothing would
 *     regenerate it) or have it cleared if it cannot be scrubbed.
 *   - Convergence: every change the scrub makes inserts a placeholder, so a
 *     stored text (or text-NULL row's digest) that already holds one may be
 *     from an earlier run that died between its write and its vector delete.
 *     Such rows are purged and re-indexed again. Cost: rows ingested after the
 *     deploy whose text holds a placeholder are re-indexed once more.
 */
export async function applyBackfillRow(row: BackfillRow, deps: BackfillDeps): Promise<BackfillRowOutcome> {
  const fresh = await deps.getMaterial(row.id);
  if (!fresh || fresh.retiredAt !== null || fresh.extractedText !== row.extractedText || fresh.digest !== row.digest) {
    return { kind: 'skipped' };
  }
  const opts = { fileName: row.fileName, isSyllabus: row.isSyllabus === true || isSyllabusFileName(row.fileName) };

  let storedText: string | undefined;
  let textChanged = false;
  let failed = false;
  let failReason: string | undefined;
  if (row.extractedText !== null) {
    const p = await deps.writeText(row);
    if (p.outcome === 'scrub_failed') {
      failed = true;
      failReason = p.reason;
    } else {
      storedText = p.extractedText;
      textChanged = storedText !== row.extractedText;
    }
  }

  const released = !failed && isRetiredPrivacyHold(row);
  const leftover = row.extractedText !== null ? hasPlaceholders(storedText) : hasPlaceholders(row.digest);
  const reindexable = storedText !== undefined && !failed;
  const purgeAnyway = failed || textChanged || released || leftover;

  // The digest needs its own scrub only when it would survive this row: a
  // re-indexed row has its digest cleared and regenerated anyway.
  let digestChanged = false;
  let scrubbedDigest: string | null = null;
  let digestError: string | undefined;
  if (row.digest !== null && !(reindexable && purgeAnyway)) {
    try {
      scrubbedDigest = await deps.scrubDigest(row.digest, opts);
      digestChanged = scrubbedDigest !== row.digest;
    } catch (err) {
      digestChanged = true;
      scrubbedDigest = null;
      digestError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!(purgeAnyway || digestChanged)) {
    return { kind: 'done', storedText, textChanged, digestChanged, digestError, failed, failReason, released, reindex: false, touched: false };
  }

  await deps.deleteVectors(row.courseCode, row.id);
  if (reindexable) {
    if (row.digest !== null) await deps.setDigest(row.id, null);
  } else if (digestChanged) {
    await deps.setDigest(row.id, scrubbedDigest);
  }
  if (failed) await deps.markIndexFailed(row.id);
  if (released) await deps.releaseHold(row.id);
  if (reindexable) await deps.enqueue(row.id);
  return { kind: 'done', storedText, textChanged, digestChanged, digestError, failed, failReason, released, reindex: reindexable, touched: true };
}
