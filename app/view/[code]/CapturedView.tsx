import type { PfCond, Area7Block } from '@/lib/ai/capture/area7-types';

/**
 * Public read-only render of a captured course profile. Editorial framing,
 * not auditor framing — surfaces what a reader (chair, accreditor, student,
 * incoming faculty) actually wants to know:
 *
 *   - The course's essence (overview narrative, drop-capped first paragraph)
 *   - At-a-glance bullets, who-it's-for, the-arc
 *   - What students leave able to do — competencies WITH K/U/D depth ratings
 *     (foundational competencies show only D; technical show all three)
 *   - Where this differs from the catalog
 *   - What students walk in with
 *   - Strongest evidence behind the capture (small, near the end)
 *
 * Hidden on this page (auditor-only — visible on the HTTPS Edit page):
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
  evidence_k?: string;
  evidence_u?: string;
  k_depth?: number | null;
  u_depth?: number | null;
  d_depth?: number | null;
  type?: string;
  rationale?: string;
}

interface IncomingExpectationShape {
  statement?: string;
  confidence?: string;
  expected_depth?: { k?: number | null; u?: number | null; d?: number | null };
}

interface OverviewShape {
  narrative?: string;
  at_a_glance?: string[];
  who_for?: string;
  arc?: string;
}

interface CapturedProfile {
  verification_summary?: {
    course_shape?: string;
    strongest_evidence?: string[];
    catalog_vs_evidence?: string[];
  };
  audit_notes?: {
    suggested_objective_revisions?: string[];
    productive_failure_conditions?: Area7Block | null;
  };
  competencies?: CompetencyShape[];
  incoming_expectations?: IncomingExpectationShape[];
  overview?: OverviewShape;
  revised_objectives_draft?: string[] | null;
  class_structure?: { topics?: string[]; cadence?: string; assessment?: string } | null;
  major_projects?: { title?: string; description?: string; competencies?: string[] }[] | null;
  course_emphasis?: { competency: string; points: number; share_pct: number; centrality: 'central' | 'supporting' | 'peripheral' }[] | null;
}

function isCapturedProfile(p: unknown): p is CapturedProfile {
  return typeof p === 'object' && p !== null;
}

/** One K/U/D depth chip. Renders "K 3" with a label; muted when null. */
function DepthChip({ label, value }: { label: 'K' | 'U' | 'D'; value: number | null | undefined }) {
  const isNull = value == null;
  const tone =
    isNull ? 'border-stone-200 bg-stone-50 text-stone-400'
      : value >= 4 ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : value >= 2 ? 'border-amber-300 bg-amber-50 text-amber-900'
      : 'border-stone-300 bg-stone-50 text-stone-700';
  const labelText =
    label === 'K' ? 'Know' : label === 'U' ? 'Understand' : 'Do';
  return (
    <span
      title={`${labelText} — depth ${value ?? 'n/a'} on the 0–5 scale`}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono-plex text-[10px] uppercase tracking-[0.12em] ${tone}`}
    >
      <span className="font-semibold">{label}</span>
      <span>{isNull ? '—' : value}</span>
    </span>
  );
}


const AREA7_LABELS: { key: keyof Area7Block; label: string }[] = [
  { key: 'generate_then_consolidate', label: 'Generate-then-consolidate' },
  { key: 'open_ended_problems', label: 'Open-ended ill-structured problems' },
  { key: 'revision_cycles', label: 'Revision cycles with consequential failure' },
  { key: 'structured_post_mortem', label: 'Structured post-mortem' },
  { key: 'abstraction_bridging', label: 'Abstraction-and-bridging (transfer)' },
];

function condTone(v: PfCond | undefined): { text: string; cls: string } {
  if (v === undefined) return { text: 'not assessed', cls: 'text-muted-foreground/70 italic' };
  if (v === 'present') return { text: 'present', cls: 'text-emerald-700' };
  if (v === 'partial') return { text: 'partial', cls: 'text-amber-700' };
  return { text: 'absent', cls: 'text-muted-foreground' };
}

/** Per-course Audit Area 7 conditions block. Renders nothing when not assessed (null). */
export function Area7Conditions({ block }: { block: Area7Block | null | undefined }) {
  if (!block) return null;
  const depth = block.max_supporting_depth;
  return (
    <section>
      <h2 className="font-display text-lg font-semibold tracking-tight">Productive-failure &amp; transfer conditions</h2>
      <p className="mt-1 text-sm text-muted-foreground">What the course does to develop transferable problem-solving (Audit Area 7). A missing row means that condition was not assessed — not that it is absent.</p>
      <ul className="mt-3 space-y-1.5">
        {AREA7_LABELS.map(({ key, label }) => {
          const tone = condTone(block[key] as PfCond | undefined);
          return (
            <li key={key} className="flex items-baseline justify-between gap-4 text-sm">
              <span>{label}</span>
              <span className={'shrink-0 font-medium ' + tone.cls}>{tone.text}</span>
            </li>
          );
        })}
      </ul>
      {depth != null && (
        <p className="mt-2 text-xs text-muted-foreground">Max supporting depth: <span className="font-medium text-foreground">D {depth}</span></p>
      )}
    </section>
  );
}

/** Format the narrative as paragraphs, drop-cap on the first paragraph. */
function NarrativeBlock({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div className="space-y-5">
      {paragraphs.map((p, i) => (
        <p
          key={i}
          className={
            i === 0
              ? 'font-display text-lg leading-relaxed text-foreground first-letter:float-left first-letter:mr-2 first-letter:font-display first-letter:text-6xl first-letter:font-semibold first-letter:leading-none'
              : 'font-display text-lg leading-relaxed text-foreground'
          }
        >
          {p}
        </p>
      ))}
    </div>
  );
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

  const narrative = profile.overview?.narrative ?? '';
  const atAGlance = profile.overview?.at_a_glance ?? [];
  const whoFor = profile.overview?.who_for ?? '';
  const arc = profile.overview?.arc ?? '';
  // Fallback essence sentence when overview.narrative is empty (legacy v1)
  const essence = !narrative ? profile.verification_summary?.course_shape : null;

  const outcomes = (profile.competencies ?? []).filter(c => c.statement);
  const catalogDelta = profile.verification_summary?.catalog_vs_evidence ?? [];
  const suggestedRewrites = profile.audit_notes?.suggested_objective_revisions ?? [];
  const incoming = (profile.incoming_expectations ?? []).filter(e => e.statement);
  const strongest = profile.verification_summary?.strongest_evidence ?? [];
  const apparentOutcomes = profile.revised_objectives_draft ?? [];
  const classStructure = profile.class_structure ?? null;
  const majorProjects = (profile.major_projects ?? []).filter(p => p.title);
  const emphasis = (profile.course_emphasis ?? []).filter(e => e.competency);
  const area7 = profile.audit_notes?.productive_failure_conditions ?? null;

  return (
    <article className="space-y-12">
      <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Captured {date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {/* Splash: narrative with drop cap */}
      {narrative && (
        <section>
          <NarrativeBlock text={narrative} />
        </section>
      )}
      {essence && !narrative && (
        <section>
          <p className="font-display text-lg leading-relaxed text-foreground">{essence}</p>
        </section>
      )}

      {/* At a glance */}
      {atAGlance.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            At a glance
          </h2>
          <ul className="space-y-2">
            {atAGlance.map((bullet, i) => (
              <li key={i} className="text-sm leading-relaxed text-foreground">— {bullet}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Who it's for + the arc — two column on wider screens */}
      {(whoFor || arc) && (
        <section className="grid gap-8 md:grid-cols-2">
          {whoFor && (
            <div>
              <h2 className="mb-2 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Who it&apos;s for
              </h2>
              <p className="font-display text-base italic leading-relaxed text-foreground">{whoFor}</p>
            </div>
          )}
          {arc && (
            <div>
              <h2 className="mb-2 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                The arc
              </h2>
              <p className="font-display text-base italic leading-relaxed text-foreground">{arc}</p>
            </div>
          )}
        </section>
      )}

      {/* What students leave able to do — with K/U/D ratings */}
      {outcomes.length > 0 && (
        <section>
          <h2 className="mb-4 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            What students leave able to do
          </h2>
          <ul className="space-y-6">
            {outcomes.map((c, i) => {
              const isFoundational = c.type === 'foundational';
              return (
                <li key={i} className="border-l-2 border-stone-200 pl-4 dark:border-stone-700">
                  <p className="font-display text-base leading-snug text-foreground">{c.statement}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {!isFoundational && <DepthChip label="K" value={c.k_depth} />}
                    {!isFoundational && <DepthChip label="U" value={c.u_depth} />}
                    <DepthChip label="D" value={c.d_depth} />
                    {isFoundational && (
                      <span className="ml-1 font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        foundational
                      </span>
                    )}
                  </div>
                  {c.evidence_d && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em]">Evidence: </span>
                      {c.evidence_d}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-xs text-muted-foreground">
            <span className="font-mono-plex uppercase tracking-[0.12em]">Depth scale</span>{' '}
            — 0 not present, 1 exposure, 2 recognize, 3 recall/predict/perform independently, 4 use correctly/reason novel/adapt, 5 fluent + edge cases.
          </p>
        </section>
      )}

      {/* Apparent outcomes — what the evidence says the course delivers */}
      {apparentOutcomes.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Apparent outcomes
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Based on the materials and interview, this is what the course appears to deliver.
          </p>
          <ul className="space-y-2">
            {apparentOutcomes.map((o, i) => (
              <li key={i} className="text-sm leading-relaxed text-foreground">— {o}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Catalog delta + proposed rewrites */}
      {(catalogDelta.length > 0 || suggestedRewrites.length > 0) && (
        <section>
          <h2 className="mb-4 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Where this differs from the catalog
          </h2>
          {catalogDelta.length > 0 && (
            <ul className="mb-6 space-y-2">
              {catalogDelta.map((bullet, i) => (
                <li key={i} className="text-sm leading-relaxed text-foreground">— {bullet}</li>
              ))}
            </ul>
          )}
          {suggestedRewrites.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/10">
              <p className="mb-2 font-mono-plex text-[10px] uppercase tracking-[0.16em] text-amber-900 dark:text-amber-300">
                Proposed learning-objective rewrite
              </p>
              <ul className="space-y-1.5">
                {suggestedRewrites.map((rev, i) => (
                  <li key={i} className="text-sm leading-relaxed text-amber-950 dark:text-amber-100">— {rev}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Incoming expectations */}
      {incoming.length > 0 && (
        <section>
          <h2 className="mb-4 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            What students walk in with
          </h2>
          <ul className="space-y-2">
            {incoming.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-relaxed text-foreground">
                <span>— {e.statement}</span>
                {e.expected_depth && (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {e.expected_depth.k != null && <DepthChip label="K" value={e.expected_depth.k} />}
                    {e.expected_depth.u != null && <DepthChip label="U" value={e.expected_depth.u} />}
                    <DepthChip label="D" value={e.expected_depth.d} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Class structure */}
      {classStructure && (classStructure.cadence || (classStructure.topics?.length ?? 0) > 0 || classStructure.assessment) && (
        <section>
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Class structure
          </h2>
          {classStructure.cadence && (
            <p className="mb-2 text-sm leading-relaxed text-foreground">
              <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Cadence: </span>
              {classStructure.cadence}
            </p>
          )}
          {(classStructure.topics?.length ?? 0) > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {classStructure.topics!.map((t, i) => (
                <li key={i} className="rounded border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800/40 dark:text-stone-300">{t}</li>
              ))}
            </ul>
          )}
          {classStructure.assessment && (
            <p className="text-sm leading-relaxed text-foreground">
              <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Assessment: </span>
              {classStructure.assessment}
            </p>
          )}
        </section>
      )}

      {/* Major projects */}
      {majorProjects.length > 0 && (
        <section>
          <h2 className="mb-4 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Major projects
          </h2>
          <ul className="space-y-4">
            {majorProjects.map((p, i) => (
              <li key={i} className="border-l-2 border-stone-200 pl-4 dark:border-stone-700">
                <p className="font-display text-base leading-snug text-foreground">{p.title}</p>
                {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Course emphasis — by point weight */}
      {emphasis.length > 0 && (
        <section>
          <h2 className="mb-1 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Course emphasis — where the graded effort goes
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Which competencies the course&apos;s graded work weights most, independent of depth scoring.
          </p>
          <ul className="space-y-1.5">
            {emphasis.map((it, i) => {
              const band =
                it.centrality === 'central'
                  ? 'bg-foreground/10 text-foreground border-foreground/20'
                  : it.centrality === 'supporting'
                  ? 'bg-muted text-muted-foreground border-border'
                  : 'bg-transparent text-muted-foreground/70 border-border';
              return (
                <li key={i} className="flex items-baseline gap-2">
                  <span className={'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ' + band}>
                    {it.centrality}
                  </span>
                  <span className="flex-1 text-sm leading-snug text-foreground">{it.competency}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {area7 && <Area7Conditions block={area7} />}

      {/* Strongest evidence */}
      {strongest.length > 0 && (
        <section className="border-t pt-6">
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Strongest evidence behind this capture
          </h2>
          <ul className="space-y-1">
            {strongest.map((s, i) => (
              <li key={i} className="text-xs text-muted-foreground">— {s}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
