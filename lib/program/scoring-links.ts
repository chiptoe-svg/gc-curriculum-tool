/**
 * Every score makes its own link (spec 2026-11-20-links-drive-coverage-design.md): when a coverage cell is above
 * 0 and its matched_competency is one of the snapshot's skill statements, a proposed 'scoring' link joins that
 * skill to the competency. A faculty decision is never changed; a still-proposed embedding suggestion for the same
 * skill and competency becomes the scoring link (see scoringConflict).
 * Shared with scripts/catalog/seed-skill-links.ts so both match statements the same way.
 */
import { eq, sql } from 'drizzle-orm';
import type { db as Db } from '@/lib/db/client';
import { courseCaptureSnapshots, skillCompetencyLinks } from '@/lib/db/schema';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';

/**
 * On a clash with an existing row for the same skill and competency: a still-proposed embedding suggestion
 * becomes a scoring link (the scorer's judgment now backs it; similarity kept). Anything else (confirmed,
 * rejected, or proposed by scoring, AI or faculty) is left exactly as it is.
 */
export const scoringConflict = {
  target: [skillCompetencyLinks.snapshotId, skillCompetencyLinks.skillRef, skillCompetencyLinks.competencyId],
  set: { source: 'scoring' as const },
  setWhere: sql`${skillCompetencyLinks.source} = 'embedding' AND ${skillCompetencyLinks.status} = 'proposed'`,
};

export function scoringLinkFor(statements: readonly string[], matchedCompetency: string | null): { statement: string; skillRef: string } | null {
  const want = matchedCompetency?.trim();
  if (!want) return null;
  const statement = statements.map(s => s.trim()).find(s => s === want);
  return statement ? { statement, skillRef: textHash(normalizeStatement(statement)) } : null;
}

export async function ensureScoringLink(
  ex: typeof Db,
  input: { snapshotId: string; competencyId: string; matchedCompetency: string | null; level: number },
): Promise<'added' | 'upgraded' | 'exists' | 'no-match' | 'zero'> {
  if (!(input.level > 0)) return 'zero';
  const [snap] = await ex.select({ profile: courseCaptureSnapshots.profile }).from(courseCaptureSnapshots)
    .where(eq(courseCaptureSnapshots.id, input.snapshotId));
  const statements = ((snap?.profile as { competencies?: Array<{ statement?: unknown }> } | undefined)?.competencies ?? [])
    .map(c => c.statement).filter((s): s is string => typeof s === 'string');
  const hit = scoringLinkFor(statements, input.matchedCompetency);
  if (!hit) return 'no-match';
  const rows = await ex.insert(skillCompetencyLinks)
    .values({ snapshotId: input.snapshotId, skillRef: hit.skillRef, statement: hit.statement, competencyId: input.competencyId, source: 'scoring', status: 'proposed' })
    .onConflictDoUpdate(scoringConflict)
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return rows.length === 0 ? 'exists' : rows[0]!.inserted ? 'added' : 'upgraded';
}
