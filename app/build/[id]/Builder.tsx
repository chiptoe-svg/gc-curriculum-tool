'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { computePlan, defaultAct, placeCourses } from '@/lib/builder/compute';
import type { Act, Library, PlanState } from '@/lib/builder/types';
import type { CatalogHit } from '@/lib/builder/library';
import { CurriculumMap, type DropTarget, type Selection } from './Map';
import { LibraryPanel } from './LibraryPanel';
import { CourseDrawer } from './CourseDrawer';
import { ObjectiveDrawer } from './ObjectiveDrawer';
import { TargetsDrawer } from './TargetsDrawer';
import { ChecksPanel } from './ChecksPanel';
import { newId } from './ui';

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
export type Update = (fn: (p: PlanState) => PlanState) => void;

export function Builder(props: {
  planId: string; slug: string; library: Library; initialName: string; initialState: PlanState;
  initialVersion: number; lastEditedBy: string; knownName: string | null;
}) {
  const { library } = props;
  const [plan, setPlan] = useState(props.initialState);
  const [name, setName] = useState(props.initialName);
  const [undo, setUndo] = useState<PlanState[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<'targets' | 'checks' | null>(props.initialState.goal.targetIds.length === 0 ? 'targets' : null);
  const [view, setView] = useState<string>('all');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [save, setSave] = useState<SaveState>('saved');
  const [conflictBy, setConflictBy] = useState('');
  const version = useRef(props.initialVersion);
  const latest = useRef({ plan, name });
  latest.current = { plan, name };

  const update: Update = useCallback(fn => {
    setPlan(prev => {
      const next = fn(prev);
      if (next === prev) return prev;
      setUndo(u => [...u.slice(-40), prev]);
      setSave('dirty');
      return next;
    });
  }, []);

  const author = useCallback(() => {
    if (props.knownName) return props.knownName;
    try { return localStorage.getItem('cb-author') ?? ''; } catch { return ''; }
  }, [props.knownName]);

  // After a conflict, version.current already holds the other person's version, so saving again overwrites it.
  const persist = useCallback(async () => {
    setSave('saving');
    try {
      const sent = latest.current;
      const res = await fetch(`/api/build/plans/${props.planId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sent.name, state: sent.plan, version: version.current, authorName: author() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        version.current = typeof body.version === 'number' ? body.version : version.current;
        setConflictBy(body.updatedBy ?? 'someone else');
        setSave('conflict');
        return;
      }
      if (!res.ok) throw new Error(body.error ?? 'save failed');
      version.current = body.version;
      setSave(latest.current.plan === sent.plan && latest.current.name === sent.name ? 'saved' : 'dirty');
    } catch {
      setSave('error');
    }
  }, [props.planId, author]);

  useEffect(() => {
    if (save !== 'dirty') return;
    const t = setTimeout(() => { void persist(); }, 1200);
    return () => clearTimeout(t);
  }, [save, plan, name, persist]);

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
    setUndo(u => {
      const prev = u[u.length - 1];
      if (!prev) return u;
      setPlan(prev);
      setSave('dirty');
      return u.slice(0, -1);
    });
  }

  const branchView = view === 'all' ? 'all' : view === 'trunk' ? [] : [view];
  const result = useMemo(() => computePlan(library, plan, branchView), [library, plan, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const allCourses = useMemo(() => placeCourses(library, plan), [library, plan]);
  const placedRefs = useMemo(() => new Set(plan.placements.map(p => p.ref)), [plan.placements]);

  // ---- mutations ----------------------------------------------------------
  const place = (ref: string, target: DropTarget) => update(p => {
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
          onChange={e => { setName(e.target.value); setSave('dirty'); }} />

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

        <label className="cb-select" title="How much a depth nobody revisits is assumed to lose per act. One level is the department's working assumption, not a measurement, and one rate is used for Know, Understand and Do although skills of different kinds fade at different rates.">
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
            <select value={view} onChange={e => setView(e.target.value)}>
              <option value="all">every branch together</option>
              <option value="trunk">shared courses only</option>
              {plan.branches.map(b => <option key={b.id} value={b.id}>{b.name || 'Unnamed branch'} students</option>)}
            </select>
          </label>
        )}

        <span className="cb-bar__spacer" />
        <button type="button" className="cb-btn" onClick={() => { setPanel(panel === 'targets' ? null : 'targets'); setSelection(null); }}>Targets</button>
        <button type="button" className={`cb-btn${problems + flagged > 0 ? ' cb-btn--alert' : ''}`} onClick={() => { setPanel(panel === 'checks' ? null : 'checks'); setSelection(null); }}>
          Checks{problems + flagged > 0 ? ` (${problems + flagged})` : ''}
        </button>
        <button type="button" className="cb-btn" onClick={stepBack} disabled={undo.length === 0} title="Undo the last change (Ctrl or Cmd + Z)">Undo</button>
        <span className={`cb-save cb-save--${save}`} role="status">
          {save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : save === 'error' ? 'Not saved' : 'Not saved'}
        </span>
      </header>

      {save === 'conflict' && (
        <div className="cb-banner" role="alert">
          {conflictBy} saved this plan after you opened it, so your changes have not been saved.
          <button type="button" onClick={() => window.location.reload()}>Load their version</button>
          <button type="button" onClick={() => { void persist(); }}>Keep mine and overwrite</button>
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
          library={library} plan={plan} placed={placedRefs} open={libraryOpen} onToggle={() => setLibraryOpen(o => !o)}
          onAdd={code => { const c = library.courses.find(x => x.code === code)!; place(code, { act: defaultAct(c), branch: null, before: null }); setSelection({ kind: 'course', ref: code }); }}
          onAddCatalog={hit => addCatalog(hit)} onAddNew={addNew} onSelect={ref => setSelection({ kind: 'course', ref })}
        />
        <main className="cb-main">
          <CurriculumMap
            library={library} plan={plan} result={result} allCourses={allCourses} selection={selection}
            onSelect={s => { setSelection(s); setPanel(null); }} onDropCourse={onDropCourse} onOpenTargets={() => { setPanel('targets'); setSelection(null); }}
          />
        </main>

        {selection?.kind === 'course' && (
          <CourseDrawer key={selection.ref} courseRef={selection.ref} library={library} plan={plan} result={result} allCourses={allCourses}
            slug={props.slug} update={update} onRemove={remove} onClose={() => setSelection(null)} onSelect={setSelection} />
        )}
        {selectedObjective && (
          <ObjectiveDrawer objective={selectedObjective} library={library} plan={plan} result={result} update={update}
            onClose={() => setSelection(null)} onSelect={setSelection} />
        )}
        {panel === 'targets' && !selection && <TargetsDrawer library={library} plan={plan} result={result} update={update} onClose={() => setPanel(null)} />}
        {panel === 'checks' && !selection && <ChecksPanel result={result} onClose={() => setPanel(null)} onSelect={s => { setSelection(s); setPanel(null); }} />}
      </div>
    </div>
  );
}
