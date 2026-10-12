// @vitest-environment node
// Migration 0057 (P0b) rehearsal. Gated on gc_curriculum_p0b_pre
// specifically (isP0bPreDb(), not isP0bScratchDb()) — fix round 1,
// 2026-10-12: the main scratch gc_curriculum_p0b_scratch was migrated to
// post-0057 by Task 3 Step 4 and stays there, so running the migration
// body against it now trips its own "already applied" guard on every
// case. Every test here runs 0057's body inside its own
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
import { isP0bPreDb } from './p0b/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_RAW = readFileSync(resolve(ROOT, 'drizzle/0057_competency_catalog_p0b.sql'), 'utf8');
// Strip the file's own BEGIN;/COMMIT; so each test can run the body inside
// its own transaction (same technique the P0a reviewer used for 0056).
const MIGRATION_BODY = MIGRATION_RAW
  .split('\n')
  .filter((line) => line.trim() !== 'BEGIN;' && line.trim() !== 'COMMIT;')
  .join('\n');

const RUN = isP0bPreDb();

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

  it('1b (M-1, hostile review). the requirement-count post-check is relative to the pre-migration count, not hard-coded 35 — an extra legitimate requirement added beforehand does not block the apply', async () => {
    await withTx(async (c) => {
      // One extra, unrelated requirement row (new fixture competency, no
      // connection to any merge id) — simulates a real requirement added on
      // live between the scratch clone and the apply window, which the OLD
      // hard-coded "expected 35" check would have refused outright.
      await q(
        c,
        `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, retired, display_order)
         VALUES ('zz-p0b-migration-extra', 'ZZ P0b migration extra fixture', 'k', 'u', 'd', false, 999)`,
      );
      await q(
        c,
        `INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, status, display_order)
         VALUES ('account-management', 'zz-p0b-migration-extra', 'entry', 'faculty', 'draft', 999)`,
      );
      const before = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM career_target_requirements`))[0]!.n;
      // Pre-migration count is normally 36 (test 1's post-migration 35 is
      // AFTER the 3 merged-away rows are deleted and 2 survivor pairs are
      // inserted: 36 - 3 + 2 = 35) — plus this one extra row = 37.
      expect(before).toBe('37');

      // Must NOT throw — the old hard-coded "expected 35" check would have
      // raised '0057: expected 35 requirement rows, found 36' here.
      await c.query(MIGRATION_BODY);

      const after = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM career_target_requirements`))[0]!.n;
      expect(after).toBe('36'); // pre-count 37 - 3 merged-away + 2 newly inserted survivor pairs = 36
      const extra = await q(c, `SELECT 1 FROM career_target_requirements WHERE competency_id = 'zz-p0b-migration-extra'`);
      expect(extra).toHaveLength(1); // the unrelated extra row survives untouched
    });
  });

  it('1c (M-1, red-proof). reverting to the hard-coded 35 check raises on the extra-requirement fixture above', async () => {
    const relativeCheck = [
      '  SELECT pre_count - merged_away_count + new_insert_count INTO expected_req_count FROM pre_counts;',
      '  SELECT count(*) INTO actual_req_count FROM career_target_requirements;',
      '  IF actual_req_count <> expected_req_count THEN',
      "    RAISE EXCEPTION '0057: expected % requirement rows (pre-migration % minus % merged-away plus % newly inserted), found %',",
      '      expected_req_count, (SELECT pre_count FROM pre_counts), (SELECT merged_away_count FROM pre_counts),',
      '      (SELECT new_insert_count FROM pre_counts), actual_req_count;',
      '  END IF;',
    ].join('\n');
    expect(MIGRATION_BODY.includes(relativeCheck), 'expected marker not found — migration SQL shape changed').toBe(true);
    const hardCoded35Check = [
      '  IF (SELECT count(*) FROM career_target_requirements) <> 35 THEN',
      "    RAISE EXCEPTION '0057: expected 35 requirement rows, found %', (SELECT count(*) FROM career_target_requirements);",
      '  END IF;',
    ].join('\n');
    const brokenMigration = MIGRATION_BODY.replace(relativeCheck, hardCoded35Check);
    expect(brokenMigration, 'the replace must actually change the SQL for this red-proof to mean anything').not.toBe(MIGRATION_BODY);

    await withTx(async (c) => {
      await q(
        c,
        `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, retired, display_order)
         VALUES ('zz-p0b-migration-extra', 'ZZ P0b migration extra fixture', 'k', 'u', 'd', false, 999)`,
      );
      await q(
        c,
        `INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, status, display_order)
         VALUES ('account-management', 'zz-p0b-migration-extra', 'entry', 'faculty', 'draft', 999)`,
      );

      // Red-proof: the UN-fixed (hard-coded 35) check raises on this fixture.
      await expect(c.query(brokenMigration)).rejects.toThrow(/expected 35 requirement rows, found 36/);
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

  it('4. one open disagreement flag per (course, survivor) with a 2+ gap on some non-retired snapshot, with the representative-snapshot note/flagged_context, none otherwise (Ruling 4, amended 2026-10-12)', async () => {
    await withTx(async (c) => {
      type Cov4 = CovRow & { course_code: string; retired_at: string | null; created_epoch: number };
      const before = await q<Cov4>(
        c,
        `SELECT c.snapshot_id::text, c.competency_id, c.k_depth, c.u_depth, c.d_depth, c.matched_competency,
                c.evidence_excerpt, c.confidence, c.rationale, c.model, c.generated_at::text,
                s.course_code, s.retired_at::text AS retired_at, extract(epoch FROM s.created_at)::float8 AS created_epoch
         FROM snapshot_competency_coverage c
         JOIN course_capture_snapshots s ON s.id = c.snapshot_id
         WHERE c.competency_id IN ('domain-knowledge','gc-production-literacy','domain-grounding','project-management','timeline-management')`,
      );

      type ExpectedFlag = { note: string; context: { k: number | null; u: number | null; d: number | null; matchedCompetency: string | null; rationale: string } };
      const expected = new Map<string, ExpectedFlag>(); // key: `${course_code}|${survivor}`

      for (const survivor of SURVIVORS) {
        const members = new Set(groupMembersOf(survivor));
        const bySnapshot = new Map<string, { course_code: string; retired: boolean; created_epoch: number; rows: Cov4[] }>();
        for (const row of before) {
          if (!members.has(row.competency_id)) continue;
          const entry = bySnapshot.get(row.snapshot_id) ?? {
            course_code: row.course_code,
            retired: row.retired_at !== null,
            created_epoch: row.created_epoch,
            rows: [],
          };
          entry.rows.push(row);
          bySnapshot.set(row.snapshot_id, entry);
        }

        const byCourse = new Map<string, Array<{ snapshotId: string; created_epoch: number; rows: Cov4[]; gap: number }>>();
        for (const [snapshotId, entry] of bySnapshot) {
          if (entry.retired) continue; // Minor 1: retired snapshots never feed the flag, the note, or the context
          const ks = entry.rows.map((r) => r.k_depth ?? 0);
          const us = entry.rows.map((r) => r.u_depth ?? 0);
          const ds = entry.rows.map((r) => r.d_depth);
          const gap = Math.max(Math.max(...ks) - Math.min(...ks), Math.max(...us) - Math.min(...us), Math.max(...ds) - Math.min(...ds));
          const arr = byCourse.get(entry.course_code) ?? [];
          arr.push({ snapshotId, created_epoch: entry.created_epoch, rows: entry.rows, gap });
          byCourse.set(entry.course_code, arr);
        }

        for (const [courseCode, snaps] of byCourse) {
          const maxGap = Math.max(...snaps.map((s) => s.gap));
          if (maxGap < 2) continue;
          const nCaptures = snaps.length;
          // Representative: latest non-retired snapshot with group cells for
          // this (course, survivor) — created_at DESC, then id DESC.
          const representative = [...snaps].sort((a, b) => {
            if (a.created_epoch !== b.created_epoch) return b.created_epoch - a.created_epoch;
            return a.snapshotId < b.snapshotId ? 1 : a.snapshotId > b.snapshotId ? -1 : 0;
          })[0]!;
          const detail = [...representative.rows]
            .sort((a, b) => (a.competency_id < b.competency_id ? -1 : a.competency_id > b.competency_id ? 1 : 0))
            .map((r) => `${r.competency_id} K${r.k_depth ?? '-'}/U${r.u_depth ?? '-'}/D${r.d_depth}`)
            .join('; ');
          const note = `Before the P0b merge into ${survivor}, the merged competencies differed by ${maxGap} levels in at least one capture of this course (largest gap across ${nCaptures} captures). Latest capture: ${detail}. Re-scored against the merged descriptor; please check the new reading.`;
          const winner = pickBest(
            survivor,
            (r: Cov4) => r.competency_id,
            (r: Cov4) => r.confidence,
            (r: Cov4) => [r.d_depth, r.u_depth ?? -1, r.k_depth ?? -1],
            representative.rows,
          );
          const rationale = winner.competency_id === survivor ? winner.rationale : `[P0b merge: carried from ${winner.competency_id}] ${winner.rationale}`;
          expected.set(`${courseCode}|${survivor}`, {
            note,
            context: { k: winner.k_depth, u: winner.u_depth, d: winner.d_depth, matchedCompetency: winner.matched_competency, rationale },
          });
        }
      }

      await c.query(MIGRATION_BODY);

      const flags = await q<{ course_code: string; sub_competency_id: string; career_target_id: string; flagged_by: string; status: string; note: string; flagged_context: ExpectedFlag['context'] }>(
        c,
        `SELECT course_code, sub_competency_id, career_target_id, flagged_by, status, note, flagged_context
         FROM faculty_flags WHERE flagged_by = 'P0b merge (system)'`,
      );
      const actualPairs = new Set(flags.map((f) => `${f.course_code}|${f.sub_competency_id}`));
      expect(actualPairs).toEqual(new Set(expected.keys()));

      const counts = new Map<string, number>();
      for (const f of flags) {
        const key = `${f.course_code}|${f.sub_competency_id}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        expect(f.status).toBe('open');
        expect(f.career_target_id).toBe('production-operations');
        expect(f.flagged_by).toBe('P0b merge (system)');
        const exp = expected.get(key)!;
        expect(f.note).toBe(exp.note);
        expect(f.flagged_context).toEqual(exp.context);
      }
      for (const n of counts.values()) expect(n).toBe(1);
    });
  });

  const RETIRED_FIXTURE_COURSE = 'ECON 2000';

  /** Inserts a retired snapshot with group cells on RETIRED_FIXTURE_COURSE
   * that disagree by far more than 2 — if retired_at were not honored,
   * this alone would create a domain-knowledge flag for that course. */
  async function insertRetiredFixtureSnapshot(c: PoolClient): Promise<void> {
    // Confirmed clean rather than assumed: this course must start with zero
    // merge-group cells on any snapshot, so the retired snapshot inserted
    // below is the ONLY possible source of a flag on it.
    const existing = await q(
      c,
      `SELECT 1 FROM course_capture_snapshots s JOIN snapshot_competency_coverage cc ON cc.snapshot_id = s.id
       WHERE s.course_code = $1
         AND cc.competency_id IN ('domain-knowledge','gc-production-literacy','domain-grounding','project-management','timeline-management')`,
      [RETIRED_FIXTURE_COURSE],
    );
    expect(existing, `fixture course ${RETIRED_FIXTURE_COURSE} must start with zero merge-group cells`).toEqual([]);

    const { id: retiredSnapshotId } = (
      await q<{ id: string }>(
        c,
        `INSERT INTO course_capture_snapshots (course_code, profile, inputs_meta, scale_version, model, retired_at)
         VALUES ($1, '{}'::jsonb, '{}'::jsonb, 'test', 'test', now())
         RETURNING id::text`,
        [RETIRED_FIXTURE_COURSE],
      )
    )[0]!;
    await q(
      c,
      `INSERT INTO snapshot_competency_coverage (snapshot_id, competency_id, k_depth, u_depth, d_depth, confidence, rationale, model)
       VALUES ($1::uuid, 'domain-knowledge', 0, 0, 0, 'high', 'retired-fixture domain-knowledge', 'test'),
              ($1::uuid, 'gc-production-literacy', 5, 5, 5, 'high', 'retired-fixture gc-production-literacy', 'test')`,
      [retiredSnapshotId],
    );
  }

  it('4b (Minor 1). a retired snapshot with a 2+ gap creates no flag and does not feed the note or context', async () => {
    await withTx(async (c) => {
      await insertRetiredFixtureSnapshot(c);

      const before = await q<{ n: string }>(
        c,
        `SELECT count(*)::text AS n FROM faculty_flags WHERE flagged_by = 'P0b merge (system)' AND course_code = $1`,
        [RETIRED_FIXTURE_COURSE],
      );
      expect(before[0]!.n).toBe('0');

      await c.query(MIGRATION_BODY);

      const after = await q<{ note: string; flagged_context: unknown }>(
        c,
        `SELECT note, flagged_context FROM faculty_flags
         WHERE flagged_by = 'P0b merge (system)' AND course_code = $1 AND sub_competency_id = 'domain-knowledge'`,
        [RETIRED_FIXTURE_COURSE],
      );
      // The fixture course has no other (non-retired) group cells, so this
      // must stay empty; if it didn't, the retired snapshot's K5/U5/D5
      // would be the obvious signature in the note/context.
      expect(after).toEqual([]);
    });
  });

  it('4c (Minor 1, red-proof). removing the retired_at filter lets a retired snapshot create a flag — confirms the test above actually exercises the guard', async () => {
    const marker = 'JOIN course_capture_snapshots s ON s.id = gc.snapshot_id AND s.retired_at IS NULL';
    expect(MIGRATION_BODY.includes(marker), 'expected marker not found — migration SQL shape changed').toBe(true);
    const brokenMigration = MIGRATION_BODY.replace(marker, 'JOIN course_capture_snapshots s ON s.id = gc.snapshot_id');

    await withTx(async (c) => {
      await insertRetiredFixtureSnapshot(c);
      await c.query(brokenMigration);

      const after = await q<{ note: string }>(
        c,
        `SELECT note FROM faculty_flags
         WHERE flagged_by = 'P0b merge (system)' AND course_code = $1 AND sub_competency_id = 'domain-knowledge'`,
        [RETIRED_FIXTURE_COURSE],
      );
      expect(after.length, 'red-proof: with the retired_at filter removed, the retired snapshot should produce a flag').toBe(1);
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

  it('7b (M-5, hostile review). a re-pointed flag\'s flagged_context is refreshed to the survivor\'s own carried cell for the course\'s representative snapshot, not left as the merged-away cell', async () => {
    await withTx(async (c) => {
      const FLAG_COURSE = 'GC 1010'; // real fixture course with real group cells on both merge groups
      const FLAG_SURVIVOR = 'domain-knowledge';
      const members = new Set(groupMembersOf(FLAG_SURVIVOR));

      // Independently compute (in TS, from pre-migration rows) what step 7
      // SHOULD write: the representative snapshot (latest non-retired
      // snapshot of FLAG_COURSE with ANY group-member cell, created_at DESC
      // then id DESC) and that snapshot's carried winner cell — same
      // ranking rule test 2 uses, applied to ONLY that one snapshot's rows.
      type Row2 = CovRow & { course_code: string; retired_at: string | null; created_epoch: number };
      const before = await q<Row2>(
        c,
        `SELECT c.snapshot_id::text, c.competency_id, c.k_depth, c.u_depth, c.d_depth, c.matched_competency,
                c.evidence_excerpt, c.confidence, c.rationale, c.model, c.generated_at::text,
                s.course_code, s.retired_at::text AS retired_at, extract(epoch FROM s.created_at)::float8 AS created_epoch
         FROM snapshot_competency_coverage c
         JOIN course_capture_snapshots s ON s.id = c.snapshot_id
         WHERE s.course_code = $1 AND s.retired_at IS NULL
           AND c.competency_id IN ('domain-knowledge','gc-production-literacy','domain-grounding')`,
        [FLAG_COURSE],
      );
      const bySnapshot = new Map<string, { created_epoch: number; rows: Row2[] }>();
      for (const row of before) {
        if (!members.has(row.competency_id)) continue;
        const entry = bySnapshot.get(row.snapshot_id) ?? { created_epoch: row.created_epoch, rows: [] };
        entry.rows.push(row);
        bySnapshot.set(row.snapshot_id, entry);
      }
      expect(bySnapshot.size, `fixture precondition: ${FLAG_COURSE} must have at least one non-retired snapshot with a domain-knowledge-group cell`).toBeGreaterThan(0);
      const representative = [...bySnapshot.entries()].sort((a, b) => {
        if (a[1].created_epoch !== b[1].created_epoch) return b[1].created_epoch - a[1].created_epoch;
        return a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0;
      })[0]!;
      const winner = pickBest(
        FLAG_SURVIVOR,
        (r: Row2) => r.competency_id,
        (r: Row2) => r.confidence,
        (r: Row2) => [r.d_depth, r.u_depth ?? -1, r.k_depth ?? -1],
        representative[1].rows,
      );
      const expectedRationale = winner.competency_id === FLAG_SURVIVOR ? winner.rationale : `[P0b merge: carried from ${winner.competency_id}] ${winner.rationale}`;
      const expectedContext = { k: winner.k_depth, u: winner.u_depth, d: winner.d_depth, matchedCompetency: winner.matched_competency, rationale: expectedRationale };

      const { id } = (
        await q<{ id: string }>(
          c,
          `INSERT INTO faculty_flags (target_kind, course_code, sub_competency_id, note, flagged_by, flagged_context)
           VALUES ('coverage_cell'::flag_target_kind, $1, 'gc-production-literacy', 'pre-existing M-5 fixture flag', 'test',
                   jsonb_build_object('k', 9, 'u', 9, 'd', 9, 'matchedCompetency', 'WRONG — the stale merged-away reading', 'rationale', 'WRONG'))
           RETURNING id::text`,
          [FLAG_COURSE],
        )
      )[0]!;

      await c.query(MIGRATION_BODY);

      const [row] = await q<{ sub_competency_id: string; flagged_context: typeof expectedContext }>(
        c,
        `SELECT sub_competency_id, flagged_context FROM faculty_flags WHERE id = $1::uuid`,
        [id],
      );
      expect(row!.sub_competency_id).toBe(FLAG_SURVIVOR);
      expect(row!.flagged_context).toEqual(expectedContext);
    });
  });

  it('7c (M-5, red-proof). without the fix, the re-pointed flag keeps its stale merged-away flagged_context', async () => {
    const marker = `UPDATE faculty_flags f SET\n  sub_competency_id = m.survivor,`;
    expect(MIGRATION_BODY.includes(marker), 'expected marker not found — migration SQL shape changed').toBe(true);
    const brokenMigration = MIGRATION_BODY.replace(
      /WITH representative AS \(\s*SELECT sc\.competency_id AS survivor[\s\S]*?WHERE f\.sub_competency_id = m\.old_id;/,
      `UPDATE faculty_flags f SET sub_competency_id = m.survivor\nFROM merge_plan m WHERE f.sub_competency_id = m.old_id;`,
    );
    expect(brokenMigration, 'the regex replace must actually change the SQL for this red-proof to mean anything').not.toBe(MIGRATION_BODY);

    await withTx(async (c) => {
      const { id } = (
        await q<{ id: string }>(
          c,
          `INSERT INTO faculty_flags (target_kind, course_code, sub_competency_id, note, flagged_by, flagged_context)
           VALUES ('coverage_cell'::flag_target_kind, 'GC 1010', 'gc-production-literacy', 'red-proof fixture flag', 'test',
                   jsonb_build_object('k', 9, 'u', 9, 'd', 9, 'matchedCompetency', 'WRONG — the stale merged-away reading', 'rationale', 'WRONG'))
           RETURNING id::text`,
        )
      )[0]!;

      await c.query(brokenMigration);

      const [row] = await q<{ sub_competency_id: string; flagged_context: { k: number } }>(
        c,
        `SELECT sub_competency_id, flagged_context FROM faculty_flags WHERE id = $1::uuid`,
        [id],
      );
      expect(row!.sub_competency_id).toBe('domain-knowledge');
      // Red-proof: WITHOUT the fix, the stale k=9 placeholder survives the re-point.
      expect(row!.flagged_context.k, 'red-proof: without the fix, flagged_context should still be the stale placeholder').toBe(9);
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

  it('12 (M-6, hostile review). a career_target_demand row on a merge competency raises "precondition" and changes nothing', async () => {
    await withTx(async (c) => {
      await q(
        c,
        `INSERT INTO career_target_demand (career_target_id, sub_competency_id, contributing_position_ids)
         VALUES ('account-management', 'domain-knowledge', '[]'::jsonb)`,
      );
      // A failed statement aborts the rest of this transaction, so query
      // through the abort (same technique test 10 uses) rather than issuing
      // another statement straight after the expected rejection.
      await c.query('SAVEPOINT before_migration_attempt');
      await expect(c.query(MIGRATION_BODY)).rejects.toThrow(/0057: precondition/);
      await c.query('ROLLBACK TO SAVEPOINT before_migration_attempt');

      // Nothing else was touched — still pre-0057.
      const migrated = await q<{ exists: boolean }>(c, `SELECT to_regclass('public.sub_competency_map') IS NOT NULL AS exists`);
      expect(migrated[0]!.exists).toBe(false);
    });
  });

  it('12b (M-6, red-proof). without the precondition, that same career_target_demand row lets the migration apply', async () => {
    const marker = [
      "  IF EXISTS (SELECT 1 FROM career_target_demand",
      "             WHERE sub_competency_id IN ('domain-knowledge','project-management','gc-production-literacy','domain-grounding','timeline-management')) THEN",
      "    RAISE EXCEPTION '0057: precondition — career_target_demand has a row on a merge competency (table drops in P1; re-point or clear it first)';",
      '  END IF;',
    ].join('\n');
    expect(MIGRATION_BODY.includes(marker), 'expected marker not found — migration SQL shape changed').toBe(true);
    const brokenMigration = MIGRATION_BODY.replace(marker, '');
    expect(brokenMigration, 'the replace must actually change the SQL for this red-proof to mean anything').not.toBe(MIGRATION_BODY);

    await withTx(async (c) => {
      await q(
        c,
        `INSERT INTO career_target_demand (career_target_id, sub_competency_id, contributing_position_ids)
         VALUES ('account-management', 'domain-knowledge', '[]'::jsonb)`,
      );
      // Red-proof: without the precondition, the migration no longer refuses.
      await c.query(brokenMigration);
      const migrated = await q<{ exists: boolean }>(c, `SELECT to_regclass('public.sub_competency_map') IS NOT NULL AS exists`);
      expect(migrated[0]!.exists).toBe(true);
    });
  });
});
