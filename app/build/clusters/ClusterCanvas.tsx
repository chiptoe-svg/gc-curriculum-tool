'use client';

/**
 * The course cluster canvas (spec 2026-11-17-course-cluster-map-design.md, goals 2 and 3): cards placed freely
 * (position means nothing), arrows from catalog prerequisites plus arrows drawn here. An arrow is drawn by dragging from
 * a card's handle onto another card; clicking an arrow offers "Remove arrow" (a catalog arrow is set aside in
 * `unlinked`, a drawn one leaves `links`). An arrow that would close a loop is refused with the reason, and nothing changes.
 */
import { useMemo, useRef, useState } from 'react';
import { CARD_H, CARD_W } from '@/lib/builder/layout';
import { clusterEdges, loopMessage, wouldCycle, type ClusterEdge } from '@/lib/builder/cluster/graph';
import type { ClusterCard, ClusterState } from '@/lib/builder/cluster/state';
import type { StatusResult } from '@/lib/builder/cluster/status';
import type { Library } from '@/lib/builder/types';
import type { Update } from '../[id]/Builder';

const GAP = 56;
const MARGIN = 40;
const MAX_COORD = 20000; // the schema's limit (lib/builder/cluster/state.ts)

/** Where a new card goes: right of the rightmost card, level with it; the top left on an empty canvas. */
export function nextCardSpot(cards: readonly ClusterCard[]): { x: number; y: number } {
  if (!cards.length) return { x: MARGIN, y: MARGIN };
  const right = cards.reduce((a, b) => (b.x > a.x ? b : a));
  return { x: Math.min(MAX_COORD - CARD_W, right.x + CARD_W + GAP), y: right.y };
}

/** A course on the cluster by its ref: a tracked course's code and title, or a proposed one's. */
export function cardCourse(library: Library, state: ClusterState, ref: string): { code: string; title: string; proposed: boolean } {
  const lc = library.courses.find(c => c.code === ref);
  if (lc) return { code: lc.code, title: lc.title, proposed: false };
  const p = state.proposed.find(x => x.id === ref);
  return p ? { code: p.code, title: p.title, proposed: true } : { code: ref, title: '', proposed: false };
}

/**
 * Required-skill counts for a card: met (alone or by a set), partly (including parts met), not, still matching, and
 * waiting on a match that failed (`failed`: the campus model did not answer), which could not be checked.
 */
export function cardCounts(results: readonly StatusResult[], failed: (r: StatusResult) => boolean = () => false) {
  const n = { met: 0, partly: 0, not: 0, matching: 0, failed: 0 };
  for (const r of results) {
    if (r.status === 'met' || r.status === 'met_set') n.met++;
    else if (r.status === 'partly' || r.status === 'parts_met') n.partly++;
    else if (r.status === 'not') n.not++;
    else if (failed(r)) n.failed++;
    else n.matching++;
  }
  return n;
}

const clamp = (v: number) => Math.max(0, Math.min(MAX_COORD - CARD_W, Math.round(v)));

