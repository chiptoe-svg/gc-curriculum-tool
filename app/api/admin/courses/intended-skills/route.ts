// app/api/admin/courses/intended-skills/route.ts
//
// POST /api/admin/courses/intended-skills?slug=<slug>
//
// Slug-gated admin route that runs the intended-skills rough pass for one
// course or all uncaptured courses.
//
// Body:
//   { mode: 'one', code: string }          – seed a single course
//   { mode: 'all-uncaptured' }             – seed every uncaptured course
//
// The daily cost cap is checked BEFORE each AI call; if it's breached the
// loop stops and the response includes stoppedAtCap: true with the work
// done so far.  recordSpend fires in a finally block so spend is always
// recorded once the AI call succeeds, even if the DB write fails.

import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode, listUncapturedCourseCodes, replaceIntendedCoverage } from '@/lib/db/courses-queries';
import type { NewIntendedRow } from '@/lib/db/courses-queries';
import { listTargets } from '@/lib/db/career-targets-queries';
import { extractIntendedSkills } from '@/lib/ai/analyze/intended-skills-extract';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // Slug auth — mirrors the prereq-edges pattern exactly.
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const mode = typeof body.mode === 'string' ? body.mode : '';

  if (mode !== 'one' && mode !== 'all-uncaptured') {
    return NextResponse.json(
      { error: 'mode must be "one" or "all-uncaptured"' },
      { status: 400 },
    );
  }

  // Resolve the list of course codes to seed.
  let codesToSeed: string[];

  if (mode === 'one') {
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code) {
      return NextResponse.json(
        { error: 'code is required when mode is "one"' },
        { status: 400 },
      );
    }
    const course = await getCourseByCode(code);
    if (!course) {
      return NextResponse.json({ error: `course ${code} not found` }, { status: 404 });
    }
    codesToSeed = [code];
  } else {
    codesToSeed = await listUncapturedCourseCodes();
  }

  // Load the sub-competency catalog ONCE before the loop.
  const targets = await listTargets();
  const subCompetencies = targets.flatMap((t) => t.subCompetencies);
  const validIdSet = new Set(subCompetencies.map((sc) => sc.id));

  // Accumulators.
  const seeded: Array<{ code: string; count: number }> = [];
  const skippedNoCatalogText: string[] = [];
  let stoppedAtCap = false;

  for (const code of codesToSeed) {
    // In all-uncaptured mode we skip unknown courses (shouldn't happen, but
    // listUncapturedCourseCodes only returns rows that exist in courses table).
    const course = await getCourseByCode(code);
    if (!course) continue;

    // Check daily cap BEFORE the AI call.  Stop the loop and surface
    // stoppedAtCap so the caller knows to retry later.
    const cap = await checkDailyCap();
    if (!cap.ok) {
      stoppedAtCap = true;
      break;
    }

    // Build the extractor input from catalog fields.
    const catalog = {
      description: course.description ?? '',
      learningObjectives: (course.learningObjectives as string[] | null) ?? [],
      majorProjects: (course.majorProjects as string[] | null) ?? [],
      skillsRequired: (course.skillsRequired as string[] | null) ?? [],
    };

    // Detect courses with no usable catalog text — still call the extractor
    // (it handles "(empty)" / "(none)") but record them for the caller.
    const hasText =
      catalog.description.trim() !== '' ||
      catalog.learningObjectives.length > 0 ||
      catalog.majorProjects.length > 0 ||
      catalog.skillsRequired.length > 0;

    if (!hasText) {
      skippedNoCatalogText.push(code);
    }

    // Run the AI call.  recordSpend fires in the finally block of the DB
    // write below so spend is always recorded once the model responded.
    let result: Awaited<ReturnType<typeof extractIntendedSkills>>;
    try {
      result = await extractIntendedSkills({ courseCode: code, catalog, subCompetencies });
    } catch (e) {
      // AI call failed — no spend incurred.  Record as failed and continue
      // (in all-uncaptured mode) or return an error (in one-course mode).
      const msg = e instanceof Error ? e.message : String(e);
      if (mode === 'one') {
        return NextResponse.json({ error: msg.slice(0, 400) }, { status: 500 });
      }
      // In loop mode: skip this course, keep going.
      continue;
    }

    // Validate returned sub_competency_ids against the catalog.  Drop unknowns.
    let droppedUnknown = 0;
    const validRows: NewIntendedRow[] = [];
    for (const item of result.items) {
      if (!validIdSet.has(item.sub_competency_id)) {
        droppedUnknown++;
        continue;
      }
      validRows.push({
        subCompetencyId: item.sub_competency_id,
        intendedK: item.intended_k,
        intendedU: item.intended_u,
        intendedD: item.intended_d,
        confidence: item.confidence,
        rationale: item.rationale,
      });
    }

    // Persist + record spend.  recordSpend always fires once the AI call
    // succeeded (mirrors the prereq-edges fix pattern).
    let dbError: unknown;
    try {
      await replaceIntendedCoverage(code, validRows, result.model);
    } catch (e) {
      dbError = e;
    } finally {
      await recordSpend(result.costUsdCents);
    }

    if (dbError !== undefined) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      if (mode === 'one') {
        return NextResponse.json({ error: msg.slice(0, 400) }, { status: 500 });
      }
      // In loop mode: continue to next course even if DB write failed.
      continue;
    }

    seeded.push({ code, count: validRows.length });

    // Suppress unused-variable warning (droppedUnknown is informational;
    // keeping it explicit here in case we want to surface it later).
    void droppedUnknown;
  }

  const response: {
    seeded: typeof seeded;
    skippedNoCatalogText?: string[];
    stoppedAtCap?: boolean;
  } = { seeded };

  if (skippedNoCatalogText.length > 0) {
    response.skippedNoCatalogText = skippedNoCatalogText;
  }
  if (stoppedAtCap) {
    response.stoppedAtCap = true;
  }

  return NextResponse.json(response);
}
