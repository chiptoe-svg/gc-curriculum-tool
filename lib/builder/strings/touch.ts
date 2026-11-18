/**
 * Pure read-side helpers for skill strings: which strings touch a course, what changed on a
 * string since it was locked, and which of a course's skills sit on no string.
 */
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { Depth, Library } from '../types';
import type { OrphanNote, PointRow, PointStatus, StringGraph, StringRow } from './types';

type Dim = 'k' | 'u' | 'd';
const DIMS: Dim[] = ['k', 'u', 'd'];

export interface ChangeItem {
  kind: 'reworded' | 'unanchored' | 'unhooked' | 'no-why' | 'depth-moved';
  courseCode: string;
  pointId?: string;
  linkId?: string;
  text: string;
}

export interface OrphanSkill { statement: string; hash: string; note: string | null }

const hashOf = (s: string) => textHash(normalizeStatement(s));

/** Active strings with a point in that course. */
export function stringsAt(g: StringGraph, courseCode: string): StringRow[] {
  return g.strings.filter(
    (s) => s.status === 'active' && s.path.some((id) => g.points[id]?.courseCode === courseCode),
  );
}

/** A develops point's depth now: the status reading; unanchored counts as gone; no reading falls back to lock time. */
function nowDepthOf(p: PointRow, s: PointStatus | undefined): Depth | null {
  if (s?.kind === 'unanchored') return null;
  if (s && (s.kind === 'intact' || s.kind === 'changed') && s.now) return s.now;
  return { k: p.k, u: p.u, d: p.d };
}

function show(d: Depth): string {
  const f = (v: number | null) => (v === null ? '–' : String(v));
  return `K${f(d.k)} U${f(d.u)} D${f(d.d)}`;
}

/** For each requires stop on the path, the running per-dimension peak of usable develops depths before it. */
function peaksBefore(path: string[], g: StringGraph, depthOf: (pointId: string) => Depth | null): Map<string, Depth> {
  const peak: Depth = { k: null, u: null, d: null };
  const out = new Map<string, Depth>();
  for (const id of path) {
    const p = g.points[id];
    if (!p) continue;
    if (p.role === 'requires') {
      out.set(id, { ...peak });
      continue;
    }
    const depth = depthOf(id);
    if (!depth || !DIMS.some((d) => depth[d] !== null)) continue;
    for (const d of DIMS) {
      const v = depth[d];
      if (v !== null && (peak[d] === null || v > (peak[d] as number))) peak[d] = v;
    }
  }
  return out;
}

const same = (a: Depth, b: Depth) => DIMS.every((d) => a[d] === b[d]);

