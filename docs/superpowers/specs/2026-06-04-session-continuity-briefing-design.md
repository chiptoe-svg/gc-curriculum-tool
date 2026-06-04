# Session-Continuity Briefing Design (CourseCapture v2 — Stage 7)

> **Status:** design, approved 2026-06-04. Implementation plan to follow in `docs/superpowers/plans/`.
> **Increment:** the first of the two CourseCapture v2 "Stage 7" (memory) tracks. The second track — **faculty profiles / cross-course memory** — is explicitly out of scope here and gets its own spec later.

## One-line

Replace the audit agent's verbose "Prior audit sessions" raw-transcript dump with a **deterministic, structured Session Briefing** assembled entirely from already-persisted `capture_messages` data — no new AI call, no migration, zero new hallucination surface.

## Background & motivation

When a faculty member resumes a course audit (a new `session_id`, e.g. after a page reload or on another day), the agent needs to know what prior sessions established so it doesn't re-probe settled ground or lose confirmed findings.

That carry-over already exists, crudely. `lib/db/capture-messages-queries.ts:listPriorSessionSummaries` pulls the last 3 prior sessions and `lib/ai/agent/audit-agent.ts:136–163` renders, per session, the final readiness plus **the last 8 conversational turns verbatim, each capped at 1500 chars**. That dump is:

- **Token-heavy and unbounded in practice** — up to 3 sessions × 8 turns × 1500 chars of at-rest context on *every* turn.
- **Undistilled** — the agent must re-derive what's settled vs. open from raw prose each turn.
- **Silent on sticky findings** — confirmed findings aren't surfaced as such; they're buried in the transcript.

The structured signal we want is, however, **already persisted**: every assistant turn stores an `AuditResponse` as JSON with verbatim `finding` text, `citations` to real sources, and a `readiness` object (`score` / `covered` / `remaining`). We are simply discarding that structure into a verbatim dump instead of using it.

### Driving goal (priority order, per brainstorming)

1. **Audit continuity / quality (primary).** The agent resumes with real, structured continuity — settled areas, open threads, and the actual recent findings — so the next session is *smarter*, not just cheaper.
2. **Faculty-visible continuity (side benefit).** Faculty resuming an audit see a "Where we left off" recap.
3. **Token cost (side benefit).** The distillation is far smaller than the raw dump.

### Design constraint that shaped the mechanism

The feature must **not introduce hallucination** and must **not overcomplicate**. A dedicated LLM "briefing composer" would do both: distilling a session into sticky findings / open threads with a model is a *summary of a summary* — a new place to fabricate or distort a finding that was never established — and it adds a new AI function, a "session end" trigger, and a store. Because the findings already exist as structured, cited, real data, the briefing is instead **assembled by quoting what was actually said**. Nothing in the briefing is model-generated. The live agent still performs any cross-session *reasoning* itself at runtime, grounded in the briefing and its tools.

## Goals

- Carry forward, per prior session: readiness (`score` / `covered` / `remaining`), the last 2–3 distinct confirmed findings (verbatim, with citations), and the last thing faculty said.
- Replace the `priorSessionsBlock` raw dump with a compact rendering of the above.
- Surface the same structured data to faculty as a collapsed "Where we left off" panel.
- Keep the rendered at-rest block **bounded** regardless of session length.

## Non-goals

- **No cross-session synthesis** (no "findings A and B conflict"). That reasoning is the live, grounded agent's job, not a detached summarizer's.
- **No new AI function, no LLM call, no migration, no new table.**
- **No faculty profiles / cross-course memory** — separate future increment.
- No change to how snapshots, readiness, or findings are produced.
- No **new** DB query and no change to the source (`capture_messages`). `listPriorSessionSummaries`'s *return shape* may be extended additively to expose the per-assistant-turn `finding` / `citations` / `readiness` it already reads (see the implementation note under Architecture); that is the only query-layer change permitted.

## Architecture

### New module — `lib/ai/agent/session-briefing.ts`

A pure module, no DB access of its own (operates on rows the caller already fetched), with two exports:

