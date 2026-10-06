'use client';

import { useState, type ReactNode } from 'react';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import { describeDepth, type Dimension } from '@/lib/ai/capture/depth-anchors';
import { portraitClauses, lowerAnchorOptions, evidencePromptFor, dimLabel, labeledClause } from '@/lib/ai/capture/portrait';
import { plainDepth, plainDepthPhrase } from '@/lib/capture/plain-depth';

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

type Mode = null | { dim: Dimension; dir: 'high' | 'low' };

/**
 * The review card's score block. Compact by default: the portrait sentence and
 * two stacked actions — "✓ Looks right" (only when the card is confirmable,
 * i.e. a "Worth a look" row) and "Needs adjusting". "Needs adjusting" opens the
 * card in place: one readable row per scored dimension (score in words,
 * evidence, Lower / Higher), then the rationale. Adjusting a score only calls
 * onChange — it never confirms; confirming is the explicit "Looks right".
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
  /** When provided, the card is confirmable and shows "✓ Looks right". */
  onConfirm?: () => void;
  confirmed?: boolean;
  /** Secondary controls (e.g. the dispute flag) shown only inside "Needs adjusting". */
  adjustExtras?: ReactNode;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [evidence, setEvidence] = useState('');

  const clauses = portraitClauses(competency);
  const dims = scoredDims(competency);

  function chooseLower(dim: Dimension, level: number) {
    onChange(withDepth(competency, dim, level));
    setMode(null);
    setEvidence('');
  }
  function raiseWithEvidence(dim: Dimension) {
    const current = depthOf(competency, dim);
    const next = Math.min(5, current + 1);
    onChange(withEvidence(withDepth(competency, dim, next), dim, evidence.trim()));
    setMode(null);
    setEvidence('');
  }
  function toggleAdjusting() {
    if (adjusting) { setMode(null); setEvidence(''); }
    setAdjusting(!adjusting);
  }

  const choiceClass =
    'rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted';
  const choiceActive = ' border-foreground/60 bg-muted';

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

      {/* Stacked, same-width actions, right-aligned: confirm on top, adjust below. */}
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
            aria-expanded={adjusting}
            onClick={toggleAdjusting}
            className="w-full rounded-md border border-amber-600 bg-amber-500 px-3 py-1.5 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-600"
          >
            Needs adjusting
          </button>
        </div>
      </div>

      {adjusting && (
        <div className="space-y-4 rounded-md border bg-background p-3">
          {dims.map((dim) => {
            const depth = depthOf(competency, dim);
            const ev = evidenceOf(competency, dim).trim();
            const isActive = mode?.dim === dim;
            return (
              <div key={dim} data-testid={`flag-row-${dim}`} className="space-y-1.5">
                <p className="text-sm font-medium">
                  {`${dimLabel(dim)}: ${depth}. ${describeDepth(dim, depth)}`}
                </p>
                {ev && <p className="text-sm leading-snug text-muted-foreground">{ev}</p>}
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {depth > 0 && (
                    <button
                      type="button"
                      onClick={() => setMode(isActive && mode?.dir === 'high' ? null : { dim, dir: 'high' })}
                      className={choiceClass + (isActive && mode?.dir === 'high' ? choiceActive : '')}
                    >
                      Lower: pick a better description
                    </button>
                  )}
                  {depth < 5 && (
                    <button
                      type="button"
                      onClick={() => { setEvidence(''); setMode(isActive && mode?.dir === 'low' ? null : { dim, dir: 'low' }); }}
                      className={choiceClass + (isActive && mode?.dir === 'low' ? choiceActive : '')}
                    >
                      Higher: tell us what shows it
                    </button>
                  )}
                </div>

                {isActive && mode?.dir === 'high' && (
                  <div className="space-y-1.5 border-l-2 border-muted pl-3">
                    <p className="text-xs text-muted-foreground">Students in this course are more like:</p>
                    {lowerAnchorOptions(dim, depth).map((opt) => (
                      <button
                        key={opt.level}
                        type="button"
                        data-testid={`lower-opt-${dim}-${opt.level}`}
                        onClick={() => chooseLower(dim, opt.level)}
                        className="block w-full rounded border border-input px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        {opt.level}. {opt.text}
                      </button>
                    ))}
                  </div>
                )}

                {isActive && mode?.dir === 'low' && (
                  <div className="space-y-1.5 border-l-2 border-muted pl-3">
                    <p className="text-xs text-muted-foreground">
                      A higher score needs evidence of what students actually do, not what the syllabus intends.
                    </p>
                    <label className="block text-xs text-muted-foreground" htmlFor={`ev-${dim}`}>
                      {evidencePromptFor(dim)}
                    </label>
                    <textarea
                      id={`ev-${dim}`}
                      aria-label={`evidence for ${dimLabel(dim)}`}
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      disabled={evidence.trim().length === 0}
                      onClick={() => raiseWithEvidence(dim)}
                      className="rounded-md border border-amber-600 bg-amber-500 px-2.5 py-1 text-xs font-semibold text-amber-950 disabled:opacity-40"
                    >
                      Raise {dimLabel(dim)}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {competency.rationale && (
            <p data-testid="rationale" className="border-t pt-3 text-sm leading-snug text-muted-foreground">{plainDepth(competency.rationale)}</p>
          )}

          <div className="flex items-center justify-between gap-2">
            <div>{adjustExtras}</div>
            <button
              type="button"
              onClick={toggleAdjusting}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Collapse
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
