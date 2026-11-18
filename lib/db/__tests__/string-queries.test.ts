/**
 * Runs only against the scratch database; skips itself anywhere else so it can never touch live data.
 * Every row it creates (strings, points, links, path, events, notes) is deleted afterward.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('string-queries (scratch database)', () => {
  const tag = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let q: typeof import('@/lib/db/string-queries');
  let rules: typeof import('@/lib/builder/strings/rules');
  let dbm: typeof import('@/lib/db/client');
  let s: typeof import('@/lib/db/schema');
  let orm: typeof import('drizzle-orm');
  let n = 0;

  const code = (c: string) => `${tag}-${c}`;
  const pt = (c: string, i: number, role: 'develops' | 'requires' = 'develops') => ({
    courseCode: code(c), role, statement: `${tag} skill ${c} ${i} ${role}`, statementHash: `h-${tag}-${c}-${i}-${role}`,
    snapshotId: null, k: 1, u: 2, d: 3,
  });
  const name = (x: string) => `${tag} ${x} ${++n}`;
  type Ok = Extract<Awaited<ReturnType<typeof q.lockString>>, { ok: true }>;
  const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
    if (!r.ok) throw new Error(`write refused: ${JSON.stringify(r)}`);
    return r as Extract<T, { ok: true }>;
  };
  /** Lock a string through the given points (course letter, index). */
  const lock = async (nm: string, ps: Array<[string, number]>, role: 'develops' | 'requires' = 'develops') =>
    must(await q.lockString({
      name: nm, description: 'd', points: ps.map(([c, i]) => pt(c, i, role)), whys: ps.slice(1).map((_, i) => `why ${i}`), by: 'tester',
    }));
  const mine = (r: Ok, nm: string) => r.graph.strings.find((x) => x.name === nm)!;
  const ids = async (table: 'points' | 'strings') => {
    if (table === 'points') return (await dbm.db.select({ id: s.stringPoints.id }).from(s.stringPoints).where(orm.like(s.stringPoints.courseCode, `${tag}%`))).map((r) => r.id);
    return (await dbm.db.select({ id: s.curriculumStrings.id }).from(s.curriculumStrings).where(orm.like(s.curriculumStrings.name, `${tag}%`))).map((r) => r.id);
  };

  beforeAll(async () => {
    q = await import('@/lib/db/string-queries');
    rules = await import('@/lib/builder/strings/rules');
    dbm = await import('@/lib/db/client');
    s = await import('@/lib/db/schema');
    orm = await import('drizzle-orm');
  });
  afterAll(async () => {
    if (!dbm) return;
    const pointIds = await ids('points');
    const stringIds = await ids('strings');
    const { db } = dbm;
    if (stringIds.length) {
      await db.update(s.curriculumStrings).set({ mergedInto: null }).where(orm.inArray(s.curriculumStrings.id, stringIds));
      await db.delete(s.curriculumStringEvents).where(orm.inArray(s.curriculumStringEvents.stringId, stringIds));
    }
    if (pointIds.length) {
      await db.delete(s.curriculumStringEvents).where(orm.inArray(s.curriculumStringEvents.pointId, pointIds));
      await db.delete(s.curriculumStringPath).where(orm.inArray(s.curriculumStringPath.pointId, pointIds));
    }
    if (stringIds.length) await db.delete(s.curriculumStrings).where(orm.inArray(s.curriculumStrings.id, stringIds));
    if (pointIds.length) {
      await db.delete(s.stringLinks).where(orm.or(orm.inArray(s.stringLinks.fromPoint, pointIds), orm.inArray(s.stringLinks.toPoint, pointIds)));
      await db.delete(s.stringPointResolutions).where(orm.inArray(s.stringPointResolutions.pointId, pointIds));
      await db.delete(s.stringPoints).where(orm.inArray(s.stringPoints.id, pointIds));
    }
    await db.delete(s.skillOrphanNotes).where(orm.like(s.skillOrphanNotes.courseCode, `${tag}%`));
    await db.delete(s.curriculumStringEvents).where(orm.sql`${s.curriculumStringEvents.after} ->> 'courseCode' LIKE ${`${tag}%`}`);
  });

  it('lock writes one string, N points, N-1 links and one locked event', async () => {
    const nm = name('lock');
    const r = await lock(nm, [['A', 1], ['B', 1], ['C', 1]]);
    const str = mine(r, nm);
    expect(str.path).toHaveLength(3);
    expect(str.version).toBe(1);
    expect(str.status).toBe('active');
    const pids = await ids('points');
    expect(pids).toHaveLength(3);
    const links = await dbm.db.select().from(s.stringLinks).where(orm.inArray(s.stringLinks.fromPoint, pids));
    expect(links).toHaveLength(2);
    const events = await dbm.db.select().from(s.curriculumStringEvents).where(orm.eq(s.curriculumStringEvents.stringId, str.id));
    expect(events.map((e) => e.kind)).toEqual(['locked']);
    expect(rules.checkPath(r.graph, str.path)).toBeNull();
    expect(r.graph.events.filter((e) => e.stringId === str.id && e.kind === 'locked')).toHaveLength(1);
  });

  it('locking a second string through an existing point reuses the point (a join)', async () => {
    const a = await lock(name('j1'), [['J', 1], ['K', 1]]);
    const before = (await ids('points')).length;
    const nm = name('j2');
    const b = await lock(nm, [['J', 1], ['L', 1]]);
    expect((await ids('points')).length).toBe(before + 1);
    const first = a.graph.strings.find((x) => x.name.includes(' j1 '))!;
    expect(mine(b, nm).path[0]).toBe(first.path[0]);
    const joins = b.graph.events.filter((e) => e.kind === 'joined' && e.stringId === mine(b, nm).id);
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ pointId: first.path[0], after: { with: [first.id] } });
    expect(a.graph.events.some((e) => e.kind === 'joined')).toBe(false);
  });

  it('reusing an existing link keeps its why and says the supplied one was ignored', async () => {
    await lock(name('l1'), [['M', 1], ['N', 1]]);
    const nm2 = name('l2');
    const r = must(await q.lockString({ name: nm2, description: 'd', points: [pt('M', 1), pt('N', 1)], whys: ['a different why'], by: 'tester' }));
    expect(r.notes?.length).toBe(1);
    const strRow = mine(r, nm2);
    const l = r.graph.links.find((x) => x.from === strRow.path[0] && x.to === strRow.path[1])!;
    expect(l.why).toBe('why 0');
    expect(r.graph.links.some((x) => x.why === 'a different why')).toBe(false);
  });

  it('refuses a name already used by an active string, but allows one used by an unlocked string', async () => {
    const nm = name('clash');
    const a = await lock(nm, [['P', 1], ['Q', 1]]);
    const clash = await q.lockString({ name: nm.toUpperCase(), description: 'd', points: [pt('P', 2), pt('Q', 2)], whys: ['w'], by: 't' });
    expect(clash).toMatchObject({ ok: false, status: 409, error: 'A string with that name already exists.' });
    const id = mine(a, nm).id;
    must(await q.unlockString({ id, version: 1, reason: 'retiring', by: 't' }));
    const again = await q.lockString({ name: nm, description: 'd', points: [pt('P', 2), pt('Q', 2)], whys: ['w'], by: 't' });
    expect(again.ok).toBe(true);
    const relock = await q.relockString({ id, version: 2, by: 't' });
    expect(relock).toMatchObject({ ok: false, status: 409, error: 'A string with that name already exists.' });
  });

  it('stale version is refused', async () => {
    const nm = name('stale');
    const a = await lock(nm, [['R', 1], ['S', 1]]);
    const id = mine(a, nm).id;
    must(await q.renameString({ id, version: 1, name: name('stale-new'), by: 'x' }));
    const r = await q.renameString({ id, version: 1, name: name('stale-newer'), by: 'y' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.current?.version).toBe(2);
    expect(r.current?.id).toBe(id);
  });

  it('extends at the end and at the start, and refuses extending onto a point already on the string', async () => {
    const nm = name('ext');
    const a = await lock(nm, [['T', 1], ['U', 1]]);
    const id = mine(a, nm).id;
    const e1 = must(await q.extendString({ id, version: 1, at: 'end', point: pt('V', 1), why: 'next', by: 't' }));
    expect(e1.graph.strings.find((x) => x.id === id)).toMatchObject({ version: 2 });
    const e2 = must(await q.extendString({ id, version: 2, at: 'start', point: pt('W', 1), why: 'before', by: 't' }));
    const path = e2.graph.strings.find((x) => x.id === id)!.path;
    expect(e2.graph.events.filter((e) => e.kind === 'joined' && e.stringId === id)).toHaveLength(0);
    expect(path.map((p) => e2.graph.points[p]!.courseCode.replace(`${tag}-`, ''))).toEqual(['W', 'T', 'U', 'V']);
    expect(rules.checkPath(e2.graph, path)).toBeNull();
    const dup = await q.extendString({ id, version: 3, at: 'end', point: pt('T', 1), why: 'loop', by: 't' });
    expect(dup).toMatchObject({ ok: false, status: 400 });
  });

  it('branches off a string after a position', async () => {
    const nm = name('br');
    const a = await lock(nm, [['X', 1], ['Y', 1], ['Z', 1]]);
    const src = mine(a, nm);
    const nb = name('br-child');
    const b = must(await q.branchString({ fromId: src.id, version: 1, atPosition: 1, name: nb, description: 'd', point: pt('X2', 1), why: 'w', by: 't' }));
    const child = mine(b, nb);
    expect(child.path.slice(0, 2)).toEqual(src.path.slice(0, 2));
    expect(child.path).toHaveLength(3);
    expect(b.graph.strings.find((x) => x.id === src.id)?.path).toEqual(src.path);
    const end = await q.branchString({ fromId: src.id, version: 1, atPosition: 2, name: name('br-bad'), description: 'd', point: pt('X3', 1), why: 'w', by: 't' });
    expect(end).toMatchObject({ ok: false, status: 400, error: 'Extend the string instead.' });
  });

  it('merges, refuses a merge chain cycle, and unmerges with a reason', async () => {
    const na = name('mA'); const nb = name('mB');
    const a = await lock(na, [['G1', 1], ['G2', 1]]);
    const b = await lock(nb, [['G0', 1], ['G2', 1], ['G3', 1]]);
    const aId = mine(a, na).id; const bId = mine(b, nb).id;
    const m = must(await q.mergeString({ id: aId, version: 1, into: bId, reason: 'same thread', by: 't' }));
    expect(m.graph.strings.find((x) => x.id === aId)?.mergedInto).toBe(bId);
    // B into A would close a loop (A already merges into B). A's last point (G2) is on B; make B's last point on A so only the cycle rule fires.
    const cycle = await q.mergeString({ id: bId, version: 1, into: aId, reason: 'loop', by: 't' });
    expect(cycle).toMatchObject({ ok: false, status: 400, error: 'That string already merges into this one.' });
    const noReason = await q.unmergeString({ id: aId, version: 2, reason: '  ', by: 't' });
    expect(noReason).toMatchObject({ ok: false, status: 400, error: 'A reason is required.' });
    const um = must(await q.unmergeString({ id: aId, version: 2, reason: 'not the same', by: 't' }));
    expect(um.graph.strings.find((x) => x.id === aId)?.mergedInto).toBeNull();
    const self = await q.mergeString({ id: aId, version: 3, into: aId, reason: 'x', by: 't' });
    expect(self).toMatchObject({ ok: false, status: 400, error: "A string can't merge into itself." });
  });

  it('removing a middle point unhooks it: path shrinks by one, still a valid path, new link has no why', async () => {
    const nm = name('rm');
    const a = await lock(nm, [['H1', 1], ['H2', 1], ['H3', 1]]);
    const src = mine(a, nm);
    const noReason = await q.removePoint({ id: src.id, version: 1, position: 1, reason: '', by: 't' });
    expect(noReason).toMatchObject({ ok: false, status: 400, error: 'A reason is required.' });
    const r = must(await q.removePoint({ id: src.id, version: 1, position: 1, reason: 'no longer taught', by: 't' }));
    const after = r.graph.strings.find((x) => x.id === src.id)!;
    expect(after.path).toEqual([src.path[0], src.path[2]]);
    expect(rules.checkPath(r.graph, after.path)).toBeNull();
    const joined = r.graph.links.find((l) => l.from === src.path[0] && l.to === src.path[2]);
    expect(joined).toBeDefined();
    const row = (await dbm.db.select().from(s.stringLinks).where(orm.eq(s.stringLinks.id, joined!.id)))[0]!;
    expect(row.why).toBeNull();
    expect(joined!.why).toBeNull();
    expect((await q.loadGraph({ courseCodes: [code('H1')] })).links.find((l) => l.id === joined!.id)?.why).toBeNull();
    const ev = r.graph.events.find((e) => e.kind === 'point_removed' && e.stringId === src.id)!;
    expect(ev.before).toEqual({ path: src.path, courseCode: code('H2') });
    expect(ev.pointId).toBe(src.path[1]);
    // Only two points remain: refuse.
    const last = await q.removePoint({ id: src.id, version: 2, position: 0, reason: 'x', by: 't' });
    expect(last).toMatchObject({ ok: false, status: 400, error: 'A string needs at least two skills. Unlock it instead.' });
  });

  it('removing an end point shortens the path', async () => {
    const nm = name('rme');
    const a = await lock(nm, [['E1', 1], ['E2', 1], ['E3', 1]]);
    const src = mine(a, nm);
    const r = must(await q.removePoint({ id: src.id, version: 1, position: 2, reason: 'dropped', by: 't' }));
    expect(r.graph.strings.find((x) => x.id === src.id)!.path).toEqual(src.path.slice(0, 2));
  });

  it('unlock without a reason is refused; with one it unlocks, and the string drops out of the default load', async () => {
    const nm = name('unl');
    const a = await lock(nm, [['UL1', 1], ['UL2', 1]]);
    const id = mine(a, nm).id;
    expect(await q.unlockString({ id, version: 1, reason: '   ', by: 't' })).toMatchObject({ ok: false, status: 400, error: 'A reason is required.' });
    const u = must(await q.unlockString({ id, version: 1, reason: 'retire', by: 't' }));
    expect(u.graph.strings.find((x) => x.id === id)?.status).toBe('unlocked');
    expect((await q.loadGraph({ courseCodes: [code('UL1')] })).strings.some((x) => x.id === id)).toBe(false);
    expect((await q.loadGraph({ courseCodes: [code('UL1')], includeUnlocked: true })).strings.some((x) => x.id === id)).toBe(true);
  });

  it('sets the link why, the end note and the name', async () => {
    const nm = name('misc');
    const a = await lock(nm, [['MS1', 1], ['MS2', 1]]);
    const src = mine(a, nm);
    const linkId = a.graph.links.find((l) => l.from === src.path[0])!.id;
    const w = must(await q.setLinkWhy({ linkId, why: 'a better why', by: 't' }));
    expect(w.graph.links.find((l) => l.id === linkId)?.why).toBe('a better why');
    expect(w.graph.events.some((e) => e.kind === 'link_why')).toBe(true);
    const en = must(await q.setEndNote({ id: src.id, version: 1, note: 'ends here on purpose', by: 't' }));
    expect(en.graph.strings.find((x) => x.id === src.id)?.endNote).toBe('ends here on purpose');
    const rn = must(await q.renameString({ id: src.id, version: 2, name: name('renamed'), by: 't' }));
    expect(rn.graph.strings.find((x) => x.id === src.id)?.version).toBe(3);
  });

  it('confirms a reword, and refuses a reword onto an existing point', async () => {
    const nm = name('rw');
    const a = await lock(nm, [['RW1', 1], ['RW2', 1]]);
    const src = mine(a, nm);
    const snap = '00000000-0000-4000-8000-000000000001';
    const other = must(await q.lockString({ name: name('rw-other'), description: 'd', points: [pt('RW1', 9), pt('RW3', 1)], whys: ['w'], by: 't' }));
    const taken = other.graph.points[Object.keys(other.graph.points).find((k) => other.graph.points[k]!.statementHash === pt('RW1', 9).statementHash)!]!;
    const refused = await q.confirmReword({ pointId: src.path[0]!, candidate: { statement: taken.statement, hash: taken.statementHash }, snapshotId: snap, by: 't' });
    expect(refused).toMatchObject({ ok: false, status: 409, error: 'Another string point already holds that skill.' });

    const ok = must(await q.confirmReword({
      pointId: src.path[0]!, candidate: { statement: `${tag} reworded`, hash: `h-${tag}-reworded` }, snapshotId: snap, depth: { k: 2, u: 3, d: 4 }, by: 't',
    }));
    expect(ok.graph.points[src.path[0]!]).toMatchObject({ statement: `${tag} reworded`, statementHash: `h-${tag}-reworded`, snapshotId: snap, k: 2, u: 3, d: 4 });
    const ev = await dbm.db.select().from(s.curriculumStringEvents).where(orm.eq(s.curriculumStringEvents.pointId, src.path[0]!));
    const rw = ev.filter((e) => e.kind === 'reword_confirmed');
    expect(rw).toHaveLength(1);
    expect(rw[0]!.stringId).toBeNull();
  });

  it('writes and lists orphan notes', async () => {
    const r = must(await q.setOrphanNote({ courseCode: code('OR'), role: 'develops', statementHash: `h-${tag}-or`, statement: 'an orphan', reason: 'covered in the lab', by: 't' }));
    expect(r.graph).toBeDefined();
    expect(await q.setOrphanNote({ courseCode: code('OR'), role: 'develops', statementHash: `h-${tag}-or`, statement: 'an orphan', reason: ' ', by: 't' }))
      .toMatchObject({ ok: false, status: 400, error: 'A reason is required.' });
    must(await q.setOrphanNote({ courseCode: code('OR'), role: 'develops', statementHash: `h-${tag}-or`, statement: 'an orphan', reason: 'updated reason', by: 't2' }));
    const notes = await q.listOrphanNotes([code('OR')]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ reason: 'updated reason', by: 't2', role: 'develops' });
    expect(await q.listOrphanNotes([])).toEqual([]);
  });

  it('merge rules hold after later writes (extend end, remove end, remove merge point, unlock a target); extend at start still works', async () => {
    const na = name('gA'); const nb = name('gB');
    const a = await lock(na, [['GA1', 1], ['GA2', 1]]);
    const b = await lock(nb, [['GB0', 1], ['GA2', 1], ['GB3', 1]]);
    const A = mine(a, na); const B = mine(b, nb);
    must(await q.mergeString({ id: A.id, version: 1, into: B.id, reason: 'same', by: 't' }));
    // a: extend at the end of a merged string
    expect(await q.extendString({ id: A.id, version: 2, at: 'end', point: pt('GA9', 1), why: 'w', by: 't' }))
      .toMatchObject({ ok: false, status: 400, error: 'This string merges into another. Unmerge it first.' });
    // b: remove the end point of a merged string (three-point string C merging into a target)
    const a3 = must(await q.lockString({ name: name('gA3'), description: 'd', points: [pt('GC1', 1), pt('GC2', 1), pt('GC3', 1)], whys: ['w', 'w'], by: 't' }));
    const C = mine(a3, a3.graph.strings.find((x) => x.name.includes(' gA3 '))!.name);
    const target = await lock(name('gT'), [['GX', 1], ['GC3', 1]]);
    const targetId = target.graph.strings.find((x) => x.name.includes(' gT '))!.id;
    must(await q.mergeString({ id: C.id, version: 1, into: targetId, reason: 'r', by: 't' }));
    expect(await q.removePoint({ id: C.id, version: 2, position: 2, reason: 'r', by: 't' }))
      .toMatchObject({ ok: false, status: 400, error: 'This string merges into another. Unmerge it first.' });
    // c: remove the skill where another string merges in (B's middle point GA2)
    expect(await q.removePoint({ id: B.id, version: 1, position: 1, reason: 'r', by: 't' }))
      .toMatchObject({ ok: false, status: 400, error: 'Another string merges in at this skill. Unmerge it first.' });
    // d: unlock a merge target
    expect(await q.unlockString({ id: B.id, version: 1, reason: 'r', by: 't' }))
      .toMatchObject({ ok: false, status: 400, error: 'Other strings merge into this one. Unmerge them first.' });
    // extend at start of a merged string is fine
    const ok = must(await q.extendString({ id: A.id, version: 2, at: 'start', point: pt('GA0', 1), why: 'w', by: 't' }));
    expect(ok.graph.strings.find((x) => x.id === A.id)?.path).toHaveLength(3);
  });

  it('an unlocked string whose name an active string took can be renamed and then relocked', async () => {
    const nm = name('rl');
    const a = await lock(nm, [['RL1', 1], ['RL2', 1]]);
    const id = mine(a, nm).id;
    must(await q.unlockString({ id, version: 1, reason: 'r', by: 't' }));
    must(await q.lockString({ name: nm, description: 'd', points: [pt('RL3', 1), pt('RL4', 1)], whys: ['w'], by: 't' }));
    expect(await q.relockString({ id, version: 2, by: 't' })).toMatchObject({ ok: false, status: 409 });
    const nn = name('rl-new');
    must(await q.renameString({ id, version: 2, name: nn, by: 't' }));
    const re = must(await q.relockString({ id, version: 3, by: 't' }));
    expect(re.graph.strings.find((x) => x.id === id)).toMatchObject({ status: 'active', name: nn });
  });

  it('a middle removal keeps the why of an existing prev-to-next link and notes nothing', async () => {
    const nm = name('kw');
    const a = await lock(nm, [['KW1', 1], ['KW2', 1], ['KW3', 1]]);
    must(await q.lockString({ name: name('kw-direct'), description: 'd', points: [pt('KW1', 1), pt('KW3', 1)], whys: ['direct why'], by: 't' }));
    const src = mine(a, nm);
    const r = must(await q.removePoint({ id: src.id, version: 1, position: 1, reason: 'r', by: 't' }));
    expect(r.notes).toEqual([]);
    expect(r.graph.links.find((l) => l.from === src.path[0] && l.to === src.path[2])?.why).toBe('direct why');
  });

  it('a refused write leaves no event row', async () => {
    const nm = name('noev');
    const a = await lock(nm, [['NE1', 1], ['NE2', 1]]);
    const id = mine(a, nm).id;
    const count = async () => (await dbm.db.select().from(s.curriculumStringEvents).where(orm.eq(s.curriculumStringEvents.stringId, id))).length;
    const before = await count();
    expect((await q.renameString({ id, version: 99, name: name('x'), by: 't' })).ok).toBe(false);
    expect((await q.unlockString({ id, version: 1, reason: '', by: 't' })).ok).toBe(false);
    expect(await count()).toBe(before);
  });

  it('branch rejects a non-integer position', async () => {
    const nm = name('bint');
    const a = await lock(nm, [['BI1', 1], ['BI2', 1], ['BI3', 1]]);
    const r = await q.branchString({ fromId: mine(a, nm).id, version: 1, atPosition: 0.5, name: name('bi-c'), description: 'd', point: pt('BI4', 1), why: 'w', by: 't' });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('relock re-checks the merge; unmerge works on an unlocked string so it is never a dead end', async () => {
    const na = name('rmA'); const nb = name('rmB');
    const a = await lock(na, [['RMA', 1], ['RMJ', 1]]);
    const b = await lock(nb, [['RMB0', 1], ['RMJ', 1], ['RMB2', 1]]);
    const A = mine(a, na); const B = mine(b, nb);
    must(await q.mergeString({ id: A.id, version: 1, into: B.id, reason: 'same', by: 't' }));
    must(await q.unlockString({ id: A.id, version: 2, reason: 'park', by: 't' }));
    must(await q.removePoint({ id: B.id, version: 1, position: 1, reason: 'gone', by: 't' }));
    expect(await q.relockString({ id: A.id, version: 3, by: 't' }))
      .toMatchObject({ ok: false, status: 400, error: "This string's merge no longer holds. Unmerge it first." });
    must(await q.unmergeString({ id: A.id, version: 3, reason: 'target moved', by: 't' }));
    const re = must(await q.relockString({ id: A.id, version: 4, by: 't' }));
    expect(re.graph.strings.find((x) => x.id === A.id)).toMatchObject({ status: 'active', mergedInto: null });
  });

  it('404s on an unknown string', async () => {
    const r = await q.renameString({ id: '00000000-0000-4000-8000-0000000000aa', version: 1, name: name('none'), by: 't' });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it('lock refuses fewer than two skills and a mismatched why list', async () => {
    expect(await q.lockString({ name: name('one'), description: 'd', points: [pt('ONE', 1)], whys: [], by: 't' })).toMatchObject({ ok: false, status: 400 });
    expect(await q.lockString({ name: name('bad'), description: 'd', points: [pt('BD', 1), pt('BD', 2)], whys: [], by: 't' })).toMatchObject({ ok: false, status: 400 });
    expect(await q.lockString({ name: name('dup'), description: 'd', points: [pt('DP', 1), pt('DP', 1)], whys: ['w'], by: 't' })).toMatchObject({ ok: false, status: 400 });
  });
});