```ts
interface BriefingFinding {
  text: string;            // verbatim assistant `finding`, capped ~600 chars
  citations: Citation[];   // that turn's citations, preserved as-is
}

interface SessionBriefing {
  sessionId: string;
  startedAt: Date;
  turnCount: number;
  readiness: { score: number | null; covered: string[]; remaining: string[] };
  stickyFindings: BriefingFinding[];  // last 2–3 distinct, newest first, all verbatim
  lastFacultyTurn: string | null;     // most recent role:'user' message, capped ~600 chars
}

// Pure. Input is the prior-session summaries listPriorSessionSummaries already returns
// (which carry the per-session message rows / parsed assistant turns needed below).
function composeSessionBriefing(priorSessions: PriorSessionSummary[]): SessionBriefing[];

// Pure. Compact at-rest text block. Returns the "(none — first audit session)" sentinel
// when the array is empty.
function renderBriefing(briefings: SessionBriefing[]): string;
```

> **Implementation note for the plan:** `listPriorSessionSummaries` currently returns `recentTurns` (last 8 conversational turns, parsed) plus `lastAssistantReadiness` / `lastAssistantContent`. To collect the *last 2–3 distinct findings* and their citations, the composer needs per-assistant-turn `finding` + `citations`, not just the single last one. The plan should either (a) extend `PriorSessionSummary` to carry the parsed assistant turns (`{ finding, citations, readiness }[]`), or (b) have the composer parse them from the rows the query already reads. Prefer (a) — keep parsing in the query layer where the JSON shape is already handled, and keep `session-briefing.ts` a pure transform over typed data. The existing `recentTurns` field may be dropped once `renderBriefing` replaces the verbatim dump, if no other consumer needs it.

### Composition rule (100% deterministic, all verbatim)

Per prior session:

- `readiness` ← the last assistant turn's persisted `readiness` object, as-is (defensive: tolerate `null` / pre-readiness rows → `{ score: null, covered: [], remaining: [] }`).
- `stickyFindings` ← walk assistant turns **newest → oldest**, collect up to **3 distinct** `finding` strings. Distinctness compares whitespace-normalized text (drop a finding equal to one already collected). Each entry keeps its own `citations`. Each `text` capped ~600 chars (ellipsis on overflow). The newest entry is naturally the Stage-6 pre-wrap-up recap when the session ended cleanly; if it ended abruptly, it's simply the last real finding — still grounded.
- `lastFacultyTurn` ← the most recent `role:'user'` message body, capped ~600 chars (`null` if the session has no faculty turns, e.g. opening-turn-only).

Bounded total: ≤3 findings × ≤3 sessions = ≤9 findings, each ≤600 chars, plus short readiness lists — far smaller than today's 8-turn × 1500-char dump.

### Agent-context integration — `lib/ai/agent/audit-agent.ts`

In `buildAgentCall`, replace the inline `priorSessionsBlock` construction (lines 136–163) with:

```ts
const priorSessionsBlock = renderBriefing(composeSessionBriefing(priorSessions));
```

Everything else in the at-rest message is unchanged: the `# Prior audit sessions (most recent)` heading, the `includePriorSessions` fresh-start escape hatch (`wantPriorSessions`), the 3-session limit, and the `[messageId=…]` provenance convention on history turns. Citations carried in `stickyFindings` are rendered in the same `[cites: …]` shorthand the agent already understands, so it can re-cite carried-forward findings.

**Rendered shape (illustrative):**

```
--- Session 4f3a… · 2026-05-30 · 12 turns ---
Readiness: 70% · covered: outcomes, projects, rubrics · remaining: prereqs, reflection
Findings carried forward (your prior turns, verbatim):
  • "GC 3450's two graded projects reach D=3 on layout…" [cites: chunk 8a1f, msg 22b9]
  • "No evidence of a structured post-mortem; crits are informal." [cites: msg 19c0]
Faculty last said: "We don't really do a post-mortem, just informal crits."
```

### Faculty-visible recap — `app/capture/[code]` + `CaptureChatPanel`

The `/capture/[code]` server component computes `composeSessionBriefing` for the course's prior sessions (the data is already loaded server-side) and passes the resulting `SessionBriefing[]` to `CaptureChatPanel` as a prop. The panel renders a **collapsed-by-default "Where we left off"** card above the chat when prior sessions exist:

