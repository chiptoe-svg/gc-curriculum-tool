# Staged Interview on Pi Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new CourseCapture interview with these parts:
- a one-time pre-read of the materials builds an evidence map;
- the instructor confirms the map;
- six app-run stages, each driven by a Pi skill file, with about 16 planned questions and a hard cap of 20;
- a slot ledger that prevents repeats;
- an adapter so that existing screens, routes and synthesis keep working.

**Architecture:**
- A session is "staged" if and only if it has a row in a new table, `capture_interview_sessions`. Every other session, including the live GC 4060 one, keeps the classic path untouched.
- A pure stage engine (`lib/capture/staged/`) owns the stage order, slots, caps and send-back rules. The model writes questions through `submit_turn` and fills slots through `record_answer`.
- Stage instructions are Agent Skills `SKILL.md` files that the app injects.
- The staged turn returns an `AuditResponse`-shaped reply plus a `staged` block, so `saveTurn`, the conversation route, snapshots and synthesis need only small additions.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle/Postgres 17, Vitest, Pi (`pi-agent-core` / `pi-ai`, either 1.4.0 or 1.6.1, whichever the upgrade plan left).

**Spec:** `docs/superpowers/specs/2026-11-25-interview-stages-design.md`. Read the whole spec, including "Calls made after the builder check". This plan deviates from it once: Ruling P1 below.

## Global Constraints

