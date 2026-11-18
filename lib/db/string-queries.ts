/**
 * Locked skill strings: reads and writes (migration 0071). This is the only code that writes the shared,
 * department-wide string record. Every write runs in one transaction that also inserts its event row,
 * checks the optimistic `version`, bumps it, and re-checks the resulting path before committing.
 */
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  curriculumStringEvents, curriculumStringPath, curriculumStrings, skillOrphanNotes, stringLinks, stringPoints,
} from '@/lib/db/schema';
import { checkBranch, checkMerge, checkPath, MSG } from '@/lib/builder/strings/rules';
import type { EventRow, LinkRow, OrphanNote, PointRow, Role, StringGraph, StringRow } from '@/lib/builder/strings/types';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export type PointInput = Omit<PointRow, 'id' | 'term'>;
export type WriteResult =
  | { ok: true; graph: StringGraph; /** Things the caller should tell the user (for example a supplied why that was ignored). */ notes: string[] }
  | { ok: false; status: 400 | 404 | 409; error: string; current?: StringRow };

const NAME_TAKEN = 'A string with that name already exists.';
const REASON_REQUIRED = 'A reason is required.';
const WHY_REQUIRED = 'A reason for the link is required.';
const STALE = 'This string changed since you loaded it.';
const MERGED_END = 'This string merges into another. Unmerge it first.';
const MERGES_IN_HERE = 'Another string merges in at this skill. Unmerge it first.';
const MERGED_INTO_THIS = 'Other strings merge into this one. Unmerge them first.';
const LOCKED_ONLY = 'That string is unlocked.';

/** Thrown inside a transaction to abort it and return a refusal. */
class Refuse extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly error: string, readonly current?: StringRow) { super(error); }
}

// ---------------------------------------------------------------- reads

const iso = (d: Date | null) => (d ? d.toISOString() : '');

/**
 * The strings (active only unless includeUnlocked) through the given courses, with all their points, the links
 * among those points, and their events. Without courseCodes, every string.
 */
export async function loadGraph(opts: { courseCodes?: string[]; includeUnlocked?: boolean } = {}, exec: Exec = db): Promise<StringGraph> {
  const empty: StringGraph = { strings: [], points: {}, links: [], events: [] };
  const { courseCodes, includeUnlocked = false } = opts;
  if (courseCodes && courseCodes.length === 0) return empty;

  const conds = [];
  if (!includeUnlocked) conds.push(eq(curriculumStrings.status, 'active'));
  if (courseCodes) {
    conds.push(inArray(
      curriculumStrings.id,
      exec.select({ id: curriculumStringPath.stringId }).from(curriculumStringPath)
        .innerJoin(stringPoints, eq(stringPoints.id, curriculumStringPath.pointId))
        .where(inArray(stringPoints.courseCode, courseCodes)),
    ));
  }
  const rows = await exec.select().from(curriculumStrings).where(conds.length ? and(...conds) : undefined).orderBy(asc(curriculumStrings.createdAt), asc(curriculumStrings.id));
  if (rows.length === 0) return empty;
  const stringIds = rows.map((r) => r.id);

  const pathRows = await exec.select().from(curriculumStringPath).where(inArray(curriculumStringPath.stringId, stringIds)).orderBy(asc(curriculumStringPath.position));
  const pathOf = new Map<string, string[]>();
  for (const p of pathRows) (pathOf.get(p.stringId) ?? pathOf.set(p.stringId, []).get(p.stringId)!).push(p.pointId);

  const pointIds = [...new Set(pathRows.map((p) => p.pointId))];
  const pointRows = pointIds.length ? await exec.select().from(stringPoints).where(inArray(stringPoints.id, pointIds)) : [];
  const linkRows = pointIds.length
    ? await exec.select().from(stringLinks).where(and(inArray(stringLinks.fromPoint, pointIds), inArray(stringLinks.toPoint, pointIds)))
    : [];
  const eventRows = await exec.select().from(curriculumStringEvents)
    .where(pointIds.length
      ? or(inArray(curriculumStringEvents.stringId, stringIds), inArray(curriculumStringEvents.pointId, pointIds))
      : inArray(curriculumStringEvents.stringId, stringIds))
    .orderBy(desc(curriculumStringEvents.at), desc(curriculumStringEvents.id));

  const points: Record<string, PointRow> = {};
  for (const p of pointRows) {
    points[p.id] = {
      id: p.id, courseCode: p.courseCode, role: p.role, statement: p.statement, statementHash: p.statementHash,
      snapshotId: p.snapshotId, k: p.k, u: p.u, d: p.d, term: p.term,
    };
  }
  return {
    strings: rows.map((r) => toStringRow(r, pathOf.get(r.id) ?? [])),
    points,
    links: linkRows.map((l): LinkRow => ({ id: l.id, from: l.fromPoint, to: l.toPoint, why: l.why, createdBy: l.createdBy, createdAt: iso(l.createdAt) })),
    events: eventRows.map((e): EventRow => ({
      id: e.id, stringId: e.stringId, pointId: e.pointId, kind: e.kind, at: iso(e.at), by: e.by, reason: e.reason, before: e.before ?? null, after: e.after ?? null,
    })),
  };
}