- Per session: started-date + turn count, a readiness line (covered / remaining as chips), and the carried-forward findings.
- Pure read — no new endpoint, no client fetch.
- Hidden entirely on a true first session, and on fresh-start (`includePriorSessions:false`) to mirror the agent's own context.

## Data flow

```
capture_messages (existing, append-only)
        │  (query, unchanged source)
        ▼
listPriorSessionSummaries(courseCode, sessionId, 3)   ← parses assistant-turn JSON
        │
        ├──────────────► composeSessionBriefing()  [pure]  ─► SessionBriefing[]
        │                          │                               │
        │                          ▼                               ▼
        │                  renderBriefing() [pure]        CaptureChatPanel
        │                          │                      "Where we left off" card
        │                          ▼
        └──────────► buildAgentCall at-rest context block
```

## Error handling / edge cases

- **No prior sessions** → `composeSessionBriefing` returns `[]`; `renderBriefing` returns the existing `(none — this is the first audit session for this course)` sentinel; UI card hidden.
- **Prior session with no assistant turns** → skipped (matches current `listPriorSessionSummaries` behavior: `if (!lastAssistant) continue`).
- **Assistant `content` not valid JSON / pre-structured rows** → no `finding` extracted for that turn; the turn contributes no sticky finding; readiness defaults applied. Never throws.
- **Missing / legacy `readiness`** → `{ score: null, covered: [], remaining: [] }`; rendered as `readiness ?%`.
- **Fewer than 3 distinct findings** → carry what exists (0–2).
- **Fresh-start (`includePriorSessions:false`)** → unchanged: prior-sessions fetch skipped upstream, briefing never composed, UI card hidden.

## Testing

**Unit — `session-briefing.test.ts` (no AI):**
- last-assistant readiness selection; abrupt-end fallback (no Stage-6 recap turn present);
- distinctness dedup (identical findings across turns collapse to one);
- the 2–3 cap (≥4 distinct findings → exactly 3, newest first);
- per-finding char cap + ellipsis; faculty-turn cap;
- defensive nulls (missing readiness, non-JSON content) → no throw;
- empty input → `[]`; `renderBriefing([])` → sentinel string.

**Integration — `audit-agent` (mocked AI):**
- `buildAgentCall` at-rest context **includes** the briefing block and **excludes** the old 8-turn verbatim dump;
- citations from `stickyFindings` render in `[cites: …]` form;
- `includePriorSessions:false` still yields the "(none)" path.

**Token-regression guard:** assert the rendered block for N sessions is bounded (no per-turn 1500-char fan-out) — protects side-benefit #3.

No quality-gated real-AI test: nothing in this feature is model-generated.

## Out of scope for this increment

- Faculty profiles / cross-course memory (`faculty_profiles` table) — separate spec.
- Any LLM-composed or AI-synthesized briefing.
- Persisting the briefing (it is computed on the fly from existing rows; no schema change).
- Changing the 3-session window or readiness/finding production.

## Success criteria

- On a course with ≥2 prior sessions, the agent's at-rest context contains the structured briefing and **not** the raw 8-turn dump, and the rendered block is materially smaller in characters than the prior implementation for the same data.
- The agent does not re-probe an area listed in a prior session's `covered` without reason (qualitative, observed during trial).
- Faculty resuming an audit see an accurate "Where we left off" card whose findings match verbatim text from prior sessions (no invented content).
- All briefing content is traceable to a real `capture_messages` row (citations preserved).

## Related

- `docs/superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md` — the v2 architecture this completes.
- `docs/superpowers/plans/2026-05-28-coursecapture-v2-stage6-agent-persona.md` — defines Stage 7 as "memory + streaming"; adds the in-session periodic synthesis and pre-wrap-up recap turn this briefing carries forward.
- `lib/db/capture-messages-queries.ts:listPriorSessionSummaries` — the existing query this builds on.
- `lib/ai/agent/audit-agent.ts:buildAgentCall` — the integration point (lines 136–163).
