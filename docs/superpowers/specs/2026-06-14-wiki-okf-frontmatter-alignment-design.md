# Wiki OKF-v0.1 Frontmatter Alignment — Design

**Date:** 2026-06-14
**Status:** approved design (operator brainstorm 2026-06-14), pre-plan
**Origin:** Increment #2 of the two OKF fast-follows (Increment #1 = capture-surface download, shipped). The broader piece: bring the `gc-curriculum-wiki` narrative layer's frontmatter to OKF v0.1 so the wiki bundle becomes a portable interchange format any external tool/agent can open cold. Long-deferred item in STATE.md ("a light frontmatter naming pass to OKF v0.1 conformance").

## Decisions made in the brainstorm (2026-06-14)

1. **Rename to OKF vocab (not additive).** `name → title` (competency/target/concept; courses already have `title`), `updated_at → timestamp`; add `description`/`tags`/`resource`. Domain relations are preserved. **Safe:** no committed app code reads `name`/`updated_at`; the only frontmatter reader, `app/wiki/[type]/[slug]/page.tsx:62`, reads `frontmatter.title ?? pageSlug` — so adding `title` to every type *fixes* the current bug where competency/target/concept pages render their slug as the title.
2. **Include per-section `index.md` hub pages** (`type: index`) for `courses/`, `competencies/`, `targets/`, `concepts/` — currently missing.
3. **`description`:** agent-authored going forward (added to schema/prompt); backfill derives it deterministically from the first sentence of the page body (no LLM cost). [accepted by operator]
4. **`okf-frontmatter-missing` is a lint `error`** (fails `pnpm wiki:lint`), not a warning. [accepted by operator]
5. **Out of scope (unchanged deferrals):** `/wiki/graph` view; whole-curriculum bundle zip; the quantitative KUD+ core stays relational in Postgres (OKF is a prose-grounding format, not a metrics layer).

## Context (grounding findings)

- Wiki pages are **regenerated from Postgres** by the `wiki-update` AI function (`lib/ai/wiki/update.ts`); human edits to the narrative layer get clobbered. The frontmatter is LLM-authored following the wiki repo's `CLAUDE.md` schema, then `update.ts` **deterministically post-stamps** `input_hash` and `evidence_bands` (the fields the model must not author). This same post-stamp mechanism is the home for the new machine-truth OKF fields.
- `lib/ai/wiki/lint.ts` (`pnpm wiki:lint` → `scripts/wiki-lint.ts`) is the deterministic, no-LLM structural gate. It parses frontmatter via small regex helpers and emits typed `LintIssue`s.
- `scripts/wiki-backfill-bands.ts` (`pnpm wiki:backfill-bands`) is a working precedent for a deterministic in-place frontmatter backfill — mirror it.
- The wiki repo lives at `~/projects/gc-curriculum-wiki` (env `WIKI_REPO_PATH`); `wikiRepoPath()` in `lib/wiki/git-ops.ts` resolves it.
- Current page counts: 5 courses, ~30 competencies, 5 targets, 3 concepts (~43 pages) + the existing top-level `index.md`.

## Target frontmatter (per type)

`title`/`description`/`slug`/`tags`/`timestamp`/`resource` are the OKF keys on every page. Domain keys listed are **preserved unchanged**.

### course (`courses/<slug>.md`)
```yaml
type: course
title: "<course title>"          # already present
description: "<one line>"        # NEW
slug: <slug>
tags: [course, level-<n>, <track?>, <contributes_to_targets slugs…>]   # NEW, deterministic
timestamp: <ISO>                 # was updated_at
resource: <BASE>/wiki/courses/<slug>   # NEW
# preserved: level, prerequisites, last_snapshot_id, last_snapshot_path,
#            contributes_to_targets, develops_competencies, input_hash, evidence_bands
```

### competency (`competencies/<slug>.md`)
```yaml
type: competency
title: "<name>"                  # was name
description: "<one line>"        # NEW
slug: <slug>
tags: [competency, <career_target?>]   # NEW
timestamp: <ISO>                 # was updated_at
resource: <BASE>/wiki/competencies/<slug>   # NEW
# preserved: career_target, contributing_courses, input_hash, evidence_bands
```

### target (`targets/<slug>.md`)
```yaml
type: target
title: "<name>"                  # was name
description: "<one line>"
slug: <slug>
tags: [target]
timestamp: <ISO>
resource: <BASE>/wiki/targets/<slug>
# preserved: sub_competencies, contributing_courses, input_hash
```

### concept (`concepts/<slug>.md`)
```yaml
type: concept
title: "<name>"                  # was name
description: "<one line>"
slug: <slug>
tags: [concept]
timestamp: <ISO>
resource: <BASE>/wiki/concepts/<slug>
# preserved: related_courses, related_competencies, input_hash
```

### index (`<type>/index.md`, NEW, one per section)
```yaml
type: index
title: "Courses" | "Competencies" | "Targets" | "Concepts"
description: "Index of <section> pages in the GC curriculum wiki."
slug: <type>            # "courses" | "competencies" | "targets" | "concepts" (NOT "index" — would collide)
tags: [index, <type>]
timestamp: <ISO>
resource: <BASE>/wiki/<type>
```
Body: a deterministic list, one bullet per page in the section — `- [[<slug>]] — <description>` — sorted (courses by slug; others alphabetically by title).

