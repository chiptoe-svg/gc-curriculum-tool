'use client';

/**
 * The curriculum map. It builds from the bottom: Act 1 is the bottom band,
 * Act 3 the top one, and the career paths sit above them. Courses are cards
 * in the bands (left); each objective is a trunk rising through the bands
 * (right) that thickens with the depth reached, carries a K/U/D note at the
 * end of every act, and ends in ribbons to the career paths it serves.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ObjectiveResult, PlacedCourse, PlanResult } from '@/lib/builder/compute';
import { CARD_H, CARD_W, COL_W, ROW_H, slotAt, type Pos } from '@/lib/builder/layout';
import { ACTS, TERMS_PER_ACT, termOf, type Act, type Branch, type Library, type PlanState, type Slot } from '@/lib/builder/types';
import { TONE_VAR, dimNote, dimsOf, stratumName, stratumRank, toneOfCheckpoint, trunkLevel, type Tone } from './ui';

const COL = 40;          // one trunk
const GROUP_GAP = 18;    // between strata
const PAD = 22;
const CROWN_H = 168;
const ROOTS_H = 214;
const NOTE_LINE = 15;

const HEAD_W = 208;      // act heading plus lane padding, left of the cards
const DROP_OFFSET_X = 24; // where a card from the library is held, when dragged in

/** A term row's top edge in a lane's card area, as CSS: row 0 is the top row, the act's last term. */
const rowTop = (slot: Slot, inset = 0) => {
  const row = TERMS_PER_ACT - 1 - slot;
  return `calc(${row} * 100% / ${TERMS_PER_ACT} + (100% / ${TERMS_PER_ACT} - ${CARD_H}px) / 2 + ${inset}px)`;
};

export type Selection = { kind: 'course'; ref: string } | { kind: 'objective'; id: string } | null;
/** `at`: the card's top left in the lane, in map pixels at 100% zoom. Without it the course goes at the end of the lane. */
export interface DropTarget { act: Act; branch: string | null; before: string | null; at?: Pos }

interface Geom { width: number; height: number; bands: Array<{ top: number; height: number }>; cards: Record<string, { x: number; y: number; w: number; h: number }> }