function toStringRow(r: typeof curriculumStrings.$inferSelect, path: string[]): StringRow {
  return { id: r.id, name: r.name, description: r.description, status: r.status, endNote: r.endNote, mergedInto: r.mergedInto, version: r.version, path };
}

export async function listOrphanNotes(courseCodes: string[]): Promise<OrphanNote[]> {
  if (courseCodes.length === 0) return [];
  const rows = await db.select().from(skillOrphanNotes).where(inArray(skillOrphanNotes.courseCode, courseCodes)).orderBy(asc(skillOrphanNotes.courseCode), asc(skillOrphanNotes.statementHash));
  return rows.map((r) => ({ courseCode: r.courseCode, role: r.role, statementHash: r.statementHash, statement: r.statement, reason: r.reason, by: r.by, at: iso(r.at) }));
}

// ---------------------------------------------------------------- transaction plumbing

/** Postgres error details, whether or not the driver wrapped it (drizzle puts the original on `cause`). */
function pgError(e: unknown): { code?: string; constraint?: string } {
  for (let cur: unknown = e, i = 0; cur && typeof cur === 'object' && i < 4; i++) {
    const o = cur as { code?: string; constraint?: string; cause?: unknown };
    if (typeof o.code === 'string') return { code: o.code, constraint: o.constraint };
    cur = o.cause;
  }
  return {};
}

interface Done { courseCodes: string[]; notes?: string[] }

/** Run `fn` in one transaction, then load the graph for the courses it touched (still inside the transaction). */
async function write(fn: (tx: Tx) => Promise<Done>, stringId?: string): Promise<WriteResult> {
  try {
    return await db.transaction(async (tx) => {
      const done = await fn(tx);
      const graph = await loadGraph({ courseCodes: [...new Set(done.courseCodes)], includeUnlocked: true }, tx);
      return { ok: true as const, graph, notes: done.notes ?? [] };
    });
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, status: e.status, error: e.error, current: e.current };
    const pg = pgError(e);
    if (pg.code === '40P01' || pg.code === '40001') {
      const current = stringId ? (await getString(db, stringId)) ?? undefined : undefined;
      return { ok: false, status: 409, error: STALE, current };
    }
    if (pg.code === '23505' && pg.constraint === 'idx_curriculum_strings_active_name') return { ok: false, status: 409, error: NAME_TAKEN };
    if (pg.code === '23505' && pg.constraint === 'string_points_unique') return { ok: false, status: 409, error: 'Another string point already holds that skill.' };
    throw e;
  }
}

async function getString(tx: Exec, id: string, lock = false): Promise<StringRow | null> {
  const q = tx.select().from(curriculumStrings).where(eq(curriculumStrings.id, id));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) return null;
  const path = await tx.select({ p: curriculumStringPath.pointId }).from(curriculumStringPath).where(eq(curriculumStringPath.stringId, id)).orderBy(asc(curriculumStringPath.position));
  return toStringRow(row, path.map((r) => r.p));
}

