'use client';

import { useState, type ReactNode } from 'react';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { describeDepth, type Dimension } from '@/lib/ai/capture/depth-anchors';
import { portraitClauses, dimLabel, labeledClause } from '@/lib/ai/capture/portrait';
import { plainDepth, plainDepthPhrase, PLAIN_DEPTH_SHORT, DIM_WORD } from '@/lib/capture/plain-depth';

/** The dimensions that are scored for this competency (foundational → Do only). */
function scoredDims(c: CaptureCompetency): Dimension[] {
  const dims: Dimension[] = [];
  if (c.k_depth !== null) dims.push('k');
  if (c.u_depth !== null) dims.push('u');
  dims.push('d');
  return dims;
}

function depthOf(c: CaptureCompetency, dim: Dimension): number {
  return (dim === 'k' ? c.k_depth : dim === 'u' ? c.u_depth : c.d_depth) ?? 0;
}
function withDepth(c: CaptureCompetency, dim: Dimension, level: number): CaptureCompetency {
  return dim === 'k' ? { ...c, k_depth: level } : dim === 'u' ? { ...c, u_depth: level } : { ...c, d_depth: level };
}
function withEvidence(c: CaptureCompetency, dim: Dimension, text: string): CaptureCompetency {
  return dim === 'k' ? { ...c, evidence_k: text } : dim === 'u' ? { ...c, evidence_u: text } : { ...c, evidence_d: text };
}
function evidenceOf(c: CaptureCompetency, dim: Dimension): string {
  return (dim === 'k' ? c.evidence_k : dim === 'u' ? c.evidence_u : c.evidence_d) ?? '';
}

const LEVELS = [0, 1, 2, 3, 4, 5] as const;
const EVIDENCE_LABEL = 'What shows students reach this? (e.g. a graded assignment)';

/** A pending pick on one dimension; `evidence` is required when raising. */
type Pending = Partial<Record<Dimension, { level: number; evidence: string }>>;
type Change = { dim: Dimension; from: number; to: number };

/**
 * The review card's score block.
 *
 * Compact: the labeled portrait and two stacked actions — "✓ Looks right"
 * (only when the card is confirmable, i.e. a "Worth a look" card) and
 * "Needs adjusting".
 *
 * Opened ("Needs adjusting", redesigned 2026-10-06): the two actions give way
 * to one instruction line; one row per scored dimension shows the current
 * level in words, the evidence, and a single "Change" button that opens a
 * radio list of every level (plain words + rubric anchor). A lower level is
 * just selected; a higher level needs evidence first. Nothing is applied until
 * "Save changes", which applies all pending picks in one onChange and then
 * calls onConfirm — an explicit Save counts the card as reviewed (owner rule,
 * 2026-10-06). "Cancel" discards the picks. Picking without saving never
 * changes or confirms anything.
 */
