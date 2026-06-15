'use client';

import { useMemo, useRef, useState } from 'react';
import {
  captureProfileSchema,
  type CaptureProfile,
  type CaptureCompetency,
  type CaptureIncomingExpectation,
  type CaptureProfileSourceType,
  type CaptureProfileCitationType,
  type CaptureReviewerStatus,
} from '@/lib/ai/capture/schema';
import type { ReconciliationLogEntry } from '@/lib/ai/schemas';
import { formatIncomingRequirements } from '@/lib/capture/incoming-requirements';
import { VerificationSummary } from './VerificationSummary';
import { LegacyBanner } from './LegacyBanner';
import { CitationDrawer, type CitationTarget } from './CitationDrawer';
import { describeDepth, type Dimension } from '@/lib/ai/capture/depth-anchors';
import { CourseOverview } from './CourseOverview';
import { ClassStructureSection } from './ClassStructureSection';
import { MajorProjectsSection } from './MajorProjectsSection';
import { StressTestPanel, type StressTestHandle } from './StressTestPanel';
import { StressTestBadge } from './StressTestBadge';
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';
import { deriveEvidenceBand, type EvidenceBand, type EvidenceClaim } from '@/lib/program/evidence-ladder';
import { FlagDialog } from '@/components/FlagDialog';

/**
 * Returns true when NONE of the profile's findings carry a `source` flag.
 * v2 synthesis always emits `source` on every finding; pre-v2 snapshots
 * and in-flight drafts have no provenance fields at all.
 */
export function isLegacyProfile(profile: CaptureProfile): boolean {
  // Some pre-v2 / legacy-edited drafts persisted with `null` for these
  // fields rather than empty arrays — the Zod schema requires arrays, but
  // direct DB writes bypassed it. Guard the spreads defensively so the
  // review panel renders instead of crashing.
  const raw = [
    ...(profile.competencies ?? []),
    ...(profile.incoming_expectations ?? []),
    profile.verification_summary,
    profile.audit_notes,
  ];
  const allFindings = raw.filter(f => f != null) as Array<{ source?: unknown }>;
  if (allFindings.length === 0) return false;
  return allFindings.every(f => f.source === undefined);
}

/**
 * v2 provenance badge — renders nothing for pre-v2 findings (source absent).
 * Color encodes provenance (teal = instructor-only, amber = materials-only,
 * gray = inferred / mixed / no citations); `title` shows citation count on
 * hover. Click-through to the citation drawer is Stage 5 polish.
 */
export function SourceBadge({
  source,
  citations,
  onCitationClick,
}: {
  source: CaptureProfileSourceType | undefined;
  citations: CaptureProfileCitationType[] | undefined;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}) {
  if (!source) return null;
  const count = citations?.length ?? 0;
  const palette =
    source === 'instructor'
      ? 'bg-teal-100 text-teal-900 border-teal-300'
      : source === 'materials'
        ? 'bg-amber-100 text-amber-900 border-amber-300'
        : 'bg-stone-100 text-stone-700 border-stone-300';
  const label =
    source === 'instructor' ? 'instructor' : source === 'materials' ? 'materials' : 'inferred';

  const interactive = onCitationClick && citations && citations.length > 0;
  const className =
    `inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${palette}` +
    (interactive ? ' hover:opacity-80 cursor-pointer' : '');

  if (interactive) {
    return (
      <button
        type="button"
        title={count > 0 ? `${count} citation${count === 1 ? '' : 's'} — click to view` : source}
        className={className}
        onClick={() => onCitationClick!(citations[0]!)}
      >
        {label}
      </button>
    );
  }
  return (
    <span
      title={count > 0 ? `${count} citation${count === 1 ? '' : 's'}` : source}
      aria-label={`Evidence source: ${label}${count > 0 ? `, ${count} citation${count === 1 ? '' : 's'}` : ''}`}
      className={className}
    >
      {label}
    </span>
  );
}

/**
 * Evidence-band chip — small read-time credibility annotation derived from
 * the claim's existing source + citations fields.  Sits next to SourceBadge.
 * Never gates or changes a score; purely a transparency annotation.
 *
 * Bands:
 *   claimed           → gray  "claim"     (≈L0 — instructor testimony / no material cite)
 *   materials_supported → green "materials" (≈L1-L2 — cites a course-material chunk)
 *   artifact_verified   → teal  "artifact"  (≈L3-L4 — student-produced evidence; unreachable today)
 */
export function EvidenceBandChip({ claim }: { claim: EvidenceClaim }) {
  const band: EvidenceBand = deriveEvidenceBand(claim);

  const palette =
    band === 'materials_supported'
      ? 'bg-green-100 text-green-900 border-green-300'
      : band === 'artifact_verified'
        ? 'bg-teal-100 text-teal-800 border-teal-400'
        : 'bg-stone-100 text-stone-500 border-stone-300';

  const label =
    band === 'materials_supported'
      ? 'materials'
      : band === 'artifact_verified'
        ? 'artifact'
        : 'claim';

  const tooltip =
    band === 'materials_supported'
      ? 'Cites a course-material chunk (assignment/rubric/syllabus). ≈ ladder L1–L2.'
      : band === 'artifact_verified'
        ? 'Cites student-produced evidence. ≈ ladder L3–L4.'
        : 'Instructor claim — no course-material citation. ≈ ladder L0.';

  return (
    <span
      title={tooltip}
      tabIndex={0}
      role="note"
      aria-label={`Evidence band — ${tooltip}`}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider focus:outline-none focus:ring-1 focus:ring-ring ${palette}`}
    >
      {label}
    </span>
  );
}

const VALIDATION_FIELD_LABELS: Record<string, string> = {
  evidence_k: 'Know evidence',
  evidence_u: 'Understand evidence',
  evidence_d: 'Do evidence',
  k_depth: 'Know depth',
  u_depth: 'Understand depth',
  d_depth: 'Do depth',
  statement: 'statement',
};

/**
 * Turn a Zod validation issue (path + message) into something a faculty
 * reviewer can act on — "Competency #4 ("Production file prep") — Know
 * evidence: …" instead of leaking the schema path
 * "competencies › 3 › evidence_k: …". Exported for unit testing.
 */
export function humanizeValidationIssue(
  path: ReadonlyArray<PropertyKey>,
  message: string,
  competencies: ReadonlyArray<{ statement?: string }>,
): string {
  if (path[0] === 'competencies' && typeof path[1] === 'number') {
    const idx = path[1];
    const name = competencies[idx]?.statement?.trim();
    const namePart = name ? ` ("${name.length > 50 ? `${name.slice(0, 50)}…` : name}")` : '';
    const fieldKey = typeof path[2] === 'string' ? path[2] : undefined;
    const field = fieldKey ? (VALIDATION_FIELD_LABELS[fieldKey] ?? fieldKey) : null;
    return `Competency #${idx + 1}${namePart}${field ? ` — ${field}` : ''}: ${message}`;
  }
  const pretty = path
    .map(p =>
      typeof p === 'number'
        ? `#${p + 1}`
        : typeof p === 'symbol'
          ? String(p)
          : VALIDATION_FIELD_LABELS[p] ?? p,
    )
    .join(' › ');
  return pretty ? `${pretty}: ${message}` : message;
}