/** Load a string for a write: 404 if missing, 409 with `current` if the version moved on, 400 if unlocked and the write needs it active. */
async function loadForWrite(tx: Tx, id: string, version: number, opts: { active?: boolean } = { active: true }): Promise<StringRow> {
  const cur = await getString(tx, id, true);
  if (!cur) throw new Refuse(404, MSG.notFound);
  if (cur.version !== version) throw new Refuse(409, STALE, cur);
  if (opts.active !== false && cur.status !== 'active') throw new Refuse(400, LOCKED_ONLY);
  return cur;
}

/** UPDATE ... WHERE id AND version, bumping version. Aborts the transaction if no row moved. */
async function bump(tx: Tx, id: string, version: number, by: string, set: Partial<typeof curriculumStrings.$inferInsert> = {}): Promise<void> {
  const rows = await tx.update(curriculumStrings)
    .set({ ...set, updatedBy: by, updatedAt: new Date(), version: version + 1 })
    .where(and(eq(curriculumStrings.id, id), eq(curriculumStrings.version, version)))
    .returning({ id: curriculumStrings.id });
  if (rows.length === 0) {
    const cur = await getString(tx, id);
    throw cur ? new Refuse(409, STALE, cur) : new Refuse(404, MSG.notFound);
  }
}

async function addEvent(tx: Tx, e: { stringId?: string | null; pointId?: string | null; kind: string; by: string; reason?: string | null; before?: unknown; after?: unknown }): Promise<void> {
  await tx.insert(curriculumStringEvents).values({
    stringId: e.stringId ?? null, pointId: e.pointId ?? null, kind: e.kind, by: e.by, reason: e.reason ?? null,
    before: (e.before ?? null) as never, after: (e.after ?? null) as never,
  });
}

async function writePath(tx: Tx, stringId: string, path: string[]): Promise<void> {
  await tx.delete(curriculumStringPath).where(eq(curriculumStringPath.stringId, stringId));
  await tx.insert(curriculumStringPath).values(path.map((pointId, position) => ({ stringId, position, pointId })));
}

/** Re-check the resulting path against the links as they stand inside this transaction. */
async function assertPath(tx: Tx, path: string[]): Promise<void> {
  const links = path.length
    ? await tx.select().from(stringLinks).where(and(inArray(stringLinks.fromPoint, path), inArray(stringLinks.toPoint, path)))
    : [];
  const g: StringGraph = {
    strings: [], points: {}, events: [],
    links: links.map((l) => ({ id: l.id, from: l.fromPoint, to: l.toPoint, why: l.why, createdBy: l.createdBy, createdAt: iso(l.createdAt) })),
  };
  const bad = checkPath(g, path);
  if (bad) throw new Refuse(400, bad);
}

/** Record a `joined` event when `pointId` is also on some other active string. */
async function recordJoin(tx: Tx, stringId: string, pointId: string, by: string): Promise<void> {
  const others = await tx.selectDistinct({ id: curriculumStringPath.stringId }).from(curriculumStringPath)
    .innerJoin(curriculumStrings, eq(curriculumStrings.id, curriculumStringPath.stringId))
    .where(and(eq(curriculumStringPath.pointId, pointId), ne(curriculumStringPath.stringId, stringId), eq(curriculumStrings.status, 'active')));
  if (others.length) await addEvent(tx, { stringId, pointId, kind: 'joined', by, after: { with: others.map((o) => o.id).sort() } });
}

/** Active strings that merge into `id`. */
async function mergersOf(tx: Tx, id: string): Promise<StringRow[]> {
  const rows = await tx.select({ id: curriculumStrings.id }).from(curriculumStrings)
    .where(and(eq(curriculumStrings.mergedInto, id), eq(curriculumStrings.status, 'active')));
  const out: StringRow[] = [];
  for (const r of rows) { const s = await getString(tx, r.id); if (s) out.push(s); }
  return out;
}

