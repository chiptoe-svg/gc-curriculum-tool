'use client';

import { useState } from 'react';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { ReconcileProposal, ReconcileSection, ReconciliationLogEntry } from '@/lib/ai/schemas';
import { applyReconciliation } from '@/lib/capture/apply-reconciliation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Decision {
  proposal: ReconcileProposal;
  accepted: boolean;
  revisedStatement: string;
  revisedK: string;
  revisedU: string;
  revisedD: string;
}

interface Props {
  profile: CaptureProfile;
  slug: string;
  courseCode: string;
  onComplete: (reconciled: CaptureProfile, log: ReconciliationLogEntry[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The "Outgoing KUDs" step was removed 2026-06-15 (operator): it re-listed the
// competency K/U/D table that the main review panel already shows under "Here's
// what the interviewer concluded", so it was redundant. Reconciliation now
// covers the two sections that the main panel does NOT let you converse about.
const STEPS: ReconcileSection[] = ['apparent_outcomes', 'incoming'];
const STEP_TITLES = ['Apparent outcomes', 'Incoming expectations'];

function depthStr(n: number | null | undefined): string {
  return n !== null && n !== undefined ? String(n) : '–';
}

function buildItemsPayload(
  section: ReconcileSection,
  working: CaptureProfile,
): Array<{ statement: string; k: number | null; u: number | null; d: number | null }> {
  if (section === 'apparent_outcomes') {
    return (working.revised_objectives_draft ?? []).map(s => ({ statement: s, k: null, u: null, d: null }));
  }
  if (section === 'incoming') {
    return working.incoming_expectations.map(e => ({
      statement: e.statement,
      k: e.expected_depth.k ?? null,
      u: e.expected_depth.u ?? null,
      d: e.expected_depth.d,
    }));
  }
  // outgoing
  return working.competencies.map(c => ({
    statement: c.statement,
    k: c.k_depth ?? null,
    u: c.u_depth ?? null,
    d: c.d_depth,
  }));
}

function initDecisions(proposals: ReconcileProposal[]): Decision[] {
  return proposals.map(p => ({
    proposal: p,
    accepted: true,
    revisedStatement: p.revised?.statement ?? '',
    revisedK: p.revised?.k !== null && p.revised?.k !== undefined ? String(p.revised.k) : '',
    revisedU: p.revised?.u !== null && p.revised?.u !== undefined ? String(p.revised.u) : '',
    revisedD: p.revised?.d !== null && p.revised?.d !== undefined ? String(p.revised.d) : '',
  }));
}

// ---------------------------------------------------------------------------
// Proposal diff card
// ---------------------------------------------------------------------------

function ProposalCard({
  decision,
  currentItem,
  onChange,
}: {
  decision: Decision;
  currentItem: string;
  onChange: (updates: Partial<Decision>) => void;
}) {
  const p = decision.proposal;
  const canEdit = p.action === 'modify' || p.action === 'add';

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm space-y-2 ${decision.accepted ? 'border-stone-300 bg-white' : 'border-stone-200 bg-stone-50 opacity-60'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={decision.accepted}
              onChange={e => onChange({ accepted: e.target.checked })}
              className="accent-stone-700"
            />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {p.action}
            </span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground italic flex-1 text-right">{p.rationale}</p>
      </div>

      {/* Before / after */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Before</p>
          <p className="text-stone-700">{p.action === 'add' ? '(new)' : currentItem}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">After</p>
          {canEdit && decision.accepted ? (
            <div className="space-y-1">
              <input
                type="text"
                value={decision.revisedStatement}
                placeholder="Statement (leave blank to keep)"
                onChange={e => onChange({ revisedStatement: e.target.value })}
                className="w-full rounded border border-stone-300 px-2 py-1 text-xs"
              />
              <div className="flex gap-1">
                {(['k', 'u', 'd'] as const).map(dim => (
                  <label key={dim} className="flex items-center gap-1 text-[10px] uppercase">
                    <span className="font-mono font-medium">{dim.toUpperCase()}</span>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      value={dim === 'k' ? decision.revisedK : dim === 'u' ? decision.revisedU : decision.revisedD}
                      onChange={e =>
                        onChange(
                          dim === 'k'
                            ? { revisedK: e.target.value }
                            : dim === 'u'
                              ? { revisedU: e.target.value }
                              : { revisedD: e.target.value },
                        )
                      }
                      className="w-10 rounded border border-stone-300 px-1 py-0.5 text-xs"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-stone-700">
              {p.action === 'remove'
                ? '(removed)'
                : p.action === 'keep'
                  ? '(unchanged)'
                  : p.revised?.statement ?? '(unchanged)'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReconciliationStepper({ profile, slug, courseCode, onComplete }: Props) {
  const [working, setWorking] = useState<CaptureProfile>(profile);
  const [step, setStep] = useState<0 | 1>(0);
  const [feedback, setFeedback] = useState('');
  const [proposals, setProposals] = useState<ReconcileProposal[] | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [pending, setPending] = useState(false);
  const [log, setLog] = useState<ReconciliationLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const section = STEPS[step]!;
  const title = STEP_TITLES[step]!;

  // ── Render items for current section ──────────────────────────────────────

  function renderItems() {
    if (section === 'apparent_outcomes') {
      const items = working.revised_objectives_draft ?? [];
      if (items.length === 0) return <p className="text-sm text-muted-foreground italic">No apparent outcomes recorded.</p>;
      return (
        <ol className="list-decimal list-inside space-y-1 text-sm">
          {items.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      );
    }
    if (section === 'incoming') {
      const items = working.incoming_expectations;
      if (items.length === 0) return <p className="text-sm text-muted-foreground italic">No incoming expectations recorded.</p>;
      return (
        <ul className="space-y-1 text-sm">
          {items.map((e, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="flex-1">{e.statement}</span>
              <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                K{depthStr(e.expected_depth.k)} U{depthStr(e.expected_depth.u)} D{e.expected_depth.d}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    // outgoing
    const items = working.competencies;
    if (items.length === 0) return <p className="text-sm text-muted-foreground italic">No competencies recorded.</p>;
    return (
      <ul className="space-y-1 text-sm">
        {items.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="flex-1">{c.statement}</span>
            <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
              K{depthStr(c.k_depth)} U{depthStr(c.u_depth)} D{c.d_depth}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  // ── Current-item labels (for before/after in cards) ────────────────────────

  function currentItemLabel(index: number | null): string {
    if (index === null) return '(new)';
    if (section === 'apparent_outcomes') {
      return working.revised_objectives_draft?.[index] ?? '(unknown)';
    }
    if (section === 'incoming') {
      return working.incoming_expectations[index]?.statement ?? '(unknown)';
    }
    return working.competencies[index]?.statement ?? '(unknown)';
  }

  // ── Fetch proposals ────────────────────────────────────────────────────────

  async function handleGetSuggestions() {
    setPending(true);
    setError(null);
    setProposals(null);
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/reconcile?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            section,
            items: buildItemsPayload(section, working),
            feedback,
          }),
        },
      );
      const json = await res.json() as { proposals?: ReconcileProposal[]; error?: string };
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Failed to get suggestions');
        return;
      }
      const fetched = json.proposals ?? [];
      setProposals(fetched);
      setDecisions(initDecisions(fetched));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get suggestions');
    } finally {
      setPending(false);
    }
  }

  // ── Apply accepted proposals ───────────────────────────────────────────────

  function handleApplyAccepted() {
    const parseDepth = (raw: string, fallback: number | null): number | null => {
      if (raw === '') return fallback;
      const v = parseInt(raw, 10);
      return Number.isNaN(v) ? fallback : v;
    };

    const accepted: ReconcileProposal[] = decisions
      .filter(d => d.accepted)
      .map(d => ({
        ...d.proposal,
        revised: (d.proposal.action === 'modify' || d.proposal.action === 'add')
          ? {
            statement: d.revisedStatement.trim() !== '' ? d.revisedStatement.trim() : (d.proposal.revised?.statement ?? null),
            k: parseDepth(d.revisedK, d.proposal.revised?.k ?? null),
            u: parseDepth(d.revisedU, d.proposal.revised?.u ?? null),
            d: parseDepth(d.revisedD, d.proposal.revised?.d ?? null),
          }
          : d.proposal.revised,
      }));

    const next = applyReconciliation(working, section, accepted);
    setWorking(next);

    const entry: ReconciliationLogEntry = {
      section,
      feedback,
      proposals: proposals ?? [],
      decisions: decisions.map(d => ({ index: d.proposal.index, accepted: d.accepted })),
      at: new Date().toISOString(),
    };
    setLog(prev => [...prev, entry]);

    // Reset for next step
    setProposals(null);
    setFeedback('');
    setDecisions([]);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function moveStep(direction: 1 | -1) {
    setProposals(null);
    setFeedback('');
    setDecisions([]);
    setError(null);
    setStep(s => Math.max(0, Math.min(STEPS.length - 1, s + direction)) as 0 | 1);
  }

  function handleContinueToReview() {
    onComplete(working, log);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isLast = step === STEPS.length - 1;

  return (
    <div className="space-y-6">
      {/* Stepper header */}
      <div className="flex items-center gap-2 text-xs">
        {STEPS.map((_, i) => (
          <span key={i} className="flex items-center gap-2">
            <span
              className={[
                'font-mono uppercase tracking-widest',
                i === step ? 'text-foreground font-semibold' : 'text-muted-foreground',
              ].join(' ')}
            >
              Step {i + 1} of {STEPS.length}
            </span>
            {i < STEPS.length - 1 && <span className="text-muted-foreground/50">›</span>}
          </span>
        ))}
      </div>

      {/* Section panel */}
      <div className="rounded-md border bg-card px-6 py-5 space-y-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h2>

        {/* Current items */}
        <div>{renderItems()}</div>

        {/* Feedback area */}
        {!proposals && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="reconcile-feedback">
              Faculty feedback — what feels off? (optional)
            </label>
            <textarea
              id="reconcile-feedback"
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={3}
              placeholder="Describe what you want changed, tightened, or added…"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleGetSuggestions}
                disabled={pending || feedback.trim().length === 0}
                title={feedback.trim().length === 0 ? 'Type what feels off first to enable suggestions' : undefined}
                className="rounded-md border border-stone-700 bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending ? 'Loading…' : 'Make Suggested Change'}
              </button>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </div>
        )}

        {/* Proposals */}
        {proposals && proposals.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {proposals.length} suggestion{proposals.length !== 1 ? 's' : ''} — accept or reject each:
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDecisions(prev => prev.map(d => ({ ...d, accepted: true })))}
                  className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-50"
                >
                  Accept all
                </button>
                <button
                  type="button"
                  onClick={() => setDecisions(prev => prev.map(d => ({ ...d, accepted: false })))}
                  className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-50"
                >
                  Reject all
                </button>
              </div>
            </div>

            {decisions.map((dec, i) => (
              <ProposalCard
                key={i}
                decision={dec}
                currentItem={currentItemLabel(dec.proposal.index)}
                onChange={updates =>
                  setDecisions(prev =>
                    prev.map((d, idx) => (idx === i ? { ...d, ...updates } : d)),
                  )
                }
              />
            ))}

            <button
              type="button"
              onClick={handleApplyAccepted}
              className="rounded-md border border-stone-700 bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
            >
              Apply accepted
            </button>
          </div>
        )}

        {proposals && proposals.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No changes suggested — this section looks good.</p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => moveStep(-1)}
          disabled={step === 0}
          className="rounded border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-40"
        >
          ← Back
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={handleContinueToReview}
            className="rounded-md bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
          >
            Continue to review
          </button>
        ) : (
          <button
            type="button"
            onClick={() => moveStep(1)}
            className="rounded-md bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