/** The point where the segment from a card's center toward (dx, dy) leaves the card. */
function edgePoint(cx: number, cy: number, dx: number, dy: number) {
  const t = Math.min(dx ? (CARD_W / 2) / Math.abs(dx) : Infinity, dy ? (CARD_H / 2) / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

export function ClusterCanvas(props: {
  library: Library; state: ClusterState; update: Update<ClusterState>;
  /** Required-skill statuses by course ref (clusterStatuses(...).required). */
  statuses: Record<string, StatusResult[]>;
  /** Whether a pending required skill's last match failed (counted as "could not be checked"). */
  failed?: (ref: string, r: StatusResult) => boolean;
  selected: string | null; onSelect: (ref: string | null) => void;
}) {
  const { library, state, update } = props;
  const edges = useMemo(() => clusterEdges(library, state), [library, state]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [arrow, setArrow] = useState<ClusterEdge | null>(null);
  /** A card being moved: where it started and where the pointer took it. */
  const [drag, setDrag] = useState<{ ref: string; px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  /** An arrow being drawn from a card, to the pointer. */
  const [drawing, setDrawing] = useState<{ from: string; x: number; y: number } | null>(null);
  const justDragged = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const info = (ref: string) => cardCourse(library, state, ref);
  const pos = (c: ClusterCard) => (drag?.ref === c.ref ? { x: drag.x, y: drag.y } : { x: c.x, y: c.y });
  const at = new Map(state.cards.map(c => [c.ref, pos(c)]));
  const local = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0) + (box.current?.scrollLeft ?? 0), y: e.clientY - (r?.top ?? 0) + (box.current?.scrollTop ?? 0) };
  };

  const link = (from: string, to: string) => {
    if (from === to) return;
    if (edges.some(e => e.from === from && e.to === to)) return;
    if (wouldCycle(edges, from, to)) { setRefusal(loopMessage(info(from).code, info(to).code)); return; }
    setRefusal(null);
    // Drawing a catalog arrow that was set aside brings it back rather than adding a second one.
    if (state.unlinked.some(l => l.from === from && l.to === to)) update(s => ({ ...s, unlinked: s.unlinked.filter(l => !(l.from === from && l.to === to)) }));
    else update(s => ({ ...s, links: [...s.links, { from, to }] }));
  };
  const removeArrow = (e: ClusterEdge) => {
    if (e.source === 'catalog') update(s => ({ ...s, unlinked: [...s.unlinked, { from: e.from, to: e.to }] }));
    else update(s => ({ ...s, links: s.links.filter(l => !(l.from === e.from && l.to === e.to)) }));
    setArrow(null);
  };

  const width = Math.max(...state.cards.map(c => pos(c).x + CARD_W + 2 * MARGIN), 600);
  const height = Math.max(...state.cards.map(c => pos(c).y + CARD_H + 2 * MARGIN), 360);

  const onMove = (e: React.PointerEvent) => {
    if (drag) {
      const p = local(e);
      const dx = p.x - drag.px, dy = p.y - drag.py;
      const card = state.cards.find(c => c.ref === drag.ref);
      if (card && (drag.moved || Math.abs(dx) + Math.abs(dy) > 3)) setDrag({ ...drag, x: clamp(card.x + dx), y: clamp(card.y + dy), moved: true });
    }
    if (drawing) setDrawing({ ...drawing, ...local(e) });
  };
  const onUp = () => {
    if (drag?.moved) {
      const { ref, x, y } = drag;
      justDragged.current = true;
      update(s => ({ ...s, cards: s.cards.map(c => (c.ref === ref ? { ...c, x, y } : c)) }));
    }
    setDrag(null);
    setDrawing(null);
  };

  const arrowAt = (e: ClusterEdge) => {
    const a = at.get(e.from), b = at.get(e.to);
    if (!a || !b) return null;
    const ac = { x: a.x + CARD_W / 2, y: a.y + CARD_H / 2 }, bc = { x: b.x + CARD_W / 2, y: b.y + CARD_H / 2 };
    const dx = bc.x - ac.x, dy = bc.y - ac.y;
    if (!dx && !dy) return null;
    return { p: edgePoint(ac.x, ac.y, dx, dy), q: edgePoint(bc.x, bc.y, -dx, -dy) };
  };

  return (
    <div className="cl-canvas-wrap">
      <p className="cl-help">
        Arrows point from a prerequisite to the course that needs it. Required skills are checked against everything upstream along the arrows.
        Drag a card to move it; drag from a card&rsquo;s ● handle onto another card to draw an arrow; click an arrow to remove it.
      </p>
      {refusal && (
        <p className="cl-refusal" role="alert">
          {refusal} <button type="button" className="cb-linkbtn" onClick={() => setRefusal(null)}>Dismiss</button>
        </p>
      )}
      <div ref={box} className="cl-canvas" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        onClick={e => { if (e.target === e.currentTarget) { setArrow(null); props.onSelect(null); } }}>
        <svg className="cl-arrows" width={width} height={height}>
          <defs>
            <marker id="cl-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {edges.map(e => {
            const g = arrowAt(e);
            if (!g) return null;
            const from = info(e.from).code, to = info(e.to).code;
            const on = arrow?.from === e.from && arrow?.to === e.to;
            return (
              <g key={`${e.from}>${e.to}`} role="button" tabIndex={0} aria-label={`Arrow from ${from} to ${to}`}
                className={`cl-arrow cl-arrow--${e.source}${on ? ' is-on' : ''}`}
                onClick={() => setArrow(on ? null : e)} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); setArrow(on ? null : e); } }}>
                <title>{e.source === 'catalog' ? `Catalog prerequisite: ${from} before ${to}` : `Drawn on this cluster: ${from} before ${to}`}</title>
                <line className="cl-arrow__hit" x1={g.p.x} y1={g.p.y} x2={g.q.x} y2={g.q.y} />
                <line className="cl-arrow__line" x1={g.p.x} y1={g.p.y} x2={g.q.x} y2={g.q.y} markerEnd="url(#cl-head)" />
              </g>
            );
          })}
          {drawing && at.get(drawing.from) && (
            <line className="cl-arrow__draft" x1={at.get(drawing.from)!.x + CARD_W} y1={at.get(drawing.from)!.y + CARD_H / 2} x2={drawing.x} y2={drawing.y} markerEnd="url(#cl-head)" />
          )}
        </svg>

        {arrow && (() => {
          const g = arrowAt(arrow);
          if (!g) return null;
          return (
            <div className="cl-arrowmenu" style={{ left: (g.p.x + g.q.x) / 2, top: (g.p.y + g.q.y) / 2 }}>
              <span>{arrow.source === 'catalog' ? 'Catalog prerequisite' : 'Drawn on this cluster'}</span>
              <button type="button" className="cb-btn" onClick={() => removeArrow(arrow)}>Remove arrow</button>
              <button type="button" className="cb-linkbtn" onClick={() => setArrow(null)}>Cancel</button>
            </div>
          );
        })()}

        {state.cards.map(c => {
          const { code, title, proposed } = info(c.ref);
          const e = state.courseEdits?.[c.ref];
          const edited = !!e && e.objectives.length + e.required.length + e.developed.length > 0;
          const n = cardCounts(props.statuses[c.ref] ?? [], r => !!props.failed?.(c.ref, r));
          const p = pos(c);
          return (
            <div key={c.ref} role="group" aria-label={`${code} ${title}`}
              className={`cl-card${props.selected === c.ref ? ' is-selected' : ''}${proposed || edited ? ' cl-card--proposed' : ''}${drag?.ref === c.ref ? ' is-dragging' : ''}`}
              style={{ left: p.x, top: p.y, width: CARD_W, minHeight: CARD_H }}
              onPointerDown={ev => { justDragged.current = false; if (ev.button === 0) { const q = local(ev); setDrag({ ref: c.ref, px: q.x, py: q.y, x: c.x, y: c.y, moved: false }); } }}
              onPointerUp={() => { if (drawing) link(drawing.from, c.ref); }}
              onClick={() => { if (justDragged.current) { justDragged.current = false; return; } setArrow(null); props.onSelect(c.ref); }}>
              <div className="cl-card__top">
                <span className="cl-card__code">{code}</span>
                {(proposed || edited) && <span className="cl-card__tag" title={proposed ? 'Not a captured course: made on this cluster or drafted from a syllabus' : 'Edited on this cluster'}>proposed</span>}
              </div>
              <span className="cl-card__title" title={title}>{title}</span>
              <span className="cl-card__counts" title="Required skills checked against the courses upstream">
                {n.met} met · {n.partly} partly · {n.not} not{n.matching ? ` · ${n.matching} matching` : ''}{n.failed ? ` · ${n.failed} could not be checked` : ''}
              </span>
              <button type="button" className="cl-card__handle" aria-label={`Draw an arrow from ${code}`}
                title="Drag onto the course that needs this one"
                onPointerDown={ev => { ev.stopPropagation(); setRefusal(null); setArrow(null); const q = local(ev); setDrawing({ from: c.ref, x: q.x, y: q.y }); }}
                onClick={ev => ev.stopPropagation()}>●</button>
            </div>
          );
        })}
        {state.cards.length === 0 && <p className="cl-empty">No courses yet. Add one from the library on the left.</p>}
      </div>
    </div>
  );
}