async function courseCodesOf(tx: Exec, pointIds: string[]): Promise<string[]> {
  if (pointIds.length === 0) return [];
  const rows = await tx.select({ c: stringPoints.courseCode }).from(stringPoints).where(inArray(stringPoints.id, pointIds));
  return rows.map((r) => r.c);
}

async function assertNameFree(tx: Exec, name: string, exceptId?: string): Promise<void> {
  const clash = await tx.select({ id: curriculumStrings.id }).from(curriculumStrings)
    .where(and(eq(curriculumStrings.status, 'active'), sql`lower(${curriculumStrings.name}) = lower(${name})`, exceptId ? ne(curriculumStrings.id, exceptId) : undefined))
    .limit(1);
  if (clash.length) throw new Refuse(409, NAME_TAKEN);
}

function requireName(name: string): string {
  const n = name.trim();
  if (!n) throw new Refuse(400, 'A name is required.');
  return n;
}

function requireReason(reason: string | null | undefined): string {
  const r = (reason ?? '').trim();
  if (!r) throw new Refuse(400, REASON_REQUIRED);
  return r;
}

function requireWhy(why: string): string {
  const w = why.trim();
  if (!w) throw new Refuse(400, WHY_REQUIRED);
  return w;
}

// ---------------------------------------------------------------- points and links

/** Insert the point, or return the id of the one that already holds (course, role, statement hash). */
export async function upsertPoint(tx: Exec, p: PointInput & { by: string }): Promise<string> {
  const [ins] = await tx.insert(stringPoints).values({
    courseCode: p.courseCode, role: p.role, statement: p.statement, statementHash: p.statementHash,
    snapshotId: p.snapshotId, k: p.k, u: p.u, d: p.d, createdBy: p.by,
  }).onConflictDoNothing({ target: [stringPoints.courseCode, stringPoints.role, stringPoints.statementHash] }).returning({ id: stringPoints.id });
  if (ins) return ins.id;
  const [existing] = await tx.select({ id: stringPoints.id }).from(stringPoints)
    .where(and(eq(stringPoints.courseCode, p.courseCode), eq(stringPoints.role, p.role), eq(stringPoints.statementHash, p.statementHash)));
  return existing!.id;
}

/**
 * Insert the link, or reuse the existing one for (from, to). An existing link keeps its why;
 * `whyIgnored` is true when a different why was supplied.
 */
export async function upsertLink(tx: Exec, from: string, to: string, why: string | null, by: string): Promise<{ id: string; created: boolean; whyIgnored: boolean }> {
  const [ins] = await tx.insert(stringLinks).values({ fromPoint: from, toPoint: to, why, createdBy: by })
    .onConflictDoNothing({ target: [stringLinks.fromPoint, stringLinks.toPoint] }).returning({ id: stringLinks.id });
  if (ins) return { id: ins.id, created: true, whyIgnored: false };
  const [existing] = await tx.select().from(stringLinks).where(and(eq(stringLinks.fromPoint, from), eq(stringLinks.toPoint, to)));
  return { id: existing!.id, created: false, whyIgnored: why !== null && why !== existing!.why };
}

async function link(tx: Tx, from: string, to: string, why: string | null, by: string, notes: string[]): Promise<void> {
  const r = await upsertLink(tx, from, to, why, by);
  if (r.whyIgnored) notes.push('Those two skills were already linked; the existing reason was kept.');
}

// ---------------------------------------------------------------- string writes

export async function lockString(input: { name: string; description: string; points: PointInput[]; whys: string[]; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const name = requireName(input.name);
    if (input.points.length < 2) throw new Refuse(400, MSG.tooShort);
    if (input.whys.length !== input.points.length - 1) throw new Refuse(400, 'Each link needs a reason.');
    const whys = input.whys.map(requireWhy);
    await assertNameFree(tx, name);
    const path: string[] = [];
    for (const p of input.points) path.push(await upsertPoint(tx, { ...p, by: input.by }));
    if (new Set(path).size !== path.length) throw new Refuse(400, MSG.repeated);
    const notes: string[] = [];
    for (let i = 0; i < path.length - 1; i++) await link(tx, path[i]!, path[i + 1]!, whys[i]!, input.by, notes);
    await assertPath(tx, path);
    const [row] = await tx.insert(curriculumStrings).values({
      name, description: input.description, status: 'active', createdBy: input.by, updatedBy: input.by,
    }).returning({ id: curriculumStrings.id });
    await writePath(tx, row!.id, path);
    await addEvent(tx, { stringId: row!.id, kind: 'locked', by: input.by, after: { name, description: input.description, path } });
    for (const pid of path) await recordJoin(tx, row!.id, pid, input.by);
    return { courseCodes: await courseCodesOf(tx, path), notes };
  });
}

