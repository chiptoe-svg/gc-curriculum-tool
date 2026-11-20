'use client';

/** Small pieces of the skill tree panel: number format, node picker, hand-set depth form, structure tools. */
import { useState } from 'react';
import type { Tree, TreeNode } from '@/lib/skill-tree/types';

export type Send = (body: Record<string, unknown>) => Promise<boolean>;

export const fmt = (n: number | null): string => (n === null ? '–' : Number.isInteger(n) ? String(n) : n.toFixed(1));

const live = (n: TreeNode) => !n.retired && !n.mergedInto;

/** "Root › Child › Node" for a node, so same-named nodes can be told apart. */
export function pathLabel(tree: Tree, id: string): string {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    out.unshift(cur.name);
  }
  return out.join(' › ');
}

/** A search box over the tree's live nodes; picking one calls onPick. */
export function NodePicker({ tree, label, exclude, onPick }: { tree: Tree; label: string; exclude?: Set<string>; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const hits = tree.nodes
    .filter((n) => live(n) && !exclude?.has(n.id))
    .map((n) => ({ id: n.id, text: pathLabel(tree, n.id) }))
    .filter((h) => h.text.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  return (
    <div className="flex flex-col gap-1">
      <input aria-label={label} placeholder={label} value={q} onChange={(e) => setQ(e.target.value)} className="rounded border px-2 py-1 text-sm" />
      <ul className="flex flex-wrap gap-1">
        {hits.map((h) => (
          <li key={h.id}><button type="button" onClick={() => onPick(h.id)} className="rounded border px-2 py-0.5 text-xs">{h.text}</button></li>
        ))}
      </ul>
    </div>
  );
}

/** Name plus parent picker: creates a new node and places a skill under it (the caller sends both writes). */
export function NewParent({ tree, onCreate }: { tree: Tree; onCreate: (name: string, parentId: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="flex flex-col gap-1 rounded border p-2">
      <input aria-label="New skill name" placeholder="Name of the new parent skill" value={name} onChange={(e) => setName(e.target.value)} className="rounded border px-2 py-1 text-sm" />
      {name.trim() && <NodePicker tree={tree} label="Search for its parent" onPick={(id) => onCreate(name.trim(), id)} />}
    </div>
  );
}

/** "Add a parent skill under this": a name field that creates a new skill directly under the given node. */
export function AddSkillUnder({ node, send }: { node: TreeNode; send: Send }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  return (
    <div className="flex flex-col gap-1">
      <div><button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={() => setOpen(!open)}>Add a parent skill under this</button></div>
      {open && (
        <div className="flex flex-wrap gap-1">
          <input aria-label="Name of the new skill" placeholder="Name of the new skill" value={name} onChange={(e) => setName(e.target.value)} className="rounded border px-2 py-1 text-sm" />
          <button type="button" disabled={!name.trim()} className="rounded border px-2 py-0.5 text-xs"
            onClick={async () => { if (await send({ action: 'create', name: name.trim(), parentId: node.id })) { setName(''); setOpen(false); } }}>Add skill</button>
        </div>
      )}
    </div>
  );
}

/** One placed skill's tools: Move to…, and Confirm / Not here while it is only suggested. */
export function LeafTools({ tree, courseCode, skillRef, nodeId, proposed, send }: {
  tree: Tree; courseCode: string; skillRef: string; nodeId: string; proposed: boolean; send: Send;
}) {
  const [moving, setMoving] = useState(false);
  const b = 'rounded border px-2 py-0.5 text-xs';
  return (
    <span className="flex flex-wrap items-center gap-1">
      {proposed && <button type="button" className={b} onClick={() => void send({ action: 'confirm', courseCode, skillRef, nodeId })}>Confirm</button>}
      {proposed && <button type="button" className={b} onClick={() => void send({ action: 'reject', courseCode, skillRef, nodeId })}>Not here</button>}
      <button type="button" className={b} onClick={() => setMoving(!moving)}>Move to…</button>
      {moving && <NodePicker tree={tree} label="Move to" exclude={new Set([nodeId])} onPick={(to) => void send({ action: 'move', courseCode, skillRef, from: nodeId, to }).then((ok) => { if (ok) setMoving(false); })} />}
    </span>
  );
}

/** Three 0-5 selects (K and U hidden on foundational rows), plus Clear when a hand value exists. */
export function DepthForm({ initial, foundational, hasHand, send, onDone }: {
  initial: { k: number | null; u: number | null; d: number | null }; foundational: boolean; hasHand: boolean;
  send: (clear: boolean, v: { k: number | null; u: number | null; d: number | null }) => Promise<boolean>; onDone: () => void;
}) {
  const r = (n: number | null) => String(Math.round(n ?? 0));
  const [k, setK] = useState(r(initial.k)), [u, setU] = useState(r(initial.u)), [d, setD] = useState(r(initial.d));
  const sel = (label: string, v: string, set: (s: string) => void) => (
    <label className="text-xs">{label}{' '}
      <select aria-label={label} value={v} onChange={(e) => set(e.target.value)} className="rounded border">
        {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!foundational && sel('K', k, setK)}{!foundational && sel('U', u, setU)}{sel('D', d, setD)}
      <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={async () => { if (await send(false, { k: foundational ? null : +k, u: foundational ? null : +u, d: +d })) onDone(); }}>Save</button>
      {hasHand && <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={async () => { if (await send(true, initial)) onDone(); }}>Clear</button>}
    </div>
  );
}

/** Cluster-only structure tools for one node: rename, move, merge, split, weight. A master competency has none of them (the server refuses them, and its own weight never affects a reading). */
export function NodeTools({ tree, node, leaves, send }: {
  tree: Tree; node: TreeNode; leaves: Array<{ courseCode: string; skillRef: string; statement: string }>; send: Send;
}) {
  const [mode, setMode] = useState<null | 'rename' | 'move' | 'merge' | 'split'>(null);
  const [name, setName] = useState(node.name);
  const [weight, setWeight] = useState(String(node.weight));
  const [newName, setNewName] = useState('');
  const [pickedNodes, setPickedNodes] = useState<Set<string>>(new Set());
  const [pickedLeaves, setPickedLeaves] = useState<Set<string>>(new Set());
  const kids = tree.nodes.filter((n) => n.parentId === node.id && live(n));
  const isMaster = !!node.competencyId;
  const own = new Set([node.id]);
  const done = async (body: Record<string, unknown>) => { if (await send(body)) setMode(null); };
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set); if (!next.delete(key)) next.add(key); setter(next);
  };
  const btn = (m: NonNullable<typeof mode>, text: string) => (
    <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={() => setMode(mode === m ? null : m)}>{text}</button>
  );
  if (isMaster) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {btn('rename', 'Rename')}{btn('move', 'Move under…')}{btn('merge', 'Merge into…')}{btn('split', 'Split…')}
        <label className="text-xs">Weight{' '}
          <input aria-label={`Weight for ${node.name}`} type="number" step="0.1" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} className="w-16 rounded border px-1" />
        </label>
        <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={() => { const w = Number(weight); if (Number.isFinite(w)) void send({ action: 'weight', id: node.id, weight: w }); }}>Set weight</button>
      </div>
      {mode === 'rename' && (
        <div className="flex flex-wrap gap-1">
          <input aria-label="New name" value={name} onChange={(e) => setName(e.target.value)} className="rounded border px-2 py-1 text-sm" />
          <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={() => void done({ action: 'rename', id: node.id, name })}>Save name</button>
        </div>
      )}
      {mode === 'move' && <NodePicker tree={tree} label="Move under" exclude={own} onPick={(id) => void done({ action: 'reparent', id: node.id, parentId: id })} />}
      {mode === 'merge' && <NodePicker tree={tree} label="Merge into" exclude={own} onPick={(id) => void done({ action: 'merge', from: node.id, into: id })} />}
      {mode === 'split' && (
        <div className="flex flex-col gap-1 rounded border p-2 text-xs">
          <input aria-label="Name of the new skill" placeholder="Name of the new skill" value={newName} onChange={(e) => setNewName(e.target.value)} className="rounded border px-2 py-1 text-sm" />
          <p>Move these to it:</p>
          {kids.map((c) => <label key={c.id}><input type="checkbox" checked={pickedNodes.has(c.id)} onChange={() => toggle(pickedNodes, setPickedNodes, c.id)} /> {c.name}</label>)}
          {leaves.map((l) => { const key = `${l.courseCode}\u0000${l.skillRef}`; return <label key={key}><input type="checkbox" checked={pickedLeaves.has(key)} onChange={() => toggle(pickedLeaves, setPickedLeaves, key)} /> {l.courseCode} — {l.statement}</label>; })}
          <button type="button" disabled={!newName.trim()} className="self-start rounded border px-2 py-0.5" onClick={() => void done({
            action: 'split', id: node.id, newName: newName.trim(), moveNodes: [...pickedNodes],
            moveLeaves: leaves.filter((l) => pickedLeaves.has(`${l.courseCode}\u0000${l.skillRef}`)).map((l) => ({ courseCode: l.courseCode, skillRef: l.skillRef })),
          })}>Split</button>
        </div>
      )}
    </div>
  );
}
