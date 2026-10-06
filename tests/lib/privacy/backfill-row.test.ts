// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { applyBackfillRow, type BackfillRow, type BackfillDeps } from '@/lib/privacy/backfill';

/**
 * Per-row --apply logic of scripts/privacy/backfill-scrub.ts. Invariant: every
 * stored copy derived from a material (extracted_text, digest, chunks) is
 * scrubbed or absent once the row is processed, and a re-run after a crash at
 * any step converges to that state.
 */

const BASE: BackfillRow = {
  id: 'm1',
  courseCode: 'GC 3620',
  fileName: 'Canvas File: critiques.pdf',
  isSyllabus: false,
  extractedText: 'Submitted by Jane Doe',
  extractionStatus: 'ok',
  digest: 'Digest: critique of a poster.',
  autoSetAside: false,
  setAsideReason: null,
};

interface FakeOpts {
  fresh?: { retiredAt: Date | null; extractedText: string | null; digest: string | null } | null;
  stored?: { outcome: 'stored'; extractedText?: string } | { outcome: 'scrub_failed'; extractedText?: undefined; reason: string };
  scrubDigest?: (d: string) => Promise<string>;
}

function fakeDeps(row: BackfillRow, o: FakeOpts = {}) {
  const log: string[] = [];
  const deps: BackfillDeps = {
    getMaterial: async () => {
      log.push('read');
      return o.fresh === undefined ? { retiredAt: null, extractedText: row.extractedText, digest: row.digest } : o.fresh;
    },
    writeText: async () => {
      log.push('write');
      return o.stored ?? { outcome: 'stored', extractedText: row.extractedText ?? undefined };
    },
    scrubDigest: async (d) => {
      log.push('scrub-digest');
      return o.scrubDigest ? o.scrubDigest(d) : d;
    },
    setDigest: async (_id, d) => { log.push(`set-digest:${d === null ? 'null' : d}`); },
    deleteVectors: async () => { log.push('delete-vectors'); },
    markIndexFailed: async () => { log.push('mark-failed'); },
    releaseHold: async () => { log.push('release'); },
    enqueue: async () => { log.push('enqueue'); },
  };
  return { deps, log };
}

