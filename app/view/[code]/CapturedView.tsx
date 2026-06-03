/**
 * Public read-only render of a captured course profile. Editorial framing,
 * not auditor framing — surfaces what a reader (chair, accreditor, student,
 * incoming faculty) actually wants to know:
 *
 *   - The essence (what the course really is)
 *   - What students leave able to do (competencies as statements + the
 *     D-evidence sentence that shows what they actually produce)
 *   - Where this differs from the catalog (catalog_vs_evidence delta +
 *     suggested catalog rewrites)
 *   - What students walk in with (incoming_expectations)
 *   - Strongest evidence behind the capture (small, near the end)
 *
 * Hidden on this page (auditor-only — visible on the HTTPS Edit page):
 *   - K/U/D depth scores (calibration internals)
 *   - Citation chunk IDs and source flags
 *   - prereq_gaps, cross_source_conflicts, objective_misalignments,
 *     productive_failure_conditions, audit_notes.source
 */

interface Props {
  profile: unknown; // CaptureProfile JSON from snapshots — shape varies across v1/v2
  capturedAt: Date | string;
}

interface CompetencyShape {
  statement?: string;
  evidence_d?: string;
  type?: string;
}

interface IncomingExpectationShape {
  statement?: string;
  confidence?: string;
}

interface CapturedProfile {
  verification_summary?: {
    course_shape?: string;
    strongest_evidence?: string[];
    catalog_vs_evidence?: string[];
  };
  audit_notes?: {
    suggested_objective_revisions?: string[];
  };
  competencies?: CompetencyShape[];
  incoming_expectations?: IncomingExpectationShape[];
  overview?: {
    narrative?: string;
  };
}

function isCapturedProfile(p: unknown): p is CapturedProfile {
  return typeof p === 'object' && p !== null;
}

export function CapturedView({ profile, capturedAt }: Props) {
  if (!isCapturedProfile(profile)) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        Profile data is in an unexpected shape and can&apos;t be rendered here.
      </div>
    );
  }

  const date = typeof capturedAt === 'string' ? new Date(capturedAt) : capturedAt;

  const essence = profile.verification_summary?.course_shape || profile.overview?.narrative;
  const outcomes = (profile.competencies ?? []).filter(c => c.statement);
  const catalogDelta = profile.verification_summary?.catalog_vs_evidence ?? [];
  const suggestedRewrites = profile.audit_notes?.suggested_objective_revisions ?? [];
  const incoming = (profile.incoming_expectations ?? []).filter(e => e.statement);
  const strongest = profile.verification_summary?.strongest_evidence ?? [];

  return (
    <article className="space-y-12">
      <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Captured {date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {essence && (
        <section>
          <p className="font-display text-lg leading-relaxed text-foreground">
            {essence}
          </p>
        </section>
      )}

      {outcomes.length > 0 && (
        <section>
          <h2 className="mb-4 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            What students leave able to do
          </h2>
          <ul className="space-y-5">
            {outcomes.map((c, i) => (
              <li key={i} className="border-l-2 border-stone-200 pl-4 dark:border-stone-700">
                <p className="font-display text-base leading-snug text-foreground">
                  {c.statement}
                </p>
                {c.evidence_d && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em]">Evidence: </span>
                    {c.evidence_d}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(catalogDelta.length > 0 || suggestedRewrites.length > 0) && (
        <section>
          <h2 className="mb-4 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Where this differs from the catalog
          </h2>
          {catalogDelta.length > 0 && (
            <ul className="mb-6 space-y-2">
              {catalogDelta.map((bullet, i) => (
                <li key={i} className="text-sm leading-relaxed text-foreground">
                  — {bullet}
                </li>
              ))}
            </ul>
          )}
          {suggestedRewrites.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/10">
              <p className="mb-2 font-mono-plex text-[10px] uppercase tracking-[0.16em] text-amber-900 dark:text-amber-300">
                Proposed catalog rewrite
              </p>
              <ul className="space-y-1.5">
                {suggestedRewrites.map((rev, i) => (
                  <li key={i} className="text-sm leading-relaxed text-amber-950 dark:text-amber-100">
                    — {rev}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {incoming.length > 0 && (
        <section>
          <h2 className="mb-4 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            What students walk in with
          </h2>
          <ul className="space-y-2">
            {incoming.map((e, i) => (
              <li key={i} className="text-sm leading-relaxed text-foreground">
                — {e.statement}
              </li>
            ))}
          </ul>
        </section>
      )}

      {strongest.length > 0 && (
        <section className="border-t pt-6">
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Strongest evidence behind this capture
          </h2>
          <ul className="space-y-1">
            {strongest.map((s, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                — {s}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
