'use client';

/**
 * The course panel on a cluster map (spec 2026-11-17-course-cluster-map-design.md, goal 10): what /build's course
 * drawer offers, minus competencies. Statuses are skills only (statusLabel); objective overrides are kept with the
 * cluster (ClusterState.overrides); required-skill decisions go to the match API with the cluster's id. The wiki's
 * objective guide is shown read-only beside the statuses and never changes them.
 */
import { useState } from 'react';
import { WHAT_IF_PREFIX, clusterVersionOf } from '@/lib/builder/compute';
import { effectiveCourse } from '@/lib/builder/edits';
import { clusterEdges, upstreamOf } from '@/lib/builder/cluster/graph';
import type { StatusResult } from '@/lib/builder/cluster/status';
import type { ClusterState } from '@/lib/builder/cluster/state';
import type { Candidate, Depth, EditBase, Library, MatchDecision, ProposedCourse } from '@/lib/builder/types';
import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';
import { ObjectiveGuidePanel } from '@/app/wiki/ObjectiveGuidePanel';
import type { Update } from '../../[id]/Builder';
import { ChangesList, DevelopedSkillsEditor, ObjectivesEditor, courseEditOps, type JudgeView } from '../../[id]/CourseEditors';
import { Drawer } from '../../[id]/controls';
import { cardCourse } from '../ClusterCanvas';
import { ClusterRequiredList } from '../ClusterRequiredList';
import { OverrideControl } from '../OverrideControl';
import { StatusLine, SupplierLines } from '../StatusLine';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

