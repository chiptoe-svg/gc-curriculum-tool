// app/api/admin/courses/[code]/prereq-edges/route.ts
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import {
  listEdgesForFocal,
  upsertSeededEdges,
  addFacultyEdge,
  updateEdge,
  deleteEdge,
  type SeedEdgeInput,
  type UpdateEdgeInput,
} from '@/lib/db/prerequisite-edge-queries';
import { getCourseByCode, courseExists } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { listTargets } from '@/lib/db/career-targets-queries';
import { seedPrereqEdges } from '@/lib/ai/analyze/prereq-edge-seed';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ code: string }>;
}

/** Light regex to extract GC-style course codes from free-text prerequisites. */
function extractCodesFromProse(text: string): string[] {
  const matches = text.match(/GC\s?\d{3,4}\w*/gi) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\s+/, ' ').toUpperCase()))];
}

// ---------------------------------------------------------------------------
// GET /api/admin/courses/[code]/prereq-edges?slug=
//
// Returns:
//   { edges: PrereqEdgeRow[], unknownPrereqs: string[] }
//
// unknownPrereqs = codes on existing edges OR in the focal course's
// prerequisites prose that are NOT present in the courses table.
// ---------------------------------------------------------------------------

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { code } = await params;

  const [course, edges] = await Promise.all([
    getCourseByCode(code),
    listEdgesForFocal(code),
  ]);

  // Collect all candidate prereq codes (from existing edges + prose parsing).
  const fromEdges = edges.map((e) => e.prereqCourseCode);
  const fromProse = course ? extractCodesFromProse(course.prerequisites ?? '') : [];
  const allCodes = [...new Set([...fromEdges, ...fromProse])];

  // Check which codes are unknown (not in courses table).
  const unknownPrereqs: string[] = [];
  await Promise.all(
    allCodes.map(async (c) => {
      const exists = await courseExists(c);
      if (!exists) unknownPrereqs.push(c);
    }),
  );

  return NextResponse.json({ edges, unknownPrereqs: unknownPrereqs.sort() });
}

// ---------------------------------------------------------------------------
// POST /api/admin/courses/[code]/prereq-edges?slug=&mode=seed|add
//
// mode=seed (or body.action='seed'):
//   Daily-cap gated AI call. Loads focal course + latest snapshot incoming
//   expectations (or []) + full sub-competency catalog. Calls seedPrereqEdges,
//   splits results into matched (prereq code in courses) vs unknownPrereqs,
//   upserts matched edges, records spend.
//   Returns { inserted, skippedConfirmed, unknownPrereqs }.
//
// mode=add (or body.action='add'):
//   Body: { prereqCourseCode, subCompetencyId, expected_k?, expected_u?,
//           expected_d?, rationale? }
//   Delegates to addFacultyEdge (cycle-checked, confirmed=true, source='faculty').
//   409 on cycle; 400 on bad input.
// ---------------------------------------------------------------------------

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { code } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const modeParam = url.searchParams.get('mode');
  const action = typeof body.action === 'string' ? body.action : modeParam;

  // ------------------------------------------------------------------
  // mode = seed
  // ------------------------------------------------------------------
  if (action === 'seed') {
    const cap = await checkDailyCap();
    if (!cap.ok) {
      return NextResponse.json(
        { error: 'daily cost cap reached', spentCents: cap.spentCents },
        { status: 429 },
      );
    }

    const course = await getCourseByCode(code);
    if (!course) {
      return NextResponse.json({ error: `course ${code} not found` }, { status: 404 });
    }

    // Load latest snapshot to get incoming_expectations (or [] for no snapshot).
    const snapshot = await getLatestSnapshotByCourse(code);
    const incomingExpectations = snapshot?.profile?.incoming_expectations ?? [];

    // Load the full sub-competency catalog (all non-retired sub-competencies
    // across all targets).
    const targets = await listTargets();
    const subCompetencies = targets.flatMap((t) => t.subCompetencies);

    let result: Awaited<ReturnType<typeof seedPrereqEdges>>;
    try {
      result = await seedPrereqEdges({
        focalCourseCode: code,
        prerequisitesText: course.prerequisites ?? '',
        incomingExpectations,
        subCompetencies,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg.slice(0, 400) }, { status: 500 });
    }

    // Split edges into matched (prereq code exists in courses) vs unknown.
    const unknownPrereqs: string[] = [];
    const matchedEdges: SeedEdgeInput[] = [];

    await Promise.all(
      result.edges.map(async (e) => {
        const exists = await courseExists(e.prereq_course_code);
        if (exists) {
          matchedEdges.push({
            focalCourseCode: code,
            prereqCourseCode: e.prereq_course_code,
            subCompetencyId: e.sub_competency_id,
            expectedK: e.expected_k,
            expectedU: e.expected_u,
            expectedD: e.expected_d,
            confidence: e.confidence,
            rationale: e.rationale,
          });
        } else {
          unknownPrereqs.push(e.prereq_course_code);
        }
      }),
    );

    const { inserted, skippedConfirmed } = await upsertSeededEdges(matchedEdges);

    await recordSpend(result.costUsdCents);

    return NextResponse.json({
      inserted,
      skippedConfirmed,
      unknownPrereqs: [...new Set(unknownPrereqs)].sort(),
    });
  }

  // ------------------------------------------------------------------
  // mode = add
  // ------------------------------------------------------------------
  if (action === 'add') {
    const prereqCourseCode =
      typeof body.prereqCourseCode === 'string' ? body.prereqCourseCode.trim() : '';
    const subCompetencyId =
      typeof body.subCompetencyId === 'string' ? body.subCompetencyId.trim() : '';
    if (!prereqCourseCode || !subCompetencyId) {
      return NextResponse.json(
        { error: 'prereqCourseCode and subCompetencyId are required' },
        { status: 400 },
      );
    }

    const input: SeedEdgeInput = {
      focalCourseCode: code,
      prereqCourseCode,
      subCompetencyId,
      expectedK: typeof body.expected_k === 'number' ? body.expected_k : null,
      expectedU: typeof body.expected_u === 'number' ? body.expected_u : null,
      expectedD: typeof body.expected_d === 'number' ? body.expected_d : null,
      confidence: 'high',
      rationale: typeof body.rationale === 'string' ? body.rationale : '',
    };

    try {
      const { id } = await addFacultyEdge(input);
      return NextResponse.json({ ok: true, id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cycle|self-referential/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'mode must be "seed" or "add"' }, { status: 400 });
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/courses/[code]/prereq-edges?slug=
//
// Body: { id, expected_k?, expected_u?, expected_d?, confirmed? }
// ---------------------------------------------------------------------------

export async function PATCH(req: Request, { params: _params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const input: UpdateEdgeInput = {
    id,
    ...(body.expected_k !== undefined && {
      expectedK: typeof body.expected_k === 'number' ? body.expected_k : null,
    }),
    ...(body.expected_u !== undefined && {
      expectedU: typeof body.expected_u === 'number' ? body.expected_u : null,
    }),
    ...(body.expected_d !== undefined && {
      expectedD: typeof body.expected_d === 'number' ? body.expected_d : null,
    }),
    ...(body.confirmed !== undefined && {
      confirmed: Boolean(body.confirmed),
    }),
  };

  await updateEdge(input);
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/courses/[code]/prereq-edges?slug=&id=
// ---------------------------------------------------------------------------

export async function DELETE(req: Request, { params: _params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const id = url.searchParams.get('id') ?? '';
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  await deleteEdge(id);
  return NextResponse.json({ ok: true });
}