describe('applyBackfillRow', () => {
  it('changed text: write, then delete vectors and clear the digest, then enqueue', async () => {
    const { deps, log } = fakeDeps(BASE, { stored: { outcome: 'stored', extractedText: 'Submitted by [student]' } });
    const r = await applyBackfillRow(BASE, deps);
    expect(log).toEqual(['read', 'write', 'delete-vectors', 'set-digest:null', 'enqueue']);
    expect(r).toMatchObject({ kind: 'done', textChanged: true, reindex: true, touched: true, failed: false });
  });

  it('digest-only row (text NULL) whose digest changes: stores the scrubbed digest and deletes vectors, no enqueue', async () => {
    const row = { ...BASE, extractedText: null, digest: 'Digest: Contact C12345678' };
    const { deps, log } = fakeDeps(row, { scrubDigest: async () => 'Digest: Contact [student ID]' });
    const r = await applyBackfillRow(row, deps);
    expect(log).toEqual(['read', 'scrub-digest', 'delete-vectors', 'set-digest:Digest: Contact [student ID]']);
    expect(r).toMatchObject({ kind: 'done', digestChanged: true, reindex: false, touched: true });
  });

  it('digest-only row whose digest cannot be scrubbed: clears it and deletes vectors', async () => {
    const row = { ...BASE, extractedText: null, digest: 'Digest: Submitted by Jane Doe' };
    const { deps, log } = fakeDeps(row, { scrubDigest: async () => { throw new Error('privacy-scrub guard rejected chunk 1/1'); } });
    const r = await applyBackfillRow(row, deps);
    expect(log).toEqual(['read', 'scrub-digest', 'delete-vectors', 'set-digest:null']);
    expect(r).toMatchObject({ kind: 'done', digestChanged: true, reindex: false, touched: true });
  });

  it('text unchanged but digest changed: delete vectors, clear digest, enqueue', async () => {
    const row = { ...BASE, extractedText: 'Plain notes.', digest: 'Digest: by Jane Doe C12345678' };
    const { deps, log } = fakeDeps(row, { scrubDigest: async () => 'Digest: by Jane Doe [student ID]' });
    await applyBackfillRow(row, deps);
    expect(log).toEqual(['read', 'write', 'scrub-digest', 'delete-vectors', 'set-digest:null', 'enqueue']);
  });

  it('unchanged text and digest with no placeholders: nothing is deleted, cleared or enqueued', async () => {
    const row = { ...BASE, extractedText: 'Plain notes.' };
    const { deps, log } = fakeDeps(row);
    const r = await applyBackfillRow(row, deps);
    expect(log).toEqual(['read', 'write', 'scrub-digest']);
    expect(r).toMatchObject({ kind: 'done', textChanged: false, digestChanged: false, reindex: false, touched: false });
  });

  it('retired during the run: skipped, nothing written', async () => {
    const { deps, log } = fakeDeps(BASE, { fresh: { retiredAt: new Date(), extractedText: BASE.extractedText, digest: BASE.digest } });
    expect(await applyBackfillRow(BASE, deps)).toEqual({ kind: 'skipped' });
    expect(log).toEqual(['read']);
  });

  it('deleted during the run: skipped', async () => {
    const { deps, log } = fakeDeps(BASE, { fresh: null });
    expect(await applyBackfillRow(BASE, deps)).toEqual({ kind: 'skipped' });
    expect(log).toEqual(['read']);
  });

  it('text or digest changed by a concurrent ingest during the run: skipped, nothing written', async () => {
    for (const fresh of [
      { retiredAt: null, extractedText: 'freshly re-extracted', digest: BASE.digest },
      { retiredAt: null, extractedText: BASE.extractedText, digest: 'new digest' },
    ]) {
      const { deps, log } = fakeDeps(BASE, { fresh });
      expect(await applyBackfillRow(BASE, deps)).toEqual({ kind: 'skipped' });
      expect(log).toEqual(['read']);
    }
  });

  it('re-run after a crash between the text write and the vector delete: purges and re-indexes (converges)', async () => {
    // First run stored 'Submitted by [student]' then died. The text is now the
    // scrubber's output, so the write returns it unchanged — but the vectors
    // and digest may still be derived from the raw text.
    const row = { ...BASE, extractedText: 'Submitted by [student]' };
    const { deps, log } = fakeDeps(row);
    const r = await applyBackfillRow(row, deps);
    expect(log).toEqual(['read', 'write', 'delete-vectors', 'set-digest:null', 'enqueue']);
    expect(r).toMatchObject({ kind: 'done', textChanged: false, reindex: true, touched: true });
  });

  it('re-run after a crash on a digest-only row: deletes vectors again', async () => {
    const row = { ...BASE, extractedText: null, digest: 'Digest: Contact [student ID]' };
    const { deps, log } = fakeDeps(row);
    await applyBackfillRow(row, deps);
    expect(log).toContain('delete-vectors');
    expect(log).not.toContain('enqueue');
  });

  it('scrub failure: text already cleared by the writer; delete vectors, mark failed, no enqueue, hold not released', async () => {
    const row = { ...BASE, autoSetAside: true, setAsideReason: 'Contains student posts' };
    const { deps, log } = fakeDeps(row, { stored: { outcome: 'scrub_failed', reason: 'guard rejected chunk 1/1' } });
    const r = await applyBackfillRow(row, deps);
    expect(log).toEqual(['read', 'write', 'scrub-digest', 'delete-vectors', 'mark-failed']);
    expect(r).toMatchObject({ kind: 'done', failed: true, failReason: 'guard rejected chunk 1/1', released: false, reindex: false, touched: true });
  });

  it('released hold with unchanged text: delete vectors, clear digest, release, enqueue', async () => {
    const row = { ...BASE, extractedText: 'Plain notes.', autoSetAside: true, setAsideReason: 'FERPA risk detected (emails)' };
    const { deps, log } = fakeDeps(row);
    const r = await applyBackfillRow(row, deps);
    expect(log).toEqual(['read', 'write', 'delete-vectors', 'set-digest:null', 'release', 'enqueue']);
    expect(r).toMatchObject({ kind: 'done', released: true, reindex: true });
  });
});
