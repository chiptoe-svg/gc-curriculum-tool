/**
 * Wiki-navigation tools for the curriculum-chat agent.
 *
 * Three tools cover the navigation surface:
 *   - read_wiki   — fetch a single page by repo-relative path
 *   - list_wiki   — enumerate pages, optionally filtered by type
 *   - search_wiki — full-text find across all pages, with snippets
 *
 * All three reject paths that escape the wiki repo or that try to read
 * `raw/` (the immutable snapshot JSON layer — not narrative, not useful
 * for chat). `readWikiPage` already applies a traversal guard; we layer
 * an explicit `raw/` reject on top so the agent can't load megabytes of
 * snapshot JSON by accident.
 */

import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { readWikiPage, wikiRepoPath } from '@/lib/wiki/git-ops';
import { resolvePageBands, pagePassesBandFloor, BAND_ORDER } from '@/lib/ai/wiki/evidence-band-markers';

const ALLOWED_TYPES = ['courses', 'competencies', 'targets', 'concepts'] as const;
type WikiType = (typeof ALLOWED_TYPES)[number];

function rejectRaw(p: string): { ok: true; path: string } | { ok: false; error: string } {
  // Normalize separators and strip leading slash; this is purely for the
  // raw/ guard. The traversal guard inside readWikiPage handles ".."
  // / absolute-path attacks.
  const normalized = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.startsWith('raw/')) {
    return { ok: false, error: 'cannot read raw/ — that layer is immutable snapshot JSON, not narrative wiki content' };
  }
  return { ok: true, path: normalized };
}

/**
 * Walk the wiki repo for narrative pages. Returns the relative paths of
 * every `.md` under `courses/`, `competencies/`, `targets/`, `concepts/`
 * plus the top-level `index.md` if present. Cached for the lifetime of
 * the process (the wiki repo doesn't change inside one Next.js request,
 * and a fresh `list_wiki` call cost ~5ms uncached on a ~50-page repo).
 */
let pageListCache: { paths: string[]; cachedAt: number } | null = null;
const PAGE_LIST_TTL_MS = 5_000;

async function listNarrativePages(filterType?: WikiType): Promise<string[]> {
  const now = Date.now();
  if (!pageListCache || now - pageListCache.cachedAt > PAGE_LIST_TTL_MS) {
    const root = wikiRepoPath();
    const dirs = ALLOWED_TYPES;
    const collected: string[] = [];
    for (const dir of dirs) {
      try {
        const entries = await fs.readdir(path.join(root, dir));
        for (const e of entries) {
          if (e.endsWith('.md')) collected.push(`${dir}/${e}`);
        }
      } catch {
        // Directory may not exist yet (e.g. fresh wiki with no targets).
      }
    }
    try {
      await fs.stat(path.join(root, 'index.md'));
      collected.push('index.md');
    } catch {
      // No index yet.
    }
    pageListCache = { paths: collected.sort(), cachedAt: now };
  }
  if (filterType) {
    return pageListCache.paths.filter(p => p.startsWith(`${filterType}/`));
  }
  return pageListCache.paths;
}

/**
 * Extract a title from a markdown page. Prefers the YAML frontmatter's
 * `title` field; falls back to the first `# H1` line; finally returns
 * the path stem.
 */
