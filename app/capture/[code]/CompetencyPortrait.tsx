'use client';

import { useState } from 'react';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import type { Dimension } from '@/lib/ai/capture/depth-anchors';
import { portraitClauses, lowerAnchorOptions, evidencePromptFor, dimLabel } from '@/lib/ai/capture/portrait';

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

function ratingLabel(c: CaptureCompetency): string {
  const k = c.k_depth === null ? '–' : c.k_depth;
  const u = c.u_depth === null ? '–' : c.u_depth;
  return c.type === 'foundational' ? `D${c.d_depth}` : `K${k} · U${u} · D${c.d_depth}`;
}

type Mode = null | { dim: Dimension; dir: 'high' | 'low' };

export function CompetencyPortrait({
  competency,
  onChange,
}: {
  competency: CaptureCompetency;
  onChange: (next: CaptureCompetency) => void;
}) {
  const [flagsOpen, setFlagsOpen] = useState(false);
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

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed text-foreground">
          {clauses.map((cl) => (
            <span key={cl.dim} className={cl.fallback ? 'italic text-muted-foreground' : undefined}>
              {cl.text}{' '}
            </span>
          ))}
        </p>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ratingLabel(competency)}</span>
      </div>

      <button
        type="button"
        onClick={() => {
          if (flagsOpen) { setMode(null); setEvidence(''); }
          setFlagsOpen(!flagsOpen);
        }}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Something&apos;s off {flagsOpen ? '▴' : '▾'}
      </button>

      {flagsOpen && (
        <div className="space-y-2 rounded-md border border-muted bg-muted/30 p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Which part?</p>
          {dims.map((dim) => {
            const isActive = mode?.dim === dim;
            return (
              <div key={dim} data-testid={`flag-row-${dim}`} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-20 font-medium">{dimLabel(dim)}</span>
                  <button
                    type="button"
                    onClick={() => setMode(isActive && mode?.dir === 'high' ? null : { dim, dir: 'high' })}
                    className="rounded border border-input px-2 py-0.5 hover:bg-background"
                  >
                    too high
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEvidence(''); setMode(isActive && mode?.dir === 'low' ? null : { dim, dir: 'low' }); }}
                    className="rounded border border-input px-2 py-0.5 hover:bg-background"
                  >
                    too low
                  </button>
                </div>

                {isActive && mode?.dir === 'high' && (
                  <div className="ml-20 space-y-1">
                    <p className="text-[11px] text-muted-foreground">More like:</p>
                    {lowerAnchorOptions(dim, depthOf(competency, dim)).map((opt) => (
                      <button
                        key={opt.level}
                        type="button"
                        data-testid={`lower-opt-${dim}-${opt.level}`}
                        onClick={() => chooseLower(dim, opt.level)}
                        className="block w-full rounded border border-input px-2 py-1 text-left text-[11px] hover:bg-background"
                      >
                        {opt.text}
                      </button>
                    ))}
                  </div>
                )}

                {isActive && mode?.dir === 'low' && (
                  <div className="ml-20 space-y-1">
                    <label className="block text-[11px] text-muted-foreground" htmlFor={`ev-${dim}`}>
                      {evidencePromptFor(dim)}
                    </label>
                    <textarea
                      id={`ev-${dim}`}
                      aria-label={`evidence for ${dimLabel(dim)}`}
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      disabled={evidence.trim().length === 0}
                      onClick={() => raiseWithEvidence(dim)}
                      className="rounded border border-amber-600 bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40"
                    >
                      Raise {dimLabel(dim)}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