/**
 * Quick-review triage: decide whether a competency is "worth a look" (needs a
 * human eye) vs. one the AI is confident about (collapsible). Pure + exported
 * for unit testing. Uses only existing profile data — never gates a score.
 *
 * Flag reasons (in priority order):
 *  (a) high K/U/D resting on the instructor's word with no material cited
 *  (b) dissociation cases (CLAUDE.md rule 3): theory-without-craft (U high, D
 *      low) or craft-without-articulation (D high, U low)
 *  (c) AI-inferred (no direct source)
 *  (d) carries most graded weight (central in course_emphasis)
 */
export function triageCompetency(
  c: Pick<CaptureCompetency, 'statement' | 'u_depth' | 'd_depth' | 'source' | 'citations'>,
  emphasis: ReadonlyArray<{ competency: string; centrality: 'central' | 'supporting' | 'peripheral' }> | null | undefined,
): { flagged: boolean; reason: string | null } {
  const band = deriveEvidenceBand({ source: c.source, citations: c.citations });
  const u = c.u_depth;
  const d = c.d_depth;
  if (band === 'claimed' && ((u !== null && u >= 3) || d >= 3)) {
    return { flagged: true, reason: 'High score resting on your word — no rubric/material cited yet.' };
  }
  if (u !== null && u >= 3 && d <= 1) {
    return { flagged: true, reason: 'Theory without craft — high Understand, low Do.' };
  }
  if (d >= 3 && u !== null && u <= 1) {
    return { flagged: true, reason: 'Craft without articulation — high Do, low Understand.' };
  }
  if (c.source === 'inferred') {
    return { flagged: true, reason: 'The AI inferred this — no direct source.' };
  }
  if (emphasis?.some(e => e.centrality === 'central' && e.competency.trim() === c.statement.trim())) {
    return { flagged: true, reason: 'Carries most of the graded weight in this course.' };
  }
  return { flagged: false, reason: null };
}

/** Plain-language source label for the collapsed quick-review rows. */
export function humanizeSource(source: CaptureProfileSourceType | undefined): string {
  return source === 'instructor' ? 'you said' : source === 'materials' ? 'found in materials' : 'AI inferred';
}

interface Telemetry {
  costUsdCents: number;
  durationMs: number;
  completionTokens: number;
  uncachedPromptTokens: number;
  cachedTokens: number;
  model: string;
}

interface Props {
  profile: CaptureProfile;
  reviewerStatus: CaptureReviewerStatus;
  telemetry: Telemetry | null;
  /**
   * Initial value for the "Departmental context" textarea. Faculty narrative
   * that explains overrides + decisions; persists with the draft profile and
   * is frozen into snapshots at capture time. Future curriculum-wiki layer
   * synthesizes this into per-course narrative pages.
   */
  initialReviewerNote: string | null;
  onSave: (edited: CaptureProfile, status: 'confirmed' | 'edited', reviewerNote: string | null) => Promise<void>;
  onResumeChat: () => void;
  courseCode: string;
  courseTitle: string;
  slug: string;
  onSnapshotCreated: () => void;
  reconciliationLog?: ReconciliationLogEntry[];
  /**
   * True when a non-retired snapshot exists for this course (computed in
   * page.tsx from getLatestSnapshotByCourse — the same query the
   * /view/[code]/okf route uses, so it matches exactly when that route
   * returns 200 vs 404). Gates the "↓ Markdown" OKF download link.
   */
  hasSnapshot?: boolean;
}