export function CurriculumMap(props: {
  library: Library;
  plan: PlanState;
  result: PlanResult;
  allCourses: PlacedCourse[];
  /** Where each card sits in its lane (layoutLanes). */
  positions: Record<string, Pos>;
  zoom: number;
  /** Draw the prerequisite arrows between courses (a viewer setting). */
  arrows: boolean;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onDropCourse: (payload: string, target: DropTarget) => void;
  /** A new height for an act, in map pixels; null = automatic. */
  onResizeAct: (act: Act, height: number | null) => void;
  onOpenTargets: () => void;
  /** Open one act's targets (ActTargetsDrawer). */
  onOpenAct: (act: Act) => void;
}) {
  const { plan, result, allCourses, selection, onSelect, positions, zoom } = props;
  const mapRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Geom | null>(null);
  const [viewW, setViewW] = useState(0);
  const [hover, setHover] = useState<{ course?: string; objective?: string; target?: string } | null>(null);
  const [dropAt, setDropAt] = useState<DropTarget | null>(null);
  const [resizing, setResizing] = useState<{ act: Act; height: number } | null>(null);
  /** How far from its left edge the card being dragged was grabbed, in map pixels. Null for a drag from the library. */
  const grab = useRef<number | null>(null);

  // Trunks left to right: grouped by stratum, most important first.
  const trunks = useMemo(() => {
    const sorted = [...result.objectives].sort((a, b) =>
      stratumRank(a.competency.stratum) - stratumRank(b.competency.stratum)
      || (b.weight ?? 0) - (a.weight ?? 0) || a.competency.name.localeCompare(b.competency.name));
    let x = PAD;
    let prev: string | null | undefined;
    const groups: Array<{ name: string; from: number; to: number }> = [];
    const placed = sorted.map(o => {
      const s = o.competency.stratum;
      if (prev !== undefined && s !== prev) x += GROUP_GAP;
      if (s !== prev) groups.push({ name: stratumName(s), from: x, to: x });
      prev = s;
      const at = { o, x: x + COL / 2 };
      x += COL;
      groups[groups.length - 1]!.to = x;
      return at;
    });
    return { placed, groups, width: Math.max(x + PAD, 320) };
  }, [result.objectives]);
  const W = trunks.width;

  // The map is drawn at 100% and scaled as a whole, so every measurement below is divided by the zoom.
  useLayoutEffect(() => {
    const el = mapRef.current;
    const view = outerRef.current?.parentElement;
    if (!el || !view) return;
    const measure = () => {
      setViewW(view.clientWidth);
      const box = el.getBoundingClientRect();
      const s = (v: number) => v / zoom;
      const bands = [...el.querySelectorAll<HTMLElement>('[data-band]')]
        .sort((a, b) => Number(a.dataset.band) - Number(b.dataset.band))
        .map(b => { const r = b.getBoundingClientRect(); return { top: s(r.top - box.top), height: s(r.height) }; });
      const cards: Geom['cards'] = {};
      el.querySelectorAll<HTMLElement>('[data-card]').forEach(c => {
        const r = c.getBoundingClientRect();
        cards[c.dataset.card!] = { x: s(r.left - box.left), y: s(r.top - box.top), w: s(r.width), h: s(r.height) };
      });
      const next: Geom = { width: el.offsetWidth, height: el.offsetHeight, bands, cards };
      setGeom(prev => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(view);
    return () => ro.disconnect();
  }, [plan, result, W, zoom, positions, resizing]);

  // Wide enough for the right-most card plus three empty columns to drag into, the trunks, and at least the visible width at this zoom.
  const maxX = Math.max(0, ...Object.values(positions).map(p => p.x));
  const mapW = Math.max(viewW / zoom, HEAD_W + maxX + CARD_W + 3 * COL_W + W, 480 + W);

  const selectedCourse = selection?.kind === 'course' ? selection.ref : null;
  const selectedObjective = selection?.kind === 'objective' ? selection.id : null;
  const focusCourse = hover?.course ?? selectedCourse;
  const focusObjective = hover?.objective ?? selectedObjective;
  const focusTarget = hover?.target ?? null;
  const inView = new Set(result.courses.map(c => c.ref));
  const checkRefs = new Set(result.checks.filter(c => c.kind !== 'no_reading').map(c => c.ref));
  const touches = (o: ObjectiveResult, ref: string) => o.contributions.some(c => c.ref === ref);
  const trunkDim = (o: ObjectiveResult) =>
    (focusCourse && !touches(o, focusCourse)) || (focusObjective && focusObjective !== o.competency.id)
    || (focusTarget && !o.targetIds.includes(focusTarget));
  const cardDim = (ref: string) => {
    const o = focusObjective ? result.objectives.find(x => x.competency.id === focusObjective) : null;
    return (o && !touches(o, ref)) || !inView.has(ref);
  };

  // A drop snaps to the term row under the pointer; left to right it lands where the card's left edge would be.
  const pointIn = (e: React.DragEvent): Pos | undefined => {
    const area = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.cb-lane__cards');
    if (!area) return undefined;
    const r = area.getBoundingClientRect();
    return {
      slot: slotAt(e.clientY - r.top, r.height),
      x: Math.max(0, (e.clientX - r.left) / zoom - (grab.current ?? DROP_OFFSET_X)),
    };
  };
  const drag = {
    over: (e: React.DragEvent, act: Act, branch: string | null) => {
      e.preventDefault();
      const at = pointIn(e);
      setDropAt(prev => (prev && prev.act === act && prev.branch === branch && prev.at && at
        && prev.at.slot === at.slot && Math.abs(prev.at.x - at.x) < 4 ? prev : { act, branch, before: null, at }));
    },
    drop: (e: React.DragEvent, act: Act, branch: string | null) => {
      e.preventDefault();
      const at = pointIn(e);
      setDropAt(null);
      grab.current = null;
      const payload = e.dataTransfer.getData('text/plain');
      if (payload) props.onDropCourse(payload, { act, branch, before: null, at });
    },
  };

  // Drag an act's bottom edge to make it taller or shorter. Double-click the edge to go back to automatic.
  const startResize = (e: React.PointerEvent<HTMLDivElement>, act: Act) => {
    const bandEl = e.currentTarget.parentElement;
    if (!bandEl) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = bandEl.offsetHeight;
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    let h = startH;
    const move = (ev: PointerEvent) => { h = Math.max(120, Math.round(startH + (ev.clientY - startY) / zoom)); setResizing({ act, height: h }); };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setResizing(null);
      if (Math.abs(h - startH) >= 2) props.onResizeAct(act, h);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  const lanes: Array<Branch | null> = [null, ...plan.branches];
  const card = (c: PlacedCourse) => {
    const mark = c.reading.basis ?? 'none';
    const at = positions[c.ref] ?? { slot: 0 as Slot, x: 0 };
    return (
      <button
        key={c.ref} type="button" data-card={c.ref} data-term={termOf(c.act, at.slot)} draggable
        className={`cb-card cb-card--${mark}${selectedCourse === c.ref ? ' is-selected' : ''}${cardDim(c.ref) ? ' is-dim' : ''}`}
        style={{ left: at.x, top: rowTop(at.slot), width: CARD_W, height: CARD_H }}
        onClick={() => onSelect({ kind: 'course', ref: c.ref })}
        onMouseEnter={() => setHover({ course: c.ref })} onMouseLeave={() => setHover(null)}
        onDragStart={e => {
          grab.current = (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom;
          e.dataTransfer.setData('text/plain', c.ref); e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => { grab.current = null; setDropAt(null); }}
        title={`${c.code}: ${c.title}${c.reading.filled ? '. No reading under the chosen input, so its other reading is used' : ''}`}
      >
        <span className="cb-card__mark" aria-hidden />
        <span className="cb-card__code">{c.code}</span>
        {c.reading.filled && <span className="cb-card__tag">other reading</span>}
        <span className="cb-card__title">{c.title}</span>
        {checkRefs.has(c.ref) && <span className="cb-card__warn" title="Order or dependency problem: open the course for details">!</span>}
      </button>
    );
  };

  const band = (act: Act) => {
    const info = ACTS[act - 1]!;
    const m = result.milestones[act - 1]!;
    const chosen = resizing?.act === act ? resizing.height : plan.heights?.[act - 1] ?? null;
    return (
      <section key={act} className={`cb-band cb-band--${act}`} data-band={act} aria-label={`Act ${act}: ${info.name}`}
        style={chosen != null ? { minHeight: chosen } : undefined}>
        <header className="cb-band__head">
          <p className="cb-band__act">Act {act}</p>
          <h3>{info.name}</h3>
          <p className="cb-band__span">{info.span}</p>
          <button type="button" className="cb-band__note" onClick={() => props.onOpenAct(act)}
            title={`By the end of Act ${act}: ${m.met} of ${m.required} targets reached${m.fading ? `, ${m.fading} more reached earlier and fading` : ''}. ${m.introduced} objectives introduced, ${m.integrated} worked at integration depth. Click to see and set every target for this act.`}>
            {m.required === 0 ? 'No targets set for this act' : <><b>{m.met}</b> of {m.required} targets reached{m.fading > 0 && <>, <span className="cb-t-fading">{m.fading} fading</span></>}</>}
            <span className="cb-band__set">Set Act {act} targets</span>
          </button>
        </header>
        <div className="cb-lanes">
          {lanes.map(lane => {
            const id = lane?.id ?? null;
            const here = allCourses.filter(c => c.act === act && c.branch === id);
            const isDrop = dropAt && dropAt.act === act && dropAt.branch === id;
            return (
              <div
                key={id ?? 'trunk'} className={`cb-lane${lane ? ' cb-lane--branch' : ''}${isDrop ? ' is-drop' : ''}`}
                style={lane ? { ['--lane' as string]: `var(--cb-branch-${plan.branches.indexOf(lane) % 4})` } : undefined}
                onDragOver={e => drag.over(e, act, id)}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null); }}
                onDrop={e => drag.drop(e, act, id)}
              >
                {plan.branches.length > 0 && <p className="cb-lane__name">{lane ? lane.name || 'Unnamed branch' : 'Everyone'}</p>}
                <div className="cb-lane__cards" style={{ minHeight: TERMS_PER_ACT * ROW_H }}>
                  {([2, 1, 0] as Slot[]).map(s => (
                    <div key={s} className="cb-term" style={{ top: `calc(${TERMS_PER_ACT - 1 - s} * 100% / ${TERMS_PER_ACT})`, height: `calc(100% / ${TERMS_PER_ACT})` }} aria-hidden />
                  ))}
                  {here.map(card)}
                  {isDrop && dropAt?.at && <span className="cb-ghost" style={{ left: dropAt.at.x, top: rowTop(dropAt.at.slot), width: CARD_W, height: CARD_H }} aria-hidden />}
                  {here.length === 0 && <span className="cb-lane__empty">{lane ? 'Drop a course here to put it on this branch' : 'Drop a course here'}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="cb-band__trunks" style={{ width: W }} />
        <div className="cb-band__grip" role="separator" aria-orientation="horizontal" aria-label={`Resize Act ${act}`}
          title="Drag to make this act taller or shorter. Double-click to size it to its courses again."
          onPointerDown={e => startResize(e, act)}
          onDoubleClick={() => props.onResizeAct(act, null)} />
      </section>
    );
  };

  // ---- SVG geometry -------------------------------------------------------
  const x0 = geom ? geom.width - W : 0;
  const bandOf = (act: Act) => geom?.bands[act - 1];
  const lineCount = (o: ObjectiveResult) => dimsOf(o.competency).length;
  const halfWidth = (level: number | null) => (level == null ? 0 : (3 + level * 4.2) / 2);

  const trunkSvg = geom && geom.bands.length === 3 && trunks.placed.map(({ o, x }) => {
    const cx = x0 + x;
    const dim = trunkDim(o);
    const soft = o.basis === 'soft' || o.basis === 'mixed';
    const noteH = lineCount(o) * NOTE_LINE + 8;
    const parts: React.ReactNode[] = [];
    let below = 0; // half-width carried in from the act below
    for (const act of [1, 2, 3] as const) {
      const b = bandOf(act)!;
      const bottom = b.top + b.height;
      const noteTop = b.top + 8;
      const bodyTop = noteTop + noteH + 4;
      const level = trunkLevel(o.byAct[act - 1]!);
      const here = halfWidth(level);
      const cp = o.checkpoints[act - 1]!;
      const tone: Tone = level == null ? 'untouched' : toneOfCheckpoint(cp.status);
      if (level == null) {
        parts.push(<line key={`l${act}`} x1={cx} x2={cx} y1={bottom} y2={bodyTop} stroke="var(--cb-untouched)" strokeWidth={1.5} strokeDasharray="2 5" />);
      } else {
        const mid = (bottom + bodyTop) / 2;
        const d = `M${cx - below},${bottom} C${cx - below},${mid} ${cx - here},${mid} ${cx - here},${bodyTop} L${cx + here},${bodyTop} C${cx + here},${mid} ${cx + below},${mid} ${cx + below},${bottom} Z`;
        parts.push(<path key={`t${act}`} d={d} fill={soft ? `url(#cb-dots-${tone})` : TONE_VAR[tone]} stroke={TONE_VAR[tone]} strokeWidth={soft ? 1 : 0} />);
      }
      // Courses in this act that work the objective: a filled mark raised it, an open one reinforces it.
      const marks = o.contributions.filter(c => c.act === act);
      marks.forEach((c, i) => {
        const y = bottom - ((i + 1) * (bottom - bodyTop)) / (marks.length + 1);
        const on = focusCourse === c.ref;
        parts.push(
          <circle key={`m${act}-${c.ref}`} cx={cx} cy={y} r={on ? 6.5 : 4.2}
            fill={c.raised.length ? 'var(--cb-ink)' : 'var(--cb-paper)'} stroke={on ? 'var(--cb-accent)' : 'var(--cb-ink)'} strokeWidth={on ? 2.5 : 1.4}
            opacity={focusCourse && !on ? 0.3 : 1}>
            <title>{`${c.code}: K${c.k ?? '·'} U${c.u ?? '·'} D${c.d ?? '·'}${c.raised.length ? `, raises ${c.raised.map(r => r.toUpperCase()).join(', ')}` : ', works it again without raising it'} (${c.basis})`}</title>
          </circle>,
        );
      });
      // The note at the end of the act: level reached against the target, per dimension.
      const noteTone = toneOfCheckpoint(cp.status);
      parts.push(
        <g key={`n${act}`}>
          <rect x={cx - COL / 2 + 3} y={noteTop} width={COL - 6} height={noteH} rx={3}
            fill="var(--cb-paper)" stroke={cp.status === 'none' ? 'var(--cb-rule)' : TONE_VAR[noteTone]} strokeWidth={cp.status === 'none' ? 1 : 1.5} />
          {dimsOf(o.competency).map((dm, i) => {
            const n = dimNote(o, act - 1, dm);
            return (
              <text key={dm} x={cx} y={noteTop + 4 + (i + 1) * NOTE_LINE - 3} textAnchor="middle" className="cb-note" fill={TONE_VAR[n.tone]}>
                {n.text}<title>{`End of Act ${act}. ${n.title}`}</title>
              </text>
            );
          })}
        </g>,
      );
      below = here;
    }
    const b1 = bandOf(1)!;
    const rootsY = b1.top + b1.height;
    return (
      <g key={o.competency.id} opacity={dim ? 0.22 : 1} className="cb-trunk"
        onMouseEnter={() => setHover({ objective: o.competency.id })} onMouseLeave={() => setHover(null)}
        onClick={() => onSelect({ kind: 'objective', id: o.competency.id })}>
        <rect x={cx - COL / 2} y={geom.bands[2]!.top} width={COL} height={rootsY - geom.bands[2]!.top + ROOTS_H}
          fill={selectedObjective === o.competency.id ? 'var(--cb-select)' : 'transparent'} />
        {parts}
        <text transform={`translate(${cx + 4},${rootsY + 12}) rotate(-52)`} textAnchor="end" className={`cb-rootname${o.status === 'untouched' ? ' is-untouched' : ''}`}>
          {o.competency.name.length > 28 ? `${o.competency.name.slice(0, 27)}…` : o.competency.name}
          <title>{o.competency.name}</title>
        </text>
      </g>
    );
  });

  const targetX = (i: number) => x0 + (W * (i + 0.5)) / Math.max(1, result.targets.length);
  const ribbons = geom && geom.bands.length === 3 && result.targets.flatMap((t, ti) => {
    const top = geom.bands[2]!.top;
    const libTarget = props.library.targets.find(x => x.id === t.id);
    return trunks.placed.filter(({ o }) => o.targetIds.includes(t.id)).map(({ o, x }) => {
      const cx = x0 + x;
      const w = libTarget?.members.find(m => m.competencyId === o.competency.id)?.weight ?? null;
      const tone = toneOfCheckpoint(t.final[o.competency.id] ?? 'none');
      const tx = targetX(ti);
      const y1 = top + 4;
      const y2 = CROWN_H - 62;
      const dimmed = (focusTarget && focusTarget !== t.id) || trunkDim(o);
      return (
        <path key={`${t.id}-${o.competency.id}`} d={`M${cx},${y1} C${cx},${y1 - 34} ${tx},${y2 + 40} ${tx},${y2}`} fill="none"
          stroke={TONE_VAR[tone]} strokeWidth={w == null ? 1.4 : w >= 0.75 ? 4.4 : w >= 0.5 ? 2.8 : 1.4}
          strokeDasharray={tone === 'untouched' ? '3 4' : undefined} opacity={dimmed ? 0.08 : 0.62} strokeLinecap="round" />
      );
    });
  });

  // Dependencies: always draw the broken ones; draw the rest for the course in focus.
  const broken = new Set(result.checks.flatMap(c => (c.from ?? []).map(from => `${from}>${c.ref}`)));
  const arrows = geom && props.arrows && result.edges.filter(e => geom.cards[e.from] && geom.cards[e.to]).map(e => {
    const bad = broken.has(`${e.from}>${e.to}`);
    const focus = focusCourse === e.from || focusCourse === e.to;
    if (!bad && !focus) return null;
    const a = geom.cards[e.from]!;
    const b = geom.cards[e.to]!;
    const ax = a.x + a.w / 2, ay = a.y, bx = b.x + b.w / 2, by = b.y + b.h;
    const up = by < ay; // the dependent sits above its prerequisite, as it should
    const d = up
      ? `M${ax},${ay} C${ax},${ay - 26} ${bx},${by + 26} ${bx},${by}`
      : `M${ax},${ay + a.h / 2} C${ax - 60},${ay + a.h / 2} ${bx - 60},${b.y + b.h / 2} ${b.x},${b.y + b.h / 2}`;
    return <path key={`${e.from}>${e.to}`} d={d} fill="none" markerEnd={`url(#cb-arrow-${bad ? 'bad' : 'ok'})`}
      stroke={bad ? 'var(--cb-short)' : 'var(--cb-ink)'} strokeWidth={bad ? 2 : 1.4} strokeDasharray={e.source === 'plan' ? '5 3' : undefined} opacity={0.85} />;
  });

  const empty = result.objectives.length === 0;
  return (
    <div className="cb-zoom" ref={outerRef} style={geom ? { width: geom.width * zoom, height: geom.height * zoom } : undefined}>
    <div className="cb-map" ref={mapRef} style={{ ['--cb-trunks' as string]: `${W}px`, width: mapW, transform: zoom === 1 ? undefined : `scale(${zoom})` }}>
      <section className="cb-crown" style={{ height: CROWN_H }}>
        <div className="cb-crown__left">
          <h2>Career paths</h2>
          <p>Each objective rises from the acts below into the paths that need it. A thicker ribbon is a more important competency for that path.</p>
        </div>
        <div className="cb-crown__targets" style={{ width: W }}>
          {result.targets.map((t, i) => (
            <button key={t.id} type="button" className="cb-target" onClick={props.onOpenTargets}
              style={{ left: (W * (i + 0.5)) / result.targets.length, maxWidth: Math.max(120, W / result.targets.length - 10) }}
              onMouseEnter={() => setHover({ target: t.id })} onMouseLeave={() => setHover(null)}>
              <span className="cb-target__name">{t.name}</span>
              <span className="cb-target__fit" title="Share of this path's final targets reached, weighted by how important each competency is to the path. Importance weights are still drafts.">
                {t.fit == null ? 'No targets' : `${Math.round(t.fit * 100)}% of the way`}
              </span>
              <span className="cb-target__acts">
                {t.acts.map((a, ai) => (
                  <span key={ai} title={`End of Act ${ai + 1}: ${a.met} of ${a.required} of this path's targets reached${a.fading ? `, ${a.fading} fading` : ''}`}>
                    <i>Act {ai + 1}</i> {a.required === 0 ? '–' : `${a.met}/${a.required}`}
                  </span>
                ))}
              </span>
            </button>
          ))}
          {empty && (
            <button type="button" className="cb-target cb-target--empty" style={{ left: W / 2 }} onClick={props.onOpenTargets}>
              <span className="cb-target__name">Choose a career path</span>
              <span className="cb-target__fit">Its competencies become the trunks of this map</span>
            </button>
          )}
        </div>
      </section>

      {band(3)}
      {band(2)}
      {band(1)}

      <section className="cb-roots" style={{ height: ROOTS_H }}>
        <div className="cb-roots__left">
          <ul className="cb-legend">
            <li><span className="cb-swatch" style={{ background: 'var(--cb-reached)' }} /> Target reached</li>
            <li><span className="cb-swatch" style={{ background: 'var(--cb-fading)' }} /> Reached earlier, fading (▾)</li>
            <li><span className="cb-swatch" style={{ background: 'var(--cb-short)' }} /> Short of target (reached/target)</li>
            <li><span className="cb-swatch cb-swatch--dots" /> Rests on a stated objective or a proposed course</li>
            <li><span className="cb-dot cb-dot--full" /> Course raises the level <span className="cb-dot" /> Course works it again without raising it</li>
          </ul>
        </div>
        <div style={{ width: W }} />
      </section>

      {geom && (
        <>
          <svg className="cb-svg cb-svg--back" width={geom.width} height={geom.height} aria-hidden={empty}>
            <defs>
              {(['reached', 'fading', 'short', 'untouched', 'plain'] as const).map(t => (
                <pattern key={t} id={`cb-dots-${t}`} width="5" height="5" patternUnits="userSpaceOnUse">
                  <rect width="5" height="5" fill="var(--cb-paper)" />
                  <circle cx="2.5" cy="2.5" r="1.45" fill={TONE_VAR[t]} />
                </pattern>
              ))}
            </defs>
            {geom.bands.map((b, i) => (
              <line key={i} x1={x0} x2={geom.width} y1={b.top} y2={b.top} stroke="var(--cb-ink)" strokeWidth={1} strokeDasharray="1 4" opacity={0.5} />
            ))}
            {ribbons}
            {trunkSvg}
            {geom.bands[0] && trunks.groups.map(g => (
              <text key={g.name} x={x0 + (g.from + g.to) / 2} y={geom.height - 8} textAnchor="middle" className="cb-group">{g.name}</text>
            ))}
          </svg>
          <svg className="cb-svg cb-svg--front" width={geom.width} height={geom.height} aria-hidden>
            <defs>
              {(['ok', 'bad'] as const).map(k => (
                <marker key={k} id={`cb-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={k === 'bad' ? 'var(--cb-short)' : 'var(--cb-ink)'} />
                </marker>
              ))}
            </defs>
            {arrows}
          </svg>
        </>
      )}
    </div>
    </div>
  );
}
