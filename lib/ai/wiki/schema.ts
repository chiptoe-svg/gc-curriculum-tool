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

export interface WikiPageTypeSchema {
  /** Repo-relative directory holding pages of this type. */
  dir: WikiPageType;
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
