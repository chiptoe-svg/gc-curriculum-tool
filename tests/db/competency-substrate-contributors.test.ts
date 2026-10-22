/** Competency wiki page: only courses that actually build the competency, once each (committed fixture, cleaned up). */
import { describe, it, expect } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, snapshotCompetencyCoverage } from '@/lib/db/schema';
import { loadCompetencySubstrate } from '@/lib/ai/wiki/update';
import { isP2ScratchDb } from './p2/scratch-guard';

const BUILDS = 'ZZ 9981';   // two snapshots, both matched: only the newer one counts
const UNMATCHED = 'ZZ 9982'; // scored, matched nothing, K0/U0/D0
const ZERO = 'ZZ 9983';     // matched a statement but every depth is 0
const CODES = [BUILDS, UNMATCHED, ZERO];
const PROFILE = (code: string) => ({ course_code: code, scale_version: 'v1' }) as never;
const META = { catalog: {}, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: {} } as never;

describe.skipIf(!isP2ScratchDb())('loadCompetencySubstrate contributors (scratch)', () => {
  it('drops unmatched and all-zero cells and keeps one row per course, from its latest snapshot', async () => {
    const comp = ((await db.execute(sql`SELECT id FROM sub_competencies WHERE NOT retired LIMIT 1`)).rows[0] as { id: string }).id;
    const cleanup = async () => {
      await db.delete(courseCaptureSnapshots).where(inArray(courseCaptureSnapshots.courseCode, CODES));
      await db.delete(courses).where(inArray(courses.code, CODES));
    };
    await cleanup();
    try {
      for (const code of CODES) {
        await db.insert(courses).values({ code, title: `fixture ${code}`, level: 9000, track: 'test', buildsToCareer: true, scope: 'gc', status: 'offered' } as never);
      }
      const snap = async (code: string, at: string) => (await db.insert(courseCaptureSnapshots).values({
        courseCode: code, profile: PROFILE(code), inputsMeta: META, scaleVersion: 'v1', model: 'test', instructorName: 'fixture', createdAt: new Date(at),
      } as never).returning({ id: courseCaptureSnapshots.id }))[0]!.id;
      const cell = (snapshotId: string, d: number, matched: string | null) => db.insert(snapshotCompetencyCoverage).values({
        snapshotId, competencyId: comp, kDepth: d, uDepth: d, dDepth: d, matchedCompetency: matched,
        evidenceExcerpt: 'fixture', confidence: 'high' as const, rationale: 'fixture', model: 'test',
      } as never);
      const older = await snap(BUILDS, '2026-01-01T00:00:00Z');
      const newer = await snap(BUILDS, '2026-02-01T00:00:00Z');
      await cell(older, 4, 'older statement');
      await cell(newer, 2, 'newer statement');
      await cell(await snap(UNMATCHED, '2026-02-01T00:00:00Z'), 0, null);
      await cell(await snap(ZERO, '2026-02-01T00:00:00Z'), 0, 'zero statement');

      const mine = (await loadCompetencySubstrate(comp)).contributingCells.filter(c => CODES.includes(c.courseCode));
      expect(mine.map(c => [c.courseCode, c.snapshotId])).toEqual([[BUILDS, newer]]);
    } finally {
      await cleanup();
    }
  });
});