export function CompetencyPortrait({
  competency,
  onChange,
  onConfirm,
  confirmed = false,
  adjustExtras,
}: {
  competency: CaptureCompetency;
  onChange: (next: CaptureCompetency) => void;
  /** When provided, the card is confirmable ("✓ Looks right", and Save changes confirms). */
  onConfirm?: () => void;
  confirmed?: boolean;
  /** Secondary controls (e.g. the dispute flag) shown only in the opened card. */
  adjustExtras?: ReactNode;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [openDim, setOpenDim] = useState<Dimension | null>(null);
  const [pending, setPending] = useState<Pending>({});
  const [lastAdjustment, setLastAdjustment] = useState<Change[] | null>(null);

  const clauses = portraitClauses(competency);
  const dims = scoredDims(competency);

  const changes: Change[] = dims.flatMap((dim) => {
    const p = pending[dim];
    const from = depthOf(competency, dim);
    return p && p.level !== from ? [{ dim, from, to: p.level }] : [];
  });
  const missingEvidence = changes.some((c) => c.to > c.from && !(pending[c.dim]?.evidence.trim()));
  const canSave = changes.length > 0 && !missingEvidence;

  function pick(dim: Dimension, level: number) {
    setPending((prev) => {
      const next = { ...prev };
      if (level === depthOf(competency, dim)) delete next[dim];
      else next[dim] = { level, evidence: prev[dim]?.evidence ?? '' };
      return next;
    });
  }
  function setEvidenceFor(dim: Dimension, text: string) {
    setPending((prev) => (prev[dim] ? { ...prev, [dim]: { ...prev[dim]!, evidence: text } } : prev));
  }
  function close() {
    setAdjusting(false);
    setOpenDim(null);
    setPending({});
  }
  function saveChanges() {
    if (!canSave) return;
    let next = competency;
    for (const c of changes) {
      next = withDepth(next, c.dim, c.to);
      // Raising replaces the evidence with what the reviewer says shows it —
      // the schema requires evidence for any level above the floor.
      if (c.to > c.from) next = withEvidence(next, c.dim, pending[c.dim]!.evidence.trim());
    }
    onChange(next);
    onConfirm?.();
    setLastAdjustment(changes);
    close();
  }

  const adjustedText = lastAdjustment
    ? lastAdjustment
        .map((c) => `${DIM_WORD[c.dim]}: ${PLAIN_DEPTH_SHORT[c.dim][c.from]} → ${PLAIN_DEPTH_SHORT[c.dim][c.to]}`)
        .join('; ')
    : null;

  const primary =
    'rounded-md border border-foreground bg-foreground px-4 py-1.5 text-sm font-semibold text-background shadow-sm hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-40';
  const secondary = 'rounded-md border border-input bg-background px-4 py-1.5 text-sm font-medium hover:bg-muted';

  return (
    <div className="space-y-3">
      {/* One labeled, punctuated sentence per scored dimension. The levels are
          said in words here, so there is no separate "K4 · U2 · D3" code. */}
      <p data-testid="portrait" className="text-sm leading-relaxed text-foreground">
        {clauses.map((cl, i) => {
          const { label, text } = labeledClause(cl);
          return (
            <span key={cl.dim}>
              {i > 0 ? ' ' : ''}
              <span className="font-semibold">{label}</span>{' '}
              <span className={cl.fallback ? 'text-muted-foreground' : undefined}>{text}</span>
            </span>
          );
        })}
      </p>

      {competency.intended_target && (() => {
        const it = competency.intended_target;
        const parts: string[] = [];
        if (it.k !== null && it.k !== undefined && it.k !== competency.k_depth) parts.push(`${dimLabel('k')}: ${plainDepthPhrase('k', it.k)}`);
        if (it.u !== null && it.u !== undefined && it.u !== competency.u_depth) parts.push(`${dimLabel('u')}: ${plainDepthPhrase('u', it.u)}`);
        if (it.d !== null && it.d !== undefined) parts.push(`${dimLabel('d')}: ${plainDepthPhrase('d', it.d)}`);
        if (parts.length === 0) return null;
        return (
          <p data-testid="intended-target" className="text-sm text-muted-foreground">
            <span className="font-medium text-amber-700">The course aims for more</span>
            {` — ${parts.join('; ')}.`}
          </p>
        );
      })()}

      {!adjusting && adjustedText && (
        <div className="flex items-center justify-end gap-3">
          <p data-testid="adjusted-summary" className="text-sm font-semibold text-success">
            ✓ Adjusted — {adjustedText}
          </p>
          <button
            type="button"
            onClick={() => setAdjusting(true)}
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Edit again
          </button>
        </div>
      )}

      {/* Compact actions: confirm on top, adjust below. */}
      {!adjusting && !adjustedText && (
        <div className="flex justify-end">
          <div className="flex w-48 flex-col gap-2">
            {onConfirm && (
              <button
                type="button"
                onClick={onConfirm}
                className={
                  confirmed
                    ? 'w-full rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-sm font-semibold text-success'
                    : 'w-full rounded-md border border-success bg-success px-3 py-1.5 text-sm font-semibold text-success-foreground shadow-sm hover:bg-success/90'
                }
              >
                {confirmed ? '✓ Confirmed' : '✓ Looks right'}
              </button>
            )}
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setAdjusting(true)}
              className="w-full rounded-md border border-amber-600 bg-amber-500 px-3 py-1.5 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-600"
            >
              Needs adjusting
            </button>
          </div>
        </div>
      )}

      {adjusting && (
        <div className="space-y-3 rounded-md border-2 border-amber-400 bg-background p-3">
          <p className="text-sm font-semibold text-foreground">
            Change any score that&apos;s wrong — pick the description that fits best, then save.
          </p>

          <div className="divide-y rounded-md border">
            {dims.map((dim) => {
              const current = depthOf(competency, dim);
              const p = pending[dim];
              const chosen = p?.level ?? current;
              const ev = evidenceOf(competency, dim).trim();
              const isOpen = openDim === dim;
              return (
                <div key={dim} data-testid={`flag-row-${dim}`} className="space-y-2 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p data-testid="row-heading" className="text-sm">
                        <span className="font-semibold">{dimLabel(dim)}</span>
                        {` — now: ${plainDepthPhrase(dim, current)}`}
                      </p>
                      {p && p.level !== current && (
                        <p className="text-sm font-medium text-amber-800">
                          Will change to: {plainDepthPhrase(dim, p.level)}
                        </p>
                      )}
                      {ev && <p className="text-sm leading-snug text-muted-foreground">{ev}</p>}
                    </div>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`Change ${dimLabel(dim)}`}
                      onClick={() => setOpenDim(isOpen ? null : dim)}
                      className={'shrink-0 ' + secondary + (isOpen ? ' border-foreground/60 bg-muted' : '')}
                    >
                      Change
                    </button>
                  </div>

                  {isOpen && (
                    <fieldset className="space-y-1">
                      <legend className="sr-only">{dimLabel(dim)} level</legend>
                      {LEVELS.map((level) => {
                        const selected = chosen === level;
                        const raising = level > current;
                        return (
                          <div key={level}>
                            <label
                              className={
                                'flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted' +
                                (selected ? ' bg-muted' : '')
                              }
                            >
                              <input
                                type="radio"
                                name={`level-${dim}`}
                                checked={selected}
                                onChange={() => pick(dim, level)}
                                className="mt-1"
                              />
                              <span>
                                <span className="font-medium">{plainDepthPhrase(dim, level)}</span>
                                {level === current && <span className="text-muted-foreground"> (current)</span>}
                                <span className="block text-xs text-muted-foreground">{describeDepth(dim, level)}</span>
                              </span>
                            </label>
                            {selected && raising && (
                              <div className="ml-7 mt-1 space-y-1">
                                <label className="block text-sm text-foreground" htmlFor={`ev-${dim}`}>
                                  {EVIDENCE_LABEL}
                                </label>
                                <textarea
                                  id={`ev-${dim}`}
                                  value={p?.evidence ?? ''}
                                  onChange={(e) => setEvidenceFor(dim, e.target.value)}
                                  rows={2}
                                  className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-sm"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </fieldset>
                  )}
                </div>
              );
            })}
          </div>

          {competency.rationale && (
            <p data-testid="rationale" className="text-sm leading-snug text-muted-foreground">{plainDepth(competency.rationale)}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div>{adjustExtras}</div>
            <div className="flex items-center gap-2">
              {missingEvidence && (
                <span className="text-sm text-amber-800">A higher level needs what shows it.</span>
              )}
              <button type="button" onClick={close} className={secondary}>
                Cancel
              </button>
              <button type="button" onClick={saveChanges} disabled={!canSave} className={primary}>
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
