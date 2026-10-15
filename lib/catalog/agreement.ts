import { taskGroupKey } from '@/lib/catalog/shortlist';

/**
 * Task 9 — pure agreement metrics between the AI's placements and the blind
 * reviewer's picks for one sampled bundle (spec §5; plan Ruling 5 for task
 * keys). Tasks are keyed by their task group, so a group expanded into one
 * row per occupation counts once.
 */

export type Pos = 'core' | 'related' | 'fringe';
const RANK: Record<Pos, number> = { core: 0, related: 1, fringe: 2 };

export interface AgreementInput { bundleId: string; ai: Map<string, Pos>; blind: Map<string, Pos>; blindTaskRanks: Map<string, number>; shortlistK: number }
export interface AgreementRow { bundleId: string; aiCount: number; blindCount: number; both: number; precision: number | null; recall: number | null; exact: number; withinOne: number; blindTasksOutsideShortlist: number }

export function itemKey(source: 'onet_element' | 'onet_task', externalIdOrLabel: string): string {
  return source === 'onet_element' ? `element:${externalIdOrLabel}` : `task:${taskGroupKey(externalIdOrLabel)}`;
}

export function computeAgreement(input: AgreementInput): AgreementRow {
  let both = 0, exact = 0, withinOne = 0, outside = 0;
  for (const [key, bp] of input.blind) {
    const ap = input.ai.get(key);
    if (ap !== undefined) {
      both++;
      if (ap === bp) exact++;
      if (Math.abs(RANK[ap] - RANK[bp]) <= 1) withinOne++;
    }
    const rank = input.blindTaskRanks.get(key);
    if (rank !== undefined && rank > input.shortlistK) outside++;
  }
  return {
    bundleId: input.bundleId, aiCount: input.ai.size, blindCount: input.blind.size, both,
    precision: input.ai.size === 0 ? null : both / input.ai.size,
    recall: input.blind.size === 0 ? null : both / input.blind.size,
    exact, withinOne, blindTasksOutsideShortlist: outside,
  };
}

/** Pooled row ('ALL'): ratios recomputed from summed counts, never averaged. */
export function sumAgreement(rows: AgreementRow[]): AgreementRow {
  const s = rows.reduce((a, r) => ({
    aiCount: a.aiCount + r.aiCount, blindCount: a.blindCount + r.blindCount, both: a.both + r.both,
    exact: a.exact + r.exact, withinOne: a.withinOne + r.withinOne, out: a.out + r.blindTasksOutsideShortlist,
  }), { aiCount: 0, blindCount: 0, both: 0, exact: 0, withinOne: 0, out: 0 });
  return {
    bundleId: 'ALL', aiCount: s.aiCount, blindCount: s.blindCount, both: s.both,
    precision: s.aiCount === 0 ? null : s.both / s.aiCount, recall: s.blindCount === 0 ? null : s.both / s.blindCount,
    exact: s.exact, withinOne: s.withinOne, blindTasksOutsideShortlist: s.out,
  };
}

/** Null if lengths differ or are 0, or if expected agreement is 1 (κ undefined). */
export function cohenKappa(a: Array<Pos | 'none'>, b: Array<Pos | 'none'>): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  const n = a.length;
  const cats = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
  const po = agree / n;
  let pe = 0;
  for (const c of cats) pe += (a.filter(x => x === c).length / n) * (b.filter(x => x === c).length / n);
  if (pe === 1) return null;
  return (po - pe) / (1 - pe);
}
