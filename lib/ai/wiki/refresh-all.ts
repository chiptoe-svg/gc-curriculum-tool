/**
 * One-pass wiki refresh — planner, runner and read-only DB loaders for
 * scripts/wiki/refresh-all.ts.
 *
 * Why: scripts/wiki/seed.ts runs updateWikiForSnapshot() once per non-retired
 * snapshot, and after a program-wide re-score every snapshot's affected set
 * includes every competency, target and concept page plus the index. Those
 * pages are derived from ALL courses' coverage, not from the triggering
 * snapshot, so the seed regenerates each of them once per snapshot
 * (O(captures × pages)). This refresh instead regenerates:
 *
 *   1. each course page ONCE, from that course's latest non-retired snapshot
 *      (updateWikiForSnapshot with pageTypes ['course'] — same prompt, sheet
 *      merge, competency links, evidence bands and raw layer as per capture);
 *   2. each competency, target and concept page and the index ONCE, from the
 *      program-wide substrate (generateProgramWikiBatch — no triggering
 *      snapshot), in WIKI_PAGES_PER_CALL batches with the index last.
 *
 * Writes: one writeAndPush per course and one per program batch, strictly
 * sequential (awaited), so progress lands incrementally and a late failure
 * doesn't lose earlier work. The per-capture path is unchanged.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { courseCaptureSnapshots, courses, snapshotTargetCoverage } from '@/lib/db/schema';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import {
  WIKI_PAGES_PER_CALL,
  courseCodeToSlug,
  type ProgramCourseSummary,
  type ProgramPageRef,
  type WikiPageWrite,
} from '@/lib/ai/wiki/update';
import type { WikiCommit } from '@/lib/wiki/git-ops';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotStub {
  id: string;
  courseCode: string;
  createdAt: Date;
}

export interface RefreshInputs {
  /** Every non-retired snapshot (any order). */
  snapshots: SnapshotStub[];
  /** Distinct sub-competency ids with coverage on any non-retired snapshot. */
  competencySlugs: string[];
  /** Distinct career-target ids with coverage on any non-retired snapshot. */
  targetSlugs: string[];
  /** Any non-retired snapshot carries audit_notes.productive_failure_conditions. */
  hasProductiveFailure: boolean;
}

export interface RefreshOptions {
  only?: 'courses' | 'program';
  /** Restrict to one course page (implies the course pass only). */
  course?: string;
}

export interface PlannedCourse {
  courseCode: string;
  snapshotId: string;
  createdAt: Date;
  page: ProgramPageRef;
}

export interface RefreshPlan {
  courses: PlannedCourse[];
  /** Program-wide pages, each exactly once, index last. */
  programPages: ProgramPageRef[];
  /** programPages chunked at WIKI_PAGES_PER_CALL (index in the final batch). */
  programBatches: ProgramPageRef[][];
  /** Every course + program page except the index — the index's navigation. */
  manifest: ProgramPageRef[];
}

export interface RefreshDeps {
  /** Regenerate one course page (+ raw layer) from a snapshot. */
  generateCourse(snapshotId: string): Promise<{ pages: WikiPageWrite[]; logEntry: string }>;
  /** Regenerate one batch of program-wide pages. */
  generateProgramBatch(
    batch: ProgramPageRef[],
    manifest: ProgramPageRef[],
  ): Promise<{ pages: WikiPageWrite[]; logEntry: string }>;
  /** Commit + push (writeAndPush in production). */
  write(commit: WikiCommit): Promise<{ sha: string }>;
  log(line: string): void;
}

