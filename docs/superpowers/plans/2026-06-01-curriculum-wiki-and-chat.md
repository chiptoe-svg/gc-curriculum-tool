# Curriculum Wiki (Option B) + Conversational Chat Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the curriculum knowledge base as a git-tracked markdown corpus (Karpathy LLM-wiki pattern) that the LLM regenerates and maintains on every snapshot creation, plus a conversational chat surface where faculty ask class-specific or program-level questions and get cited answers from the wiki.

**Architecture:** A new sibling repo `chiptoe-svg/gc-curriculum-wiki` (private) holds the markdown corpus. Cloned locally at `/Users/admin/projects/gc-curriculum-wiki/` and read by the tool. A new AI function `wiki-update` fires on snapshot creation (or `Approve this profile` action), reads the new snapshot + related entity substrate from Postgres, regenerates the 5–15 affected pages (course + touched sub-competencies + career-target rollups + concept pages whose data shifted), commits + pushes via the existing GitHub PAT. The tool reads from the local clone for `/wiki/...` routes and serves rendered HTML; Obsidian users can `git clone` the repo for graph view + Dataview. Phase B adds `/ask` — a new conversational chat surface using a new `curriculum-chat` AI function whose tools navigate the wiki (read, search, list). Both class-specific (`?focus=gc-4800`) and program-level Q&A modes are the same agent with different starting context.

**Tech:** Next.js 15 App Router, Drizzle, Vercel AI SDK v6 streaming tools (reuse `streamWithTools`), Node `child_process` for git ops, the existing GitHub PAT, MDX or `react-markdown` for rendering.

---

## Wiki structure (the canonical layout)

Following the Karpathy LLM-wiki pattern of separating **raw evidence** (immutable, never edited) from the **wiki layer** (LLM-generated, regenerated on each ingest):

```
gc-curriculum-wiki/
├── README.md          — what this is + how to navigate
├── CLAUDE.md          — schema doc: page conventions, [[wikilink]] syntax, frontmatter shape
├── index.md           — catalog of all pages by category with one-line summaries
├── log.md             — append-only chronological log of every wiki-update operation
│
├── raw/               — IMMUTABLE evidence layer (never overwritten, only appended)
│   ├── snapshots/     — every approved CaptureProfile snapshot, full JSON
│   │   ├── gc-4800/
│   │   │   ├── 2026-04-12_abc123.json
│   │   │   └── 2026-05-25_def456.json
│   │   └── gc-4440/
│   │       └── 2026-06-15_xyz789.json
│   └── transcripts/   — full audit conversations that produced each snapshot
│       ├── gc-4800/
│       │   └── 2026-05-25_<session-id-short>.md
│       └── gc-4440/
│           └── 2026-06-15_<session-id-short>.md
│
├── courses/           — wiki layer (LLM-maintained narrative pages)
│   ├── gc-1010.md
│   ├── gc-3460.md
│   └── gc-4800.md
├── competencies/
│   ├── brand-strategy.md
│   └── color-management.md
├── targets/
│   ├── brand-strategist.md
│   └── press-operator.md
└── concepts/
    ├── productive-failure.md
    ├── three-act-structure.md
    └── scaffolding-analysis.md
```

**The raw/ layer is the load-bearing audit trail.** Every approved profile snapshot lands as `raw/snapshots/<course-slug>/<YYYY-MM-DD>_<short-sha>.json` with the full structured `CaptureProfile` (overview + competencies + incoming_expectations + verification_summary + audit_notes + citations). Every audit session transcript lands as `raw/transcripts/<course-slug>/<YYYY-MM-DD>_<short-session>.md` (a markdown rendering of the `capture_messages` turns + tool calls + citations). The wiki layer (courses/, competencies/, etc.) is LLM-generated *from* the raw layer and is read-only from faculty's perspective. Anyone reading a wiki page can click through to the source snapshot's JSON for verification.

**Benefits of including raw/ in the repo:**
- **Reproducibility.** The wiki's claims can be audited against the source profiles.
- **External consumers.** Other tools can read the JSON directly without going through Postgres or the curriculum tool's API.
- **Off-site redundancy.** Profiles + transcripts live in two places (Postgres + GitHub repo) instead of just one.
- **Cross-snapshot evolution.** `git log raw/snapshots/gc-4800/` shows the timeline of every captured version of that course.
- **Reinforces immutability.** A snapshot in git history can't be silently mutated; any change would be a visible commit.

