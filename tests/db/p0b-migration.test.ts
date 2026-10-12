// @vitest-environment node
// Migration 0057 (P0b) rehearsal. Gated on a P0b clone (either
// gc_curriculum_p0b_scratch or gc_curriculum_p0b_pre — isP0bScratchDb()
// accepts both), but every test runs 0057's body inside its own
// BEGIN … ROLLBACK, so it is safe to run against gc_curriculum_p0b_pre,
// which must stay pre-0057 forever. Never leaves any mutation behind.
//
// Every "expected" value below is computed independently in TypeScript
// from rows read BEFORE the migration body runs in that test — not by
// reusing the migration's own SQL — so the test can actually catch a bug
// in that SQL instead of restating it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { isP0bScratchDb } from './p0b/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_RAW = readFileSync(resolve(ROOT, 'drizzle/0057_competency_catalog_p0b.sql'), 'utf8');
// Strip the file's own BEGIN;/COMMIT; so each test can run the body inside
// its own transaction (same technique the P0a reviewer used for 0056).
const MIGRATION_BODY = MIGRATION_RAW
  .split('\n')
  .filter((line) => line.trim() !== 'BEGIN;' && line.trim() !== 'COMMIT;')
  .join('\n');

const RUN = isP0bScratchDb();

// --- Merge plan, verbatim from the migration (owner decisions 2026-10-12). ---
const SURVIVOR_OF: Record<string, string> = {
  'gc-production-literacy': 'domain-knowledge',
  'domain-grounding': 'domain-knowledge',
  'timeline-management': 'project-management',
};
const MERGED_AWAY = Object.keys(SURVIVOR_OF);
const SURVIVORS = ['domain-knowledge', 'project-management'];

function groupMembersOf(survivor: string): string[] {
  return [survivor, ...MERGED_AWAY.filter((m) => SURVIVOR_OF[m] === survivor)];
}

const confRank = (c: string): number => (c === 'high' ? 0 : c === 'medium' ? 1 : 2);

/** Ranking comparator shared by the three carry rules (Rulings 3 and 6):
 * highest numeric keys first (nulls treated as -1 unless noted), then
 * highest confidence, then the survivor's own row, then id order. */
function rankerFor<T>(survivor: string, idOf: (t: T) => string, confOf: (t: T) => string, numKeysOf: (t: T) => number[]) {
  return (a: T, b: T): number => {
    const ak = numKeysOf(a);
    const bk = numKeysOf(b);
    for (let i = 0; i < ak.length; i++) {
      if (ak[i]! !== bk[i]!) return bk[i]! - ak[i]!;
    }
    const ac = confRank(confOf(a));
    const bc = confRank(confOf(b));
    if (ac !== bc) return ac - bc;
    const aSurv = idOf(a) === survivor ? 1 : 0;
    const bSurv = idOf(b) === survivor ? 1 : 0;
    if (aSurv !== bSurv) return bSurv - aSurv;
    return idOf(a).localeCompare(idOf(b));
  };
}

function pickBest<T>(survivor: string, idOf: (t: T) => string, confOf: (t: T) => string, numKeysOf: (t: T) => number[], items: T[]): T {
  return [...items].sort(rankerFor(survivor, idOf, confOf, numKeysOf))[0]!;
}

type CovRow = {
  snapshot_id: string;
  competency_id: string;
  k_depth: number | null;
  u_depth: number | null;
  d_depth: number;
  matched_competency: string | null;
  evidence_excerpt: string | null;
  confidence: string;
  rationale: string;
  model: string;
  generated_at: string;
};

type IntendedRow = {
  course_code: string;
  sub_competency_id: string;
  intended_k: number | null;
  intended_u: number | null;
  intended_d: number | null;
  confidence: string;
  rationale: string;
  model: string;
  generated_at: string;
};

