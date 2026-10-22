/**
 * Project → course skill → catalog competency → O*NET trail: database reads
 * (spec docs/superpowers/specs/2026-10-22-project-skill-trail-design.md).
 * Links 1–2 come from the snapshot's profile and the coverage scorer's
 * matched_competency; link 3 compares a course statement's embedding
 * (item_embeddings kind course_skill) with the matched competency's core and
 * related bundle items. Embedding never blocks a caller.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { itemEmbeddings } from '@/lib/db/schema';
import { embedMissing, type EmbedItem, type Executor } from '@/lib/db/bundle-queries';
import { textHash } from '@/lib/catalog/bundles';
import { taskGroupKey } from '@/lib/catalog/shortlist';
import { embedBatch, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { PROGRAM_VISIBLE_SQL } from '@/lib/courses/program-visibility';
import {
  buildProjectTrail, nearestItems, normalizeStatement,
  type Candidate, type TrailCell, type TrailItem, type TrailProject,
} from '@/lib/catalog/project-trail';

const statementRef = (s: string) => textHash(normalizeStatement(s));

/** One embedding item per distinct (normalized) course statement. */
export function courseSkillItems(statements: string[]): EmbedItem[] {
  const out = new Map<string, EmbedItem>();
  for (const s of statements) {
    if (!s.trim()) continue;
    const ref = statementRef(s);
    if (!out.has(ref)) out.set(ref, { kind: 'course_skill', ref, text: s.trim() });
  }
  return [...out.values()];
}

/** Newest vector per ref for one kind and model. */
async function readVectorsByRef(ex: Executor, kind: EmbedItem['kind'], refs: string[], model: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (refs.length === 0) return out;
  const rows = await ex.select({ ref: itemEmbeddings.ref, vector: itemEmbeddings.vector })
    .from(itemEmbeddings)
    .where(and(eq(itemEmbeddings.kind, kind), eq(itemEmbeddings.model, model), inArray(itemEmbeddings.ref, [...new Set(refs)])))
    .orderBy(desc(itemEmbeddings.createdAt));
  for (const r of rows) if (!out.has(r.ref)) out.set(r.ref, r.vector);
  return out;
}

interface SnapshotStatements { statements: string[]; projects: unknown; projectNamed: string[] }

async function readSnapshot(ex: Executor, snapshotId: string): Promise<SnapshotStatements | null> {
  const row = (await ex.execute(sql`SELECT profile FROM course_capture_snapshots WHERE id = ${snapshotId}`)).rows[0] as { profile: unknown } | undefined;
  if (!row) return null;
  const p = (row.profile ?? {}) as { competencies?: unknown; major_projects?: unknown };
  const statements = Array.isArray(p.competencies)
    ? p.competencies.map(c => (c as { statement?: unknown })?.statement).filter((s): s is string => typeof s === 'string')
    : [];
  const projectNamed = Array.isArray(p.major_projects)
    ? p.major_projects.flatMap(pr => {
      const cs = (pr as { competencies?: unknown })?.competencies;
      return Array.isArray(cs) ? cs.filter((s): s is string => typeof s === 'string') : [];
    })
    : [];
  return { statements, projects: p.major_projects, projectNamed };
}

