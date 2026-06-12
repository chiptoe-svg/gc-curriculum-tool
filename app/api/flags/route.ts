import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidSlug } from '@/lib/slug';
import { createFlag, listFlags } from '@/lib/db/flag-queries';
import { getMatrixData } from '@/lib/db/program-coverage-queries';
import { flagDrift } from '@/lib/program/flags';

const createSchema = z.object({
  targetKind: z.enum(['coverage_cell', 'profile_competency']),
  courseCode: z.string().min(1),
  careerTargetId: z.string().nullable(),
  subCompetencyId: z.string().nullable(),
  competencyStatement: z.string().nullable(),
  note: z.string().transform(s => s.trim()).pipe(z.string().min(1, 'note required')),
  flaggedBy: z.string().min(1),
  flaggedContext: z.object({
    k: z.number().nullable(), u: z.number().nullable(), d: z.number().nullable(),
    matchedCompetency: z.string().nullable().optional(),
    rationale: z.string().nullable().optional(),
    statement: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
  }).nullable(),
}).superRefine((v, ctx) => {
  if (v.targetKind === 'coverage_cell') {
    if (!v.careerTargetId || !v.subCompetencyId || v.competencyStatement !== null) {
      ctx.addIssue({ code: 'custom', message: 'coverage_cell flags need careerTargetId + subCompetencyId and a null competencyStatement' });
    }
  } else {
    if (!v.competencyStatement || v.careerTargetId !== null || v.subCompetencyId !== null) {
      ctx.addIssue({ code: 'custom', message: 'profile_competency flags need competencyStatement and null careerTargetId/subCompetencyId' });
    }
  }
});

export async function POST(req: Request): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid flag' }, { status: 400 });
  }
  const flag = await createFlag(parsed.data);
  return NextResponse.json({ flag });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const statusParam = url.searchParams.get('status');
  const status = statusParam === 'open' || statusParam === 'resolved' ? statusParam : undefined;
  const flags = await listFlags({ status });

  // Annotate cell flags with read-time drift vs the LIVE matrix (newest
  // snapshot per career-building course) and whether the cell still exists.
  const matrix = await getMatrixData();
  const snapByCourse = new Map(matrix.courses.map(c => [c.courseCode, c.snapshotId]));
  const cellByKey = new Map(matrix.cells.map(c => [`${c.snapshotId}:${c.careerTargetId}:${c.subCompetencyId}`, c]));

  const annotated = flags.map(f => {
    if (f.targetKind !== 'coverage_cell') return { ...f, drift: null, stillInMatrix: null };
    const snapId = snapByCourse.get(f.courseCode);
    const cell = snapId ? cellByKey.get(`${snapId}:${f.careerTargetId}:${f.subCompetencyId}`) ?? null : null;
    return {
      ...f,
      stillInMatrix: cell !== null,
      drift: cell && f.flaggedContext
        ? flagDrift(f.flaggedContext, { k: cell.kDepth, u: cell.uDepth, d: cell.dDepth })
        : null,
    };
  });

  return NextResponse.json({ flags: annotated });
}
