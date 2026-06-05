/**
 * CRUD helpers, idempotent seed upsert, and cycle-detection guard for the
 * `prerequisite_edges` table (migration 0030).
 *
 * Design: docs/superpowers/specs/2026-06-05-prerequisite-edges-design.md
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { prerequisiteEdges } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrereqEdgeRow {
  id: string;
  focalCourseCode: string;
  prereqCourseCode: string;
  subCompetencyId: string;
  expectedK: number | null;
  expectedU: number | null;
  expectedD: number | null;
  source: 'llm_seed' | 'faculty';
  confidence: 'high' | 'medium' | 'low';
  confirmed: boolean;
  rationale: string;
}

export interface SeedEdgeInput {
  focalCourseCode: string;
  prereqCourseCode: string;
  subCompetencyId: string;
  expectedK: number | null;
  expectedU: number | null;
  expectedD: number | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface UpdateEdgeInput {
  id: string;
  expectedK?: number | null;
  expectedU?: number | null;
  expectedD?: number | null;
  confirmed?: boolean;
}

// ---------------------------------------------------------------------------
// Upsert (idempotent seed — never overwrites confirmed rows)
// ---------------------------------------------------------------------------

/**
 * Idempotent insert of seeded edges.  On the unique key (focal, prereq, subComp):
 *   - NEW row          → insert, count as inserted.
 *   - existing row, confirmed=false → update depths/confidence/rationale, count as inserted.
 *   - existing row, confirmed=true  → leave untouched, count as skippedConfirmed.
 *
 * Postgres semantics: ON CONFLICT DO UPDATE … WHERE confirmed = false
 * returns the row when the WHERE matches (insert or update), and returns
 * nothing when it doesn't (confirmed row is skipped).  `.returning()` is
 * therefore a reliable inserted/skipped discriminator.
 */
