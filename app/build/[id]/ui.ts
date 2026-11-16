// Display helpers shared by the builder's panels. Pure.
import type { CheckpointStatus, ObjectiveResult, ObjectiveStatus } from '@/lib/builder/compute';
import type { Basis, Depth, LibraryCompetency } from '@/lib/builder/types';
import { BAND_LABELS, bandOf } from '@/lib/catalog/membership';

export type Tone = 'reached' | 'fading' | 'short' | 'untouched' | 'plain';

export const TONE_VAR: Record<Tone, string> = {
  reached: 'var(--cb-reached)', fading: 'var(--cb-fading)', short: 'var(--cb-short)',
  untouched: 'var(--cb-untouched)', plain: 'var(--cb-plain)',
};

export const toneOfCheckpoint = (s: CheckpointStatus): Tone =>
  s === 'met' ? 'reached' : s === 'fading' ? 'fading' : s === 'short' ? 'short' : s === 'untouched' ? 'untouched' : 'plain';

export const STATUS_WORD: Record<ObjectiveStatus, string> = {
  met: 'Reached at every checkpoint',
  fading: 'Reached, then fades below the target',
  late: 'Reached by the end, late at an earlier checkpoint',
  short: 'Falls short of the final target',
  untouched: 'No course in the plan works this',
  none: 'No target set',
};

export const CHECKPOINT_WORD: Record<CheckpointStatus, string> = {
  met: 'reached', fading: 'reached earlier, fading', short: 'short', untouched: 'not started', none: 'no target',
};

const DIM_NAME = { k: 'Know', u: 'Understand', d: 'Do' } as const;
export const dimName = (dim: 'k' | 'u' | 'd') => DIM_NAME[dim];
export const dimsOf = (c: LibraryCompetency): Array<'k' | 'u' | 'd'> => (c.foundational ? ['d'] : ['k', 'u', 'd']);

/** One dimension at one checkpoint: the level reached, against the level required. */
export function dimNote(o: ObjectiveResult, actIndex: number, dim: 'k' | 'u' | 'd'): { text: string; tone: Tone; title: string } {
  const reached = o.byAct[actIndex]![dim];
  const need = o.required[actIndex]?.[dim] ?? null;
  const held = o.heldByAct[actIndex]![dim];
  const letter = dim.toUpperCase();
  const name = DIM_NAME[dim];
  if (need == null || need <= 0) {
    return { text: `${letter}${reached ?? '·'}`, tone: 'plain', title: reached == null ? `${name}: no reading, no target` : `${name} ${reached}, no target here` };
  }
  if (reached == null) return { text: `${letter}·/${need}`, tone: 'untouched', title: `${name}: nothing yet, target ${need}` };
  if (reached < need) return { text: `${letter}${reached}/${need}`, tone: 'short', title: `${name} ${reached}, target ${need}` };
  if (held != null && Math.floor(held) < need) { // truncated, as in checkpoint()
    return { text: `${letter}${reached}▾`, tone: 'fading', title: `${name} reached ${reached} earlier; with nothing reinforcing it, it is estimated to have slipped below the target of ${need} by this point` };
  }
  return { text: `${letter}${reached}`, tone: 'reached', title: `${name} ${reached}, target ${need}` };
}

/** Trunk thickness: the Do level reached (the behavioral output), or the highest read dimension when Do is unread. */
export const trunkLevel = (d: Depth): number | null =>
  d.d ?? (d.k == null && d.u == null ? null : Math.max(d.k ?? 0, d.u ?? 0));

export const BASIS_WORD: Record<Basis, string> = {
  discovered: 'Discovered outcome', stated: 'Stated objective', proposed: 'Proposed',
};

export const STRATA: Array<{ key: string; name: string }> = [
  { key: 'technical', name: 'Technical' },
  { key: 'workflow_ai', name: 'Workflow and AI' },
  { key: 'business', name: 'Business' },
  { key: 'foundational', name: 'Foundational' },
];
export const stratumRank = (s: string | null) => { const i = STRATA.findIndex(x => x.key === s); return i < 0 ? STRATA.length : i; };
export const stratumName = (s: string | null) => STRATA.find(x => x.key === s)?.name ?? 'Other';

export const importanceWord = (w: number | null): string => {
  const b = bandOf(w);
  return b ? BAND_LABELS[b] : w == null ? 'Selected by faculty' : 'Below the importance cutoff';
};

export const fmtDepth = (d: Depth, foundational = false): string =>
  (foundational ? [['D', d.d]] : [['K', d.k], ['U', d.u], ['D', d.d]]).map(([l, v]) => `${l}${v ?? '·'}`).join(' ');

let n = 0;
export const newId = (prefix: string) => `${prefix}:${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