/** Embeds the snapshot's course statements that have no vector yet. Never throws. */
export async function ensureCourseSkillEmbeddings(
  ex: Executor,
  snapshotId: string,
  embed: (texts: string[]) => Promise<number[][]> = texts => embedBatch(texts),
): Promise<{ ok: boolean; embedded: number }> {
  try {
    const snap = await readSnapshot(ex, snapshotId);
    if (!snap) return { ok: true, embedded: 0 };
    const items = courseSkillItems([...snap.statements, ...snap.projectNamed]);
    const r = await embedMissing(ex, items, DEFAULT_EMBEDDING_MODEL, embed);
    return { ok: true, embedded: r.embedded };
  } catch (err) {
    console.warn(`[project-trail] course skill embedding for ${snapshotId} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, embedded: 0 };
  }
}

/** Core/related, confirmed/proposed O*NET members of each competency, with vectors; one entry per item (confirmed wins). */
async function readCandidates(ex: Executor, competencyIds: string[]): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>();
  if (competencyIds.length === 0) return out;
  const rows = (await ex.execute(sql`
    SELECT bundle_id AS c, source, external_id AS id, external_label AS label, status
    FROM bundle_members
    WHERE bundle_id IN (${sql.join(competencyIds.map(c => sql`${c}`), sql`, `)})
      AND status IN ('confirmed', 'proposed') AND position IN ('core', 'related')
      AND source IN ('onet_element', 'onet_task')`)).rows as Array<{ c: string; source: 'onet_element' | 'onet_task'; id: string; label: string; status: 'confirmed' | 'proposed' }>;
  const refOf = (r: typeof rows[number]) => (r.source === 'onet_element' ? r.id : taskGroupKey(r.label));
  const elementVecs = await readVectorsByRef(ex, 'onet_element', rows.filter(r => r.source === 'onet_element').map(refOf), DEFAULT_EMBEDDING_MODEL);
  const taskVecs = await readVectorsByRef(ex, 'onet_task', rows.filter(r => r.source === 'onet_task').map(refOf), DEFAULT_EMBEDDING_MODEL);
  const seen = new Map<string, Candidate>();
  for (const r of rows) {
    const vector = (r.source === 'onet_element' ? elementVecs : taskVecs).get(refOf(r));
    if (!vector) continue;
    const k = `${r.c}|${r.source}|${refOf(r)}`;
    const prev = seen.get(k);
    if (prev && !prev.provisional) continue;
    seen.set(k, { label: r.label, source: r.source, provisional: r.status === 'proposed', vector });
  }
  for (const [k, cand] of seen) {
    const c = k.split('|')[0]!;
    const a = out.get(c);
    if (a) a.push(cand); else out.set(c, [cand]);
  }
  return out;
}

/** `opts` widens the O*NET search for the floor-check report (floor 0, more items); the wiki uses the defaults. */
export async function loadProjectTrail(ex: Executor, snapshotId: string, opts: { floor?: number; n?: number } = {}): Promise<TrailProject[]> {
  const snap = await readSnapshot(ex, snapshotId);
  if (!snap) return [];
  const cells = ((await ex.execute(sql`
    SELECT c.competency_id AS "competencyId", s.name AS "competencyName", c.matched_competency AS matched,
           c.k_depth AS k, c.u_depth AS u, c.d_depth AS d
    FROM snapshot_competency_coverage c JOIN sub_competencies s ON s.id = c.competency_id AND NOT s.retired
    WHERE c.snapshot_id = ${snapshotId} AND c.matched_competency IS NOT NULL`)).rows as unknown as TrailCell[])
    .map(c => ({ ...c, d: Number(c.d), k: c.k === null ? null : Number(c.k), u: c.u === null ? null : Number(c.u) }));
  const candidates = await readCandidates(ex, [...new Set(cells.map(c => c.competencyId))]);
  const stmtVecs = await readVectorsByRef(ex, 'course_skill', [...snap.statements, ...snap.projectNamed].map(statementRef), DEFAULT_EMBEDDING_MODEL);
  return buildProjectTrail({
    projects: snap.projects,
    statements: snap.statements,
    cells,
    nearest: (statement, competencyId): TrailItem[] => nearestItems(stmtVecs.get(statementRef(statement)), candidates.get(competencyId) ?? [], opts.floor, opts.n),
  });
}

export interface BuildingProject { courseCode: string; project: string; statement: string; onet: TrailItem[] }

/** Every program-visible course's latest snapshot: the project skills that feed `competencyId`. */
export async function loadBuildingProjects(ex: Executor = db, competencyId: string): Promise<BuildingProject[]> {
  const snaps = (await ex.execute(sql`
    SELECT DISTINCT ON (s.course_code) s.id, s.course_code AS code
    FROM course_capture_snapshots s JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL AND ${PROGRAM_VISIBLE_SQL}
    ORDER BY s.course_code, s.created_at DESC`)).rows as Array<{ id: string; code: string }>;
  const out: BuildingProject[] = [];
  for (const s of snaps) {
    for (const p of await loadProjectTrail(ex, s.id)) {
      for (const skill of p.skills) {
        const hit = skill.competencies.find(c => c.id === competencyId);
        if (hit) out.push({ courseCode: s.code, project: p.title, statement: skill.statement, onet: hit.onet });
      }
    }
  }
  return out.sort((a, b) => a.courseCode.localeCompare(b.courseCode) || a.project.localeCompare(b.project) || a.statement.localeCompare(b.statement));
}
