'use client';

/**
 * A status override on a cluster (spec goal 9): Met / Partly / Not with an optional reason, kept with the cluster
 * (ClusterState.overrides), and Clear. Used for course objectives, required skills and cluster objectives alike; the
 * target key and text come from the StatusResult. Setting one replaces any override on this target and one left under
 * its former wording; the text hash is the one lib/builder/cluster/status.ts compares to show an override out of date.
 */
import { useState } from 'react';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { StatusResult } from '@/lib/builder/cluster/status';
import type { ClusterOverride, ClusterState } from '@/lib/builder/cluster/state';
import type { Update } from '../[id]/Builder';

const hash = (s: string) => textHash(normalizeStatement(s)); // as lib/builder/cluster/status.ts names a target's text
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const OVERRIDE_WORD: Record<ClusterOverride['label'], string> = { met: 'Met', partly: 'Partly', not: 'Not' };

export function OverrideControl(props: { r: StatusResult; update: Update<ClusterState>; who: () => string }) {
  const { r, update } = props;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  // Replace any override on this target, and one left under the target's former wording.
  const drop = (list: ClusterOverride[]) => list.filter(o => o.targetKey !== r.targetKey && o.targetKey !== r.override?.targetKey);
  const set = (label: ClusterOverride['label']) => {
    const o: ClusterOverride = {
      targetKey: r.targetKey, textHash: hash(r.text), label, by: props.who().slice(0, 120), at: new Date().toISOString(),
      reason: reason.trim() ? reason.trim().slice(0, 1000) : null,
    };
    update(s => ({ ...s, overrides: [...drop(s.overrides), o] }));
    setOpen(false); setReason('');
  };
  const inForce = r.override && !r.staleOverride ? r.override : null;
  return (
    <>
      {inForce && <span className="cb-muted cb-small"> Set by hand by {inForce.by}, {day(inForce.at)}{inForce.reason ? `: ${inForce.reason}` : ''}.</span>}{' '}
      {!open && <button type="button" className="cb-linkbtn" onClick={() => setOpen(true)}>Override</button>}
      {r.override && <>{' '}<button type="button" className="cb-linkbtn" onClick={() => update(s => ({ ...s, overrides: drop(s.overrides) }))}>Clear override</button></>}
      {open && (
        <span className="cl-override">
          <input value={reason} maxLength={1000} aria-label="Reason (optional)" placeholder="Why (optional)" onChange={e => setReason(e.target.value)} />
          {(['met', 'partly', 'not'] as const).map(l => (
            <button key={l} type="button" className="cb-iconbtn" onClick={() => set(l)}>{OVERRIDE_WORD[l]}</button>
          ))}
          <button type="button" className="cb-linkbtn" onClick={() => setOpen(false)}>Cancel</button>
        </span>
      )}
    </>
  );
}
