/** Read-only against the scratch clone's real snapshots; one rolled-back write for embeddings. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseSkillItems, ensureCourseSkillEmbeddings, loadProjectTrail, loadBuildingProjects } from '@/lib/db/project-trail-queries';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { isP2ScratchDb } from './p2/scratch-guard';

class Rollback extends Error {}

async function aSnapshotWithProjects(): Promise<string | null> {
  const r = (await db.execute(sql`SELECT id FROM course_capture_snapshots WHERE retired_at IS NULL
    AND jsonb_typeof(profile->'major_projects') = 'array' AND jsonb_array_length(profile->'major_projects') > 0 ORDER BY created_at DESC LIMIT 1`)).rows[0] as { id: string } | undefined;
  return r?.id ?? null;
}

describe('courseSkillItems', () => {
  it('de-duplicates by normalized text and uses kind course_skill', () => {
    const items = courseSkillItems(['Color proofing', ' color  PROOFING', 'Press']);
    expect(items.map(i => [i.kind, i.text])).toEqual([['course_skill', 'Color proofing'], ['course_skill', 'Press']]);
  });
});

describe.skipIf(!isP2ScratchDb())('project trail queries (scratch)', () => {
  it('every trail competency, on every snapshot, is a coverage cell the scorer matched to that statement', async () => {
    const snaps = (await db.execute(sql`SELECT id FROM course_capture_snapshots WHERE retired_at IS NULL AND jsonb_typeof(profile->'major_projects') = 'array'`)).rows as Array<{ id: string }>;
    let linked = 0;
    for (const { id } of snaps) {
      const cells = (await db.execute(sql`SELECT competency_id AS c, matched_competency AS m FROM snapshot_competency_coverage WHERE snapshot_id = ${id} AND matched_competency IS NOT NULL`)).rows as Array<{ c: string; m: string }>;
      const ok = new Set(cells.map(x => `${normalizeStatement(x.m)}|${x.c}`));
      for (const p of await loadProjectTrail(db, id)) for (const s of p.skills) for (const c of s.competencies) {
        expect(ok.has(`${normalizeStatement(s.statement)}|${c.id}`)).toBe(true);
        linked++;
      }
    }
    expect(linked).toBeGreaterThan(0);
  });

  it('a skill whose embedding equals one of its competency’s bundle items gets that item first', async () => {
    // Find a linked (snapshot, statement, competency) whose competency has an embedded core/related task.
    const snaps = (await db.execute(sql`SELECT id FROM course_capture_snapshots WHERE retired_at IS NULL AND jsonb_typeof(profile->'major_projects') = 'array'`)).rows as Array<{ id: string }>;
    for (const { id } of snaps) {
      for (const p of await loadProjectTrail(db, id)) for (const s of p.skills) for (const c of s.competencies) {
        const task = (await db.execute(sql`SELECT m.external_label AS label FROM bundle_members m
          WHERE m.bundle_id = ${c.id} AND m.source = 'onet_task' AND m.status IN ('confirmed','proposed') AND m.position IN ('core','related') LIMIT 1`)).rows[0] as { label: string } | undefined;
        if (!task) continue;
        const { taskGroupKey } = await import('@/lib/catalog/shortlist');
        const vec = (await db.execute(sql`SELECT vector FROM item_embeddings WHERE kind = 'onet_task' AND ref = ${taskGroupKey(task.label)} LIMIT 1`)).rows[0] as { vector: number[] } | undefined;
        if (!vec) continue;
        await db.transaction(async (tx) => {
          const { courseSkillItems } = await import('@/lib/db/project-trail-queries');
          const item = courseSkillItems([s.statement])[0]!;
          const { DEFAULT_EMBEDDING_MODEL } = await import('@/lib/ai/embeddings');
          const { textHash } = await import('@/lib/catalog/bundles');
          const { itemEmbeddings } = await import('@/lib/db/schema');
          await tx.insert(itemEmbeddings).values({ kind: 'course_skill', ref: item.ref, model: DEFAULT_EMBEDDING_MODEL, textHash: textHash(item.text), vector: vec.vector }).onConflictDoNothing();
          const trail = await loadProjectTrail(tx, id);
          const hit = trail.flatMap(pp => pp.skills).find(ss => ss.statement === s.statement)!.competencies.find(cc => cc.id === c.id)!;
          expect(hit.onet[0]).toMatchObject({ label: task.label, source: 'onet_task' });
          expect(hit.onet[0]!.similarity).toBeCloseTo(1);
          throw new Rollback('rollback');
        }).catch(e => { if (!(e instanceof Rollback)) throw e; });
        return;
      }
    }
    throw new Error('no linked skill with an embedded bundle task on this clone');
  });

  it('with no course_skill embeddings, skills carry no O*NET items and nothing throws', async () => {
    const id = await aSnapshotWithProjects();
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM item_embeddings WHERE kind = 'course_skill'`);
      const trail = await loadProjectTrail(tx, id!);
      for (const p of trail) for (const s of p.skills) for (const c of s.competencies) expect(c.onet).toEqual([]);
      throw new Rollback('rollback');
    }).catch(e => { if (!(e instanceof Rollback)) throw e; });
  });

  it('ensureCourseSkillEmbeddings embeds missing statements once and reports failure without throwing', async () => {
    const id = await aSnapshotWithProjects();
    await db.transaction(async (tx) => {
      let calls = 0;
      const fake = async (texts: string[]) => { calls++; return texts.map(() => [1, 0, 0]); };
      const first = await ensureCourseSkillEmbeddings(tx, id!, fake);
      expect(first.ok).toBe(true);
      expect(first.embedded).toBeGreaterThan(0);
      const second = await ensureCourseSkillEmbeddings(tx, id!, fake);
      expect(second).toEqual({ ok: true, embedded: 0 });
      expect(calls).toBe(1);
      const failed = await ensureCourseSkillEmbeddings(tx, '00000000-0000-0000-0000-000000000000', async () => { throw new Error('endpoint down'); });
      expect(failed.ok).toBe(true); // nothing to embed for an unknown snapshot
      await tx.execute(sql`DELETE FROM item_embeddings WHERE kind = 'course_skill'`);
      const down = await ensureCourseSkillEmbeddings(tx, id!, async () => { throw new Error('endpoint down'); });
      expect(down.ok).toBe(false);
      throw new Rollback('rollback');
    }).catch(e => { if (!(e instanceof Rollback)) throw e; });
  });

  it('loadBuildingProjects returns only skills that feed the competency', async () => {
    const id = await aSnapshotWithProjects();
    const trail = await loadProjectTrail(db, id!);
    const comp = trail.flatMap(p => p.skills.flatMap(s => s.competencies.map(c => c.id)))[0];
    if (!comp) return; // that snapshot has no matched project skills on this clone
    const rows = await loadBuildingProjects(db, comp);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(typeof r.project).toBe('string');
  });

  it('the competency wiki substrate carries buildingProjects', async () => {
    const snaps = (await db.execute(sql`SELECT id FROM course_capture_snapshots WHERE retired_at IS NULL AND jsonb_typeof(profile->'major_projects') = 'array'`)).rows as Array<{ id: string }>;
    let comp: string | undefined;
    for (const { id } of snaps) {
      comp = (await loadProjectTrail(db, id)).flatMap(p => p.skills.flatMap(s => s.competencies.map(c => c.id)))[0];
      if (comp) break;
    }
    expect(comp).toBeDefined();
    const { loadCompetencySubstrate } = await import('@/lib/ai/wiki/update');
    const sub = await loadCompetencySubstrate(comp!);
    expect(sub.buildingProjects.length).toBeGreaterThan(0);
  });
});
