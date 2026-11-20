/**
 * Runs only against the scratch database (skips anywhere else; 0074 must be applied there).
 * Every row it creates (nodes, leaves, depths, events, a course with one snapshot and its links) is tagged and deleted afterward.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('skill-tree-queries (scratch database)', () => {
  const tag = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let q: typeof import('@/lib/db/skill-tree-queries');
  let dbm: typeof import('@/lib/db/client');
  let s: typeof import('@/lib/db/schema');
  let orm: typeof import('drizzle-orm');
  let read: typeof import('@/lib/skill-tree/read');
  let hashOf: (x: string) => string;
  let masterId: string;       // a live master (its node id equals its competency id)
  let n = 0;
  const course = (c: string) => `${tag}-${c}`;
  const name = (x: string) => `${tag} ${x} ${++n}`;
  const by = tag;

  type Ok = Extract<Awaited<ReturnType<typeof q.createNode>>, { ok: true }>;
  const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
    if (!r.ok) throw new Error(`write refused: ${JSON.stringify(r)}`);
    return r as Extract<T, { ok: true }>;
  };
  /** Create a node and return its id (looked up by its tagged name, which is unique). */
  const newNode = async (nm: string, parentId: string): Promise<string> => {
    const full = name(nm);
    const r = must(await q.createNode({ name: full, parentId, by }));
    return r.tree.nodes.find((x) => x.name === full)!.id;
  };
  const events = async () => (await dbm.db.select().from(s.skillTreeEvents).where(orm.eq(s.skillTreeEvents.by, by))).length;
  const addLeaf = (c: string, ref: string, nodeId: string, status: 'proposed' | 'confirmed' | 'rejected') =>
    dbm.db.insert(s.skillLeaves).values({ courseCode: course(c), skillRef: ref, nodeId, statement: `${tag} ${ref}`, source: 'ai', status });
  const leavesOf = (tree: { leaves: Array<{ courseCode: string; skillRef: string; nodeId: string; status: string }> }, nodeId: string) =>
    tree.leaves.filter((l) => l.nodeId === nodeId && l.courseCode.startsWith(tag));

  beforeAll(async () => {
    q = await import('@/lib/db/skill-tree-queries');
    dbm = await import('@/lib/db/client');
    s = await import('@/lib/db/schema');
    orm = await import('drizzle-orm');
    read = await import('@/lib/skill-tree/read');
    hashOf = (await import('@/lib/strings/hash')).hashOf;
    const m = await dbm.db.select().from(s.skillNodes).where(orm.and(orm.isNotNull(s.skillNodes.competencyId), orm.eq(s.skillNodes.retired, false))).limit(1);
    if (!m[0]) throw new Error('scratch DB has no master node: apply drizzle/0074_skill_tree.sql to the scratch database');
    masterId = m[0].id;
  });

  afterAll(async () => {
    if (!dbm) return;
    const { db } = dbm;
    const snaps = (await db.select({ id: s.courseCaptureSnapshots.id }).from(s.courseCaptureSnapshots).where(orm.like(s.courseCaptureSnapshots.courseCode, `${tag}%`))).map((r) => r.id);
    if (snaps.length) await db.delete(s.skillCompetencyLinks).where(orm.inArray(s.skillCompetencyLinks.snapshotId, snaps));
    await db.delete(s.courseCaptureSnapshots).where(orm.like(s.courseCaptureSnapshots.courseCode, `${tag}%`));
    await db.delete(s.courses).where(orm.like(s.courses.code, `${tag}%`));
    await db.delete(s.nodeDepths).where(orm.like(s.nodeDepths.courseCode, `${tag}%`));
    await db.delete(s.skillLeaves).where(orm.like(s.skillLeaves.courseCode, `${tag}%`));
    await db.delete(s.skillTreeEvents).where(orm.eq(s.skillTreeEvents.by, by));
    // Tagged nodes point at each other; a non-master with no parent must be retired to satisfy its check.
    await db.update(s.skillNodes).set({ parentId: null, mergedInto: null, retired: true }).where(orm.eq(s.skillNodes.createdBy, by));
    await db.delete(s.skillNodes).where(orm.eq(s.skillNodes.createdBy, by));
  });

  it('create, rename and a logged event', async () => {
    const e0 = await events();
    const id = await newNode('icc', masterId);
    expect(await events()).toBe(e0 + 1);
    const r = must(await q.renameNode({ id, name: name('icc renamed'), description: 'about', by }));
    const node = r.tree.nodes.find((x) => x.id === id)!;
    expect(node.name).toMatch(/icc renamed/);
    expect(node.description).toBe('about');
    expect(node.parentId).toBe(masterId);
    expect(await events()).toBe(e0 + 2);
    const ev = await dbm.db.select().from(s.skillTreeEvents).where(orm.and(orm.eq(s.skillTreeEvents.by, by), orm.eq(s.skillTreeEvents.kind, 'renamed')));
    expect(ev[0]!.before).toMatchObject({ description: null });
    expect(ev[0]!.after).toMatchObject({ description: 'about' });
    const w = must(await q.setWeight({ id: masterId, weight: 1, by }));   // weight on a master is allowed
    expect(w.tree.nodes.find((x) => x.id === masterId)!.weightSource).toBe('faculty');
    const bad = await q.setWeight({ id, weight: 0, by });
    expect(bad.ok).toBe(false);
  });

  it('reparent refuses a loop', async () => {
    const a = await newNode('loopA', masterId);
    const b = await newNode('loopB', a);
    const before = await q.loadTree();
    const e0 = await events();
    const r = await q.reparentNode({ id: a, parentId: b, by });
    expect(r).toEqual({ ok: false, status: 409, error: 'That would put a skill under itself.' });
    expect(await q.loadTree()).toEqual(before);
    expect(await events()).toBe(e0);
    const ok = must(await q.reparentNode({ id: b, parentId: masterId, by }));
    expect(ok.tree.nodes.find((x) => x.id === b)!.parentId).toBe(masterId);
  });

  it('masters refuse structural edits', async () => {
    const other = await newNode('plain', masterId);
    const before = await q.loadTree();
    const e0 = await events();
    const msg = 'Competencies are edited in the catalog';
    expect(await q.renameNode({ id: masterId, name: 'x', by })).toEqual({ ok: false, status: 400, error: msg });
    expect(await q.reparentNode({ id: masterId, parentId: other, by })).toEqual({ ok: false, status: 400, error: msg });
    expect(await q.mergeNode({ from: masterId, into: other, by })).toEqual({ ok: false, status: 400, error: msg });
    expect(await q.splitNode({ id: masterId, newName: 'x', moveNodes: [], moveLeaves: [], by })).toMatchObject({ ok: false, status: 400, error: msg });
    expect(await q.loadTree()).toEqual(before);
    expect(await events()).toBe(e0);
  });

  it('merge moves children and leaves, redirects', async () => {
    const a = await newNode('mergeFrom', masterId);
    const b = await newNode('mergeInto', masterId);
    const a1 = await newNode('mergeChild', a);
    await addLeaf('m', 'only-a', a, 'proposed');
    await addLeaf('m', 'clash-b-wins', a, 'proposed');
    await addLeaf('m', 'clash-b-wins', b, 'confirmed');
    await addLeaf('m', 'clash-a-wins', a, 'confirmed');
    await addLeaf('m', 'clash-a-wins', b, 'proposed');
    await q.setDepth({ nodeId: a, courseCode: course('m'), instructor: '', k: 1, u: 1, d: 1, by });

    // Cannot merge into a descendant, or into itself.
    expect(await q.mergeNode({ from: a, into: a1, by })).toMatchObject({ ok: false, status: 409 });
    expect(await q.mergeNode({ from: a, into: a, by })).toMatchObject({ ok: false, status: 409 });

    const r = must(await q.mergeNode({ from: a, into: b, by }));
    const from = r.tree.nodes.find((x) => x.id === a)!;
    expect(from.retired).toBe(true);
    expect(from.mergedInto).toBe(b);
    expect(read.resolveNode(r.tree, a)).toBe(b);
    expect(r.tree.nodes.find((x) => x.id === a1)!.parentId).toBe(b);   // child node moved
    expect(leavesOf(r.tree, a)).toEqual([]);                           // none left behind on the retired node
    const onB = leavesOf(r.tree, b).map((l) => `${l.skillRef}:${l.status}`).sort();
    expect(onB).toEqual(['clash-a-wins:confirmed', 'clash-b-wins:confirmed', 'only-a:proposed']);   // no duplicates, the more decided row kept
    expect(r.tree.depths.some((d) => d.nodeId === a)).toBe(true);      // depths stay (they resolve through the redirect)
  });

  it('split returns what to re-point and moves only the listed items', async () => {
    const parent = await newNode('splitParent', masterId);
    const k1 = await newNode('splitKid1', parent);
    const k2 = await newNode('splitKid2', parent);
    await addLeaf('s', 'move-me', parent, 'confirmed');
    await addLeaf('s', 'stay', parent, 'confirmed');
    await q.setDepth({ nodeId: parent, courseCode: course('s'), instructor: 'Dr X', k: 2, u: 2, d: 2, by });
    const [pt] = await dbm.db.insert(s.stringPoints).values({
      courseCode: course('s'), role: 'requires', statement: `${tag} need`, statementHash: `h-${tag}`, nodeId: parent, createdBy: by,
    }).returning({ id: s.stringPoints.id });
    try {
      expect(await q.splitNode({ id: parent, newName: name('x'), moveNodes: [k2, 'nope'], moveLeaves: [], by })).toMatchObject({ ok: false, status: 400 });
      const newName = name('splitNew');
      const r = await q.splitNode({ id: parent, newName, moveNodes: [k1], moveLeaves: [{ courseCode: course('s'), skillRef: 'move-me' }], by });
      const ok = must(r);
      const created = ok.tree.nodes.find((x) => x.name === newName)!;
      expect(created.parentId).toBe(masterId);                                            // a sibling
      expect(ok.tree.nodes.find((x) => x.id === k1)!.parentId).toBe(created.id);          // listed child moved
      expect(ok.tree.nodes.find((x) => x.id === k2)!.parentId).toBe(parent);              // unlisted child stayed
      expect(leavesOf(ok.tree, created.id).map((l) => l.skillRef)).toEqual(['move-me']);
      expect(leavesOf(ok.tree, parent).map((l) => l.skillRef)).toEqual(['stay']);
      expect(r.repoint).toEqual({ stringPointIds: [pt!.id], depths: [{ courseCode: course('s'), instructor: 'Dr X' }] });
      // Nothing re-pointed automatically.
      expect(ok.tree.depths.filter((d) => d.nodeId === parent)).toHaveLength(1);
      const sp = await dbm.db.select().from(s.stringPoints).where(orm.eq(s.stringPoints.id, pt!.id));
      expect(sp[0]!.nodeId).toBe(parent);
    } finally {
      await dbm.db.delete(s.stringPoints).where(orm.eq(s.stringPoints.id, pt!.id));
    }
  });

  /** A tagged course with one live snapshot whose capture holds the given skill statements. */
  const snapshotFor = async (c: string, statements: string[]) => {
    await dbm.db.insert(s.courses).values({ code: course(c), title: `${tag} course`, level: 1, track: 'test' });
    const [snap] = await dbm.db.insert(s.courseCaptureSnapshots).values({
      courseCode: course(c), profile: { competencies: statements.map((statement) => ({ statement })) } as never,
      inputsMeta: {} as never, scaleVersion: 'test', model: 'test',
    }).returning({ id: s.courseCaptureSnapshots.id });
    return snap!.id;
  };
  const linksOf = (snapshotId: string) => dbm.db.select().from(s.skillCompetencyLinks).where(orm.eq(s.skillCompetencyLinks.snapshotId, snapshotId));

  it('placing, confirming, rejecting and moving a leaf leave skill_competency_links unchanged', async () => {
    const statement = `${tag} Prepares a press-ready file`;
    const ref = hashOf(statement);
    const snapId = await snapshotFor('link', [statement]);
    const icc = await newNode('icc', masterId);
    expect(await linksOf(snapId)).toHaveLength(0);

    // placeLeaf (new, confirmed)
    must(await q.placeLeaf({ courseCode: course('link'), skillRef: ref, statement, nodeId: icc, by }));
    expect(await linksOf(snapId)).toHaveLength(0);

    // decideLeaf confirm on a proposed leaf
    const second = `${tag} Judges registration`;
    const icc2 = await newNode('icc2', icc);
    await addLeaf('link', hashOf(second), icc2, 'proposed');
    const r = must(await q.decideLeaf({ courseCode: course('link'), skillRef: hashOf(second), nodeId: icc2, decision: 'confirm', by }));
    expect(r).not.toHaveProperty('notes');
    expect(await linksOf(snapId)).toHaveLength(0);

    // reject and move do not touch links either
    must(await q.decideLeaf({ courseCode: course('link'), skillRef: hashOf(second), nodeId: icc2, decision: 'reject', by }));
    const other = await newNode('other', masterId);
    must(await q.moveLeaf({ courseCode: course('link'), skillRef: ref, from: icc, to: other, by }));
    expect(await linksOf(snapId)).toHaveLength(0);
  });

  it('an existing link is neither changed nor re-confirmed by a placement', async () => {
    const statement = `${tag} Checks color separations`;
    const ref = hashOf(statement);
    const snapId = await snapshotFor('keep', [statement]);
    const master = (await q.loadTree()).nodes.find((x) => x.id === masterId)!;
    await dbm.db.insert(s.skillCompetencyLinks).values({ snapshotId: snapId, skillRef: ref, statement, competencyId: master.competencyId!, source: 'faculty', status: 'rejected', decidedBy: 'someone' });
    const icc = await newNode('keep', masterId);
    must(await q.placeLeaf({ courseCode: course('keep'), skillRef: ref, statement, nodeId: icc, by }));
    const links = await linksOf(snapId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ status: 'rejected', decidedBy: 'someone' });
  });

  it('retarget keeps parents', async () => {
    const a = await newNode('rtA', masterId);
    const b = await newNode('rtB', masterId);
    await addLeaf('rt', 'old', a, 'proposed');
    await addLeaf('rt', 'old', b, 'confirmed');
    await addLeaf('rt', 'new', b, 'proposed');          // clash on b: the confirmed old row wins
    await dbm.db.update(s.skillLeaves).set({ share: 0.5 }).where(orm.and(orm.eq(s.skillLeaves.courseCode, course('rt')), orm.eq(s.skillLeaves.skillRef, 'old'), orm.eq(s.skillLeaves.nodeId, a)));
    const r = must(await q.retargetLeaf({ courseCode: course('rt'), oldRef: 'old', newRef: 'new', newStatement: `${tag} reworded`, by }));
    const mine = r.tree.leaves.filter((l) => l.courseCode === course('rt'));
    expect(mine.some((l) => l.skillRef === 'old')).toBe(false);
    const onA = mine.filter((l) => l.nodeId === a);
    const onB = mine.filter((l) => l.nodeId === b);
    expect(onA).toHaveLength(1);
    expect(onA[0]).toMatchObject({ skillRef: 'new', statement: `${tag} reworded`, share: 0.5, status: 'proposed' });
    expect(onB).toHaveLength(1);
    expect(onB[0]).toMatchObject({ skillRef: 'new', statement: `${tag} reworded`, status: 'confirmed' });
    expect(await q.retargetLeaf({ courseCode: course('rt'), oldRef: 'gone', newRef: 'x', newStatement: 'y', by })).toMatchObject({ ok: false, status: 404 });
  });

  it('setDepth stores the signature', async () => {
    const node = await newNode('depthNode', masterId);
    await addLeaf('dp', 'r1', node, 'confirmed');
    await addLeaf('dp', 'r2', node, 'proposed');
    const tree0 = await q.loadTree();
    const sig = read.leavesSignature(tree0, node, course('dp'));
    const r = must(await q.setDepth({ nodeId: node, courseCode: course('dp'), instructor: 'Dr Y', k: 3, u: null, d: 0, by }));
    expect(r.tree.depths.find((d) => d.nodeId === node)).toMatchObject({ k: 3, u: null, d: 0, method: 'faculty', leavesSignature: sig, setBy: by });
    expect(await q.setDepth({ nodeId: node, courseCode: course('dp'), instructor: 'Dr Y', k: 6, u: null, d: 0, by })).toMatchObject({ ok: false, status: 400 });
    // share and clear
    must(await q.setShare({ courseCode: course('dp'), skillRef: 'r1', nodeId: node, share: 2, by }));
    const c = must(await q.clearDepth({ nodeId: node, courseCode: course('dp'), instructor: 'Dr Y', by }));
    expect(c.tree.depths.some((d) => d.nodeId === node)).toBe(false);
    expect(await q.clearDepth({ nodeId: node, courseCode: course('dp'), instructor: 'Dr Y', by })).toMatchObject({ ok: false, status: 404 });
  });
});