export async function extendString(input: { id: string; version: number; at: 'start' | 'end'; point: PointInput; why: string; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const why = requireWhy(input.why);
    const cur = await loadForWrite(tx, input.id, input.version);
    if (input.at === 'end' && cur.mergedInto) throw new Refuse(400, MERGED_END);
    const pointId = await upsertPoint(tx, { ...input.point, by: input.by });
    const path = input.at === 'end' ? [...cur.path, pointId] : [pointId, ...cur.path];
    if (new Set(path).size !== path.length) throw new Refuse(400, MSG.repeated);
    const notes: string[] = [];
    if (input.at === 'end') await link(tx, cur.path[cur.path.length - 1]!, pointId, why, input.by, notes);
    else await link(tx, pointId, cur.path[0]!, why, input.by, notes);
    await assertPath(tx, path);
    await bump(tx, cur.id, input.version, input.by);
    await writePath(tx, cur.id, path);
    await addEvent(tx, { stringId: cur.id, pointId, kind: 'extended', by: input.by, before: { path: cur.path }, after: { path, at: input.at } });
    await recordJoin(tx, cur.id, pointId, input.by);
    return { courseCodes: await courseCodesOf(tx, path), notes };
  }, input.id);
}

export async function branchString(input: {
  fromId: string; version: number; atPosition: number; name: string; description: string; point: PointInput; why: string; by: string;
}): Promise<WriteResult> {
  return write(async (tx) => {
    const name = requireName(input.name);
    const why = requireWhy(input.why);
    const from = await loadForWrite(tx, input.fromId, input.version);
    if (!Number.isInteger(input.atPosition)) throw new Refuse(400, 'No skill at that position.');
    const bad = checkBranch({ strings: [from], points: {}, links: [], events: [] }, from.id, input.atPosition);
    if (bad) throw new Refuse(400, bad);
    await assertNameFree(tx, name);
    const pointId = await upsertPoint(tx, { ...input.point, by: input.by });
    const path = [...from.path.slice(0, input.atPosition + 1), pointId];
    if (new Set(path).size !== path.length) throw new Refuse(400, MSG.repeated);
    const notes: string[] = [];
    await link(tx, path[path.length - 2]!, pointId, why, input.by, notes);
    await assertPath(tx, path);
    const [row] = await tx.insert(curriculumStrings).values({
      name, description: input.description, status: 'active', createdBy: input.by, updatedBy: input.by,
    }).returning({ id: curriculumStrings.id });
    await writePath(tx, row!.id, path);
    await addEvent(tx, { stringId: row!.id, pointId, kind: 'branched', by: input.by, before: { fromId: from.id, atPosition: input.atPosition }, after: { name, path } });
    await recordJoin(tx, row!.id, pointId, input.by);
    return { courseCodes: [...await courseCodesOf(tx, path), ...await courseCodesOf(tx, from.path)], notes };
  }, input.fromId);
}

export async function mergeString(input: { id: string; version: number; into: string; reason: string; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const cur = await loadForWrite(tx, input.id, input.version);
    if (cur.mergedInto) throw new Refuse(400, 'That string already merges into another string.');
    const graph = await loadGraph({ includeUnlocked: true }, tx);
    const bad = checkMerge(graph, input.id, input.into);
    if (bad) throw new Refuse(bad === MSG.notFound ? 404 : 400, bad);
    const reason = input.reason.trim() || null;
    await bump(tx, cur.id, input.version, input.by, { mergedInto: input.into, mergedBy: input.by, mergedAt: new Date(), mergeReason: reason });
    await addEvent(tx, { stringId: cur.id, kind: 'merged', by: input.by, reason, after: { into: input.into } });
    const target = graph.strings.find((s) => s.id === input.into)!;
    return { courseCodes: await courseCodesOf(tx, [...cur.path, ...target.path]) };
  }, input.id);
}

