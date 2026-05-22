# Phase 2 Agent Design — Decision Document

> **Status:** Design decisions made, implementation blocked pending nanoclaw API contract. Return to this at the start of the next planning session before writing any implementation plan.

**Goal:** Replace the current silent materials analysis pipeline and stateless KUD chat with two conversational agents — one that audits uploaded course materials with the faculty, one that develops KUDs through conversation.

---

## What Phase 1 Built (Already Live)

- **KUD Chat:** Stateless multi-turn conversation. Client owns message history (array passed with every request). Server calls `chat.completions.create` with the full history on every turn. OpenAI only (`OPENAI_API_KEY`, `OPENAI_MODEL` env vars). No tool calls, no agent.
- **Materials Analysis:** Two sequential LLM calls per run — one per material file (`analyze-material`), then one synthesis call (`synthesize-course-profile`). Background job, no human in the loop. Output: `{ learningObjectives, majorProjects, skillsRequired }`.
- **UI:** `CourseAnalyzeZone` has an "Analyze Materials" button. `KudReviewTab` has a chat panel. Phase 2 means `CourseAnalyzeZone` gets the same chat panel treatment.

---

## Phase 2: Two Conversational Agents

### The Reframe

Both agents are conversational. This is the key decision from the design discussion.

Agent 2 was originally conceived as a silent background job upgraded with agent reasoning. The better model: Agent 2 is an **auditor** that surfaces findings and asks the faculty about them. Not extracting — auditing.

Examples of what Agent 2 would surface:
- "Your syllabus says students will 'analyze data sets' but every assignment I see is multiple-choice recall — is there a lab component not uploaded?"
- "The Canvas assignments show 60% of the grade on a final project but your learning objectives don't mention a deliverable — should I update them?"
- "I found three assignment descriptions that look like different versions of the same thing. Which is current?"
- "Your stated prerequisites include Statistics but I don't see any assignment that requires it — is it a catalog holdover?"

Agent 1 (KUD Chat) similarly should read actual uploaded materials during the conversation, not just the summarized profile fields. When the faculty says "the big assignment is the capstone," it should go look at the capstone rubric.

---

## Agent Definitions

### Agent 1 — KUD Conversation
**Timing:** After profile is confirmed  
**Mode:** Real-time, human in the loop, latency budget ~2–4s per turn  
**Output:** Structured KUD statement set (Know / Understand / Do)  
**System prompt:** Focuses on pedagogy — how the course is taught, what threshold concepts students struggle with, how grading weights learning  

**Tools needed:**
- `get_course_profile` — confirmed learning objectives, projects, skills
- `search_materials` — semantic search over uploaded files (not dump-all; expensive)
- `get_current_kuds` — if a prior KUD run exists, agent can build on or critique it

**What tool access changes:** Questions become grounded in actual course content. "I see your rubric weights 'professional communication' at 30% — does that mean oral or written presentation?" instead of "Tell me about the major projects."

---

### Agent 2 — Materials Analysis (Auditor)
**Timing:** After materials are uploaded, before KUD conversation  
**Mode:** Real-time, human in the loop, latency budget same as Agent 1  
**Output:** Confirmed course profile — richer than current silent analysis  
**System prompt:** Focuses on materials audit — what's there, what's inconsistent, what's missing, what differs between stated and assessed outcomes  

**Tools needed:**
- `list_materials` — what files are uploaded and their types
- `get_material_text` — lazy per-file retrieval (not all at once)
- `search_materials` — semantic search across all materials

**What it produces that the silent pipeline doesn't:** Inconsistency flags, Bloom's level tagging on learning objectives, rubric-level analysis, mismatch identification between syllabus and Canvas assignments.

---

## One Conversation or Two?

**Decision: Two, with a summary handoff.** Rationale:

- The profile confirmation is a real decision point — faculty checks the agent understood correctly before moving into KUD territory
- Conversations are currently ephemeral (client-side only). If faculty does materials analysis Monday, comes back Friday, the conversation is gone regardless
- The profile is the handoff artifact — richer after Agent 2, but the verbatim explanations don't need to survive

**Middle path (recommended):** Agent 2 writes a `conversationSummary` field at the end — a paragraph capturing key things it learned that don't fit the structured fields. Agent 1 gets that summary injected as context. Bridges the two sessions without storing full message history.

---

## Workflow (Agreed Sequence)

1. Upload materials (existing — no change)
2. **Materials conversation** (new Agent 2) — reads everything, surfaces findings and gaps, faculty clarifies
3. Profile confirmed and saved to DB (currently auto-saved silently after analysis run)
4. **KUD conversation** (existing Agent 1, upgraded with tool access)
5. Generate KUDs (existing — no change)

---

## UI Changes Required

- `CourseAnalyzeZone`: Replace "Analyze Materials" button with a "Start materials review" conversation panel — same pattern as `KudReviewTab`'s chat UI
- `CourseAnalyzeZone`: Add state for in-progress materials conversation, confirmed profile, conversation summary

---

## Simple Win Available Now (No Agent Needed)

**Bloom's taxonomy annotation** in `synthesize-course-profile.md` — tag each learning objective with its Bloom's level (remember / understand / apply / analyze / evaluate / create) during the existing synthesis step. One prompt edit, no new infrastructure. Do this regardless of whether Agent 2 is built.

---

## What's Blocked

**Nanoclaw API contract.** Cannot write the implementation plan until we know:
- Endpoint format and base URL
- Auth mechanism
- Request shape (how to define the agent, tools, initial message)
- Response shape (streaming vs. polling, tool call format)
- How tools are registered / invoked

Once the API contract is known, both agents can be specced as implementation plans using the writing-plans skill.

---

## Implementation Notes (When Ready)

- Both agents share the same tool infrastructure — build the tool layer once, wire it to both agents
- The tool layer is just API routes the agent can call: `GET /api/courses/[code]/materials`, `GET /api/courses/[code]/profile`, etc.
- Structured output from agents is harder to guarantee than from direct LLM calls — plan for a final structured extraction call after the conversation ends, same pattern as Phase 1
- OpenAI-only deployment — no `getProvider()` abstraction needed; call API directly like `kud-chat.ts` does
