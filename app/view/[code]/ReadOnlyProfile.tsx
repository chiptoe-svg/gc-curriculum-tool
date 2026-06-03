/**
 * Read-only profile renderer. No edit affordances, no client-side
 * state. Renders the captured profile JSON as static markup.
 *
 * Intentionally minimal — we're showing the canonical-shaped data
 * (overview narrative, competencies, audit notes, course emphasis)
 * with no edit chrome. Reuses the same Tailwind tokens as
 * ProfileReviewPanel but doesn't share its component tree to avoid
 * inheriting any client-state assumptions.
 */
interface Props {
  profile: unknown; // CaptureProfile JSON from snapshots — shape varies across v1/v2
  capturedAt: Date | string;
}

interface MinimalProfile {
  overview?: {
    narrative?: string;
    at_a_glance?: string[];
    who_for?: string;
    arc?: string;
  };
  competencies?: Array<{
    name: string;
    k?: number | null;
    u?: number | null;
    d?: number | null;
    rationale?: string;
  }>;
  course_emphasis?: Array<{
    competency: string;
    share_pct?: number;
    centrality?: string;
  }>;
}

function isMinimalProfile(p: unknown): p is MinimalProfile {
  return typeof p === 'object' && p !== null;
}

export function ReadOnlyProfile({ profile, capturedAt }: Props) {
  if (!isMinimalProfile(profile)) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        Profile data is in an unexpected shape and can&apos;t be rendered here.
      </div>
    );
  }

  const date =
    typeof capturedAt === 'string'
      ? new Date(capturedAt)
      : capturedAt;

  return (
    <article className="space-y-8">
      <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Captured {date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {profile.overview?.narrative && (
        <section>
          <h2 className="sr-only">Overview</h2>
          <p className="font-display text-lg leading-relaxed">{profile.overview.narrative}</p>
        </section>
      )}

      {profile.overview?.at_a_glance && profile.overview.at_a_glance.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            At a glance
          </h2>
          <ul className="space-y-1">
            {profile.overview.at_a_glance.map((bullet, i) => (
              <li key={i} className="text-sm">— {bullet}</li>
            ))}
          </ul>
        </section>
      )}

      {profile.competencies && profile.competencies.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold">Competencies</h2>
          <div className="space-y-3">
            {profile.competencies.map((c, i) => (
              <div key={i} className="rounded-md border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono-plex text-xs text-muted-foreground">
                    K{c.k ?? '—'} · U{c.u ?? '—'} · D{c.d ?? '—'}
                  </span>
                </div>
                {c.rationale && (
                  <p className="mt-1 text-sm text-muted-foreground">{c.rationale}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {profile.course_emphasis && profile.course_emphasis.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold">Course emphasis</h2>
          <div className="space-y-1">
            {profile.course_emphasis.map((e, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2 text-sm">
                <span>{e.competency}</span>
                <span className="font-mono-plex text-xs text-muted-foreground">
                  {e.share_pct != null ? `${e.share_pct.toFixed(0)}%` : '—'} {e.centrality ?? ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