Page slugs ARE the existing PKs (`courses.code` lowercased + space → hyphen; `careerTargets.id`; `subCompetencies.id`). Concepts get hand-picked slugs (one-off when needed). Every page has YAML frontmatter:

```yaml
---
type: course | competency | target | concept
slug: gc-4800
updated_at: 2026-06-15T14:00:00Z
last_snapshot_id: <uuid>  # courses only
contributing_courses:     # competencies + targets only
  - gc-4800
  - gc-3460
---
```

Body uses Fraunces-aware editorial prose + `[[wikilinks]]` for navigation. No HTML — pure markdown so Obsidian renders natively.

---

# Phase A — Wiki layer

## Task A1: Bootstrap the wiki repo

**Files:**
- Create the GitHub repo `chiptoe-svg/gc-curriculum-wiki` (private)
- Clone locally to `/Users/admin/projects/gc-curriculum-wiki/`
- Seed: `README.md`, `CLAUDE.md` (schema), `index.md` (empty placeholder), `log.md` (empty), four empty subdirs

- [ ] **Step 1: Create the repo + clone**

```bash
gh repo create chiptoe-svg/gc-curriculum-wiki --private --description "Living knowledge base for the GC curriculum — LLM-maintained, faculty-browsable" --clone --add-readme=false
mv gc-curriculum-wiki /Users/admin/projects/gc-curriculum-wiki
cd /Users/admin/projects/gc-curriculum-wiki
mkdir -p courses competencies targets concepts raw/snapshots raw/transcripts
touch index.md log.md
# Per-course subdirs created lazily by wiki-update on first ingest.
```

- [ ] **Step 2: Write the schema doc**

Create `/Users/admin/projects/gc-curriculum-wiki/CLAUDE.md` per the Karpathy LLM-wiki pattern. Describe: page types, frontmatter shape, wikilink conventions, the "never hand-edit pages; all human input goes through the curriculum tool's structured UI surfaces" rule, the four operations (ingest / query / lint / navigate), and a directory map. ~80–120 lines.

- [ ] **Step 3: Write README.md**

User-facing entry point. Says: "This repo is the living knowledge base for the GC curriculum. Browse pages here, or clone and open in Obsidian. The curriculum tool maintains it — faculty don't edit pages directly; they edit via the tool, and the tool regenerates affected pages on each snapshot."

- [ ] **Step 4: Initial commit + push**

```bash
cd /Users/admin/projects/gc-curriculum-wiki
git add -A
git commit -m "chore: bootstrap empty wiki structure"
git push -u origin main
```

- [ ] **Step 5: Commit the path to the main repo's STATE**

In the main `gc-curriculum-tool` repo: add a one-liner to STATE.md under "Architecture (at-a-glance)" noting the sibling repo and its local path.

```bash
cd /Users/admin/projects/curriculum_developer
# (edit STATE.md)
git add docs/STATE.md
git commit -m "docs(state): note gc-curriculum-wiki sibling repo (Phase A of wiki plan)"
```

---

## Task A2: `wiki-update` AI function

**Files:**
- Create: `lib/ai/prompts/wiki-update.md` — the prompt
- Create: `lib/ai/wiki/update.ts` — orchestration (loads substrate, calls LLM, returns map of paths → markdown)
- Create: `lib/ai/wiki/templates.ts` — per-entity-type structural templates the prompt references
- Modify: `lib/ai/function-settings.ts` — register `wiki-update` function ID (default tier: heavy — quality matters more than cost for a wiki page; ~$1–3 per snapshot)

- [ ] **Step 1: Decide the affected-entity computation**

A new snapshot for course X affects two categories of writes:

**Raw layer (always written, never regenerated):**
- `raw/snapshots/{course-slug}/{YYYY-MM-DD}_{short-snapshot-id}.json` — the full `CaptureProfile` JSON straight from `course_capture_snapshots.profile`
- `raw/transcripts/{course-slug}/{YYYY-MM-DD}_{short-session-id}.md` — a markdown rendering of the audit transcript (one turn per heading, citations preserved). Only written when `transcriptSessionId` is set (i.e. v2 captures); v1 legacy snapshots skip this.

