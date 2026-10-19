import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { PROGRAM_VISIBLE_SQL } from '@/lib/courses/program-visibility';
import { pfForSnapshot } from '@/lib/db/scaffolding-queries';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import type { ProductiveFailureConditions } from '@/lib/program/scaffolding';
import type { PsCourseInput, PsDepthInput } from '@/lib/program/problem-solving-profile';

/**
 * Inputs for the problem-solving evidence-profile page. Read-only.
 * One row per course: the latest non-retired snapshot, whichever instructor
 * captured it (the profile is program-level, so per-instructor rows would
 * double-count a course). Scope is PROGRAM_VISIBLE_SQL, as listStaleSnapshots.
 * Depths are technical competencies only (non-foundational, direct, active).
 */
export async function loadProblemSolvingInputs(
  executor: Tx | typeof db = db,
): Promise<{ courses: PsCourseInput[]; depths: PsDepthInput[] }> {
  const snaps = await executor.execute(sql`
    SELECT DISTINCT ON (s.course_code)
      s.id, s.course_code, s.created_at, s.profile, c.title, c.level
    FROM course_capture_snapshots s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL AND ${PROGRAM_VISIBLE_SQL}
    ORDER BY s.course_code, s.created_at DESC
  `);
  const rows = snaps.rows as Array<{
    id: string; course_code: string; created_at: Date | string;
    profile: { audit_notes?: { productive_failure_conditions?: ProductiveFailureConditions | null } } | null;
    title: string; level: number;
  }>;

  const courses: PsCourseInput[] = rows.map(r => ({
    courseCode: r.course_code,
    courseTitle: r.title,
    level: r.level,
    area7: pfForSnapshot(
      r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      r.profile?.audit_notes?.productive_failure_conditions ?? null,
    ),
  }));

  const ids = rows.map(r => r.id);
  if (ids.length === 0) return { courses, depths: [] };
  const idList = sql.join(ids.map(i => sql`${i}::uuid`), sql`, `);
  const d = await executor.execute(sql`
    SELECT cov.competency_id, sc.name AS competency_name, s.course_code, cov.d_depth
    FROM snapshot_competency_coverage cov
    JOIN sub_competencies sc ON sc.id = cov.competency_id
    JOIN course_capture_snapshots s ON s.id = cov.snapshot_id
    WHERE cov.snapshot_id IN (${idList})
      AND sc.foundational = false AND sc.scoring = 'direct' AND sc.retired = false
      AND cov.d_depth >= 4
  `);
  const depths: PsDepthInput[] = (d.rows as Array<{ competency_id: string; competency_name: string; course_code: string; d_depth: number }>)
    .map(r => ({ competencyId: r.competency_id, competencyName: r.competency_name, courseCode: r.course_code, dDepth: r.d_depth }));
  return { courses, depths };
}
