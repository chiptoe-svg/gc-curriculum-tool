'use client';

import { requiredLevels, scopesOf, type PlanResult } from '@/lib/builder/compute';
import { ACTS, PLAN_SCOPE, type Act, type Library, type PlanState } from '@/lib/builder/types';
import type { Update } from './Builder';
import type { Selection } from './Map';
import { DepthInputs, Drawer } from './controls';
import { setLevels } from './ObjectiveDrawer';
import { CHECKPOINT_WORD, dimsOf, stratumName, stratumRank, toneOfCheckpoint } from './ui';

/**
 * One act's targets in one table: for every competency the program covers, the program's target at the end of
 * this act (editable) beside the level the placed courses reach by then. Career paths keep their own targets;
 * the status column is judged against the stricter of the program's and the chosen paths' (as on the map).
 */
export function ActTargetsDrawer(props: {
  act: Act; library: Library; plan: PlanState; result: PlanResult; update: Update;
  onClose: () => void; onSelect: (s: Selection) => void; onOpenTargets: () => void;
}) {
  const { act, library, plan, result, update } = props;
  const info = ACTS[act - 1]!;
  const m = result.milestones[act - 1]!;
  const rows = result.objectives
    .filter(o => scopesOf(plan, o.competency.id, o.targetIds).includes(PLAN_SCOPE))
    .sort((a, b) => stratumRank(a.competency.stratum) - stratumRank(b.competency.stratum) || a.competency.name.localeCompare(b.competency.name));
  const fmt = (v: number | null) => (v == null ? '·' : Number.isInteger(v) ? String(v) : v.toFixed(1));

  return (
    <Drawer wide onClose={props.onClose} kicker={`Act ${act}: ${info.name}`} title={`Targets at the end of Act ${act}`}>
      <section className="cb-sec">
        <p>{m.required === 0 ? 'Nothing is required at this checkpoint yet.' : <><b>{m.met}</b> of {m.required} targets reached at the end of Act {act}{m.fading > 0 ? `, ${m.fading} more reached earlier and fading` : ''}.</>}</p>
        {!plan.goal.program && (
          <p className="cb-muted">Program targets are off, so only competencies added by hand are listed. <button type="button" className="cb-linkbtn" onClick={props.onOpenTargets}>Switch them on in Targets</button>.</p>
        )}
        <p className="cb-muted">
          Target: the program&rsquo;s level for the end of this act (blank or 0 asks for nothing). Reached: the deepest level a course placed up to here
          reaches; a second number is what is estimated to be held after fade. A chosen career path may ask for more; the stricter target decides the status.
        </p>
      </section>
      <section className="cb-sec">
        {rows.length === 0 ? <p className="cb-muted">No competency is covered by program targets.</p> : (
          <table className="cb-table cb-table--levels">
            <thead>
              <tr><th>Competency</th><th>Target<br /><span className="cb-muted">K / U / D</span></th><th>Reached</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((o, i) => {
                const c = o.competency;
                const head = i === 0 || rows[i - 1]!.competency.stratum !== c.stratum;
                const target = requiredLevels(plan, PLAN_SCOPE, c)[act - 1] ?? null;
                const at = o.byAct[act - 1]!;
                const held = o.heldByAct[act - 1]!;
                const cp = o.checkpoints[act - 1]!;
                const dims = dimsOf(c);
                return [
                  head && <tr key={`g-${c.stratum}`} className="cb-table__group"><th colSpan={4}>{stratumName(c.stratum)}</th></tr>,
                  <tr key={c.id}>
                    <td><button type="button" className="cb-linkbtn" onClick={() => props.onSelect({ kind: 'objective', id: c.id })}>{c.name}</button></td>
                    <td><DepthInputs label={`${c.name}, end of Act ${act}`} foundational={c.foundational} value={target}
                      onChange={v => setLevels(update, library, PLAN_SCOPE, c.id, act - 1, v)} /></td>
                    <td className="cb-mono">
                      {dims.map(d => {
                        const slipped = held[d] != null && at[d] != null && held[d]! < at[d]! - 0.05;
                        return <span key={d} title={slipped ? `Reached ${fmt(at[d])}, estimated ${fmt(held[d])} held after fade` : undefined}>{d.toUpperCase()}{fmt(at[d])}{slipped ? `→${fmt(held[d])}` : ''} </span>;
                      })}
                    </td>
                    <td className={`cb-t-${toneOfCheckpoint(cp.status)}`}>{CHECKPOINT_WORD[cp.status]}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        )}
      </section>
    </Drawer>
  );
}
