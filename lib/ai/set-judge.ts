/**
 * The set judge (spec 2026-11-17-course-cluster-map-design.md, "Matching rule"): when no single skill fully supplies a
 * target, a free campus model is asked whether a small set of skills together supplies it and whether any course has
 * students use them together. Task 4 adds the call itself; this file holds the shared shape and cut-offs.
 */

/** Bump when the set-test prompt text changes so old cached verdicts are not reused. */
export const SET_PROMPT_VERSION = 's1';

/**
 * P(yes) at or above these passes each set question: `any` = the shortlist together supplies it at all, `together` =
 * the kept set together develops it, `combining` = some course has students use them together. PROVISIONAL: picked by
 * hand from the 2026-11-16 composite experiment; refit on the owner's 22 set labels before they are trusted.
 */
export const SET_CUTOFFS = { any: 0.3, together: 0.6, combining: 0.5 } as const;

/** One set-test answer for a target. `kept`: the supplied skill refs in the smallest set (pair judge at least partly). */
export interface SetVerdict { pAny: number | null; kept: string[]; pTogether: number | null; pCombining: number | null }
