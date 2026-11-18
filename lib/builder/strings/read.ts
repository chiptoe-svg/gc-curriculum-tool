import { defaultAct } from '../compute';
import type { Act, Depth } from '../types';
import { depthNow } from './touch';
import type { PointStatus, StopReading, StringGraph, StringReading } from './types';

type Dim = 'k' | 'u' | 'd';
const DIMS: Dim[] = ['k', 'u', 'd'];

export function readString(
  g: StringGraph,
  stringId: string,
  status: Record<string, PointStatus>,
  levelOf: (code: string) => number,
  options: { fade: number | null },
): StringReading {
  if (options.fade !== null) throw new Error('fade not implemented');
  const str = g.strings.find((s) => s.id === stringId);
  if (!str) throw new Error(`string not found: ${stringId}`);
  const actOf = (code: string): Act => defaultAct({ code, level: levelOf(code) });
  const others = g.strings.filter((s) => s.id !== str.id && s.status === 'active');
  const path = str.path;

  const peak: Record<Dim, number | null> = { k: null, u: null, d: null };
  let usableSeen = false;
  let reinforcement = 0;

  const stops: StopReading[] = path.map((pointId, i) => {
    const p = g.points[pointId];
    if (!p) throw new Error(`point not found: ${pointId}`);
    const st: PointStatus = status[pointId] ?? { kind: 'unchecked' };
    const depth = depthNow(p, st);
    const slip: Dim[] = [];
    const gap: Dim[] = [];
    let reinforces = false;

    if (depth) {
      if (p.role === 'develops') {
        const usable = DIMS.some((d) => depth[d] !== null);
        if (usable) {
          for (const d of DIMS) {
            const v = depth[d];
            const pk = peak[d];
            if (v !== null && pk !== null && v < pk) slip.push(d);
          }
          if (usableSeen) {
            reinforces = DIMS.some((d) => {
              const v = depth[d];
              const pk = peak[d];
              return v !== null && pk !== null && pk > 0 && v >= pk - 1;
            });
            if (reinforces) reinforcement++;
          }
          for (const d of DIMS) {
            const v = depth[d];
            if (v !== null && (peak[d] === null || v > (peak[d] as number))) peak[d] = v;
          }
          usableSeen = true;
        }
      } else {
        for (const d of DIMS) {
          const need = depth[d];
          if (need !== null && need > (peak[d] ?? 0)) gap.push(d);
        }
      }
    }

    const pred = i > 0 ? path[i - 1] : undefined;
    const succ = i < path.length - 1 ? path[i + 1] : undefined;
    const mergedIn: string[] = [];
    const sharedWith: StopReading['sharedWith'] = [];
    for (const s of others) {
      const j = s.path.indexOf(pointId);
      if (j < 0) continue;
      if (s.mergedInto === str.id && j === s.path.length - 1) {
        mergedIn.push(s.id);
        continue;
      }
      const sPred = j > 0 ? s.path[j - 1] : undefined;
      const sSucc = j < s.path.length - 1 ? s.path[j + 1] : undefined;
      if (sPred !== pred) sharedWith.push({ stringId: s.id, relation: 'joins' });
      else if (succ !== undefined && sSucc !== undefined && succ !== sSucc)
        sharedWith.push({ stringId: s.id, relation: 'branches' });
    }

    const link = pred ? g.links.find((l) => l.from === pred && l.to === pointId) : undefined;
    return {
      pointId,
      courseCode: p.courseCode,
      act: actOf(p.courseCode),
      role: p.role,
      depth,
      status: st,
      why: link ? link.why : null,
      slip,
      gap,
      reinforces,
      mergedIn,
      sharedWith,
    };
  });

  const last = stops[stops.length - 1];
  const end: StringReading['end'] = str.mergedInto
    ? { kind: 'merges', into: str.mergedInto, courseCode: last?.courseCode ?? '' }
    : { kind: 'ends', courseCode: last?.courseCode ?? '', act: last?.act ?? 1, note: str.endNote };

  return { stops, reinforcement, end };
}
