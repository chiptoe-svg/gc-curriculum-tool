# Wiki `research/` section — design

**Status:** owner-approved shape, 2026-10-14 ("Yes" to the question-led ~7-page section, two tracks). Replaces the 49-page proposal from ai_career (scoped 2026-10-14, recorded in STATE.md).

## 1. Why

Curriculum-committee members will hold informed discussions with AI assistants that read the GC wiki through the wiki MCP server. They need the program's view of AI and GC careers inside the wiki: what is changing for students' careers, which skills matter more, and what the curriculum should consider doing. The published papers and research docs live on GitHub Pages, which those assistants may not be able to open.

## 2. Decisions (owner, 2026-10-14)

1. **Question-led, not document-led.** About seven pages: `ai-careers-brief` (hub), `what-is-changing`, `more-or-fewer-jobs`, `career-paths`, `areas-of-focus`, `curriculum-implications`, `documents`. No per-source pages; sources stay in the papers' reference lists.
2. **Scope:** the two AI-career papers and the five-target framework, plus the program's research docs where they bear on the three questions.
3. **Summary pages, not audited research docs.** The held-sources quote + page rule does not apply to them (owner, confirmed 2026-10-14); the published papers are the citation-checked authority. Each page separates "What the evidence says" from "Our reading", names the document each point comes from, and links the full document. Proposals read as "could / something to consider".
4. **Authored here, synced into the wiki.** Source of truth: `docs/wiki-research/*.md` in this repo (reviewers' `SOURCES.md` is not synced). The owner reviews the pages before the first sync; ai_career checks the career pages against its papers.
5. **Hand-authored, never regenerated.** `wiki-update` / `refresh-all` never write `research/`; the sync step owns it.
6. **Public like the rest of `/wiki`** (read-only since 2026-09-25).

## 3. Tool changes

Today `research/` is not listed, searched, rendered or linted: the four generated sections (`courses`, `competencies`, `targets`, `concepts`) are hard-coded in about six places, with no shared constant (`lib/ai/wiki/schema.ts`, `lib/ai/wiki/tools.ts`, `lib/wiki/markdown-helpers.ts`, `app/wiki/[type]/[slug]/page.tsx`, `lib/wiki/index-data.ts`, `lib/ai/wiki/update.ts`).

1. **One constant for what is served.** Keep `WIKI_PAGE_TYPES` (generated sections; used by generators, section-index rebuild, OKF stamping) unchanged. Add `HAND_AUTHORED_TYPES = ['research']` and `WIKI_SERVED_TYPES = [...WIKI_PAGE_TYPES, ...HAND_AUTHORED_TYPES]` in `lib/ai/wiki/schema.ts`. Every reader (MCP `list_wiki` / `search_wiki`, the `/wiki/[type]/[slug]` renderer, `/wiki` index data, wikilink resolution, lint's link-target set) imports `WIKI_SERVED_TYPES` instead of its own copy. Generators keep `WIKI_PAGE_TYPES`, so they never touch `research/`.
2. **Rendering:** `/wiki/research/<slug>` works through the existing flat `[type]/[slug]` route. The `/wiki` index shows a "Research" section listing the research pages, hub first.
3. **MCP:** `list_wiki` and `search_wiki` include research pages (`read_wiki` already reads any non-`raw/` path).
4. **Wikilinks:** the resolver and lint find research slugs. **Fix the existing escaped-pipe bug:** `[[slug\|Label]]` (used inside markdown tables) must resolve in both `resolveWikilinks` (`lib/wiki/markdown-helpers.ts`) and lint's `WIKILINK_RE` (`lib/ai/wiki/lint.ts`); add tests for both (none exist today).
5. **Lint:** scans `research/` for broken wikilinks and for frontmatter (`type: research`, `title`, `description`, `slug` = filename). Generated-page required sections don't apply to research pages.
6. **Sync step:** `scripts/wiki/sync-research.ts` — dry run by default, `--apply` to write. Copies `docs/wiki-research/*.md` except `SOURCES.md` into `<WIKI_REPO_PATH>/research/`, removes research files no longer in the source (the sync owns the folder), runs lint over the result and refuses on errors, then commits only `research/` (`git add research/`) with its own message and pushes. Runs under the same serialization lock as `writeAndPush` so it can't interleave with a wiki-update.
7. **Wiki docs:** the sync also maintains a row in the wiki repo's `CLAUDE.md` and `README.md` stating `research/` is hand-authored, synced from `curriculum_developer/docs/wiki-research/`, never regenerated (today both say hand edits get clobbered).
8. **Root `index.md` is out of scope:** it is LLM-generated each refresh; research pages are reached through the `/wiki` index and `list_wiki`. A prompt change to link the brief from the generated root index is deferred.

## 4. Testing

- Unit: the served-types constant is the only list readers use (a test greps for stray hard-coded copies); escaped-pipe wikilinks resolve (renderer) and are validated (lint); nested `/` slugs still rejected by the renderer.
- Integration with a temp wiki dir: `list_wiki` / `search_wiki` return research pages; `/wiki/research/<slug>` renders; generators (`writeAndPush` path, section-index rebuild) leave `research/` untouched; sync dry run writes nothing; `--apply` copies, removes stale files, refuses on lint errors, commits only `research/` (a planted untracked file elsewhere is not committed).
- Red-proof the escaped-pipe tests and the "generators leave research/ alone" test.
- No live data involved; the wiki repo used in tests is a temp clone/dir, never `/Users/admin/projects/gc-curriculum-wiki`.

## 5. Rollout

1. Merge and deploy (no migration, no DB change).
2. Owner reviews `docs/wiki-research/` pages (and ai_career's accuracy check); owner approves.
3. `sync-research` dry run → `--apply` (owner yes): commits to the gc-curriculum-wiki repo and pushes.
4. Smoke: `https://gcworkflow.clemson.edu:8443/wiki` shows Research; an MCP `search_wiki` finds the brief.

## 6. Out of scope

Per-source pages; full-text copies of the papers; root `index.md` prompt change; embedding wiki pages (no wiki page is embedded today); automatic refresh when the papers change (re-run the sync after editing `docs/wiki-research/`).
