'use client';
import { useMemo } from 'react';
import { mapStringSegments } from '@/lib/builder/strings/touch';
import type { PointStatus, StringGraph } from '@/lib/builder/strings/types';
import { colorOf } from '../clusters/stringsOnCluster';

type Box = { x: number; y: number; w: number; h: number };
const STUB = 44;

/** Locked strings drawn over the plan map (read-only): colored curves between cards, a stub where a string leaves the plan. Render inside the front SVG. */
export function MapStrings(props: {
  graph: StringGraph;
  status: Record<string, PointStatus>;
  cards: Record<string, Box>;
  /** Course code to the card ref placed on this map. */
  refOf: Record<string, string>;
  onOpen: (stringId: string) => void;
}) {
  const { graph, status, cards, refOf, onOpen } = props;
  const boxOf = (code: string): Box | undefined => (refOf[code] ? cards[refOf[code]!] : undefined);
  const onMap = useMemo(() => new Set(Object.keys(refOf).filter(c => cards[refOf[c]!])), [refOf, cards]);
  const segments = useMemo(() => mapStringSegments(graph, onMap), [graph, onMap]);
  const nameOf = (id: string) => graph.strings.find(s => s.id === id)?.name ?? 'String';

  // Where strings share a point (two or more active strings through one point), and which cards hold a reworded or lost skill.
  const shared = new Set<string>();
  const changed = new Set<string>();
  const seen = new Map<string, number>();
  for (const s of graph.strings) {
    if (s.status !== 'active') continue;
    for (const id of s.path) {
      const code = graph.points[id]?.courseCode;
      if (!code || !onMap.has(code)) continue;
      seen.set(id, (seen.get(id) ?? 0) + 1);
      if (seen.get(id) === 2) shared.add(code);
      const k = status[id]?.kind;
      if (k === 'changed' || k === 'unanchored') changed.add(code);
    }
  }

  const slot = new Map<string, number>(); // parallel curves on one pair of cards fan out
  const nth = (key: string) => { const n = slot.get(key) ?? 0; slot.set(key, n + 1); return n; };

  return (
    <g className="bs-strings">
      {segments.map(seg => {
        const a = boxOf(seg.from);
        if (!a) return null;
        const color = `var(--str-${colorOf(seg.stringId)})`;
        const name = nameOf(seg.stringId);
        if ('leaves' in seg) {
          const i = nth(`${seg.from}>leaves`);
          const sx = a.x + a.w, sy = a.y + a.h / 2 + 12 * i;
          const label = `continues to ${seg.leaves}, not in this plan`;
          return (
            <g key={`${seg.stringId}:${seg.from}>${seg.leaves}`} role="button" tabIndex={0} aria-label={`String ${name}: ${label}`} className="bs-string" style={{ color }}
              onClick={() => onOpen(seg.stringId)} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); onOpen(seg.stringId); } }}>
              <title>{name}</title>
              <path className="bs-string__hit" d={`M ${sx} ${sy} h ${STUB}`} />
              <path className="bs-string__line" d={`M ${sx} ${sy} h ${STUB}`} />
              <line className="bs-string__cap" x1={sx + STUB} x2={sx + STUB} y1={sy - 5} y2={sy + 5} />
              <text className="bs-string__stub" x={sx + STUB + 6} y={sy + 4}>{label}</text>
            </g>
          );
        }
        const b = boxOf(seg.to);
        if (!b) return null;
        const i = nth([seg.from, seg.to].sort().join('|'));
        const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
        const p = vertical
          ? { x: a.x + a.w / 2, y: b.y > a.y ? a.y + a.h : a.y }
          : { x: b.x > a.x ? a.x + a.w : a.x, y: a.y + a.h / 2 };
        const q = vertical
          ? { x: b.x + b.w / 2, y: b.y > a.y ? b.y : b.y + b.h }
          : { x: b.x > a.x ? b.x : b.x + b.w, y: b.y + b.h / 2 };
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
        const bend = 26 + 14 * i;
        const d = `M ${p.x} ${p.y} Q ${mx - (dy / len) * bend} ${my + (dx / len) * bend} ${q.x} ${q.y}`;
        return (
          <g key={`${seg.stringId}:${seg.from}>${seg.to}`} role="button" tabIndex={0} aria-label={`String ${name}: ${seg.from} to ${seg.to}`}
            className={`bs-string${seg.kind === 'merge' ? ' bs-string--merge' : ''}`} style={{ color }}
            onClick={() => onOpen(seg.stringId)} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); onOpen(seg.stringId); } }}>
            <title>{name}</title>
            <path className="bs-string__hit" d={d} />
            <path className="bs-string__line" d={d} />
            <circle className="bs-string__end" cx={q.x} cy={q.y} r={3.5} />
          </g>
        );
      })}
      {[...shared].map(code => { const b = boxOf(code)!; return <circle key={`s:${code}`} className="bs-mark bs-mark--shared" cx={b.x + b.w} cy={b.y + b.h / 2} r={4.5}><title>More than one string passes through this course</title></circle>; })}
      {[...changed].map(code => { const b = boxOf(code)!; return <circle key={`c:${code}`} className="bs-mark bs-mark--changed" cx={b.x} cy={b.y + b.h / 2} r={4.5}><title>A skill on a string here has been reworded or is no longer there</title></circle>; })}
    </g>
  );
}
