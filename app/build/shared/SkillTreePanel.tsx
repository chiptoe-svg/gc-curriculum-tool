'use client';

/**
 * The department skill tree, in two places: at the end of capture review (place this course's skills under parent skills)
 * and on the cluster map (the same tree for the cluster's courses, with structure tools). No optimistic writes: after each
 * POST the panel redraws from the tree the API returns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { counts, readCourse, readProgram, resolveNode } from '@/lib/skill-tree/read';
import type { NodeReading, Tree, TreeNode, VersionSkills } from '@/lib/skill-tree/types';
import { AddSkillUnder, DepthForm, LeafTools, NewParent, NodePicker, NodeTools, fmt, pathLabel } from './skillTreeParts';

interface Version {
  instructor: string; snapshotId: string | null;
  skills: Array<{ skillRef: string; statement: string; k: number | null; u: number | null; d: number | null }>;
  gone: Array<{ skillRef: string; statement: string; suggestion: { skillRef: string; statement: string } | null }>;
}
interface Suggestion { nodeId: string; similarity: number }

const NAME_KEY = 'cb-author';
const btn = 'rounded border px-2 py-0.5 text-xs';

export function SkillTreePanel(props: { courseCode: string | null; mode: 'capture' | 'cluster'; courseCodes?: string[]; authorName?: string | null }) {
  const { mode } = props;
  const codes = useMemo(() => (mode === 'capture' ? (props.courseCode ? [props.courseCode] : []) : props.courseCodes ?? []), [mode, props.courseCode, props.courseCodes]);
  const codesKey = codes.join('|');
  const [tree, setTree] = useState<Tree | null>(null);
  const [byCourse, setByCourse] = useState<Record<string, Version[]>>({});
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [vIdx, setVIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [handFor, setHandFor] = useState<string | null>(null);
  const created = useRef<Record<string, string>>({});
  const [placing, setPlacing] = useState<{ ref: string; how: 'else' | 'new' } | null>(null);
  const author = (props.authorName ?? typed).trim();

  useEffect(() => {
    if (props.authorName) return;
    try { setTyped(localStorage.getItem(NAME_KEY) ?? ''); } catch { /* private window */ }
  }, [props.authorName]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!codes.length) {
          const r = await fetch('/api/skill-tree');
          const b = await r.json();
          if (!r.ok) throw new Error(b.error ?? 'The skill tree could not be loaded.');
          if (live) setTree(b.tree);
          return;
        }
        const results = await Promise.all(codes.map(async (c) => {
          const r = await fetch(`/api/skill-tree?course=${encodeURIComponent(c)}`);
          const b = await r.json();
          if (!r.ok) throw new Error(b.error ?? 'The skill tree could not be loaded.');
          return [c, b] as const;
        }));
        if (!live) return;
        setTree(results[0]![1].tree);
        setByCourse(Object.fromEntries(results.map(([c, b]) => [c, b.versions ?? []])));
        setSuggestions(Object.assign({}, ...results.map(([, b]) => b.suggestions ?? {})));
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'The skill tree could not be loaded.');
      }
    })();
    return () => { live = false; };
  }, [codesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = useCallback(async (body: Record<string, unknown>): Promise<Tree | null> => {
    setError(null);
    try {
      const r = await fetch('/api/skill-tree', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, authorName: author }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setError(b.error ?? 'That change could not be saved.'); return null; }
      setTree(b.tree);
      if (!props.authorName && author) try { localStorage.setItem(NAME_KEY, author); } catch { /* private window */ }
      return b.tree as Tree;
    } catch {
      setError('That change could not be saved.');
      return null;
    }
  }, [author, props.authorName]);
  const send = async (body: Record<string, unknown>): Promise<boolean> => (await post(body)) !== null;

  const nameField = !props.authorName && (
    <label className="text-xs">Your name <input aria-label="Your name" value={typed} onChange={(e) => setTyped(e.target.value)} className="rounded border px-2 py-1" /></label>
  );
  const errorBox = error && <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!tree) return <div>{errorBox ?? <p className="text-sm">Loading the skill tree…</p>}</div>;

  const course = mode === 'capture' ? codes[0] ?? null : null;
  const versions = course ? byCourse[course] ?? [] : [];
  const version = versions[Math.min(vIdx, Math.max(0, versions.length - 1))];
  const toVS = (c: string, v: Version): VersionSkills => ({
    courseCode: c, instructor: v.instructor, skills: new Map(v.skills.map((s) => [s.skillRef, { k: s.k, u: s.u, d: s.d }])),
  });
  const vsList: VersionSkills[] = mode === 'capture'
    ? (version && course ? [toVS(course, version)] : [])
    : codes.flatMap((c) => { const v = byCourse[c]?.[0]; return v ? [toVS(c, v)] : []; });

  // Capture: unplaced skills and gone leaves, worked out from the tree as it stands now.
  const wanted = new Set(codes);
  const liveLeaves = tree.leaves.filter((l) => wanted.has(l.courseCode) && l.status !== 'rejected');
  const placed = new Set(liveLeaves.filter(counts).map((l) => l.skillRef));
  const unplaced = version ? version.skills.filter((s) => !placed.has(s.skillRef)) : [];
  const allRefs = new Set(versions.flatMap((v) => v.skills.map((s) => s.skillRef)));
  const gone = (version?.gone ?? []).filter((g) => liveLeaves.some((l) => l.skillRef === g.skillRef) && !allRefs.has(g.skillRef));

  // Only nodes on the path to the courses' counting leaves. An embedding-only suggestion is not a row of its own,
  // so a competency holding nothing else would show as an empty 0 row.
  const visible = new Set<string>();
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  for (const l of liveLeaves.filter(counts)) {
    for (let id: string | null = resolveNode(tree, l.nodeId); id && !visible.has(id); id = byId.get(id)?.parentId ?? null) visible.add(id);
  }
  const roots = tree.nodes.filter((n) => !n.parentId && !n.retired && !n.mergedInto && visible.has(n.id));
  const read = (id: string): NodeReading | null =>
    !vsList.length ? null : mode === 'capture' ? readCourse(tree, vsList[0]!, id) : readProgram(tree, vsList, id);

  const parentCounts = new Map<string, number>();
  for (const l of tree.leaves) if (counts(l)) parentCounts.set(`${l.courseCode}\u0000${l.skillRef}`, (parentCounts.get(`${l.courseCode}\u0000${l.skillRef}`) ?? 0) + 1);

  const ctx: RowCtx = { tree, byId, open, setOpen, visible, course, version, handFor, setHandFor, mode, send, parentCounts, rootsOpen: true, editable: true };
  const place = (ref: string, nodeId: string) => send({ action: 'place', courseCode: course, skillRef: ref, nodeId });
  const placeUnderNew = async (ref: string, name: string, parentId: string) => {
    const key = `${ref}\u0000${parentId}\u0000${name}`;
    let madeId = created.current[key];
    if (!madeId) {
      const before = new Set(tree.nodes.map((n) => n.id));
      const next = await post({ action: 'create', name, parentId });
      if (!next) return;
      madeId = next.nodes.find((n) => !before.has(n.id) && n.parentId === parentId && n.name === name)?.id;
      if (!madeId) { setError('The new skill was created but could not be found. Reload the page and look for it in the tree.'); return; }
      created.current[key] = madeId; // a retry after a failed place must not create it again
    }
    if (await place(ref, madeId)) setPlacing(null);
  };

  return (
    <section className="flex max-w-full flex-col gap-4 break-words">
      {nameField}
      {errorBox}
      {mode === 'capture' && versions.length > 1 && (
        <label className="text-sm">Version{' '}
          <select aria-label="Version" value={vIdx} onChange={(e) => setVIdx(Number(e.target.value))} className="rounded border">
            {versions.map((v, i) => <option key={i} value={i}>{v.instructor || `Version ${i + 1}`}</option>)}
          </select>
        </label>
      )}
      {mode === 'capture' && unplaced.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Place these skills</h3>
          <ul className="flex flex-col gap-3">
            {unplaced.map((s) => (
              <li key={s.skillRef} className="flex flex-col gap-1">
                <span className="text-sm">{s.statement}</span>
                <div className="flex flex-wrap gap-1">
                  {(suggestions[s.skillRef] ?? []).slice(0, 3).map((g) => {
                    const name = byId.get(g.nodeId)?.name;
                    return name ? <button key={g.nodeId} type="button" className={btn} onClick={() => void place(s.skillRef, g.nodeId)}>{`Put under ${name}`}</button> : null;
                  })}
                  <button type="button" className={btn} onClick={() => setPlacing(placing?.ref === s.skillRef && placing.how === 'else' ? null : { ref: s.skillRef, how: 'else' })}>Somewhere else…</button>
                  <button type="button" className={btn} onClick={() => setPlacing(placing?.ref === s.skillRef && placing.how === 'new' ? null : { ref: s.skillRef, how: 'new' })}>New parent skill…</button>
                </div>
                {placing?.ref === s.skillRef && placing.how === 'else' && <NodePicker tree={tree} label="Search for a skill" onPick={(id) => void place(s.skillRef, id)} />}
                {placing?.ref === s.skillRef && placing.how === 'new' && <NewParent tree={tree} onCreate={(name, parentId) => void placeUnderNew(s.skillRef, name, parentId)} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'capture' && gone.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">No longer in the capture</h3>
          <ul className="flex flex-col gap-3">
            {gone.map((g) => (
              <li key={g.skillRef} className="flex flex-col gap-1 text-sm">
                <span>{g.statement}</span>
                {g.suggestion && <span>Same skill, reworded: {g.suggestion.statement}</span>}
                <div className="flex flex-wrap gap-1">
                  {g.suggestion && <button type="button" className={btn} onClick={() => void send({ action: 'retarget', courseCode: course, oldRef: g.skillRef, newRef: g.suggestion!.skillRef })}>Confirm</button>}
                  {liveLeaves.filter((l) => l.skillRef === g.skillRef).map((l) => (
                    <button key={l.nodeId} type="button" className={btn} onClick={() => void send({ action: 'reject', courseCode: course, skillRef: g.skillRef, nodeId: l.nodeId })}>Remove</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{mode === 'capture' ? "This course's tree" : 'Skill tree'}</h3>
        {roots.length === 0 ? <p className="text-sm">Nothing is placed yet.</p> : (
          <ul className="flex flex-col gap-2">{roots.map((n) => { const r = read(n.id); return r ? <Row key={n.id} r={r} depth={0} c={ctx} /> : null; })}</ul>
        )}
      </div>
    </section>
  );
}

/** Read-only drill-down over readings already computed (the course drawer and the department tree page). */
export function ReadingTree({ tree, readings, rootsOpen = false }: { tree: Tree; readings: NodeReading[]; rootsOpen?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const byId = useMemo(() => new Map(tree.nodes.map((n) => [n.id, n])), [tree]);
  const visible = useMemo(() => new Set(tree.nodes.map((n) => n.id)), [tree]);
  const none = useMemo(() => new Map<string, number>(), []);
  const ctx: RowCtx = {
    tree, byId, open, setOpen, visible, course: null, version: undefined, handFor: null, setHandFor: () => {},
    mode: 'capture', send: async () => false, parentCounts: none, rootsOpen, editable: false,
  };
  return <ul className="flex flex-col gap-2">{readings.map((r) => <Row key={r.nodeId} r={r} depth={0} c={ctx} />)}</ul>;
}

const one = (n: number | null): string => (n === null ? '–' : n.toFixed(1));

/** The tree's reading of one course version at a node, "Tree: K2.0 U1.5 D3.0"; a click opens the drill-down. Nothing when the node is not in the tree. */
export function TreeNumber({ tree, version, nodeId }: { tree: Tree; version: VersionSkills; nodeId: string }) {
  const [open, setOpen] = useState(false);
  const reading = useMemo(() => (tree.nodes.some((n) => n.id === nodeId) ? readCourse(tree, version, nodeId) : null), [tree, version, nodeId]);
  if (!reading) return null;
  const text = reading.k === null && reading.u === null ? `Tree: D${one(reading.d)}` : `Tree: K${one(reading.k)} U${one(reading.u)} D${one(reading.d)}`;
  return (
    <>
      <button type="button" className="cb-linkbtn cb-mono" aria-expanded={open} onClick={() => setOpen(!open)}>{text}</button>
      {open && <div className="cb-small"><ReadingTree tree={tree} readings={[reading]} rootsOpen /></div>}
    </>
  );
}

interface RowCtx {
  tree: Tree; byId: Map<string, TreeNode>; open: Set<string>; setOpen: React.Dispatch<React.SetStateAction<Set<string>>>;
  visible: Set<string>; course: string | null; version: Version | undefined; handFor: string | null;
  setHandFor: (id: string | null) => void; mode: 'capture' | 'cluster'; send: (b: Record<string, unknown>) => Promise<boolean>;
  parentCounts: Map<string, number>;
  /** Top-level rows start open (the panel) or closed (the department page). */
  rootsOpen: boolean;
  /** False for the read-only drill-down: no tools. */
  editable: boolean;
}

/** Defined at module level so rows keep their form state when the panel re-renders. */
function Row({ r, depth, c }: { r: NodeReading; depth: number; c: RowCtx }) {
  const { byId, open, setOpen, visible, tree, course, version, handFor, setHandFor, mode, send, parentCounts } = c;
  const n = byId.get(r.nodeId) as TreeNode;
  const rootOpen = depth === 0 && c.rootsOpen;
  const isOpen = open.has(r.nodeId) || (rootOpen && !open.has(`-${r.nodeId}`));
  const kids = r.children.filter((k) => visible.has(k.nodeId));
  const foundational = r.k === null && r.u === null;
  const hand = tree.depths.find((h) => resolveNode(tree, h.nodeId) === r.nodeId && h.courseCode === course && h.instructor === version?.instructor);
  const leafOf = (d: { courseCode: string; skillRef: string }) =>
    tree.leaves.find((l) => l.courseCode === d.courseCode && l.skillRef === d.skillRef && counts(l) && resolveNode(tree, l.nodeId) === r.nodeId);
  const toggle = () => setOpen((s) => { const x = new Set(s); const key = rootOpen ? `-${r.nodeId}` : r.nodeId; const want = rootOpen ? isOpen : !isOpen; if (want) x.add(key); else x.delete(key); return x; });
  return (
    <li data-node={r.nodeId} className="flex flex-col gap-1 border-l pl-2" style={{ marginLeft: depth ? 8 : 0 }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-expanded={isOpen} onClick={toggle} className="text-xs" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${n.name}`}>{isOpen ? '▾' : '▸'}</button>
        <span className="font-medium">{n.name}</span>
        <span className="text-sm">{foundational ? `D${fmt(r.d)}` : `K${fmt(r.k)} U${fmt(r.u)} D${fmt(r.d)}`}</span>
        {r.byHand && <span className="text-xs">set by hand</span>}
        {r.byHand && <span className="text-xs">{foundational ? `suggested D${fmt(r.computed.d)}` : `suggested K${fmt(r.computed.k)} U${fmt(r.computed.u)} D${fmt(r.computed.d)}`}</span>}
        {r.needsReview && <span className="text-xs text-amber-800">Review: the skills under it changed</span>}
        {mode === 'capture' && version && <button type="button" className={btn} onClick={() => setHandFor(handFor === r.nodeId ? null : r.nodeId)}>Set by hand</button>}
      </div>
      {handFor === r.nodeId && course && version && (
        <DepthForm initial={r.byHand ? r : r.computed} foundational={foundational} hasHand={!!hand}
          send={(clear, v) => send(clear ? { action: 'depth-clear', nodeId: r.nodeId, courseCode: course, instructor: version.instructor } : { action: 'depth', nodeId: r.nodeId, courseCode: course, instructor: version.instructor, ...v })}
          onDone={() => setHandFor(null)} />
      )}
      {c.editable && <AddSkillUnder node={n} send={send} />}
      {mode === 'cluster' && c.editable && <NodeTools tree={tree} node={n} leaves={r.direct.map((d) => ({ courseCode: d.courseCode, skillRef: d.skillRef, statement: d.statement }))} send={send} />}
      {isOpen && (
        <ul className="flex flex-col gap-1">
          {kids.map((k) => <Row key={k.nodeId} r={k} depth={depth + 1} c={c} />)}
          {r.direct.map((d) => (
            <li key={`${d.courseCode}${d.skillRef}`} className="flex flex-wrap items-center gap-2 pl-4 text-sm">
              <span>{mode === 'cluster' ? `${d.courseCode} — ${d.statement}` : d.statement}</span>
              {leafOf(d) && leafOf(d)!.status === 'proposed' && <span className="text-xs">suggested</span>}
              <span className="text-xs">{foundational ? `D${fmt(d.depth.d)}` : `K${fmt(d.depth.k)} U${fmt(d.depth.u)} D${fmt(d.depth.d)}`}</span>
              {c.editable && leafOf(d) && <LeafTools tree={tree} courseCode={d.courseCode} skillRef={d.skillRef} nodeId={leafOf(d)!.nodeId} proposed={leafOf(d)!.status === 'proposed'} send={send} />}
              {mode === 'cluster' && (parentCounts.get(`${d.courseCode}\u0000${d.skillRef}`) ?? 0) > 1 && <ShareField tree={tree} d={d} nodeId={r.nodeId} send={send} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Cluster only: what share of a skill counts toward this parent, when it sits under more than one. */
function ShareField({ tree, d, nodeId, send }: { tree: Tree; d: { courseCode: string; skillRef: string }; nodeId: string; send: (b: Record<string, unknown>) => Promise<boolean> }) {
  const cur = tree.leaves.find((l) => l.courseCode === d.courseCode && l.skillRef === d.skillRef && resolveNode(tree, l.nodeId) === nodeId)?.share;
  const [v, setV] = useState(cur == null ? '' : String(cur));
  return (
    <span className="flex items-center gap-1 text-xs">
      <label>Share <input aria-label="Share" type="number" step="0.1" min="0" max="1" value={v} onChange={(e) => setV(e.target.value)} className="w-16 rounded border px-1" /></label>
      <button type="button" className={btn} onClick={() => void send({ action: 'share', courseCode: d.courseCode, skillRef: d.skillRef, nodeId, share: v === '' ? null : Number(v) })}>Set share</button>
      <span className="sr-only">{pathLabel(tree, nodeId)}</span>
    </span>
  );
}
