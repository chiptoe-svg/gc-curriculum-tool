import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies } from '@/lib/db/schema';

export interface ScoringFlags {
  foundational: boolean;
  scoring: 'direct' | 'derived';
}

/**
 * foundational / scoring for catalog competency ids. The target_sub_competencies
 * view (migration 0056) does not expose these 0060 columns, so callers that read
 * target membership from the view look the flags up here by id. An id missing
 * from the catalog is an error (see flagsFor), never a silent default.
 */
export async function getScoringFlags(ids: string[]): Promise<Map<string, ScoringFlags>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: subCompetencies.id, foundational: subCompetencies.foundational, scoring: subCompetencies.scoring })
    .from(subCompetencies)
    .where(inArray(subCompetencies.id, ids));
  return new Map(rows.map(r => [r.id, { foundational: r.foundational, scoring: r.scoring }]));
}

/** Fails closed: a missing id would otherwise be scored as non-foundational/direct. */
export function flagsFor(map: Map<string, ScoringFlags>, id: string): ScoringFlags {
  const f = map.get(id);
  if (!f) throw new Error(`scoring flags: competency ${id} not found in sub_competencies`);
  return f;
}
