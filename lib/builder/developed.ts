// Which competencies the course drawer lists under "Developed skills & competencies" (spec 2026-11-20).
// Above 0 on any dimension; in the linked view also every 'needs_level' competency (0 by definition) so faculty
// see the skills they grouped there and can set its level. A 'rejected' competency is not listed: its skills
// show among the ungrouped ones. Pure.
import type { LevelMethod } from './types';

type Level = { k: number | null; u: number | null; d: number | null; method?: LevelMethod };

export function developedIds(ids: readonly string[], levels: ReadonlyMap<string, Level>, linkedView: boolean): string[] {
  const above0 = (x?: Level) => !!x && ([x.k, x.u, x.d] as Array<number | null>).some(v => (v ?? 0) > 0);
  return ids.filter(id => above0(levels.get(id)) || (linkedView && levels.get(id)?.method === 'needs_level'));
}
