'use client';

import { useMemo, useState } from 'react';
import type {
  CaptureProfile,
  CaptureCompetency,
  CaptureReviewerStatus,
} from '@/lib/ai/capture/schema';

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
}

function DepthSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
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
          value={competency.k_depth}
          onChange={v => onChange({ ...competency, k_depth: v })}
          disabled={!isTechnical}
        />
        <DepthSlider
          label="Understand"
          value={competency.u_depth}
          onChange={v => onChange({ ...competency, u_depth: v })}
          disabled={!isTechnical}
        />
        <DepthSlider
          label="Do"
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

function AuditNotesList({ title, items }: { title: string; items: string[] }) {
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
          <li key={i} className="border-l-2 border-muted pl-2">{it}</li>
        ))}
      </ul>
    </div>
  );
}

export function ProfileReviewPanel({ profile, reviewerStatus, telemetry, onSave, onResumeChat }: Props) {
  const [working, setWorking] = useState<CaptureProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedStatus, setLastSavedStatus] = useState<CaptureReviewerStatus>(reviewerStatus);

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
            onClick={() => persist('confirmed')}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </header>

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

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
          <AuditNotesList title="Prereq gaps" items={working.audit_notes.prereq_gaps} />
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
