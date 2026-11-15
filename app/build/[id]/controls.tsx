'use client';

import type { Depth } from '@/lib/builder/types';

const WORDS = ['not present', 'exposure', 'recognize / explain / with reference', 'recall / predict / independent', 'correct terms / novel cases / adapts', 'fluent / critiques / guides others'];

/** One depth level, 0–5, or blank. A compact select so a row of nine fits in a table. */
export function LevelInput(props: { value: number | null; onChange: (v: number | null) => void; label: string; blank?: string; disabled?: boolean }) {
  return (
    <select
      className={`cb-level${props.value == null ? ' is-blank' : ''}`} aria-label={props.label} title={props.label} disabled={props.disabled}
      value={props.value == null ? '' : String(props.value)}
      onChange={e => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{props.blank ?? '–'}</option>
      {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n} title={WORDS[n]}>{n}</option>)}
    </select>
  );
}

/** K / U / D inputs for one depth; foundational competencies take Do only. */
export function DepthInputs(props: { value: Depth | null; onChange: (d: Depth) => void; foundational: boolean; label: string }) {
  const v = props.value ?? { k: null, u: null, d: null };
  return (
    <span className="cb-kud">
      {!props.foundational && <LevelInput label={`${props.label}, Know`} value={v.k} onChange={k => props.onChange({ ...v, k })} />}
      {!props.foundational && <LevelInput label={`${props.label}, Understand`} value={v.u} onChange={u => props.onChange({ ...v, u })} />}
      <LevelInput label={`${props.label}, Do`} value={v.d} onChange={d => props.onChange({ ...v, d })} />
    </span>
  );
}

export function Drawer(props: { title: React.ReactNode; kicker?: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className={`cb-drawer${props.wide ? ' cb-drawer--wide' : ''}`} aria-label={typeof props.title === 'string' ? props.title : undefined}>
      <header className="cb-drawer__head">
        <div>
          {props.kicker && <p className="cb-drawer__kicker">{props.kicker}</p>}
          <h2>{props.title}</h2>
        </div>
        <button type="button" className="cb-linkbtn" onClick={props.onClose}>Close</button>
      </header>
      <div className="cb-drawer__body">{props.children}</div>
    </aside>
  );
}
