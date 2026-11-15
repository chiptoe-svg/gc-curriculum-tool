/**
 * Everything the curriculum builder stacks, read in one pass (server only).
 * Read-only: tracked courses with both readings (stated objectives from the
 * syllabus pass, discovered outcomes from approved captures), the competency
 * catalog, career targets with their member competencies and weights, and
 * the prerequisite map. Catalog-only courses are searched separately
 * (searchCatalog) so the page does not ship the whole Clemson catalog.
 */
import { pfForSnapshot } from '@/lib/db/scaffolding-queries';
import { and, asc, eq, ilike, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  careerTargetMembership, careerTargets, courseCatalogEntries, courseIntendedCoverage, courses,
  snapshotCompetencyCoverage, subCompetencies,
} from '@/lib/db/schema';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { loadPrereqMap } from '@/lib/curriculum/prereq-map';
import { evidenceFromProfile } from '@/lib/wiki/course-views';
import { loadWikiIndex } from '@/lib/wiki/index-data';
import { loadCompetencyRelations } from './relations';
import { courseWhatIfs } from '@/lib/db/schema';
import { resolveWhatIfDepths } from '@/lib/what-if/knock-on';
import { isNotNull } from 'drizzle-orm';
import type { CompetencyDepth, Library, LibraryCourse, LibraryVersion, LibraryWhatIf } from './types';

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

  // One approved capture per (course, instructor): the newest one that has been scored against the
  // competency catalog, or, when none has, the newest (it then has no depths and cannot be stacked).
  // /program scores only on request, so a recent capture can sit unscored.
  const snapRows = (await db.execute(sql`
    SELECT DISTINCT ON (s.course_code, s.instructor_name)
      s.id, s.course_code, s.instructor_name, s.created_at, s.profile
    FROM course_capture_snapshots s
    WHERE s.retired_at IS NULL
    ORDER BY s.course_code, s.instructor_name,
      EXISTS (SELECT 1 FROM snapshot_competency_coverage c WHERE c.snapshot_id = s.id) DESC, s.created_at DESC
  `)).rows as Array<{ id: string; course_code: string; instructor_name: string | null; created_at: Date | string; profile: CaptureProfile }>;
  const coverage = await db.select({
    snapshotId: snapshotCompetencyCoverage.snapshotId, competencyId: snapshotCompetencyCoverage.competencyId,
    k: snapshotCompetencyCoverage.kDepth, u: snapshotCompetencyCoverage.uDepth, d: snapshotCompetencyCoverage.dDepth,
  }).from(snapshotCompetencyCoverage);
  const depthsBySnap = new Map<string, CompetencyDepth[]>();
  for (const r of coverage) {
    if (!live.has(r.competencyId)) continue;
    const list = depthsBySnap.get(r.snapshotId) ?? [];
    list.push({ competencyId: r.competencyId, k: r.k, u: r.u, d: r.d });
    depthsBySnap.set(r.snapshotId, list);
  }
  const versionsByCourse = new Map<string, LibraryVersion[]>();
  for (const s of snapRows) {
    const createdAt = new Date(s.created_at).toISOString();
    const ev = evidenceFromProfile(s.profile, createdAt.slice(0, 10));
    const list = versionsByCourse.get(s.course_code) ?? [];
    list.push({
      snapshotId: s.id, instructorName: s.instructor_name, createdAt,
      depths: depthsBySnap.get(s.id) ?? [],
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
  const whatIfRows = await db.select().from(courseWhatIfs).where(isNotNull(courseWhatIfs.pageCreatedAt));
  const whatIfsByCourse = new Map<string, LibraryWhatIf[]>();
  for (const w of whatIfRows) {
    if (!w.baseSnapshotId || !w.profile) continue; // its base version was deleted: nothing to lay the change over
    const { resolved, notComputed } = await resolveWhatIfDepths(w.baseSnapshotId, w.profile);
    const changed = new Map(resolved.map(r => [r.subCompetencyId, r]));
    const base = (depthsBySnap.get(w.baseSnapshotId) ?? []).filter(d => !changed.has(d.competencyId));
    const depths = [...base, ...resolved.filter(r => live.has(r.subCompetencyId)).map(r => ({ competencyId: r.subCompetencyId, k: r.k, u: r.u, d: r.d }))];
    const list = whatIfsByCourse.get(w.courseCode) ?? [];
    list.push({ id: w.id, title: w.title ?? 'Untitled what-if', author: w.authorName, depths, notComputed });
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
