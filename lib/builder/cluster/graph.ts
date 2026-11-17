// The upstream graph of a course cluster: arrows come from the catalog (prerequisites and corequisites between
// cards on the canvas) and from arrows drawn on the map. Position never matters; only arrows do.
import type { Library } from '../types';
import type { ClusterState } from './state';

export interface ClusterEdge { from: string; to: string; source: 'catalog' | 'cluster' }

/** Catalog prerequisites (and corequisites) with both ends on a card, less the ones set aside, plus the drawn arrows. */
export function clusterEdges(lib: Library, state: ClusterState): ClusterEdge[] {
  // A catalog edge names course codes; a card is named by its ref (the code, or a proposed id whose code is the catalog's).
  const refOf = new Map<string, string>();
  for (const c of state.cards) {
    refOf.set(c.ref, c.ref);
    const code = state.proposed.find(p => p.id === c.ref)?.code;
    if (code && !refOf.has(code)) refOf.set(code, c.ref);
  }
  const off = new Set(state.unlinked.map(l => `${l.from}>${l.to}`));
  const seen = new Set<string>();
  const out: ClusterEdge[] = [];
  const add = (from: string, to: string, source: ClusterEdge['source']) => {
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    out.push({ from, to, source });
  };
  for (const e of lib.prereqs) {
    const from = refOf.get(e.prereqCode), to = refOf.get(e.courseCode);
    if (from && to && !off.has(`${from}>${to}`) && !off.has(`${e.prereqCode}>${e.courseCode}`)) add(from, to, 'catalog');
  }
  for (const l of state.links) add(l.from, l.to, 'cluster');
  return out;
}

/** Every ref reachable backward from `ref` along the arrows, excluding `ref` itself. Terminates on a saved cycle. */
export function upstreamOf(edges: ReadonlyArray<{ from: string; to: string }>, ref: string): Set<string> {
  const suppliers = new Map<string, string[]>();
  for (const e of edges) suppliers.set(e.to, [...(suppliers.get(e.to) ?? []), e.from]);
  const found = new Set<string>();
  const stack = [ref];
  while (stack.length) {
    for (const s of suppliers.get(stack.pop()!) ?? []) {
      if (s === ref || found.has(s)) continue;
      found.add(s);
      stack.push(s);
    }
  }
  return found;
}

/** Why drawing from→to is refused, or null when it is fine. */
export function wouldCycle(edges: ReadonlyArray<{ from: string; to: string }>, from: string, to: string): string | null {
  if (from === to || upstreamOf(edges, from).has(to)) return `That arrow would make a loop (${to} is already upstream of ${from}).`;
  return null;
}