function extractTitle(markdown: string, fallback: string): string {
  // Frontmatter
  if (markdown.startsWith('---')) {
    const end = markdown.indexOf('\n---', 3);
    if (end > 0) {
      const front = markdown.slice(3, end);
      const titleLine = front.split('\n').find(l => /^title:\s*/.test(l));
      if (titleLine) {
        return titleLine.replace(/^title:\s*/, '').replace(/^["']|["']$/g, '').trim();
      }
    }
  }
  // First h1
  const h1Match = markdown.match(/^# (.+)$/m);
  if (h1Match) return h1Match[1]!.trim();
  return fallback;
}

export const wikiReadTool: ToolDefinition = {
  name: 'read_wiki',
  description:
    'Read one wiki page. The argument is named `path` and takes the repo-relative page path, e.g. {"path": "courses/gc-4800.md"} — also "competencies/brand-strategy.md", "targets/production-operations.md", "concepts/productive-failure.md", "index.md". A missing .md extension is tolerated ("courses/gc-4800" works). Returns the page\'s full markdown. Reject paths under "raw/" — those are immutable snapshot JSON, not narrative.',
  usagePolicy:
    'Use when you know the exact path you want (typically from a prior list_wiki / search_wiki call, or an obvious slug from the user\'s question like "GC 4800" → "courses/gc-4800.md"). Cite the path in your response.',
  inputSchema: z.object({ path: z.string() }),
  async execute(args) {
    const a = args as { path: string };
    // Forgive a missing .md — MCP callers pass "courses/gc-3700" from slugs
    // (observed 2026-09-06; the caller then concluded the page didn't exist).
    const withExt = /\.\w+$/.test(a.path) ? a.path : `${a.path}.md`;
    const guard = rejectRaw(withExt);
    if (!guard.ok) return { error: guard.error };
    const content = await readWikiPage(guard.path);
    if (content === null) return { error: `page not found: ${guard.path}` };
    // Annotate which evidence bands the page carries (increment A). Empty for
    // legacy pages not yet recompiled with band markers.
    return { content, path: guard.path, evidenceBands: resolvePageBands(content) };
  },
};

export const wikiListTool: ToolDefinition = {
  name: 'list_wiki',
  description:
    'List every narrative wiki page (courses, competencies, targets, concepts) with its title. Optionally filter by type. Use this to orient when you don\'t know which page to read.',
  usagePolicy:
    'Call once at the start of a session if the user\'s question is broad ("what does the program cover?", "are there gaps in Act 2?"). Don\'t call it repeatedly — the result is stable across a single session.',
  inputSchema: z.object({
    type: z.enum(ALLOWED_TYPES).optional(),
  }),
  async execute(args) {
    const a = args as { type?: WikiType };
    const paths = await listNarrativePages(a.type);
    const pages = await Promise.all(
      paths.map(async p => {
        const content = await readWikiPage(p);
        const title = content
          ? extractTitle(content, p.replace(/\.md$/, ''))
          : p.replace(/\.md$/, '');
        return { path: p, title };
      }),
    );
    return { pages };
  },
};

export const wikiSearchTool: ToolDefinition = {
  name: 'search_wiki',
  description:
    'Full-text search across all narrative wiki pages. Matches by TERMS (a page hits when it contains at least half the query\'s words; pages matching more words rank higher, an exact-phrase match ranks first), so multi-word queries like "GC 3700 major projects" work. Returns matching pages with a short snippet, and the evidence bands each page carries (claimed / materials_supported / artifact_verified). Case-insensitive; literal words, not semantic. Cap 20 hits. Pass an optional `bandFloor` to keep only pages whose evidence reaches that credibility level (e.g. "only artifact-verified") — pages carrying no band markers are kept (legacy).',
  usagePolicy:
    'Use when the user names a topic but you don\'t know which page covers it ("does anyone teach spot color matching?", "what does the program say about deliberate practice?"). Matching is literal words, not semantic — prefer the topic\'s distinctive words over long sentences. Use `bandFloor` only when the user asks for evidence-grounded results ("which courses can actually demonstrate X", "only artifact-verified").',
  inputSchema: z.object({
    query: z.string().min(1),
    bandFloor: z.enum(BAND_ORDER as unknown as [string, ...string[]]).optional(),
  }),
  async execute(args) {
    const a = args as { query: string; bandFloor?: (typeof BAND_ORDER)[number] };
    const q = a.query.toLowerCase();
    // Term matching, not whole-query substring. The old exact-substring match
    // meant "GC 3700 major projects assignments" had to appear verbatim in a
    // page — any query with extra words returned 0 hits, and the calling agent
    // concluded the wiki had nothing for the course (observed via the gc-wiki
    // MCP, 2026-09-06). Now: pages match if they contain at least half the
    // query's terms (≥2 chars), ranked by how many terms they match, with a
    // whole-phrase match ranked above everything. Single-term queries behave
    // exactly as before.
    const terms = q.split(/\s+/).filter(t => t.length >= 2);
    const threshold = Math.max(1, Math.ceil(terms.length / 2));
    const paths = await listNarrativePages();
    const scored: Array<{ score: number; order: number; hit: { path: string; title: string; snippet: string; evidenceBands: string[] } }> = [];
    let order = 0;
    for (const p of paths) {
      const content = await readWikiPage(p);
      if (!content) continue;
      const lower = content.toLowerCase();
      const phraseIdx = lower.indexOf(q);
      const matched = terms.filter(t => lower.includes(t));
      if (phraseIdx < 0 && matched.length < threshold) continue;
      // Title/path terms outweigh body mentions: for "GC 3700 major projects"
      // the GC 3700 page must beat pages that merely reference GC 3700 in
      // passing — its title/slug is the discriminating signal.
      const titlePath = `${extractTitle(content, '')} ${p}`.toLowerCase();
      const boosted = matched.filter(t => titlePath.includes(t)).length;
      const bands = resolvePageBands(content);
      // Band floor (increment A): drop pages whose evidence is entirely below
      // the requested level. Pages with no markers pass through (annotated []).
      if (a.bandFloor && !pagePassesBandFloor(bands, a.bandFloor)) continue;
      // Snippet around the whole phrase when present, else the first matched term.
      const anchorIdx = phraseIdx >= 0 ? phraseIdx : lower.indexOf(matched[0]!);
      const anchorLen = phraseIdx >= 0 ? q.length : matched[0]!.length;
      const start = Math.max(0, anchorIdx - 60);
      const end = Math.min(content.length, anchorIdx + anchorLen + 100);
      const raw = content.slice(start, end).replace(/\s+/g, ' ').trim();
      scored.push({
        score: matched.length + 2 * boosted + (phraseIdx >= 0 ? 3 * terms.length + 1 : 0),
        order: order++,
        hit: {
          path: p,
          title: extractTitle(content, p.replace(/\.md$/, '')),
          snippet: (start > 0 ? '…' : '') + raw + (end < content.length ? '…' : ''),
          evidenceBands: bands,
        },
      });
    }
    scored.sort((x, y) => (y.score - x.score) || (x.order - y.order));
    return { hits: scored.slice(0, 20).map(s => s.hit), query: a.query, bandFloor: a.bandFloor ?? null };
  },
};

/**
 * The full tool surface the curriculum-chat agent has access to.
 * Returned as a function (not a constant) for symmetry with `buildAuditTools`
 * and so future per-session tool customization has a hook.
 */
export function buildCurriculumChatTools(): ToolDefinition[] {
  return [wikiListTool, wikiReadTool, wikiSearchTool];
}
