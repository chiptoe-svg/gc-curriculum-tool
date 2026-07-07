import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseExploreScenarios } from '@/lib/db/schema';
import { scenarioSchema } from '@/lib/ai/explore/scenario';
import type { Scenario } from '@/lib/ai/explore/scenario';

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

function rowToScenario(row: typeof courseExploreScenarios.$inferSelect): Scenario {
  return scenarioSchema.parse({
    id: row.id,
    courseCode: row.courseCode,
    baselineSnapshotId: row.baselineSnapshotId,
    change: row.change,
    predictedDeltas: row.predictedDeltas,
    computedRipple: row.computedRipple,
    agentNotes: row.agentNotes ?? null,
    caption: row.caption ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Persist a Scenario. Upserts on the id PK so re-running with the same id is
 * idempotent (the caller is responsible for generating a fresh id per run).
 */
export async function saveScenario(s: Scenario): Promise<void> {
  await db
    .insert(courseExploreScenarios)
    .values({
      id: s.id,
      courseCode: s.courseCode,
      baselineSnapshotId: s.baselineSnapshotId,
      change: s.change,
      predictedDeltas: s.predictedDeltas,
      computedRipple: s.computedRipple,
      agentNotes: s.agentNotes ?? null,
      caption: s.caption ?? null,
      createdAt: new Date(s.createdAt),
    })
    .onConflictDoUpdate({
      target: courseExploreScenarios.id,
      set: {
        courseCode: s.courseCode,
        baselineSnapshotId: s.baselineSnapshotId,
        change: s.change,
        predictedDeltas: s.predictedDeltas,
        computedRipple: s.computedRipple,
        agentNotes: s.agentNotes ?? null,
        caption: s.caption ?? null,
      },
    });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** List scenarios for a course, newest first. */
export async function listScenarios(courseCode: string): Promise<Scenario[]> {
  const rows = await db
    .select()
    .from(courseExploreScenarios)
    .where(eq(courseExploreScenarios.courseCode, courseCode))
    .orderBy(desc(courseExploreScenarios.createdAt));
  return rows.map(rowToScenario);
}

/** Fetch a single scenario by id. Returns null if not found. */
export async function getScenario(id: string): Promise<Scenario | null> {
  const rows = await db
    .select()
    .from(courseExploreScenarios)
    .where(eq(courseExploreScenarios.id, id))
    .limit(1);
  const row = rows[0];
  return row ? rowToScenario(row) : null;
}
