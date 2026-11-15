'use client';

import { CONDITIONS, type ProblemSolvingResult } from '@/lib/builder/problem-solving';
import type { Act } from '@/lib/builder/types';
import type { Selection } from './Map';
import { Drawer } from './controls';

const BAND_WORD = { significant: 'Significant evidence', moderate: 'Moderate evidence', slight: 'Slight evidence', none: 'No evidence of the conditions', no_data: 'No conditions recorded' } as const;

/** Problem solving by the end of one act: the conditions across the courses so far, and the competencies at integration depth. */
export function ProblemSolvingDrawer(props: { act: Act; ps: ProblemSolvingResult; onClose: () => void; onSelect: (s: Selection) => void }) {
  const { act, ps } = props;
  const list = (codes: string[]) => codes.length ? codes.join(', ') : '–';
  return (
    <Drawer wide onClose={props.onClose} kicker={`By the end of Act ${act}`} title="Problem solving">
      <section className="cb-sec">
        <p className="cb-muted">
          Problem solving is read for the program, not scored per course: it forms where courses set up the conditions below
          and students work competencies at integration depth. This counts every course placed up to the end of Act {act},
          using the conditions each course&rsquo;s capture recorded. Courses with no capture, or captured before the conditions were recorded, cannot be counted.
        </p>
      </section>
      <section className="cb-sec">
        <h3>The conditions, across the courses so far</h3>
        <table className="cb-table">
          <thead><tr><th>Condition</th><th>Present in</th><th>Partly in</th></tr></thead>
          <tbody>
            {CONDITIONS.map(c => (
              <tr key={c.key}><td>{c.name}</td><td>{list(ps.conditions[c.key].present)}</td><td className="cb-muted">{list(ps.conditions[c.key].partial)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="cb-sec">
        <h3>Courses by evidence</h3>
        {(['significant', 'moderate', 'slight', 'none', 'no_data'] as const).map(b => ps.bands[b].length > 0 && (
          <p key={b}><b>{BAND_WORD[b]}</b> ({ps.bands[b].length}): {ps.bands[b].join(', ')}</p>
        ))}
      </section>
      <section className="cb-sec">
        <h3>Competencies at integration depth ({ps.integration.length})</h3>
        <p className="cb-muted">Understand or Do at level 4 or higher by the end of Act {act}: where students reason through new cases or adapt to new conditions.</p>
        {ps.integration.length === 0 ? <p className="cb-muted">None yet.</p> : (
          <p>{ps.integration.map(c => <button key={c.id} type="button" className="cb-chip" onClick={() => props.onSelect({ kind: 'objective', id: c.id })}>{c.name}</button>)}</p>
        )}
      </section>
    </Drawer>
  );
}
