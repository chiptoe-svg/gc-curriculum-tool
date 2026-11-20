import Link from 'next/link';
import type { SVGProps } from 'react';
import { CaptureLink } from '@/components/CaptureLink';
import { listCoursesWithStatus, type CaptureStatus } from '@/lib/db/capture-status-queries';
import { groupByCategory } from '@/lib/courses/group-by-category';
import { CATEGORY_LABELS } from '@/lib/db/course-category-seed';
import { listPairedCodesForCourses } from '@/lib/db/course-codes-queries';
import { formatCourseLabel, parseCourseCode } from '@/lib/courses/parse-course-code';
import { isProgramVisible } from '@/lib/courses/program-visibility';
import './home.css';

export const dynamic = 'force-dynamic';

/**
 * "Current core curriculum path" marker: a dotted, jagged line with a point at
 * each end. Custom glyph (no lucide equivalent). Uses currentColor; size via className.
 */
function CurriculumPathIcon({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <polyline points="4 18 9 11 13 16 20 6" strokeDasharray="2 3.5" />
      <circle cx="4" cy="18" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="20" cy="6" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Public HTTP landing page. No slug, no Basic Auth.
 *
 * Courses are grouped by `category` (GC Core -> Specialty -> Major Req -> Other).
 * Courses on the current core curriculum path (build toward the career mapping) carry a custom
 * path marker (a dotted, jagged line with a point at each end).
 *
 * Two link types per course:
 *   - View -> /view/[code] (read-only, public)
 *   - Edit -> /capture/[code]?slug=<PROTOTYPE_SLUG> (Basic Auth)
 *
 * The capture-flow faculty links (Edit) are <CaptureLink>s:
 * they prefer the voice-capable HTTPS origin (NEXT_PUBLIC_VOICE_ORIGIN, the
 * Funnel) and fall back to a reliable direct origin (NEXT_PUBLIC_FALLBACK_ORIGIN
 * — on-campus HTTP, typed) when the voice origin isn't reachable, giving
 * on-campus faculty automatic "funnel-until-it-isn't, then typed" behavior. The
 * Ask link stays a plain same-origin <a> (chat, no mic). The public surface
 * still never hosts a write path — these go to Basic-Auth'd routes. (Superseded
 * the sinkholed CAPTURE_ORIGIN / gc-alumni.com approach 2026-07-02.)
 */
export default async function HomePage() {
  const slug = process.env.PROTOTYPE_SLUG ?? '';

  const rows = await listCoursesWithStatus();
  const pairedCodeRows = await listPairedCodesForCourses([...new Set(rows.map(r => r.code))]);
  const pairedByCode = new Map<string, Array<{ pairedCode: string }>>();
  for (const pc of pairedCodeRows) {
    const arr = pairedByCode.get(pc.courseCode) ?? [];
    arr.push({ pairedCode: pc.pairedCode });
    pairedByCode.set(pc.courseCode, arr);
  }
  const groups = groupByCategory(rows.filter(r => isProgramVisible({ scope: r.scope, status: r.courseStatus })));

  // Curriculum adviser chat (/ask — streaming Q&A). Faculty surface (Basic Auth
  // + slug). Plain same-origin <a> (NOT a CaptureLink): text chat, no mic, so it
  // doesn't need the voice origin / probe.
  const askHref = slug
    ? `/ask?slug=${encodeURIComponent(slug)}`
    : null;
  // Program coverage map (faculty surface, same gate as /ask). Kept subtle: the
  // page title itself links there rather than adding another button.
  const programHref = slug
    ? `/program?slug=${encodeURIComponent(slug)}`
    : null;

  const navBtn = 'home-btn';
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-[#E4E2E8] bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <p className="home-eyebrow">Clemson · Graphic Communications</p>
            <h1 className="home-title mt-1 text-[28px] leading-tight">
              {programHref ? (
                <a
                  href={programHref}
                  title="Program coverage map: every course against the career targets (requires login)"
                >
                  Curriculum
                </a>
              ) : 'Curriculum'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CaptureLink
              path="/curriculum/howto"
              className={navBtn}
              title="Step-by-step: how to capture a course, with screenshots (requires login)"
            >
              How to capture a course
            </CaptureLink>
            {slug && (
              <a
                href={`/build?slug=${encodeURIComponent(slug)}`}
                className={navBtn}
                title="Curriculum builder: stack courses across the three acts and see how they build toward a career path (requires login)"
              >
                Curriculum builder
              </a>
            )}
            {askHref && (
              <a
                href={askHref}
                className={navBtn}
                title="Ask the curriculum adviser — plain-language Q&A over the curriculum wiki (requires login)"
              >
                💬 Ask Curriculum Adviser
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <p className="home-lede">
            A living map of the Graphic Communications curriculum. The tool distills the
            essence of each course into a course profile snapshot: the knowledge, understanding,
            and skills students should walk away with, scored at depth from evidence rather
            than syllabus aspiration. It will assemble these profiles into a program-wide picture of how the
            curriculum should build toward the careers it aims to prepare students for.
          </p>
        </div>

        <div className="space-y-10">
          {groups.map(({ category, rows: catRows }) => (
            <section key={category}>
              <h2 className="home-label mb-3">
                {CATEGORY_LABELS[category]}
              </h2>
              <ul className="home-list">
                {catRows.map((row) => {
                  const editHref = slug
                    ? `/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`
                    : null;
                  // Drop the special-topics letter suffix for display (GC 4900ap → GC 4900):
                  // the title disambiguates the section, so the bare number reads cleaner here.
                  // row.code stays the canonical PK for every link/href below.
                  const parsedCode = parseCourseCode(row.code);
                  const displayCode = parsedCode.number !== null && parsedCode.suffix
                    ? `${parsedCode.prefix} ${parsedCode.number}`
                    : row.code;
                  return (
                    <li
                      key={row.code}
                      className="home-row"
                    >
                      <Link
                        href={`/view/${encodeURIComponent(row.code)}`}
                        className="home-code"
                      >
                        {formatCourseLabel(displayCode, pairedByCode.get(row.code) ?? [])}
                      </Link>
                      <Link
                        href={`/view/${encodeURIComponent(row.code)}`}
                        className="home-name flex items-baseline gap-1.5"
                      >
                        <span>{row.title ?? '—'}</span>
                        {row.buildsToCareer && (
                          <span title="On the current core curriculum path" className="inline-flex">
                            <CurriculumPathIcon
                              className="home-path h-3.5 w-3.5 shrink-0 translate-y-px"
                              aria-label="On the current core curriculum path"
                            />
                          </span>
                        )}
                      </Link>
                      <StatusPill status={row.status} />
                      <span className="home-meta">
                        {row.lastCapturedAt
                          ? `${formatDate(row.lastCapturedAt)}${row.lastCapturedBy ? ` · ${row.lastCapturedBy}` : ''}`
                          : ''}
                      </span>
                      <span className="home-actions flex items-baseline justify-end gap-4">
                        <Link
                          href={`/view/${encodeURIComponent(row.code)}`}
                          className="home-link"
                        >
                          View →
                        </Link>
                        {editHref && (
                          <CaptureLink
                            path={editHref}
                            className="home-link"
                            title="Faculty edit (requires login)"
                          >
                            Edit ↗
                          </CaptureLink>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-10 flex items-center gap-2 border-t border-[#DCD9E2] pt-4 text-[13px] text-muted-foreground">
          <CurriculumPathIcon className="home-path inline h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>marks the current core curriculum path: the courses that build toward our career outcomes.</span>
        </p>
      </main>
    </div>
  );
}

const STATUS_CONFIG: Record<CaptureStatus, { label: string; className: string }> = {
  captured:     { label: 'Captured',     className: 'home-cue-done' },
  reviewed:     { label: 'Reviewed',     className: 'home-cue-read' },
  'ai-drafted': { label: 'In progress',  className: 'home-cue-draft' },
  'in-audit':   { label: 'In interview', className: 'home-cue-input' },
  'not-started':{ label: 'Not started',  className: 'home-cue-none' },
};

function StatusPill({ status }: { status: CaptureStatus }) {
  const { label, className } = STATUS_CONFIG[status];
  return <span className={`home-cue ${className}`}>{label}</span>;
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
