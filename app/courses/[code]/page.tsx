/**
 * /courses/[code] — per-course prerequisite view.
 *
 * Section A (client island):  seed / confirm / edit / delete prerequisite edges.
 * Section B (server-rendered): deterministic gap result from computePrereqGaps.
 *
 * Design: docs/superpowers/plans/2026-06-05-prerequisite-edges.md  Task 8
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode, courseExists } from '@/lib/db/courses-queries';
import { listEdgesForFocal } from '@/lib/db/prerequisite-edge-queries';
import { listTargets } from '@/lib/db/career-targets-queries';
import { computePrereqGaps } from '@/lib/program/prereq-gaps';
import type { SubCompetencyGap } from '@/lib/program/prereq-gaps';
import { PrereqEdgesClient } from './PrereqEdgesClient';
import { FeedbackLink } from '@/app/FeedbackLink';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ slug?: string }>;
}

// ─── Gap status badge ────────────────────────────────────────────────────

function GapBadge({ status }: { status: SubCompetencyGap['status'] }) {
  if (status === 'met') {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 font-body-sans text-[10px] uppercase tracking-[0.14em] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
        Met
      </span>
    );
  }
  if (status === 'gap') {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 font-body-sans text-[10px] uppercase tracking-[0.14em] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
        Gap
      </span>
    );
  }
  // no_data
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 font-body-sans text-[10px] uppercase tracking-[0.14em] font-medium bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
      No data
    </span>
  );
}

// ─── KUD value cell ──────────────────────────────────────────────────────

function KudCell({
  label,
  needed,
  delivered,
  gapVal,
}: {
  label: string;
  needed: number | null;
  delivered: number | null;
  gapVal: number;
}) {
  if (needed == null) return null;
  const hasGap = gapVal > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono-plex text-[11px]
        ${hasGap
          ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
          : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
        }`}
      title={`${label}: needs ${needed}, delivered ${delivered ?? '?'}`}
    >
      <span className="font-medium">{label}</span>
      <span className="text-[9px] text-muted-foreground">{delivered ?? '?'}→{needed}</span>
    </span>
  );
}

// ─── Deterministic gap list ─────────────────────────────────────────────

function GapList({
  gaps,
  subCompNames,
}: {
  gaps: SubCompetencyGap[];
  subCompNames: Record<string, string>;
}) {
  if (gaps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No confirmed edges yet — confirm edges above to run the gap analysis.
      </p>
    );
  }

  const met = gaps.filter((g) => g.status === 'met').length;
  const gapped = gaps.filter((g) => g.status === 'gap').length;
  const noData = gaps.filter((g) => g.status === 'no_data').length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        Across {gaps.length} sub-competenc{gaps.length === 1 ? 'y' : 'ies'} covered by confirmed edges:{' '}
        {met > 0 && <strong className="text-foreground">{met} met</strong>}
        {met > 0 && (gapped > 0 || noData > 0) && ', '}
        {gapped > 0 && <strong className="text-foreground">{gapped} with gaps</strong>}
        {gapped > 0 && noData > 0 && ', '}
        {noData > 0 && <strong className="text-foreground">{noData} no prerequisite data yet</strong>}.
      </p>

      {/* Gap rows */}
      <div className="divide-y divide-border rounded border border-border">
        {gaps.map((g) => {
          const name = subCompNames[g.subCompetencyId] ?? g.subCompetencyId;
          return (
            <div key={g.subCompetencyId} className="flex flex-wrap items-start gap-3 px-4 py-3">
              {/* Name */}
              <div className="flex-1 min-w-[12rem]">
                <p className="text-sm font-medium leading-snug">{name}</p>
                {g.basis === 'intended' && (
                  <p className="mt-0.5 font-body-sans text-[10px] italic text-amber-700 dark:text-amber-400">
                    syllabus-promise — not verified
                  </p>
                )}
                {g.contributingPrereqs.length > 0 && (
                  <p className="mt-0.5 font-mono-plex text-[9px] text-muted-foreground/60">
                    via {g.contributingPrereqs.join(', ')}
                  </p>
                )}
              </div>

              {/* KUD dimension cells (only show dims where needed > 0) */}
              <div className="flex flex-wrap items-center gap-1.5">
                {g.status === 'no_data' ? (
                  <span className="text-xs text-muted-foreground italic">
                    prerequisite not yet captured
                  </span>
                ) : (
                  <>
                    <KudCell
                      label="K"
                      needed={g.needed.k}
                      delivered={g.delivered.k}
                      gapVal={g.gap.k}
                    />
                    <KudCell
                      label="U"
                      needed={g.needed.u}
                      delivered={g.delivered.u}
                      gapVal={g.gap.u}
                    />
                    <KudCell
                      label="D"
                      needed={g.needed.d}
                      delivered={g.delivered.d}
                      gapVal={g.gap.d}
                    />
                  </>
                )}
              </div>

              {/* Status badge */}
              <div className="shrink-0">
                <GapBadge status={g.status} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default async function CourseDetailPage({ params, searchParams }: Props) {
  const { code: rawCode } = await params;
  const { slug = '' } = await searchParams;
  const code = decodeURIComponent(rawCode);

  // Auth gate
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">
          Open this page through the access link your administrator shared.
        </p>
      </div>
    );
  }

  const course = await getCourseByCode(code);
  if (!course) notFound();

  // Load edges, sub-competencies, and gap result in parallel
  const [edges, targets, gapResult] = await Promise.all([
    listEdgesForFocal(code),
    listTargets(),
    computePrereqGaps(code),
  ]);

  // Inline unknown-prereq detection (mirrors GET handler logic)
  const edgeCodes = [...new Set(edges.map((e) => e.prereqCourseCode))];
  const proseCodes: string[] = (course.prerequisites ?? '')
    .match(/GC\s?\d{3,4}\w*/gi)
    ?.map((m: string) => m.replace(/\s+/, ' ').toUpperCase()) ?? [];
  const allCandidateCodes = [...new Set([...edgeCodes, ...proseCodes])];
  const unknownPrereqs: string[] = [];
  await Promise.all(
    allCandidateCodes.map(async (c) => {
      const exists = await courseExists(c);
      if (!exists) unknownPrereqs.push(c);
    }),
  );
  unknownPrereqs.sort();

  // Build sub-comp lookup: id → name
  const subCompNames: Record<string, string> = {};
  const allSubComps: Array<{ id: string; name: string; targetName: string }> = [];
  for (const t of targets) {
    for (const sc of t.subCompetencies) {
      subCompNames[sc.id] = sc.name;
      allSubComps.push({ id: sc.id, name: sc.name, targetName: t.name });
    }
  }

  const { gaps } = gapResult;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Courses · {code}
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              {course.title}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href={`/explore/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Explore →
            </Link>
            <Link
              href={`/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Capture →
            </Link>
            <Link
              href={`/courses?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Courses
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-10">

        {/* Course meta */}
        {course.prerequisites && (
          <section>
            <h2 className="mb-1 font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Catalog prerequisites
            </h2>
            <p className="text-sm text-foreground/80">{course.prerequisites}</p>
          </section>
        )}

        {/* ── Section A: Edge confirm / edit ─────────────────────────────── */}
        <section>
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold tracking-tight">Prerequisites</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tag which sub-competencies each prerequisite course must have developed — and to what
              depth — for students to succeed in this course. Confirmed edges drive the gap analysis
              below.
            </p>
          </div>

          <PrereqEdgesClient
            code={code}
            slug={slug}
            initialEdges={edges}
            initialUnknownPrereqs={unknownPrereqs}
            subCompNames={subCompNames}
            allSubComps={allSubComps}
          />
        </section>

        {/* ── Section B: Deterministic gap view ──────────────────────────── */}
        <section>
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Prerequisite gap analysis
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              For each confirmed edge, compares what this course expects students to arrive with
              against what the prerequisite course's latest captured snapshot actually delivers.
              Only confirmed edges are included. <strong>Basis: measured</strong> uses the captured
              snapshot; <strong>syllabus-promise</strong> means the prerequisite has not been
              captured yet and intended coverage was used instead.
            </p>
          </div>

          <GapList gaps={gaps} subCompNames={subCompNames} />
        </section>

      </main>
    </div>
  );
}
