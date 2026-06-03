import Link from 'next/link';
import { listCoursesWithStatus } from '@/lib/db/capture-status-queries';

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
  rows.sort((a, b) => (a.level ?? 9999) - (b.level ?? 9999) || a.code.localeCompare(b.code));

  // Group by 1000/2000/3000/4000-level (matches the existing /courses page).
  const groups = new Map<number, typeof rows>();
  for (const r of rows) {
    const lvl = r.level ?? 9999;
    const bucket = Math.floor(lvl / 1000) * 1000;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(r);
  }
  const orderedBuckets = Array.from(groups.keys()).sort((a, b) => a - b);

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
          {orderedBuckets.map((bucket) => (
            <section key={bucket}>
              <h2 className="mb-3 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {bucket}-level
              </h2>
              <ul className="divide-y border-y">
                {groups.get(bucket)!.map((row) => {
                  const editHref = funnelOrigin && slug
                    ? `${funnelOrigin}/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`
                    : null;
                  return (
                    <li key={row.code} className="grid grid-cols-[8rem_1fr_auto] items-baseline gap-4 py-3">
                      <span className="font-mono-plex text-sm">{row.code}</span>
                      <span className="font-display text-base">{row.title ?? '—'}</span>
                      <span className="flex items-baseline gap-3">
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