**`<BASE>`** = `process.env.WIKI_PUBLIC_ORIGIN ?? 'http://130.127.162.180:3000'` (LAN-origin default, matching the app's existing convention; the `/wiki/*` route is faculty-gated, which is fine — `resource` points at where the live page lives for an authorized reader).

## Components

1. **Wiki repo `CLAUDE.md` "Frontmatter" + "Page slugs" sections** — rewrite the per-type blocks to the OKF vocab above; add the `index` type; document that `tags`/`timestamp`/`resource`/`slug` are machine-stamped (not author-written) and `title`/`description` are author-written. This is the authority the `wiki-update` LLM agent reads.

2. **`wiki-update` agent prompt** (in `lib/ai/wiki/` — the prompt/instruction the agent follows) — instruct the agent to emit `title` + `description` on every page and to **stop** emitting `name`. Leave `tags`/`timestamp`/`resource`/`slug` to the deterministic post-stamp.

3. **Deterministic OKF post-stamp** — a pure helper (new, e.g. `lib/ai/wiki/okf-frontmatter.ts`) that, given a page's type/slug/body/relations + a timestamp, computes and stamps `slug`, `timestamp`, `tags`, `resource` into the YAML block (replace-or-append, exactly like the existing `stampInputHash` in `update.ts`). Also normalizes a legacy `name:` line to `title:` and `updated_at:` to `timestamp:` if present (so it is idempotent over already-migrated and not-yet-migrated pages alike). `update.ts` calls it in the same post-generation pass as `input_hash`/`evidence_bands`. **`description` is NOT stamped here** — it is author-written (LLM) going forward; the backfill supplies it for existing pages.

4. **Section-index builder** — a pure function (in `lib/ai/wiki/okf-frontmatter.ts` or a sibling) that takes the set of `{type, slug, title, description}` for a section and returns the full `index.md` markdown (OKF index frontmatter + the bullet list). No LLM. Called by `update.ts` after the type pages are generated, and reused by the backfill.

5. **Backfill script** `scripts/wiki-backfill-okf.ts` (`pnpm wiki:backfill-okf`) — mirrors `wiki-backfill-bands.ts`. For each existing page: parse frontmatter+body, apply the post-stamp helper (rename name→title, updated_at→timestamp, add tags/resource/slug), and derive `description` = first sentence of the body (first non-heading sentence; fall back to title) when absent. Then build + write the 4 section `index.md` files via the index builder. **Idempotent** (re-run = no diff). Reads/writes the configured wiki clone.

6. **`gc-wiki-lint`** (`lib/ai/wiki/lint.ts` + types; `scripts/wiki-lint.ts` unchanged) —
   - New `LintIssue` kind **`okf-frontmatter-missing`** (severity `error`): a page missing any of `type`/`title`/`description`/`slug`/`tags`/`timestamp`/`resource`.
   - **Index handling:** recognize `index.md` files (by filename and/or `type: index`). For them: derive slug = parent-dir name (NOT "index"), exclude from the `orphan` check and the course `missing-section` check, and run the OKF-frontmatter check (and the index-listing check below). Add `index` to the page-type handling without breaking `WIKI_SCHEMA` lookups for the four narrative types.
   - Ensure non-index pages still get all existing checks (broken-wikilink, orphan, missing-section, ungated-concept, evidence-bands-missing) unchanged.

## Data flow

```
Postgres
  → wiki-update (LLM authors prose + title + description per page)
  → deterministic OKF post-stamp (slug, timestamp, tags, resource; + input_hash, evidence_bands)
  → section-index builder (pure; 4 index.md)
  → write pages to wiki clone
  → gc-wiki-lint gates (okf-frontmatter-missing = error)
```
The backfill script is a one-time path that reproduces the post-stamp + index-builder over the existing files using the **same shared helpers** (not duplicated logic) + the body-derived `description`.

## Boundaries / isolation
- `lib/ai/wiki/okf-frontmatter.ts` — pure OKF projection helpers (post-stamp + index builder + tag/resource derivation). No I/O. Unit-testable in isolation. Consumed by both `update.ts` and the backfill script.
- `scripts/wiki-backfill-okf.ts` — the only file doing wiki-clone file I/O for the migration; thin wrapper over the pure helpers.
- `lib/ai/wiki/lint.ts` — adds one check + index special-casing; no behavior change to existing checks.

## Testing
- **`okf-frontmatter.ts` (pure, priority):** per type, the post-stamp produces the correct OKF keys; tag derivation (course level/track/targets; competency career_target; type-only for target/concept/index); `resource` URL shape (+ env override); `name→title` / `updated_at→timestamp` normalization; idempotency (stamp twice = identical). Index builder: correct frontmatter + sorted bullet list with `[[wikilink]] — description`.
- **Lint:** `okf-frontmatter-missing` fires (error) when a key is absent, clean when all present; an `index.md` is NOT flagged as orphan or course-missing-section, but IS OKF-checked; existing checks unchanged (regression).
- **Backfill:** against a temp-dir fixture mirroring the real layout — asserts renamed keys, added keys, body-derived description, the 4 generated indexes; **idempotent** (second run yields no changes).
- **Integration:** run `pnpm wiki:backfill-okf` then `pnpm wiki:lint` on the real wiki clone → expect lint clean (0 `okf-frontmatter-missing`), and `git diff` in the wiki repo shows the migrated frontmatter. (Commit the wiki repo separately — it is its own git repo.)

## Out of scope (deferred / non-goals)
- `/wiki/graph` view and the whole-curriculum **bundle zip** (their natural home for richer hub/index/graph generation) — still deferred.
- Forcing KUD+ depth scores / coverage / reliability into markdown — explicitly rejected (OKF is prose-grounding, the metrics stay relational in Postgres).
- Rewriting the wiki body conventions or the `WIKI_SCHEMA` required-sections — unchanged.
