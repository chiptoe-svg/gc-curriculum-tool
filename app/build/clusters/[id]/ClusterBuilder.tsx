'use client';

/**
 * The course cluster map (spec 2026-11-17-course-cluster-map-design.md): a free canvas of courses, arrows that decide
 * what is upstream, and skills-only statuses for required skills, course objectives and cluster objectives. Saving
 * works as on the plan map (debounce, optimistic version, a 409 stops saving until the person chooses).
 *
 * Judging: every target with a skill in its pool that has no reading yet is sent to the pair judge once per pool
 * (useThreadJudging); a target whose status waits only on the set test is sent to the set judge (useSetJudging). The
 * answers land under the keys clusterStatuses reads: `${judgeRef}|${suppliedRef}` and the target key.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { clusterVersionOf } from '@/lib/builder/compute';
import { effectiveCourse } from '@/lib/builder/edits';
import { mergeSyllabusDraft } from '@/lib/builder/edit-ops';
import { clusterStatuses, type SetVerdicts, type StatusResult } from '@/lib/builder/cluster/status';
import type { ClusterState } from '@/lib/builder/cluster/state';
import type { DraftJudgments } from '@/lib/builder/threads';
import type { Library, MatchDecision } from '@/lib/builder/types';
import type { CatalogHit } from '@/lib/builder/library';
import { LibraryPanel } from '../../[id]/LibraryPanel';
import { SyllabusImport, type SyllabusImported } from '../../[id]/SyllabusImport';
import { newId } from '../../[id]/ui';
import type { Update } from '../../[id]/Builder';
import { useThreadJudging, type JudgeJob, type JudgeOther } from '../../shared/useThreadJudging';
import { useSetJudging, type SetRequest } from '../../shared/useSetJudging';
import { ClusterCanvas, cardCourse, nextCardSpot } from '../ClusterCanvas';
import { ClusterObjectives } from '../ClusterObjectives';

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'refused';
const MAX_PROPOSED = 60; // the server's limits (lib/builder/plan-schema.ts, lib/builder/cluster/state.ts)
const MAX_CARDS = 40;
/** The anchor "course" of a cluster objective's judge job: the cluster itself. */
const CLUSTER_REF = '(cluster)';

/** One target the judges can be asked about, by its judge job key. */
type Target = { result: StatusResult; courseRef: string; kind: 'required' | 'objective' };
/** The judge job key for a target: `${courseRef}|required|${ref}` (as on the plan map) or `${courseRef}|objective|${hash}`. */
const jobKeyOf = (t: Pick<Target, 'courseRef' | 'kind' | 'result'>) => `${t.courseRef}|${t.kind}|${t.result.judgeRef}`;

