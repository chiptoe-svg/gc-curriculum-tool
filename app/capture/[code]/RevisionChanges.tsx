'use client';
/**
 * Revision change list at the top of the review (spec
 * 2026-11-08-course-revision-modes-labels-design.md): every rating that moved
 * against the approved version, grouped by whether it cites new evidence, with
 * Keep change / Undo per row; files whose evidence is no longer in use; and
 * other sections that changed, each with "Restore approved version".
 */
import type { CaptureProfileCitationType, Revision, RevisionChange } from '@/lib/ai/capture/schema';

export const REVISION_BLOCKED_MESSAGE = 'Decide on each change above first.';

/** Approval waits until no change is pending. */
export function revisionBlocksApproval(revision: Revision | null | undefined): boolean {
  return !!revision && revision.changes.some(c => c.decision === 'pending');
}

const SECTION_LABELS: Record<string, string> = {
  overview: 'Course overview',
  incoming_expectations: 'Incoming expectations',
  verification_summary: 'Verification summary',
  audit_notes: 'Audit notes',
  revised_objectives_draft: 'Revised objectives',
  course_emphasis: 'Course emphasis',
  class_structure: 'Class structure',
  major_projects: 'Major projects',
};

const UNDO_TITLE = 'Restores the approved version of this competency, replacing any edits you made to it.';
const KIND_NOTE: Record<RevisionChange['kind'], string> = { moved: '', added: 'New competency', removed: 'No longer in the re-scored profile' };

function dimsText(c: RevisionChange): string {
  return c.dims.map(d => `${d.dim.toUpperCase()} ${d.from ?? '–'} → ${d.to ?? '–'}`).join(' · ');
}

function ChangeRow({ change, onDecide, onCitationClick }: {
  change: RevisionChange;
  onDecide: (statement: string, decision: 'kept' | 'undone') => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}) {
  return (
    <li className="flex flex-col gap-1 border-t py-2 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{change.statement}</span>
        <span className="font-mono text-xs text-muted-foreground">{dimsText(change)}</span>
      </div>
      {KIND_NOTE[change.kind] && <span className="text-xs text-muted-foreground">{KIND_NOTE[change.kind]}</span>}
      {change.new_citations.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {change.new_citations.map((c, i) => (
            <li key={i}>
              <button type="button" onClick={() => onCitationClick?.(c)} className="text-left text-muted-foreground underline-offset-2 hover:underline">
                {c.type === 'instructor' ? 'You said: ' : 'From a file: '}“{c.excerpt}”
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => onDecide(change.statement, 'kept')}
          aria-pressed={change.decision === 'kept'}
          className={'rounded border px-2 py-1 ' + (change.decision === 'kept' ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted')}
        >
          Keep change
        </button>
        <button
          type="button"
          onClick={() => onDecide(change.statement, 'undone')}
          title={UNDO_TITLE}
          aria-pressed={change.decision === 'undone'}
          className={'rounded border px-2 py-1 ' + (change.decision === 'undone' ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted')}
        >
          Undo
        </button>
        {change.decision === 'pending' && <span className="text-amber-700">Waiting for your decision</span>}
      </div>
    </li>
  );
}

export function RevisionChanges({ revision, onDecide, onDecideGroup, onRestoreSection, onCitationClick }: {
  revision: Revision;
  onDecide: (statement: string, decision: 'kept' | 'undone') => void;
  onDecideGroup: (decision: 'undone') => void;
  onRestoreSection: (section: string) => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}) {
  const withEvidence = revision.changes.filter(c => c.label === 'new_evidence');
  const without = revision.changes.filter(c => c.label === 'no_new_evidence');
  const nothing = revision.changes.length === 0 && revision.stale_evidence.length === 0 && revision.changed_sections.length === 0;

  return (
    <section className="space-y-4 rounded-lg border bg-card px-4 py-4" data-testid="revision-changes">
      <h3 className="text-sm font-semibold">
        {revision.mode === 'targeted' ? 'What changed in this revision' : 'What moved since the approved version'}
      </h3>
      {nothing && <p className="text-sm text-muted-foreground">No rating moved compared with the approved version.</p>}

      {withEvidence.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Changes with new evidence</h4>
          <ul>{withEvidence.map(c => <ChangeRow key={c.statement} change={c} onDecide={onDecide} onCitationClick={onCitationClick} />)}</ul>
        </div>
      )}

      {without.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Changes without new evidence — likely AI variation</h4>
            <button type="button" onClick={() => onDecideGroup('undone')} className="rounded border px-2 py-1 text-xs hover:bg-muted">
              {revision.mode === 'targeted' ? 'Keep all as set back' : 'Undo all'}
            </button>
          </div>
          {revision.mode === 'targeted' && (
            <p className="mt-1 text-xs text-muted-foreground">These were set back to the approved version for you. Keep a change only if it is real.</p>
          )}
          <ul>{without.map(c => <ChangeRow key={c.statement} change={c} onDecide={onDecide} onCitationClick={onCitationClick} />)}</ul>
        </div>
      )}

      {revision.stale_evidence.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Evidence no longer in use — check these</h4>
          <p className="mt-1 text-xs text-muted-foreground">These ratings cite a file that was retired or set aside. Check them against the current materials.</p>
          <ul className="mt-1 list-disc pl-5 text-sm">{revision.stale_evidence.map(s => <li key={s}>{s}</li>)}</ul>
        </div>
      )}

      {revision.changed_sections.length > 0 && (
        <div>
          <ul className="space-y-1">
            {revision.changed_sections.map(s => (
              <li key={s.section} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {SECTION_LABELS[s.section] ?? s.section}{' '}
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Changed since the approved version</span>
                </span>
                <button type="button" onClick={() => onRestoreSection(s.section)} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                  Restore approved version
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {revisionBlocksApproval(revision) && <p className="text-xs font-medium text-amber-800">{REVISION_BLOCKED_MESSAGE}</p>}
    </section>
  );
}