describe.skipIf(!RUN)('migration 0057 (P0b) on a P0b clone, each test self-contained', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Run fn inside BEGIN … ROLLBACK on a dedicated client. Always rolls
   * back, so nothing a test does — including a failed migration run —
   * ever persists. */
  async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      try {
        return await fn(c);
      } finally {
        await c.query('ROLLBACK');
      }
    } finally {
      c.release();
    }
  }

  const q = async <T = Record<string, unknown>>(c: PoolClient, text: string, params: unknown[] = []) =>
    (await c.query(text, params)).rows as T[];

  it('1. new descriptors, retirements/merged_into, display_order placements, requirement count = 35', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY);

      const [dk, pm] = await q<{ id: string; name: string; know_descriptor: string; understand_descriptor: string; do_descriptor: string }>(
        c,
        `SELECT id, name, know_descriptor, understand_descriptor, do_descriptor FROM sub_competencies WHERE id IN ('domain-knowledge','project-management') ORDER BY id`,
      );
      expect(dk!.id).toBe('domain-knowledge');
      expect(dk!.name).toBe('Production domain knowledge: processes, substrates, materials and equipment');
      expect(dk!.know_descriptor).toMatch(/substrates, inks, finishing/);
      expect(dk!.understand_descriptor).toMatch(/material, process and equipment constraints/);
      expect(dk!.do_descriptor).toMatch(/Color management/);
      expect(pm!.id).toBe('project-management');
      expect(pm!.know_descriptor).toMatch(/work breakdown, dependencies, critical path/);
      expect(pm!.understand_descriptor).toMatch(/fail at scope and handoff/);
      expect(pm!.do_descriptor).toMatch(/lessons-learned record/);

      const merged = await q<{ id: string; retired: boolean; merged_into: string | null; req_count: string }>(
        c,
        `SELECT s.id, s.retired, s.merged_into,
                (SELECT count(*) FROM career_target_requirements r WHERE r.competency_id = s.id)::text AS req_count
         FROM sub_competencies s WHERE s.id IN ('gc-production-literacy','domain-grounding','timeline-management') ORDER BY s.id`,
      );
      for (const row of merged) {
        expect(row.retired).toBe(true);
        expect(row.merged_into).toBe(SURVIVOR_OF[row.id]);
        expect(row.req_count).toBe('0');
      }

      const [acctMgmt] = await q<{ display_order: number }>(
        c,
        `SELECT display_order FROM career_target_requirements WHERE career_target_id = 'account-management' AND competency_id = 'domain-knowledge'`,
      );
      expect(acctMgmt!.display_order).toBe(4);

      const [aiWorkflow] = await q<{ display_order: number }>(
        c,
        `SELECT display_order FROM career_target_requirements WHERE career_target_id = 'ai-workflow' AND competency_id = 'domain-knowledge'`,
      );
      expect(aiWorkflow!.display_order).toBe(8);

      const noTimeline = await q(
        c,
        `SELECT 1 FROM career_target_requirements WHERE career_target_id = 'production-operations' AND competency_id = 'timeline-management'`,
      );
      expect(noTimeline).toEqual([]);

      const { n } = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM career_target_requirements`))[0]!;
      expect(n).toBe('35');
    });
  });

  it('2. coverage carry equals the highest-evidence group member per snapshot (Ruling 3)', async () => {
    await withTx(async (c) => {
      const before = await q<CovRow>(
        c,
        `SELECT snapshot_id::text, competency_id, k_depth, u_depth, d_depth, matched_competency,
                evidence_excerpt, confidence, rationale, model, generated_at::text
         FROM snapshot_competency_coverage WHERE competency_id IN ('domain-knowledge','gc-production-literacy','domain-grounding','project-management','timeline-management')`,
      );

      const expected = new Map<string, CovRow>(); // key: `${snapshotId}|${survivor}`
      for (const survivor of SURVIVORS) {
        const members = new Set(groupMembersOf(survivor));
        const bySnapshot = new Map<string, CovRow[]>();
        for (const row of before) {
          if (!members.has(row.competency_id)) continue;
          const arr = bySnapshot.get(row.snapshot_id) ?? [];
          arr.push(row);
          bySnapshot.set(row.snapshot_id, arr);
        }
        for (const [snapshotId, rows] of bySnapshot) {
          const winner = pickBest(
            survivor,
            (r: CovRow) => r.competency_id,
            (r: CovRow) => r.confidence,
            (r: CovRow) => [r.d_depth, r.u_depth ?? -1, r.k_depth ?? -1],
            rows,
          );
          expected.set(`${snapshotId}|${survivor}`, winner);
        }
      }

      await c.query(MIGRATION_BODY);

      const after = await q<CovRow>(
        c,
        `SELECT snapshot_id::text, competency_id, k_depth, u_depth, d_depth, matched_competency,
                evidence_excerpt, confidence, rationale, model, generated_at::text
         FROM snapshot_competency_coverage WHERE competency_id IN ('domain-knowledge','project-management')`,
      );
      const afterMap = new Map(after.map((r) => [`${r.snapshot_id}|${r.competency_id}`, r]));

      expect(afterMap.size).toBe(expected.size);
      for (const [key, winner] of expected) {
        const row = afterMap.get(key);
        expect(row, `missing carried cell for ${key}`).toBeDefined();
        expect(row!.k_depth).toBe(winner.k_depth);
        expect(row!.u_depth).toBe(winner.u_depth);
        expect(row!.d_depth).toBe(winner.d_depth);
        expect(row!.matched_competency).toBe(winner.matched_competency);
        expect(row!.evidence_excerpt).toBe(winner.evidence_excerpt);
        expect(row!.confidence).toBe(winner.confidence);
        expect(row!.model).toBe(winner.model);
        expect(row!.generated_at).toBe(winner.generated_at);
        const survivor = key.split('|')[1]!;
        if (winner.competency_id === survivor) {
          expect(row!.rationale).toBe(winner.rationale);
        } else {
          expect(row!.rationale).toBe(`[P0b merge: carried from ${winner.competency_id}] ${winner.rationale}`);
        }
      }
    });
  });

  it('3. p0b_premerge_survivor_coverage equals the survivors’ cells as read before the migration', async () => {
    await withTx(async (c) => {
      const before = await q<CovRow>(
        c,
        `SELECT snapshot_id::text, competency_id, k_depth, u_depth, d_depth, matched_competency,
                evidence_excerpt, confidence, rationale, model, generated_at::text
         FROM snapshot_competency_coverage WHERE competency_id IN ('domain-knowledge','project-management')
         ORDER BY snapshot_id, competency_id`,
      );

      await c.query(MIGRATION_BODY);

      const captured = await q<CovRow>(
        c,
        `SELECT snapshot_id::text, competency_id, k_depth, u_depth, d_depth, matched_competency,
                evidence_excerpt, confidence, rationale, model, generated_at::text
         FROM p0b_premerge_survivor_coverage ORDER BY snapshot_id, competency_id`,
      );
      expect(captured).toEqual(before);
    });
  });

  it('4. one open disagreement flag per (course, survivor) with a 2+ gap on some non-retired snapshot, none otherwise', async () => {
    await withTx(async (c) => {
      const before = await q<CovRow & { course_code: string; retired_at: string | null }>(
        c,
        `SELECT c.snapshot_id::text, c.competency_id, c.k_depth, c.u_depth, c.d_depth, c.matched_competency,
                c.evidence_excerpt, c.confidence, c.rationale, c.model, c.generated_at::text,
                s.course_code, s.retired_at::text AS retired_at
         FROM snapshot_competency_coverage c
         JOIN course_capture_snapshots s ON s.id = c.snapshot_id
         WHERE c.competency_id IN ('domain-knowledge','gc-production-literacy','domain-grounding','project-management','timeline-management')`,
      );

      // (course_code, survivor) -> max gap across its non-retired snapshots
      const maxGap = new Map<string, number>();
      for (const survivor of SURVIVORS) {
        const members = new Set(groupMembersOf(survivor));
        const bySnapshot = new Map<string, { course_code: string; retired: boolean; rows: typeof before }>();
        for (const row of before) {
          if (!members.has(row.competency_id)) continue;
          const entry = bySnapshot.get(row.snapshot_id) ?? { course_code: row.course_code, retired: row.retired_at !== null, rows: [] };
          entry.rows.push(row);
          bySnapshot.set(row.snapshot_id, entry);
        }
        for (const { course_code, retired, rows } of bySnapshot.values()) {
          if (retired) continue;
          const ks = rows.map((r) => r.k_depth ?? 0);
          const us = rows.map((r) => r.u_depth ?? 0);
          const ds = rows.map((r) => r.d_depth);
          const gap = Math.max(Math.max(...ks) - Math.min(...ks), Math.max(...us) - Math.min(...us), Math.max(...ds) - Math.min(...ds));
          const key = `${course_code}|${survivor}`;
          maxGap.set(key, Math.max(maxGap.get(key) ?? -Infinity, gap));
        }
      }
      const expectedFlaggedPairs = new Set([...maxGap.entries()].filter(([, g]) => g >= 2).map(([k]) => k));

      await c.query(MIGRATION_BODY);

      const flags = await q<{ course_code: string; sub_competency_id: string; status: string }>(
        c,
        `SELECT course_code, sub_competency_id, status FROM faculty_flags WHERE flagged_by = 'P0b merge (system)'`,
      );
      const actualPairs = new Set(flags.map((f) => `${f.course_code}|${f.sub_competency_id}`));
      expect(actualPairs).toEqual(expectedFlaggedPairs);
      // one flag per pair, all open
      const counts = new Map<string, number>();
      for (const f of flags) {
        expect(f.status).toBe('open');
        counts.set(`${f.course_code}|${f.sub_competency_id}`, (counts.get(`${f.course_code}|${f.sub_competency_id}`) ?? 0) + 1);
      }
      for (const n of counts.values()) expect(n).toBe(1);
    });
  });

  it('5. intended coverage carried to the survivor; no rows remain on merged-away ids', async () => {
    await withTx(async (c) => {
      const before = await q<IntendedRow>(
        c,
        `SELECT course_code, sub_competency_id, intended_k, intended_u, intended_d, confidence, rationale, model, generated_at::text
         FROM course_intended_coverage WHERE sub_competency_id IN ('domain-knowledge','gc-production-literacy','domain-grounding','project-management','timeline-management')`,
      );

      const expected = new Map<string, IntendedRow>(); // key: `${course_code}|${survivor}`
      for (const survivor of SURVIVORS) {
        const members = new Set(groupMembersOf(survivor));
        const byCourse = new Map<string, IntendedRow[]>();
        for (const row of before) {
          if (!members.has(row.sub_competency_id)) continue;
          const arr = byCourse.get(row.course_code) ?? [];
          arr.push(row);
          byCourse.set(row.course_code, arr);
        }
        for (const [courseCode, rows] of byCourse) {
          const winner = pickBest(
            survivor,
            (r: IntendedRow) => r.sub_competency_id,
            (r: IntendedRow) => r.confidence,
            (r: IntendedRow) => [r.intended_d ?? -1, r.intended_u ?? -1, r.intended_k ?? -1],
            rows,
          );
          expected.set(`${courseCode}|${survivor}`, winner);
        }
      }

      await c.query(MIGRATION_BODY);

      const gone = await q(
        c,
        `SELECT 1 FROM course_intended_coverage WHERE sub_competency_id IN ('gc-production-literacy','domain-grounding','timeline-management')`,
      );
      expect(gone).toEqual([]);

      const after = await q<IntendedRow>(
        c,
        `SELECT course_code, sub_competency_id, intended_k, intended_u, intended_d, confidence, rationale, model, generated_at::text
         FROM course_intended_coverage WHERE sub_competency_id IN ('domain-knowledge','project-management')`,
      );
      const afterMap = new Map(after.map((r) => [`${r.course_code}|${r.sub_competency_id}`, r]));
      expect(afterMap.size).toBe(expected.size);
      for (const [key, winner] of expected) {
        const row = afterMap.get(key);
        expect(row, `missing carried intended row for ${key}`).toBeDefined();
        expect(row!.intended_k).toBe(winner.intended_k);
        expect(row!.intended_u).toBe(winner.intended_u);
        expect(row!.intended_d).toBe(winner.intended_d);
        expect(row!.confidence).toBe(winner.confidence);
        expect(row!.rationale).toBe(winner.rationale);
        expect(row!.model).toBe(winner.model);
        expect(row!.generated_at).toBe(winner.generated_at);
      }
    });
  });

  it('6. prerequisite edges: confirmed beats depth; the loser is dropped and the winner is re-pointed to the survivor', async () => {
    await withTx(async (c) => {
      const [literacyEdge] = await q<{ id: string }>(
        c,
        `INSERT INTO prerequisite_edges (focal_course_code, prereq_course_code, sub_competency_id, expected_d, source, confidence, confirmed)
         VALUES ('ACCT 2010', 'ACCT 2020', 'gc-production-literacy', 2, 'test', 'high', true) RETURNING id::text`,
      );
      const [domainEdge] = await q<{ id: string }>(
        c,
        `INSERT INTO prerequisite_edges (focal_course_code, prereq_course_code, sub_competency_id, expected_d, source, confidence, confirmed)
         VALUES ('ACCT 2010', 'ACCT 2020', 'domain-knowledge', 4, 'test', 'high', false) RETURNING id::text`,
      );

      await c.query(MIGRATION_BODY);

      const remaining = await q<{ id: string; sub_competency_id: string; confirmed: boolean; expected_d: number }>(
        c,
        `SELECT id::text, sub_competency_id, confirmed, expected_d FROM prerequisite_edges
         WHERE focal_course_code = 'ACCT 2010' AND prereq_course_code = 'ACCT 2020'`,
      );
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(literacyEdge!.id);
      expect(remaining[0]!.sub_competency_id).toBe('domain-knowledge');
      expect(remaining[0]!.confirmed).toBe(true);
      expect(remaining[0]!.expected_d).toBe(2);
      // the other edge's id must be gone, not merely re-pointed under a new id
      const stillThere = await q(c, `SELECT 1 FROM prerequisite_edges WHERE id = $1::uuid`, [domainEdge!.id]);
      expect(stillThere).toEqual([]);
    });
  });

  it('7. faculty_flags on a merged-away id are re-pointed to the survivor', async () => {
    await withTx(async (c) => {
      const { id } = (
        await q<{ id: string }>(
          c,
          `INSERT INTO faculty_flags (target_kind, course_code, sub_competency_id, note, flagged_by)
           VALUES ('coverage_cell'::flag_target_kind, 'ACCT 2010', 'timeline-management', 'pre-existing test flag', 'test')
           RETURNING id::text`,
        )
      )[0]!;

      await c.query(MIGRATION_BODY);

      const [row] = await q<{ sub_competency_id: string; note: string }>(
        c,
        `SELECT sub_competency_id, note FROM faculty_flags WHERE id = $1::uuid`,
        [id],
      );
      expect(row!.sub_competency_id).toBe('project-management');
      expect(row!.note).toBe('pre-existing test flag');
    });
  });

  it('8. sub_competency_map has 36 rows: the 3 merges map to their survivor, the other 33 are identity', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY);

      const rows = await q<{ old_sub_competency_id: string; competency_id: string }>(
        c,
        `SELECT old_sub_competency_id, competency_id FROM sub_competency_map`,
      );
      expect(rows).toHaveLength(36);
      for (const row of rows) {
        if (row.old_sub_competency_id in SURVIVOR_OF) {
          expect(row.competency_id).toBe(SURVIVOR_OF[row.old_sub_competency_id]);
        } else {
          expect(row.competency_id).toBe(row.old_sub_competency_id);
        }
      }
      const merges = rows.filter((r) => r.old_sub_competency_id !== r.competency_id);
      const identities = rows.filter((r) => r.old_sub_competency_id === r.competency_id);
      expect(merges).toHaveLength(3);
      expect(identities).toHaveLength(33);
    });
  });

  it('9. P0a scaffolding is dropped: snapshot_target_coverage, coverage_scores, career_target_id, display_order', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY);

      const { stc, cs } = (
        await q<{ stc: string | null; cs: string | null }>(
          c,
          `SELECT to_regclass('public.snapshot_target_coverage')::text AS stc, to_regclass('public.coverage_scores')::text AS cs`,
        )
      )[0]!;
      expect(stc).toBeNull();
      expect(cs).toBeNull();

      const cols = await q<{ column_name: string }>(
        c,
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'sub_competencies' AND column_name IN ('career_target_id','display_order')`,
      );
      expect(cols).toEqual([]);
    });
  });

  it('10. running 0057 a second time in the same transaction raises "already applied" and changes nothing', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY);

      const reqCountBefore = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM career_target_requirements`))[0]!.n;
      const mapCountBefore = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM sub_competency_map`))[0]!.n;

      await c.query('SAVEPOINT before_second_run');
      await expect(c.query(MIGRATION_BODY)).rejects.toThrow(/0057: already applied/);
      await c.query('ROLLBACK TO SAVEPOINT before_second_run');

      const reqCountAfter = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM career_target_requirements`))[0]!.n;
      const mapCountAfter = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM sub_competency_map`))[0]!.n;
      expect(reqCountAfter).toBe(reqCountBefore);
      expect(mapCountAfter).toBe(mapCountBefore);
    });
  });

  it('11. a missing or already-retired merge competency raises "precondition" and changes nothing', async () => {
    await withTx(async (c) => {
      await c.query(`UPDATE sub_competencies SET retired = true WHERE id = 'domain-knowledge'`);
      await expect(c.query(MIGRATION_BODY)).rejects.toThrow(/0057: precondition/);
    });

    await withTx(async (c) => {
      await c.query(`DELETE FROM sub_competencies WHERE id = 'timeline-management'`);
      await expect(c.query(MIGRATION_BODY)).rejects.toThrow(/0057: precondition/);
    });
  });
});
