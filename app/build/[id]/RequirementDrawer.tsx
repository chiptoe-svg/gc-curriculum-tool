'use client';

import type { PlacedCourse } from '@/lib/builder/compute';
import { Drawer } from './controls';

/** A catalog-plan placeholder: what it stands for, its credits, and what the catalog says about it. */
export function RequirementDrawer(props: { placed: PlacedCourse; onRemove: (ref: string) => void; onClose: () => void }) {
  const r = props.placed.requirement!;
  return (
    <Drawer onClose={props.onClose} kicker={`From the catalog plan${r.credits != null ? `, ${r.credits} credits` : ''}`} title={r.label}>
      <section className="cb-sec">
        {r.genEd && <p>Counts toward the General Education category <b>{r.genEd}</b> as planned, until a course takes its place.</p>}
        {r.options.length > 0 && <p>Any one of: {r.options.join(', ')}.</p>}
        {!r.genEd && r.options.length === 0 && <p>A requirement the catalog plan leaves open. It counts toward credit hours only.</p>}
        <p className="cb-muted">A placeholder has no competency reading. To use a real course, drag it from the library into this term and remove the placeholder.</p>
      </section>
      {r.notes.length > 0 && (
        <section className="cb-sec">
          <h3>Catalog notes</h3>
          {r.notes.map((n, i) => <p key={i} className="cb-muted">{n}</p>)}
        </section>
      )}
      <section className="cb-sec">
        <button type="button" className="cb-btn cb-btn--danger" onClick={() => props.onRemove(props.placed.ref)}>Remove from the map</button>
      </section>
    </Drawer>
  );
}
