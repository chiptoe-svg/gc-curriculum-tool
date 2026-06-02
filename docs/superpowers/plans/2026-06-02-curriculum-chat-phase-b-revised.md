# Curriculum Chat — Phase B Revised

> **Supersedes** [`2026-06-01-curriculum-wiki-and-chat.md`](./2026-06-01-curriculum-wiki-and-chat.md) for Phase B (chat surface). Phase A (wiki bootstrap + automation + routes) of the prior plan is already shipped and unchanged. This revision is in-flight.

**Goal:** Wire a conversational layer over the curriculum wiki so faculty can ask program-aware questions anchored to a specific course they're already exploring.

**Architecture:** One `curriculum-chat` AI function with `read_wiki` / `list_wiki` / `search_wiki` tools. The agent is **always** fully program-aware — no course-local bias. Surfaces are differentiated only by entry point + starting context (which page is pre-loaded), not by tool access or system-prompt scope. The standalone `/ask` page is deferred to B4; for now, faculty enter the chat from Explore (anchored to a course) or from the catalog (deep-link into Explore's chat tab).

**Tech stack:** Vercel AI SDK v6 (`streamWithTools` pattern, already in use by the audit agent), Drizzle (no schema changes), Next.js App Router + NDJSON streaming, existing wiki git-ops helper.

---

## What changed from the 2026-06-01 plan

**Why a revision:** Faculty intent in Explore is comparative — "if I change this course, what breaks elsewhere?", "is this course pulling its weight on brand-strategy?". A course-local agent would refuse exactly the questions Explore most needs. So:

| Prior plan said | Revised plan says | Why |
|---|---|---|
| Explore-chat agent biased toward course-local navigation | Agent has full program scope, course is **anchor not fence** | The whole point of asking from inside Explore is to range outward from the course |
| `/ask` standalone + Explore tab both ship in B2 | Just Explore tab ships in B2′. Standalone deferred to B4. | Faculty are always anchored to a specific course; standalone is rare (admin / chair surface). Ship the dominant path first. |
| Explore-tab and `/ask` share agent but differ in system prompt | Single agent, single prompt, single tool surface | Less to maintain, fewer divergence points |
| `/wiki/...` pages link to `/ask?topic=` | (Drop until B4) | `/ask` doesn't exist yet |

---

## Task B1: `curriculum-chat` AI function

**Files:**
- Create: `lib/ai/wiki/tools.ts` — `read_wiki`, `list_wiki`, `search_wiki` tool definitions
- Create: `lib/ai/prompts/curriculum-chat.md` — system prompt
- Create: `lib/ai/wiki/chat.ts` — orchestrator built on `streamWithTools`
- Modify: `lib/ai/function-settings.ts` — register `curriculum-chat`

- [ ] **Step 1: Wiki-navigation tools**

Three tools, each backed by the existing `lib/wiki/git-ops.ts` helpers:

```ts
// lib/ai/wiki/tools.ts
// read_wiki({ path }) → { content } | { error }
//   reads a single page by repo-relative path
//   ("courses/gc-4800.md", "competencies/brand-strategy.md")
// list_wiki({ type? }) → { pages: { path, title }[] }
//   lists every page, optionally filtered by directory
//   ("courses", "competencies", "targets", "concepts")
// search_wiki({ query }) → { hits: { path, title, snippet }[] }
//   ripgrep-style across the wiki repo; cap 20 hits
```

Use existing `readWikiPage(path)` for `read_wiki`. For `list_wiki` walk the wiki repo's `courses/`, `competencies/`, `targets/`, `concepts/` directories. For `search_wiki` shell out to `rg --json --max-count 3 "$query" "$WIKI_REPO_PATH"` (or read every file and grep in process — at ~50 pages × ~3k tokens, in-process is fine).

- [ ] **Step 2: System prompt**

`lib/ai/prompts/curriculum-chat.md`:

- **Role**: a curriculum knowledge assistant that reads the wiki and answers grounded faculty questions
- **Scope**: full program — courses, competencies, career targets, concepts. Course context is an **anchor**, not a fence. Cross-course, cross-target, cross-career-path comparison is encouraged when the user's question implies it.
- **Discipline**: cite wiki pages on every claim (`[courses/gc-4800.md]`), never invent facts not in the corpus, distinguish what the wiki says vs. what would be reasonable inference. Say "I don't have enough in the wiki to answer that confidently" when true.
- **Tool use**: prefer `read_wiki` when you know the path, `search_wiki` when you don't, `list_wiki` for orientation
- **Voice**: brief, direct, evidence-first. Reuse conversational discipline from `capture-chat-agent.md`.

- [ ] **Step 3: Streaming orchestrator**

Mirror `runAuditAgent` / `streamAuditAgent` in `lib/ai/agent/`. Same `streamWithTools` pattern, different tools + prompt. Yields tool-call + tool-result + assistant deltas as NDJSON events the UI can consume.

- [ ] **Step 4: Register function**

In `lib/ai/function-settings.ts`, add `'curriculum-chat'` with default tier = default model. No special model needed; it's a tool-using conversational task.

- [ ] **Step 5: Commit**

```
feat(wiki): curriculum-chat AI function — agent with full wiki-navigation tools
```

---

## Task B2′: Chat tab inside `/explore/[code]`

**Files:**
- Create: `app/explore/[code]/AskTab.tsx` — chat panel
- Create: `app/api/explore/[code]/chat/route.ts` — NDJSON streaming endpoint
- Modify: `app/explore/[code]/ExploreClient.tsx` — add `'ask'` to the existing `mode` toggle ('custom' / 'downstream' / 'ask') and mount `<AskTab>` when that mode is active

**Important UX choice (from the user discussion):** the chat is anchored to the course but the agent is **fully program-aware**. The course is the starting context, not the limit of what can be discussed. A faculty member in `/explore/GC 4400` who asks "what does GC 4400 set up for GC 4800?" should get a real cross-course answer with citations to both wiki pages.

- [ ] **Step 1: Read existing Explore mode structure**

`ExploreClient.tsx` uses `useState<Mode>('custom')` with button toggles between 'custom' and 'downstream'. Read enough to match the existing pattern (same button styling, same panel shape) so 'ask' looks native.

- [ ] **Step 2: Add `'ask'` mode**

```tsx
type Mode = 'custom' | 'downstream' | 'ask';
// existing two-button toggle becomes three buttons
```

When `mode === 'ask'`, render `<AskTab courseCode={code} slug={slug} />`. Hide the custom/downstream-specific UI sections.

- [ ] **Step 3: Chat panel UI**

`AskTab.tsx` — streaming chat surface modeled on `CaptureChatPanel`:
- No "Start session" button; first message is the user's question
- Header strip shows "Asking about GC 4400 — anchored to this course, but you can ask about the whole program"
- Citations resolve to clickable `/wiki/...` links rendered inline in assistant turns
- Suggestion chips on empty state: "What does this set up for downstream courses?", "Does this course support brand-strategy?", "What concepts are anchored here?"

- [ ] **Step 4: API streaming endpoint**

`POST /api/explore/[code]/chat?slug=…` — accepts `{ messages }`. On the first turn, the route pre-loads the course's wiki page + immediate neighbors (sub-competencies it touches, prereq pages, target pages whose rollups include it) and prepends them as a `system` context note. Subsequent turns just forward `messages`. NDJSON stream like `/api/capture/[code]/chat`.

- [ ] **Step 5: Verify cross-course questions work end-to-end**

Manual: in `/explore/GC 4400`, ask "what does GC 4400 set up for GC 4800?" Agent should call `read_wiki({path: 'courses/gc-4800.md'})` (or `search_wiki`) and produce a grounded comparative answer with citations to both pages.

- [ ] **Step 6: Commit**

```
feat(explore): "ask" mode — program-aware chat anchored to the current course
```

---

## Task B3′: Cross-route entry from `/courses`

**Files:**
- Modify: `app/courses/CoursesIndex.tsx` — add a small "💬 Ask" link per row that deep-links to `/explore/<code>?slug=…&tab=ask`
- Modify: `app/explore/[code]/page.tsx` (or `ExploreClient.tsx`) — accept `?tab=ask` query param and initialize `mode` accordingly

- [ ] **Step 1: Read existing CoursesIndex row layout**

Match the visual weight of existing affordances (the row already has course code + title + status; a small text link belongs in the right action cluster).

- [ ] **Step 2: Add the row affordance**

```tsx
<Link href={`/explore/${encodeURIComponent(c.code)}?slug=${encodeURIComponent(slug)}&tab=ask`}
      className="text-xs text-muted-foreground hover:text-foreground">
  💬 Ask
</Link>
```

- [ ] **Step 3: Honor `?tab=ask` in Explore**

In `ExploreClient.tsx`, read `searchParams.get('tab')` and initialize `mode` to 'ask' if present. (May need to thread through from the server page if the client doesn't already read `useSearchParams`.)

- [ ] **Step 4: Commit**

```
feat(courses): per-row "💬 Ask" deep-link into Explore's chat tab
```

---

## Task B4 (DEFERRED — not in this batch): Standalone `/ask` route

Captured here so it doesn't get lost. Faculty almost always come at the curriculum from a specific course (their own). The standalone surface is mainly useful for admins / chairs doing program-wide reviews without a course anchor. We'll build it when there's a real user for it.

**When implemented:**
- Create: `app/ask/page.tsx` — slug-gated standalone route
- Same `<AskTab>` panel as Explore but without the course-anchor context pre-load
- Same agent, same tools, same prompt — only differs in starting context
- Probably add a top-of-page "📖 Browse the wiki →" link for users who'd rather navigate than chat

---

## Task C1: STATE update

After B1 + B2′ + B3′ ship, update `docs/STATE.md`:
- Add `/explore/[code]?tab=ask` to the faculty-surfaces table (or amend the existing Explore row)
- Note `curriculum-chat` in the AI-function list
- Bump Last verified to the final commit SHA
- Note B4 (standalone `/ask`) as deferred in the Active arc section

---

## Task C2: Verification (post-execute, manual)

1. Open `/courses?slug=…`. Click "💬 Ask" on a course row. Should land in `/explore/<code>?tab=ask` with the chat tab pre-selected and the focus badge visible.
2. Ask a course-local question ("does this course cover X?"). Agent reads the course's wiki page and answers.
3. Ask a cross-course question ("how does this set up GC 4800?"). Agent reads the other course's page and produces a comparative answer.
4. Ask a competency-level question ("does this course contribute to brand-strategy?"). Agent reads the competency / target page.
5. Confirm every assistant turn carries inline `[courses/...md]` / `[concepts/...md]` citations.

---

## Self-Review notes

- **Spec coverage** — every requirement maps to a task. B4 is explicitly deferred not forgotten.
- **Placeholder scan** — no TBD / TODO / "similar to" placeholders. Code shown where structural.
- **Type / name consistency** — `Mode` union extended (`'custom' | 'downstream' | 'ask'`), tool names verbatim across prompt + tools file + orchestrator. `AskTab` is the only new component name.
- **Reuse over reinvent** — orchestrator mirrors existing `streamAuditAgent`; chat panel mirrors existing `CaptureChatPanel`; route mirrors `/api/capture/[code]/chat`. No new patterns to learn.

---

## Execution Handoff

Implementing inline in the current session (the curriculum-tool context is loaded). Task order is fixed (B1 → B2′ → B3′ → C1) with commit at each task boundary so cleanup / rollback is clean.
