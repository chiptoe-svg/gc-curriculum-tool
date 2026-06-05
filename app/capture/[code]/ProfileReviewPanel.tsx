'use client';

import { useMemo, useRef, useState } from 'react';
import {
  captureProfileSchema,
  type CaptureProfile,
  type CaptureCompetency,
  type CaptureProfileSourceType,
  type CaptureProfileCitationType,
  type CaptureReviewerStatus,
} from '@/lib/ai/capture/schema';
import { VerificationSummary } from './VerificationSummary';
import { LegacyBanner } from './LegacyBanner';
import { CitationDrawer, type CitationTarget } from './CitationDrawer';
import { describeDepth, type Dimension } from '@/lib/ai/capture/depth-anchors';
import { CourseOverview } from './CourseOverview';
import { StressTestPanel } from './StressTestPanel';
import { StressTestBadge } from './StressTestBadge';
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';
import { deriveEvidenceBand, type EvidenceBand, type EvidenceClaim } from '@/lib/program/evidence-ladder';

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
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${palette}`}
    >
      {label}
    </span>
  );
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
}

function DepthSlider({
  label,
  dimension,
  value,
  onChange,
  disabled,
}: {
  label: string;
  dimension: Dimension;
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
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
      />
      <p className="text-[10px] leading-snug text-muted-foreground">
        {describeDepth(dimension, value)}
      </p>
    </div>
  );
}

function CompetencyCard({
  competency,
  index,
  onChange,
  onCitationClick,
}: {
  competency: CaptureCompetency;
  index: number;
  onChange: (next: CaptureCompetency) => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
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
        />
        <DepthSlider
          label="Understand"
          dimension="u"
          value={competency.u_depth}
          onChange={v => onChange({ ...competency, u_depth: v })}
          disabled={!isTechnical}
        />
        <DepthSlider
          label="Do"
          dimension="d"
          value={competency.d_depth}
          onChange={v => onChange({ ...competency, d_depth: v })}
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
 * Render the synthesized "what to paste" objectives list with per-item
 * copy buttons + a "Copy all" affordance. The prompt instructs the
 * agent to consolidate existing catalog objectives + audit suggestions
 * into a single 3–6 item list ready for the syllabus's outcomes
 * section — this component just makes the copying frictionless.
 */
function RevisedObjectivesDraft({ items }: { items: string[] }) {
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
          Revised objectives — paste-ready
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
        Consolidated from the existing catalog objectives + the audit&apos;s findings. Copy these into your syllabus if you want them; the catalog is not modified automatically.
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
  const [snapshotCaption, setSnapshotCaption] = useState('');
  const [snapshotNote, setSnapshotNote] = useState('');
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<CitationTarget | null>(null);
  // Adversarial reviewer result — ephemeral. Cleared whenever the user
  // edits the profile (mutating `working` via setWorking), so stale
  // annotations don't linger after the underlying scores change.
  const [stressTestResult, setStressTestResult] = useState<StressTestResultType | null>(null);

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
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setSnapshotMessage({ kind: 'error', text: (json as { error?: string }).error ?? `Snapshot failed (${res.status})` });
        return;
      }
      setSnapshotMessage({ kind: 'ok', text: 'Snapshot recorded.' });
      setSnapshotOpen(false);
      setSnapshotCaption('');
      setSnapshotNote('');
      setLastSavedStatus('confirmed');
      onSnapshotCreated();
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
    const path = issue.path.join(' › ');
    return `${path}: ${issue.message}`;
  }, [working]);

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
    <section className="space-y-6">
      {/* ── Approval-status banner — first thing the faculty sees ── */}
      {isCaptured ? (
        <div className="rounded-md border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-900 shadow-sm">
          <p className="font-semibold tracking-wide">CAPTURED ✓ — approved</p>
          <p className="mt-0.5 text-xs leading-snug">
            This is the official record.
            {dirty && (
              <span className="ml-1 text-amber-700">
                You have unsaved edits — Save them to update the draft, then re-approve to capture a new snapshot.
              </span>
            )}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <p className="font-semibold tracking-wide">DRAFT — pending your approval</p>
          <p className="mt-0.5 text-xs leading-snug">
            This profile was generated from your audit. Review, edit if needed, then approve at the bottom to capture it as the official record.
          </p>
        </div>
      )}

      {/* ── Adversarial reviewer — mounts between banner and overview ── */}
      <StressTestPanel
        courseCode={courseCode}
        slug={slug}
        onResult={setStressTestResult}
      />

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

      {legacy && <LegacyBanner onReaudit={onResumeChat} />}
      <header className="flex items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Course Outcome Profile</h2>
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
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onResumeChat}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Back to chat
          </button>
          <button
            type="button"
            onClick={() => persist('edited')}
            disabled={!dirty || saving || validationError !== null}
            title={validationError ? `Fix validation issue first: ${validationError}` : undefined}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save edits'}
          </button>
          {/*
            The third Approve button used to live here. Removed 2026-06-02:
            the top DRAFT-banner CTA and the bottom "Done reviewing?" CTA
            cover both entry-points (top-of-page action + scroll-to-bottom
            action). Three buttons doing the same thing felt cluttered.
          */}
        </div>
      </header>

      {validationError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <span className="font-semibold">Profile has a validation issue:</span> {validationError}
          <span className="ml-1 text-amber-700">— Save and Approve are disabled until this is fixed. Typical cause: a K/U/D score was raised above its evidence threshold (K ≥ 2, U ≥ 1, or D ≥ 1 requires evidence text the AI didn&apos;t generate). Lower the score, regenerate from chat, or edit the cited row manually.</span>
        </div>
      )}

      {snapshotOpen && (
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
              disabled={snapshotting}
              className="rounded-md bg-foreground px-4 py-1.5 text-sm font-semibold text-background shadow-sm hover:bg-foreground/85 disabled:opacity-50"
            >
              {snapshotting ? 'Capturing…' : 'Approve & capture'}
            </button>
          </div>
          {snapshotMessage && (
            <p className={'text-xs ' + (snapshotMessage.kind === 'ok' ? 'text-green-700' : 'text-destructive')}>
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

      {working.verification_summary && (
        <VerificationSummary summary={working.verification_summary} isLegacy={legacy} onCitationClick={handleCitationClick} />
      )}

      {working.course_emphasis && working.course_emphasis.length > 0 && (
        <CourseEmphasis items={working.course_emphasis} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {working.competencies.map((c, i) => (
            <div key={i} className="space-y-1">
              <CompetencyCard competency={c} index={i} onChange={next => updateCompetency(i, next)} onCitationClick={handleCitationClick} />
              <StressTestBadge
                annotation={stressTestResult?.per_competency.find(a => a.competency_index === i) ?? null}
              />
            </div>
          ))}
        </div>

        <aside className="space-y-5 rounded-md border bg-card px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Audit notes</h3>
              <SourceBadge
                source={working.audit_notes.source}
                citations={working.audit_notes.citations}
                onCitationClick={handleCitationClick}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Findings from the audit that don&apos;t fit into a competency cell.
            </p>
          </div>
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
        </aside>
      </div>
      {/*
        Bottom Approve / Update CTA.
          - Not yet captured → show as "Approve this profile" (first capture).
          - Already captured AND faculty has edited since → show as
            "Approve update" so faculty can roll a new snapshot.
          - Captured AND no pending edits → hide entirely (nothing to do).
      */}
      {(!isCaptured || dirty) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-5 text-center shadow-sm">
          <p className="text-sm text-amber-900">
            {isCaptured ? 'You have unsaved edits to a captured profile.' : 'Done reviewing?'}
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80">
            {isCaptured
              ? 'Approving captures these edits as a new dated snapshot. The prior snapshot stays in the historical record.'
              : 'Approving captures the current draft as the official, dated record.'}
          </p>
          <button
            type="button"
            onClick={openSnapshotPanel}
            disabled={saving || snapshotting || validationError !== null}
            title={validationError ? `Fix validation issue first: ${validationError}` : undefined}
            className="mt-3 rounded-md bg-amber-700 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCaptured ? 'Approve update' : 'Approve this profile'}
          </button>
        </div>
      )}

      <CitationDrawer
        courseCode={courseCode}
        slug={slug}
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
      />
    </section>
  );
}
