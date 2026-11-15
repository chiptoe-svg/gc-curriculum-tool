'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { computePlan, defaultAct, hoursOf, placeCourses } from '@/lib/builder/compute';
import { genEdCheck, type GenEdCategory } from '@/lib/builder/degree';
import { layoutLanes, moveCard } from '@/lib/builder/layout';
import type { Act, Library, PlanState } from '@/lib/builder/types';
import type { CatalogHit } from '@/lib/builder/library';
import { CurriculumMap, type DropTarget, type Selection } from './Map';
import { LibraryPanel } from './LibraryPanel';
import { CourseDrawer } from './CourseDrawer';
import { ObjectiveDrawer } from './ObjectiveDrawer';
import { TargetsDrawer } from './TargetsDrawer';
import { ChecksPanel } from './ChecksPanel';
import { ActTargetsDrawer } from './ActTargetsDrawer';
import { RequirementDrawer } from './RequirementDrawer';
import { newId } from './ui';

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'refused';
const MAX_PROPOSED = 60; // the server's limit (lib/builder/plan-schema.ts)
const ZOOMS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
export type Update = (fn: (p: PlanState) => PlanState) => void;

/** This viewer's own view settings (zoom, library shown). Kept in this browser only; never part of the shared plan. */
type View = { zoom: number; library: boolean; arrows: boolean; courseWidth: number | null };
function readView(): View {
  try {
    const v = JSON.parse(localStorage.getItem('cb-view') ?? '{}') as { zoom?: unknown; library?: unknown; arrows?: unknown; courseWidth?: unknown };
    return { zoom: typeof v.zoom === 'number' && ZOOMS.includes(v.zoom) ? v.zoom : 1, library: v.library !== false, arrows: v.arrows !== false,
      courseWidth: typeof v.courseWidth === 'number' && v.courseWidth > 0 && v.courseWidth < 20000 ? v.courseWidth : null };
  } catch { return { zoom: 1, library: true, arrows: true, courseWidth: null }; }
}
function writeView(v: View) {
  try { localStorage.setItem('cb-view', JSON.stringify(v)); } catch { /* private window or storage blocked: the setting lasts for this visit */ }
}

