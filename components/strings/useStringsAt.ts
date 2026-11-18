'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeGraph } from '@/lib/builder/strings/graph';
import type { OrphanSkill } from '@/lib/builder/strings/touch';
import type { PointStatus, StringGraph } from '@/lib/builder/strings/types';

export const NO_STRINGS: StringGraph = { strings: [], points: {}, links: [], events: [] };
export type Orphans = Record<string, { developed: OrphanSkill[]; unsupplied: OrphanSkill[] }>;

/**
 * The active strings through some catalog courses and where each point stands, read from /api/strings/resolve.
 * Asks again only when the set of courses changes (the key is the sorted codes), and lays each answer over what is held
 * (mergeGraph), so a string that was unlocked or moved off these courses stays until the page reloads.
 * `changed` lays a write's graph over the held one and re-reads the standing; `hrefOf` keeps the page's access query.
 */
export function useStringsAt(codes: readonly string[], query = '') {
  const key = useMemo(() => [...new Set(codes)].sort().join('\n'), [codes]);
  const [state, setState] = useState<{ graph: StringGraph; status: Record<string, PointStatus>; orphans: Orphans }>({ graph: NO_STRINGS, status: {}, orphans: {} });
  const refresh = useCallback(async () => {
    if (!key) return;
    try {
      const res = await fetch('/api/strings/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseCodes: key.split('\n') }) });
      if (!res.ok) return;
      const data = (await res.json()) as { graph: StringGraph; status: Record<string, PointStatus>; orphans?: Orphans };
      setState(x => ({ graph: mergeGraph(x.graph, data.graph), status: { ...x.status, ...data.status }, orphans: { ...x.orphans, ...data.orphans } }));
    } catch { /* strings stay as they were; the panel offers "try again" for what could not be checked */ }
  }, [key]);
  useEffect(() => { void refresh(); }, [refresh]);
  const changed = useCallback((patch: StringGraph) => { setState(x => ({ ...x, graph: mergeGraph(x.graph, patch) })); void refresh(); }, [refresh]);
  const hrefOf = useCallback((id: string) => `/strings/${id}${query}`, [query]);
  return { graph: state.graph, status: state.status, orphans: state.orphans, refresh, changed, hrefOf };
}
