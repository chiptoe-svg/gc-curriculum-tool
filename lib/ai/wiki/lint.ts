/**
 * gc-wiki-lint — deterministic, NO-LLM structural validation of the compiled
 * wiki (cf. myKG's structural rule-check). The compile loop is LLM prose
 * synthesis; this is the layer the model doesn't get a say in. Pure: reads the
 * wiki repo, returns typed issues; never writes.
 *
 * Checks:
 *  - broken-wikilink  : a `[[slug]]` whose target page doesn't exist
 *  - orphan           : a narrative page nothing links to (warning; index excluded)
 *  - missing-section  : a page lacking a required section for its type (schema.ts)
 *  - ungated-concept  : a concept promoted from < 2 source courses (the ≥2-source gate)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { wikiRepoPath } from '@/lib/wiki/git-ops';
import { WIKI_PAGE_TYPES, WIKI_SCHEMA, type WikiPageType } from './schema';
import { detectBands, readEvidenceBandsFrontmatter } from '@/lib/ai/wiki/evidence-band-markers';
import { OKF_REQUIRED_KEYS } from '@/lib/ai/wiki/okf-frontmatter';

export type LintSeverity = 'error' | 'warning';

export interface LintIssue {
  kind: 'broken-wikilink' | 'orphan' | 'missing-section' | 'ungated-concept' | 'evidence-bands-missing' | 'okf-frontmatter-missing';
  severity: LintSeverity;
  page: string; // repo-relative path
  detail: string;
}

interface ParsedPage {
  relPath: string;
  type: WikiPageType;
  slug: string;
  headings: string[];
  links: string[]; // wikilink target slugs (lowercased)
  relatedCourses: string[]; // concepts only
  hasBandMarkers: boolean;
  hasBandFrontmatter: boolean;
  isIndex: boolean;
  missingOkfKeys: string[];
}

const WIKILINK_RE = /\[\[([a-z0-9-]+)(?:\|[^\]]*)?\]\]/gi;

/** True when `field:` appears in the page's frontmatter block. */
function hasFrontmatterKey(text: string, field: string): boolean {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  return fm ? new RegExp(`^${field}:\\s*.+$`, 'm').test(fm[1]!) : false;
}

/** Read a `field: value` or `field: [a, b]` line from a page's frontmatter. */
function frontmatterList(text: string, field: string): string[] {
  const m = text.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  if (!m || !m[1]) return [];
  const v = m[1].trim();
  if (v.startsWith('[')) {
    return v
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  return v ? [v] : [];
}

function parsePage(type: WikiPageType, file: string, text: string): ParsedPage {
  const isIndex = file === 'index.md';
  return {
    relPath: `${type}/${file}`,
    type,
    slug: isIndex ? type : file.replace(/\.md$/, ''),
    headings: [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map(m => m[1]!.trim()),
    links: [...text.matchAll(WIKILINK_RE)].map(m => m[1]!.toLowerCase()),
    relatedCourses: type === 'concepts' && !isIndex ? frontmatterList(text, 'related_courses') : [],
    hasBandMarkers: detectBands(text).length > 0,
    hasBandFrontmatter: readEvidenceBandsFrontmatter(text) !== null,
    isIndex,
    missingOkfKeys: OKF_REQUIRED_KEYS.filter(k => !hasFrontmatterKey(text, k)),
  };
}

/**
 * Lint the wiki at `root` (defaults to the configured clone). Returns all
 * issues; empty array = clean.
 */
export async function lintWiki(root: string = wikiRepoPath()): Promise<LintIssue[]> {
  const pages: ParsedPage[] = [];
  for (const type of WIKI_PAGE_TYPES) {
    let files: string[] = [];
    try {
      files = (await fs.readdir(path.join(root, type))).filter(f => f.endsWith('.md'));
    } catch {
      // A type directory may not exist yet (e.g. a wiki with no targets).
    }
    for (const file of files) {
      const text = await fs.readFile(path.join(root, type, file), 'utf8');
      pages.push(parsePage(type, file, text));
    }
  }

  const allSlugs = new Set(pages.map(p => p.slug));
  const linkedTo = new Set<string>();
  for (const p of pages) for (const l of p.links) linkedTo.add(l);

  const issues: LintIssue[] = [];
  for (const p of pages) {
    for (const l of p.links) {
      if (!allSlugs.has(l)) {
        issues.push({
          kind: 'broken-wikilink',
          severity: 'error',
          page: p.relPath,
          detail: `[[${l}]] → no wiki page has slug "${l}"`,
        });
      }
    }

    if (p.missingOkfKeys.length > 0) {
      issues.push({
        kind: 'okf-frontmatter-missing',
        severity: 'error',
        page: p.relPath,
        detail: `missing OKF frontmatter key(s): ${p.missingOkfKeys.join(', ')}`,
      });
    }

    if (!p.isIndex) {
      if (!linkedTo.has(p.slug)) {
        issues.push({
          kind: 'orphan',
          severity: 'warning',
          page: p.relPath,
          detail: `nothing links to [[${p.slug}]]`,
        });
      }

      for (const sec of WIKI_SCHEMA[p.type].requiredSections) {
        if (!p.headings.some(h => h.toLowerCase() === sec.toLowerCase())) {
          issues.push({
            kind: 'missing-section',
            severity: 'warning',
            page: p.relPath,
            detail: `missing required section "${sec}"`,
          });
        }
      }

      const minRel = WIKI_SCHEMA[p.type].minRelatedForPromotion;
      if (minRel !== undefined && p.relatedCourses.length < minRel) {
        issues.push({
          kind: 'ungated-concept',
          severity: 'error',
          page: p.relPath,
          detail: `concept promoted from ${p.relatedCourses.length} source course(s); the ≥${minRel}-source gate requires more`,
        });
      }

      if ((p.type === 'courses' || p.type === 'competencies') && p.hasBandMarkers && !p.hasBandFrontmatter) {
        issues.push({
          kind: 'evidence-bands-missing',
          severity: 'warning',
          page: p.relPath,
          detail: 'carries evidence-band markers but no structured `evidence_bands` frontmatter — run `pnpm wiki:backfill-bands` or recompile',
        });
      }
    }
  }
  // Root index.md (repo root, not in a type dir): OKF frontmatter only — it's
  // the LLM dashboard, so skip orphan/missing-section like the section indexes.
  try {
    const rootIndex = await fs.readFile(path.join(root, 'index.md'), 'utf8');
    const missing = OKF_REQUIRED_KEYS.filter(k => !hasFrontmatterKey(rootIndex, k));
    if (missing.length > 0) {
      issues.push({
        kind: 'okf-frontmatter-missing',
        severity: 'error',
        page: 'index.md',
        detail: `missing OKF frontmatter key(s): ${missing.join(', ')}`,
      });
    }
  } catch {
    // no root index.md — skip
  }

  return issues;
}

/** One-line human summary, for the compile-loop log + the CLI. */
export function summarizeLint(issues: LintIssue[]): string {
  if (issues.length === 0) return 'wiki-lint: clean ✓';
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const byKind = issues.reduce<Record<string, number>>((a, i) => {
    a[i.kind] = (a[i.kind] ?? 0) + 1;
    return a;
  }, {});
  const kinds = Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ');
  return `wiki-lint: ${errors} error(s), ${warnings} warning(s) — ${kinds}`;
}