**Wiki layer (regenerated by the LLM each time):**
- `courses/{X}.md` (always)
- `competencies/{sub}.md` for each sub-competency the snapshot touches (read `snapshot_target_coverage` for this snapshot)
- `targets/{t}.md` for each career target whose competencies are touched
- `concepts/productive-failure.md` if the snapshot has `audit_notes.productive_failure_conditions` populated AND any competency depth changed materially
- `concepts/three-act-structure.md` if the depth shift moves the course's act-placement signal
- `concepts/scaffolding-analysis.md` if Phase 1B's status changes (well-scaffolded → top-heavy or vice versa)
- `index.md` (always — last-updated, status counts, counts of raw snapshots per course)

Write `computeAffectedPages(snapshotId): Promise<{ raw: Array<{ path, content }>, wiki: Array<{ type, slug, path }> }>` in `lib/ai/wiki/update.ts`. The raw entries are deterministic (no LLM call needed); only the wiki entries go through the prompt.

Course-page markdown should include a "Source snapshots" section linking to the JSON files in `raw/snapshots/<course>/` so anyone reading the wiki can verify the synthesis against the underlying evidence.

- [ ] **Step 2: Write the prompt template**

`lib/ai/prompts/wiki-update.md`:

```markdown
# Curriculum-Wiki Page Maintainer

You maintain the curriculum knowledge base at gc-curriculum-wiki. A new snapshot just arrived. Your job is to regenerate the affected pages so they stay internally consistent.

**Inputs you receive in the user message:**
- The new snapshot (course code, full profile JSON including the overview section, transcript citations, reviewer note)
- For each affected entity: the existing wiki page's current markdown (if any), the relevant substrate from Postgres (other contributing snapshots for a competency page; coverage rollup for a target page; etc.)
- The relative paths to the raw snapshot JSON files for this course (so you can link to them from the rendered page)

**Your output:** structured JSON listing each affected page's new markdown content. The raw layer (snapshot JSON + transcript markdown) is written deterministically by the caller, NOT by you — you only produce the wiki layer pages.

**Voice:** editorial — like a thoughtful institutional knowledge base. Not audit-flavored. Faculty should be proud to share these pages with the curriculum committee.

**Discipline:**
- Use `[[wikilinks]]` aggressively for cross-references. Course → competencies developed → targets they roll up to → concepts that frame them.
- Every page has frontmatter (type, slug, updated_at, etc. — see schema doc).
- For course pages: lead with the overview narrative + at-a-glance bullets + who-it's-for + arc (from the snapshot's `profile.overview`). Then competencies developed. Then audit notes (downstream connections, prereq gaps, productive failure conditions if present). Then a "Source snapshots" section linking to the JSON files in `raw/snapshots/<course>/` (paths provided in input). Then a "Cross-references" section linking outward.
- For competency pages: synthesize across ALL contributing courses. Show a ranked list of contributing courses by depth. Surface dissociation patterns. Cross-link to concept pages. Link to the raw snapshots that contributed.
- For target pages: program-level rollup. Which competencies are well-developed, which are thin, where the brittle spots are. Reuse Phase 1B scaffolding outputs.
- For concept pages: research-doc-style references with cross-links to the courses where the concept lands well or poorly.

(Full prompt continues — see plan implementer notes.)
```

