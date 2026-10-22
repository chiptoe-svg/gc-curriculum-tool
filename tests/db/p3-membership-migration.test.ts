/** 0062 shape on the scratch DB (applied by hand, plan Task 1 Step 4). Scratch only. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { isP2ScratchDb } from './p2/scratch-guard';

describe.skipIf(!isP2ScratchDb())('migration 0062 (scratch)', () => {
  it('creates career_target_membership with one pinned row per existing pair', async () => {
    const r = (await db.execute(sql`
      SELECT (SELECT count(*) FROM career_target_membership)::int AS m,
             (SELECT count(*) FROM (SELECT DISTINCT career_target_id, competency_id FROM career_target_requirements) p)::int AS p,
             (SELECT count(*) FROM career_target_membership WHERE basis <> 'pinned')::int AS nonpinned`)).rows[0] as { m: number; p: number; nonpinned: number };
    expect(r.m).toBe(r.p);
    expect(r.nonpinned).toBe(0);
  });

  it('allows status hidden', async () => {
    const def = (await db.execute(sql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'career_target_requirements_status_check'`)).rows[0] as { d: string };
    expect(def.d).toContain('hidden');
  });

  it('the views read the membership table', async () => {
    const v = (await db.execute(sql`SELECT pg_get_viewdef('target_sub_competencies'::regclass) AS a, pg_get_viewdef('target_coverage'::regclass) AS b`)).rows[0] as { a: string; b: string };
    expect(v.a).toContain('career_target_membership');
    expect(v.b).toContain('career_target_membership');
  });
});
