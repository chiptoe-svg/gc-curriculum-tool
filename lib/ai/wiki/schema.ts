/**
 * Wiki schema — the structural contract the compiled wiki must conform to.
 *
 * This is the "declared schema" half of the trust model (cf. myKG): instead of
 * trusting the LLM compile loop to produce well-formed pages, we declare what a
 * valid wiki page of each type looks like and check it deterministically in
 * `lib/ai/wiki/lint.ts` (no LLM). The compile prompt (`wiki-update.md`)
 * produces these; the lint enforces them.
 */

export const WIKI_PAGE_TYPES = ['courses', 'competencies', 'targets', 'concepts'] as const;
export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number];

/** Hand-authored sections: served (MCP, /wiki, lint, wikilinks) but never
 *  generated — wiki-update / refresh-all / section-index use WIKI_PAGE_TYPES
 *  only. research/ is synced from curriculum_developer/docs/wiki-research by
 *  scripts/wiki/sync-research.ts (spec 2026-10-14). */
export const HAND_AUTHORED_TYPES = ['research'] as const;
export type HandAuthoredType = (typeof HAND_AUTHORED_TYPES)[number];

/** Every section the wiki serves. Readers import THIS, never their own list. */
export const WIKI_SERVED_TYPES = [...WIKI_PAGE_TYPES, ...HAND_AUTHORED_TYPES] as const;
export type WikiServedType = (typeof WIKI_SERVED_TYPES)[number];

export function isWikiServedType(t: string): t is WikiServedType {
  return (WIKI_SERVED_TYPES as readonly string[]).includes(t);
}

export interface WikiPageTypeSchema {
  /** Repo-relative directory holding pages of this type. */
  dir: WikiServedType;
  /** Section headings (any level) a page of this type must contain. Kept to the
   *  load-bearing few so minor prompt copy-edits don't trip the lint. */
  requiredSections: string[];
  /** Concepts only: a page may only be promoted once ≥ N source courses
   *  reference it (frontmatter `related_courses`). Enforces the existing
   *  ≥2-source concept-promotion gate as a checkable rule. */
  minRelatedForPromotion?: number;
}

export const WIKI_SCHEMA: Record<WikiPageType, WikiPageTypeSchema> = {
  courses: { dir: 'courses', requiredSections: ['Competencies developed', 'Source snapshots'] },
  competencies: { dir: 'competencies', requiredSections: ['Across the program'] },
  targets: { dir: 'targets', requiredSections: ['Sub-competencies', 'Program-level rollup'] },
  concepts: { dir: 'concepts', requiredSections: ['The idea'], minRelatedForPromotion: 2 },
};

/** Schema for every served section (generated + hand-authored). */
export const WIKI_SERVED_SCHEMA: Record<WikiServedType, WikiPageTypeSchema> = {
  ...WIKI_SCHEMA,
  research: { dir: 'research', requiredSections: [] },
};
