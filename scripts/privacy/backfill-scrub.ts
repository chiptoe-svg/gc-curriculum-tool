/**
 * One-time privacy backfill (spec docs/superpowers/specs/2026-10-05-privacy-scrub-design.md).
 *
 *   1. Scrubs extracted_text (via updateExtractionResult, the single writer)
 *      and digest on every active material — including the rows the retired
 *      FERPA hold set aside, whose raw text is stored today.
 *   2. Releases those holds (and the retired Canvas: Discussions set-aside).
 *   3. Re-indexes every material whose text or digest changed or whose hold
 *      was released, waits for the queue, then refreshes the program index
 *      (cross-course spine) for each touched course. Program chunks are
 *      restamped with snapshotId = null, as rebuildProgramIndex does; the next
 *      snapshot restamps them.
 *   4. Scans the published wiki for email/CUID patterns; with --wiki,
 *      republishes those pages through writeAndPush (which scrubs them).
 *
 * Usage (from the deploy checkout, after migration 0052 + deploy):
 *   pnpm exec tsx --env-file=.env.local scripts/privacy/backfill-scrub.ts --dry-run [--course "GC 3620"]
 *   pnpm exec tsx --env-file=.env.local scripts/privacy/backfill-scrub.ts --apply [--course "GC 3620"] [--wiki]
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
import { isRetiredPrivacyHold, scanWikiForIdentifiers } from '@/lib/privacy/backfill';
import { isSyllabusFileName } from '@/lib/capture/materials-policy';
import { enqueue } from '@/lib/capture/ingest-queue';
import { createVectorStore, tenantForCourse } from '@/lib/capture/vector-store';
import { refreshProgramIndex } from '@/lib/capture/program-index';
import { readWikiPage, writeAndPush, wikiRepoPath, WikiPagesWithheldError } from '@/lib/wiki/git-ops';

type Mode = 'dry-run' | 'apply';

interface Tally {
  scanned: number; textChanged: number; digestChanged: number; failed: number;
  released: number; reindexed: number; names: number; ids: number; emails: number;
}

function parseArgs(argv: string[]): { mode: Mode; course: string | null; wiki: boolean } {
  const dry = argv.includes('--dry-run');
  const apply = argv.includes('--apply');
  if (dry === apply) {
    console.error('Pass exactly one of --dry-run or --apply.');
    process.exit(2);
  }
  const ci = argv.indexOf('--course');
  const wiki = argv.includes('--wiki');
  if (wiki && dry) {
    console.error('--wiki republishes pages; use it only with --apply.');
    process.exit(2);
  }
  return { mode: dry ? 'dry-run' : 'apply', course: ci >= 0 ? argv[ci + 1] ?? null : null, wiki };
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

  for (const row of rows) {
    const t = tallies.get(row.courseCode) ?? { scanned: 0, textChanged: 0, digestChanged: 0, failed: 0, released: 0, reindexed: 0, names: 0, ids: 0, emails: 0 };
    tallies.set(row.courseCode, t);
    t.scanned++;
    const opts = { fileName: row.fileName, isSyllabus: row.isSyllabus === true || isSyllabusFileName(row.fileName) };
    let textChanged = false;
    let digestChanged = false;
    let failed = false;
    let storedText: string | undefined;

    if (row.extractedText !== null) {
      if (mode === 'dry-run') {
        try {
          storedText = (await scrubForRecord(row.extractedText, opts)).text;
        } catch (err) {
          failed = true;
          console.log(`  ! ${row.courseCode} ${row.id}: scrub would fail — ${msg(err)}`);
        }
      } else {
        const p = await updateExtractionResult({
          id: row.id,
          extractionStatus: row.extractionStatus as ExtractionStatus,
          extractedText: row.extractedText,
        });
        if (p.outcome === 'scrub_failed') {
          failed = true;
          console.log(`  ! ${row.courseCode} ${row.id}: scrub failed, text cleared — ${p.reason}`);
        } else {
          storedText = p.extractedText;
        }
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
        const s = await scrubForRecord(row.digest, opts);
        digestChanged = s.text !== row.digest;
        if (mode === 'apply' && digestChanged) await setScrubbedDigest(row.id, s.text);
      } catch (err) {
        digestChanged = true;
        console.log(`  ! ${row.courseCode} ${row.id}: digest scrub ${mode === 'apply' ? 'failed, digest cleared' : 'would fail'} — ${msg(err)}`);
        if (mode === 'apply') await setScrubbedDigest(row.id, null);
      }
    }

    if (textChanged) t.textChanged++;
    if (digestChanged) t.digestChanged++;

    if (failed) {
      t.failed++;
      if (mode === 'apply') {
        await vectorStore!.deleteByMaterial(tenantForCourse(row.courseCode), row.id);
        await updateIndexingStatus({ id: row.id, status: 'failed' });
        touchedCourses.add(row.courseCode);
      }
      continue;
    }

    const release = isRetiredPrivacyHold(row);
    if (release) {
      t.released++;
      if (mode === 'apply') {
        await updateAutoSetAside({ id: row.id, autoSetAside: false, setAsideReason: null, ignored: false });
      }
    }

    if (row.extractedText !== null && (textChanged || digestChanged || release)) {
      t.reindexed++;
      if (mode === 'apply') {
        await enqueue(row.id);
        reindexIds.push(row.id);
        touchedCourses.add(row.courseCode);
      }
    }
  }

  console.log('\ncourse | scanned | text changed | digest changed | failed | holds released | re-index | [student] | [student ID] | [email]');
  for (const [code, t] of [...tallies.entries()].sort()) {
    console.log(`${code} | ${t.scanned} | ${t.textChanged} | ${t.digestChanged} | ${t.failed} | ${t.released} | ${t.reindexed} | ${t.names} | ${t.ids} | ${t.emails}`);
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
