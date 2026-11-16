'use client';

import { FLAG_TEXT, type ObjectiveFlag, type PlanResult } from '@/lib/builder/compute';
import type { GenEdRow } from '@/lib/builder/degree';
import type { Selection } from './Map';
import { Drawer } from './controls';

const FLAG_ORDER: ObjectiveFlag[] = [
  'brittle', 'no_introduction', 'top_heavy', 'lone_peak', 'mention_only',
  'jargon', 'theory_without_craft', 'craft_without_articulation', 'soft_evidence',
];

/** Everything the plan should be looked at for: order and dependency problems first, then how each objective is built. */
export function ChecksPanel(props: { result: PlanResult; genEd: { year: string; rows: GenEdRow[] }; onClose: () => void; onSelect: (s: Selection) => void }) {
  const { result } = props;
  const order = result.checks.filter(c => c.kind !== 'no_reading');
  const silent = result.checks.filter(c => c.kind === 'no_reading');
  const untouched = result.objectives.filter(o => o.status === 'untouched');
  const short = result.objectives.filter(o => o.status === 'short' || o.status === 'late');
  const objectiveList = (list: typeof result.objectives) => (
    <p>{list.map(o => <button key={o.competency.id} type="button" className="cb-chip" onClick={() => props.onSelect({ kind: 'objective', id: o.competency.id })}>{o.competency.name}</button>)}</p>
  );
  const nothing = order.length + silent.length + untouched.length + short.length === 0 && result.objectives.every(o => o.flags.length === 0);

  return (
    <Drawer title="Checks" kicker="What to look at in this plan" onClose={props.onClose}>
      {nothing && <section className="cb-sec"><p>{result.objectives.length === 0 ? 'Choose a career path under Targets and the checks will appear here.' : 'Nothing to flag: every target is reached and the order holds.'}</p></section>}

      <section className="cb-sec">
        <h3>General Education ({props.genEd.year.replace('-', '–')} catalog)</h3>
        <p className="cb-muted">Credits from courses on the map that the catalog lists for each category (shared courses only; each course counts once), and placeholders standing for it. Rules the catalog states in words are shown, not checked.</p>
        <table className="cb-table cb-table--gened">
          <tbody>
            {props.genEd.rows.map(r => {
              const got = r.courses.reduce((s, c) => s + c.credits, 0);
              const planned = r.planned.reduce((s, c) => s + c.credits, 0);
              return (
                <tr key={r.name}>
                  <td><b>{r.name}</b>{r.need != null && <span className="cb-muted"> {r.need} cr</span>}
                    {r.rules && <div className="cb-muted cb-small">{r.rules}</div>}</td>
                  <td>
                    {r.courses.length > 0 && <div>{r.courses.map(c => `${c.code} (${c.credits})`).join(', ')}</div>}
                    {r.planned.length > 0 && <div className="cb-muted">Planned: {r.planned.map(p => `${p.label} (${p.credits})`).join(', ')}</div>}
                    {r.courses.length + r.planned.length === 0 && <span className="cb-muted">Nothing on the map yet</span>}
                  </td>
                  <td className={`cb-t-${r.status === 'met' ? 'reached' : r.status === 'planned' ? 'amber' : 'short'}`}>
                    {r.status === 'met' ? 'Met' : r.status === 'planned' ? `Met once placeholders are filled (${got} + ${planned})` : `Short: ${got + planned} of ${r.need}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {order.length > 0 && (
        <section className="cb-sec cb-alerts">
          <h3>Order and dependencies</h3>
          {order.map((c, i) => (
            <p key={i}><button type="button" className="cb-linkbtn" onClick={() => props.onSelect({ kind: 'course', ref: c.ref })}>{c.code}</button> {c.detail.charAt(0).toLowerCase() + c.detail.slice(1)}</p>
          ))}
        </section>
      )}

      {untouched.length > 0 && <section className="cb-sec"><h3>No course works these</h3>{objectiveList(untouched)}</section>}
      {short.length > 0 && <section className="cb-sec"><h3>Short of a target</h3>{objectiveList(short)}</section>}

      {FLAG_ORDER.map(flag => {
        const list = result.objectives.filter(o => o.flags.includes(flag));
        if (list.length === 0) return null;
        return (
          <section key={flag} className="cb-sec">
            <h3>{FLAG_TEXT[flag].label}</h3>
            <p className="cb-muted">{FLAG_TEXT[flag].detail}</p>
            {objectiveList(list)}
          </section>
        );
      })}

      {silent.length > 0 && (
        <section className="cb-sec">
          <h3>Courses that add nothing yet</h3>
          {silent.map((c, i) => (
            <p key={i}><button type="button" className="cb-linkbtn" onClick={() => props.onSelect({ kind: 'course', ref: c.ref })}>{c.code}</button> {c.detail}</p>
          ))}
        </section>
      )}
    </Drawer>
  );
}
