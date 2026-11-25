# Staged interview on Pi skills: design

**Date:** 2026-11-25. **Status:** draft for owner approval.
**Owner decisions (2026-11-25):** "B, defaults, upgrade first". That means option B, the six defaults listed under Decisions, and the Pi upgrade as its own step before the rebuild.
**Evidence:** an independent Fable review of five real interviews (GC 1040, GC 2070, GC 4900or, PKSC 2200, GC 4060), 2026-11-25. Its findings are summarized under "Why" below. The full report is in the session scratchpad and is quoted where it matters.

## Why

The interview has roughly tripled in length since October.
- **Summer 2026:** median 11 instructor turns, maximum 17.
- **Since 2026-10-06:** median 34 turns; GC 2070 took 68, and GC 4060 is at 69 and not finished.

The longer interviews were not better. GC 2070 never asked about the three unit tests or the final exam. GC 4900or learned the grading basis (participation and completion) at the 44th of 50 answers.

Causes, from the review:

1. **The prompt specifies a 60–70 question interview.** `lib/ai/prompts/capture-chat-agent.md` (8,463 words) asks for:
   - one probe per distinctive theme, per assumed incoming skill ("One skill per turn; resist batching"), per foundational habit, per productive-failure condition and per competency;
   - a recap every 5–7 turns;
   - two readiness gates (themes, incoming skills) with no upper bound.

   The summer model (gpt-5.4) skipped most of these; Sol and Terra obey them.
2. **There is no order and no exit test:** "let the dialogue flow naturally". Nothing says when a topic is finished.
3. **Readiness is a number the model reports about itself.** Its to-do lists are rewritten every turn (GC 2070 used 131 different labels), so the score parks at 74 under a gate that cannot close.
4. **A search is forced on most turns.** Any distinctive file-name word, such as "flexo", forces `search_materials` (`lib/ai/agent/interview-controls.ts`). In GC 4060 that was 58 of 66 turns, and the retrieved passages then steer the next question.
5. **The app keeps no state and sets no limits.** The full history, including each old reply's to-do lists, is replayed every turn. Nothing detects a repeat, a "skip", or turn 40.
6. **The benchmark tests single moments** (29 cases), so whole-interview growth was invisible.

Seven questions did most of the useful work across all five courses:
- what students can do when they leave;
- what separates strong work from checklist work;
- how much is on the student when they produce it;
- where they must say why, and whether that is graded;
- what happens when work comes out wrong;
- what gets re-taught;
- which stated objectives are not really happening.

## Goals

- **Length:** about 15 planned questions, hard cap 20. About 20 minutes for most instructors, 25–30 for long answerers.
- **Visible structure:** the instructor sees "stage 3 of 6" and what each stage covers.
- **Never re-ask** an answered question; a "skip" or "move on" is honored at once.
- **Read the materials before the instructor is waiting**, so facts in the files are never asked.
- **Same evidence standard:** the evidence rule, the citation rules and the K/U/D scoring are unchanged.
- **Stage instructions are Pi skills** (Agent Skills `SKILL.md` files). The app selects which one is active.

## Non-goals

- No change to scoring (`capture-scores`), the depth scale or the evidence rule.
- No move to Pi's full agent session (`pi-coding-agent` `createAgentSession`) in this project. That is option C, a possible follow-up.
- No re-interview of courses already captured under the long interview. That is the owner's call later, per course.
- No change to the live GC 4060 session (decision 6).

## Anti-goals (a failure even if it works)

- A short interview that quietly loses the facts the profile depends on. The whole-interview benchmark guards this.
- An instructor agreeing "yes" to pre-filled drafts with nothing checked. Evidence questions stay open, never yes/no.
- A rigid script that ignores what the instructor volunteers. A volunteered answer fills its slot wherever it lands, which shortens later stages.

## Approaches considered

- **A. Patch the current prompt** (drop the two gates, the recap cadence and the file-name search trigger). Rejected: a quick patch on 8,463 words, and it doesn't make the interview methodical.
- **B. Staged rebuild on the current Pi loop, with skills as real `SKILL.md` files the app injects. Chosen.** No dependency on Pi's full agent session, and the forced-tool behavior the interviewer relies on stays.
- **C. B plus moving to Pi 1.6's full agent session.** Deferred. In Pi 1.6.1 the model is only told skills exist when a file-read or bash tool is enabled (`pi-coding-agent dist/core/system-prompt.js`), and we would disable both, so model-chosen skills don't apply anyway. Whether that session API can still force a tool on each request is unverified. The skill files carry over unchanged if C is done later.

## Decisions (owner defaults, 2026-11-25)