(The implementer will flesh out the prompt to ~300–500 lines covering each page type's structural template.)

- [ ] **Step 3: Strict-mode JSON schema**

The function returns:

```typescript
{
  pages: Array<{
    path: string;       // e.g. 'courses/gc-4800.md'
    content: string;    // full markdown including frontmatter
    operation: 'create' | 'update' | 'unchanged';
  }>;
  log_entry: string;    // one-line summary for log.md
}
```

JSON schema with the strict-mode pattern: every property in required, optional fields nullable.

- [ ] **Step 4: Wire to AI provider + assemble raw layer**

`lib/ai/wiki/update.ts` does, in order:

1. Load the snapshot from `course_capture_snapshots` by id.
2. Build the raw-layer writes (deterministic, no LLM):
   - `raw/snapshots/{courseSlug}/{YYYY-MM-DD}_{shortId}.json` ← `JSON.stringify(snapshot.profile, null, 2)`
   - If `transcriptSessionId` is set: load `capture_messages` for that session, render as markdown (one ## heading per turn, role + timestamp + content; tool calls in a ```json``` block; citations inline as `[c#chunk-id]` or `[m#msg-id]`), write to `raw/transcripts/{courseSlug}/{YYYY-MM-DD}_{shortSession}.md`
3. Compute affected wiki pages (`computeAffectedPages`).
4. For each affected page: load existing markdown (if any) + substrate from Postgres.
5. Call `getProviderForFunction('wiki-update')` with all substrate + the list of raw-layer paths (so the LLM can reference them in markdown links).
6. Return `{ raw: [...], wiki: [...] }`.

The caller in Task A4 writes BOTH the raw and wiki entries, then commits + pushes.

- [ ] **Step 5: Tests**

Fixture-driven tests in `lib/ai/wiki/__tests__/update.test.ts`. Mock provider with a known response; verify the orchestrator passes the right substrate and validates output.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(wiki): wiki-update AI function — regenerates affected pages from a snapshot"
```

---

## Task A3: Git automation

**File:** Create `lib/wiki/git-ops.ts`.

- [ ] **Step 1: Write the helper**

```typescript
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const WIKI_REPO_PATH = process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';
const WIKI_REMOTE = process.env.WIKI_REMOTE ?? 'origin';
const WIKI_BRANCH = process.env.WIKI_BRANCH ?? 'main';

export interface WikiCommit {
  pages: Array<{ path: string; content: string }>;
  logEntry: string;
  commitMessage: string;
}

/**
 * Write each page to the wiki repo, append the log entry, commit, and push.
 * Pull first to avoid conflicts. Best-effort retry on push failure (one retry
 * after a pull+rebase). On total failure, throws — caller decides whether to
 * persist a "wiki out of sync" flag on the snapshot or just log and move on.
 */
export async function writeAndPush(commit: WikiCommit): Promise<{ sha: string }> {
  // 1. Pull latest to minimize conflict surface
  await exec('git', ['-C', WIKI_REPO_PATH, 'pull', '--ff-only', WIKI_REMOTE, WIKI_BRANCH]);

  // 2. Write each page
  for (const page of commit.pages) {
    const abs = path.join(WIKI_REPO_PATH, page.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, page.content);
  }

  // 3. Append log entry
  const logPath = path.join(WIKI_REPO_PATH, 'log.md');
  await fs.appendFile(logPath, `\n${commit.logEntry}\n`);

  // 4. git add -A, commit, push
  await exec('git', ['-C', WIKI_REPO_PATH, 'add', '-A']);
  await exec('git', ['-C', WIKI_REPO_PATH, 'commit', '-m', commit.commitMessage]);
  const { stdout: sha } = await exec('git', ['-C', WIKI_REPO_PATH, 'rev-parse', 'HEAD']);

  try {
    await exec('git', ['-C', WIKI_REPO_PATH, 'push', WIKI_REMOTE, WIKI_BRANCH]);
  } catch (err) {
    // One retry after a rebase
    await exec('git', ['-C', WIKI_REPO_PATH, 'pull', '--rebase', WIKI_REMOTE, WIKI_BRANCH]);
    await exec('git', ['-C', WIKI_REPO_PATH, 'push', WIKI_REMOTE, WIKI_BRANCH]);
  }

  return { sha: sha.trim() };
}

/**
 * Read a wiki page if it exists. Returns null when missing.
 */
export async function readWikiPage(relPath: string): Promise<string | null> {
  const abs = path.join(WIKI_REPO_PATH, relPath);
  try {
    return await fs.readFile(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function wikiRepoPath(): string { return WIKI_REPO_PATH; }
```

- [ ] **Step 2: Configure git identity in the local clone**

```bash
cd /Users/admin/projects/gc-curriculum-wiki
git config user.email "chiptoe@mac.com"
git config user.name "gc-curriculum-tool"
```

So commits are attributed to the bot identity, not your personal git config.

- [ ] **Step 3: Commit**

```bash
cd /Users/admin/projects/curriculum_developer
git add lib/wiki/git-ops.ts
git commit -m "feat(wiki): git-ops helper — write pages, commit, push to gc-curriculum-wiki"
```

---

## Task A4: Trigger on snapshot creation

**Files:**
- Modify: `app/api/capture/[code]/snapshots/route.ts` — after `createSnapshot` succeeds, fire wiki-update asynchronously (don't block the response)

- [ ] **Step 1: Async trigger**

After the existing `createSnapshot()` call:

```typescript
// Fire wiki-update in the background. Snapshot is already persisted; if
// wiki regen fails we log + continue. The next snapshot will catch up.
import { updateWikiForSnapshot } from '@/lib/ai/wiki/update';
import { writeAndPush } from '@/lib/wiki/git-ops';

// Don't await — let the response return immediately.
(async () => {
  try {
    const { raw, wiki, logEntry } = await updateWikiForSnapshot(snapshot.id);
    // writeAndPush handles both raw (deterministic) and wiki (LLM-generated)
    // entries — both are just { path, content } pairs.
    const allPages = [...raw, ...wiki];
    const commitMessage = `feat(${snapshot.courseCode.toLowerCase().replace(/\s+/g, '-')}): snapshot ${new Date().toISOString().slice(0, 10)} — ${snapshot.caption ?? 'untitled'}`;
    await writeAndPush({ pages: allPages, logEntry, commitMessage });
  } catch (err) {
    console.error('wiki-update failed for snapshot', snapshot.id, err);
  }
})();
```

- [ ] **Step 2: Smoke**

After T1–T4 land, take a snapshot on GC 4800 in the dev UI. Watch the cron log; confirm the wiki repo gets a new commit pushed within ~30s.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(api): trigger wiki-update on snapshot creation"
```

---

## Task A5: In-app `/wiki/...` routes

**Files:**
- Create: `app/wiki/page.tsx` — index landing
- Create: `app/wiki/[type]/[slug]/page.tsx` — render any wiki page
- Reuse: `react-markdown` (likely already in deps from prior plans; if not, `pnpm add react-markdown remark-gfm`)

- [ ] **Step 1: Index page**

`/wiki?slug=…` reads `index.md` from the local clone, renders. Slug-gated.

- [ ] **Step 2: Per-page route**

`/wiki/courses/gc-4800?slug=…` reads `courses/gc-4800.md` from the local clone, renders. Resolve `[[wikilinks]]` to clickable links in the rendered HTML (a small remark plugin or a regex pre-pass).

- [ ] **Step 3: Header navigation**

Add a "Wiki →" link to `/courses` and `/program` headers.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(wiki): in-app /wiki/[type]/[slug] routes — render markdown from the local clone"
```

---

## Task A6: Seed script

**File:** Create `scripts/wiki/seed.ts`.

- [ ] **Step 1: Write the seeder**

Iterates over every non-retired snapshot in the DB, calls `updateWikiForSnapshot()`, commits + pushes each one. On a small trial corpus (~2 snapshots today) this runs in under a minute. Idempotent — re-running just regenerates against current state.

- [ ] **Step 2: Run it once**

```bash
pnpm exec tsx --env-file=.env.local scripts/wiki/seed.ts
```

Visit `github.com/chiptoe-svg/gc-curriculum-wiki` and `/wiki?slug=…` to confirm pages appear.

- [ ] **Step 3: Commit the script**

```bash
git commit -m "chore(wiki): one-off seeder — regenerate all wiki pages from current snapshots"
```

---

# Phase B — Conversational chat

## Task B1: `curriculum-chat` AI function

**Files:**
- Create: `lib/ai/prompts/curriculum-chat.md`
- Create: `lib/ai/wiki/tools.ts` — `read_wiki`, `search_wiki`, `list_wiki` tool definitions
- Create: `lib/ai/wiki/chat.ts` — orchestrator using `streamWithTools`
- Modify: `lib/ai/function-settings.ts` — register `curriculum-chat` (default tier: default)

- [ ] **Step 1: Tools**

```typescript
// lib/ai/wiki/tools.ts
import { z } from 'zod';
import { readWikiPage, wikiRepoPath } from '@/lib/wiki/git-ops';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const wikiReadTool: ToolDefinition = {
  name: 'read_wiki',
  description: 'Read a single wiki page by its path (e.g. "courses/gc-4800.md", "competencies/brand-strategy.md").',
  inputSchema: z.object({ path: z.string() }),
  execute: async (args) => {
    const { path: p } = args as { path: string };
    const content = await readWikiPage(p);
    return content ? { content } : { error: 'page not found' };
  },
};

export const wikiListTool: ToolDefinition = {
  name: 'list_wiki',
  description: 'List all wiki pages, optionally filtered by type (courses, competencies, targets, concepts).',
  // ...
};

export const wikiSearchTool: ToolDefinition = {
  name: 'search_wiki',
  description: 'Full-text search across all wiki pages. Returns matching pages with snippets.',
  // ...
};
```

`search_wiki` uses ripgrep or a tiny in-memory index built on demand. At ~50 pages × ~3k tokens, brute-force grep is fine.

- [ ] **Step 2: System prompt**

`lib/ai/prompts/curriculum-chat.md` — describes the agent's role (curriculum knowledge assistant), discipline (cite wiki pages always, never invent facts not in the corpus, distinguish program-level from course-specific questions), and the tools available. Reuses the conversational patterns from `capture-chat-agent.md` (citations as first-class, no over-claiming).

- [ ] **Step 3: Streaming orchestrator**

Mirror `runAuditAgent` / `streamAuditAgent` — same `streamWithTools` pattern, different tools + prompt.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(wiki): curriculum-chat AI function — agent with wiki-navigation tools"
```

---

## Task B2: Two surfaces — `/ask` (program-level) + Explore tab (class-specific)

**Architecture decision:** class-specific chat lives inside the existing `/explore/[code]` surface (a new tab/panel), not as a separate `?focus=` route. Explore is already course-scoped; faculty already use it for per-course deep dives. `/ask` is the standalone program-level surface. Both consume the same `curriculum-chat` agent; the difference is starting context:

- **Explore tab** — pre-loads the course's wiki page + immediate neighbors (sub-competencies it touches, prereq pages, target pages whose rollups include it). Agent has full wiki-navigation tools but is biased toward staying course-local.
- **`/ask`** — pre-loads the wiki `index.md` (the entry-point document); agent navigates broadly. Good for "where in the program is X" / "are there gaps in Act 2" questions.

**Files:**
- Create: `app/ask/page.tsx` — program-level standalone route
- Create: `app/ask/CurriculumChatPanel.tsx` — chat UI (will be reused by the Explore tab)
- Create: `app/api/ask/chat/route.ts` — NDJSON streaming endpoint over the `curriculum-chat` agent
- Modify: `app/explore/[code]/page.tsx` — add a chat tab/panel that mounts `<CurriculumChatPanel>` with `focusCourseCode` prop set

- [ ] **Step 1: Standalone `/ask` route**

`/ask?slug=…` — slug-gated; no focus, agent navigates broadly. Header shows "Curriculum Q&A" + a link to `/wiki`.

- [ ] **Step 2: Chat panel (reusable)**

Streaming chat UI, similar in shape to `CaptureChatPanel` but with `curriculum-chat` agent semantics:
- No "Start session" button; first message is the user's question
- Citations resolve to clickable `/wiki/...` links rendered inline in the assistant turn
- Optional `focusCourseCode` prop — when set, the panel renders a "Asking about GC 4800" focus badge AND the API receives `focus=gc-4800` in its body so the agent pre-loads course context

- [ ] **Step 3: API route**

`POST /api/ask/chat` — accepts `{ messages, focus? }`, uses `streamWithTools` against the `curriculum-chat` function. NDJSON stream like `/api/capture/[code]/chat`. When `focus` is set, the route loads the focused course's wiki page + neighbors and injects as at-rest context in the first user message.

- [ ] **Step 4: Mount the panel in `/explore/[code]`**

Add a new tab (or accordion section, depending on the existing Explore layout) labeled "Ask about this course" that mounts `<CurriculumChatPanel focusCourseCode={code} ... />`. Read the existing `app/explore/[code]/page.tsx` first to choose the integration shape that matches Explore's current tab/panel conventions.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(wiki): /ask program-level chat + Explore tab for class-specific Q&A"
```

---

## Task B3: Cross-route entry points

**Files:**
- Modify: `app/courses/CoursesIndex.tsx` — add a "💬 Ask" affordance per row → routes to `/explore/[code]` with the chat tab pre-selected (via `?tab=ask` or similar)
- Modify: `app/wiki/[type]/[slug]/page.tsx` — add a "Ask about this" link on each wiki page that routes to the right surface (course page → Explore tab; competency/target/concept → `/ask?topic=<slug>`)

- [ ] **Step 1: Course list row affordance**

Each row in `/courses` gets a small "💬" icon. Course pages route to `/explore/<code>?tab=ask`; we don't need a separate `?focus=` because Explore is already course-scoped.

- [ ] **Step 2: Wiki-page entry**

On any `/wiki/...` page, a sidebar link "Ask about this" — course pages route to `/explore/<code>?tab=ask`; everything else routes to `/ask?topic=<slug>` which seeds the conversation with "Tell me about [[<slug>]]" so the agent loads the topic page on first response.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(wiki): cross-route 'Ask about this' affordances on /courses and /wiki pages"
```

---

# Phase C — STATE + verification

## Task C1: STATE update

Add the new `/wiki/...` and `/ask` routes to the faculty-surfaces table. Document the wiki repo path, the `wiki-update` AI function, and the new env vars (`WIKI_REPO_PATH`, optional overrides for `WIKI_REMOTE` / `WIKI_BRANCH`). Bump Last verified to the final commit SHA.

## Task C2: Verification (post-execute, manual)

1. Take a fresh snapshot on GC 4800. Within ~30s, the wiki repo should have a new commit. Browse to `github.com/chiptoe-svg/gc-curriculum-wiki` and confirm the affected pages are there.
2. Open `/wiki/courses/gc-4800?slug=…` — page renders with correct typography, `[[wikilinks]]` are clickable.
3. Clone the wiki repo locally, open in Obsidian — graph view shows backlinks; Dataview queries over frontmatter work.
4. Open `/ask?slug=…`, ask "where in the program is brand strategy developed?" — agent should navigate to `competencies/brand-strategy.md`, then visit each contributing course page, then synthesize a cited answer.
5. From `/courses`, click the 💬 icon on GC 4800 → lands on `/ask?focus=gc-4800` with the focus badge visible.
6. Ask the focused agent "what does this course expect students to arrive with?" — should pull from GC 4800's incoming_expectations + linked prereq pages.

---

## Self-Review

**Coverage:** wiki repo + schema (A1), wiki-update AI function (A2), git ops (A3), snapshot trigger (A4), in-app routes (A5), seed (A6), conversational chat function (B1), `/ask` route (B2), in-context entry points (B3), STATE (C1). ✅

**Out of scope (deliberately deferred):**
- **Wiki lint operation.** Karpathy's pattern has periodic "lint" runs to detect contradictions, orphans, and stale claims. Defer to a Phase 3 once the corpus has 5+ courses captured.
- **MCP server (Option C).** The wiki is local-filesystem accessible; an MCP server would let any external Claude session query it. Useful but not load-bearing yet.
- **Cross-snapshot evolution UI.** `git log courses/gc-4800.md` is the underlying capability; a polished in-app "see how this course's narrative evolved" surface is Phase 4.
- **Concept-page authoring.** v1 concept pages are LLM-generated. Hand-curated concept pages (faculty draft "Three-Act Structure" themselves, LLM regenerates the cross-course evidence sections) is a Phase 5.

**Tradeoffs noted:**
- The `wiki-update` AI function is the highest-cost addition (~$1–3 per snapshot). Acceptable for the trial scale (~1 snapshot/week per audited course); revisit pricing if usage grows.
- Git push happens synchronously inside the async wiki-update trigger. Push failures don't fail the snapshot creation — just log + continue. Means the wiki can drift from snapshots if pushes fail repeatedly. A nightly lint job could detect drift and re-run.
- The `/ask` agent loads a lot of wiki content into context. At 50–100 pages, fine. At 500+, need to selectively load via tools rather than dumping the index.

---

## Execution Handoff

Plan complete. Saved to `docs/superpowers/plans/2026-06-01-curriculum-wiki-and-chat.md`.

Recommended execution: **subagent-driven-development**, phase by phase (finish Phase A entirely before starting Phase B). Estimated: Phase A ~2 days, Phase B ~1 day.
