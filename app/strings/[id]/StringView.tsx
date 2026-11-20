'use client';
import { useCallback, useEffect, useState } from 'react';
import { StringPanel } from '@/components/strings/StringPanel';
import { mergeGraph } from '@/lib/builder/strings/graph';
import type { PointStatus, StringGraph } from '@/lib/builder/strings/types';
import { versionsFromData, type VersionsData } from '@/lib/builder/strings/versions';
import type { Tree } from '@/lib/skill-tree/types';

/** The read-only string page: the server's exact-match statuses first, then the full check from /api/strings/resolve. */
export function StringView({ initialGraph, initialStatus, stringId, levels: initialLevels, evidence, editHref, query = '', tree = null, versions = {} }: {
  initialGraph: StringGraph; initialStatus: Record<string, PointStatus>; stringId: string;
  levels: Record<string, number>; evidence: Record<string, string[]>; editHref: string; query?: string;
  tree?: Tree | null; versions?: VersionsData;
}) {
  const [graph, setGraph] = useState(initialGraph);
  const [status, setStatus] = useState(initialStatus);
  const [levels, setLevels] = useState(initialLevels);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/strings/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stringId }) });
      if (!res.ok) return;
      const data = (await res.json()) as { status: Record<string, PointStatus>; levels: Record<string, number> };
      setStatus(data.status);
      setLevels((l) => ({ ...l, ...data.levels }));
    } catch { /* the exact-match statuses stay; "Couldn't check" shows for what is unresolved */ }
  }, [stringId]);
  useEffect(() => { void check(); }, [check]);

  return (
    <StringPanel
      tree={tree} versionsOf={(c) => versionsFromData(versions, c)}
      graph={graph} status={status} stringId={stringId} levelOf={(c) => levels[c] ?? 0} editable={false} editHref={editHref}
      evidenceOf={(code) => evidence[code] ?? []} hrefOf={(id) => `/strings/${id}${query}`} onChanged={(patch) => setGraph((g) => mergeGraph(g, patch))} onRetry={() => void check()}
    />
  );
}