export function ClusterBuilder(props: {
  clusterId: string; slug: string; library: Library; initialName: string; initialState: ClusterState;
  initialVersion: number; knownName: string | null;
  /** Latest decisions made on this cluster that name a draft skill; they apply only here. */
  clusterDecisions: Record<string, MatchDecision>;
}) {
  const { library } = props;
  const [cluster, setCluster] = useState(props.initialState);
  const [name, setName] = useState(props.initialName);
  const [undo, setUndo] = useState<ClusterState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [save, setSaveState] = useState<SaveState>('saved');
  const saveRef = useRef<SaveState>('saved');
  const setSave = useCallback((s: SaveState) => { saveRef.current = s; setSaveState(s); }, []);
  const [notice, setNotice] = useState('');
  const version = useRef(props.initialVersion);
  /** The version someone else saved, learned from a conflict. Used only if the person chooses to overwrite. */
  const theirs = useRef<number | null>(null);
  const inFlight = useRef(false);
  const unsaved = useRef(false);
  const latest = useRef({ cluster, name });
  latest.current = { cluster, name };

  /** An edit happened. It never clears a conflict or a refusal: those stay until the person chooses what to do. */
  const touch = useCallback(() => {
    unsaved.current = true;
    if (saveRef.current !== 'conflict' && saveRef.current !== 'refused') setSave('dirty');
  }, [setSave]);

  const update: Update<ClusterState> = useCallback(fn => {
    const prev = latest.current.cluster;
    const next = fn(prev);
    if (next === prev) return;
    latest.current = { ...latest.current, cluster: next }; // so two updates in one event build on each other
    setUndo(u => [...u.slice(-40), prev]);
    setCluster(next);
    touch();
  }, [touch]);

  const author = useCallback(() => {
    if (props.knownName) return props.knownName;
    try { return localStorage.getItem('cb-author') ?? ''; } catch { return ''; }
  }, [props.knownName]);
  const who = useCallback(() => author().trim() || 'Department login', [author]);

  const putBody = useCallback(() => JSON.stringify({
    name: latest.current.name, state: latest.current.cluster, version: version.current, authorName: author(),
  }), [author]);

  // One save at a time. A conflict or a refusal stops saving until the person chooses; nothing here overwrites
  // someone else's save unless overwrite() was called.
  const persist = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSave('saving');
    const sent = latest.current;
    try {
      const res = await fetch(`/api/build/clusters/${props.clusterId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: putBody() });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        theirs.current = typeof body.version === 'number' ? body.version : null;
        setNotice(body.updatedBy ?? 'Someone else');
        setSave('conflict');
        return;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        setNotice(res.status === 404 ? 'This cluster has been deleted, so it can no longer be saved.'
          : res.status === 400 ? `The server did not accept the cluster: ${body.error ?? 'it could not be read'} A blank name or a very large cluster can cause this.`
          : 'This sign-in cannot save clusters.');
        setSave('refused');
        return;
      }
      if (!res.ok) throw new Error(body.error ?? 'save failed');
      version.current = body.version;
      const clean = latest.current.cluster === sent.cluster && latest.current.name === sent.name;
      unsaved.current = !clean;
      setSave(clean ? 'saved' : 'dirty');
    } catch {
      setSave('error');
    } finally {
      inFlight.current = false;
      // Edits made while the save was in flight: the state is already 'dirty', so the effect below will not re-run.
      if (unsaved.current && saveRef.current === 'dirty') setTimeout(() => { void persist(); }, 600);
    }
  }, [props.clusterId, putBody, setSave]);

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
  }, [save, cluster, name, persist]);

  // Leaving with unsaved edits: send them on the way out, and warn when they cannot be sent.
  useEffect(() => {
    const stuck = () => saveRef.current === 'conflict' || saveRef.current === 'refused' || saveRef.current === 'error';
    const flush = () => {
      if (!unsaved.current || stuck() || inFlight.current) return;
      unsaved.current = false;
      void fetch(`/api/build/clusters/${props.clusterId}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: putBody() });
    };
    const warn = (e: BeforeUnloadEvent) => { if (unsaved.current && (stuck() || inFlight.current)) e.preventDefault(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', warn); flush(); };
  }, [props.clusterId, putBody]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing) { e.preventDefault(); stepBack(); }
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function stepBack() {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    latest.current = { ...latest.current, cluster: prev };
    setUndo(undo.slice(0, -1));
    setCluster(prev);
    touch();
  }

  // ---- statuses and judging ----------------------------------------------
  const [drafts, setDrafts] = useState<DraftJudgments>({});
  const [sets, setSets] = useState<SetVerdicts>({});
  const statuses = useMemo(() => clusterStatuses(library, cluster, drafts, sets, props.clusterDecisions),
    [library, cluster, drafts, sets, props.clusterDecisions]);
  const codeOf = useCallback((ref: string) => cardCourse(library, cluster, ref).code, [library, cluster]);

  /** Every target on the cluster, by judge job key. */
  const targets = useMemo(() => {
    const out = new Map<string, Target>();
    const put = (t: Target) => out.set(jobKeyOf(t), t);
    for (const [courseRef, rs] of Object.entries(statuses.required)) for (const result of rs) put({ result, courseRef, kind: 'required' });
    for (const [courseRef, rs] of Object.entries(statuses.objectives)) for (const result of rs) put({ result, courseRef, kind: 'objective' });
    for (const result of statuses.cluster) put({ result, courseRef: CLUSTER_REF, kind: 'objective' });
    return out;
  }, [statuses]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const anchorRef = useRef({ library, cluster, name });
  anchorRef.current = { library, cluster, name };

  // A target is judged when some skill in its pool has no reading yet. Asked once per pool: a new upstream course, or
  // an edited skill, changes the pool and asks again (the server caches every pair, so a repeat costs nothing).
  const judgeJobs = useMemo(() => {
    const jobs: JudgeJob[] = [];
    for (const [key, t] of targets) {
      const r = t.result;
      if (!r.pool.length || !r.pool.some(p => !p.judged) || (r.override && !r.staleOverride)) continue;
      jobs.push({ key, sig: `${key}|${r.pool.map(p => p.ref).sort().join(',')}`, courseRef: t.courseRef, side: 'required', ref: r.judgeRef, text: r.text });
    }
    return jobs;
  }, [targets]);
  // Read when a job is sent, from the cluster as it is then.
  const othersFor = useCallback((job: JudgeJob): JudgeOther[] => {
    const t = targetsRef.current.get(job.key);
    const { library: l, cluster: c } = anchorRef.current;
    return (t?.result.pool ?? []).map(p => ({ ref: p.ref, text: p.statement, course: p.code, title: cardCourse(l, c, p.course).title }));
  }, []);
  const anchorOf = useCallback((job: JudgeJob) => {
    const { library: l, cluster: c, name: n } = anchorRef.current;
    if (job.courseRef === CLUSTER_REF) return { course: 'Cluster', title: n || 'Course cluster' };
    if (!c.cards.some(x => x.ref === job.courseRef)) return null;
    const { code, title } = cardCourse(l, c, job.courseRef);
    return { course: code, title };
  }, []);
  const thread = useThreadJudging({ jobs: judgeJobs, othersFor, anchorOf, owner: { clusterId: props.clusterId }, setDrafts });

  // The set test, for each target that waits only on it. The whole pool is sent; the server keeps the 8 most similar.
  const setRequests = useMemo(() => {
    const out: SetRequest[] = [];
    for (const t of targets.values()) {
      const r = t.result;
      if (!r.needsSet) continue;
      const me = t.courseRef === CLUSTER_REF ? { course: 'Cluster', title: name || 'Course cluster' } : (() => { const c = cardCourse(library, cluster, t.courseRef); return { course: c.code, title: c.title }; })();
      out.push({
        key: r.targetKey, target: { key: r.targetKey, text: r.text, ...me },
        pool: r.pool.map(p => ({ ref: p.ref, text: p.statement, course: p.code, title: cardCourse(library, cluster, p.course).title })),
      });
    }
    return out;
  }, [targets, library, cluster, name]);
  const setJudging = useSetJudging({ requests: setRequests, clusterId: props.clusterId, setSets });

  /** The error from a target's last failed match (pair or set), if it is still waiting. */
  const errorOf = useCallback((r: StatusResult, courseRef: string, kind: Target['kind']) => {
    const failed = (m: string | undefined) => (m && m !== 'matching' ? m : null);
    return failed(thread.judging[jobKeyOf({ result: r, courseRef, kind })]) ?? failed(setJudging.judging[r.targetKey]);
  }, [thread.judging, setJudging.judging]);
  const retry = useCallback((r: StatusResult, courseRef: string, kind: Target['kind']) => {
    const key = jobKeyOf({ result: r, courseRef, kind });
    if (thread.judging[key] && thread.judging[key] !== 'matching') thread.retryJudge(key);
    else setJudging.retry(r.targetKey);
  }, [thread, setJudging]);

  // ---- adding and removing courses ---------------------------------------
  const onCards = useMemo(() => new Set(cluster.cards.map(c => c.ref)), [cluster.cards]);
  const full = () => {
    if (latest.current.cluster.cards.length < MAX_CARDS) return false;
    window.alert(`A cluster can hold ${MAX_CARDS} courses. Remove one to add another.`);
    return true;
  };
  const tooManyProposed = () => {
    if (latest.current.cluster.proposed.length < MAX_PROPOSED) return false;
    window.alert(`A cluster can hold ${MAX_PROPOSED} new or catalog-only courses. Remove one to add another.`);
    return true;
  };
  const withCard = (s: ClusterState, ref: string): ClusterState =>
    s.cards.some(c => c.ref === ref) ? s : { ...s, cards: [...s.cards, { ref, ...nextCardSpot(s.cards) }] };

  const addTracked = (code: string) => {
    if (!onCards.has(code)) { if (full()) return; update(s => withCard(s, code)); }
    setSelected(code);
  };
  const addCatalog = (hit: CatalogHit) => {
    const existing = cluster.proposed.find(x => x.source === 'catalog' && x.code === hit.code);
    if (existing && onCards.has(existing.id)) { setSelected(existing.id); return; }
    if (full() || (!existing && tooManyProposed())) return;
    const id = existing?.id ?? newId('new');
    update(s => withCard(existing ? s : {
      ...s, proposed: [...s.proposed, { id, source: 'catalog', code: hit.code, credits: hit.credits, title: hit.title, description: hit.description, objectives: [], depths: [] }],
    }, id));
    setSelected(id);
  };
  const addNew = () => {
    if (full() || tooManyProposed()) return;
    const id = newId('new');
    update(s => withCard({ ...s, proposed: [...s.proposed, { id, source: 'new', code: 'New course', credits: null, title: 'Untitled course', description: '', objectives: [], depths: [] }] }, id));
    setSelected(id);
  };

  const [importing, setImporting] = useState(false);
  /** A syllabus draft came back: add the course if new, merge its drafted items and links, put it on the canvas if needed. */
  const imported = (r: SyllabusImported) => {
    const s0 = latest.current.cluster;
    if ((r.created && s0.proposed.length >= MAX_PROPOSED) || (!s0.cards.some(c => c.ref === r.ref) && s0.cards.length >= MAX_CARDS)) {
      window.alert(`A cluster can hold ${MAX_CARDS} courses, ${MAX_PROPOSED} of them new or catalog-only. Remove one to add another.`);
      setImporting(false);
      return;
    }
    update(s => {
      let next = r.created ? { ...s, proposed: [...s.proposed, r.created] } : s;
      const lc = library.courses.find(c => c.code === r.ref);
      const pc = next.proposed.find(c => c.id === r.ref);
      const eff = lc || pc ? effectiveCourse((lc ?? pc)!, lc ? clusterVersionOf(lc, next) : null, next.courseEdits?.[r.ref]) : null;
      next = mergeSyllabusDraft(next, r.ref, r.draft, {
        objectives: eff?.objectives.map(o => o.text) ?? [], required: eff?.required.map(x => x.statement) ?? [], developed: eff?.developed.map(x => x.statement) ?? [],
      }, library.prereqs.map(x => ({ from: x.prereqCode, to: x.courseCode })));
      return withCard(next, r.ref);
    });
    setImporting(false);
    setSelected(r.ref);
  };

  const remove = (ref: string) => {
    update(s => ({
      ...s,
      cards: s.cards.filter(c => c.ref !== ref),
      proposed: s.proposed.filter(p => p.id !== ref),
      links: s.links.filter(l => l.from !== ref && l.to !== ref),
      unlinked: s.unlinked.filter(l => l.from !== ref && l.to !== ref),
    }));
    setSelected(null);
  };

  const q = `?slug=${encodeURIComponent(props.slug)}`;
  const sel = selected && onCards.has(selected) ? cardCourse(library, cluster, selected) : null;

  return (
    <div className="cb cb-builder cl-builder">
      <header className="cb-bar">
        <Link href={`/build${q}`} className="cb-back">Plans and clusters</Link>
        <input className="cb-bar__name" value={name} maxLength={120} aria-label="Cluster name"
          onChange={e => { setName(e.target.value); latest.current = { ...latest.current, name: e.target.value }; touch(); }} />
        <span className="cb-bar__spacer" />
        <a className="cb-btn" href={`/api/build/clusters/${props.clusterId}/changes.md`} download
          title="Download every change made on this cluster as a Markdown file. Save first so the file is current.">Export changes</a>
        <button type="button" className="cb-btn" onClick={stepBack} disabled={undo.length === 0} title="Undo the last change (Ctrl or Cmd + Z)">Undo</button>
        <button type="button" className="cb-btn" aria-pressed={!libraryOpen} onClick={() => setLibraryOpen(!libraryOpen)}
          title="Hide or show the course library">{libraryOpen ? 'Hide library' : 'Show library'}</button>
        <span className={`cb-save cb-save--${save}`} role="status">
          {save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : 'Not saved'}
        </span>
      </header>

      {save === 'conflict' && (
        <div className="cb-banner" role="alert">
          {notice} saved this cluster after you opened it. Your changes are on this screen but have not been saved, and nothing more will be saved until you choose.
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
          The cluster could not be saved. Your changes are still on this screen.
          <button type="button" onClick={() => { void persist(); }}>Try again</button>
        </div>
      )}

      <div className="cb-body">
        <LibraryPanel
          library={library} plan={cluster} placed={onCards} open={libraryOpen} onToggle={() => setLibraryOpen(!libraryOpen)}
          onAdd={addTracked} onAddCatalog={addCatalog} onAddNew={addNew} onSelect={setSelected}
          onImportSyllabus={() => setImporting(true)}
        />
        {importing && (
          <SyllabusImport endpoint={`/api/build/clusters/${props.clusterId}/syllabus`} library={library} plan={cluster} placed={onCards} author={who}
            maxProposed={MAX_PROPOSED} noun="cluster" acts={false} onClose={() => setImporting(false)} onImported={imported} />
        )}
        <main className="cb-main cl-main">
          <ClusterObjectives objectives={cluster.objectives} results={statuses.cluster} codeOf={codeOf} update={update}
            errorOf={r => errorOf(r, CLUSTER_REF, 'objective')} onRetry={r => retry(r, CLUSTER_REF, 'objective')} />
          <ClusterCanvas library={library} state={cluster} update={update} statuses={statuses.required}
            selected={selected} onSelect={setSelected} />
        </main>

        {sel && selected && (
          <aside className="cb-drawer cl-drawer" aria-label={`${sel.code} ${sel.title}`}>
            <div className="cl-drawer__head">
              <div>
                <p className="cl-card__code">{sel.code}</p>
                <h2>{sel.title}</h2>
              </div>
              <button type="button" className="cb-linkbtn" onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="cl-drawer__foot">
              <button type="button" className="cb-btn cb-btn--danger" onClick={() => remove(selected)}>Remove from cluster</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