export async function unmergeString(input: { id: string; version: number; reason: string; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const reason = requireReason(input.reason);
    const cur = await loadForWrite(tx, input.id, input.version);
    if (!cur.mergedInto) throw new Refuse(400, "That string isn't merged into another.");
    await bump(tx, cur.id, input.version, input.by, { mergedInto: null, mergedBy: null, mergedAt: null, mergeReason: null });
    await addEvent(tx, { stringId: cur.id, kind: 'unmerged', by: input.by, reason, before: { into: cur.mergedInto } });
    return { courseCodes: await courseCodesOf(tx, cur.path) };
  }, input.id);
}

export async function removePoint(input: { id: string; version: number; position: number; reason: string; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const reason = requireReason(input.reason);
    const cur = await loadForWrite(tx, input.id, input.version);
    const { position } = input;
    if (!Number.isInteger(position) || position < 0 || position >= cur.path.length) throw new Refuse(400, 'No skill at that position.');
    if (cur.path.length <= 2) throw new Refuse(400, 'A string needs at least two skills. Unlock it instead.');
    const removed = cur.path[position]!;
    if (cur.mergedInto && position === cur.path.length - 1) throw new Refuse(400, MERGED_END);
    for (const m of await mergersOf(tx, cur.id)) {
      if (m.path[m.path.length - 1] === removed) throw new Refuse(400, MERGES_IN_HERE);
    }
    const path = cur.path.filter((_, i) => i !== position);
    const [pt] = await tx.select({ c: stringPoints.courseCode }).from(stringPoints).where(eq(stringPoints.id, removed));
    const middle = position > 0 && position < cur.path.length - 1;
    if (middle) await upsertLink(tx, cur.path[position - 1]!, cur.path[position + 1]!, null, input.by);
    await assertPath(tx, path);
    await bump(tx, cur.id, input.version, input.by);
    await writePath(tx, cur.id, path);
    await addEvent(tx, {
      stringId: cur.id, pointId: removed, kind: 'point_removed', by: input.by, reason,
      before: { path: cur.path, courseCode: pt!.c }, after: { path },
    });
    return { courseCodes: await courseCodesOf(tx, [...cur.path]) };
  }, input.id);
}

export async function setLinkWhy(input: { linkId: string; why: string; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const why = requireWhy(input.why);
    const [l] = await tx.select().from(stringLinks).where(eq(stringLinks.id, input.linkId)).for('update');
    if (!l) throw new Refuse(404, 'Link not found.');
    await tx.update(stringLinks).set({ why }).where(eq(stringLinks.id, l.id));
    await addEvent(tx, { pointId: l.fromPoint, kind: 'link_why', by: input.by, before: { linkId: l.id, why: l.why }, after: { linkId: l.id, why, from: l.fromPoint, to: l.toPoint } });
    return { courseCodes: await courseCodesOf(tx, [l.fromPoint, l.toPoint]) };
  });
}

export async function setEndNote(input: { id: string; version: number; note: string | null; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const cur = await loadForWrite(tx, input.id, input.version);
    const note = input.note?.trim() || null;
    await bump(tx, cur.id, input.version, input.by, { endNote: note, endBy: note ? input.by : null, endAt: note ? new Date() : null });
    await addEvent(tx, { stringId: cur.id, kind: 'end_note', by: input.by, before: { note: cur.endNote }, after: { note } });
    return { courseCodes: await courseCodesOf(tx, cur.path) };
  }, input.id);
}

export async function renameString(input: { id: string; version: number; name: string; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const name = requireName(input.name);
    const cur = await loadForWrite(tx, input.id, input.version, { active: false });
    await assertNameFree(tx, name, cur.id);
    await bump(tx, cur.id, input.version, input.by, { name });
    await addEvent(tx, { stringId: cur.id, kind: 'renamed', by: input.by, before: { name: cur.name }, after: { name } });
    return { courseCodes: await courseCodesOf(tx, cur.path) };
  }, input.id);
}

