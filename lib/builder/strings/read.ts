import { defaultAct } from '../compute';
import type { Act, Depth } from '../types';
import { depthNow } from './touch';
import { isFoundational, meets, readProgram, resolveNode } from '@/lib/skill-tree/read';
import type { Tree, VersionSkills } from '@/lib/skill-tree/types';
import type { NodeCheck, PointRow, PointStatus, StopReading, StringGraph, StringReading } from './types';

type Dim = 'k' | 'u' | 'd';
const DIMS: Dim[] = ['k', 'u', 'd'];

/**
 * A requires stop that names a tree skill: what arrives is the program reading over the newest versions of the courses
 * at develops stops before it on every active string through the stop (the whole incoming string is carried).
 */
function checkNode(
  g: StringGraph, p: PointRow, pointId: string, current: string, tree: Tree | undefined, versionsOf: ((code: string) => VersionSkills[]) | undefined,
): NodeCheck {
  if (!tree || !versionsOf || !p.nodeId) return { kind: 'not-checkable' };
  const nodeId = resolveNode(tree, p.nodeId);
  if (!tree.nodes.some((n) => n.id === nodeId)) return { kind: 'not-checkable' };
  const codes = new Set<string>();
  for (const s of g.strings) {
    if (s.id !== current && s.status !== 'active') continue;
    const at = s.path.indexOf(pointId);
    if (at < 0) continue;
    for (const id of s.path.slice(0, at)) {
      const q = g.points[id];
      if (q && q.role === 'develops') codes.add(q.courseCode);
    }
  }
  const versions = [...codes].flatMap((c) => versionsOf(c));
  const arriving = readProgram(tree, versions, nodeId);
  const need: Depth = { k: p.needK ?? null, u: p.needU ?? null, d: p.needD ?? null };
  return { kind: 'checked', nodeId, need, arriving: { k: arriving.k, u: arriving.u, d: arriving.d }, met: meets(arriving, need, isFoundational(tree, nodeId)), foundational: isFoundational(tree, nodeId) };
}

export function readString(
  g: StringGraph,
  stringId: string,
  status: Record<string, PointStatus>,
  levelOf: (code: string) => number,
  options: { fade: number | null; tree?: Tree; versionsOf?: (code: string) => VersionSkills[] },
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
    const nodeCheck: NodeCheck | null = p.role === 'requires' && p.nodeId ? checkNode(g, p, pointId, str.id, options.tree, options.versionsOf) : null;

    if (nodeCheck) {
      if (nodeCheck.kind === 'checked') {
        const foundational = nodeCheck.foundational;
        for (const d of DIMS) {
          const need = nodeCheck.need[d];
          if (foundational && d !== 'd') continue;
          if (need !== null && (nodeCheck.arriving[d] ?? 0) < need) gap.push(d);
        }
      }
    } else if (depth) {
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
      nodeCheck,
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
