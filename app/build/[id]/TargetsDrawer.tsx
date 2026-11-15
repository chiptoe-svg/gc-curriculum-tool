'use client';

import { useState } from 'react';
import { requiredLevels, type PlanResult } from '@/lib/builder/compute';
import { ACTS, PLAN_SCOPE, type Act, type Library, type PlanState } from '@/lib/builder/types';
import type { Update } from './Builder';
import { DepthInputs, Drawer } from './controls';
import { setLevels } from './ObjectiveDrawer';
import { importanceWord, newId, stratumName, stratumRank } from './ui';

/** Career paths, the K/U/D level each competency should reach by the end of each act, written objectives, and branches. */
export function TargetsDrawer(props: { library: Library; plan: PlanState; result: PlanResult; update: Update; onClose: () => void }) {
  const { library, plan, result, update } = props;
  const selected = library.targets.filter(t => plan.goal.targetIds.includes(t.id));
  const program = plan.goal.program;
  const [scope, setScope] = useState<string>(program ? PLAN_SCOPE : selected[0]?.id ?? PLAN_SCOPE);
  const active = scope === PLAN_SCOPE || plan.goal.targetIds.includes(scope) ? scope : selected[0]?.id ?? PLAN_SCOPE;
  const comp = new Map(library.competencies.map(c => [c.id, c]));
  const removed = new Set(plan.goal.removed);
  const target = library.targets.find(t => t.id === active);
  const programOn = (id: string) => !!program && !program.off.includes(id);
  const setProgram = (next: { off: string[] } | undefined) => update(p => {
    const goal = { ...p.goal };
    if (next) goal.program = next; else delete goal.program;
    return { ...p, goal };
  });
  const toggleInProgram = (id: string) => program && setProgram({ off: program.off.includes(id) ? program.off.filter(x => x !== id) : [...program.off, id] });
  const rows = (active === PLAN_SCOPE
    ? (program
      ? library.competencies.map(c => ({ competencyId: c.id, weight: null as number | null }))
      : plan.goal.added.map(id => ({ competencyId: id, weight: null as number | null })))
    : (target?.members ?? []).filter(m => !removed.has(m.competencyId)))
    .filter(m => comp.has(m.competencyId))
    .map(m => ({ c: comp.get(m.competencyId)!, weight: m.weight }))
    .sort((a, b) => stratumRank(a.c.stratum) - stratumRank(b.c.stratum) || (b.weight ?? 0) - (a.weight ?? 0) || a.c.name.localeCompare(b.c.name));
  const inPlan = new Set(result.objectives.map(o => o.competency.id));
  const addable = library.competencies.filter(c => !inPlan.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  const droppedHere = (target?.members ?? []).filter(m => removed.has(m.competencyId) && comp.has(m.competencyId));
  const writtenResult = new Map(result.written.map(w => [w.id, w]));
  const toggleTarget = (id: string) => update(p => ({
    ...p, goal: { ...p.goal, targetIds: p.goal.targetIds.includes(id) ? p.goal.targetIds.filter(x => x !== id) : [...p.goal.targetIds, id] },
  }));

  return (
    <Drawer wide onClose={props.onClose} kicker="What this curriculum should achieve" title="Targets">
      <section className="cb-sec">
        <h3>Program targets</h3>
        <label className="cb-check cb-check--block">
          <input type="checkbox" checked={!!program} onChange={e => { setProgram(e.target.checked ? { off: [] } : undefined); if (e.target.checked) setScope(PLAN_SCOPE); }} />
          Judge the curriculum against the program&rsquo;s own targets for Acts 1, 2 and 3, whatever career path is chosen
        </label>
        <p className="cb-muted">
          {program
            ? `${library.competencies.length - program.off.length} of ${library.competencies.length} competencies are covered. Turn each on or off, and set its levels, in the Program tab below; or click an act's heading on the map to set every competency's target for that act. Where a chosen career path also sets a target, the stricter one counts.`
            : 'Off: only the competencies of the chosen career paths, and any added by hand, are judged.'}
        </p>
      </section>

      <section className="cb-sec">
        <h3>Career paths</h3>
        <ul className="cb-paths">
          {library.targets.map(t => (
            <li key={t.id}>
              <label>
                <input type="checkbox" checked={plan.goal.targetIds.includes(t.id)} onChange={() => { toggleTarget(t.id); if (!plan.goal.targetIds.includes(t.id)) setScope(t.id); }} />
                <span><b>{t.name}</b> <span className="cb-muted">{t.members.length} competencies. {t.shortDefinition}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="cb-sec">
        <h3>Level to reach by the end of each act</h3>
        <p className="cb-muted">
          Know, Understand and Do, each 0 to 5. Leave a level blank, or at 0, to ask for nothing at that checkpoint. Values you have not touched are
          starting values: about K2 U1 D1 after Act 1 and 3 across after Acts 2 and 3, the same for every competency. How important a competency is to a
          career path does not say how deep it has to go, and no employer-required depths exist in the tool yet, so the levels are yours to set.
        </p>
        <div className="cb-tabs" role="tablist">
          {selected.map(t => <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => setScope(t.id)}>{t.name}</button>)}
          <button type="button" role="tab" aria-selected={active === PLAN_SCOPE} onClick={() => setScope(PLAN_SCOPE)}>{program ? 'Program' : 'Added to this plan'}</button>
        </div>
        {rows.length === 0 ? (
          <p className="cb-muted">{active === PLAN_SCOPE ? 'No competencies added by hand. Use the list below to add one that no chosen career path includes, or switch on program targets above.' : 'Choose a career path above.'}</p>
        ) : (
          <table className="cb-table cb-table--levels">
            <thead>
              <tr><th>Competency</th>{ACTS.map(a => <th key={a.act}>End of Act {a.act}<br /><span className="cb-muted">K / U / D</span></th>)}<th /></tr>
            </thead>
            <tbody>
              {rows.map(({ c, weight }, i) => {
                const levels = requiredLevels(plan, active, c);
                const custom = !!plan.goal.levels[active]?.[c.id];
                const head = i === 0 || rows[i - 1]!.c.stratum !== c.stratum;
                const programRow = active === PLAN_SCOPE && !!program;
                const off = programRow && !programOn(c.id) && !plan.goal.added.includes(c.id);
                return [
                  head && <tr key={`g-${c.stratum}`} className="cb-table__group"><th colSpan={5}>{stratumName(c.stratum)}</th></tr>,
                  <tr key={c.id} className={off ? 'is-off' : undefined}>
                    <td title={c.do}>
                      {programRow && (
                        <input type="checkbox" className="cb-rowcheck" checked={!off} aria-label={`Cover ${c.name} with program targets`}
                          onChange={() => (plan.goal.added.includes(c.id)
                            ? update(p => ({ ...p, goal: { ...p.goal, added: p.goal.added.filter(x => x !== c.id), program: p.goal.program && { off: [...p.goal.program.off.filter(x => x !== c.id), c.id] } } }))
                            : toggleInProgram(c.id))} />
                      )}
                      {c.name}{active !== PLAN_SCOPE && <span className="cb-muted cb-small"> {importanceWord(weight)}</span>}{!custom && !off && <span className="cb-small cb-muted"> (starting values)</span>}
                    </td>
                    {ACTS.map(a => (
                      <td key={a.act}>{off ? <span className="cb-muted cb-small">off</span> : (
                        <DepthInputs label={`${c.name}, end of Act ${a.act}`} foundational={c.foundational} value={levels[a.act - 1]!}
                          onChange={v => setLevels(update, library, active, c.id, a.act - 1, v)} />
                      )}</td>
                    ))}
                    <td>
                      {!programRow && <button type="button" className="cb-linkbtn" onClick={() => update(p => ({
                        ...p, goal: active === PLAN_SCOPE
                          ? { ...p.goal, added: p.goal.added.filter(x => x !== c.id) }
                          : { ...p.goal, removed: [...p.goal.removed, c.id] },
                      }))}>Drop</button>}
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        )}
        {droppedHere.length > 0 && (
          <p className="cb-muted">Dropped from every path in this plan: {droppedHere.map(m => (
            <button key={m.competencyId} type="button" className="cb-chip" title="Put it back" onClick={() => update(p => ({ ...p, goal: { ...p.goal, removed: p.goal.removed.filter(x => x !== m.competencyId) } }))}>
              {comp.get(m.competencyId)!.name} ↺
            </button>
          ))}</p>
        )}
        <label className="cb-inline">Add a competency no chosen path includes
          <select value="" onChange={e => { const id = e.target.value; if (id) { update(p => ({ ...p, goal: { ...p.goal, added: [...p.goal.added, id], removed: p.goal.removed.filter(x => x !== id) } })); setScope(PLAN_SCOPE); } }}>
            <option value="">Choose…</option>
            {addable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </section>

      <section className="cb-sec">
        <h3>Written objectives</h3>
        <p className="cb-muted">A sentence for a checkpoint, tied to the competencies that would show it. It reads as reached when every tied competency reaches its level at that checkpoint.</p>
        <ul className="cb-written">
          {plan.goal.written.map(w => {
            const r = writtenResult.get(w.id);
            const patch = (fn: (x: typeof w) => typeof w) => update(p => ({ ...p, goal: { ...p.goal, written: p.goal.written.map(x => (x.id === w.id ? fn(x) : x)) } }));
            return (
              <li key={w.id}>
                <div className="cb-written__row">
                  <select value={w.act} aria-label="Checkpoint" onChange={e => patch(x => ({ ...x, act: Number(e.target.value) as Act }))}>
                    {ACTS.map(a => <option key={a.act} value={a.act}>End of Act {a.act}</option>)}
                  </select>
                  <select value={w.targetId ?? ''} aria-label="Career path" onChange={e => patch(x => ({ ...x, targetId: e.target.value || null }))}>
                    <option value="">Whole program</option>
                    {selected.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <span className={`cb-written__state cb-t-${r?.status === 'met' ? 'reached' : r?.status === 'short' ? 'short' : 'untouched'}`}>
                    {!r || r.status === 'unlinked' ? 'Not tied to a competency, so it cannot be checked' : r.status === 'met' ? 'Reached' : `${r.met} of ${r.of} tied competencies reached`}
                  </span>
                  <button type="button" className="cb-linkbtn" onClick={() => update(p => ({ ...p, goal: { ...p.goal, written: p.goal.written.filter(x => x.id !== w.id) } }))}>Delete</button>
                </div>
                <textarea rows={2} value={w.text} maxLength={500} placeholder="By the end of this act, a student can…" onChange={e => patch(x => ({ ...x, text: e.target.value }))} />
                <div className="cb-written__links">
                  {w.competencyIds.map(id => comp.get(id) && (
                    <button key={id} type="button" className="cb-chip" title="Untie" onClick={() => patch(x => ({ ...x, competencyIds: x.competencyIds.filter(y => y !== id) }))}>{comp.get(id)!.name} ×</button>
                  ))}
                  <select value="" aria-label="Tie to a competency" onChange={e => { const id = e.target.value; if (id) patch(x => ({ ...x, competencyIds: [...x.competencyIds, id] })); }}>
                    <option value="">Tie to a competency…</option>
                    {result.objectives.filter(o => !w.competencyIds.includes(o.competency.id)).map(o => <option key={o.competency.id} value={o.competency.id}>{o.competency.name}</option>)}
                  </select>
                </div>
              </li>
            );
          })}
        </ul>
        <button type="button" className="cb-btn" onClick={() => update(p => ({ ...p, goal: { ...p.goal, written: [...p.goal.written, { id: newId('w'), act: 2, targetId: null, text: '', competencyIds: [] }] } }))}>
          Add a written objective
        </button>
      </section>

      <section className="cb-sec">
        <h3>Branches</h3>
        <p className="cb-muted">A branch is a set of courses only some students take, such as a track. Courses on a branch count toward the career paths you tie it to; everything else is shared by everyone.</p>
        <ul className="cb-branches">
          {plan.branches.map((b, i) => {
            const patch = (fn: (x: typeof b) => typeof b) => update(p => ({ ...p, branches: p.branches.map(x => (x.id === b.id ? fn(x) : x)) }));
            return (
              <li key={b.id} style={{ ['--lane' as string]: `var(--cb-branch-${i % 4})` }}>
                <input value={b.name} maxLength={60} placeholder="Branch name" aria-label="Branch name" onChange={e => patch(x => ({ ...x, name: e.target.value }))} />
                <span className="cb-branches__paths">
                  {selected.map(t => (
                    <label key={t.id}><input type="checkbox" checked={b.targetIds.includes(t.id)}
                      onChange={() => patch(x => ({ ...x, targetIds: x.targetIds.includes(t.id) ? x.targetIds.filter(y => y !== t.id) : [...x.targetIds, t.id] }))} /> {t.name}</label>
                  ))}
                  {selected.length === 0 && <span className="cb-muted">Choose a career path to tie this branch to.</span>}
                </span>
                <button type="button" className="cb-linkbtn" title="Its courses move back to the shared trunk"
                  onClick={() => update(p => ({ ...p, branches: p.branches.filter(x => x.id !== b.id), placements: p.placements.map(x => (x.branch === b.id ? { ...x, branch: null } : x)) }))}>Delete</button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="cb-btn" disabled={plan.branches.length >= 12}
          onClick={() => update(p => ({ ...p, branches: [...p.branches, { id: newId('b'), name: '', targetIds: [] }] }))}>Add a branch</button>
      </section>
    </Drawer>
  );
}