export function Builder(props: {
  planId: string; slug: string; library: Library; initialName: string; initialState: PlanState;
  initialVersion: number; lastEditedBy: string; knownName: string | null;
  /** The plan's catalog year and its General Education categories (lib/builder/degree-data.ts). */
  genEd: { year: string; categories: GenEdCategory[] };
}) {
  const { library } = props;
  const [plan, setPlan] = useState(props.initialState);
  const [name, setName] = useState(props.initialName);
  const [undo, setUndo] = useState<PlanState[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<'targets' | 'checks' | { act: Act } | null>(
    props.initialState.goal.targetIds.length === 0 && !props.initialState.goal.program ? 'targets' : null);
  const [view, setView] = useState<string>('all');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [arrows, setArrows] = useState(true);
  const [courseWidth, setCourseWidth] = useState<number | null>(null);
  // Read after the first render, so the server's HTML and the browser's first render agree.
  useEffect(() => { const v = readView(); setZoom(v.zoom); setLibraryOpen(v.library); setArrows(v.arrows); setCourseWidth(v.courseWidth); }, []);
  const changeView = (next: Partial<View>) => {
    const v = { zoom: next.zoom ?? zoom, library: next.library ?? libraryOpen, arrows: next.arrows ?? arrows, courseWidth: next.courseWidth !== undefined ? next.courseWidth : courseWidth };
    setZoom(v.zoom); setLibraryOpen(v.library); setArrows(v.arrows); setCourseWidth(v.courseWidth); writeView(v);
  };
  const zoomStep = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(zoom);
    const j = Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.indexOf(1) : i) + dir));
    changeView({ zoom: ZOOMS[j]! });
  };
  const [save, setSaveState] = useState<SaveState>('saved');
  const saveRef = useRef<SaveState>('saved');
  const setSave = useCallback((s: SaveState) => { saveRef.current = s; setSaveState(s); }, []);
  const [notice, setNotice] = useState('');
  const version = useRef(props.initialVersion);
  /** The version someone else saved, learned from a conflict. Used only if the person chooses to overwrite. */
  const theirs = useRef<number | null>(null);
  const inFlight = useRef(false);
  const unsaved = useRef(false);
  const latest = useRef({ plan, name });
  latest.current = { plan, name };

  /** An edit happened. It never clears a conflict or a refusal: those stay until the person chooses what to do. */
  const touch = useCallback(() => {
    unsaved.current = true;
    if (saveRef.current !== 'conflict' && saveRef.current !== 'refused') setSave('dirty');
  }, [setSave]);

  const update: Update = useCallback(fn => {
    const prev = latest.current.plan;
    const next = fn(prev);
    if (next === prev) return;
    latest.current = { ...latest.current, plan: next }; // so two updates in one event build on each other
    setUndo(u => [...u.slice(-40), prev]);
    setPlan(next);
    touch();
  }, [touch]);

  const author = useCallback(() => {
    if (props.knownName) return props.knownName;
    try { return localStorage.getItem('cb-author') ?? ''; } catch { return ''; }
  }, [props.knownName]);

  const putBody = useCallback(() => JSON.stringify({
    name: latest.current.name, state: latest.current.plan, version: version.current, authorName: author(),
  }), [author]);

  // One save at a time. A conflict or a refusal stops saving until the person chooses; nothing here overwrites
  // someone else's save unless overwrite() was called.
  const persist = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSave('saving');
    const sent = latest.current;
    try {
      const res = await fetch(`/api/build/plans/${props.planId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: putBody() });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        theirs.current = typeof body.version === 'number' ? body.version : null;
        setNotice(body.updatedBy ?? 'Someone else');
        setSave('conflict');
        return;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        setNotice(res.status === 404 ? 'This plan has been deleted, so it can no longer be saved.'
          : res.status === 400 ? `The server did not accept the plan: ${body.error ?? 'it could not be read'} A blank name or a very large plan can cause this.`
          : 'This sign-in cannot save plans.');
        setSave('refused');
        return;
      }
      if (!res.ok) throw new Error(body.error ?? 'save failed');
      version.current = body.version;
      const clean = latest.current.plan === sent.plan && latest.current.name === sent.name;
      unsaved.current = !clean;
      setSave(clean ? 'saved' : 'dirty');
    } catch {
      setSave('error');
    } finally {
      inFlight.current = false;
      // Edits made while the save was in flight: the state is already 'dirty', so the effect below will not re-run.
      if (unsaved.current && saveRef.current === 'dirty') setTimeout(() => { void persist(); }, 600);
    }
  }, [props.planId, putBody, setSave]);

  /** The person chose to keep their version: save over the one someone else saved. */
  const overwrite = useCallback(() => {
    if (theirs.current != null) version.current = theirs.current;
    theirs.current = null;
    void persist();
  }, [persist]);

  useEffect(() => {
    if (save !== 'dirty') return;
    const t = setTimeout(() => { void persist(); }, 1200);
    return () => clearTimeout(t);
  }, [save, plan, name, persist]);

  // Leaving with unsaved edits: send them on the way out, and warn when they cannot be sent.
  useEffect(() => {
    const stuck = () => saveRef.current === 'conflict' || saveRef.current === 'refused' || saveRef.current === 'error';
    const flush = () => {
      if (!unsaved.current || stuck() || inFlight.current) return;
      unsaved.current = false;
      void fetch(`/api/build/plans/${props.planId}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: putBody() });
    };
    const warn = (e: BeforeUnloadEvent) => { if (unsaved.current && (stuck() || inFlight.current)) e.preventDefault(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', warn); flush(); };
  }, [props.planId, putBody]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing) { e.preventDefault(); stepBack(); }
      if (e.key === 'Escape') { setSelection(null); setPanel(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function stepBack() {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    latest.current = { ...latest.current, plan: prev };
    setUndo(undo.slice(0, -1));
    setPlan(prev);
    touch();
  }

  // A deleted branch cannot stay selected in the view.
  const shown = view === 'all' || view === 'trunk' || plan.branches.some(b => b.id === view) ? view : 'all';
  const branchView = shown === 'all' ? 'all' : shown === 'trunk' ? [] : [shown];
  const result = useMemo(() => computePlan(library, plan, branchView), [library, plan, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const allCourses = useMemo(() => placeCourses(library, plan), [library, plan]);
  const hours = useMemo(() => hoursOf(allCourses), [allCourses]);
  const genEdRows = useMemo(() => genEdCheck(props.genEd.categories, allCourses), [props.genEd.categories, allCourses]);
  const genEdShort = genEdRows.filter(r => r.status === 'short').length;
  const placedRefs = useMemo(() => new Set(plan.placements.map(p => p.ref)), [plan.placements]);
  const positions = useMemo(() => layoutLanes(plan.placements, new Set(plan.branches.map(b => b.id))), [plan.placements, plan.branches]);

  // ---- mutations ----------------------------------------------------------
  const place = (ref: string, target: DropTarget) => update(p => {
    if (target.at) {
      // Dropped on a term row: the card stays there, and teaching order (and fade) follow from where it sits.
      const at = target.at;
      const cur = p.placements.find(x => x.ref === ref);
      if (cur && cur.act === target.act && (cur.branch ?? null) === target.branch && cur.slot === at.slot && cur.x === Math.round(at.x)) return p;
      return { ...p, placements: moveCard(p.placements, new Set(p.branches.map(b => b.id)), ref, target.act, target.branch, at) };
    }
    if (target.before === ref) return p; // dropped on itself
    const rest = p.placements.filter(x => x.ref !== ref);
    const entry = { ref, act: target.act, branch: target.branch };
    const at = target.before ? rest.findIndex(x => x.ref === target.before) : -1;
    if (at >= 0) rest.splice(at, 0, entry);
    else {
      // End of that lane: after the last course already in the same act and branch.
      let last = -1;
      rest.forEach((x, i) => { if (x.act === target.act && x.branch === target.branch) last = i; });
      rest.splice(last >= 0 ? last + 1 : rest.length, 0, entry);
    }
    return { ...p, placements: rest };
  });

  const addCatalog = (hit: CatalogHit, target?: DropTarget) => {
    const existing = plan.proposed.find(x => x.source === 'catalog' && x.code === hit.code);
    if (existing && !target && plan.placements.some(x => x.ref === existing.id)) {
      setSelection({ kind: 'course', ref: existing.id }); // already on the map: open it, do not move it
      return;
    }
    if (!existing && plan.proposed.length >= MAX_PROPOSED) { window.alert(`A plan can hold ${MAX_PROPOSED} new or catalog-only courses. Remove one to add another.`); return; }
    const id = existing?.id ?? newId('new');
    const level = Number(/\d/.exec(hit.code.replace(/^[A-Z]+\s*/, ''))?.[0] ?? 0);
    update(p => ({
      ...p,
      proposed: existing ? p.proposed : [...p.proposed, {
        id, source: 'catalog', code: hit.code, credits: hit.credits, title: hit.title, description: hit.description, objectives: [], depths: [],
      }],
    }));
    place(id, target ?? { act: defaultAct({ code: hit.code, level }), branch: null, before: null });
    setSelection({ kind: 'course', ref: id });
  };

  const addNew = () => {
    if (plan.proposed.length >= MAX_PROPOSED) { window.alert(`A plan can hold ${MAX_PROPOSED} new or catalog-only courses. Remove one to add another.`); return; }
    const id = newId('new');
    update(p => ({
      ...p,
      proposed: [...p.proposed, { id, source: 'new', code: 'New course', credits: null, title: 'Untitled course', description: '', objectives: [], depths: [] }],
      placements: [...p.placements, { ref: id, act: 2 as Act, branch: null }],
    }));
    setSelection({ kind: 'course', ref: id });
  };

  const onDropCourse = (payload: string, target: DropTarget) => {
    if (payload.startsWith('catalog:')) {
      try { addCatalog(JSON.parse(payload.slice(8)) as CatalogHit, target); } catch { /* not ours */ }
      return;
    }
    if (library.courses.some(c => c.code === payload) || plan.proposed.some(c => c.id === payload)) place(payload, target);
  };

  const remove = (ref: string) => {
    update(p => ({
      ...p,
      placements: p.placements.filter(x => x.ref !== ref),
      proposed: p.proposed.filter(x => x.id !== ref),
      requirements: p.requirements?.filter(x => x.id !== ref),
      links: p.links.filter(l => l.from !== ref && l.to !== ref),
    }));
    setSelection(null);
  };

  const q = `?slug=${encodeURIComponent(props.slug)}`;
  const problems = result.checks.filter(c => c.kind !== 'no_reading').length;
  const flagged = result.objectives.filter(o => o.flags.length > 0).length;
  const selectedObjective = selection?.kind === 'objective' ? result.objectives.find(o => o.competency.id === selection.id) : undefined;

  return (
    <div className="cb cb-builder">
      <header className="cb-bar">
        <Link href={`/build${q}`} className="cb-back">Plans</Link>
        <input className="cb-bar__name" value={name} maxLength={120} aria-label="Plan name"
          onChange={e => { setName(e.target.value); latest.current = { ...latest.current, name: e.target.value }; touch(); }} />

        <div className="cb-seg" role="group" aria-label="Which reading of each course the map is built from">
          <button type="button" aria-pressed={plan.lens === 'stated'} onClick={() => update(p => ({ ...p, lens: 'stated' }))}
            title="Build the map from what each course says it teaches: its stated learning objectives, read from the syllabus">Stated objectives</button>
          <button type="button" aria-pressed={plan.lens === 'discovered'} onClick={() => update(p => ({ ...p, lens: 'discovered' }))}
            title="Build the map from what CourseCapture found students actually do: the approved capture of each course">Discovered outcomes</button>
        </div>
        <label className="cb-check" title="When a course has no reading under the chosen input, use its other reading instead. Such courses are marked 'other reading' on the map.">
          <input type="checkbox" checked={plan.fill} onChange={e => update(p => ({ ...p, fill: e.target.checked }))} />
          Fill gaps
        </label>

        <label className="cb-select" title="How much a depth nobody revisits is assumed to lose per act, spread evenly over the act's three terms (each counted as a semester), from the term the course sits in. One level is the department's working assumption, not a measurement, and one rate is used for Know, Understand and Do although skills of different kinds fade at different rates.">
          Fade
          <select value={String(plan.fade)} onChange={e => update(p => ({ ...p, fade: Number(e.target.value) }))}>
            <option value="0">not counted</option>
            <option value="0.5">half a level per act</option>
            <option value="1">one level per act</option>
          </select>
        </label>

        {plan.fade > 0 && (
          <label className="cb-check" title="When on, a competency fades more slowly in an act where a closely related competency is worked at integration depth. Off by default: the research on transfer argues against assuming it, and 'related' here is only nearness of description.">
            <input type="checkbox" checked={plan.support} onChange={e => update(p => ({ ...p, support: e.target.checked }))} />
            Related competencies slow fade
          </label>
        )}

        {plan.branches.length > 0 && (
          <label className="cb-select" title="Which students the trunks are drawn for">
            Show
            <select value={shown} onChange={e => setView(e.target.value)}>
              <option value="all">every branch together</option>
              <option value="trunk">shared courses only</option>
              {plan.branches.map(b => <option key={b.id} value={b.id}>{b.name || 'Unnamed branch'} students</option>)}
            </select>
          </label>
        )}

        <span className="cb-hours" title={[
          ...hours.byTerm.map((h, i) => `Term ${i + 1}: ${h} credit hours`),
          'Shared courses only; courses on a branch are not counted.',
          ...(hours.unknown.length ? [`No credits in the catalog for: ${hours.unknown.join(', ')}`] : []),
        ].join('\n')}>
          <b>{hours.total}</b> of {plan.degreeHours ?? 120} credit hours
          <span className="cb-hours__acts">{hours.byAct.map((h, i) => <span key={i}>Act {i + 1} <b>{h}</b></span>)}</span>
        </span>
        <span className="cb-bar__spacer" />
        <button type="button" className="cb-btn" onClick={() => { setPanel(panel === 'targets' ? null : 'targets'); setSelection(null); }}>Targets</button>
        <button type="button" className={`cb-btn${problems + flagged + genEdShort > 0 ? ' cb-btn--alert' : ''}`} onClick={() => { setPanel(panel === 'checks' ? null : 'checks'); setSelection(null); }}>
          Checks{problems + flagged + genEdShort > 0 ? ` (${problems + flagged + genEdShort})` : ''}
        </button>
        <button type="button" className="cb-btn" onClick={stepBack} disabled={undo.length === 0} title="Undo the last change (Ctrl or Cmd + Z)">Undo</button>
        <button type="button" className="cb-btn" aria-pressed={!libraryOpen} onClick={() => changeView({ library: !libraryOpen })}
          title="Hide or show the course library, to give the map the full width">{libraryOpen ? 'Hide library' : 'Show library'}</button>
        <label className="cb-check" title="Show or hide the prerequisite arrows between courses. Order problems are still listed under Checks and marked on the course.">
          <input type="checkbox" checked={arrows} onChange={e => changeView({ arrows: e.target.checked })} />
          Prerequisite arrows
        </label>
        <span className="cb-zoomctl" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomStep(-1)} disabled={zoom === ZOOMS[0]} aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" onClick={() => changeView({ zoom: 1 })} title="Back to 100%">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => zoomStep(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in" title="Zoom in">+</button>
        </span>
        <span className={`cb-save cb-save--${save}`} role="status">
          {save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : 'Not saved'}
        </span>
      </header>

      {save === 'conflict' && (
        <div className="cb-banner" role="alert">
          {notice} saved this plan after you opened it. Your changes are on this screen but have not been saved, and nothing more will be saved until you choose.
          <button type="button" onClick={() => { unsaved.current = false; window.location.reload(); }}>Load their version and drop mine</button>
          <button type="button" onClick={overwrite}>Keep mine and overwrite theirs</button>
        </div>
      )}
      {save === 'refused' && (
        <div className="cb-banner" role="alert">
          {notice} Your changes are on this screen only.
          <button type="button" onClick={() => { void persist(); }}>Try again</button>
        </div>
      )}
      {save === 'error' && (
        <div className="cb-banner" role="alert">
          The plan could not be saved. Your changes are still on this screen.
          <button type="button" onClick={() => { void persist(); }}>Try again</button>
        </div>
      )}

      <div className="cb-body">
        <LibraryPanel
          library={library} plan={plan} placed={placedRefs} open={libraryOpen} onToggle={() => changeView({ library: !libraryOpen })}
          onAdd={code => { const c = library.courses.find(x => x.code === code)!; place(code, { act: defaultAct(c), branch: null, before: null }); setSelection({ kind: 'course', ref: code }); }}
          onAddCatalog={hit => addCatalog(hit)} onAddNew={addNew} onSelect={ref => setSelection({ kind: 'course', ref })}
        />
        <main className="cb-main">
          <CurriculumMap
            library={library} plan={plan} result={result} allCourses={allCourses} positions={positions} zoom={zoom} arrows={arrows} courseWidth={courseWidth} onCourseWidth={w => changeView({ courseWidth: w })} selection={selection}
            onSelect={s => { setSelection(s); setPanel(null); }} onDropCourse={onDropCourse} onOpenTargets={() => { setPanel('targets'); setSelection(null); }}
            onOpenAct={act => { setPanel({ act }); setSelection(null); }}
            onResizeAct={(act, height) => update(p => {
              const heights: [number | null, number | null, number | null] = [...(p.heights ?? [null, null, null])];
              if (heights[act - 1] === height) return p;
              heights[act - 1] = height;
              return { ...p, heights };
            })}
          />
        </main>

        {selection?.kind === 'course' && allCourses.find(c => c.ref === selection.ref)?.requirement && (
          <RequirementDrawer key={selection.ref} placed={allCourses.find(c => c.ref === selection.ref)!} onRemove={remove} onClose={() => setSelection(null)} />
        )}
        {selection?.kind === 'course' && !allCourses.find(c => c.ref === selection.ref)?.requirement && (
          <CourseDrawer key={selection.ref} courseRef={selection.ref} library={library} plan={plan} result={result} allCourses={allCourses}
            slug={props.slug} update={update} onRemove={remove} onClose={() => setSelection(null)} onSelect={setSelection} />
        )}
        {selectedObjective && (
          <ObjectiveDrawer objective={selectedObjective} library={library} plan={plan} result={result} update={update}
            onClose={() => setSelection(null)} onSelect={setSelection} />
        )}
        {panel === 'targets' && !selection && <TargetsDrawer library={library} plan={plan} result={result} update={update} onClose={() => setPanel(null)} />}
        {panel && typeof panel === 'object' && !selection && (
          <ActTargetsDrawer act={panel.act} library={library} plan={plan} result={result} update={update}
            onClose={() => setPanel(null)} onSelect={s => setSelection(s)} onOpenTargets={() => setPanel('targets')} />
        )}
        {panel === 'checks' && !selection && <ChecksPanel result={result} genEd={{ year: props.genEd.year, rows: genEdRows }} onClose={() => setPanel(null)} onSelect={s => { setSelection(s); setPanel(null); }} />}
      </div>
    </div>
  );
}
