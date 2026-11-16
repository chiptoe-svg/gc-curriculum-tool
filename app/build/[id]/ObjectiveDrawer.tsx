'use client';

import { FLAG_TEXT, inProgram, requiredLevels, type ObjectiveResult, type PlanResult } from '@/lib/builder/compute';
import { ACTS, PLAN_SCOPE, type ActLevels, type Library, type PlanState } from '@/lib/builder/types';
import type { Update } from './Builder';
import type { Selection } from './Map';
import { DepthInputs, Drawer } from './controls';
import { BASIS_WORD, CHECKPOINT_WORD, STATUS_WORD, dimNote, dimName, dimsOf, importanceWord, stratumName, toneOfCheckpoint } from './ui';

const THREAD_WORD = {
  reinforced: 'Reinforced: more than one course works it near its peak, so it is likely to hold.',
  lone_peak: 'Lone peak: one course takes it to depth and nothing else works it near that level, so it is likely to fade.',
  light: 'Light: no course takes it past level 2.',
  none: 'No course in the plan works it.',
} as const;

/** Set one scope's levels for one competency, starting from what that scope requires today. */
export function setLevels(update: Update, library: Library, scope: string, competencyId: string, act: number, value: ActLevels[number]) {
  update(p => {
    const comp = library.competencies.find(c => c.id === competencyId)!;
    const current = requiredLevels(p, scope, comp);
    const next = current.map((l, i) => (i === act ? value : l)) as ActLevels;
    return { ...p, goal: { ...p.goal, levels: { ...p.goal.levels, [scope]: { ...(p.goal.levels[scope] ?? {}), [competencyId]: next } } } };
  });
}

