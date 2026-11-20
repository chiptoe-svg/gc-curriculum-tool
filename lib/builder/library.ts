/**
 * Everything the curriculum builder stacks, read in one pass (server only).
 * Read-only: tracked courses with both readings (stated objectives from the
 * syllabus pass, discovered outcomes from approved captures), the competency
 * catalog, career targets with their member competencies and weights, and
 * the prerequisite map. Catalog-only courses are searched separately
 * (searchCatalog) so the page does not ship the whole Clemson catalog.
 */
import { pfForSnapshot } from '@/lib/db/scaffolding-queries';
import { rollUp, type LevelRow, type LinkRow } from './links';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { and, asc, eq, ilike, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  careerTargetMembership, careerTargets, courseCatalogEntries, courseIntendedCoverage, courses,
  skillCompetencyLinks, competencyLevels, subCompetencies,
} from '@/lib/db/schema';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { loadPrereqMap } from '@/lib/curriculum/prereq-map';
import { evidenceFromProfile } from '@/lib/wiki/course-views';
import { loadWikiIndex } from '@/lib/wiki/index-data';
import { loadCompetencyRelations } from './relations';
import { courseWhatIfs } from '@/lib/db/schema';
import { resolveWhatIfDepths } from '@/lib/what-if/knock-on';
import { isNotNull } from 'drizzle-orm';
import { pickCandidates } from './candidates';
import { readVectors } from '@/lib/db/bundle-queries';
import { readJudgments, latestDecisions } from '@/lib/db/match-queries';
import { liveCaptures } from '@/lib/db/live-captures';
import { isUndefinedTable } from '@/lib/db/pg-errors';
import { MODEL_IN_USE, PROMPT_VERSION } from '@/lib/ai/match-judge';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import type { Candidate, CompetencyDepth, Library, MatchDecision, RequiredSkill, LibraryCourse, LibraryVersion, LibraryWhatIf, Skill } from './types';

const TOP_CANDIDATES = 8;

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