export async function unlockString(input: { id: string; version: number; reason: string; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const reason = requireReason(input.reason);
    const cur = await loadForWrite(tx, input.id, input.version);
    if ((await mergersOf(tx, cur.id)).length) throw new Refuse(400, MERGED_INTO_THIS);
    await bump(tx, cur.id, input.version, input.by, { status: 'unlocked' });
    await addEvent(tx, { stringId: cur.id, kind: 'unlocked', by: input.by, reason });
    return { courseCodes: await courseCodesOf(tx, cur.path) };
  }, input.id);
}

export async function relockString(input: { id: string; version: number; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const cur = await loadForWrite(tx, input.id, input.version, { active: false });
    if (cur.status !== 'unlocked') throw new Refuse(400, 'That string is already locked.');
    await assertNameFree(tx, cur.name, cur.id);
    await assertPath(tx, cur.path);
    await bump(tx, cur.id, input.version, input.by, { status: 'active' });
    await addEvent(tx, { stringId: cur.id, kind: 'relocked', by: input.by });
    return { courseCodes: await courseCodesOf(tx, cur.path) };
  }, input.id);
}

// ---------------------------------------------------------------- points and notes

/** Accept a reword: the point now says `candidate`. Refused when another point already holds that (course, role, hash). */
export async function confirmReword(input: {
  pointId: string; candidate: { statement: string; hash: string }; snapshotId: string | null; depth?: { k: number | null; u: number | null; d: number | null }; by: string;
}): Promise<WriteResult> {
  return write(async (tx) => {
    const [pt] = await tx.select().from(stringPoints).where(eq(stringPoints.id, input.pointId)).for('update');
    if (!pt) throw new Refuse(404, 'Point not found.');
    const clash = await tx.select({ id: stringPoints.id }).from(stringPoints).where(and(
      eq(stringPoints.courseCode, pt.courseCode), eq(stringPoints.role, pt.role), eq(stringPoints.statementHash, input.candidate.hash), ne(stringPoints.id, pt.id),
    )).limit(1);
    if (clash.length) throw new Refuse(409, 'Another string point already holds that skill.');
    const next = { statement: input.candidate.statement, statementHash: input.candidate.hash, snapshotId: input.snapshotId, k: input.depth ? input.depth.k : pt.k, u: input.depth ? input.depth.u : pt.u, d: input.depth ? input.depth.d : pt.d };
    await tx.update(stringPoints).set(next).where(eq(stringPoints.id, pt.id));
    await addEvent(tx, {
      pointId: pt.id, kind: 'reword_confirmed', by: input.by,
      before: { statement: pt.statement, hash: pt.statementHash, snapshotId: pt.snapshotId, k: pt.k, u: pt.u, d: pt.d },
      after: { statement: next.statement, hash: next.statementHash, snapshotId: next.snapshotId, k: next.k, u: next.u, d: next.d },
    });
    return { courseCodes: [pt.courseCode] };
  });
}

export async function setOrphanNote(input: { courseCode: string; role: Role; statementHash: string; statement: string; reason: string; by: string }): Promise<WriteResult> {
  return write(async (tx) => {
    const reason = requireReason(input.reason);
    await tx.insert(skillOrphanNotes).values({
      courseCode: input.courseCode, role: input.role, statementHash: input.statementHash, statement: input.statement, reason, by: input.by,
    }).onConflictDoUpdate({
      target: [skillOrphanNotes.courseCode, skillOrphanNotes.role, skillOrphanNotes.statementHash],
      set: { statement: input.statement, reason, by: input.by, at: new Date() },
    });
    await addEvent(tx, { kind: 'orphan_note', by: input.by, reason, after: { courseCode: input.courseCode, role: input.role, statementHash: input.statementHash, statement: input.statement } });
    return { courseCodes: [input.courseCode] };
  });
}
