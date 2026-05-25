'use client';

import { useMemo, useState } from 'react';
import type {
  CaptureProfile,
  CaptureCompetency,
  CaptureReviewerStatus,
} from '@/lib/ai/capture/schema';
import { VerificationSummary } from './VerificationSummary';
import { describeDepth, type Dimension } from '@/lib/ai/capture/depth-anchors';

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
  onSave: (edited: CaptureProfile, status: 'confirmed' | 'edited') => Promise<void>;
  onResumeChat: () => void;
  courseCode: string;
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
}: {
  competency: CaptureCompetency;
  index: number;
  onChange: (next: CaptureCompetency) => void;
}) {
  const isTechnical = competency.type === 'technical';
  return (
    <div className="rounded-md border bg-card px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
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
 * Renders an audit-notes section. When `copyFormatter` is provided, each
 * item gets a small "Copy" button that puts a formatted version on the
 * clipboard — used for prereq gaps, where the faculty workflow is to
 * carry the gap into the prerequisite course's audit chat. Other audit
 * categories don't have an obvious "send elsewhere" workflow yet so they
 * skip the button.
 */
function AuditNotesList({
  title,
  items,
  copyFormatter,
}: {
  title: string;
  items: string[];
  copyFormatter?: (item: string) => string;
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
      <ul className="mt-1 space-y-1 text-xs leading-snug">
        {items.map((it, i) => (
          <li key={i} className="border-l-2 border-muted pl-2">
            <div className="flex items-start justify-between gap-2">
              <span className="flex-1">{it}</span>
              {copyFormatter && <CopyAsKudButton text={copyFormatter(it)} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyAsKudButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handle() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (rare — http context or denied permission).
      // Fall back to selecting the text in a hidden textarea so the user can
      // copy manually with ⌘C.
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
    <button
      type="button"
      onClick={handle}
      title="Copy gap as a KUD-tagged line — paste into the prerequisite course's row in the Google Sheet"
      className="shrink-0 rounded border border-muted bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? '✓ copied' : 'copy as KUD'}
    </button>
  );
}

/**
 * Formats a free-form prereq-gap string for pasting into the
 * `prerequisites` cell of the prerequisite course's row in the
 * shared Google Sheet. Two lines, KUD-shaped depth fields left
 * blank for the faculty member to fill, source course + date
 * tag carries provenance.
 *
 * Why compact: the sheet's prerequisites column is a textarea
 * (lib/db/schema.ts → courses.prerequisites: text). Faculty
 * accumulate multiple entries per cell over time; verbose
 * multi-line blocks turn into walls of text quickly.
 */
function formatPrereqGapAsKud(gapText: string, courseCode: string): string {
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  return `[${courseCode} needs · ${today}] ${gapText}\n  K=__ U=__ D=__`;
}

export function ProfileReviewPanel({
  profile,
  reviewerStatus,
  telemetry,
  onSave,
  onResumeChat,
  courseCode,
  slug,
  onSnapshotCreated,
}: Props) {
  const [working, setWorking] = useState<CaptureProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedStatus, setLastSavedStatus] = useState<CaptureReviewerStatus>(reviewerStatus);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotCaption, setSnapshotCaption] = useState('');
  const [snapshotNote, setSnapshotNote] = useState('');
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleConfirmAndSnapshot() {
    setSnapshotting(true);
    setSnapshotMessage(null);
    setSaveError(null);
    try {
      // Save any pending edits first so the snapshot reflects current state.
      if (dirty) {
        await onSave(working, 'edited');
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
  }

  async function persist(status: 'confirmed' | 'edited') {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(working, status);
      setLastSavedStatus(status);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const technicalCount = working.competencies.filter(c => c.type === 'technical').length;
  const foundationalCount = working.competencies.filter(c => c.type === 'foundational').length;

  return (
    <section className="space-y-6">
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
            disabled={!dirty || saving}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save edits'}
          </button>
          <button
            type="button"
            onClick={() => setSnapshotOpen(o => !o)}
            disabled={saving || snapshotting}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {snapshotOpen ? 'Cancel snapshot' : 'Confirm and snapshot'}
          </button>
        </div>
      </header>

      {snapshotOpen && (
        <div className="rounded-md border bg-card px-4 py-4 space-y-3 shadow-sm">
          <header>
            <h3 className="text-sm font-semibold">Confirm and snapshot</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Records the current draft as a permanent, dated, immutable snapshot. The working draft stays editable; new edits will live in a new snapshot when you confirm again.
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
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {snapshotting ? 'Snapshotting…' : 'Snapshot'}
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

      {working.verification_summary && (
        <VerificationSummary summary={working.verification_summary} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {working.competencies.map((c, i) => (
            <CompetencyCard key={i} competency={c} index={i} onChange={next => updateCompetency(i, next)} />
          ))}
        </div>

        <aside className="space-y-5 rounded-md border bg-card px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Audit notes</h3>
            <p className="text-xs text-muted-foreground">
              Findings from the audit that don&apos;t fit into a competency cell.
            </p>
          </div>
          <AuditNotesList
            title="Prereq gaps"
            items={working.audit_notes.prereq_gaps}
            copyFormatter={(item) => formatPrereqGapAsKud(item, courseCode)}
          />
          <AuditNotesList title="Objective misalignments" items={working.audit_notes.objective_misalignments} />
          <AuditNotesList title="Cross-source conflicts" items={working.audit_notes.cross_source_conflicts} />
          <AuditNotesList title="Suggested objective revisions" items={working.audit_notes.suggested_objective_revisions} />
          {working.revised_objectives_draft && working.revised_objectives_draft.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Revised objectives draft
              </h4>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs leading-snug">
                {working.revised_objectives_draft.map((obj, i) => <li key={i}>{obj}</li>)}
              </ol>
              <p className="mt-2 text-[10px] italic text-muted-foreground">
                Copy these into your syllabus if you want them. The catalog is not modified automatically.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