export function stringChanges(
  g: StringGraph,
  status: Record<string, PointStatus>,
  stringId: string,
  _levelOf: (code: string) => number,
): ChangeItem[] {
  const str = g.strings.find((s) => s.id === stringId);
  if (!str) return [];
  const codeOf = (id: string) => g.points[id]?.courseCode ?? '';
  const removals = g.events
    .filter((e) => e.kind === 'point_removed' && e.stringId === stringId)
    .map((e) => ({ e, before: e.before as { path?: string[]; courseCode?: string } | null }))
    .filter((x) => Array.isArray(x.before?.path))
    .sort((a, b) => (a.e.at < b.e.at ? 1 : a.e.at > b.e.at ? -1 : 0));

  const dated: Array<{ at: string; item: ChangeItem }> = [];
  const undated: ChangeItem[] = [];

  // Unhooked: only middle points.
  for (const { e, before } of removals) {
    const bp = before!.path!;
    const i = e.pointId ? bp.indexOf(e.pointId) : -1;
    if (i <= 0 || i >= bp.length - 1) continue;
    const code = before!.courseCode ?? '';
    dated.push({
      at: e.at,
      item: { kind: 'unhooked', courseCode: code, pointId: e.pointId ?? undefined, text: `Unhooked from ${code}; its building no longer counts` },
    });
  }

  // No-why: a link on the current path with no reason; named for the unhooked point when one bridged it.
  for (let i = 0; i + 1 < str.path.length; i++) {
    const from = str.path[i]!;
    const to = str.path[i + 1]!;
    const link = g.links.find((l) => l.from === from && l.to === to);
    if (!link || link.why !== null) continue;
    const bridge = removals.find(({ before }) => {
      const bp = before!.path!;
      const a = bp.indexOf(from);
      return a >= 0 && bp[a + 2] === to;
    });
    const code = bridge ? (bridge.before!.courseCode ?? '') : codeOf(from);
    const item: ChangeItem = { kind: 'no-why', courseCode: code, linkId: link.id, text: `Carried on past ${code}; no reason given yet` };
    if (bridge) dated.push({ at: bridge.e.at, item });
    else undated.push(item);
  }

  // Status items in path order.
  for (const id of str.path) {
    const st = status[id];
    const code = codeOf(id);
    if (st?.kind === 'changed') {
      undated.push({ kind: 'reworded', courseCode: code, pointId: id, text: `Reworded at ${code}: "${st.candidate.statement}"` });
    } else if (st?.kind === 'unanchored') {
      undated.push({ kind: 'unanchored', courseCode: code, pointId: id, text: `No longer anchored at ${code}` });
    }
  }

  // Depth moved: lock time vs now, and before the latest removal vs now.
  const nowDepth = (id: string) => {
    const p = g.points[id];
    return p ? nowDepthOf(p, status[id]) : null;
  };
  const now = peaksBefore(str.path, g, nowDepth);
  const lock = peaksBefore(str.path, g, (id) => {
    const p = g.points[id];
    return p ? { k: p.k, u: p.u, d: p.d } : null;
  });
  const prior = removals[0] ? peaksBefore(removals[0].before!.path!, g, nowDepth) : null;
  const seen = new Set<string>();
  for (const id of str.path) {
    const n = now.get(id);
    if (!n) continue;
    const code = codeOf(id);
    for (const then of [lock.get(id), prior?.get(id)]) {
      if (!then || same(n, then)) continue;
      const text = `The depth reaching ${code} is now ${show(n)}, was ${show(then)}`;
      if (seen.has(text)) continue;
      seen.add(text);
      undated.push({ kind: 'depth-moved', courseCode: code, pointId: id, text });
    }
  }

  dated.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return [...dated.map((d) => d.item), ...undated];
}

export function courseChanges(
  g: StringGraph,
  status: Record<string, PointStatus>,
  courseCode: string,
  levelOf: (code: string) => number,
): ChangeItem[] {
  return stringsAt(g, courseCode).flatMap((s) =>
    stringChanges(g, status, s.id, levelOf).filter((c) => c.courseCode === courseCode),
  );
}

export function orphansOf(
  lib: Library,
  g: StringGraph,
  notes: OrphanNote[],
  courseCode: string,
): { developed: OrphanSkill[]; unsupplied: OrphanSkill[] } {
  const version = lib.courses.find((c) => c.code === courseCode)?.versions[0];
  if (!version) return { developed: [], unsupplied: [] };
  const active = g.strings.filter((s) => s.status === 'active');
  const noteFor = (role: 'develops' | 'requires', hash: string): string | null => {
    const hits = notes.filter((n) => n.courseCode === courseCode && n.role === role && n.statementHash === hash);
    if (hits.length === 0) return null;
    return hits.reduce((a, b) => (b.at > a.at ? b : a)).reason;
  };

  const onString = new Set<string>();
  const supplied = new Set<string>();
  for (const s of active) {
    let developedBefore = false;
    for (const id of s.path) {
      const p = g.points[id];
      if (!p) continue;
      if (p.role === 'develops') {
        developedBefore = true;
        if (p.courseCode === courseCode) onString.add(p.statementHash);
      } else if (developedBefore && p.courseCode === courseCode) {
        supplied.add(p.statementHash);
      }
    }
  }

  const developed = version.skills
    .map((s) => ({ statement: s.statement, hash: hashOf(s.statement) }))
    .filter((s) => !onString.has(s.hash))
    .map((s) => ({ ...s, note: noteFor('develops', s.hash) }));
  const unsupplied = version.required
    .map((s) => ({ statement: s.statement, hash: hashOf(s.statement) }))
    .filter((s) => !supplied.has(s.hash))
    .map((s) => ({ ...s, note: noteFor('requires', s.hash) }));
  return { developed, unsupplied };
}
