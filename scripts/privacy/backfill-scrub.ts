/**
 * One-time privacy backfill (spec docs/superpowers/specs/2026-10-05-privacy-scrub-design.md).
 *
 *   1. Scrubs extracted_text (via updateExtractionResult, the single writer)
 *      and digest on every active material — including the rows the retired
 *      FERPA hold set aside, whose raw text is stored today.
 *   2. Releases those holds (and the retired Canvas: Discussions set-aside).
 *   3. Per row in --apply (lib/privacy/backfill.ts applyBackfillRow): re-reads
 *      the row and skips it if it was retired or re-extracted during the run;
 *      after the scrubbed write and before enqueue, deletes the material's
 *      vectors and clears its digest for every row whose text or digest
 *      changed, whose hold was released, or whose stored text already holds a
 *      placeholder (convergence after a crashed earlier run). Re-indexes those
 *      rows, waits for the queue, then refreshes the program index
 *      (cross-course spine) for each touched course. Program chunks are
 *      restamped with snapshotId = null, as rebuildProgramIndex does; the next
 *      snapshot restamps them.
 *   4. Scans the published wiki for email/CUID patterns; with --wiki,
 *      republishes those pages through writeAndPush (which scrubs them).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/privacy/backfill-scrub.ts --dry-run [--course "GC 3620"]
 *     (--dry-run reads only, via an explicit-column select that never
 *     mentions `redactions`, so it works today even before migration 0052
 *     is applied to production)
 *   pnpm exec tsx --env-file=.env.local scripts/privacy/backfill-scrub.ts --apply [--course "GC 3620"] [--wiki]
 *     (--apply requires migration 0052 applied to production AND this script
 *     deployed from the deploy checkout first)
 *
 * --dry-run writes nothing (it does make the privacy-scrub AI calls for
 * flagged materials so the counts are real). --apply needs the owner's
 * go-ahead after they have seen the dry-run; --wiki needs its own go-ahead.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import {
  updateExtractionResult,
  updateAutoSetAside,
  updateIndexingStatus,
  setScrubbedDigest,
  getMaterialById,
  type ExtractionStatus,
} from '@/lib/db/course-materials-queries';
import { scrubForRecord } from '@/lib/privacy/scrub';
import { countRedactionMarkers } from '@/lib/privacy/deterministic';
import { isRetiredPrivacyHold, scanWikiForIdentifiers, parseBackfillArgs, applyBackfillRow, type BackfillDeps } from '@/lib/privacy/backfill';
import { isSyllabusFileName } from '@/lib/capture/materials-policy';
import { enqueue } from '@/lib/capture/ingest-queue';
import { createVectorStore, tenantForCourse } from '@/lib/capture/vector-store';
import { refreshProgramIndex } from '@/lib/capture/program-index';
import { readWikiPage, writeAndPush, wikiRepoPath, WikiPagesWithheldError } from '@/lib/wiki/git-ops';

interface Tally {
  scanned: number; skipped: number; textChanged: number; digestChanged: number; failed: number;
  released: number; reindexed: number; names: number; ids: number; emails: number;
}

function parseArgs(argv: string[]) {
  const parsed = parseBackfillArgs(argv);
  if ('error' in parsed) {
    console.error(parsed.error);
    process.exit(2);
  }
  return parsed;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function waitForIndexing(ids: string[], timeoutMs = 60 * 60_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const rows = await Promise.all(ids.map(id => getMaterialById(id)));
    const pending = rows.filter(r => r && (r.indexingStatus === 'queued' || r.indexingStatus === 'indexing')).length;
    if (pending === 0) break;
    if (Date.now() - start > timeoutMs) {
      console.log(`  timed out with ${pending} still indexing; press "Index now" on those courses later`);
      break;
    }
    console.log(`  waiting: ${pending}/${ids.length} still indexing`);
    await new Promise(r => setTimeout(r, 10_000));
  }
  const rows = await Promise.all(ids.map(id => getMaterialById(id)));
  console.log(`  re-index: ${rows.filter(r => r?.indexingStatus === 'ready').length} ready, ${rows.filter(r => r?.indexingStatus === 'failed').length} failed, ${rows.filter(r => r?.indexingStatus === 'skipped').length} skipped`);
}

async function main(): Promise<void> {
  const { mode, course, wiki } = parseArgs(process.argv.slice(2));
  console.log(`privacy backfill — ${mode}${course ? ` — ${course}` : ''}`);

  // Explicit columns: the dry-run must work before migration 0052 is applied.
  const rows = await db
    .select({
      id: courseMaterials.id,
      courseCode: courseMaterials.courseCode,
      fileName: courseMaterials.fileName,
      isSyllabus: courseMaterials.isSyllabus,
      extractedText: courseMaterials.extractedText,
      extractionStatus: courseMaterials.extractionStatus,
      digest: courseMaterials.digest,
      autoSetAside: courseMaterials.autoSetAside,
      setAsideReason: courseMaterials.setAsideReason,
    })
    .from(courseMaterials)
    .where(course
      ? and(isNull(courseMaterials.retiredAt), eq(courseMaterials.courseCode, course))
      : isNull(courseMaterials.retiredAt));

  const tallies = new Map<string, Tally>();
  const reindexIds: string[] = [];
  const touchedCourses = new Set<string>();
  const vectorStore = mode === 'apply' ? createVectorStore() : null;
  const deps: BackfillDeps | null = vectorStore === null ? null : {
    getMaterial: id => getMaterialById(id),
    writeText: r => updateExtractionResult({
      id: r.id,
      extractionStatus: r.extractionStatus as ExtractionStatus,
      extractedText: r.extractedText!,
    }),
    scrubDigest: async (d, opts) => (await scrubForRecord(d, opts)).text,
    setDigest: (id, d) => setScrubbedDigest(id, d),
    deleteVectors: (code, id) => vectorStore.deleteByMaterial(tenantForCourse(code), id),
    markIndexFailed: id => updateIndexingStatus({ id, status: 'failed' }),
    releaseHold: id => updateAutoSetAside({ id, autoSetAside: false, setAsideReason: null, ignored: false }),
    enqueue: id => enqueue(id),
  };

  for (const row of rows) {
    const t = tallies.get(row.courseCode) ?? { scanned: 0, skipped: 0, textChanged: 0, digestChanged: 0, failed: 0, released: 0, reindexed: 0, names: 0, ids: 0, emails: 0 };
    tallies.set(row.courseCode, t);
    t.scanned++;
    const opts = { fileName: row.fileName, isSyllabus: row.isSyllabus === true || isSyllabusFileName(row.fileName) };

    if (deps !== null) {
      // --apply: per-row logic (re-read, scrubbed write, vector delete +
      // digest clear before enqueue, crash convergence) in applyBackfillRow.
      const o = await applyBackfillRow(row, deps);
      if (o.kind === 'skipped') {
        t.skipped++;
        console.log(`  - ${row.courseCode} ${row.id}: skipped (changed/retired during run)`);
        continue;
      }
      if (o.failed) console.log(`  ! ${row.courseCode} ${row.id}: scrub failed, text cleared — ${o.failReason}`);
      if (o.digestError) console.log(`  ! ${row.courseCode} ${row.id}: digest scrub failed, digest cleared — ${o.digestError}`);
      if (o.storedText !== undefined) {
        const c = countRedactionMarkers(o.storedText);
        t.names += c['student-name'];
        t.ids += c['student-id'];
        t.emails += c.email;
      }
      if (o.textChanged) t.textChanged++;
      if (o.digestChanged) t.digestChanged++;
      if (o.failed) t.failed++;
      if (o.released) t.released++;
      if (o.reindex) { t.reindexed++; reindexIds.push(row.id); }
      if (o.touched) touchedCourses.add(row.courseCode);
      continue;
    }

    // --dry-run: reads only. Mirrors applyBackfillRow's decisions.
    let textChanged = false;
    let digestChanged = false;
    let failed = false;
    let storedText: string | undefined;
    if (row.extractedText !== null) {
      try {
        storedText = (await scrubForRecord(row.extractedText, opts)).text;
      } catch (err) {
        failed = true;
        console.log(`  ! ${row.courseCode} ${row.id}: scrub would fail — ${msg(err)}`);
      }
      if (storedText !== undefined) {
        textChanged = storedText !== row.extractedText;
        const c = countRedactionMarkers(storedText);
        t.names += c['student-name'];
        t.ids += c['student-id'];
        t.emails += c.email;
      }
    }
    if (row.digest !== null) {
      try {
        digestChanged = (await scrubForRecord(row.digest, opts)).text !== row.digest;
      } catch (err) {
        digestChanged = true;
        console.log(`  ! ${row.courseCode} ${row.id}: digest scrub would fail — ${msg(err)}`);
      }
    }
    if (textChanged) t.textChanged++;
    if (digestChanged) t.digestChanged++;
    if (failed) { t.failed++; continue; }
    const release = isRetiredPrivacyHold(row);
    if (release) t.released++;
    // A stored text that already holds a placeholder is re-indexed too (see
    // applyBackfillRow: convergence after a crashed earlier run).
    const leftover = storedText !== undefined && !textChanged && Object.values(countRedactionMarkers(storedText)).some(n => n > 0);
    if (row.extractedText !== null && (textChanged || digestChanged || release || leftover)) t.reindexed++;
  }

  console.log('\ncourse | scanned | skipped (changed/retired during run) | text changed | digest changed | failed | holds released | re-index | [student] | [student ID] | [email]');
  for (const [code, t] of [...tallies.entries()].sort()) {
    console.log(`${code} | ${t.scanned} | ${t.skipped} | ${t.textChanged} | ${t.digestChanged} | ${t.failed} | ${t.released} | ${t.reindexed} | ${t.names} | ${t.ids} | ${t.emails}`);
  }

  if (mode === 'apply' && reindexIds.length > 0) {
    console.log(`\nre-indexing ${reindexIds.length} material(s)…`);
    await waitForIndexing(reindexIds);
  }
  if (mode === 'apply') {
    for (const code of touchedCourses) {
      try {
        await refreshProgramIndex(code);
      } catch (err) {
        console.log(`  ! program index refresh failed for ${code} — ${msg(err)}`);
      }
    }
  }

  const root = wikiRepoPath();
  const hits = await scanWikiForIdentifiers(root);
  console.log(`\nwiki (${root}): ${hits.length} file(s) with email/student-ID patterns`);
  for (const h of hits) console.log(`  ${h.path}: ${h.hits} distinct`);
  if (mode === 'apply' && wiki && hits.length > 0) {
    const pages: Array<{ path: string; content: string }> = [];
    for (const h of hits) {
      const content = await readWikiPage(h.path);
      if (content !== null) pages.push({ path: h.path, content });
    }
    const commit = {
      pages,
      logEntry: `${new Date().toISOString()} — privacy scrub: republished ${pages.length} page(s)`,
      commitMessage: `chore(privacy): scrub emails and student IDs from ${pages.length} wiki page(s)`,
    };
    try {
      const { sha } = await writeAndPush(commit);
      console.log(`  republished at ${sha}`);
    } catch (err) {
      if (!(err instanceof WikiPagesWithheldError)) throw err;
      console.log(`  republished at ${err.sha}; WITHHELD (still published as before, needs manual review): ${err.withheld.map(w => w.path).join(', ')}`);
    }
  } else if (hits.length > 0) {
    console.log('  (republish with --apply --wiki, after the owner says go)');
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
