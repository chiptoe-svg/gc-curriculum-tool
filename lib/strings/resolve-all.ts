import type { Library } from '@/lib/builder/types';
import type { PointRow, PointStatus } from '@/lib/builder/strings/types';
import { resolveExact, roleSkills, type PoolSkill } from '@/lib/builder/strings/resolve';
import { checkRewords } from './reword';

const heldKey = (p: { courseCode: string; role: string }) => `${p.courseCode}|${p.role}`;

export async function resolveAll(lib: Library, points: PointRow[]): Promise<Record<string, PointStatus>> {
  const heldBy = new Map<string, Map<string, string>>(); // course|role -> hash -> point id
  for (const p of points) {
    const k = heldKey(p);
    if (!heldBy.has(k)) heldBy.set(k, new Map());
    heldBy.get(k)!.set(p.statementHash, p.id);
  }
  const out: Record<string, PointStatus> = {};
  const checks: Array<{ point: PointRow; snapshotId: string; pool: PoolSkill[] }> = [];
  for (const p of points) {
    const held = new Set([...(heldBy.get(heldKey(p)) ?? [])].filter(([, id]) => id !== p.id).map(([h]) => h));
    const r = resolveExact(p, lib, held);
    if (r.kind === 'needs-check') checks.push({ point: p, snapshotId: r.snapshotId, pool: r.pool });
    else out[p.id] = r;
  }
  if (checks.length === 0) return out;
  const rewords = await checkRewords(checks);
  for (const c of checks) {
    const s = rewords[c.point.id] ?? { kind: 'unchecked' as const };
    if (s.kind === 'changed') {
      // The reword check knows statements only; the candidate's depth comes from the capture.
      const hit = roleSkills(c.point, lib);
      const cand = 'skills' in hit ? hit.skills.find((x) => x.hash === s.candidate.hash) : undefined;
      out[c.point.id] = { ...s, now: cand?.depth ?? null };
    } else out[c.point.id] = s;
  }
  return out;
}
