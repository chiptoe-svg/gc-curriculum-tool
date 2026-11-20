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
import { isSubCompetencyDefinition } from '@/lib/domain/types';
import { computePrereqGaps } from '@/lib/program/prereq-gaps';
import { countWhatIfsByCourse } from '@/lib/db/what-if-queries';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import type { SubCompetencyGap } from '@/lib/program/prereq-gaps';
import { depthBand } from '@/lib/program/depth-band';
import { PrereqEdgesClient } from './PrereqEdgesClient';
import { FeedbackLink } from '@/app/FeedbackLink';
import { CourseStrings } from '@/components/strings/CourseStrings';
import '@/components/strings/strings.css';
import '@/app/build/build.css';
import '../courses.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ slug?: string }>;
}

// ─── Gap status badge ────────────────────────────────────────────────────

function GapBadge({ status }: { status: SubCompetencyGap['status'] }) {
  if (status === 'met') return <span className="cs-cue cs-cue-done">Met</span>;
  if (status === 'gap') return <span className="cs-cue cs-cue-issue">Gap</span>;
  // no_data
  return <span className="cs-cue cs-cue-draft">No data</span>;
}

// ─── KUD value cell ──────────────────────────────────────────────────────

/** Design-system D0-D5 ramp class for a 0-5 level; anything else stays neutral. */
const levelClass = (v: number | null) => (v === null || v < 0 || v > 5 ? 'cs-dnone' : `cs-d${Math.floor(v)}`);

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
  // A7 (2026-06-12): chip shows depth BANDS (— / L / W / H) — the resolution
  // the instrument is known to support; the exact integers stay in the
  // tooltip. See lib/program/depth-band.ts.
  // Restyle: the needed band sits on the D0-D5 ramp; a red outline marks a gap.
  return (
    <span
      className={`cs-chip ${hasGap ? 'cs-chip-gap' : ''}`}
      title={`${label}: needs ${needed} (${depthBand(needed)?.word}), delivered ${delivered ?? '?'}${delivered != null ? ` (${depthBand(delivered)?.word})` : ''} — exact values; bands shown in chip`}
    >
      <span>{label}</span>
      <span>{depthBand(delivered)?.short ?? '?'}→</span>
      <span className={`cs-lv ${levelClass(needed)}`}>{depthBand(needed)?.short}</span>
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
      <p className="cs-meta">
        No confirmed edges yet — confirm edges above to run the gap analysis.
      </p>
    );
  }

  const met = gaps.filter((g) => g.status === 'met').length;
  const gapped = gaps.filter((g) => g.status === 'gap').length;
  const noData = gaps.filter((g) => g.status === 'no_data').length;

  return (
    <div className="cs-stack">
      {/* Summary bar */}
      <p className="cs-meta">
        Across {gaps.length} sub-competenc{gaps.length === 1 ? 'y' : 'ies'} covered by confirmed edges:{' '}
        {met > 0 && <strong>{met} met</strong>}
        {met > 0 && (gapped > 0 || noData > 0) && ', '}
        {gapped > 0 && <strong>{gapped} with gaps</strong>}
        {gapped > 0 && noData > 0 && ', '}
        {noData > 0 && <strong>{noData} no prerequisite data yet</strong>}.
      </p>

      {/* Gap rows */}
      <div className="cs-gaps">
        {gaps.map((g) => {
          const name = subCompNames[g.subCompetencyId] ?? g.subCompetencyId;
          return (
            <div key={g.subCompetencyId} className="cs-gap">
              {/* Name */}
              <div className="cs-gap-name">
                <p>{name}</p>
                {g.basis === 'intended' && (
                  <p className="cs-gap-note">
                    syllabus-promise — not verified
                  </p>
                )}
                {g.basis === 'mixed' && (
                  <p className="cs-gap-note">
                    partial — some prereqs unverified
                  </p>
                )}
                {g.contributingPrereqs.length > 0 && (
                  <p className="cs-gap-via">
                    via {g.contributingPrereqs.join(', ')}
                  </p>
                )}
              </div>

              {/* KUD dimension cells (only show dims where needed > 0) */}
              <div className="cs-gap-chips">
                {g.status === 'no_data' ? (
                  <span className="cs-meta">
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
              <div>
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
      <div className="cs-main is-narrow cs-center">
        <h1 className="cs-title">Access link required</h1>
        <p className="cs-meta mt-3">
          Open this page through the access link your administrator shared.
        </p>
      </div>
    );
  }

  const course = await getCourseByCode(code);
  if (!course) notFound();

  // Load edges, sub-competencies, and gap result in parallel
  const [edges, targets, gapResult, whatIfCounts] = await Promise.all([
    listEdgesForFocal(code),
    listTargets(),
    computePrereqGaps(code),
    countWhatIfsByCourse(),
  ]);
  const whatIfCount = whatIfCounts.get(code) ?? 0;
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
    // targets is always DB-resolved (listTargets), which never produces
    // `{ ref }` entries — the filter is just the type guard.
    for (const sc of t.subCompetencies.filter(isSubCompetencyDefinition)) {
      subCompNames[sc.id] = sc.name;
      allSubComps.push({ id: sc.id, name: sc.name, targetName: t.name });
    }
  }

  const { gaps } = gapResult;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="cs-header">
        <div className="cs-header-inner">
          <div>
            <p className="cs-eyebrow">
              Courses · {code}
            </p>
            <h1 className="cs-title">
              {course.title}
            </h1>
          </div>
          <div className="cs-nav">
            <Link
              href={`/explore/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
              className="cs-btn"
            >
              {WHAT_IF_COPY.linkLabel(whatIfCount)} →
            </Link>
            <Link
              href={`/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
              className="cs-btn"
            >
              Capture →
            </Link>
            <Link
              href={`/courses?slug=${encodeURIComponent(slug)}`}
              className="cs-btn"
            >
              ← Courses
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="cs-main cs-stack" style={{ gap: 40 }}>
        <CourseStrings courseCode={code} mode="course" query={`?slug=${encodeURIComponent(slug)}`} />


        {/* Course meta */}
        {course.prerequisites && (
          <section className="cs-stack" style={{ gap: 6 }}>
            <h2 className="cs-label">
              Catalog prerequisites
            </h2>
            <p className="cs-body">{course.prerequisites}</p>
          </section>
        )}

        {/* ── Section A: Edge confirm / edit ─────────────────────────────── */}
        <section className="cs-section">
          <div className="cs-stack" style={{ gap: 6 }}>
            <h2 className="cs-h2">Prerequisites</h2>
            <p className="cs-meta">
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
        <section className="cs-section">
          <div className="cs-stack" style={{ gap: 6 }}>
            <h2 className="cs-h2">
              Prerequisite gap analysis
            </h2>
            <p className="cs-meta">
              For each confirmed edge, compares what this course expects students to arrive with
              against what the prerequisite course's latest captured snapshot actually delivers.
              Only confirmed edges are included. <strong>Basis: measured</strong> uses the
              captured snapshot; <strong>partial</strong> means measured data exists but an
              unverified syllabus value raised the delivered figure on at least one dimension —
              treat as a caution; <strong>syllabus-promise</strong> means the prerequisite has
              not been captured at all and only intended coverage is available.
            </p>
          </div>

          <GapList gaps={gaps} subCompNames={subCompNames} />
        </section>

      </main>
    </div>
  );
}