- **Classic interview unchanged.** No behavior change for any session without a `capture_interview_sessions` row (spec decision 6). The existing tests for `streamAuditAgent`, `runAuditAgent` and the chat route must pass unmodified.
- **Caps.** Planned 16, hard cap 20. Stage plan/cap: 1 = 2/3, 2 = 5/7, 3 = 3/4, 4 = 2/3, 5 = 1/2, 6 = 2/3. At most one follow-up per slot and five in total. At question 19 the next turn is the recap.
- **Question counting (spec ruling 2).** A question is a `submit_turn` with kind `question`, `follow_up` or `recap`. The stage 4 card counts as one. `answer_only` (answering the instructor's own question) does not count.
- **Slot statuses:** `filled_from_materials | filled_by_instructor | unknown | not_reached`.
- **No K/U/D codes** (K2, U4, D3 …) in any interviewer question. The evidence rule text is copied verbatim from `capture-chat-agent.md` ("The Evidence Rule" section).
- **OpenAI strict schemas:** every property is in `required`, and optional values are nullable unions (CLAUDE.md, "OpenAI strict-mode JSON schemas").
- **Forced search** only when a file was added mid-interview (`material_added_in_session`, migration 0075), never on keyword or file-name matches.
- **Migration 0076** is applied to the scratch DB only in this plan. Applying it live needs the owner's explicit go plus a backup (`scripts/migrations/p2-backup.sh`).
- **No dev server or app against the live DB.** Benchmarks use the `gc_curriculum_p2_scratch` DB with `--expect-db`.
- **Paid model calls** (Terra) need a per-run estimate, the owner's yes, a hard cap in code (`--max-usd`) and a one-case probe first. Campus models are free.
- **Copy:** US spelling and plain language. The UI says "stage", never "slot".
- **Git:** work in a worktree off `dev`. Never `git commit -a`. STATE.md is updated in the same commit as routes, schema, AI function ids or env vars.

## Rulings made while planning

- **P1. Where the "staged" marker lives.** Spec ruling 3 put an `interview_version` column on `capture_conversations`, but that table is per course, not per session. `capture_sessions` is per session, but its `revision_mode` is NOT NULL and its rows exist only for revision sessions. So the marker is the existence of a row in one new table, `capture_interview_sessions` (session id PK), which also holds the evidence map. One migration, no change to existing tables. Cost if wrong: a later "version 3" needs a column on this table, which is cheap.
- **P2. How sessions become staged.** New sessions become staged when either:
  - the capture page is opened with `?interview=staged` (the pilot link the owner hands out); or
  - the env var `INTERVIEW_STAGED_DEFAULT=on` is set, in which case new sessions start staged unless the page is opened with `?interview=classic`.

  Flipping the env var never changes a session already started.

## Review Focus

1. **Instructor volunteers an answer to a later stage's slot.** `record_answer` fills it, and that stage asks nothing about it later. Test in Task 2 (`engine.test.ts`, "volunteered slot is skipped").
2. **Page reload mid-stage.** The ledger rebuilt from stored `record_answer` tool calls equals the live one, and the next turn continues the same stage. Test in Task 6 (`staged-turn.test.ts`, "resume rebuilds ledger").
3. **"Skip" on the very first question, or Finish before stage 2.** The recap is still reachable, Generate works, and unreached slots are `not_reached`. Tests in Task 2 ("finish jumps to recap") and Task 6 ("skip marks unknown").
4. **Pre-read fails or there are no readable materials.** The session is still created with `map_status: 'failed' | 'none'`, and the interview runs without pre-fills. Test in Task 5.
5. **The model keeps aiming at a filled slot after two send-backs.** The reply is accepted with control event `repeat-accepted`, so the turn never fails. Test in Task 4.

---

### Task 1: Storage: `capture_interview_sessions` and readiness-consumer inventory

**Files:**
- Modify: `lib/db/schema.ts` (add the table next to `captureSessions`, ~line 1264)
- Create: `drizzle/0076_*.sql` (via `pnpm db:generate`), `lib/db/capture-interview-sessions-queries.ts`
- Test: `lib/db/__tests__/capture-interview-sessions-queries.test.ts` (pattern: the existing DB query tests on the test DB)

**Interfaces:**
- Produces:
  - Table `capture_interview_sessions`: `session_id uuid PK`, `course_code text NOT NULL → courses.code ON DELETE CASCADE`, `map jsonb NULL`, `map_status text NOT NULL` (`'pending'|'ready'|'failed'|'none'`), `materials_fingerprint text NULL`, `map_edited_at timestamptz NULL`, `created_at timestamptz DEFAULT now() NOT NULL`.
  - `createInterviewSession(input: { sessionId: string; courseCode: string }): Promise<void>` (status `'pending'`; first write wins).
  - `getInterviewSession(sessionId: string): Promise<InterviewSessionRow | null>`
  - `saveEvidenceMap(sessionId: string, input: { map: EvidenceMap | null; status: 'ready'|'failed'|'none'; fingerprint: string | null }): Promise<void>`
  - `saveEditedEvidenceMap(sessionId: string, map: EvidenceMap): Promise<void>` (sets `map_edited_at = now()`)
  - `InterviewSessionRow = { sessionId; courseCode; map: EvidenceMap | null; mapStatus; materialsFingerprint; mapEditedAt: Date | null; createdAt: Date }`. `EvidenceMap` is imported from `lib/capture/staged/evidence-map.ts` (Task 2). To avoid ordering trouble, Task 1 may declare `map` as `unknown` and Task 2 tightens it.

- [ ] **Step 1: Inventory readiness consumers.** `grep -rn "readiness" app lib --include=*.ts --include=*.tsx`. For each consumer, ledger one line: file, what it reads (score / covered / remaining / good_enough_to_generate), and whether the staged adapter (Task 6) satisfies it. Expected consumers include the chat and conversation routes, `messages/[messageId]`, snapshots, `CaptureChatPanel`, `CaptureClient`, `HelpPanel`, `page.tsx`, the `boxes/*` files, `session-briefing.ts` and `interview-checklist.ts`. Anything the adapter does not satisfy becomes a Ruling with its fix task named.
- [ ] **Step 2: Write the failing tests.** `createInterviewSession` then `getInterviewSession` returns status `'pending'` and map `null`. A second `createInterviewSession` for the same id is a no-op. `saveEvidenceMap` then `get` returns the map and `'ready'`. `saveEditedEvidenceMap` sets `mapEditedAt`. `get` on an unknown id returns `null`.
- [ ] **Step 3: Run them.** `pnpm vitest run lib/db/__tests__/capture-interview-sessions-queries.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Add the table and generate the migration.** Add the table to `schema.ts`, run `pnpm db:generate`, and check the SQL creates exactly one table plus the FK, touching no existing table. Implement the queries.
- [ ] **Step 5: Apply to the test and scratch DBs only, then run the tests.** Expected: PASS. Also run `pnpm exec tsc --noEmit -p .`.
- [ ] **Step 6: Commit.** Include the STATE.md update: a schema-section line "0076 capture_interview_sessions — built, scratch only, NOT applied live".
```bash
git add lib/db/schema.ts drizzle/0076_* drizzle/meta lib/db/capture-interview-sessions-queries.ts lib/db/__tests__/capture-interview-sessions-queries.test.ts docs/STATE.md
git commit -m "feat(capture): capture_interview_sessions table for the staged interview (scratch only)"
```

### Task 2: Stage engine: stages, slots, ledger, caps (pure)

**Files:**
- Create: `lib/capture/staged/evidence-map.ts`, `lib/capture/staged/stages.ts`, `lib/capture/staged/ledger.ts`, `lib/capture/staged/engine.ts`
- Test: `lib/capture/staged/__tests__/ledger.test.ts`, `lib/capture/staged/__tests__/engine.test.ts`

**Interfaces:**
- Produces:
  - **`evidence-map.ts`:**
    - `EvidenceMap = { summary: string; graded_work: Array<{ title: string; weight: string | null; deliverables: string | null; rubric_criteria: string[]; source: string }>; tests: Array<{ name: string; item_types: string[]; source: string }>; competencies: Array<{ statement: string; graded_work: string[] }>; assumed_skills: Array<{ skill: string; used_in: string; source: string }>; objectives: Array<{ text: string; status: 'graded_work_found' | 'not_found'; graded_work: string[] }>; conflicts: string[]; unreadable: Array<{ file: string; note: string }> }`
    - `EvidenceMapJsonSchema` (OpenAI strict).
    - `EvidenceMapSchema` (zod).
  - **`stages.ts`:**
    - `StageId = 1|2|3|4|5|6`.
    - `STAGES: ReadonlyArray<{ id: StageId; title: string; skill: string; planned: number; cap: number; slots: (map: EvidenceMap | null, anchors: string[]) => string[] }>`.
    - Exact titles: 1 "The course in your words", 2 "Evidence walk", 3 "When it goes wrong, and the leap", 4 "What students walk in with", 5 "Habits and communication", 6 "Objectives and close".
    - Exact skill names: `stage-1-course`, `stage-2-evidence`, `stage-3-wrong-and-leap`, `stage-4-incoming`, `stage-5-habits`, `stage-6-objectives`.
    - Slot ids by stage:
      - stage 1: `outcomes`, `anchors`;
      - stage 2: `graded_on:<anchor>` for each of up to 2 anchors, then `conditions`, `reasoning_evidence`, `tests`;
      - stage 3: `revision`, `transfer`, `threshold`;
      - stage 4: `incoming`, `reteach`;
      - stage 5: `habits`;
      - stage 6: `objectives`, `recap`.
    - The `objectives` slot exists only if the map has any objective with status `not_found`. Otherwise stage 6 has `recap` only.
    - `PLANNED_TOTAL = 16`, `HARD_CAP = 20`, `MAX_FOLLOW_UPS = 5`.
  - **`ledger.ts`:**
    - `SlotStatus = 'filled_from_materials'|'filled_by_instructor'|'unknown'|'not_reached'`.
    - `SlotRecord = { slot: string; status: SlotStatus; summary: string; citations: Array<{ type: 'chunk'|'instructor'; chunkId: string|null; messageId: string|null; excerpt: string }> }`.
    - `AskedTurn = { stage: StageId; slot: string; kind: 'question'|'follow_up'|'recap'|'answer_only' }`.
    - `Ledger = { anchors: string[]; slots: Record<string, SlotRecord | undefined>; asked: AskedTurn[] }`.
    - `buildLedger(map: EvidenceMap | null, events: Array<{ type: 'record'; record: SlotRecord } | { type: 'asked'; turn: AskedTurn } | { type: 'skip'; slot: string } | { type: 'finish' }>): Ledger`. Anchors come from the `anchors` record's summary, newline-separated, max 2.
  - **`engine.ts`:**
    - `EngineState = { stage: StageId; openSlots: string[]; questionsAsked: number; followUpsUsed: number; mustRecap: boolean; done: boolean; stageProgress: Array<{ id: StageId; title: string; status: 'done'|'active'|'upcoming' }> }`.
    - `engineState(map: EvidenceMap | null, ledger: Ledger): EngineState`.
    - `checkTurn(state: EngineState, ledger: Ledger, turn: AskedTurn): { ok: true } | { ok: false; sendBack: string }`.
    - `isFilled(s: SlotRecord | undefined): boolean` (true for any status).

- [ ] **Step 1: Write the failing tests.** Exact cases:
  - **`ledger.test`:**
    - an empty event list gives empty slots;
    - a later `record` for the same slot replaces the earlier one;
    - `skip` sets the last-asked slot to `unknown` with summary "instructor skipped";
    - `finish` marks every unfilled non-stage-6 slot `not_reached`;
    - anchors are parsed from the `anchors` summary, at most 2.
  - **`engine.test`:**
    - "starts at stage 1 with outcomes and anchors open";
    - "volunteered slot is skipped": a record for `threshold` during stage 1 means stage 3's open slots exclude `threshold`;
    - "stage cap closes stage": 3 counted questions in stage 1 with `anchors` unfilled moves to stage 2 with `anchors` = `not_reached`;
    - "question 19 forces recap": 19 counted questions gives `mustRecap: true` and `stage: 6`;
    - "finish jumps to recap";
    - "answer_only not counted";
    - "card counts once";
    - "re-ask of filled slot is sent back", with a sendBack that quotes the earlier summary;
    - "second follow-up on a slot is sent back";
    - "sixth follow-up overall is sent back";
    - "stage 6 without unevidenced objectives has only recap";
    - "done after recap answered".
- [ ] **Step 2: Run them.** `pnpm vitest run lib/capture/staged`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the four modules.** A stage is done when all its slots are filled or its counted questions reached its cap. Unfilled slots in a capped stage become `not_reached` in the computed state (not in stored records).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add lib/capture/staged
git commit -m "feat(capture): staged-interview engine (stages, slots, ledger, caps)"
```

### Task 3: Skill files, skill loader and the core prompt

**Files:**
- Create:
  - `lib/ai/skills/interview/<name>/SKILL.md` for the six stage skills, `interview-pre-read`, and three situational skills (`materials-vs-testimony`, `critique-or-oral-assessment`, `first-time-instructor`);
  - `lib/ai/skills/load-skill.ts`;
  - `lib/ai/prompts/capture-interview-core.md`.
- Test: `lib/ai/skills/__tests__/interview-skills.test.ts`, `lib/ai/prompts/__tests__/capture-interview-core.test.ts`

**Interfaces:**
- Produces:
  - `loadSkill(name: string, opts?: { bloom?: boolean }): { name: string; description: string; body: string }`. It reads `lib/ai/skills/interview/<name>/SKILL.md` and validates Agent Skills frontmatter: name `/^[a-z0-9]+(-[a-z0-9]+)*$/` and at most 64 characters, matching its directory; description 1–1024 characters. It memoizes. With `bloom: false` it strips the text between `<!-- bloom -->` and `<!-- /bloom -->`.
  - `SITUATIONAL_SKILLS: readonly ['materials-vs-testimony','critique-or-oral-assessment','first-time-instructor']`.
  - Core prompt id `capture-interview-core`, loaded with the existing `loadPrompt`.

- [ ] **Step 1: Write the failing tests.**
  - Every skill named in `STAGES`, plus `interview-pre-read` and the situational ones, loads with valid frontmatter.
  - Each stage skill body names every slot id for its stage (from `stages.ts`) exactly.
  - No skill or core-prompt sentence contains `/\b[KUD][0-5]\b/`.
  - A Bloom block appears only in `stage-2-evidence` and `stage-6-objectives`, totaling 60–100 words across both.
  - `bloom: false` removes it.
  - The core prompt is 900–1,300 words and contains the evidence-rule paragraph verbatim from `capture-chat-agent.md`.
  - The core prompt contains "one question per turn" and "never ask again".
  - Each stage skill is at most 450 words.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/ai/skills lib/ai/prompts/__tests__/capture-interview-core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the skills and core prompt.**
  - **Content per stage** comes from the spec's stage table (goal, pre-fills, core questions, exit test) and the seven productive questions in the spec's "Why" section. Each skill says which `record_answer` slots to fill. The judgment-slot question opens with what the materials show (spec ruling 1). Evidence questions are open, never yes/no.
  - **Core prompt contents** are the spec's "global rules" list.
  - **Bloom text** is in spec section "Bloom wording": stage 2's conditions wording, and stage 6's verb-against-evidence wording plus recap lines as process + content + condition.
  - **`interview-pre-read`** says what to extract for each `EvidenceMap` field, with a citation for every item.
  - Then implement `loadSkill`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add lib/ai/skills lib/ai/prompts/capture-interview-core.md lib/ai/prompts/__tests__/capture-interview-core.test.ts
git commit -m "feat(capture): interview stage skills (Agent Skills SKILL.md) and core prompt"
```

### Task 4: Pi turn: custom submit tool and send-back hook

**Files:**
- Modify: `lib/ai/agent/pi/turn.ts`
- Test: `lib/ai/agent/pi/__tests__/turn-submit-override.test.ts` (mock Pi the same way the existing Pi tests do)

**Interfaces:**
- Produces: `PiTurnInput` gains optional fields:
  - `submit?: { jsonSchema: Record<string, unknown>; parse: (raw: unknown) => unknown; description: string }`, which defaults to the `AuditResponse` behavior;
  - `checkSubmit?: (value: unknown) => string | null`, which returns a send-back message or null;
  - `maxSendBacks?: number` (default 2).

  `PiTurnResult.value` becomes generic: `runPiTurn<T = AuditResponse>(input): Promise<PiTurnResult<T>>`. When `checkSubmit` still fails after `maxSendBacks`, the value is accepted and `controlEvents` gets `'repeat-accepted'`.

- [ ] **Step 1: Write the failing tests.**
  - With no `submit` given, behavior is identical: the existing Pi tests pass unchanged.
  - With `submit` given, the forced tool is named `submit_turn` and uses the supplied schema.
  - A `checkSubmit` returning a message once leads to one more request, and the second value is returned.
  - Returning a message 3 times leads to the third value being accepted with `'repeat-accepted'` in `controlEvents`.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/ai/agent/pi`. Expected: the new tests FAIL; the old ones PASS.
- [ ] **Step 3: Implement.** Route the check through the same send-back path the citation check uses (`citationFollowUp` / `MAX_CITATION_RETRIES` in `./controls`).
- [ ] **Step 4: Run all Pi and agent tests.** `pnpm vitest run lib/ai/agent lib/ai/__tests__/interview-loop.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add lib/ai/agent/pi/turn.ts lib/ai/agent/pi/__tests__/turn-submit-override.test.ts
git commit -m "feat(pi): runPiTurn accepts a custom submit tool and send-back check"
```

### Task 5: Stage 0 pre-read and the evidence-map API

**Files:**
- Create: `lib/capture/staged/pre-read.ts`, `app/api/capture/[code]/evidence-map/route.ts`
- Test: `lib/capture/staged/__tests__/pre-read.test.ts`, `app/api/capture/[code]/evidence-map/__tests__/route.test.ts`

**Interfaces:**
- Consumes:
  - `runPiTask` (`lib/ai/agent/pi/task.ts`);
  - `buildAuditTools(courseCode)` (`lib/ai/agent/audit-tools.ts`), using only `search_materials`, `fetch_material_section` and `list_materials`;
  - `loadSkill('interview-pre-read')`;
  - the Task 1 queries and Task 2 `EvidenceMapJsonSchema` / `EvidenceMapSchema`.
- Produces:
  - `runPreRead(courseCode: string): Promise<{ map: EvidenceMap | null; status: 'ready'|'failed'|'none'; fingerprint: string | null }>`. Status is `'none'` when no included material has extraction status `ok`, and `'failed'` on error or timeout (180 s). The fingerprint is sha256 of the sorted `id:updatedAt` of the included materials. The model and endpoint are the ones resolved for `capture-chat-agent` (the same resolver `streamPiInterview` uses).
  - **`POST /api/capture/[code]/evidence-map`**, body `{}`. Auth and rate-limit as in the chat route (`authorizeCourseWrite`, `checkIpRateLimit`, `checkDailyCap`). It creates a session id (`startNewSession()`), calls `createInterviewSession`, runs `runPreRead` and saves the result. It returns `{ sessionId, map, status }`.
  - **`PUT`**, body `{ sessionId, map }`. It validates with `EvidenceMapSchema` and calls `saveEditedEvidenceMap`. It returns 400 on invalid input, and 404 if the session is unknown or belongs to another course.
  - **`GET ?sessionId=`** returns the row's map and status. If the session has no assistant turn yet and the current materials fingerprint differs from the stored one, it re-runs `runPreRead`, saves the result and returns the new map. The spec requires the map to be regenerated when materials change before the interview starts. Add this as a test case in Step 1.

- [ ] **Step 1: Write the failing tests** (mock `runPiTask` and the DB).
  - `pre-read`: no readable materials gives `'none'` and no model call; a mocked task value gives `'ready'` with the parsed map; a throwing task gives `'failed'` and `map: null`.
  - Route: POST creates the session row and returns the sessionId, even when the pre-read fails (Review Focus 4); PUT with a bad map gives 400; PUT for another course's session gives 404; unauthorized gives 401.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/capture/staged/__tests__/pre-read.test.ts app/api/capture/\[code\]/evidence-map`. Expected: FAIL.
- [ ] **Step 3: Implement.** The pre-read system prompt is the `interview-pre-read` skill body. The user message is the course catalog block plus full digests (the same text `buildAgentCall` builds with `materialsView: 'digests'`; extract that block into an exported helper `renderAtRestContext(course, materials, view)` in `audit-agent.ts` without changing its output). Log cost and duration as other Pi tasks do.
- [ ] **Step 4: Run the tests and the type-check.** Run them plus `pnpm vitest run lib/ai/agent` (the `buildAgentCall` output must be unchanged). Expected: PASS.
- [ ] **Step 5: Commit**, including the STATE.md routes table row for `/api/capture/[code]/evidence-map` (built, not deployed).
```bash
git add lib/capture/staged/pre-read.ts lib/capture/staged/__tests__/pre-read.test.ts app/api/capture/\[code\]/evidence-map lib/ai/agent/audit-agent.ts docs/STATE.md
git commit -m "feat(capture): stage 0 pre-read and evidence-map API"
```

### Task 6: The staged turn: context, tools, skip/finish, adapter, routing

**Files:**
- Create: `lib/capture/staged/staged-turn.ts`, `lib/capture/staged/staged-tools.ts`, `lib/capture/staged/adapter.ts`
- Modify:
  - `lib/ai/agent/audit-agent-stream.ts` (route before `buildAgentCall`);
  - `lib/ai/agent/audit-agent.ts` (`runAuditAgent`, same routing);
  - `lib/ai/agent/audit-response-schema.ts` (optional `staged` block);
  - `app/api/capture/[code]/chat/route.ts` (accept `finish: true`; pass it through).
- Test: `lib/capture/staged/__tests__/staged-turn.test.ts`, `lib/capture/staged/__tests__/adapter.test.ts`, plus routing cases added to the existing `audit-agent-stream` tests.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - **`StagedSubmit`:** `{ say: string; question: string; citations: AuditCitation[]; slot_asked: string; kind: 'question'|'follow_up'|'recap'|'answer_only' }`, with a strict JSON schema.
  - **`buildStagedTools(courseCode, ledger)`** returns `ToolDefinition[]` with these tools:
    - `search_materials` and `fetch_material_section` (from `buildAuditTools`);
    - `record_answer({ slot, status, summary, citations })`, which validates that the slot exists for this map/anchors and that the status is not `not_reached`, and returns `"recorded"`;
    - `load_skill({ name })`, restricted to `SITUATIONAL_SKILLS`, which returns the skill body;
    - `note_for_lead({ note })`, for a topic the instructor raises that is outside the profile (spec decision 5). It returns `"noted"`, and the note is stored in the turn's tool calls. The core prompt says to record such topics this way and move on. Add a test: "note_for_lead is stored and not counted as a question".
  - **`AuditResponse`** gains `staged?: { stage: StageId; stageTitle: string; stageProgress: EngineState['stageProgress']; questionsAsked: number; cap: 20; slotAsked: string; kind: StagedSubmit['kind'] }`. This field is zod-optional, and not in `AuditResponseJsonSchema` (the classic loop never emits it).
  - **`toAuditResponse(submit: StagedSubmit, state: EngineState, ledger: Ledger): AuditResponse`:**
    - `finding = say`; `question = question`;
    - `readiness.score = round(100 × filled slots / all slots)`;
    - `covered` = titles of done stages; `remaining` = titles of the active and upcoming stages;
    - `good_enough_to_generate = state.done || state.mustRecap`.
  - **`streamStagedInterview(input: AuditAgentInput & { finish?: boolean }): AsyncGenerator<AuditStreamEvent>`.** It emits the same events as `streamPiInterview` and persists through `persistAssistantTurn`. `toolCallsUsed` holds every `record_answer` call, which is the source for rebuilding the ledger.

  **The turn algorithm:**
  1. Append the user message. Use the same `appendMessage` call as `buildAgentCall`.
  2. Rebuild the ledger. The source events are:
     - the stored assistant rows' `toolCalls` (each `record_answer` → `record`);
     - their content's `staged` block (→ `asked`);
     - a user message matching `/^(skip|skip this question|move on|next question|pass)\.?$/i` (→ `skip`);
     - `finish` (→ `finish`, at most once).
  3. Compute `engineState`.
  4. Build the context:
     - system = core prompt + active stage skill (with Bloom unless `INTERVIEW_BLOOM=off`), or the stage 6 skill when `mustRecap`;
     - the first user message = catalog + the evidence map section relevant to the stage (the whole map for stages 1 and 6) + the ledger rendered as "Answered so far" lines (slot, status, summary) + "Open in this stage: …" + "Questions asked: N of 20";
     - then the last 6 transcript messages.
  5. Call `runPiTurn<StagedSubmit>` with `submit`, with `checkSubmit` that calls `checkTurn` and also rejects a `kind` other than `recap` when `mustRecap`, with `requireSearchFirst` only when a material was added in this session after the last assistant turn, and with `maxToolCalls` 6.
  6. Map the result through `toAuditResponse`, attach `staged`, and persist.

  **Routing:** in `streamAuditAgent` and `runAuditAgent`, `if (await getInterviewSession(input.sessionId)) → staged path`, before `buildAgentCall`. No row means the classic path, byte-for-byte as today.

- [ ] **Step 1: Write the failing tests** (mock `runPiTurn` and the DB queries).
  - "classic session unchanged": no row means `buildAgentCall` is called and the staged path is not.
  - "opening turn asks stage 1 with stage-1 skill in system prompt".
  - "record_answer in turn N fills slot; turn N+1 context lists it under Answered so far".
  - "resume rebuilds ledger" (Review Focus 2): the ledger from stored rows deep-equals the ledger accumulated live across 3 turns.
  - "skip marks unknown" (Review Focus 3).
  - "finish → mustRecap and stage-6 skill".
  - "material added after last turn → requireSearchFirst true; keyword 'flexo' alone → false".
  - Adapter: the score, covered/remaining titles and `good_enough_to_generate` rules.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/capture/staged lib/ai/agent`. Expected: the new tests FAIL; the existing ones PASS.
- [ ] **Step 3: Implement.** In the chat route, read `body.finish === true` and pass `finish` to both agent entry points. The classic path ignores it.
- [ ] **Step 4: Run the full suite and the type-check.** Expected: PASS, with the existing chat-route and agent tests unmodified.
- [ ] **Step 5: Commit.**
```bash
git add lib/capture/staged lib/ai/agent/audit-agent-stream.ts lib/ai/agent/audit-agent.ts lib/ai/agent/audit-response-schema.ts app/api/capture/\[code\]/chat/route.ts
git commit -m "feat(capture): staged interview turn with slot ledger, skip/finish and readiness adapter"
```

### Task 7: Synthesis reads the ledger and the map

**Files:**
- Modify: `lib/ai/analyze/capture-scores.ts` (`V2SynthesisContext`, `buildV2SynthesisUserMessage` ~line 399), `lib/ai/prompts/capture-synthesis.md` (lines 199–227), `app/api/capture/[code]/scores/route.ts` (load the row and ledger)
- Test: `lib/ai/analyze/__tests__/capture-scores-staged.test.ts`; update `lib/ai/prompts/__tests__/capture-synthesis-bloom.test.ts` and its fixture only if the schema text changes (it shouldn't)

**Interfaces:**
- Consumes:
  - `buildLedger`, `engineState` (Task 2);
  - `getInterviewSession` (Task 1);
  - `ledgerEventsFromTranscript(rows: CaptureMessageRow[], finishFlag: boolean)` exported from `staged-turn.ts`. If Task 6 inlined it, extract it there with no behavior change.
- Produces: `V2SynthesisContext` gains `staged?: { map: EvidenceMap | null; ledger: Ledger }`. When present, the user message gains these sections:
  - `# Interview record (staged)`: one line per slot (stage, slot, status, summary);
  - `# Evidence map (confirmed by the instructor)`;
  - `# Not reached or unknown`: those slots, with the instruction that the profile must name them as testimony gaps;
  - `# Notes for the department lead`: the `note_for_lead` notes, for reference only and never scored.

  `staged` also carries `leadNotes: string[]`.

- [ ] **Step 1: Write the failing tests.**
  - No `staged` given leaves the message byte-identical to today's (snapshot of current output).
  - With `staged`, all three sections are present.
  - `not_reached` slots are listed.
  - `capture-synthesis.md` no longer says "Audit Area 7" without the staged alternative: assert it contains "stage 3 (revision, transfer, threshold)".
- [ ] **Step 2: Run them.** `pnpm vitest run lib/ai/analyze lib/ai/prompts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Change the prompt wording to: "emit only if productive-failure conditions were probed: Audit Area 7 in classic interviews, or stage 3 (revision, transfer, threshold) slots filled in staged interviews". The scores route loads the interview session row and passes `staged` when it exists.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then run `pnpm test`.
- [ ] **Step 5: Commit.**
```bash
git add lib/ai/analyze/capture-scores.ts lib/ai/prompts/capture-synthesis.md app/api/capture/\[code\]/scores/route.ts lib/ai/analyze/__tests__/capture-scores-staged.test.ts
git commit -m "feat(capture): synthesis reads the staged interview record and evidence map"
```

### Task 8: Capture page: evidence map step, stage bar, stage 4 card, skip, finish

**Files:**
- Create: `app/capture/[code]/staged/EvidenceMapStep.tsx`, `app/capture/[code]/staged/StageProgress.tsx`, `app/capture/[code]/staged/IncomingSkillsCard.tsx`
- Modify:
  - `app/capture/[code]/page.tsx` (read `interview` search param and `INTERVIEW_STAGED_DEFAULT`);
  - `app/capture/[code]/CaptureClient.tsx` (after materials confirm, staged sessions show `EvidenceMapStep` before the chat);
  - `app/capture/[code]/CaptureChatPanel.tsx` (for staged sessions: `StageProgress` replaces `InterviewChecklist`, add a "Skip this question" button, Finish sends `finish: true`, render the card when `staged.slotAsked === 'incoming'`);
  - `app/api/capture/[code]/conversation/route.ts` (return `staged` from the latest assistant row, and the session's map status).
- Test: component tests in `app/capture/[code]/staged/__tests__/` (pattern: existing `app/capture` tests with Testing Library)

**Interfaces:**
- Consumes:
  - the `POST`/`PUT`/`GET /api/capture/[code]/evidence-map` routes (Task 5);
  - the chat route with `finish` (Task 6);
  - `AuditResponse.staged` (Task 6);
  - `EvidenceMap` (Task 2).
- Produces:
  - `StageProgress({ progress, questionsAsked, cap }: { progress: EngineState['stageProgress']; questionsAsked: number; cap: number })`, which renders "Stage N of 6 — <title>" and six steps.
  - `EvidenceMapStep({ courseCode, slug, onStart }: { courseCode: string; slug: string; onStart: (sessionId: string) => void })`, which:
    - calls POST and shows "Reading your materials…" while it runs;
    - renders the map sections in the spec's sketch order (graded work, assumed skills, objectives ✓/✗, couldn't read), with inline edit and add for graded work, assumed skills and objectives;
    - saves via PUT;
    - on "Looks right → start", calls `onStart(sessionId)`;
    - on status `failed` or `none`, says "Couldn't read the materials; the interview will ask instead" and still offers start.
  - `IncomingSkillsCard({ skills, onSubmit }: { skills: string[]; onSubmit: (text: string) => void })`, three choices per skill (arrives able / needs a refresher / learned here). It submits one chat message, formatted as one line per skill: `<skill>: <choice>`. Typing a chat answer instead also works.
  - Staged is chosen when `searchParams.interview === 'staged'`, or when `INTERVIEW_STAGED_DEFAULT === 'on'` and `searchParams.interview !== 'classic'`. The choice applies only when no session is in progress; a resumed session follows its own row.

- [ ] **Step 1: Write the failing tests.**
  - `StageProgress` marks done, active and upcoming.
  - `EvidenceMapStep` shows the failed-status copy and still enables start.
  - An edit then PUT sends the edited map.
  - `IncomingSkillsCard` produces the exact message format.
  - The chat panel in staged mode shows Skip and `StageProgress` and hides `InterviewChecklist`; Finish posts `finish: true`.
  - A classic session renders exactly as before (existing panel tests pass unmodified).
- [ ] **Step 2: Run them.** `pnpm vitest run app/capture`. Expected: FAIL.
- [ ] **Step 3: Implement.** Follow the existing capture page styles (`app/capture` CSS conventions). Copy uses "stage", never "slot". Classic sessions keep today's UI.
- [ ] **Step 4: Run all tests, the type-check and lint.** Expected: PASS.
- [ ] **Step 5: Do a visual check against the scratch DB.** Use a bench/scratch copy, never the live DB (memory: no dev server on live DB). Port per `~/.dev-ports.yaml`. Screenshot the evidence-map step, a stage 2 turn and the stage 4 card at desktop and phone widths, and attach them to the ledger.
- [ ] **Step 6: Commit**, with a STATE.md env-var line for `INTERVIEW_STAGED_DEFAULT` (default off) and `INTERVIEW_BLOOM` (default on).
```bash
git add app/capture/\[code\]/staged app/capture/\[code\]/page.tsx app/capture/\[code\]/CaptureClient.tsx app/capture/\[code\]/CaptureChatPanel.tsx app/api/capture/\[code\]/conversation/route.ts docs/STATE.md
git commit -m "feat(capture): staged interview UI (evidence map, stage bar, incoming-skills card, skip, finish)"
```

### Task 9: Whole-interview benchmark (simulated instructor)

**Files:**
- Create:
  - `scripts/capture/interview-sim.ts`;
  - `scripts/capture/interview-sim-lib.ts` (pure metrics);
  - `scripts/capture/interview-sim-facts.json` (drafted; owner confirms later);
  - `scripts/capture/interview-sim-cases.json`.
- Test: `tests/scripts/capture/interview-sim-lib.test.ts`

**Interfaces:**
- Consumes: `streamStagedInterview` (Task 6), `runPreRead` (Task 5), the scratch DB.
- Produces:
  - **CLI:**
    ```
    pnpm exec tsx --env-file=<main>/.env.local scripts/capture/interview-sim.ts --expect-db gc_curriculum_p2_scratch --interviewer <model[:effort]> --instructor cub --cases <ids|all> [--bloom on|off] [--max-usd N] --out <file>
    ```
    `--max-usd` is required when the interviewer is a paid model; ceiling logic as in `bloom-drift.ts` (`mayCall`). Exit code 3 on a ceiling STOP.
  - **Cases file:** `[{ id, courseCode, sourceSessionId, persona: 'normal'|'terse'|'skipper'|'asks-back'|'yes-sayer' }]`. The five reviewed sessions use persona `normal`, plus four persona variants on GC 4060 and GC 2070.
  - **Facts file:** `{ [courseCode]: Array<{ id: string; fact: string; sourceTurn: number }> }`, with 8–12 facts per course and `"confirmed": false` until the owner confirms.
  - **`interview-sim-lib.ts`:**
    - `repeatCount(questions: string[]): number`, normalized token Jaccard ≥ 0.6 between any two counted questions;
    - `summarize(runs: SimRun[]): { finishedWithin20: number; medianTurns: number; medianReplyMs: number; repeats: number; factRecall15: number; factRecall20: number }`;
    - `SimRun = { caseId; turns: Array<{ question: string; kind: string; replyMs: number }>; factsFoundAt: Record<string, number | null> }`.
  - **Simulated instructor:** it answers each question only from the source transcript's instructor messages plus the course materials, in the persona's style, and says "I don't know" otherwise. Fact recall is judged after each run by a campus model reading the ledger summaries plus the transcript: "is fact X stated? at which turn?".

- [ ] **Step 1: Write the failing tests** for `repeatCount` (identical questions count 1; paraphrases ≥ 0.6 count; different slots count 0) and `summarize` (medians, within-20 share, recall at 15 and 20 with null meaning not found).
- [ ] **Step 2: Run them.** `pnpm vitest run tests/scripts/capture/interview-sim-lib.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the lib and the CLI.** The CLI refuses to run unless the connected DB name equals `--expect-db`. It creates scratch sessions only. Write the cases file.
- [ ] **Step 4: Draft the facts file.** A reviewer subagent (state the model and cost first, per the subagent-model rule) reads the five long transcripts read-only and drafts 8–12 facts per course, the ones the profile depended on, citing the turn. The file stays `confirmed: false`.
- [ ] **Step 5: Run everything on campus models only.** Run `--interviewer cub --instructor cub --cases all --bloom on`, then the same with `--bloom off`. Expected: every case completes or stops at 20; the output JSON has all metrics. These results check the harness only; they are not the gate.
- [ ] **Step 6: Commit.**
```bash
git add scripts/capture/interview-sim* tests/scripts/capture/interview-sim-lib.test.ts
git commit -m "feat(bench): whole-interview benchmark with simulated instructor"
```
- [ ] **Step 7: Stop for the owner.** Two owner steps:
  - confirm the facts file;
  - approve the Terra run, with the per-run estimate from a one-case probe, a cap of about $6, and Bloom on and off.

  **The pass bar (spec):** facts at least 80% by turn 20, zero repeats, at least 90% of runs finishing within 20, median reply under 10 s. Write the results to `docs/superpowers/pilot/` after the run.

### Task 10: STATE.md and handoff

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Add a STATE.md entry.** "Staged interview (spec 2026-11-25-interview-stages-design.md): built on branch, migration 0076 scratch-only, off by default; gate = whole-interview benchmark on Terra (owner approval pending); first pilot = the GC 4060 professor via `?interview=staged`". Under Deferred/debt: option C (Pi full agent session), re-interviewing old courses, removing the classic interview once staged is the default, and every `minor (deferred)` from the final review.
- [ ] **Step 2: Commit.**
```bash
git add docs/STATE.md
git commit -m "docs(state): staged interview built; benchmark gate and pilot pending"
```
- [ ] **Step 3: Stop for the owner.** Merge, push, live migration (with a backup), deploy (guarded chain, interview idle at least 20 min) and the pilot link each need the owner's word.