export interface RefreshResult {
  coursePages: number;
  programPages: number;
  programBatches: number;
  /** Primary LLM calls (excluding reconcile retries). */
  estimatedCalls: number;
  succeeded: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

const normCode = (code: string) => code.trim().toLowerCase().replace(/[\s-]+/g, ' ');

/** Newest snapshot per course, sorted by course code. */
export function latestSnapshotPerCourse(snapshots: ReadonlyArray<SnapshotStub>): SnapshotStub[] {
  const best = new Map<string, SnapshotStub>();
  for (const s of snapshots) {
    const cur = best.get(s.courseCode);
    if (!cur || s.createdAt.getTime() > cur.createdAt.getTime()) best.set(s.courseCode, s);
  }
  return [...best.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function planRefresh(inputs: RefreshInputs, opts: RefreshOptions): RefreshPlan {
  const latest = latestSnapshotPerCourse(inputs.snapshots);
  const allCourses: PlannedCourse[] = latest.map(s => {
    const slug = courseCodeToSlug(s.courseCode);
    return {
      courseCode: s.courseCode,
      snapshotId: s.id,
      createdAt: s.createdAt,
      page: { type: 'course', slug, path: `courses/${slug}.md` },
    };
  });

  const nonIndexProgram: ProgramPageRef[] = [
    ...[...new Set(inputs.competencySlugs)].map(slug => ({
      type: 'competency' as const, slug, path: `competencies/${slug}.md`,
    })),
    ...[...new Set(inputs.targetSlugs)].map(slug => ({
      type: 'target' as const, slug, path: `targets/${slug}.md`,
    })),
    ...(inputs.hasProductiveFailure
      ? [{ type: 'concept' as const, slug: 'productive-failure', path: 'concepts/productive-failure.md' }]
      : []),
    { type: 'concept' as const, slug: 'three-act-structure', path: 'concepts/three-act-structure.md' },
  ];
  const indexPage: ProgramPageRef = { type: 'index', slug: 'index', path: 'index.md' };

  const manifest = [...allCourses.map(c => c.page), ...nonIndexProgram];

  let courses = allCourses;
  let runProgram = opts.only !== 'courses';
  if (opts.only === 'program') courses = [];
  if (opts.course) {
    const want = normCode(opts.course);
    courses = allCourses.filter(c => normCode(c.courseCode) === want);
    if (courses.length === 0) {
      throw new Error(`refresh-all: no non-retired snapshot for course "${opts.course}"`);
    }
    runProgram = false;
  }

  const programPages = runProgram ? [...nonIndexProgram, indexPage] : [];
  return {
    courses,
    programPages,
    programBatches: chunk(programPages, WIKI_PAGES_PER_CALL),
    manifest,
  };
}

/** Old seed path: one updateWikiForSnapshot per snapshot, ceil(pages/6) calls each. */
export function oldPathCallCount(pagesPerSnapshot: ReadonlyArray<number>): number {
  return pagesPerSnapshot.reduce((n, p) => n + Math.ceil(p / WIKI_PAGES_PER_CALL), 0);
}

export function parseRefreshArgs(argv: ReadonlyArray<string>): RefreshOptions & { dryRun: boolean } {
  const out: RefreshOptions & { dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === '') throw new Error(`refresh-all: ${flag} needs a value`);
      return v;
    };
    if (flag === '--dry-run') out.dryRun = true;
    else if (flag === '--only') {
      const v = value();
      if (v !== 'courses' && v !== 'program') throw new Error(`refresh-all: --only must be courses|program, got "${v}"`);
      out.only = v;
    } else if (flag === '--course') out.course = value();
    else throw new Error(`refresh-all: unknown argument "${arg}"`);
  }
  if (out.course && out.only === 'program') {
    throw new Error('refresh-all: --course selects one course page; it cannot be combined with --only program');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runRefresh(
  plan: RefreshPlan,
  deps: RefreshDeps,
  opts: { dryRun: boolean },
): Promise<RefreshResult> {
  const nb = plan.programBatches.length;
  const result: RefreshResult = {
    coursePages: plan.courses.length,
    programPages: plan.programPages.length,
    programBatches: nb,
    estimatedCalls: plan.courses.length + nb,
    succeeded: 0,
    failed: 0,
  };

  deps.log(`Course pages: ${plan.courses.length} (1 call each)`);
  plan.courses.forEach((c, i) => {
    deps.log(`  [${i + 1}/${plan.courses.length}] ${c.page.path} ← ${c.courseCode} snapshot ${c.snapshotId.slice(0, 8)} (${c.createdAt.toISOString().slice(0, 10)})`);
  });
  deps.log(`Program pages: ${plan.programPages.length} in ${nb} batch(es) of ≤${WIKI_PAGES_PER_CALL}`);
  plan.programBatches.forEach((b, i) => {
    deps.log(`  batch ${i + 1}/${nb}: ${b.map(p => p.path).join(', ')}`);
  });
  deps.log(`Estimated LLM calls: ${result.estimatedCalls} (+ at most one reconcile retry per call)`);

  if (opts.dryRun) {
    deps.log('Dry run: no model calls, no writes.');
    return result;
  }

  for (let i = 0; i < plan.courses.length; i++) {
    const c = plan.courses[i]!;
    const label = `[course ${i + 1}/${plan.courses.length}] ${c.courseCode}`;
    try {
      const { pages, logEntry } = await deps.generateCourse(c.snapshotId);
      const { sha } = await deps.write({
        pages,
        logEntry,
        commitMessage: `feat(${c.page.slug}): one-pass refresh from latest snapshot ${c.createdAt.toISOString().slice(0, 10)}`,
      });
      deps.log(`${label} → committed ${sha}`);
      result.succeeded++;
    } catch (err) {
      deps.log(`${label} ⚠ failed: ${err instanceof Error ? err.message : String(err)}`);
      result.failed++;
    }
  }

  for (let i = 0; i < nb; i++) {
    const batch = plan.programBatches[i]!;
    const label = `[program batch ${i + 1}/${nb}]`;
    try {
      const { pages, logEntry } = await deps.generateProgramBatch(batch, plan.manifest);
      const { sha } = await deps.write({
        pages,
        logEntry,
        commitMessage: `feat(program): one-pass refresh batch ${i + 1}/${nb} — ${batch.map(p => p.slug).join(', ')}`,
      });
      deps.log(`${label} → committed ${sha}`);
      result.succeeded++;
    } catch (err) {
      deps.log(`${label} ⚠ failed: ${err instanceof Error ? err.message : String(err)}`);
      result.failed++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Read-only DB loaders
// ---------------------------------------------------------------------------

/** Inputs for planRefresh plus the per-snapshot page counts of the old path. */
export async function loadRefreshInputs(): Promise<RefreshInputs & {
  latestProfiles: Map<string, CaptureProfile>;
  oldPathPagesPerSnapshot: number[];
}> {
  const snaps = await db
    .select({
      id: courseCaptureSnapshots.id,
      courseCode: courseCaptureSnapshots.courseCode,
      createdAt: courseCaptureSnapshots.createdAt,
      profile: courseCaptureSnapshots.profile,
    })
    .from(courseCaptureSnapshots)
    .where(isNull(courseCaptureSnapshots.retiredAt));

  const cells = await db
    .select({
      snapshotId: snapshotTargetCoverage.snapshotId,
      subCompetencyId: snapshotTargetCoverage.subCompetencyId,
      careerTargetId: snapshotTargetCoverage.careerTargetId,
    })
    .from(snapshotTargetCoverage)
    .innerJoin(
      courseCaptureSnapshots,
      and(
        eq(snapshotTargetCoverage.snapshotId, courseCaptureSnapshots.id),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    );

  const snapshots: SnapshotStub[] = snaps.map(s => ({
    id: s.id,
    courseCode: s.courseCode,
    createdAt: s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt),
  }));
  const pfcOf = (p: unknown) => (p as CaptureProfile).audit_notes?.productive_failure_conditions != null;

  // Old path page count per snapshot, mirroring computeAffectedPages:
  // course + index + three-act + (productive-failure?) + distinct subs + distinct targets.
  const bySnap = new Map<string, { subs: Set<string>; targets: Set<string> }>();
  for (const c of cells) {
    const e = bySnap.get(c.snapshotId) ?? { subs: new Set(), targets: new Set() };
    e.subs.add(c.subCompetencyId);
    e.targets.add(c.careerTargetId);
    bySnap.set(c.snapshotId, e);
  }
  const oldPathPagesPerSnapshot = snaps.map(s => {
    const e = bySnap.get(s.id);
    return 3 + (pfcOf(s.profile) ? 1 : 0) + (e?.subs.size ?? 0) + (e?.targets.size ?? 0);
  });

  const latestIds = new Set(latestSnapshotPerCourse(snapshots).map(s => s.id));
  const latestProfiles = new Map<string, CaptureProfile>();
  for (const s of snaps) if (latestIds.has(s.id)) latestProfiles.set(s.id, s.profile as CaptureProfile);

  return {
    snapshots,
    competencySlugs: [...new Set(cells.map(c => c.subCompetencyId))].sort(),
    targetSlugs: [...new Set(cells.map(c => c.careerTargetId))].sort(),
    hasProductiveFailure: snaps.some(s => pfcOf(s.profile)),
    latestProfiles,
    oldPathPagesPerSnapshot,
  };
}

/** Course summaries (latest snapshot per course) for the index + concept pages. */
export async function loadProgramCourseSummaries(
  planned: ReadonlyArray<{ courseCode: string; snapshotId: string; createdAt: Date }>,
  latestProfiles: ReadonlyMap<string, CaptureProfile>,
): Promise<ProgramCourseSummary[]> {
  const codes = planned.map(p => p.courseCode);
  const rows = codes.length === 0 ? [] : await db
    .select({ code: courses.code, title: courses.title, level: courses.level })
    .from(courses)
    .where(inArray(courses.code, codes));
  const byCode = new Map(rows.map(r => [r.code, r]));
  return planned.map(p => ({
    courseCode: p.courseCode,
    courseSlug: courseCodeToSlug(p.courseCode),
    title: byCode.get(p.courseCode)?.title ?? null,
    level: byCode.get(p.courseCode)?.level ?? null,
    lastSnapshotId: p.snapshotId,
    lastSnapshotDate: p.createdAt.toISOString().slice(0, 10),
    courseShape: latestProfiles.get(p.snapshotId)?.verification_summary?.course_shape ?? null,
  }));
}
