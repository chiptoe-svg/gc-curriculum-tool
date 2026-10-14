/**
 * Lightweight helpers for wiki markdown processing.
 *
 * Intentionally avoids pulling in gray-matter or js-yaml; the frontmatter
 * structure is simple enough for a 20-line inline parser.
 */

import path from 'node:path';
import * as nodeFs from 'node:fs';
import { WIKI_SERVED_TYPES, type WikiServedType } from '@/lib/ai/wiki/schema';

const WIKI_REPO_PATH =
  process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export interface Frontmatter {
  title?: string;
  [key: string]: string | undefined;
}

/**
 * Split a markdown string into { frontmatter, body }.
 * Returns { frontmatter: {}, body: raw } when no YAML block is present.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }

  const end = raw.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter: {}, body: raw };
  }

  const yamlBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trimStart();

  const frontmatter: Frontmatter = {};
  for (const line of yamlBlock.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Wikilink resolution
// ---------------------------------------------------------------------------

type WikiType = WikiServedType;

/**
 * Given a slug (e.g. "gc-4800", "brand-strategy"), find which of the served
 * section directories contains a matching .md file.
 * Returns null when no match is found (broken link).
 */
function resolveWikiSlug(slug: string): { type: WikiType; slug: string } | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null; // flat slugs only — never resolve "a/b" or traversal
  const fs = nodeFs;
  for (const type of WIKI_SERVED_TYPES) {
    const candidate = path.join(WIKI_REPO_PATH, type, `${slug}.md`);
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
      return { type, slug };
    } catch {
      // not found in this directory — continue
    }
  }
  return null;
}

/**
 * Pre-process markdown: convert [[wikilink]] syntax into standard markdown
 * links or broken-link spans before passing to react-markdown.
 *
 * Patterns handled:
 *   [[gc-4800]]             → link using slug as label
 *   [[gc-4800|Custom Text]] → link using "Custom Text" as label
 *   [[gc-4800\|Custom Text]] → same as the plain pipe form (table-escaped)
 */
export function resolveWikilinks(
  markdown: string,
  currentSlug: string,
  /** Page titles by slug; an unlabelled [[slug]] shows the title instead of the raw slug. */
  titles?: ReadonlyMap<string, string>,
): string {
  return markdown.replace(
    // `[^\]|\\]+` keeps a table-escaped `\|` out of the slug; `\\?` swallows that
    // backslash so [[slug\|Label]] (pipe escaped inside a markdown table cell)
    // resolves like [[slug|Label]].
    /\[\[([^\]|\\]+)\\?(?:\|([^\]]+))?\]\]/g,
    (_match, rawSlug: string, label?: string) => {
      const slug = rawSlug.trim();
      const displayText = label?.trim() ?? titles?.get(slug) ?? slug;
      const resolved = resolveWikiSlug(slug);
      if (resolved) {
        const q = currentSlug ? `?slug=${encodeURIComponent(currentSlug)}` : '';
        return `[${displayText}](/wiki/${resolved.type}/${resolved.slug}${q})`;
      }
      // Broken link — render as a code-span so it stands out without raw HTML.
      return `\`${displayText}\``;
    },
  );
}
