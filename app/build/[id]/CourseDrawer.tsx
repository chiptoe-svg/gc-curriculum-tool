'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WHAT_IF_PREFIX, versionOf, whatIfOf, type PlacedCourse, type PlanResult } from '@/lib/builder/compute';
import { type CompetencyDepth, type Library, type PlanState, type ProposedCourse } from '@/lib/builder/types';
import { effectiveCourse, type EffectiveCourse } from '@/lib/builder/edits';
import type { Threads, Update } from './Builder';
import { RequiredSkillsList } from './RequiredSkillsList';
import { ChangesList, DevelopedSkillsEditor, ObjectivesEditor, ToConfirm, courseEditOps, type EditOps } from './CourseEditors';
import type { Selection } from './Map';
import { DepthInputs, Drawer, LevelInput } from './controls';
import { BASIS_WORD, STRATA, fmtDepth, stratumRank } from './ui';

export function CourseDrawer(props: {
  courseRef: string; library: Library; plan: PlanState; result: PlanResult; allCourses: PlacedCourse[]; slug: string;
  update: Update; onRemove: (ref: string) => void; onClose: () => void; onSelect: (s: Selection) => void;
  threads: Threads;
  /** Open at a section (the card bar opens the required skills); `n` changes on every request. */
  focus: { section: 'required'; n: number } | null;
}) {
  const { courseRef, library, plan, result, update } = props;
  const placed = props.allCourses.find(c => c.ref === courseRef);
  const lc = library.courses.find(c => c.code === courseRef);
  const pc = plan.proposed.find(c => c.id === courseRef);
  const [linkKind, setLinkKind] = useState<'prereq' | 'coreq'>('prereq');
  const requiredRef = useRef<HTMLElement>(null);
  const focusN = props.focus?.n;
  useEffect(() => {
    if (focusN == null || !requiredRef.current) return;
    if (requiredRef.current instanceof HTMLDetailsElement) requiredRef.current.open = true;
    requiredRef.current.scrollIntoView({ block: 'start' });
  }, [focusN]);
  if (!placed || (!lc && !pc)) return null;

  const version = lc ? versionOf(lc, plan) : null;
  const eff = effectiveCourse((lc ?? pc)!, version, plan.courseEdits?.[courseRef]);
  const ops = courseEditOps(courseRef, update, props.threads.stamp);
  const source = plan.courseEdits?.[courseRef]?.source;
  const conditionMissing = new Set((plan.courseEdits?.[courseRef]?.developed ?? []).filter(e => e.conditionMissing && e.statement).map(e => e.statement!));
  const reqResults = props.threads.byCourse[courseRef]?.results ?? [];
  const counts = props.threads.byCourse[courseRef]?.counts;
  const original = {
    required: new Map((version?.required ?? []).map(r => [r.ref, r.statement])),
    developed: new Map((version?.skills ?? []).map(s => [s.skillRef, s.statement])),
  };

  const q = `?slug=${encodeURIComponent(props.slug)}`;
  const objectiveIds = new Set(result.objectives.map(o => o.competency.id));
  const setPlacement = (patch: { branch?: string | null }) =>
    update(p => ({ ...p, placements: p.placements.map(x => (x.ref === courseRef ? { ...x, ...patch } : x)) }));
  const checks = result.checks.filter(c => c.ref === courseRef);
  const incoming = result.edges.filter(e => e.to === courseRef);
  const label = (ref: string) => props.allCourses.find(c => c.ref === ref)?.code ?? ref;
  const candidates = props.allCourses.filter(c => c.ref !== courseRef && !incoming.some(e => e.from === c.ref));

  return (
    <Drawer onClose={props.onClose} kicker={pc ? (pc.source === 'catalog' ? 'From the Clemson catalog, not captured' : 'New course in this plan') : `${lc!.code}${lc!.credits ? `, ${lc!.credits} credits` : ''}`}
      title={pc ? pc.title || 'Untitled course' : lc!.title}>
      {plan.branches.length > 0 && (
        <section className="cb-sec cb-sec--row">
          <label>Who takes it
            <select value={placed.branch ?? ''} onChange={e => setPlacement({ branch: e.target.value || null })}>
              <option value="">Everyone</option>
              {plan.branches.map(b => <option key={b.id} value={b.id}>{b.name || 'Unnamed branch'} only</option>)}
            </select>
          </label>
        </section>
      )}

      {source && (
        <section className="cb-sec">
          <p className="cb-syl">Drafted from syllabus: <b>{source.fileName}</b>, {new Date(source.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
            {' '}Its drafted items are goals read from the syllabus, not evidence; each stays a draft (<span className="cb-draft">italic</span>) until a capture confirms it.</p>
        </section>
      )}

      {checks.length > 0 && (
        <section className="cb-sec cb-alerts">
          {checks.map((c, i) => <p key={i}>{c.detail}</p>)}
        </section>
      )}

      <details className="cb-sec" open ref={requiredRef as React.Ref<HTMLDetailsElement>} id="cb-required">
        <summary>Required skills{counts ? ` (${counts.met} of ${reqResults.length} met)` : ''}</summary>
        <p className="cb-muted cb-small">What students need on arrival, and the skill from an earlier course on this map that supplies it. Your decisions are saved for every map; edits here stay on this map.</p>
        <RequiredSkillsList courseRef={courseRef} threads={props.threads} onSave={ops.saveRequired} onRemove={ops.removeRequired} />
      </details>

      {lc && <TrackedCourse {...props} lc={lc} objectiveIds={objectiveIds} q={q} eff={eff} ops={ops} />}
      {pc && <ProposedEditor pc={pc} library={library} objectiveIds={objectiveIds} update={update} />}

      <details className="cb-sec">
        <summary>Developed skills on this map ({eff.developed.length})</summary>
        <p className="cb-muted cb-small">The skills this course supplies to later courses. Changes here count toward later courses&rsquo; required skills on this map only.</p>
        <DevelopedSkillsEditor eff={eff} ops={ops} courseRef={courseRef} threads={props.threads} conditionMissing={conditionMissing} />
      </details>

      <section className="cb-sec">
        <h3>Comes after</h3>
        {incoming.length === 0 && <p className="cb-muted">Nothing has to come before this course.</p>}
        <ul className="cb-deps">
          {incoming.map(e => {
            const inPlan = props.allCourses.some(c => c.ref === e.from);
            return (
              <li key={e.from}>
                <button type="button" className="cb-linkbtn" disabled={!inPlan} onClick={() => props.onSelect({ kind: 'course', ref: e.from })}>{label(e.from)}</button>
                <span className="cb-muted">{e.source === 'catalog' ? (e.kind === 'concurrent_ok' ? 'catalog prerequisite, may be taken together' : 'catalog prerequisite') : e.kind === 'concurrent_ok' ? 'corequisite added in this plan' : 'prerequisite added in this plan'}{!inPlan && ', not on the map'}</span>
                <button type="button" className="cb-linkbtn" onClick={() => update(p => e.source === 'plan'
                  ? { ...p, links: p.links.filter(l => !(l.from === e.from && l.to === courseRef)) }
                  : { ...p, unlinked: [...p.unlinked, { from: e.from, to: courseRef }] })}>
                  {e.source === 'plan' ? 'Remove' : 'Set aside in this plan'}
                </button>
              </li>
            );
          })}
        </ul>
        {plan.unlinked.filter(l => l.to === courseRef).map(l => (
          <p key={l.from} className="cb-muted">
            Catalog prerequisite {l.from} is set aside in this plan.{' '}
            <button type="button" className="cb-linkbtn" onClick={() => update(p => ({ ...p, unlinked: p.unlinked.filter(x => !(x.from === l.from && x.to === courseRef)) }))}>Restore</button>
          </p>
        ))}
        {candidates.length > 0 && (
          <div className="cb-edit__row">
            <select value={linkKind} aria-label="Kind" onChange={e => setLinkKind(e.target.value as 'prereq' | 'coreq')}>
              <option value="prereq">Prerequisite</option>
              <option value="coreq">Corequisite (same term allowed)</option>
            </select>
            <select value="" aria-label="Add a course this one depends on" onChange={e => {
              const from = e.target.value;
              if (from) update(p => ({ ...p, links: [...p.links, linkKind === 'coreq' ? { from, to: courseRef, kind: 'coreq' as const } : { from, to: courseRef }] }));
            }}>
              <option value="">Add a course this one depends on…</option>
              {candidates.map(c => <option key={c.ref} value={c.ref}>{c.code} {c.title}</option>)}
            </select>
          </div>
        )}
      </section>

      <section className="cb-sec">
        <h3>Changes on this map</h3>
        <ChangesList courseRef={courseRef} plan={plan} ops={ops} update={update} label={label} original={original} />
      </section>

      <section className="cb-sec">
        <h3>To confirm through capture</h3>
        <ToConfirm eff={eff} results={reqResults} />
      </section>

      <section className="cb-sec">
        <button type="button" className="cb-btn cb-btn--danger" onClick={() => props.onRemove(courseRef)}>
          {pc?.source === 'new' ? 'Delete this course' : 'Take off the map'}
        </button>
      </section>
    </Drawer>
  );
}

const maxN = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a == null ? b ?? null : b == null ? a : Math.max(a, b);

function TrackedCourse(props: {
  lc: Library['courses'][number]; library: Library; plan: PlanState; result: PlanResult; allCourses: PlacedCourse[];
  courseRef: string; update: Update; objectiveIds: Set<string>; q: string; eff: EffectiveCourse; ops: EditOps;
}) {
  const { lc, library, plan, update } = props;
  const placed = props.allCourses.find(c => c.ref === props.courseRef)!;
  const version = versionOf(lc, plan);
  const whatIf = whatIfOf(lc, plan);
  const discovered = new Map((version?.depths ?? []).map(d => [d.competencyId, d]));
  const stated = new Map(lc.stated.map(d => [d.competencyId, d]));
  const whatIfDepths = new Map((whatIf?.depths ?? []).map(d => [d.competencyId, d]));
  const comp = new Map(library.competencies.map(c => [c.id, c]));
  const ids = [...new Set([...discovered.keys(), ...stated.keys(), ...whatIfDepths.keys()])]
    .filter(id => comp.has(id))
    .sort((a, b) => Number(props.objectiveIds.has(b)) - Number(props.objectiveIds.has(a)) || comp.get(a)!.name.localeCompare(comp.get(b)!.name));
  const apart = (a?: CompetencyDepth, b?: CompetencyDepth) =>
    !!a && !!b && (['k', 'u', 'd'] as const).some(dim => a[dim] != null && b[dim] != null && Math.abs(a[dim]! - b[dim]!) >= 2);
  const inUse = placed.reading.basis;
  const router = useRouter();
  const linkedView = !!version?.linked && !whatIf && inUse === 'discovered';
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ k: number | null; u: number | null; d: number | null }>({ k: null, u: null, d: null });
  // A decision on a link or a roll-up: saved at once (it belongs to the capture, not to this plan), then the map reloads.
  const decide = async (body: Record<string, unknown>) => {
    if (!version) return;
    setBusy(true); setLinkError(null);
    let authorName = '';
    try { authorName = localStorage.getItem('cb-author') ?? ''; } catch { /* private window */ }
    try {
      const res = await fetch('/api/build/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, snapshotId: version.snapshotId, authorName }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? 'The change was not saved.');
      router.refresh();
    } catch (e) { setLinkError(e instanceof Error ? e.message : 'The change was not saved.'); }
    finally { setBusy(false); }
  };
  const projects = version?.projects.length ? version.projects : lc.sheetProjects.map(t => ({ title: t, description: '', deliverables: [] as string[] }));
  const above0 = (x?: { k: number | null; u: number | null; d: number | null }) => !!x && (['k', 'u', 'd'] as const).some(dim => (x[dim] ?? 0) > 0);
  // The reading the map uses: the what-if when one is chosen, otherwise discovered or stated as the course's reading says.
  const inUseMap = whatIf ? whatIfDepths : inUse === 'stated' ? stated : discovered;
  const works = ids.filter(id => above0(inUseMap.get(id)));
  const compareRows = ids.filter(id => above0(stated.get(id)) || above0(discovered.get(id)));
  // What students bring: the deepest level reached by courses in earlier terms, on the shared trunk or this course's branch.
  const earlier = props.allCourses.filter(c => c.term < placed.term && !c.requirement && (c.branch === null || c.branch === placed.branch));
  // Each earlier course's skills grouped under the competency (or, where a course has no linked skills, its level alone).
  const incoming = (id: string) => {
    const from: string[] = [];
    const skills: Array<{ code: string; statement: string | null; k: number | null; u: number | null; d: number | null }> = [];
    let k: number | null = null, u: number | null = null, d: number | null = null;
    for (const c of earlier) {
      const r = c.reading.depths.find(x => x.competencyId === id);
      if (!r || !above0(r)) continue;
      from.push(c.code);
      k = maxN(k, r.k); u = maxN(u, r.u); d = maxN(d, r.d);
      const linked = (r.links ?? []).filter(l => above0(l));
      if (linked.length) for (const l of linked) skills.push({ code: c.code, statement: l.statement, k: l.k, u: l.u, d: l.d });
      else skills.push({ code: c.code, statement: r.source ?? null, k: r.k, u: r.u, d: r.d });
    }
    const depth: CompetencyDepth | null = from.length ? { competencyId: id, k, u, d } : null;
    return { depth, from, skills };
  };
  const differ = ids.filter(id => apart(stated.get(id), discovered.get(id))).length;
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  return (
    <>
      <section className="cb-sec">
        {lc.description && <p>{lc.description}</p>}
        {lc.wiki?.summary && <p className="cb-muted">From the wiki: {lc.wiki.summary}</p>}
        <p className="cb-links">
          {lc.wiki && <a href={`/wiki/courses/${lc.wiki.slug}${props.q}`} target="_blank" rel="noreferrer">Wiki page</a>}
          {lc.versions.length > 0 && <a href={`/view/${encodeURIComponent(lc.code)}`} target="_blank" rel="noreferrer">Captured profile</a>}
          <a href={`/explore/${encodeURIComponent(lc.code)}${props.q}`} target="_blank" rel="noreferrer">What-ifs</a>
        </p>
      </section>

      {(lc.versions.length > 1 || lc.whatIfs.length > 0) && (
        <section className="cb-sec">
          <label className="cb-inline">Version on the map
            <select value={plan.versions[lc.code] ?? ''} onChange={e => update(p => {
              const versions = { ...p.versions };
              if (e.target.value) versions[lc.code] = e.target.value; else delete versions[lc.code];
              return { ...p, versions };
            })}>
              <option value="">Newest capture{lc.versions[0] ? ` (${lc.versions[0].instructorName ?? 'department'}, ${date(lc.versions[0].createdAt)})` : ''}</option>
              {lc.versions.slice(1).map(v => <option key={v.snapshotId} value={v.snapshotId}>Capture: {v.instructorName ?? 'department'}, {date(v.createdAt)}</option>)}
              {lc.whatIfs.map(w => <option key={w.id} value={`${WHAT_IF_PREFIX}${w.id}`}>What-if: {w.title} ({w.author})</option>)}
            </select>
          </label>
          {whatIf && (
            <p className="cb-muted">
              This is a prediction of a changed course, so the map counts it as proposed whichever input is chosen.
              {whatIf.notComputed.length > 0 && ` ${whatIf.notComputed.length} changed rating${whatIf.notComputed.length > 1 ? 's' : ''} could not be tied to a competency and ${whatIf.notComputed.length > 1 ? 'are' : 'is'} left out.`}
            </p>
          )}
        </section>
      )}

      <details className="cb-sec">
        <summary>Stated learning objectives ({props.eff.objectives.length})</summary>
        <p className="cb-muted cb-small">From the course sheet, with this map&rsquo;s changes. Changes stay on this map.</p>
        <ObjectivesEditor eff={props.eff} ops={props.ops} />
      </details>

      <details className="cb-sec">
        <summary>Discovered outcomes ({version?.outcomes.length ?? 0})</summary>
        {version && version.outcomes.length > 0
          ? <ul className="cb-list">{version.outcomes.map((o, i) => <li key={i}>{o.statement} <span className="cb-mono cb-muted">{fmtDepth(o, o.k == null && o.u == null)}</span></li>)}</ul>
          : <p className="cb-muted">{lc.versions.length === 0 ? 'Not captured yet, so there are no discovered outcomes.' : 'The capture records no outcome statements.'}</p>}
      </details>

      <details className="cb-sec">
        <summary>Incoming skills &amp; competencies ({works.length})</summary>
        <p className="cb-muted">For each competency this course works, the level students already hold from courses in earlier terms on this plan (shared courses, and this course&rsquo;s branch), and the skills from those courses that count toward it. &ldquo;First met here&rdquo; means no earlier course works it.</p>
        {works.length === 0 && <p className="cb-muted">This course works no competency above level 0 under the reading in use.</p>}
        {works.map(id => {
          const c = comp.get(id)!;
          const inc = incoming(id);
          return (
            <div key={id} className="cb-cgroup">
              <div className="cb-cgroup__head">
                <b>{c.name}</b>
                {inc.depth ? <span className="cb-mono">{fmtDepth(inc.depth, c.foundational)}</span> : <span className="cb-small cb-muted">first met here</span>}
              </div>
              {inc.skills.length > 0 && (
                <ul className="cb-skills">
                  {inc.skills.map((sk, i) => (
                    <li key={i} className="cb-link cb-link--stack">
                      <span className="cb-link__text">{sk.statement ? <>{sk.statement} </> : null}<span className="cb-mono">{fmtDepth(sk, c.foundational)}</span> <span className="cb-muted">({sk.code})</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </details>

      <details className="cb-sec">
        <summary>Developed skills &amp; competencies ({linkedView ? `${version!.skills.length} skills, ${works.length} competencies` : works.length})</summary>
        <p className="cb-muted">
          {linkedView
            ? 'Every skill the course capture recorded, as captured, grouped under the competency it counts toward. A competency\'s level is its highest grouped skill unless someone set it; "after it" is where students stand once this course is added to what they bring. A skill can sit in more than one group; ✓ confirms a grouping, ✗ removes it. The skills themselves never change.'
            : inUse ? `This course's levels from its ${BASIS_WORD[inUse].toLowerCase()} reading${placed.reading.filled ? ' (it has none under the chosen input)' : ''}, and where students stand after it.` : 'It has no reading under the chosen input, so it adds nothing to the map.'}
        </p>
        {works.length === 0 && !linkedView && <p className="cb-muted">No competency levels above 0 have been read for this course.</p>}
        {works.map(id => {
          const c = comp.get(id)!;
          const used = inUseMap.get(id)!;
          const inc = incoming(id).depth;
          const after = { k: maxN(inc?.k, used.k), u: maxN(inc?.u, used.u), d: maxN(inc?.d, used.d) };
          const raises = (['k', 'u', 'd'] as const).filter(dm => used[dm] != null && (inc?.[dm] == null || used[dm]! > inc[dm]!) && !(c.foundational && dm !== 'd'));
          return (
            <div key={id} className={`cb-cgroup${props.objectiveIds.has(id) ? ' is-objective' : ''}`}>
              <div className="cb-cgroup__head">
                <b>{c.name}</b>
                <span className="cb-mono">{fmtDepth(used, c.foundational)}</span>
                <span className="cb-small cb-muted">
                  {linkedView ? (used.method === 'faculty' ? 'set by hand' : used.method === 'ai' ? 'AI judgment' : 'highest skill') + (used.soft ? ', proposed' : '') : ''}
                  {' '}after it <span className="cb-mono">{fmtDepth(after, c.foundational)}</span>{raises.length > 0 && <span className="cb-t-reached"> raises {raises.map(r => r.toUpperCase()).join(', ')}</span>}
                </span>
              </div>
              {!linkedView && used.source && inUse === 'discovered' && !whatIf && <div className="cb-source">from: {used.source}</div>}
              {linkedView && (
                <ul className="cb-skills">
                  {(used.links ?? []).map(l => (
                    <li key={l.skillRef} className={`cb-link cb-link--${l.status}`}>
                      <span className="cb-link__text">{l.statement} <span className="cb-mono">{fmtDepth(l, l.k == null && l.u == null)}</span></span>
                      <span className="cb-link__meta">{l.status === 'confirmed' ? 'confirmed' : `proposed by ${l.source === 'scoring' ? 'the old scoring' : l.source === 'embedding' ? `similarity ${l.similarity?.toFixed(2) ?? ''}` : l.source}`}</span>
                      <button type="button" className="cb-iconbtn" title="Confirm this grouping" disabled={busy || l.status === 'confirmed'} onClick={() => decide({ action: 'confirm', competencyId: id, skillRef: l.skillRef })}>✓</button>
                      <button type="button" className="cb-iconbtn" title="Remove the skill from this group (the skill stays)" disabled={busy} onClick={() => decide({ action: 'reject', competencyId: id, skillRef: l.skillRef })}>✗</button>
                    </li>
                  ))}
                </ul>
              )}
              {linkedView && (editing === id ? (
                <div className="cb-rollup">
                  {!c.foundational && <LevelInput label="Know" value={draft.k} onChange={k => setDraft({ ...draft, k })} />}
                  {!c.foundational && <LevelInput label="Understand" value={draft.u} onChange={u => setDraft({ ...draft, u })} />}
                  <LevelInput label="Do" value={draft.d} onChange={d => setDraft({ ...draft, d })} />
                  <button type="button" className="cb-linkbtn" disabled={busy} onClick={() => { decide({ action: 'rollup', competencyId: id, ...draft }); setEditing(null); }}>Save</button>
                  <button type="button" className="cb-linkbtn" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className="cb-small">
                  <button type="button" className="cb-linkbtn" onClick={() => { setEditing(id); setDraft({ k: used.k, u: used.u, d: used.d }); }}>Set the competency level</button>
                  {used.method !== 'max' && <> · <button type="button" className="cb-linkbtn" disabled={busy} onClick={() => decide({ action: 'rollup-clear', competencyId: id })}>Use the highest skill</button></>}
                </div>
              ))}
            </div>
          );
        })}
        {linkedView && version!.unmapped.length > 0 && (
          <div className="cb-cgroup cb-cgroup--none">
            <div className="cb-cgroup__head"><b>Not grouped under a competency yet ({version!.unmapped.length})</b></div>
            <p className="cb-muted cb-small">These count toward nothing on the map until grouped.</p>
            <ul className="cb-skills">
              {version!.unmapped.map(sk => (
                <li key={sk.skillRef} className="cb-link cb-link--stack">
                  <span className="cb-link__text">{sk.statement} <span className="cb-mono">{fmtDepth(sk, sk.k == null && sk.u == null)}</span></span>
                  <select className="cb-linkto" value="" disabled={busy} aria-label={`Group "${sk.statement}" under a competency`}
                    onChange={e => { if (e.target.value) decide({ action: 'add', competencyId: e.target.value, skillRef: sk.skillRef }); }}>
                    <option value="">Group under…</option>
                    {[...library.competencies].sort((a, b) => a.name.localeCompare(b.name)).map(cc => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
        {linkedView && version!.suggestions.length > 0 && (
          <div className="cb-cgroup cb-cgroup--suggest">
            <div className="cb-cgroup__head"><b>Suggested groupings ({version!.suggestions.length})</b></div>
            <p className="cb-muted cb-small">Close matches by wording (embedding similarity). Wording similarity cannot tell the same skill from a related one on the same topic, so these count for nothing until someone confirms them.</p>
            <ul className="cb-skills">
              {version!.suggestions.map(sg => (
                <li key={`${sg.skillRef}|${sg.competencyId}`} className="cb-link cb-link--proposed">
                  <span className="cb-link__text">{sg.statement} <span className="cb-muted">→ {comp.get(sg.competencyId)?.name ?? sg.competencyId}</span></span>
                  <span className="cb-link__meta">similarity {sg.similarity?.toFixed(2) ?? ''}</span>
                  <button type="button" className="cb-iconbtn" title="Accept: group this skill under that competency" disabled={busy} onClick={() => decide({ action: 'confirm', competencyId: sg.competencyId, skillRef: sg.skillRef })}>✓</button>
                  <button type="button" className="cb-iconbtn" title="Dismiss this suggestion" disabled={busy} onClick={() => decide({ action: 'reject', competencyId: sg.competencyId, skillRef: sg.skillRef })}>✗</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {linkError && <p className="cb-error" role="alert">{linkError}</p>}
        {version && version.depths.length === 0 && !linkedView && (
          <p className="cb-muted">This course is captured, but the capture has not been scored against the competency catalog yet, so its discovered outcomes cannot be stacked. Refreshing the Program page scores it.</p>
        )}
      </details>

      <details className="cb-sec">
        <summary>Major projects ({projects.length})</summary>
        {projects.length === 0 ? <p className="cb-muted">No major projects recorded for this course.</p> : (
          <ul className="cb-list">
            {projects.map((pr, i) => (
              <li key={i}><b>{pr.title}</b>{pr.description && <> {pr.description}</>}
                {pr.deliverables.length > 0 && <span className="cb-muted"> Hands in: {pr.deliverables.join('; ')}.</span>}</li>
            ))}
          </ul>
        )}
        {projects.length > 0 && <p className="cb-muted">{version?.projects.length ? 'From the captured profile.' : 'From the course sheet.'}</p>}
      </details>

      <details className="cb-sec">
        <summary>Objectives vs. outcomes{differ + (version?.disagreements.length ?? 0) > 0 ? ` (${differ + (version?.disagreements.length ?? 0)})` : ''}</summary>
        {lc.stated.length === 0 || discovered.size === 0 ? (
          <p className="cb-muted">{lc.stated.length === 0 ? 'No stated-objective reading: the syllabus pass has not been run for this course.' : 'Not captured, or the capture is not scored yet, so there is nothing to compare.'}</p>
        ) : (
          <>
            <p className="cb-muted">What the syllabus says the course teaches beside what the capture found students do. A dagger marks levels two or more apart.</p>
            <table className="cb-table">
              <thead><tr><th>Competency</th><th>Stated</th><th>Discovered</th>{whatIf && <th>What-if</th>}</tr></thead>
              <tbody>
                {compareRows.map(id => {
                  const c = comp.get(id)!;
                  const st = stated.get(id), d = discovered.get(id), w = whatIfDepths.get(id);
                  return (
                    <tr key={id} className={props.objectiveIds.has(id) ? 'is-objective' : ''}>
                      <td>{c.name}{apart(st, d) && <sup> †</sup>}</td>
                      <td className="cb-mono">{st ? fmtDepth(st, c.foundational) : '–'}</td>
                      <td className="cb-mono">{d ? fmtDepth(d, c.foundational) : '–'}</td>
                      {whatIf && <td className="cb-mono">{w ? fmtDepth(w, c.foundational) : '–'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        {version && version.disagreements.length > 0 && (
          <>
            <h4>Where the capture found objectives and evidence disagree</h4>
            <ul className="cb-list">{version.disagreements.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </>
        )}
      </details>
    </>
  );
}

function ProposedEditor(props: { pc: ProposedCourse; library: Library; objectiveIds: Set<string>; update: Update }) {
  const { pc, library, update } = props;
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patch = (fn: (c: ProposedCourse) => ProposedCourse) => update(p => ({ ...p, proposed: p.proposed.map(c => (c.id === pc.id ? fn(c) : c)) }));
  const comp = new Map(library.competencies.map(c => [c.id, c]));
  const have = new Set(pc.depths.map(d => d.competencyId));
  const addable = library.competencies.filter(c => !have.has(c.id))
    .sort((a, b) => Number(props.objectiveIds.has(b.id)) - Number(props.objectiveIds.has(a.id)) || stratumRank(a.stratum) - stratumRank(b.stratum) || a.name.localeCompare(b.name));
  const add = (id: string) => patch(c => (c.depths.some(d => d.competencyId === id) ? c : { ...c, depths: [...c.depths, { competencyId: id, k: null, u: null, d: null }] }));

  async function suggest() {
    setSuggesting(true); setError(null);
    try {
      const res = await fetch('/api/build/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: [pc.title, pc.description, ...pc.objectives].join('\n') }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'No suggestions came back.');
      setSuggested((body.suggestions as Array<{ competencyId: string }>).map(s => s.competencyId).filter(id => comp.has(id)));
    } catch (e) { setError(e instanceof Error ? e.message : 'No suggestions came back.'); }
    finally { setSuggesting(false); }
  }

  return (
    <>
      <section className="cb-sec cb-form">
        <label>Code <input value={pc.code} maxLength={40} disabled={pc.source === 'catalog'} onChange={e => patch(c => ({ ...c, code: e.target.value }))} /></label>
        <label>Title <input value={pc.title} maxLength={160} disabled={pc.source === 'catalog'} onChange={e => patch(c => ({ ...c, title: e.target.value }))} /></label>
        <label>What the course is about
          <textarea rows={4} value={pc.description} maxLength={4000} onChange={e => patch(c => ({ ...c, description: e.target.value }))} />
        </label>
        <label>Learning objectives, one per line
          <textarea rows={4} value={pc.objectives.join('\n')} onChange={e => patch(c => ({ ...c, objectives: e.target.value.split('\n').map(s => s.slice(0, 500)).slice(0, 40) }))}
            placeholder="Students will be able to…" />
        </label>
      </section>

      <section className="cb-sec">
        <h3>Competency levels this course would reach</h3>
        <p className="cb-muted">These are what the course intends, so the map counts them as proposed and draws them dotted. Levels run 0 to 5; leave one blank if the course does not address it.</p>
        {pc.depths.length > 0 && (
          <table className="cb-table">
            <thead><tr><th>Competency</th><th>K / U / D</th><th /></tr></thead>
            <tbody>
              {pc.depths.map(d => {
                const c = comp.get(d.competencyId);
                if (!c) return null;
                return (
                  <tr key={d.competencyId} className={props.objectiveIds.has(c.id) ? 'is-objective' : ''}>
                    <td title={c.do}>{c.name}</td>
                    <td><DepthInputs label={c.name} foundational={c.foundational} value={d}
                      onChange={v => patch(x => ({ ...x, depths: x.depths.map(y => (y.competencyId === c.id ? { ...y, ...v } : y)) }))} /></td>
                    <td><button type="button" className="cb-linkbtn" onClick={() => patch(x => ({ ...x, depths: x.depths.filter(y => y.competencyId !== c.id) }))}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <label className="cb-inline">Add a competency
          <select value="" onChange={e => { if (e.target.value) add(e.target.value); }}>
            <option value="">Choose…</option>
            {props.objectiveIds.size > 0 && <optgroup label="This plan's objectives">{addable.filter(c => props.objectiveIds.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
            {STRATA.map(s => {
              const group = addable.filter(c => !props.objectiveIds.has(c.id) && (c.stratum ?? '') === s.key);
              return group.length ? <optgroup key={s.key} label={s.name}>{group.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup> : null;
            })}
          </select>
        </label>
        <p>
          <button type="button" className="cb-btn" onClick={suggest} disabled={suggesting}>{suggesting ? 'Looking…' : 'Suggest competencies from the description'}</button>
        </p>
        {error && <p className="cb-error" role="alert">{error}</p>}
        {suggested && (
          <div className="cb-suggest">
            <p className="cb-muted">Closest competencies to what you wrote. Add the ones that fit, then set their levels yourself.</p>
            {suggested.filter(id => !have.has(id)).map(id => <button key={id} type="button" className="cb-chip" onClick={() => add(id)}>{comp.get(id)!.name}</button>)}
            {suggested.every(id => have.has(id)) && <p className="cb-muted">All of the suggestions are already in the table.</p>}
          </div>
        )}
      </section>
    </>
  );
}