export function ObjectiveDrawer(props: {
  objective: ObjectiveResult; library: Library; plan: PlanState; result: PlanResult; update: Update;
  onClose: () => void; onSelect: (s: Selection) => void;
}) {
  const { objective: o, library, plan, update } = props;
  const c = o.competency;
  const dims = dimsOf(c);
  const scopes = [...o.targetIds.map(id => ({ id, name: library.targets.find(t => t.id === id)?.name ?? id })),
    ...(plan.goal.added.includes(c.id) || inProgram(plan, c.id) ? [{ id: PLAN_SCOPE, name: 'Program' }] : [])];
  const neighbors = c.neighbors.map(id => library.competencies.find(x => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  const weightIn = (scope: string) => library.targets.find(t => t.id === scope)?.members.find(m => m.competencyId === c.id)?.weight ?? null;

  return (
    <Drawer onClose={props.onClose} kicker={`${stratumName(c.stratum)} competency${c.foundational ? ', judged on Do only' : ''}`} title={c.name}>
      <section className="cb-sec">
        <p className={`cb-status cb-status--${toneOfCheckpoint(o.checkpoints[2]!.status === 'none' ? (o.status === 'met' ? 'met' : 'none') : o.checkpoints[2]!.status)}`}>{STATUS_WORD[o.status]}</p>
        <dl className="cb-descr">
          {c.know && <><dt>Know</dt><dd>{c.know}</dd></>}
          {c.understand && <><dt>Understand</dt><dd>{c.understand}</dd></>}
          <dt>Do</dt><dd>{c.do}</dd>
        </dl>
      </section>

      <section className="cb-sec">
        <h3>Level reached at each checkpoint</h3>
        <table className="cb-table cb-table--center">
          <thead><tr><th /><th>End of Act 1</th><th>End of Act 2</th><th>End of Act 3</th></tr></thead>
          <tbody>
            {dims.map(dim => (
              <tr key={dim}>
                <th scope="row">{dimName(dim)}</th>
                {[0, 1, 2].map(i => { const n = dimNote(o, i, dim); return <td key={i} className={`cb-mono cb-t-${n.tone}`} title={n.title}>{n.text.slice(1)}</td>; })}
              </tr>
            ))}
            <tr>
              <th scope="row">Checkpoint</th>
              {o.checkpoints.map((cp, i) => <td key={i} className={`cb-t-${toneOfCheckpoint(cp.status)}`}>{CHECKPOINT_WORD[cp.status]}</td>)}
            </tr>
          </tbody>
        </table>
        <p className="cb-muted">A plain number is the level reached. Two numbers are reached over target. A ▾ means the level was reached earlier and, with nothing reinforcing it, is estimated to have slipped below the target.</p>
      </section>

      <section className="cb-sec">
        <h3>Targets</h3>
        {scopes.length === 0 && <p className="cb-muted">No career path in this plan lists this competency.</p>}
        {scopes.map(s => {
          const levels = requiredLevels(plan, s.id, c);
          const custom = !!plan.goal.levels[s.id]?.[c.id];
          return (
            <div key={s.id} className="cb-scope">
              <p><b>{s.name}</b>{s.id !== PLAN_SCOPE && <span className="cb-muted">, {importanceWord(weightIn(s.id)).toLowerCase()}</span>}</p>
              <div className="cb-scope__acts">
                {ACTS.map((a, i) => (
                  <label key={a.act}>End of Act {a.act}
                    <DepthInputs label={`${s.name}, end of Act ${a.act}`} foundational={c.foundational} value={levels[i]!}
                      onChange={v => setLevels(update, library, s.id, c.id, i, v)} />
                  </label>
                ))}
              </div>
              <p className="cb-muted">
                {custom ? 'Set in this plan. ' : 'Starting values, not yet reviewed. '}
                {custom && <button type="button" className="cb-linkbtn" onClick={() => update(p => {
                  const scoped = { ...(p.goal.levels[s.id] ?? {}) };
                  delete scoped[c.id];
                  return { ...p, goal: { ...p.goal, levels: { ...p.goal.levels, [s.id]: scoped } } };
                })}>Back to starting values</button>}
              </p>
            </div>
          );
        })}
        {scopes.length > 1 && <p className="cb-muted">The map draws the strictest of these; each career path is scored against its own.</p>}
      </section>

      <section className="cb-sec">
        <h3>Courses that build it, in teaching order</h3>
        {o.contributions.length === 0 ? <p className="cb-muted">None yet. Add a course that works this competency, or give a new course a level for it.</p> : (
          <ol className="cb-steps">
            {o.contributions.map(x => (
              <li key={x.ref}>
                <button type="button" className="cb-linkbtn" onClick={() => props.onSelect({ kind: 'course', ref: x.ref })}>{x.code}</button>
                <span className="cb-mono"> {dims.map(d => `${d.toUpperCase()}${x[d] ?? '·'}`).join(' ')}</span>
                <span className="cb-muted">, Act {x.act}, {BASIS_WORD[x.basis].toLowerCase()}, {x.raised.length ? `raises ${x.raised.map(dimName).join(' and ')}` : 'reinforces'}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="cb-muted">{THREAD_WORD[o.thread]}</p>
      </section>

      {o.flags.length > 0 && (
        <section className="cb-sec cb-alerts">
          <h3>Worth a look</h3>
          {o.flags.map(f => <p key={f}><b>{FLAG_TEXT[f].label}.</b> {FLAG_TEXT[f].detail}</p>)}
        </section>
      )}

      <section className="cb-sec">
        <h3>Related competencies</h3>
        {neighbors.length === 0 ? <p className="cb-muted">None close enough to count as related.</p> : (
          <>
            <p>
              {neighbors.map(n => props.result.objectives.some(x => x.competency.id === n.id)
                ? <button key={n.id} type="button" className="cb-chip" onClick={() => props.onSelect({ kind: 'objective', id: n.id })}>{n.name}</button>
                : <span key={n.id} className="cb-chip cb-chip--off" title="Not one of this plan's objectives">{n.name}</span>)}
            </p>
            <p className="cb-muted">
              Shown for reference. They are the nearest competencies by description, which is a shortlist and not a finding that one builds the other, so they do not affect the map.
            </p>
          </>
        )}
      </section>

      {o.targetIds.length > 0 && (
        <section className="cb-sec">
          <button type="button" className="cb-btn cb-btn--danger" onClick={() => { update(p => ({ ...p, goal: { ...p.goal, removed: [...p.goal.removed, c.id] } })); props.onClose(); }}>
            Leave this competency out of the plan
          </button>
        </section>
      )}
    </Drawer>
  );
}
