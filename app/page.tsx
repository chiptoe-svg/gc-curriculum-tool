import Link from 'next/link';
import { listCoursesWithStatus, type CaptureStatus, type CourseStatusRow } from '@/lib/db/capture-status-queries';

export const dynamic = 'force-dynamic';

/**
 * Public HTTP landing page. No slug, no Basic Auth.
 *
 * Two link types per course:
 *   - View → /view/[code] (HTTP, read-only, public)
 *   - Edit → https://<funnel>/capture/[code]?slug=<PROTOTYPE_SLUG>
 *            (Basic Auth challenge on the HTTPS funnel)
 *
 * Faculty visit once, click Edit, enter Basic Auth, and the browser
 * caches credentials for the HTTPS origin for the rest of the session.
 *
 * The slug is baked into Edit links server-side from PROTOTYPE_SLUG
 * (the same slug acting as the deeper-layer access gate); faculty
 * don't need to know or type it.
 */
export default async function HomePage() {
  const slug = process.env.PROTOTYPE_SLUG ?? '';
  const funnelOrigin = process.env.TAILSCALE_FUNNEL_ORIGIN ?? '';

  const rows = await listCoursesWithStatus();
  rows.sort((a, b) => (a.level ?? Number.POSITIVE_INFINITY) - (b.level ?? Number.POSITIVE_INFINITY)
    || a.code.localeCompare(b.code));

  // Group by 1000/2000/3000/4000-level. Null level → "Other" (matches /courses).
  const groups = new Map<number | null, CourseStatusRow[]>();
  for (const r of rows) {
    const key = r.level ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  // Numeric levels ascending, then null ("Other") last.
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  const facultyHubHref = funnelOrigin && slug
    ? `${funnelOrigin}/courses?slug=${encodeURIComponent(slug)}`
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
          {facultyHubHref && (
            <a
              href={facultyHubHref}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
              title="Faculty hub (requires login)"
            >
              Faculty hub →
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <p className="mb-8 max-w-3xl text-sm text-muted-foreground">
          What every course in the Graphic Communications curriculum builds.
          Anyone can read profiles; faculty edit via the HTTPS hub.
        </p>

        <div className="space-y-10">
          {orderedKeys.map((key) => (
            <section key={key ?? 'other'}>
              <h2 className="mb-3 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {levelLabel(key)}
              </h2>
              <ul className="divide-y border-y">
                {groups.get(key)!.map((row) => {
                  const editHref = funnelOrigin && slug
                    ? `${funnelOrigin}/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`
                    : null;
                  return (
                    <li
                      key={row.code}
                      className="grid grid-cols-[7rem_minmax(0,1fr)_auto_8rem_auto] items-baseline gap-x-4 py-3"
                    >
                      <Link
                        href={`/view/${encodeURIComponent(row.code)}`}
                        className="font-mono-plex text-sm text-foreground hover:text-muted-foreground"
                      >
                        {row.code}
                      </Link>
                      <Link
                        href={`/view/${encodeURIComponent(row.code)}`}
                        className="font-display text-base text-foreground hover:text-muted-foreground"
                      >
                        {row.title ?? '—'}
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
      </main>
    </div>
  );
}

const STATUS_CONFIG: Record<CaptureStatus, { label: string; className: string }> = {
  captured:     { label: 'Captured',    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  reviewed:     { label: 'Reviewed',    className: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
  'ai-drafted': { label: 'AI drafted',  className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  'in-audit':   { label: 'In audit',    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
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

function levelLabel(key: number | null): string {
  if (key === null) return 'Other';
  return `${key}000-level`;
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
