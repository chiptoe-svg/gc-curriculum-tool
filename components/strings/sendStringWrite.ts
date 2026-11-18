import type { StringGraph } from '@/lib/builder/strings/types';

export const STALE = 'Someone else changed this string. Reloaded.';

/**
 * One string write: sends the body with the author's name, hands the answer's graph to `onChanged` and resolves
 * `{ ok: true }`. A 409 on a string (`reloadStringId`) reloads that string and says so; any other refusal returns its sentence.
 */
export async function sendStringWrite(o: {
  url: string; method: string; body: Record<string, unknown>; authorName: string;
  /** The string a stale-version 409 reloads; leave out where a 409 means something else (a name already taken). */
  reloadStringId?: string;
  onChanged: (graph: StringGraph) => void;
}): Promise<{ ok: true } | { ok: false; notice: string }> {
  const res = await fetch(o.url, {
    method: o.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...o.body, authorName: o.authorName }),
  });
  const data = (await res.json().catch(() => ({}))) as { graph?: StringGraph; error?: string };
  if (res.ok && data.graph) { o.onChanged(data.graph); return { ok: true }; }
  if (res.status === 409 && o.reloadStringId) {
    const again = await fetch(`/api/strings/${o.reloadStringId}`).then((r) => r.json()).catch(() => null) as { graph?: StringGraph } | null;
    if (again?.graph) o.onChanged(again.graph);
    return { ok: false, notice: STALE };
  }
  return { ok: false, notice: data.error ?? 'That did not save.' };
}
