import { taskGroupKey } from '@/lib/catalog/shortlist';

/**
 * Task 9 — pure agreement metrics between the AI's placements and the blind
 * reviewer's picks for one sampled bundle (spec §5; plan Ruling 5 for task
 * keys). Tasks are keyed by their task group, so a group expanded into one
 * row per occupation counts once.
 */

export type Pos = 'core' | 'related' | 'fringe';

/**
 * Decision 2026-10-19: the blind check offers core / related / unmarked only,
 * so agreement is measured on core + related. The AI's fringe placements are
 * excluded (precision denominator included); position agreement is an exact
 * core-vs-related match on items both sides placed.
 */
export interface AgreementInput {
  bundleId: string; ai: Map<string, Pos>; blind: Map<string, Pos>;
  /** Element item keys the reviewer was shown; null = no record (older submission), nothing is excluded. */
  shownElements?: Set<string> | null;
  /** Reviewer task picks that came from the non-first tasks of merged rows. */
  mergedItems?: number;
}
export interface AgreementRow {
  bundleId: string; aiCount: number; blindCount: number; both: number; precision: number | null; recall: number | null; exact: number;
  /** AI core/related elements outside the reviewer's shown list: left out of precision, counted here. */
  aiOutsideList: number;
  /** Reviewer items from merged rows (the extra tasks a single pick stood for). */
  mergedItems: number;
  /** True when there was no shown-items record, so AI elements were not excluded. */
  noShownRecord: boolean;
}

export function itemKey(source: 'onet_element' | 'onet_task', externalIdOrLabel: string): string {
  return source === 'onet_element' ? `element:${externalIdOrLabel}` : `task:${taskGroupKey(externalIdOrLabel)}`;
}

function coreRelated(m: Map<string, Pos>): Map<string, 'core' | 'related'> {
  const out = new Map<string, 'core' | 'related'>();
  for (const [k, p] of m) if (p === 'core' || p === 'related') out.set(k, p);
  return out;
}

export function computeAgreement(input: AgreementInput): AgreementRow {
  const shown = input.shownElements ?? null;
  const ai = coreRelated(input.ai);
  let aiOutsideList = 0;
  if (shown !== null) {
    for (const k of [...ai.keys()]) {
      if (k.startsWith('element:') && !shown.has(k)) { ai.delete(k); aiOutsideList++; }
    }
  }
  const blind = coreRelated(input.blind);
  let both = 0, exact = 0;
  for (const [key, bp] of blind) {
    const ap = ai.get(key);
    if (ap === undefined) continue;
    both++;
    if (ap === bp) exact++;
  }
  return {
    bundleId: input.bundleId, aiCount: ai.size, blindCount: blind.size, both,
    precision: ai.size === 0 ? null : both / ai.size,
    recall: blind.size === 0 ? null : both / blind.size,
    exact, aiOutsideList, mergedItems: input.mergedItems ?? 0, noShownRecord: shown === null,
  };
}

/** Pooled row ('ALL'): ratios recomputed from summed counts, never averaged. */
export function sumAgreement(rows: AgreementRow[]): AgreementRow {
  const s = rows.reduce((a, r) => ({
    aiCount: a.aiCount + r.aiCount, blindCount: a.blindCount + r.blindCount, both: a.both + r.both, exact: a.exact + r.exact,
    out: a.out + r.aiOutsideList, merged: a.merged + r.mergedItems, noRec: a.noRec || r.noShownRecord,
  }), { aiCount: 0, blindCount: 0, both: 0, exact: 0, out: 0, merged: 0, noRec: false });
  return {
    bundleId: 'ALL', aiCount: s.aiCount, blindCount: s.blindCount, both: s.both,
    precision: s.aiCount === 0 ? null : s.both / s.aiCount, recall: s.blindCount === 0 ? null : s.both / s.blindCount,
    exact: s.exact, aiOutsideList: s.out, mergedItems: s.merged, noShownRecord: s.noRec,
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