function DepthSlider({
  label,
  dimension,
  value,
  onChange,
  disabled,
  context,
}: {
  label: string;
  dimension: Dimension;
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** Competency statement, woven into the slider's accessible name so a
   *  screen reader announces which competency + dimension is being scored
   *  (the visual <p> label is not programmatically associated with the input). */
  context?: string;
}) {
  if (value === null) {
    return (
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-xs italic text-muted-foreground">— (not scored)</p>
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="font-mono text-xs">{value}</p>
      </div>
      <input
        type="range"
        min={0}
        max={5}
        step={1}
        value={value}
        disabled={disabled}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="w-full"
        aria-label={`${label} depth${context ? ` for "${context}"` : ''}`}
        aria-valuetext={`${value} of 5 — ${describeDepth(dimension, value)}`}
      />
      <p className="text-[10px] leading-snug text-muted-foreground">
        {describeDepth(dimension, value)}
      </p>
    </div>
  );
}

/**
 * ⚑ dispute affordance on one competency. Files a profile_competency flag
 * keyed (courseCode, statement) with the current depths frozen as context.
 * Flags persist across re-captures (exact-statement match resurfaces them;
 * the /program flags panel lists them regardless).
 */
export function CompetencyFlagButton({
  courseCode,
  slug,
  competency,
}: {
  courseCode: string;
  slug: string;
  competency: CaptureCompetency;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Dispute this AI reading — flags persist until explicitly resolved"
        className="inline-flex items-center rounded border border-input bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        ⚑ flag
      </button>
      <FlagDialog
        open={open}
        onOpenChange={setOpen}
        context={`${courseCode} — "${competency.statement}"`}
        onSubmit={async (note, flaggedBy) => {
          const res = await fetch(`/api/flags?slug=${encodeURIComponent(slug)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              targetKind: 'profile_competency',
              courseCode,
              careerTargetId: null,
              subCompetencyId: null,
              competencyStatement: competency.statement,
              note,
              flaggedBy,
              flaggedContext: {
                k: competency.k_depth,
                u: competency.u_depth,
                d: competency.d_depth,
                statement: competency.statement,
                source: competency.source ?? null,
              },
            }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error((json as { error?: string }).error ?? `flag failed (${res.status})`);
          }
        }}
      />
    </>
  );
}

/**
 * Collapsed one-line row for the quick-review "AI is confident" zone. Shows the
 * statement, a plain-language source label, and read-only depths. Click (or
 * keyboard-activate) to expand it into the full editable CompetencyCard.
 */
function CompetencyRow({
  competency,
  onExpand,
}: {
  competency: CaptureCompetency;
  onExpand: () => void;
}) {
  const isTechnical = competency.type === 'technical';
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Edit "${competency.statement}" — ${humanizeSource(competency.source)}`}
      className="flex w-full items-center gap-2 rounded border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <span aria-hidden className="text-muted-foreground">▸</span>
      <span className="flex-1 truncate font-medium">{competency.statement}</span>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {humanizeSource(competency.source)}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {isTechnical ? `K${competency.k_depth ?? '–'} U${competency.u_depth ?? '–'} ` : ''}D{competency.d_depth}
      </span>
    </button>
  );
}

function CompetencyCard({
  competency,
  index,
  onChange,
  onCitationClick,
  courseCode,
  slug,
}: {
  competency: CaptureCompetency;
  index: number;
  onChange: (next: CaptureCompetency) => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
  courseCode: string;
  slug: string;
}) {
  const isTechnical = competency.type === 'technical';
  const evidenceBand = deriveEvidenceBand({
    source: competency.source,
    citations: competency.citations,
  });
  const isUnverifiedHighScore =
    evidenceBand === 'claimed' &&
    ((competency.u_depth !== null && competency.u_depth >= 3) ||
      competency.d_depth >= 3);
  return (
    <div
      className={
        'rounded-md border bg-card px-4 py-3 space-y-3' +
        (isUnverifiedHighScore ? ' border-l-4 border-l-amber-400' : '')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={
                'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide '
                + (isTechnical
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-amber-50 text-amber-700')
              }
            >
              {competency.type}
            </span>
            <SourceBadge source={competency.source} citations={competency.citations} onCitationClick={onCitationClick} />
            <EvidenceBandChip claim={{ source: competency.source, citations: competency.citations }} />
            <CompetencyFlagButton courseCode={courseCode} slug={slug} competency={competency} />
            {isUnverifiedHighScore && (
              <span
                title="High score (D/U≥3) resting on instructor claim — no course material cited. Review whether assignment/rubric evidence could be added."
                className="inline-flex items-center gap-0.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-mono text-amber-700"
              >
                ⚠ unverified
              </span>
            )}
          </div>
          <textarea
            value={competency.statement}
            onChange={e => onChange({ ...competency, statement: e.target.value })}
            rows={2}
            className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <span className="text-xs text-muted-foreground">#{index + 1}</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <DepthSlider
          label="Know"
          dimension="k"
          value={competency.k_depth}
          onChange={v => onChange({ ...competency, k_depth: v })}
          disabled={!isTechnical}
          context={competency.statement}
        />
        <DepthSlider
          label="Understand"
          dimension="u"
          value={competency.u_depth}
          onChange={v => onChange({ ...competency, u_depth: v })}
          disabled={!isTechnical}
          context={competency.statement}
        />
        <DepthSlider
          label="Do"
          dimension="d"
          value={competency.d_depth}
          onChange={v => onChange({ ...competency, d_depth: v })}
          context={competency.statement}
        />
      </div>

      {(competency.evidence_k || competency.evidence_u || competency.evidence_d) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Evidence
          </summary>
          <div className="mt-2 space-y-1.5 border-l-2 border-muted pl-3 text-muted-foreground">
            {competency.evidence_k && (
              <p>
                <span className="font-semibold">K:</span> {competency.evidence_k}
              </p>
            )}
            {competency.evidence_u && (
              <p>
                <span className="font-semibold">U:</span> {competency.evidence_u}
              </p>
            )}
            {competency.evidence_d && (
              <p>
                <span className="font-semibold">D:</span> {competency.evidence_d}
              </p>
            )}
          </div>
        </details>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Rationale
        </summary>
        <p className="mt-2 leading-snug text-muted-foreground">{competency.rationale}</p>
      </details>
    </div>
  );
}

/**
 * Renders an audit-notes section. When `rowAction` is provided, each
 * item gets a custom action component to its right (used for prereq
 * gaps, which carry a "Merge into Skills/Competencies Required"
 * button that calls the AI and shows a merged list inline).
 */
function AuditNotesList({
  title,
  items,
  rowAction,
}: {
  title: string;
  items: string[];
  rowAction?: (item: string, index: number) => React.ReactNode;
}) {
  if (items.length === 0) {
    return (
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        <p className="mt-1 text-xs italic text-muted-foreground">(none surfaced)</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="mt-1 space-y-2 text-xs leading-snug">
        {items.map((it, i) => (
          <li key={i} className="border-l-2 border-muted pl-2 space-y-1">
            <p>{it}</p>
            {rowAction?.(it, i)}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface MergedSkill {
  text: string;
  from: 'existing' | 'gap' | 'merged';
  rationale: string;
}

/**
 * Per-gap action: calls the merge-prereq-gap API which decomposes the
 * gap into KUD+-tagged competencies and merges them with the course's
 * existing skillsRequired list. The result is shown inline as a
 * preview list (existing items grey, new gap-derived items highlighted)
 * with a copy button to put the unified list on the clipboard for
 * pasting back into the Sheet's Skills/Competencies Required cell.
 *
 * Re-clicking the button re-runs the merge (faculty can fix a vague
 * gap mid-review or just regenerate if the first pass is off).
 */
/**
 * Render the course_emphasis ranking — what the course actually weights
 * through point allocation, as distinct from K/U/D depth scoring. Faculty
 * can see at a glance which competencies carry the bulk of the graded
 * effort and which are peripheral, even when the catalog treats them as
 * peers.
 */
function CourseEmphasis({ items }: { items: ReadonlyArray<{
  competency: string;
  points: number;
  share_pct: number;
  centrality: 'central' | 'supporting' | 'peripheral';
}> }) {
  const max = Math.max(...items.map(i => i.points), 1);
  const chipTone = (c: 'central' | 'supporting' | 'peripheral') =>
    c === 'central' ? 'bg-blue-100 text-blue-800'
    : c === 'supporting' ? 'bg-slate-100 text-slate-700'
    : 'bg-stone-100 text-stone-600';
  return (
    <section className="rounded-md border bg-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Course emphasis — by point weight</h3>
        <p className="text-[10px] text-muted-foreground">
          Independent of depth scoring; reflects what the course&apos;s graded work weights.
        </p>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((it, i) => {
          const widthPct = Math.max(2, (it.points / max) * 100);
          return (
            <li key={i} className="space-y-0.5">
              <div className="flex items-baseline gap-2">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${chipTone(it.centrality)}`}>
                  {it.centrality}
                </span>
                <span className="flex-1 text-xs leading-snug">{it.competency}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {it.points} pts · {it.share_pct}%
                </span>
              </div>
              <div className="ml-12 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={
                    it.centrality === 'central' ? 'h-full bg-blue-500'
                    : it.centrality === 'supporting' ? 'h-full bg-slate-400'
                    : 'h-full bg-stone-400'
                  }
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Render the apparent-outcomes list inferred from materials + interview.
 * Per-item copy buttons + a "Copy all" affordance make it frictionless
 * to pull these into a syllabus; the catalog is never modified automatically.
 */
function RevisedObjectivesDraft({ items }: { items: string[] }) {
  return (
    <PasteReadyList
      title="Apparent outcomes"
      items={items}
      footnote="Based on the materials and interview, this is what the course appears to deliver. Copy these into your syllabus if useful; the catalog is not modified automatically."
    />
  );
}

/**
 * Paste-ready incoming requirements (2026-06-12 walkthrough): the
 * audit-confirmed incoming_expectations, formatted as syllabus lines via
 * the pure formatIncomingRequirements helper — derived, never generated,
 * so it's present on every profile that probed incoming skills.
 */
export function IncomingRequirementsDraft({ expectations }: { expectations: ReadonlyArray<CaptureIncomingExpectation> }) {
  if (expectations.length === 0) return null;
  return (
    <PasteReadyList
      title="Incoming requirements — paste-ready"
      items={formatIncomingRequirements(expectations)}
      footnote={'The audit-confirmed list of what students should arrive able to do — formatted for the syllabus or the sheet’s "Required incoming skills" cell. Derived from the incoming expectations above; nothing is written back automatically.'}
    />
  );
}

function PasteReadyList({ title, items, footnote }: { title: string; items: string[]; footnote: string }) {
  const [copiedIdx, setCopiedIdx] = useState<number | 'all' | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copy(text: string, marker: number | 'all') {
    setCopyError(null);
    // Path 1: modern Clipboard API. Requires a secure context (HTTPS or
    // localhost). On plain-HTTP LAN URLs the API is undefined or rejects.
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedIdx(marker);
        setTimeout(() => setCopiedIdx(prev => (prev === marker ? null : prev)), 1400);
        return;
      } catch {
        // Fall through to the textarea fallback.
      }
    }
    // Path 2: legacy execCommand('copy') via a hidden textarea. Works in
    // some non-secure contexts where the modern API doesn't. Deprecated
    // but widely supported as the fallback path.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        setCopiedIdx(marker);
        setTimeout(() => setCopiedIdx(prev => (prev === marker ? null : prev)), 1400);
        return;
      }
    } catch {
      // both paths failed
    }
    // Both failed — tell the user instead of silently doing nothing.
    setCopyError('Copy blocked by the browser. Likely cause: you are on http (not https). Select the text manually for now, or use the https://… URL of the site.');
  }

  return (
    <div className="border-t pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        <button
          type="button"
          onClick={() => copy(items.join('\n'), 'all')}
          className="text-[10px] text-muted-foreground hover:text-foreground"
          title="Copy all (one per line — paste into a Sheets cell to fill multiple rows; paste into a doc and apply numbered list there)"
        >
          {copiedIdx === 'all' ? 'Copied ✓' : 'Copy all'}
        </button>
      </div>
      <ol className="mt-1 space-y-1 text-xs leading-snug">
        {items.map((obj, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 w-4 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
            <span className="flex-1">{obj}</span>
            <button
              type="button"
              onClick={() => copy(obj, i)}
              className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
              title="Copy this objective to your clipboard"
            >
              {copiedIdx === i ? 'Copied ✓' : 'Copy'}
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] italic text-muted-foreground">
        {footnote}
      </p>
      {copyError && (
        <p className="mt-1 text-[10px] text-destructive">{copyError}</p>
      )}
    </div>
  );
}

function MergeGapIntoSkillsButton({
  gapText,
  courseCode,
  slug,
}: {
  gapText: string;
  courseCode: string;
  slug: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [merged, setMerged] = useState<MergedSkill[]>([]);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);

  async function handleMerge() {
    setState('loading');
    setError('');
    setCopied(false);
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/merge-prereq-gap`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, gapText }),
        },
      );
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        const t = await res.text();
        setError(`Server returned ${res.status} non-JSON. ${t.slice(0, 120)}`);
        setState('error');
        return;
      }
      const json = await res.json() as { merged_skills?: MergedSkill[]; error?: string };
      if (!res.ok) {
        setError(json.error ?? `failed (${res.status})`);
        setState('error');
        return;
      }
      setMerged(json.merged_skills ?? []);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
      setState('error');
    }
  }

  async function handleCopy() {
    const text = merged.map(m => m.text).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1500); }
      finally { document.body.removeChild(ta); }
    }
  }

  return (
    <div className="w-full">
      <div className="flex items-start justify-end">
        <button
          type="button"
          onClick={handleMerge}
          disabled={state === 'loading'}
          title="Decompose this gap into KUD+ competencies and merge with the course's existing Skills/Competencies Required list — output is the unified replacement list to paste back into the Sheet."
          className="shrink-0 rounded border border-muted bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {state === 'loading' ? 'merging…' : state === 'done' ? 'regenerate' : 'merge into skills'}
        </button>
      </div>
      {state === 'error' && (
        <p className="mt-1 text-[10px] text-destructive">{error}</p>
      )}
      {state === 'done' && merged.length > 0 && (
        <div className="mt-2 rounded border border-muted bg-muted/20 p-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Replace your Skills/Competencies Required cell with:
          </p>
          <ul className="space-y-0.5 font-mono text-[11px]">
            {merged.map((m, i) => (
              <li
                key={i}
                className={
                  m.from === 'gap' ? 'text-foreground'
                  : m.from === 'merged' ? 'text-blue-700'
                  : 'text-muted-foreground'
                }
                title={m.rationale}
              >
                {m.text}
                {m.from === 'gap' && <span className="ml-2 text-[9px] text-green-700 font-sans">+new</span>}
                {m.from === 'merged' && <span className="ml-2 text-[9px] text-blue-700 font-sans">~clarified</span>}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              {copied ? '✓ copied' : 'copy merged list'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProfileReviewPanel({
  profile,
  reviewerStatus,
  initialReviewerNote,
  telemetry,
  onSave,
  onResumeChat,
  courseCode,
  courseTitle,
  slug,
  onSnapshotCreated,
  reconciliationLog,
  hasSnapshot,
}: Props) {
  const [working, setWorking] = useState<CaptureProfile>(profile);
  const [reviewerNote, setReviewerNote] = useState<string>(initialReviewerNote ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedStatus, setLastSavedStatus] = useState<CaptureReviewerStatus>(reviewerStatus);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  // Anchor for scroll-to-snapshot-panel. Used by both the top-banner
  // "Approve" button and the bottom "Done reviewing" button so they
  // land you ON the snapshot caption/note inputs rather than at y=0
  // (which is above the modal, since the modal sits mid-page).
  const snapshotPanelRef = useRef<HTMLDivElement | null>(null);
  const stressTestRef = useRef<StressTestHandle | null>(null);
  const [auditNotesOpen, setAuditNotesOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snapshotCaption, setSnapshotCaption] = useState('');
  const [snapshotNote, setSnapshotNote] = useState('');
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<CitationTarget | null>(null);
  // Adversarial reviewer result — ephemeral. Cleared whenever the user
  // edits the profile (mutating `working` via setWorking), so stale
  // annotations don't linger after the underlying scores change.
  const [stressTestResult, setStressTestResult] = useState<StressTestResultType | null>(null);
  // Mirrors StressTestPanel's running state so the sticky-bar trigger can
  // be disabled and labelled while a run is in progress.
  const [stressRunning, setStressRunning] = useState(false);
  // Quick-review triage: which "worth a look" rows the faculty has eyeballed,
  // and which "confident" rows they've expanded to full edit. Advisory only —
  // never gates save/approve.
  const [reviewed, setReviewed] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function handleCitationClick(c: CaptureProfileCitationType) {
    setDrawerTarget({
      type: c.type,
      chunkId: c.chunkId ?? null,
      messageId: c.messageId ?? null,
      excerpt: c.excerpt,
    });
  }

  async function handleConfirmAndSnapshot() {
    if (validationError) {
      setSnapshotMessage({
        kind: 'error',
        text: `Can't approve — ${validationError}. Fix the offending row above, then try again.`,
      });
      return;
    }
    setSnapshotting(true);
    setSnapshotMessage(null);
    setSaveError(null);
    try {
      // Save any pending edits first so the snapshot reflects current state.
      if (dirty) {
        await onSave(working, 'edited', reviewerNote.trim() || null);
      }
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/snapshots?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            caption: snapshotCaption.trim() || null,
            captionNote: snapshotNote.trim() || null,
            reconciliationLog: reconciliationLog ?? null,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setSnapshotMessage({ kind: 'error', text: (json as { error?: string }).error ?? `Snapshot failed (${res.status})` });
        return;
      }
      setSnapshotMessage({ kind: 'ok', text: 'Snapshot recorded.' });
      setSnapshotCaption('');
      setSnapshotNote('');
      setLastSavedStatus('confirmed');
      onSnapshotCreated();
      // Approval is the END of the job (2026-06-12 walkthrough: "after the
      // approve snapshot, it should drop out of the page"). Show the green
      // completion card just long enough to register, then return to the
      // canonical course list. snapshotOpen stays true so the card renders.
      setTimeout(() => { window.location.href = 'http://130.127.162.180:3000/'; }, 2000);
    } catch (e) {
      setSnapshotMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Snapshot failed' });
    } finally {
      setSnapshotting(false);
    }
  }

  const dirty = useMemo(() => JSON.stringify(working) !== JSON.stringify(profile), [working, profile]);

  function updateCompetency(i: number, next: CaptureCompetency) {
    const competencies = working.competencies.slice();
    competencies[i] = next;
    setWorking({ ...working, competencies });
    setStressTestResult(null);
  }

  function markReviewed(i: number) {
    setReviewed(prev => {
      const n = new Set(prev);
      n.add(i);
      return n;
    });
  }
  function expandRow(i: number) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.add(i);
      return n;
    });
  }

  // Client-side validation against the same Zod schema the server uses.
  // Memoized so it runs on every working-state change without re-parsing
  // unnecessarily. If the working profile would fail server-side
  // validation, we surface the specific zod error here BEFORE submit
  // instead of letting the user mash "Save"/"Approve" and get a generic
  // 400 "invalid profile" back.
  const validationError = useMemo(() => {
    const result = captureProfileSchema.safeParse(working);
    if (result.success) return null;
    // Take the first issue — usually the most actionable one. Zod paths
    // look like ['competencies', 3, 'evidence_k']; format as a string
    // faculty can map back to a row in the review panel.
    const issue = result.error.issues[0];
    if (!issue) return null;
    return humanizeValidationIssue(issue.path, issue.message, working.competencies ?? []);
  }, [working]);

  // Quick-review partition: "worth a look" (triage-flagged, capped at 6, ranked
  // by Do depth) vs. "the AI is confident about" (the rest). Both reuse
  // CompetencyCard; the confident zone collapses to one-line CompetencyRows.
  const { worthLook, confident } = useMemo(() => {
    const triaged = working.competencies.map((c, i) => ({
      c,
      i,
      ...triageCompetency(c, working.course_emphasis),
    }));
    const flagged = triaged
      .filter(t => t.flagged)
      .sort((a, b) => b.c.d_depth - a.c.d_depth)
      .slice(0, 6);
    const flaggedIdx = new Set(flagged.map(t => t.i));
    return {
      worthLook: triaged.filter(t => flaggedIdx.has(t.i)),
      confident: triaged.filter(t => !flaggedIdx.has(t.i)),
    };
  }, [working.competencies, working.course_emphasis]);
  const unreviewedCount = worthLook.filter(t => !reviewed.has(t.i)).length;

  // A15 — Approve rubber-stamp guard (vision-alignment review 2026-06-12).
  // Approval is an epistemic act, not a click-through. The documented decay
  // mode of human-in-the-loop scoring is confirm-step rubber-stamping under
  // cognitive load. The guard requires at least ONE of:
  //   (a) any edit was made this session (dirty), OR
  //   (b) every "Worth a look" item is in the reviewed set
  //       (worthLook.length === 0 counts as trivially satisfied), OR
  //   (c) the departmental-context note has ≥ 20 non-whitespace characters.
  const allWorthLookReviewed = worthLook.length === 0 || worthLook.every(t => reviewed.has(t.i));
  const noteSubstantive = reviewerNote.replace(/\s/g, '').length >= 20;
  const approveUnlocked = dirty || allWorthLookReviewed || noteSubstantive;
  const approveLockTitle = "Review before approving — adjust at least one score, mark each 'Worth a look' item Looks right ✓, or add a departmental-context note. (Approval is an epistemic act, not a click-through.)";

  async function persist(status: 'confirmed' | 'edited') {
    if (validationError) {
      setSaveError(`Can't save — ${validationError}. Fix the offending row above, then try again.`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(working, status, reviewerNote.trim() || null);
      setLastSavedStatus(status);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const technicalCount = working.competencies.filter(c => c.type === 'technical').length;
  const foundationalCount = working.competencies.filter(c => c.type === 'foundational').length;

  const legacy = isLegacyProfile(working);

  // Approval status — drives the persistent banner + which Approve buttons render.
  // 'captured' = the profile has been approved as a snapshot. Once captured,
  // it stays captured even if faculty makes new edits — those edits are
  // additive and don't un-capture the prior snapshot. We surface dirty
  // separately as an "(unsaved edits)" hint under the banner so the captured
  // state and the in-flight-edits state are both visible.
  //
  // Previously this also required !dirty, which caused the DRAFT banner to
  // linger after a successful approve because the parent re-passes the
  // `profile` prop asynchronously and working momentarily ≠ profile.
  const isCaptured = lastSavedStatus === 'confirmed';

  // Portable OKF markdown of the last-saved snapshot. Absolute LAN origin
  // matches this file's other /view links (so the downloaded file is the
  // public LAN projection). The route sets Content-Disposition: attachment,
  // so it downloads even cross-origin where the `download` attr is ignored.
  const okfHref = `http://130.127.162.180:3000/view/${encodeURIComponent(courseCode)}/okf`;
  // hasSnapshot: a snapshot existed at page load. snapshotMessage ok: one was
  // just captured this session (exists now even though it didn't at load).
  const showOkfDownload = Boolean(hasSnapshot) || snapshotMessage?.kind === 'ok';

  function openSnapshotPanel() {
    // Opens the caption/note modal and scrolls it INTO view. Previously
    // scrolled to y=0 (page top), which sat above the modal because the
    // modal renders below the course-overview block — user landed
    // mid-page with no visible target. Now scrolls to the modal itself
    // via ref + scrollIntoView, after a tick so React has rendered it.
    setSnapshotOpen(true);
    if (typeof window === 'undefined') return;
    requestAnimationFrame(() => {
      snapshotPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <section className="space-y-6 pb-24">

      {/* ── STEP HEADER — Step 2 of 2 (mirrors Step 1's design language) ── */}
      <div className="rounded-lg border bg-card p-6">
        <div className="mb-1 flex items-center gap-2 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Step 2 of 2 · Review &amp; Approve</span>
          <span aria-hidden className="text-foreground">○</span><span aria-hidden>──</span><span aria-hidden className="text-foreground">●</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Here&apos;s what the interviewer concluded.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Check it, adjust it, approve it — nothing is recorded until you approve.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Status chip — absorbs the standalone DRAFT/CAPTURED banner */}
            {isCaptured ? (
              <span className="rounded border border-teal-300 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-900">
                CAPTURED ✓
                {dirty && <span className="ml-1 font-normal text-amber-700">(unsaved edits)</span>}
              </span>
            ) : (
              <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                DRAFT
              </span>
            )}
            <button
              type="button"
              onClick={onResumeChat}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              ← Back to the interview
            </button>
            {showOkfDownload && (
              <a
                href={okfHref}
                download
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                title="Download this course's saved profile as portable Markdown (OKF)"
              >
                ↓ Markdown
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── 1. VERIFICATION SUMMARY — the orienting question, first in content ── */}
      {working.verification_summary && (
        <VerificationSummary summary={working.verification_summary} isLegacy={legacy} onCitationClick={handleCitationClick} />
      )}

      {legacy && <LegacyBanner onReaudit={onResumeChat} />}

      {validationError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <span className="font-semibold">Profile has a validation issue:</span> {validationError}
          <span className="ml-1 text-amber-700">— Save and Approve are disabled until this is fixed. Typical cause: a K/U/D score was raised above its evidence threshold (K ≥ 2, U ≥ 1, or D ≥ 1 requires evidence text the AI didn&apos;t generate). Lower the score, regenerate from chat, or edit the cited row manually.</span>
        </div>
      )}

      {/* Completion state (2026-06-12 walkthrough: after approving, the page
          "stays" with only a small green line — faculty wondered if more was
          required). A successful capture replaces the approve form with an
          explicit you're-done card + where the record went + next steps. */}
      {snapshotOpen && snapshotMessage?.kind === 'ok' && (
        <div
          ref={snapshotPanelRef}
          className="scroll-mt-4 rounded-md border-2 border-green-600 bg-green-50 px-5 py-4 dark:bg-green-950/30"
        >
          <h3 className="text-sm font-semibold text-green-900 dark:text-green-200">
            ✓ Captured — {courseCode} is now part of the program record.
          </h3>
          <p className="mt-1 text-xs text-green-900/80 dark:text-green-200/80">
            An immutable, dated snapshot was recorded. The program coverage matrix will score it on
            its next refresh, and the curriculum wiki regenerates from it automatically.
            {' '}<span className="font-medium">Returning you to the course list…</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <a
              href={`http://130.127.162.180:3000/view/${encodeURIComponent(courseCode)}`}
              className="rounded-md border border-green-700 bg-white px-3 py-1.5 font-medium text-green-900 hover:bg-green-100 dark:bg-transparent dark:text-green-200"
            >
              View the public profile →
            </a>
            {/* No showOkfDownload guard: this card only renders when a snapshot was just captured, so one provably exists. */}
            <a
              href={okfHref}
              download
              className="rounded-md border border-green-700 bg-white px-3 py-1.5 font-medium text-green-900 hover:bg-green-100 dark:bg-transparent dark:text-green-200"
              title="Download this course's saved profile as portable Markdown (OKF)"
            >
              ↓ Markdown
            </a>
            <a
              href={`/program?slug=${encodeURIComponent(slug)}`}
              className="rounded-md border border-input bg-background px-3 py-1.5 font-medium hover:bg-muted"
            >
              See the program matrix
            </a>
            <a
              href="http://130.127.162.180:3000/"
              className="rounded-md border border-input bg-background px-3 py-1.5 font-medium hover:bg-muted"
            >
              Back to the course list
            </a>
          </div>
        </div>
      )}

      {snapshotOpen && snapshotMessage?.kind !== 'ok' && (
        <div
          ref={snapshotPanelRef}
          className="scroll-mt-4 rounded-md border-2 border-amber-400 bg-card px-4 py-4 space-y-3 shadow-md"
        >
          <header>
            <h3 className="text-sm font-semibold">Approve this profile</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Captures the current draft as a permanent, dated, immutable record. The draft stays editable; later edits create a new draft you can approve again.
            </p>
          </header>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="snapshot-caption">Caption (optional)</label>
            <input
              id="snapshot-caption"
              type="text"
              value={snapshotCaption}
              onChange={e => setSnapshotCaption(e.target.value)}
              placeholder="Spring 2026 baseline"
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="snapshot-note">What changed since the last snapshot? (optional)</label>
            <textarea
              id="snapshot-note"
              value={snapshotNote}
              onChange={e => setSnapshotNote(e.target.value)}
              rows={2}
              placeholder="Adjusted the production-file-prep depth based on instructor reply"
              className="w-full resize-y rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleConfirmAndSnapshot}
              disabled={snapshotting || !approveUnlocked}
              title={!approveUnlocked ? approveLockTitle : undefined}
              className="rounded-md bg-foreground px-4 py-1.5 text-sm font-semibold text-background shadow-sm hover:bg-foreground/85 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {snapshotting ? 'Capturing…' : 'Approve & capture'}
            </button>
          </div>
          {/* kind is already narrowed to 'error' here — the 'ok' case renders
              the completion card above instead of this form. */}
          {snapshotMessage && (
            <p className="text-xs text-destructive">
              {snapshotMessage.text}
            </p>
          )}
        </div>
      )}

      {snapshotMessage && !snapshotOpen && (
        <p className={'text-xs ' + (snapshotMessage.kind === 'ok' ? 'text-green-700' : 'text-destructive')}>
          {snapshotMessage.text}
        </p>
      )}

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      {/* ── 2. THE WORK — competency triage ── */}
      <div className="space-y-3">
        {/* ── WORTH A LOOK — triage-flagged, full editable cards ── */}
        {worthLook.length > 0 && (
          <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50/40 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-amber-900">Worth a look ({worthLook.length})</h3>
              <span className="text-[11px] text-amber-800">
                {unreviewedCount === 0 ? 'all confirmed ✓' : `${unreviewedCount} still to confirm`}
              </span>
            </div>
            <p className="text-xs text-amber-800">
              These rest on your word, sit high on the scale, were AI-inferred, or carry the most
              graded weight. Adjust a slider, or confirm each.
            </p>
            {worthLook.map(({ c, i, reason }) => (
              <div key={i} className={'space-y-1' + (reviewed.has(i) ? ' opacity-60' : '')}>
                {reason && <p className="text-[11px] font-medium text-amber-800">⚑ {reason}</p>}
                <CompetencyCard
                  competency={c}
                  index={i}
                  onChange={next => {
                    updateCompetency(i, next);
                    markReviewed(i);
                  }}
                  onCitationClick={handleCitationClick}
                  courseCode={courseCode}
                  slug={slug}
                />
                <StressTestBadge
                  annotation={stressTestResult?.per_competency.find(a => a.competency_index === i) ?? null}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => markReviewed(i)}
                    className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                  >
                    {reviewed.has(i) ? '✓ looks right' : 'Looks right ✓'}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* ── THE AI IS CONFIDENT — collapsed rows, expand to edit ── */}
        {confident.length > 0 && (
          <section className="space-y-2 rounded-md border bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">The AI is confident about these ({confident.length})</h3>
              <button
                type="button"
                onClick={() =>
                  setExpanded(
                    expanded.size >= confident.length
                      ? new Set()
                      : new Set(confident.map(t => t.i)),
                  )
                }
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                {expanded.size >= confident.length ? 'Close all ▴' : 'Open all ▾'}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Each cited to your materials or scored low. Click any row to edit.
            </p>
            {confident.map(({ c, i }) =>
              expanded.has(i) ? (
                <div key={i} className="space-y-1">
                  {/* Collapse affordance — expansion was one-way before
                      (2026-06-12 walkthrough: "unable to roll back up"). */}
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded(prev => {
                        const next = new Set(prev);
                        next.delete(i);
                        return next;
                      })
                    }
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    ▴ collapse this one
                  </button>
                  <CompetencyCard
                    competency={c}
                    index={i}
                    onChange={next => updateCompetency(i, next)}
                    onCitationClick={handleCitationClick}
                    courseCode={courseCode}
                    slug={slug}
                  />
                  <StressTestBadge
                    annotation={stressTestResult?.per_competency.find(a => a.competency_index === i) ?? null}
                  />
                </div>
              ) : (
                <CompetencyRow key={i} competency={c} onExpand={() => expandRow(i)} />
              ),
            )}
          </section>
        )}
      </div>

      {/* ── 3. STRESS TEST RESULTS — trigger is in sticky bar; results render here ── */}
      <StressTestPanel
        ref={stressTestRef}
        courseCode={courseCode}
        slug={slug}
        onResult={setStressTestResult}
        onRunningChange={setStressRunning}
        hideTrigger={true}
      />

      {/* ── 4. AUDIT NOTES — full-width collapsible ──
          The SourceBadge can render as a <button> (citation click-through),
          so it must sit BESIDE the toggle button, not inside it — nested
          buttons are invalid HTML and caused a hydration error. */}
      <div className="rounded-md border bg-card">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={auditNotesOpen}
              onClick={() => setAuditNotesOpen(v => !v)}
              className="text-left"
            >
              <h3 className="text-sm font-semibold">Interviewer&apos;s margin notes</h3>
            </button>
            <SourceBadge
              source={working.audit_notes.source}
              citations={working.audit_notes.citations}
              onCitationClick={handleCitationClick}
            />
          </div>
          <button
            type="button"
            aria-expanded={auditNotesOpen}
            onClick={() => setAuditNotesOpen(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {auditNotesOpen ? '▲ collapse' : '▼ expand'}
          </button>
        </div>
        {auditNotesOpen && (
          <div className="border-t px-4 py-4 space-y-5">
            <p className="text-xs text-muted-foreground">
              Findings from the audit that don&apos;t fit into a competency cell.
            </p>
            <AuditNotesList
              title="Prereq gaps"
              items={working.audit_notes.prereq_gaps}
              rowAction={(item) => (
                <MergeGapIntoSkillsButton gapText={item} courseCode={courseCode} slug={slug} />
              )}
            />
            <AuditNotesList title="Objective misalignments" items={working.audit_notes.objective_misalignments} />
            <AuditNotesList title="Cross-source conflicts" items={working.audit_notes.cross_source_conflicts} />
            <AuditNotesList title="Suggested objective revisions" items={working.audit_notes.suggested_objective_revisions} />
            {working.revised_objectives_draft && working.revised_objectives_draft.length > 0 && (
              <RevisedObjectivesDraft items={working.revised_objectives_draft} />
            )}
            <IncomingRequirementsDraft expectations={working.incoming_expectations} />
          </div>
        )}
      </div>

      {/* ── 5. DEPARTMENTAL CONTEXT ── */}
      <section className="rounded-md border bg-card px-4 py-3 shadow-sm">
        <label htmlFor="reviewer-note" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Departmental context <span className="font-normal normal-case text-muted-foreground">— why these scores, what overrides you made, anything a future reader (or future audit) should know. Persisted with the profile and frozen into snapshots.</span>
        </label>
        <textarea
          id="reviewer-note"
          value={reviewerNote}
          onChange={e => setReviewerNote(e.target.value)}
          rows={3}
          placeholder="e.g. &quot;Lowered D from 4 to 3 because the Spring 2026 rubric dropped the project-defense component.&quot; Optional."
          className="mt-1 w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {/* ── 6. PREVIEW THE RECORD — collapsed disclosure ── */}
      <div className="rounded-md border bg-card">
        <button
          type="button"
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen(v => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div>
            <h3 className="text-sm font-semibold">Preview the record — what readers will see on the public page</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Course overview, class structure, major projects, emphasis chart — still editable, just collapsed by default.
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">
            {previewOpen ? '▲ collapse' : '▼ expand'}
          </span>
        </button>
        {previewOpen && (
          <div className="border-t px-6 py-6 space-y-6">
            {/* Profile meta line */}
            <p className="text-xs text-muted-foreground">
              {technicalCount} technical · {foundationalCount} foundational · scale {working.scale_version} ·{' '}
              generated {new Date(working.generated_at).toLocaleString()} · status{' '}
              <span className="font-mono">{lastSavedStatus}</span>
              {telemetry && (
                <>
                  {' '}·{' '}
                  {telemetry.model} · ${(telemetry.costUsdCents / 10000).toFixed(4)} ·{' '}
                  {(telemetry.durationMs / 1000).toFixed(1)}s
                </>
              )}
            </p>

            {/* ── Course overview — editable document front matter ── */}
            <div className="rounded-md border bg-card px-6 py-8 shadow-sm">
              <CourseOverview
                courseCode={courseCode}
                courseTitle={courseTitle}
                overview={working.overview ?? null}
                onOverviewChange={(next) => { setWorking({ ...working, overview: next }); setStressTestResult(null); }}
                editable={true}
                onCitationClick={handleCitationClick}
              />
            </div>

            {/* ── Class structure — editable structured section ── */}
            <ClassStructureSection
              classStructure={working.class_structure ?? null}
              editable={true}
              onChange={(next) => {
                setWorking({ ...working, class_structure: next ?? undefined });
                setStressTestResult(null);
              }}
              onCitationClick={handleCitationClick}
            />

            {/* ── Major projects — editable project cards ── */}
            <MajorProjectsSection
              majorProjects={working.major_projects ?? null}
              editable={true}
              onChange={(next) => {
                setWorking({ ...working, major_projects: next ?? undefined });
                setStressTestResult(null);
              }}
              onCitationClick={handleCitationClick}
            />

            {/* ── Course emphasis ── */}
            {working.course_emphasis && working.course_emphasis.length > 0 && (
              <CourseEmphasis items={working.course_emphasis} />
            )}
          </div>
        )}
      </div>

      {/* ── 7. STICKY ACTION BAR ── */}
      <div className="sticky bottom-0 z-10 border-t bg-card px-4 py-3 shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Summary chip */}
          <span className="rounded border border-muted bg-muted/40 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
            {worthLook.length} worth a look · {confident.length} confident
          </span>

          <div className="flex items-center gap-2">
            {/* Stress-test trigger */}
            <button
              type="button"
              onClick={() => stressTestRef.current?.run()}
              disabled={stressRunning}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {stressRunning ? 'Stress-testing…' : 'Stress-test this profile'}
            </button>

            {/* Save edits */}
            <button
              type="button"
              onClick={() => persist('edited')}
              disabled={!dirty || saving || validationError !== null}
              title={validationError ? `Fix validation issue first: ${validationError}` : undefined}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save edits'}
            </button>

            {/* Approve — guard prevents rubber-stamping (A15) */}
            {!approveUnlocked && (
              <span className="text-[11px] text-muted-foreground">
                Locked until reviewed — hover for what counts.
              </span>
            )}
            <button
              type="button"
              onClick={openSnapshotPanel}
              disabled={saving || snapshotting || validationError !== null || !approveUnlocked}
              title={
                validationError
                  ? `Fix validation issue first: ${validationError}`
                  : !approveUnlocked
                  ? approveLockTitle
                  : undefined
              }
              className="rounded-md bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCaptured ? 'Approve update' : 'Approve the profile'}
            </button>
          </div>
        </div>
      </div>

      <CitationDrawer
        courseCode={courseCode}
        slug={slug}
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
      />
    </section>
  );
}
