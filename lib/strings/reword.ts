import { and, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { stringPointResolutions } from '@/lib/db/schema';
import { embedMissing, readVectors } from '@/lib/db/bundle-queries';
import { embedBatch, cosineSimilarity, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { judgePairs, CUTOFFS, MODEL_IN_USE, PROMPT_VERSION, type PairText } from '@/lib/ai/match-judge';
import type { PointRow, PointStatus } from '@/lib/builder/strings/types';

// The pair shortlist: 8, as in app/api/build/match/route.ts.
const TOP = 8;
const model = MODEL_IN_USE;

export type RewordItem = { point: PointRow; snapshotId: string; pool: Array<{ statement: string; hash: string }> };

/**
 * Asks whether a point's skill was reworded in the current capture. A candidate must reach the judge's FULLY cutoff
 * (the partly cutoff accepts nearly every shortlisted pair); none = the skill is gone. Results are cached per
 * (point, snapshot, model, prompt version). Any campus error leaves those points `unchecked` and caches nothing.
 */
export async function checkRewords(items: RewordItem[]): Promise<Record<string, PointStatus>> {
  const out: Record<string, PointStatus> = {};
  if (items.length === 0) return out;

  const rows = await db.select().from(stringPointResolutions).where(and(
    inArray(stringPointResolutions.pointId, items.map((i) => i.point.id)),
    inArray(stringPointResolutions.snapshotId, [...new Set(items.map((i) => i.snapshotId))]),
  ));
  const cached = new Map(rows
    .filter((r) => r.model === model && r.promptVersion === PROMPT_VERSION)
    .map((r) => [`${r.pointId}|${r.snapshotId}`, r]));
  const misses: RewordItem[] = [];
  for (const it of items) {
    const r = cached.get(`${it.point.id}|${it.snapshotId}`);
    // A cached `changed` is stale if its candidate left the pool. A cached `unanchored` stays usable: the pool can only
    // shrink within a snapshot (growth means a recapture, which changes snapshot_id and so the key).
    if (!r || (r.status === 'changed' && !it.pool.some((s) => s.hash === r.candidateHash))) misses.push(it);
    else out[it.point.id] = r.status === 'changed' && r.candidateStatement && r.candidateHash
      ? { kind: 'changed', now: null, candidate: { statement: r.candidateStatement, hash: r.candidateHash } }
      : { kind: 'unanchored', why: 'skill gone' };
  }
  if (misses.length === 0) return out;

  let vecs: Map<string, number[]>;
  try {
    const all = new Map<string, { kind: 'course_skill'; ref: string; text: string }>();
    for (const it of misses) {
      all.set(it.point.statementHash, { kind: 'course_skill', ref: it.point.statementHash, text: it.point.statement });
      for (const s of it.pool) all.set(s.hash, { kind: 'course_skill', ref: s.hash, text: s.statement });
    }
    const wanted = [...all.values()];
    await embedMissing(db, wanted, DEFAULT_EMBEDDING_MODEL, (t) => embedBatch(t));
    vecs = await readVectors(db, 'course_skill', wanted, DEFAULT_EMBEDDING_MODEL);
  } catch {
    for (const it of misses) out[it.point.id] = { kind: 'unchecked' };
    return out;
  }

  for (const it of misses) {
    try {
      const pv = vecs.get(it.point.statementHash);
      const top = it.pool
        .filter((s) => vecs.has(s.hash))
        .map((s) => ({ s, sim: pv ? cosineSimilarity(pv, vecs.get(s.hash)!) : 0 }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, TOP);
      const pairs: PairText[] = top.map(({ s }) => ({
        requiredText: it.point.statement, requiredCourse: it.point.courseCode, requiredTitle: '',
        suppliedText: s.statement, suppliedCourse: it.point.courseCode, suppliedTitle: '',
      }));
      if (pairs.length === 0) throw new Error('no vectors'); // a transient gap must not be cached as 'skill gone'
      const judged = pairs.length ? await judgePairs(pairs, { model }) : [];
      if (judged.some((j) => j.pFully === null || j.pPartly === null)) throw new Error('no answer');
      type Best = { s: { statement: string; hash: string }; pFully: number; pPartly: number };
      let hit: Best | null = null;
      for (let i = 0; i < top.length; i++) {
        const j = judged[i]!;
        if (j.pFully! >= CUTOFFS[model].fully && (hit === null || j.pFully! > hit.pFully)) hit = { s: top[i]!.s, pFully: j.pFully!, pPartly: j.pPartly! };
      }
      await db.insert(stringPointResolutions).values({
        pointId: it.point.id, snapshotId: it.snapshotId,
        status: hit ? 'changed' : 'unanchored',
        candidateStatement: hit?.s.statement ?? null, candidateHash: hit?.s.hash ?? null,
        pFully: hit?.pFully ?? null, model, promptVersion: PROMPT_VERSION,
      }).onConflictDoUpdate({
        target: [stringPointResolutions.pointId, stringPointResolutions.snapshotId, stringPointResolutions.model, stringPointResolutions.promptVersion],
        set: { status: hit ? 'changed' : 'unanchored', candidateStatement: hit?.s.statement ?? null, candidateHash: hit?.s.hash ?? null, pFully: hit?.pFully ?? null },
      });
      out[it.point.id] = hit
        ? { kind: 'changed', now: null, candidate: { statement: hit.s.statement, hash: hit.s.hash } }
        : { kind: 'unanchored', why: 'skill gone' };
    } catch {
      out[it.point.id] = { kind: 'unchecked' };
    }
  }
  return out;
}