1. **"Not reached" is acceptable.** A slot can end "not reached"; under the evidence rule that score stays at the floor, in exchange for the 20-question cap.
2. **Stage 4 is a tap-to-answer card.** It lists every assumed incoming skill, each answered arrives able / needs a refresher / learned here. A chat answer is also accepted.
3. **The evidence map is shown to the instructor** as part of today's materials-confirmation step, before the first question.
4. **Two anchor assignments per course** in stage 2 (about 15 questions; three would be about 17).
5. **Topics outside the profile** (e.g. the retention study raised in GC 4060) are recorded as a note for the department lead, and the interview moves on.
6. **The live GC 4060 interview is left alone.** The professor finishes or generates from the existing session. The new interview ships only after the whole-interview benchmark passes. GC 4060's long transcript is the main benchmark case, and that professor is the intended first live pilot.

## Step 1: Pi upgrade (separate, first)

- Move `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` from 1.4.0 to 1.6.1 (1.6.1 released 2026-11-25; read its notes for core-loop changes first).
- Known breaking changes that may touch us:
  - since 1.5.0, tool arguments are validated by `pi-schema` (plain JSON Schema). Our `submit_turn` schema is plain JSON; verify;
  - type-level changes in the two files that use Pi (`lib/ai/agent/pi/turn.ts`, `task.ts`).
- Verification before it ships:
  - type-check and unit tests;
  - the 29-case interview benchmark on campus models (free), before vs after;
  - one Terra probe of the real interview path (a few cents).
- It ships on its own, with a STATE.md entry, before any rebuild work merges.

## Step 2: the staged interview

### Stage 0: pre-read (no instructor turns)

A one-time job run when the instructor confirms materials, built on `runPiTask` (`lib/ai/agent/pi/task.ts`). It writes an **evidence map**, each item citing the passage it came from:
- graded work with weights, deliverables and rubric criteria;
- test and quiz item types;
- 5–10 candidate competencies tied to graded work;
- 3–8 skills the projects assume but the course does not teach;
- each stated objective marked "graded work found" or "not found";
- conflicts between sources (recorded as audit notes, never asked);
- content that could not be read.

The materials screen shows this map. The instructor can correct or add to it ("Looks right → start"). Edits are saved to the map and count as instructor testimony.

The map is stored per session and is regenerated if the included materials change before the interview starts. **Storage needs a new table** (`capture_evidence_maps`: session id, course code, map JSON, materials fingerprint, created/edited at). That is a migration, which needs the owner's go-ahead and a backup before it touches the live database.

### Stages 1–6

| Stage | Goal | Pre-filled from the map | Core questions | Exit test (app-checked) | Planned / cap |
|---|---|---|---|---|---|
| 1. The course in your words | Anchor everything else | Summary; graded work | What can students do when they leave that they could not before? Which pieces of graded work carry the course; anything missing or retired? | 2–5 claimed outcomes recorded; 2 anchor works confirmed | 2 / 3 |
| 2. Evidence walk | What is judged, under what conditions | Rubric criteria; test item types | For each anchor: what separates strong work from checklist work? Once: how much is on the student (step by step, from a reference, alone, on an unseen problem)? Once: where must they say why, and is it graded? Once: is this a fair picture of your tests? | Each anchor has graded-on, conditions and reasoning-evidence slots; tests slot | 5 / 7 |
| 3. When it goes wrong, and the leap | Revision, new problems, threshold | Revision or reflection requirements found | What happens when work comes out wrong, and is it required? Do students try before being shown, or take a method to an unfamiliar case? What idea, once it clicks, separates students who get it? | 3 slots | 3 / 4 |
| 4. What students walk in with | Prerequisite fit | Assumed skills; prerequisite profiles | The card (decision 2). Then: what do you re-teach most? | Every listed skill has a status | 2 / 3 |
| 5. Habits and communication | The six foundationals | One line each from stages 1–3 and rubrics | Here is what I have on choice, craft, persistence, curiosity, writing and speaking: what's wrong or missing? | 6 slots | 1 / 2 |
| 6. Objectives and close | Gaps; recap | Objectives with no graded work | For each: happening but ungraded, planned, or no longer part of the course? Then a recap of at most 8 lines: anything wrong or missing? | Each listed objective has a status; recap answered | 2 / 3 |

**Rules the app enforces:**
- **Stage order and per-stage caps.** At a stage's cap, open slots are marked "not reached" and the app moves on.
- **One follow-up per slot, five in the whole interview, hard cap 20 questions.**
- **No re-asking.** A `submit_turn` aimed at a filled slot is sent back with the earlier answer, using the same send-back mechanism as today's citation check.
- **"Skip" or "move on"** marks the slot "unknown" (instructor declined).
- **The Finish button** jumps to the stage 6 recap.
- **Resuming mid-stage** restores the stage and slots from storage.
- **An existing session keeps the interview it started with.** The new interview is turned on for new sessions only, by a setting.

### Skills (real `SKILL.md` files in Agent Skills format)

`lib/ai/skills/interview/`:
- `interview-pre-read/`;
- `stage-1-course/` through `stage-6-objectives/`;
- three situational skills: materials-vs-testimony disagreement, critique or oral assessment, first-time instructor.

The app injects the active stage's skill each turn. The situational skills are offered through a small `load_skill` tool the model may call.