export function ClusterCourseDrawer(props: {
  courseRef: string; clusterId: string; slug: string; library: Library; cluster: ClusterState; update: Update<ClusterState>;
  /** This course's statuses (clusterStatuses(...).required[ref] and .objectives[ref]). */
  required: StatusResult[]; objectives: StatusResult[];
  codeOf: (ref: string) => string;
  /** Decisions in force on this cluster, by `${requiredRef}|${suppliedRef}`. */
  decisions: Record<string, MatchDecision>;
  decide: (r: StatusResult, cand: Candidate, label: MatchDecision['label']) => Promise<string | null>;
  /** The error from a target's last failed match, if any. */
  errorOf: (r: StatusResult, kind: 'required' | 'objective') => string | null;
  onRetry: (r: StatusResult, kind: 'required' | 'objective') => void;
  judging: JudgeView;
  stamp: () => EditBase; who: () => string; author: () => string;
  /** The wiki's objective guide for a tracked course; null hides the section. */
  guide: ObjectiveGuideSection | null;
  /** False while the cluster has changes not saved yet (a new version is read from the saved cluster). */
  saved?: boolean;
  /** Strings controls for a required skill with suppliers (LockString); null or absent shows none. */
  lockSlot?: (req: { statement: string; need: Depth }, r: StatusResult | undefined) => React.ReactNode;
  onSelect: (ref: string) => void; onRemove: (ref: string) => void; onClose: () => void;
}) {
  const { courseRef, library, cluster, update } = props;
  const lc = library.courses.find(c => c.code === courseRef);
  const pc = cluster.proposed.find(c => c.id === courseRef);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!lc && !pc) return null;

  const version = lc ? clusterVersionOf(lc, cluster) : null;
  // Only skills-only what-ifs can be read on a cluster: a page what-if has no skills, so choosing one would change nothing.
  const skillsOnly = lc ? lc.whatIfs.filter(w => w.skills) : [];
  const eff = effectiveCourse((lc ?? pc)!, version, cluster.courseEdits?.[courseRef]);
  const ops = courseEditOps<ClusterState>(courseRef, update, props.stamp);
  const original = {
    required: new Map((version?.required ?? []).map(r => [r.ref, r.statement])),
    developed: new Map((version?.skills ?? []).map(s => [s.skillRef, s.statement])),
  };
  const onCards = new Set(cluster.cards.map(c => c.ref));
  const upstream = [...upstreamOf(clusterEdges(library, cluster), courseRef)].filter(r => onCards.has(r))
    .map(r => ({ ref: r, ...cardCourse(library, cluster, r) })).sort((a, b) => a.code.localeCompare(b.code));
  const q = `?slug=${encodeURIComponent(props.slug)}`;

  const saveVersion = async () => {
    setSaveMsg(null);
    if (props.saved === false) {
      setSaveMsg({ ok: false, text: 'This cluster has changes that are not saved yet. Wait until it says Saved, then try again.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/build/clusters/${props.clusterId}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRef, authorName: props.author() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setSaveMsg({ ok: false, text: typeof body.error === 'string' ? body.error : 'The version was not saved.' });
      else setSaveMsg({ ok: true, text: `Saved as a new version: ${body.title ?? `${lc?.code ?? ''}`}` });
    } catch {
      setSaveMsg({ ok: false, text: 'The version was not saved. Check the connection and try again.' });
    } finally { setSaving(false); }
  };

  const kicker = pc
    ? `${pc.code} · ${pc.source === 'catalog' ? 'From the Clemson catalog, not captured' : 'New course on this cluster'}`
    : `${lc!.code}${lc!.credits ? `, ${lc!.credits} credits` : ''}`;

  return (
    <Drawer onClose={props.onClose} kicker={kicker} title={pc ? pc.title || 'Untitled course' : lc!.title}>
      {lc && (
        <section className="cb-sec">
          {(lc.versions.length > 1 || skillsOnly.length > 0) && (
            <label className="cb-inline">Version on this cluster
              <select value={cluster.versions[lc.code] ?? ''} aria-label="Version on this cluster" onChange={e => {
                const chosen = e.target.value; // read now: the updater may run after the select is reset
                update(s => {
                  const versions = { ...s.versions };
                  if (chosen) versions[lc.code] = chosen; else delete versions[lc.code];
                  return { ...s, versions };
                });
              }}>
                <option value="">Newest capture{lc.versions[0] ? ` (${lc.versions[0].instructorName ?? 'department'}, ${monthYear(lc.versions[0].createdAt)})` : ''}</option>
                {lc.versions.slice(1).map(v => <option key={v.snapshotId} value={v.snapshotId}>Capture: {v.instructorName ?? 'department'}, {monthYear(v.createdAt)}</option>)}
                {skillsOnly.map(w => <option key={w.id} value={`${WHAT_IF_PREFIX}${w.id}`}>What-if: {w.title} ({w.author}), skills only</option>)}
              </select>
            </label>
          )}
          <p className="cb-links">
            {lc.wiki && <a href={`/wiki/courses/${lc.wiki.slug}${q}`} target="_blank" rel="noreferrer">Wiki page</a>}
            <a href={`/capture/${encodeURIComponent(lc.code)}${q}`} target="_blank" rel="noreferrer">Capture</a>
          </p>
        </section>
      )}

      <section className="cb-sec" aria-label="Description">
        {pc ? <ProposedFields pc={pc} update={update} /> : lc!.description ? <p>{lc!.description}</p> : <p className="cb-muted">No description in the catalog.</p>}
      </section>

      <section className="cb-sec" aria-label="Objectives">
        <h3>Objectives</h3>
        <p className="cb-muted cb-small">Each is checked against this course&rsquo;s own developed skills. Edits and overrides stay on this cluster.</p>
        <ObjectivesEditor eff={eff} ops={ops} after={o => {
          const r = props.objectives.find(x => x.text === o.text);
          return r ? <ObjectiveStatus r={r} {...props} /> : null;
        }} />
      </section>

      <section className="cb-sec" aria-label="Required skills">
        <h3>Required skills</h3>
        <p className="cb-muted cb-small">What students need on arrival, checked against the developed skills of the courses upstream on this cluster. Your ratings are saved at once; edits stay on this cluster.</p>
        <ClusterRequiredList courseRef={courseRef} required={eff.required} results={props.required} codeOf={props.codeOf}
          decisions={props.decisions} decide={props.decide}
          errorOf={r => props.errorOf(r, 'required')} onRetry={r => props.onRetry(r, 'required')}
          onSave={ops.saveRequired} onRemove={ops.removeRequired} update={update} who={props.who} lockSlot={props.lockSlot} />
      </section>

      <section className="cb-sec" aria-label="Developed skills">
        <h3>Developed skills</h3>
        <p className="cb-muted cb-small">What this course supplies to the courses downstream and to the cluster objectives.</p>
        <DevelopedSkillsEditor eff={eff} ops={ops} courseRef={courseRef} threads={props.judging} />
      </section>

      <section className="cb-sec" aria-label="Prerequisites on this cluster">
        <h3>Prerequisites on this cluster</h3>
        {upstream.length === 0 ? <p className="cb-muted">No course on this cluster comes before this one.</p> : (
          <ul className="cb-deps">
            {upstream.map(u => (
              <li key={u.ref}><button type="button" className="cb-linkbtn" onClick={() => props.onSelect(u.ref)}>{u.code} {u.title}</button></li>
            ))}
          </ul>
        )}
      </section>

      {props.guide && (
        <section className="cb-sec" aria-label="How it is graded">
          <h3>How it is graded</h3>
          <p className="cb-muted cb-small">From the course&rsquo;s wiki page, for reference. It does not change any status here.</p>
          <ObjectiveGuidePanel section={props.guide} embedded />
        </section>
      )}

      <section className="cb-sec" aria-label="Changes">
        <h3>Changes on this cluster</h3>
        <ChangesList courseRef={courseRef} plan={cluster} ops={ops} update={update} label={props.codeOf} original={original} />
      </section>

      <section className="cb-sec cl-drawer__acts">
        <p className="cb-links">
          <button type="button" className="cb-btn" disabled={!!pc || saving} onClick={saveVersion}
            title={pc ? 'Only a tracked course can be saved as a version.' : 'Save this course as it reads on this cluster, as a version anyone can pick when they add it to a cluster.'}>
            {saving ? 'Saving…' : 'Save as a new version'}
          </button>
          <a className="cb-btn" href={`/api/build/clusters/${props.clusterId}/changes.md`} download
            title="Every change made on this cluster as a Markdown file. Save first so the file is current.">Download changes</a>
          <button type="button" className="cb-btn cb-btn--danger" onClick={() => props.onRemove(courseRef)}>Remove from cluster</button>
        </p>
        {saveMsg && <p className={saveMsg.ok ? 'cb-muted' : 'cb-error'} role={saveMsg.ok ? 'status' : 'alert'}>{saveMsg.text}</p>}
      </section>
    </Drawer>
  );
}

/** An objective's status, the skills it rests on, and its override (OverrideControl), kept with the cluster. */
function ObjectiveStatus(props: {
  r: StatusResult; codeOf: (ref: string) => string; update: Update<ClusterState>; who: () => string;
  errorOf: (r: StatusResult, kind: 'objective') => string | null; onRetry: (r: StatusResult, kind: 'objective') => void;
}) {
  const { r } = props;
  return (
    <div className="cl-objstatus">
      <StatusLine r={r} codeOf={props.codeOf} noun="objective" error={props.errorOf(r, 'objective')} onRetry={() => props.onRetry(r, 'objective')} />
      <OverrideControl r={r} update={props.update} who={props.who} />
      <SupplierLines r={r} codeOf={props.codeOf} />
    </div>
  );
}

/** Code and title (a new course only) and description of a course made on the cluster. */
function ProposedFields(props: { pc: ProposedCourse; update: Update<ClusterState> }) {
  const { pc } = props;
  const patch = (fn: (c: ProposedCourse) => ProposedCourse) =>
    props.update(s => ({ ...s, proposed: s.proposed.map(c => (c.id === pc.id ? fn(c) : c)) }));
  return (
    <div className="cb-form">
      {pc.source === 'new' && <label>Code <input value={pc.code} maxLength={40} onChange={e => patch(c => ({ ...c, code: e.target.value }))} /></label>}
      {pc.source === 'new' && <label>Title <input value={pc.title} maxLength={160} onChange={e => patch(c => ({ ...c, title: e.target.value }))} /></label>}
      <label>What the course is about
        <textarea rows={3} value={pc.description} maxLength={4000} onChange={e => patch(c => ({ ...c, description: e.target.value }))} />
      </label>
    </div>
  );
}