export async function upsertSeededEdges(
  edges: SeedEdgeInput[],
): Promise<{ inserted: number; skippedConfirmed: number }> {
  if (edges.length === 0) return { inserted: 0, skippedConfirmed: 0 };

  for (const e of edges) {
    if (e.focalCourseCode === e.prereqCourseCode) {
      throw new Error(
        `prerequisite edge cannot be self-referential: ${e.focalCourseCode}`,
      );
    }
  }

  let inserted = 0;
  let skippedConfirmed = 0;

  for (const e of edges) {
    const res = await db
      .insert(prerequisiteEdges)
      .values({
        focalCourseCode: e.focalCourseCode,
        prereqCourseCode: e.prereqCourseCode,
        subCompetencyId: e.subCompetencyId,
        expectedK: e.expectedK,
        expectedU: e.expectedU,
        expectedD: e.expectedD,
        source: 'llm_seed',
        confidence: e.confidence,
        confirmed: false,
        rationale: e.rationale,
      })
      .onConflictDoUpdate({
        target: [
          prerequisiteEdges.focalCourseCode,
          prerequisiteEdges.prereqCourseCode,
          prerequisiteEdges.subCompetencyId,
        ],
        // Only refresh rows that are NOT faculty-confirmed.
        // When the WHERE doesn't match (confirmed=true), Postgres skips the
        // UPDATE and returns nothing — so res.length===0 reliably signals a skip.
        set: {
          expectedK: e.expectedK,
          expectedU: e.expectedU,
          expectedD: e.expectedD,
          confidence: e.confidence,
          rationale: e.rationale,
          updatedAt: sql`now()`,
        },
        setWhere: eq(prerequisiteEdges.confirmed, false),
      })
      .returning({ id: prerequisiteEdges.id });

    if (res.length > 0) {
      inserted += 1;
    } else {
      skippedConfirmed += 1;
    }
  }

  return { inserted, skippedConfirmed };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listEdgesForFocal(
  focalCourseCode: string,
): Promise<PrereqEdgeRow[]> {
  const rows = await db
    .select()
    .from(prerequisiteEdges)
    .where(eq(prerequisiteEdges.focalCourseCode, focalCourseCode));
  return rows as PrereqEdgeRow[];
}

/**
 * All distinct (focal → prereq) structural pairs — for program-wide traversal.
 * Includes ALL edges (confirmed and unconfirmed).
 */
export async function listEdgePairs(): Promise<
  Array<{ focal: string; prereq: string }>
> {
  const rows = await db
    .selectDistinct({
      focal: prerequisiteEdges.focalCourseCode,
      prereq: prerequisiteEdges.prereqCourseCode,
    })
    .from(prerequisiteEdges);
  return rows.map((r) => ({ focal: r.focal, prereq: r.prereq }));
}

/**
 * Confirmed-only distinct (focal → prereq) pairs — used by cycle detection
 * so that unreviewed LLM seeds cannot block faculty writes.
 */
export async function listConfirmedEdgePairs(): Promise<
  Array<{ focal: string; prereq: string }>
> {
  const rows = await db
    .selectDistinct({
      focal: prerequisiteEdges.focalCourseCode,
      prereq: prerequisiteEdges.prereqCourseCode,
    })
    .from(prerequisiteEdges)
    .where(eq(prerequisiteEdges.confirmed, true));
  return rows.map((r) => ({ focal: r.focal, prereq: r.prereq }));
}

/**
 * Returns the edge row for the given id, or null if not found.
 */
export async function getEdgeById(id: string): Promise<PrereqEdgeRow | null> {
  const rows = await db
    .select()
    .from(prerequisiteEdges)
    .where(eq(prerequisiteEdges.id, id))
    .limit(1);
  return (rows[0] as PrereqEdgeRow) ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function updateEdge(input: UpdateEdgeInput): Promise<void> {
  if (input.confirmed === false) {
    throw new Error(
      'cannot unconfirm an edge via update; delete and re-seed instead',
    );
  }
  const rows = await db
    .update(prerequisiteEdges)
    .set({
      ...(input.expectedK !== undefined && { expectedK: input.expectedK }),
      ...(input.expectedU !== undefined && { expectedU: input.expectedU }),
      ...(input.expectedD !== undefined && { expectedD: input.expectedD }),
      ...(input.confirmed === true && {
        confirmed: true,
        source: 'faculty',
        confidence: 'high',
      }),
      updatedAt: sql`now()`,
    })
    .where(eq(prerequisiteEdges.id, input.id))
    .returning({ id: prerequisiteEdges.id });
  if (rows.length === 0) {
    throw new Error('updateEdge: edge not found');
  }
}

export async function deleteEdge(id: string): Promise<void> {
  await db.delete(prerequisiteEdges).where(eq(prerequisiteEdges.id, id));
}

/**
 * Faculty-initiated edge add: always confirmed=true, source='faculty'.
 * Cycle-checks first; throws on self-reference or cycle.
 */
export async function addFacultyEdge(
  input: SeedEdgeInput,
): Promise<{ id: string }> {
  if (input.focalCourseCode === input.prereqCourseCode) {
    throw new Error('self-referential prerequisite edge');
  }
  if (await wouldCreateCycle(input.focalCourseCode, input.prereqCourseCode)) {
    throw new Error(
      `adding ${input.prereqCourseCode} as a prereq of ${input.focalCourseCode} would create a cycle`,
    );
  }
  const [row] = await db
    .insert(prerequisiteEdges)
    .values({
      ...input,
      source: 'faculty',
      confirmed: true,
      confidence: 'high',
    })
    .onConflictDoUpdate({
      target: [
        prerequisiteEdges.focalCourseCode,
        prerequisiteEdges.prereqCourseCode,
        prerequisiteEdges.subCompetencyId,
      ],
      set: {
        expectedK: input.expectedK,
        expectedU: input.expectedU,
        expectedD: input.expectedD,
        confirmed: true,
        source: 'faculty',
        confidence: 'high',
        rationale: input.rationale,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: prerequisiteEdges.id });
  return row!;
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/**
 * Pure BFS over an adjacency map (focal → [prereqs]).
 * Returns true if `focal` is already reachable from `prereq` — meaning adding
 * (focal, prereq) would create a cycle.
 *
 * Extracted as a pure function so it can be unit-tested without a DB.
 * `wouldCreateCycle` is the thin DB-backed wrapper below.
 */
export function bfsWouldCycle(
  focal: string,
  prereq: string,
  adj: Map<string, string[]>,
): boolean {
  if (focal === prereq) return true;
  // Walk prereq's prerequisites transitively.  If we reach `focal`, a cycle forms.
  const seen = new Set<string>();
  const stack: string[] = [prereq];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === focal) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) {
      stack.push(next);
    }
  }
  return false;
}

/**
 * DB-backed cycle guard.  True if making `prereq` a prerequisite of `focal`
 * would create a directed cycle in the existing confirmed edge graph.
 *
 * Uses `listConfirmedEdgePairs()` (confirmed=true only) so that unreviewed
 * LLM seeds cannot block faculty writes.  Delegates to the pure
 * `bfsWouldCycle` helper (diamond-safe — visited set prevents loops).
 */
export async function wouldCreateCycle(
  focal: string,
  prereq: string,
): Promise<boolean> {
  const pairs = await listConfirmedEdgePairs();
  const adj = new Map<string, string[]>();
  for (const { focal: f, prereq: p } of pairs) {
    if (!adj.has(f)) adj.set(f, []);
    adj.get(f)!.push(p);
  }
  return bfsWouldCycle(focal, prereq, adj);
}

/**
 * Convenience alias: confirm an edge and promote it to faculty source.
 * Equivalent to updateEdge({ id, confirmed: true }).
 */
export async function confirmEdge(id: string): Promise<void> {
  await updateEdge({ id, confirmed: true });
}