The global rules stay in a shorter core prompt (about 1,000–1,200 words):
- role, in three lines;
- the evidence rule, verbatim;
- materials over testimony over catalog;
- the citation rules;
- plain language, with no K/U/D codes in questions;
- one question per turn, never re-ask, and answer the instructor's own question first;
- evidence questions open, never yes/no;
- "unknown" is acceptable.

Moved out of the interviewer:
- the cross-source crosswalk and the unreadable-content inventory go to stage 0;
- knowledge typing, validity threats and the catalog diff go to synthesis;
- the full depth scale goes, since the interviewer does not score. Stage 2 carries only the Do-condition lines and stage 5 the foundational anchors.

### Tools

- `search_materials` and `fetch_material_section` stay unchanged. A search is forced only when a file was added mid-interview, not on keyword or file-name matches.
- `record_answer(slot, status, summary, citations)` fills any slot (status: filled-from-materials / filled-by-instructor / unknown / not-reached), so volunteered answers count wherever they land.
- `submit_turn(say, question, citations, slot_asked, kind)` replaces the finding + question + readiness reply.
- `load_skill(name)` gives access to the three situational skills only.
- Removed: the four program-memory tools (never called in any stored session).
- Stage completion is derived by the app from the slots. There is no model-called "mark complete" tool.

### Per-turn context

Each turn the model gets: the core prompt, the active stage skill, the relevant part of the evidence map, the slot ledger, and the last 4–6 turns. The full history replay goes. The ledger is rebuilt from the `record_answer` calls stored in `capture_messages.tool_calls` (no schema change).

### Bloom wording (folds in option B, "Bloom in the interview")

About 80 words, in two places only:
- **Stage 2's conditions question:** Bloom's split between carrying out a known procedure on routine work and choosing a method for an unfamiliar problem, in plain words, next to "with direction" and "from a reference", which Bloom lacks.
- **Stage 6:** objectives are written in Bloom verbs, so the question quotes the verb against the evidence ("the objective says analyze; the graded work has students carry out the measurement"). Recap lines use process + content + condition.

No Bloom wording goes in stages 1, 3 or 5; habits are outside Bloom. The whole-interview benchmark compares stage 2 and stage 6 with and without this wording on Terra before it ships.

### UI changes (`/capture/[code]`)

- The materials step shows the evidence map with edit and add.
- A stage progress bar ("Stage 3 of 6 — When it goes wrong") replaces the readiness score and the free-text checklist (`lib/capture/interview-checklist.ts`) for new-interview sessions.
- The stage 4 card.
- A "Skip this question" control.
- The Finish button jumps to the recap. Generate is enabled after stage 6, or earlier with a note that some slots were not reached.
- Old sessions keep today's UI.

### Synthesis

- `capture-synthesis.md` references "Audit Area 7" by number (lines 199–227). Change it to the stage 3 slots in the same release.
- Synthesis also receives the slot ledger and the evidence map alongside the transcript.
- Slots marked "not reached" or "unknown" are named in the profile as testimony gaps.

## Whole-interview benchmark (gate before shipping)

- **Simulated instructor:** a free campus model that answers only from a real transcript, plus that course's materials. It says "I don't know" when the transcript has no answer.
- **Cases:**
  - the five reviewed courses, with GC 4060 as the main case;
  - plus a terse instructor, a "skip this", an instructor asking their own question, and a "yes" to an either/or.
- **Key-fact recall:** 8–12 facts per course that the profile depended on. A reviewer agent drafts them from the long transcripts; the owner confirms them. Measured at turn 15 and turn 20.
- **Pass bar:**
  - at least 80% of key facts by turn 20;
  - zero repeated questions;
  - at least 90% of runs finish within 20;
  - median reply under 10 seconds.
- **Profile comparison:** profiles from old vs new transcripts for the same courses. Report the cells within one level, and the Understand cells that fall to the floor.
- **Cost:** the simulated instructor is free. The Terra interviewer arm needs a per-run estimate, the owner's yes, a hard cap in code and a one-case probe first (owner rule 2026-11-08); roughly $3–6.
- **Kept:** the existing 29 single-moment cases.

## Rollout

1. Ship the Pi upgrade (step 1), verified.
2. Build the new interview behind a setting, off for everyone; run the benchmark on scratch data.
3. With the owner's go: apply the migration (backup first), deploy, and turn it on for one pilot session (the GC 4060 professor, decision 6).
4. Compare the pilot's profile with the existing GC 4060 profile. Then the owner decides whether to make it the default for new sessions.
5. The old interview code stays until the new one is the default and has run for several courses.

## Left to the builder

- Exact slot names and the evidence-map JSON shape.
- Skill wording within the stage goals above.
- How the evidence-map editor looks, within the existing capture page style.
- How the setting is stored (an `ai_function_settings` field or a new flag), following existing patterns.

## Open after this project

- **Option C:** move to Pi 1.6's full agent session.
- Whether to re-interview courses captured under the long interview.
- Moving capture scoring to Terra (a separate pending decision in STATE.md).