export async function loadLibrary(): Promise<Library> {
  const [courseRows, catalogRows, compRows, targetRows, memberRows, statedRows, prereqMap] = await Promise.all([
    db.select().from(courses).where(and(eq(courses.scope, 'gc'), eq(courses.status, 'offered'))).orderBy(asc(courses.code)),
    db.select({ code: courseCatalogEntries.courseCode, description: courseCatalogEntries.description, credits: courseCatalogEntries.credits })
      .from(courseCatalogEntries)
      .where(sql`${courseCatalogEntries.courseCode} IN (SELECT upper(code) FROM courses)`),
    db.select().from(subCompetencies).where(and(eq(subCompetencies.retired, false), eq(subCompetencies.scoring, 'direct'))).orderBy(asc(subCompetencies.name)),
    db.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder)),
    db.select().from(careerTargetMembership).orderBy(asc(careerTargetMembership.displayOrder)),
    db.select().from(courseIntendedCoverage),
    loadPrereqMap(),
  ]);
  const live = new Set(compRows.map(c => c.id));
  const related = await loadCompetencyRelations();

  // One approved capture per (course, instructor), chosen as the required-skill judge chooses (liveCaptures).
  const snapRows = await liveCaptures();
  const coverage = await db.select({
    snapshotId: competencyLevels.snapshotId, competencyId: competencyLevels.competencyId,
    k: competencyLevels.kDepth, u: competencyLevels.uDepth, d: competencyLevels.dDepth,
    source: competencyLevels.matchedCompetency, method: competencyLevels.method, rationale: competencyLevels.rollupRationale,
  }).from(competencyLevels);
  // Levels follow one rule for every reader (competency_levels, migration 0072; spec 2026-11-20): faculty
  // level, else AI level, else the scorer's level unless faculty rejected every link, else 'needs_level'.
  const depthsBySnap = new Map<string, CompetencyDepth[]>();
  const levelsBySnap = new Map<string, LevelRow[]>();
  for (const r of coverage) {
    if (!live.has(r.competencyId)) continue;
    const list = depthsBySnap.get(r.snapshotId) ?? [];
    list.push({ competencyId: r.competencyId, k: r.k, u: r.u, d: r.d, source: r.source, method: r.method });
    depthsBySnap.set(r.snapshotId, list);
    levelsBySnap.set(r.snapshotId, [...(levelsBySnap.get(r.snapshotId) ?? []), { competencyId: r.competencyId, k: r.k, u: r.u, d: r.d, method: r.method, rationale: r.rationale, source: r.source }]);
  }
  // Links (migration 0068): which skills count toward each competency, the unmapped skills and the suggestions.
  let linkRows: Array<LinkRow & { snapshotId: string }> = [];
  let linksInUse = false;
  try {
    linkRows = (await db.select({
      snapshotId: skillCompetencyLinks.snapshotId, skillRef: skillCompetencyLinks.skillRef, competencyId: skillCompetencyLinks.competencyId,
      source: skillCompetencyLinks.source, status: skillCompetencyLinks.status, similarity: skillCompetencyLinks.similarity,
    }).from(skillCompetencyLinks)).filter(r => live.has(r.competencyId));
    linksInUse = true;
  } catch { /* 0068 not applied on this database: keep the older scoring */ }
  const linksBySnap = new Map<string, LinkRow[]>();
  for (const r of linkRows) linksBySnap.set(r.snapshotId, [...(linksBySnap.get(r.snapshotId) ?? []), r]);
  const skillsOf = (p: CaptureProfile): Skill[] => {
    const seen = new Set<string>();
    return (p.competencies ?? []).flatMap(c => {
      const statement = (c.statement ?? '').trim();
      const skillRef = statement ? textHash(normalizeStatement(statement)) : '';
      if (!statement || seen.has(skillRef)) return [];
      seen.add(skillRef);
      return [{ skillRef, statement, k: c.k_depth ?? null, u: c.u_depth ?? null, d: c.d_depth ?? null }];
    });
  };

  const requiredOf = (p: CaptureProfile): RequiredSkill[] => {
    const seen = new Set<string>();
    return (p.incoming_expectations ?? []).flatMap(e => {
      const statement = (e.statement ?? '').trim();
      const ref = statement ? textHash(normalizeStatement(statement)) : '';
      if (!statement || seen.has(ref)) return [];
      seen.add(ref);
      return [{ ref, statement, need: { k: e.expected_depth?.k ?? null, u: e.expected_depth?.u ?? null, d: e.expected_depth?.d ?? null } }];
    });
  };

  const versionsByCourse = new Map<string, LibraryVersion[]>();
  for (const s of snapRows) {
    const createdAt = new Date(s.created_at).toISOString();
    const ev = evidenceFromProfile(s.profile, createdAt.slice(0, 10));
    const list = versionsByCourse.get(s.course_code) ?? [];
    list.push({
      snapshotId: s.id, instructorName: s.instructor_name, createdAt,
      ...(() => {
        const skills = skillsOf(s.profile);
        const useLinks = linksInUse && linksBySnap.has(s.id);
        if (!useLinks) return { depths: depthsBySnap.get(s.id) ?? [], skills, unmapped: [] as Skill[], suggestions: [], linked: false };
        const r = rollUp(skills, linksBySnap.get(s.id) ?? [], levelsBySnap.get(s.id) ?? []);
        return { depths: r.depths, skills, unmapped: r.unmapped, suggestions: r.suggestions, linked: true };
      })(),
      required: requiredOf(s.profile),
      outcomes: ev.rows.map(r => ({ statement: r.statement, k: r.k, u: r.u, d: r.d })),
      disagreements: ev.disagreements,
      projects: (s.profile.major_projects ?? []).map(p => ({ title: p.title, description: p.description, deliverables: p.deliverables ?? [] })),
      conditions: pfForSnapshot(new Date(s.created_at), s.profile.audit_notes?.productive_failure_conditions ?? null),
    });
    versionsByCourse.set(s.course_code, list);
  }
  // Scored versions first, then newest first: the first entry is the one the map uses by default.
  for (const list of versionsByCourse.values()) {
    list.sort((a, b) => Number(b.depths.length > 0) - Number(a.depths.length > 0) || b.createdAt.localeCompare(a.createdAt));
  }

  // What-ifs with a finished page: the base version's depths with the what-if's changed ratings laid over them.
  // Skills-only what-ifs (saved from a cluster, no page) load too, with no depths of their own.
  const whatIfRows = await db.select().from(courseWhatIfs).where(or(isNotNull(courseWhatIfs.pageCreatedAt), isNotNull(courseWhatIfs.skills)));
  const whatIfsByCourse = new Map<string, LibraryWhatIf[]>();
  for (const w of whatIfRows) {
    if (!w.profile) {
      if (!w.skills) continue;
      const list = whatIfsByCourse.get(w.courseCode) ?? [];
      list.push({ id: w.id, title: w.title ?? 'Untitled what-if', author: w.authorName, depths: [], notComputed: [], skills: w.skills, baseSnapshotId: w.baseSnapshotId });
      whatIfsByCourse.set(w.courseCode, list);
      continue;
    }
    if (!w.baseSnapshotId) continue; // its base version was deleted: nothing to lay the change over
    const { resolved, notComputed } = await resolveWhatIfDepths(w.baseSnapshotId, w.profile);
    const changed = new Map(resolved.map(r => [r.subCompetencyId, r]));
    const base = (depthsBySnap.get(w.baseSnapshotId) ?? []).filter(d => !changed.has(d.competencyId));
    const depths = [...base, ...resolved.filter(r => live.has(r.subCompetencyId)).map(r => ({ competencyId: r.subCompetencyId, k: r.k, u: r.u, d: r.d }))];
    const list = whatIfsByCourse.get(w.courseCode) ?? [];
    list.push({ id: w.id, title: w.title ?? 'Untitled what-if', author: w.authorName, depths, notComputed, skills: null, baseSnapshotId: w.baseSnapshotId });
    whatIfsByCourse.set(w.courseCode, list);
  }

  const statedByCourse = new Map<string, CompetencyDepth[]>();
  for (const r of statedRows) {
    if (!live.has(r.subCompetencyId)) continue;
    const list = statedByCourse.get(r.courseCode) ?? [];
    list.push({ competencyId: r.subCompetencyId, k: r.intendedK, u: r.intendedU, d: r.intendedD });
    statedByCourse.set(r.courseCode, list);
  }

  const catalogByCode = new Map(catalogRows.map(r => [norm(r.code), r]));
  // The wiki repo is a separate clone; the builder works without it.
  const wikiByCode = new Map<string, { slug: string; summary: string }>();
  try {
    for (const w of (await loadWikiIndex()).courses) wikiByCode.set(norm(w.code), { slug: w.slug, summary: w.description });
  } catch { /* no wiki clone on this machine */ }

  const libraryCourses: LibraryCourse[] = courseRows.map(c => {
    const cat = catalogByCode.get(norm(c.code));
    return {
      code: c.code, title: c.title, level: c.level, category: c.category, track: c.track,
      description: (cat?.description ?? c.description ?? '').trim(),
      credits: cat?.credits ?? null,
      wiki: wikiByCode.get(norm(c.code)) ?? null,
      objectives: (c.learningObjectives ?? []).map(s => s.trim()).filter(Boolean),
      sheetProjects: (c.majorProjects ?? []).map(s => s.trim()).filter(Boolean),
      stated: statedByCourse.get(c.code) ?? [],
      versions: versionsByCourse.get(c.code) ?? [],
      whatIfs: whatIfsByCourse.get(c.code) ?? [],
    };
  });

  // Match candidates and faculty decisions (migration 0069). The same choice as scripts/catalog/judge-required-skills.ts:
  // a required skill's top developed skills from OTHER courses by embedding cosine. A database without 0069 loads without them.
  const candidates: Record<string, Candidate[]> = {};
  const decisions: Library['decisions'] = {};
  try {
    const developed: Array<{ course: string; statement: string; ref: string }> = [];
    const required: Array<{ course: string; statement: string; ref: string }> = [];
    for (const s of snapRows) {
      for (const k of skillsOf(s.profile)) developed.push({ course: s.course_code, statement: k.statement, ref: k.skillRef });
      for (const r of requiredOf(s.profile)) required.push({ course: s.course_code, statement: r.statement, ref: r.ref });
    }
    const items = [...new Map([...required, ...developed].map(x => [x.ref, { ref: x.ref, text: x.statement }])).values()];
    const vecs = await readVectors(db, 'course_skill', items, DEFAULT_EMBEDDING_MODEL);
    const pairs: Array<{ requiredHash: string; suppliedHash: string }> = [];
    const raw: Candidate[] = [];
    for (const r of required) {
      const key = `${r.course}|${r.ref}`;
      if (candidates[key]) continue;
      const top = pickCandidates(r, developed, vecs, TOP_CANDIDATES);
      candidates[key] = top;
      raw.push(...top);
      for (const c of top) pairs.push({ requiredHash: c.requiredRef, suppliedHash: c.suppliedRef });
    }
    const judged = await readJudgments(pairs, MODEL_IN_USE, PROMPT_VERSION);
    for (const c of raw) {
      const j = judged.get(`${c.requiredRef}|${c.suppliedRef}`);
      if (j) { c.pFully = j.pFully; c.pPartly = j.pPartly; }
    }
    for (const [key, d] of await latestDecisions()) {
      decisions[key] = { requiredRef: d.requiredHash, suppliedRef: d.suppliedHash, label: d.label, by: d.decidedBy, at: new Date(d.decidedAt).toISOString(), draft: d.draft } satisfies MatchDecision;
    }
  } catch (err) {
    // 0069 not applied on this database: no candidates or decisions, silently. Anything else is logged and the map loads without them.
    if (!isUndefinedTable(err)) console.error('[builder/library] match candidates failed:', err instanceof Error ? err.message : err);
    for (const k of Object.keys(candidates)) delete candidates[k];
    for (const k of Object.keys(decisions)) delete decisions[k];
  }

  return {
    courses: libraryCourses,
    competencies: compRows.map(c => ({
      id: c.id, name: c.name, foundational: c.foundational,
      stratum: related.get(c.id)?.stratum ?? null,
      neighbors: (related.get(c.id)?.neighbors ?? []).filter(n => live.has(n)),
      know: c.knowDescriptor, understand: c.understandDescriptor, do: c.doDescriptor,
    })),
    targets: targetRows.map(t => ({
      id: t.id, name: t.name, shortDefinition: t.shortDefinition,
      members: memberRows.filter(m => m.careerTargetId === t.id && live.has(m.competencyId))
        .map(m => ({ competencyId: m.competencyId, weight: m.effectiveWeight })),
    })),
    prereqs: prereqMap.edges.map(e => ({ courseCode: e.focal, prereqCode: e.prereq, kind: e.kind, anyOfGroup: e.anyOfGroup })),
    candidates, decisions,
  };
}

export interface CatalogHit { code: string; title: string; description: string; credits: string | null; prereqText: string | null }

/** Clemson catalog courses the tool does not track yet, by code or title. */
export async function searchCatalog(q: string, limit = 25): Promise<CatalogHit[]> {
  const term = q.trim().replace(/[%_\\]/g, '');
  if (term.length < 2) return [];
  const tracked = (await db.select({ code: courses.code }).from(courses)).map(r => norm(r.code));
  const like = `%${term.replace(/\s+/g, '%')}%`;
  const rows = await db.select({
    code: courseCatalogEntries.courseCode, title: courseCatalogEntries.title,
    description: courseCatalogEntries.description, credits: courseCatalogEntries.credits, prereqText: courseCatalogEntries.prereqText,
  }).from(courseCatalogEntries)
    .where(and(
      or(ilike(courseCatalogEntries.courseCode, like), ilike(courseCatalogEntries.title, like)),
      tracked.length ? notInArray(courseCatalogEntries.courseCode, tracked) : undefined,
    ))
    .orderBy(asc(courseCatalogEntries.courseCode))
    .limit(limit);
  return rows.map(r => ({ code: r.code, title: r.title ?? r.code, description: r.description ?? '', credits: r.credits, prereqText: r.prereqText }));
}
