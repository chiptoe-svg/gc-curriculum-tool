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
import { WHAT_IF_PREFIX, clusterVersionOf } from '@/lib/builder/compute';
import { effectiveCourse } from '@/lib/builder/edits';
import { mergeSyllabusDraft } from '@/lib/builder/edit-ops';
import { clusterStatuses, couldNotCheck, type SetVerdicts, type StatusResult } from '@/lib/builder/cluster/status';
import type { ClusterState } from '@/lib/builder/cluster/state';
import type { DraftJudgments } from '@/lib/builder/threads';
import type { Candidate, EditBase, Library, MatchDecision } from '@/lib/builder/types';
import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';
import type { CatalogHit } from '@/lib/builder/library';
import { LibraryPanel } from '../../[id]/LibraryPanel';
import { SyllabusImport, type SyllabusImported } from '../../[id]/SyllabusImport';
import { newId } from '../../[id]/ui';
import { useThreadJudging, type JudgeJob, type JudgeOther } from '../../shared/useThreadJudging';
import { useSetJudging, type SetRequest } from '../../shared/useSetJudging';
import { useAutosave } from '../../shared/useAutosave';
import { ClusterCanvas, cardCourse, nextCardSpot } from '../ClusterCanvas';
import { ClusterObjectives } from '../ClusterObjectives';
import { ClusterCourseDrawer } from './ClusterCourseDrawer';
import { StringPanel } from '@/components/strings/StringPanel';
import { useStringsAt } from '@/components/strings/useStringsAt';
import { OrphanSkills } from '@/components/strings/OrphanSkills';
import { courseEvidence } from '@/lib/builder/strings/evidence';
import { Drawer } from '../../[id]/controls';
import { SkillTreePanel } from '../../shared/SkillTreePanel';
import { LockString } from '../LockString';
import { StopTools, StringTools } from '../StringEdits';
import { lockPoint, lockTargets, type SkillInput } from '../stringsOnCluster';

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
  /** The wiki's objective guide for each tracked course on the cluster when it opened, by course code. */
  guides?: Record<string, ObjectiveGuideSection | null>;
}) {
  const { library } = props;
  const author = useCallback(() => {
    if (props.knownName) return props.knownName;
    try { return localStorage.getItem('cb-author') ?? ''; } catch { return ''; }
  }, [props.knownName]);
  const who = useCallback(() => author().trim() || 'Department login', [author]);
  const saving = useAutosave<ClusterState>({
    url: `/api/build/clusters/${props.clusterId}`, initialState: props.initialState, initialName: props.initialName,
    initialVersion: props.initialVersion, author, noun: 'cluster',
  });
  const { state: cluster, name, update, stepBack, save, notice, persist, overwrite } = saving;
  const [selected, setSelected] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing) { e.preventDefault(); stepBack(); }
      if (e.key === 'Escape') { setSelected(null); setOpenString(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- strings through the courses on the cards -------------------------------
  const catalogCodes = useMemo(() => cluster.cards.map(c => c.ref).filter(r => library.courses.some(c => c.code === r)), [cluster.cards, library.courses]);
  const q = `?slug=${encodeURIComponent(props.slug)}`;
  const strings = useStringsAt(catalogCodes, q);
  const [openString, setOpenString] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const stringsChanged = strings.changed;
  const levelOf = useCallback((code: string) => library.courses.find(c => c.code === code)?.level ?? 0, [library.courses]);
  const stringTargets = useMemo(() => lockTargets(library, cluster), [library, cluster]);
  const evidenceOf = useCallback((code: string) => courseEvidence(library, code), [library]);

  // ---- statuses and judging ----------------------------------------------
  const [drafts, setDrafts] = useState<DraftJudgments>({});
  const [sets, setSets] = useState<SetVerdicts>({});
  /** Decisions in force here: the cluster's saved draft decisions, plus every rating made in this session (so it counts at once). */
  const [decisions, setDecisions] = useState<Record<string, MatchDecision>>(props.clusterDecisions);
  const statuses = useMemo(() => clusterStatuses(library, cluster, drafts, sets, decisions),
    [library, cluster, drafts, sets, decisions]);
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
  // Built from every status by its target key (not the pair-job map, which merges targets with the same text).
  const setRequests = useMemo(() => {
    const out: SetRequest[] = [];
    const all = [
      ...Object.entries(statuses.required).flatMap(([courseRef, rs]) => rs.map(result => ({ result, courseRef }))),
      ...Object.entries(statuses.objectives).flatMap(([courseRef, rs]) => rs.map(result => ({ result, courseRef }))),
      ...statuses.cluster.map(result => ({ result, courseRef: CLUSTER_REF })),
    ];
    const seen = new Set<string>();
    for (const t of all) {
      const r = t.result;
      if (!r.needsSet || seen.has(r.targetKey)) continue;
      seen.add(r.targetKey);
      const me = t.courseRef === CLUSTER_REF ? { course: 'Cluster', title: name || 'Course cluster' } : (() => { const c = cardCourse(library, cluster, t.courseRef); return { course: c.code, title: c.title }; })();
      out.push({
        key: r.targetKey, sig: r.setSig, target: { key: r.targetKey, text: r.text, ...me },
        pool: r.pool.map(p => ({ ref: p.ref, text: p.statement, course: p.code, title: cardCourse(library, cluster, p.course).title })),
      });
    }
    return out;
  }, [statuses, library, cluster, name]);
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

  // ---- ratings and edits in the course panel -------------------------------
  const stamp = useCallback((): EditBase => ({ id: newId('edit'), by: who().slice(0, 120), at: new Date().toISOString() }), [who]);

  /**
   * Rate a (required, upstream) pair: saved through the match API with this cluster's id, then recorded here so the status
   * changes at once. A side read from a skills-only what-if is sent as a draft (its text is not in any capture).
   */
  const decide = useCallback(async (courseRef: string, r: StatusResult, cand: Candidate, label: MatchDecision['label']): Promise<string | null> => {
    const { library: l, cluster: c } = anchorRef.current;
    const read = (ref: string) => {
      const lc = l.courses.find(x => x.code === ref);
      const pc = lc ? undefined : c.proposed.find(p => p.id === ref);
      if (!lc && !pc) return null;
      const chosen = lc ? c.versions[lc.code] : undefined;
      const skillsOnly = !!lc && !!chosen?.startsWith(WHAT_IF_PREFIX) && !!lc.whatIfs.find(w => `${WHAT_IF_PREFIX}${w.id}` === chosen)?.skills;
      const v = lc ? clusterVersionOf(lc, c) : null;
      return { course: lc ? lc.code : pc!.id, title: cardCourse(l, c, ref).title, snapshotId: v && !skillsOnly ? v.snapshotId : null,
        eff: effectiveCourse((lc ?? pc)!, v, c.courseEdits?.[ref]) };
    };
    const me = read(courseRef);
    const req = me?.eff.required.find(x => x.ref === r.judgeRef);
    const from = r.pool.find(p => p.ref === cand.suppliedRef && p.code === cand.suppliedCourse);
    const sup = from ? read(from.course) : null;
    const skill = sup?.eff.developed.find(s => s.skillRef === cand.suppliedRef);
    if (!me || !req || !sup || !skill) return 'That skill is no longer on the cluster.';
    const reqDraft = req.draft || me.snapshotId === null, supDraft = skill.draft || sup.snapshotId === null;
    try {
      const res = await fetch('/api/build/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'decide', clusterId: props.clusterId, label, authorName: author(),
          required: { course: me.course, title: me.title, snapshotId: reqDraft ? null : me.snapshotId, ref: req.ref, text: req.statement },
          supplied: { course: sup.course, title: sup.title, snapshotId: supDraft ? null : sup.snapshotId, ref: skill.skillRef, text: skill.statement },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return typeof body.error === 'string' ? body.error : 'The rating was not saved.';
    } catch { return 'The rating was not saved. Check the connection and try again.'; }
    const d: MatchDecision = { requiredRef: req.ref, suppliedRef: skill.skillRef, label, by: who(), at: new Date().toISOString(), draft: reqDraft || supDraft };
    setDecisions(x => ({ ...x, [`${req.ref}|${skill.skillRef}`]: d }));
    return null;
  }, [author, who, props.clusterId]);
  const decisionsInForce = useMemo(() => ({ ...library.decisions, ...decisions }), [library.decisions, decisions]);

  // ---- adding and removing courses ---------------------------------------
  const onCards = useMemo(() => new Set(cluster.cards.map(c => c.ref)), [cluster.cards]);
  const full = () => {
    if (saving.current().cards.length < MAX_CARDS) return false;
    window.alert(`A cluster can hold ${MAX_CARDS} courses. Remove one to add another.`);
    return true;
  };
  const tooManyProposed = () => {
    if (saving.current().proposed.length < MAX_PROPOSED) return false;
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
    const s0 = saving.current();
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

  const selectCard = (ref: string | null) => { setOpenString(null); setSelected(ref); };
  const openStringId = openString && strings.graph.strings.some(x => x.id === openString) ? openString : null;
  const lockSlot = (courseRef: string, req: { statement: string; need: { k: number | null; u: number | null; d: number | null } }, r: StatusResult | undefined) => {
    if (!r || r.suppliers.length === 0) return null;
    const skill = (ref: string, role: 'develops' | 'requires', statement: string, depth: { k: number | null; u: number | null; d: number | null }): SkillInput =>
      lockPoint(library, cluster, ref, role, statement) ?? { courseCode: codeOf(ref), role, statement, snapshotId: null, ...depth };
    const none = { k: null, u: null, d: null };
    return (
      <LockString required={skill(courseRef, 'requires', req.statement, req.need)}
        suppliers={r.suppliers.map(s => skill(s.course, 'develops', s.statement, none))}
        strings={strings.graph} levelOf={levelOf} authorName={author().trim() || null} onLocked={stringsChanged} />
    );
  };

  const sel = selected && onCards.has(selected) ? cardCourse(library, cluster, selected) : null;

  return (
    <div className="cb cb-builder cl-builder">
      <header className="cb-bar">
        <Link href={`/build${q}`} className="cb-back">Plans and clusters</Link>
        <input className="cb-bar__name" value={name} maxLength={120} aria-label="Cluster name"
          onChange={e => saving.rename(e.target.value)} />
        <span className="cb-bar__spacer" />
        <a className="cb-btn" href={`/api/build/clusters/${props.clusterId}/changes.md`} download
          title="Download every change made on this cluster as a Markdown file. Save first so the file is current.">Export changes</a>
        <button type="button" className="cb-btn" onClick={stepBack} disabled={!saving.canUndo} title="Undo the last change (Ctrl or Cmd + Z)">Undo</button>
        <button type="button" className="cb-btn" aria-pressed={!libraryOpen} onClick={() => setLibraryOpen(!libraryOpen)}
          title="Hide or show the course library">{libraryOpen ? 'Hide library' : 'Show library'}</button>
        <button type="button" className="cb-btn" aria-pressed={treeOpen} onClick={() => setTreeOpen(!treeOpen)}
          title="Place this cluster's skills in the department skill tree">Skill tree</button>
        <span className={`cb-save cb-save--${save}`} role="status">
          {save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : 'Not saved'}
        </span>
      </header>

      {save === 'conflict' && (
        <div className="cb-banner" role="alert">
          {notice} saved this cluster after you opened it. Your changes are on this screen but have not been saved, and nothing more will be saved until you choose.
          <button type="button" onClick={() => { saving.discard(); window.location.reload(); }}>Load their version and drop mine</button>
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
          onAdd={addTracked} onAddCatalog={addCatalog} onAddNew={addNew} onSelect={selectCard}
          onImportSyllabus={() => setImporting(true)}
        />
        {importing && (
          <SyllabusImport endpoint={`/api/build/clusters/${props.clusterId}/syllabus`} library={library} plan={cluster} placed={onCards} author={who}
            maxProposed={MAX_PROPOSED} noun="cluster" acts={false} onClose={() => setImporting(false)} onImported={imported} />
        )}
        <main className="cb-main cl-main">
          <ClusterObjectives objectives={cluster.objectives} results={statuses.cluster} codeOf={codeOf} update={update} who={who}
            errorOf={r => errorOf(r, CLUSTER_REF, 'objective')} onRetry={r => retry(r, CLUSTER_REF, 'objective')} />
          <ClusterCanvas library={library} state={cluster} update={update} statuses={statuses.required}
            failed={(ref, r) => couldNotCheck(r, errorOf(r, ref, 'required'))} selected={selected} onSelect={selectCard}
            strings={strings.graph} status={strings.status} onOpenString={id => { setSelected(null); setOpenString(id); }} />
        </main>

        {treeOpen && (
          <Drawer wide title="Skill tree" onClose={() => setTreeOpen(false)}>
            <SkillTreePanel courseCode={null} mode="cluster" courseCodes={catalogCodes} authorName={author().trim() || null} />
          </Drawer>
        )}
        {openStringId && (() => {
          const str = strings.graph.strings.find(x => x.id === openStringId)!;
          const common = { graph: strings.graph, str, authorName: author().trim(), onChanged: stringsChanged };
          return (
            <Drawer wide title="String" onClose={() => setOpenString(null)}>
              <StringPanel graph={strings.graph} status={strings.status} stringId={openStringId} levelOf={levelOf} editable
                authorName={author().trim() || null} onChanged={stringsChanged} evidenceOf={evidenceOf} onRetry={() => void strings.refresh()}
                hrefOf={strings.hrefOf}
                stringActions={() => <StringTools {...common} targets={stringTargets} />}
                stopActions={(_, i) => <StopTools {...common} position={i} targets={stringTargets} />} />
            </Drawer>
          );
        })()}
        {sel && selected && !openStringId && (
          <ClusterCourseDrawer key={selected} courseRef={selected} clusterId={props.clusterId} slug={props.slug} library={library}
            cluster={cluster} update={update} required={statuses.required[selected] ?? []} objectives={statuses.objectives[selected] ?? []}
            codeOf={codeOf} decisions={decisionsInForce} decide={(r, cand, label) => decide(selected, r, cand, label)}
            errorOf={(r, kind) => errorOf(r, selected, kind)} onRetry={(r, kind) => retry(r, selected, kind)}
            judging={thread} stamp={stamp} who={who} author={author} guide={props.guides?.[selected] ?? null}
            lockSlot={(req, r) => lockSlot(selected, req, r)}
            stringsSlot={library.courses.some(c => c.code === selected)
              ? <OrphanSkills courseCode={selected} orphans={strings.orphans[selected]} authorName={author().trim() || null} onSaved={strings.refresh} /> : null} saved={save === 'saved'} onSelect={selectCard} onRemove={remove} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  );
}
