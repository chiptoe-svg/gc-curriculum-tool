import type { StringGraph } from './types';

/** Lays a partial graph (a write response, or one string's GET) over a base: what the patch holds replaces or extends by id; the rest of the base stays. */
export function mergeGraph(base: StringGraph, patch: StringGraph): StringGraph {
  const byId = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const out = new Map(a.map((x) => [x.id, x]));
    for (const x of b) out.set(x.id, x);
    return [...out.values()];
  };
  return {
    strings: byId(base.strings, patch.strings),
    points: { ...base.points, ...patch.points },
    links: byId(base.links, patch.links),
    events: byId(base.events, patch.events),
  };
}
