import Link from 'next/link';
import type { SVGProps } from 'react';
import { listCoursesWithStatus, type CaptureStatus } from '@/lib/db/capture-status-queries';
import { groupByCategory } from '@/lib/courses/group-by-category';
import { CATEGORY_LABELS } from '@/lib/db/course-category-seed';
import { listPairedCodesForCourses } from '@/lib/db/course-codes-queries';
import { formatCourseLabel, parseCourseCode } from '@/lib/courses/parse-course-code';
import { isProgramVisible } from '@/lib/courses/program-visibility';

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
 * The capture-flow faculty links (Edit, "+ Add a course") point at CAPTURE_ORIGIN
 * — the HTTPS origin serving the authenticated app under a trusted cert
 * (https://gc-alumni.com:8443) — so the in-browser mic works in the capture
 * interview even when this public catalog is viewed over plain HTTP on the LAN.
 * Unset → same-origin. The Ask link stays same-origin (chat, not the mic flow).
 * The public surface still never hosts a write path — these go to Basic-Auth'd
 * routes. (Was all same-origin 2026-06-24; capture links → CAPTURE_ORIGIN 2026-06-29.)
 */
export default async function HomePage() {
  const slug = process.env.PROTOTYPE_SLUG ?? '';
  // HTTPS origin for the authenticated capture flow (mic). See file header.
  const captureOrigin = process.env.CAPTURE_ORIGIN?.trim() ?? '';

  const rows = await listCoursesWithStatus();
  const pairedCodeRows = await listPairedCodesForCourses([...new Set(rows.map(r => r.code))]);
  const pairedByCode = new Map<string, Array<{ pairedCode: string }>>();
  for (const pc of pairedCodeRows) {
    const arr = pairedByCode.get(pc.courseCode) ?? [];
    arr.push({ pairedCode: pc.pairedCode });
    pairedByCode.set(pc.courseCode, arr);
  }
  const groups = groupByCategory(rows.filter(r => isProgramVisible({ scope: r.scope, status: r.courseStatus })));

  // Dedicated add-a-course page: code / title / catalog URL → straight into
  // CourseCapture (which uses the mic), so this link also targets CAPTURE_ORIGIN
  // (the HTTPS origin) — same reason as Edit. Same slug forwarding. (2026-06-29)
  const addCourseHref = slug
    ? `${captureOrigin}/courses/new?slug=${encodeURIComponent(slug)}`
    : null;

  // Curriculum adviser chat (/ask — streaming Q&A over the wiki). Faculty
  // surface (Basic Auth + slug). Kept SAME-ORIGIN (not CAPTURE_ORIGIN): it's a
  // text chat, not the mic capture flow, so it doesn't need the HTTPS origin.
  const askHref = slug
    ? `/ask?slug=${encodeURIComponent(slug)}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Clemson · Graphic Communications
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              Curriculum
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {askHref && (
              <a
                href={askHref}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                title="Ask the curriculum adviser — plain-language Q&A over the curriculum wiki (requires login)"
              >
                💬 Ask Curriculum Adviser
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <p className="max-w-3xl text-sm text-muted-foreground">
            A living map of the Graphic Communications curriculum. The tool distills the
            essence of each course into a course profile snapshot: the knowledge, understanding,
            and skills students should walk away with, scored at depth from evidence rather
            than syllabus aspiration. It will assemble these profiles into a program-wide picture of how the
            curriculum should build toward the careers it aims to prepare students for.
          </p>
          {addCourseHref && (
            <a
              href={addCourseHref}
              className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
              title="Add a course (requires login)"
            >
              + Add a course
            </a>
          )}
        </div>

        <div className="space-y-10">
          {groups.map(({ category, rows: catRows }) => (
            <section key={category}>
              <h2 className="mb-3 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {CATEGORY_LABELS[category]}
              </h2>
              <ul className="divide-y border-y">
                {catRows.map((row) => {
                  const editHref = slug
                    ? `${captureOrigin}/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`
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
                      className="grid grid-cols-[7rem_minmax(0,1fr)_auto_8rem_auto] items-baseline gap-x-4 py-3"
                    >
                      <Link
                        href={`/view/${encodeURIComponent(row.code)}`}
                        className="font-mono-plex text-sm text-foreground hover:text-muted-foreground"
                      >
                        {formatCourseLabel(displayCode, pairedByCode.get(row.code) ?? [])}
                      </Link>
                      <Link
                        href={`/view/${encodeURIComponent(row.code)}`}
                        className="flex items-baseline gap-1.5 font-display text-base text-foreground hover:text-muted-foreground"
                      >
                        <span>{row.title ?? '—'}</span>
                        {row.buildsToCareer && (
                          <span title="On the current core curriculum path" className="inline-flex">
                            <CurriculumPathIcon
                              className="h-3.5 w-3.5 shrink-0 translate-y-px text-emerald-600/70 dark:text-emerald-400/70"
                              aria-label="On the current core curriculum path"
                            />
                          </span>
                        )}
                      </Link>
                      <StatusPill status={row.status} />
                      <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {row.lastCapturedAt
                          ? `${formatDate(row.lastCapturedAt)}${row.lastCapturedBy ? ` · ${row.lastCapturedBy}` : ''}`
                          : ''}
                      </span>
                      <span className="flex items-baseline gap-3 justify-end">
                        <Link
                          href={`/view/${encodeURIComponent(row.code)}`}
                          className="text-sm text-muted-foreground hover:text-foreground"
                        >
                          View →
                        </Link>
                        {editHref && (
                          <a
                            href={editHref}
                            className="text-sm text-muted-foreground hover:text-foreground"
                            title="Faculty edit (requires login)"
                          >
                            Edit ↗
                          </a>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-10 flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
          <CurriculumPathIcon className="inline h-3.5 w-3.5 shrink-0 text-emerald-600/70 dark:text-emerald-400/70" aria-hidden />
          <span>marks the current core curriculum path: the courses that build toward our career outcomes.</span>
        </p>
      </main>
    </div>
  );
}

const STATUS_CONFIG: Record<CaptureStatus, { label: string; className: string }> = {
  captured:     { label: 'Captured',    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  reviewed:     { label: 'Reviewed',    className: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
  'ai-drafted': { label: 'In progress',  className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  'in-audit':   { label: 'In interview', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  'not-started':{ label: 'Not started', className: 'bg-stone-100 text-stone-600 dark:bg-stone-800/40 dark:text-stone-400' },
};

function StatusPill({ status }: { status: CaptureStatus }) {
  const { label, className } = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-body-sans text-[10px] uppercase tracking-[0.18em] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
