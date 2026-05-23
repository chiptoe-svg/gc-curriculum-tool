# CourseCapture Prototype — Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement task-by-task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Stand up a self-contained CourseCapture page at `/capture/[code]` that loads everything the system already has for a course (catalog row, syllabus, Canvas import, uploaded materials, current profile) and lets the instructor talk through the AI's audit findings to produce a **Course Outcome Profile** — a self-contained, evidence-backed picture of what the course actually does, with K/U/D depth on discovered competencies per the [2026-05-23 KUD Depth Scales spec](../specs/2026-05-23-kud-depth-scales-design.md). No career-target scoring in this flow; targets are a downstream alignment problem and are still being refined. First validation target is GC 3460.

**Architecture (Phase 1, this plan):** Self-standing top-level page `/capture/[code]?slug=…` outside the existing `/preview/[slug]/courses/[code]` shell. Client owns the message history; each turn POSTs the full history plus the loaded course context to a stateless chat endpoint that calls OpenAI with a rich system prompt. The AI **discovers** technical competencies from the materials and **always scores** five baseline foundational competencies (Agency, Attention to Detail, Resilience, Curiosity, Communication) — and may add more foundationals if the materials evidence them. When the instructor clicks **Generate ratings**, a second endpoint takes the transcript and emits a single structured profile JSON. Voice input is captured in the browser and transcribed via OpenAI Whisper before being inserted into the chat input. Conversation is ephemeral (no DB persistence).

**Architecture (Phase 2, out of scope):** Chat endpoint swapped to a nanoclaw agent with tools (search materials, look up other courses' profiles, retrieve prereq courses). Conversation persistence. Cross-course rollups.

**Tech stack:** Next.js 15 App Router, OpenAI provider (existing), OpenAI Whisper for voice transcription, Drizzle/Neon, Zod, React `useState`. Reuses `loadPrompt`, slug-gated auth pattern, IP rate-limit middleware, and the multi-turn chat scaffolding already shipped in `kud-chat.ts` and its route.

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lib/db/migrations/00xx_course_capture_profiles.sql` | New table |
| Create | `lib/db/schema/course-capture-profiles.ts` | Drizzle schema |
| Modify | `lib/db/schema/index.ts` | Export the new schema |
| Create | `lib/db/course-capture-profiles-queries.ts` | Read/write helpers |
| Create | `lib/ai/prompts/shared/depth-scale.md` | K/U/D 0–5 anchors + dimension applicability rule |
| Create | `lib/ai/prompts/capture-chat.md` | System prompt for the audit conversation |
| Create | `lib/ai/prompts/capture-scores.md` | System prompt for the final structured-output call |
| Modify | `lib/ai/prompts/load.ts` | Register `'capture-chat'`, `'capture-scores'` |
| Create | `lib/ai/analyze/capture-chat.ts` | Multi-turn chat helper |
| Create | `lib/ai/analyze/capture-scores.ts` | Structured-output call → profile JSON |
| Create | `lib/ai/transcribe.ts` | Whisper wrapper for audio → text |
| Create | `app/api/capture/[code]/context/route.ts` | Bundle course + materials for the page |
| Create | `app/api/capture/[code]/chat/route.ts` | Stateless chat turn |
| Create | `app/api/capture/[code]/scores/route.ts` | Generate + persist profile |
| Create | `app/api/transcribe/route.ts` | Audio blob → transcript |
| Create | `app/capture/[code]/page.tsx` | The standalone CourseCapture page |
| Create | `app/capture/[code]/CaptureChatPanel.tsx` | Chat UI with voice input |
| Create | `app/capture/[code]/ProfileReviewPanel.tsx` | Review/edit the AI's profile |
| Create | `components/VoiceRecorder.tsx` | Reusable record button + MediaRecorder hook |

---

## Goals

1. Pull *everything* the system already has about GC 3460 — catalog row, syllabus text, Canvas-imported syllabus/assignments/modules, uploaded materials, current profile, current prereq list — into one page with zero re-ingestion required.
2. Run a conversational audit that:
   - Cross-checks stated **prerequisite competencies** against what assignments actually require, and surfaces gaps.
   - Cross-checks **stated learning objectives** against what the materials evidence — both directions: are the objectives being met, and should the objectives be revised to match what the course is actually doing?
   - Surfaces **overlaps and contradictions** across the three material sources (syllabus, Canvas, uploaded materials) — different point values, inconsistent assignment lists, conflicting outcomes language.
   - Probes the instructor for what the materials don't say: rubric logic, threshold concept, what a strong submission vs. a weak one looks like, what gets retaught because students don't actually arrive with the prereqs.
   - On instructor request, **produces a draft revision of the learning objectives** in the conversation, anchored to what the materials evidence.
3. Produce, on instructor command, a **Course Outcome Profile**:
   - 5–15 discovered technical competencies, each scored K/U/D 0–5 with evidence excerpts and short rationale.
   - All five baseline foundational competencies (Agency, Attention to Detail, Resilience, Curiosity, Communication) scored on **D only** (K and U stay null) — including `d_depth = 0` for foundationals the course doesn't develop, which is itself a meaningful signal.
   - The AI may add additional foundational competencies if the materials evidence them and the baseline list doesn't capture them.
   - Audit notes: prereq gaps, objective misalignments, cross-source conflicts, suggested objective revisions, and the revised-objectives draft (if requested).
4. Persist the profile to `course_capture_profiles` as JSONB with `scale_version = 'v1'`, one current row per course.

## Non-goals

- **No career-target scoring** in this flow. The Course Outcome Profile is self-contained; alignment to career targets is a separate downstream tool that consumes the profile.
- **No nanoclaw agent or tools.** Direct OpenAI call.
- **No conversation persistence.** Tab close = restart.
- **No write-back to `courses.learningObjectives`.** The revised-objectives draft is a chat output and a field in the profile JSON; faculty copy/use it as they see fit.
- **No re-ingestion of materials.** Faculty are not asked to upload anything from this page.
- **No 2–3 question rule on the chat.** The AI asks what it needs to ask, in whatever shape it needs, to ground the scoring in evidence.
- **No replacement of the existing Course Builder.** CourseCapture stands alongside it.

---

## Data model

### `course_capture_profiles`

```sql
CREATE TABLE course_capture_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code     text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  profile         jsonb NOT NULL,            -- the full Course Outcome Profile
  reviewer_status text NOT NULL DEFAULT 'ai_drafted',  -- 'ai_drafted' | 'confirmed' | 'edited'
  reviewer_note   text,
  scale_version   text NOT NULL DEFAULT 'v1',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_code, scale_version)
);

CREATE INDEX idx_ccp_course ON course_capture_profiles (course_code);
```

Single JSONB blob keeps the alpha shape flexible. If a particular field becomes a hot query target later, we lift it into a column or a child table without migrating the historical blobs (we just add a back-fill query).

### Profile JSON shape

```jsonc
{
  "course_code": "GC 3460",
  "scale_version": "v1",
  "generated_at": "2026-05-23T...",

  "competencies": [
    {
      "statement": "Students prepare production-ready package artwork",
      "type": "technical",
      "k_depth": 4,
      "u_depth": 3,
      "d_depth": 4,
      "evidence_k": "Assignment 4 rubric criterion 'file standards' — quoted excerpt",
      "evidence_u": "Project memo asks students to justify substrate choice — quoted excerpt",
      "evidence_d": "Final project file submission graded against production rubric — quoted excerpt",
      "rationale": "Short prose explaining why these depths are appropriate."
    },
    {
      "statement": "Students exercise attention to detail",
      "type": "foundational",
      "k_depth": null,
      "u_depth": null,
      "d_depth": 3,
      "evidence_d": "Rubric weights production accuracy at 30% across two graded artifacts.",
      "rationale": "..."
    },
    {
      "statement": "Students exhibit resilience",
      "type": "foundational",
      "k_depth": null,
      "u_depth": null,
      "d_depth": 0,
      "evidence_d": null,
      "rationale": "Materials do not describe revision cycles, productive-failure exercises, or open-ended projects with consequential setbacks. Course does not appear to develop resilience."
    }
    // 5–15 competencies total per course
  ],

  "audit_notes": {
    "prereq_gaps": [
      "Course lists 'Adobe Illustrator basics' as a prereq, but Assignment 1 assumes proficiency with dieline construction not covered in the listed prereq course."
    ],
    "objective_misalignments": [
      "Stated objective 'Students will analyze packaging trends' has no assignment or rubric evidence. Either an assignment is missing from upload, or the objective is aspirational.",
      "Final project teaches print-vendor communication skills not reflected in any stated objective."
    ],
    "cross_source_conflicts": [
      "Syllabus lists 4 major assignments; Canvas shows 5. Syllabus does not mention the 'Mid-term Critique' that appears in Canvas at 15% weight."
    ],
    "suggested_objective_revisions": [
      "Replace 'Students will understand package design' with 'Students will produce production-ready packaging concepts that account for substrate, print process, structural constraints, brand communication, and feasibility.'"
    ]
  },

  "revised_objectives_draft": null  // populated only when the instructor asks for it
}
```

---

## The chat prompt

`lib/ai/prompts/capture-chat.md` is the heart of this feature. Skeleton:

```markdown
---
name: capture-chat
includes:
  - shared/depth-scale.md
---

# Role

You are a curriculum auditor helping a faculty member produce an evidence-backed
Course Outcome Profile for one of their courses. The profile is self-contained:
it describes what the course actually develops in students, with K/U/D depth
ratings on each competency, grounded in the course's materials.

# Inputs you have received

- The course's catalog entry: title, description, current learning objectives,
  current required incoming skills, current major projects list.
- The course's syllabus text (if available).
- Canvas-imported assignment list with point values and descriptions (if available).
- Uploaded material excerpts: rubrics, project briefs, etc. (if uploaded).
- The current AI-generated profile (if one exists from the Course Builder flow).
- The 0–5 depth-scale anchors for Know, Understand, and Do (see depth-scale partial).
- The five baseline foundational competencies you must score in every course:
  Agency, Attention to Detail, Resilience, Curiosity, Communication.

# What you must produce by the end of the conversation

For each competency you identify (technical and foundational):
- A Know depth (0–5) with an evidence excerpt above level 1 (technical only — K/U are null for foundationals).
- An Understand depth (0–5) with an evidence excerpt above level 0 (technical only).
- A Do depth (0–5) with an evidence excerpt above level 0 (or 0 with a rationale for foundationals when no evidence supports them).
- A short rationale per competency.

5–15 technical competencies is the target range. Always score all five baseline
foundationals plus any additional foundational competencies the materials evidence.

You DO NOT emit scores during the chat. Scoring happens when the instructor
clicks "Generate ratings."

# Audit areas (work through these across the conversation)

1. **Prerequisite sufficiency.** Compare the course's required incoming skills
   against what the assignments actually require. Flag mismatches with specifics.
2. **Stated objectives vs. evidenced outcomes (two directions).**
   - For each stated objective, find the material evidence that demonstrates it.
     If an objective has no evidence, surface it.
   - For each major activity in the materials, ask whether the objectives capture
     it. If a big project teaches something not in the objectives, surface it.
3. **Cross-source overlaps and contradictions.** Compare syllabus, Canvas, and
   uploaded materials. Flag different point values, inconsistent assignment
   lists, conflicting outcomes language, and missing items.
4. **Bloom's-level probe per major assignment.** For the highest-stakes
   assignments, ask what students actually do — remembering, understanding,
   applying, analyzing, evaluating, or creating — and what evidence supports
   the classification.
5. **Threshold concept and prior-knowledge reality.** What conceptual shift
   separates students who get it from students who don't? What does the
   instructor routinely re-teach because students don't arrive with it?
6. **Foundational competency conditions.** For each of the five baseline
   foundationals (Agency, Attention to Detail, Resilience, Curiosity,
   Communication), ask what the course does — or doesn't do — to develop it.
   A foundational with d_depth = 0 is a valid and useful result.

# Optional output: revised learning objectives draft

If the instructor asks for a draft revision of the learning objectives, or if
the audit surfaces enough misalignment that proposing a revision is warranted,
produce a draft set of objectives in the conversation, grounded in what the
materials actually evidence. Use Bloom's verbs. Limit to 4–7 objectives.

# Conversation rules

- Open with a brief summary of what you found across the materials, the most
  important 1–3 gaps or contradictions, and your first questions. Lead with
  the gap or mismatch that most affects scoring.
- Cite specific evidence when you ask: "Your rubric for Assignment 4 weights
  'production feasibility' at 40%. Does that include cost estimation, or
  only material/process feasibility?"
- Acknowledge each answer in one sentence before continuing.
- Ask as many questions as you need, in whatever shape you need, to ground
  every above-zero score in evidence. Do not artificially cap the number
  of questions per turn. Quality of result > tidiness of the conversation.
- When you have enough evidence to score every technical competency and to
  make a defensible call on every foundational (including d_depth = 0 for
  foundationals the course doesn't develop), say: "I think I have what I
  need. Click **Generate ratings** when ready, or keep going if there's
  more I should know."
```

The `shared/depth-scale.md` partial holds the K/U/D 0–5 anchors and the rule that foundationals score on D only, copied from the spec doc.

---

## The scoring prompt

`lib/ai/prompts/capture-scores.md` takes the full conversation transcript plus the original course context and emits structured JSON conforming to the Course Outcome Profile shape above. Zod schema:

```ts
const competencySchema = z.object({
  statement: z.string(),
  type: z.enum(['technical', 'foundational']),
  k_depth: z.number().int().min(0).max(5).nullable(),
  u_depth: z.number().int().min(0).max(5).nullable(),
  d_depth: z.number().int().min(0).max(5),
  evidence_k: z.string().nullable(),
  evidence_u: z.string().nullable(),
  evidence_d: z.string().nullable(),  // null only when d_depth = 0 for foundationals
  rationale: z.string(),
}).refine(
  (c) => c.type !== 'foundational' || (c.k_depth === null && c.u_depth === null),
  { message: 'Foundational competencies must have null K and U.' },
).refine(
  (c) => c.d_depth > 0 ? c.evidence_d !== null : true,
  { message: 'Above-zero d_depth requires an evidence excerpt.' },
);

const captureProfileSchema = z.object({
  course_code: z.string(),
  scale_version: z.literal('v1'),
  generated_at: z.string(),
  competencies: z.array(competencySchema),
  audit_notes: z.object({
    prereq_gaps: z.array(z.string()),
    objective_misalignments: z.array(z.string()),
    cross_source_conflicts: z.array(z.string()),
    suggested_objective_revisions: z.array(z.string()),
  }),
  revised_objectives_draft: z.array(z.string()).nullable(),
});
```

The scoring prompt requires that all five baseline foundationals appear in the output (even if d_depth = 0).

---

## Voice input

The chat input includes a record button alongside the text field. Flow:

1. User clicks 🎤 Record. `MediaRecorder` starts capturing audio (webm/opus or mp4/aac depending on browser).
2. User clicks again to stop. Audio blob captured in memory.
3. Frontend POSTs the blob to `/api/transcribe` as `multipart/form-data`.
4. Route calls OpenAI Whisper (`audio.transcriptions.create`, model `whisper-1`) and returns `{ text }`.
5. Transcript is inserted (or appended) into the text input. User can edit, then send normally.

Cap client-side recordings at 5 minutes to keep latency reasonable. Whisper cost is ~$0.006 per minute; the entire feature costs a fraction of a cent per session.

The `VoiceRecorder` component is reusable — same pattern can later be added to the existing KUD chat panel.

---

## Tasks

### Task 1 — Add `course_capture_profiles` schema + queries

**Files:** migration SQL, `lib/db/schema/course-capture-profiles.ts`, `lib/db/schema/index.ts`, `lib/db/course-capture-profiles-queries.ts`.

- [ ] Write the migration SQL per the schema above.
- [ ] Add the Drizzle schema definition.
- [ ] Export from the schema index.
- [ ] Write query helpers: `getCaptureProfileByCourse(courseCode, scaleVersion)`, `upsertCaptureProfile(courseCode, profile, status)`.
- [ ] Run the migration locally and confirm the table exists.
- [ ] Unit-test that upsert round-trips a sample profile blob correctly.
- [ ] Commit: `feat(db): add course_capture_profiles table for v1 Course Outcome Profiles`.

### Task 2 — Context-loading API

**Files:** `app/api/capture/[code]/context/route.ts`.

- [ ] Slug-gate the route, hash IP, run the rate-limit check (mirror existing pattern from `kuds/chat/route.ts`).
- [ ] Load: course row, `course_profiles` row if any, all `course_materials` rows with extractedText, the current `course_capture_profiles` row if any.
- [ ] Return `{ course, profile, materials, existingCaptureProfile }`.
- [ ] Test against GC 3460 — should return everything already in the system without any new ingestion.
- [ ] Commit: `feat(capture): add context API that bundles all course data`.

### Task 3 — Shared depth-scale partial + capture chat prompt

**Files:** `lib/ai/prompts/shared/depth-scale.md`, `lib/ai/prompts/capture-chat.md`, update `lib/ai/prompts/load.ts`.

- [ ] Write `shared/depth-scale.md` with the K/U/D 0–5 anchors, the dimension-applicability rule, and the foundational-competency baseline list, all sourced from the spec doc.
- [ ] Write `capture-chat.md` with the audit areas, conversation rules (no question cap), foundational-coverage requirement, and the optional revised-objectives-draft affordance.
- [ ] Register `'capture-chat'` in `PromptName`.
- [ ] Verify `loadPrompt('capture-chat')` returns the merged text in a quick console test.
- [ ] Commit: `feat(prompt): add capture-chat audit prompt and shared depth-scale partial`.

### Task 4 — Chat helper and route

**Files:** `lib/ai/analyze/capture-chat.ts`, `app/api/capture/[code]/chat/route.ts`.

- [ ] Write `buildCaptureChatUserMessage(context)` that concatenates course profile, syllabus, Canvas assignments (with point-weight summary as `kud-chat.ts` does), uploaded materials, and current profile into one large user message. No token budget enforced — dump full text.
- [ ] Write `captureChatTurn(context, history)` paralleling `kudChatTurn`.
- [ ] Implement the API route: slug check, rate limit, parse `{ messages }` body, call `captureChatTurn`, return `{ reply }`.
- [ ] Unit-test the user-message builder for representative inputs.
- [ ] Integration smoke-test against GC 3460: open conversation, verify the AI opens with audit findings + questions, not a generic greeting.
- [ ] Commit: `feat(capture): chat endpoint for audit conversation`.

### Task 5 — Scoring prompt and structured-output endpoint

**Files:** `lib/ai/prompts/capture-scores.md`, `lib/ai/analyze/capture-scores.ts`, `app/api/capture/[code]/scores/route.ts`.

- [ ] Write `capture-scores.md`, including the depth-scale partial and the requirement that all five baseline foundationals appear in the output (even if d_depth = 0).
- [ ] Define the Zod schema `captureProfileSchema` (matches the shape above) with the refinements that enforce the dimensional-applicability rule and the evidence requirement.
- [ ] Write `generateCaptureProfile(context, transcript)` that calls the provider with structured-output mode and returns the parsed object.
- [ ] Implement the API route: validate body, call the generator, upsert into `course_capture_profiles`, return the profile.
- [ ] Test against GC 3460 — confirm the profile includes 5–15 technical competencies, all five foundationals (some likely d_depth = 0), evidence excerpts where required, and that it persists.
- [ ] Commit: `feat(capture): scoring endpoint produces v1 Course Outcome Profile`.

### Task 6 — Voice input via Whisper

**Files:** `lib/ai/transcribe.ts`, `app/api/transcribe/route.ts`, `components/VoiceRecorder.tsx`.

- [ ] Write `transcribe(audioBuffer, mimeType)` in `lib/ai/transcribe.ts` calling OpenAI `audio.transcriptions.create` with `whisper-1`.
- [ ] Implement the `/api/transcribe` route: accept multipart form data, validate size (5 MB cap = ~5 min audio), call `transcribe`, return `{ text }`.
- [ ] Build the `VoiceRecorder` component: `MediaRecorder` lifecycle, record/stop button, blob state, POST on stop, expose an `onTranscript(text)` callback to consumers.
- [ ] Handle browser permission denials gracefully.
- [ ] Unit-test the route for the happy path and the oversize-file rejection.
- [ ] Commit: `feat(capture): voice input via OpenAI Whisper`.

### Task 7 — Page and UI

**Files:** `app/capture/[code]/page.tsx`, `app/capture/[code]/CaptureChatPanel.tsx`, `app/capture/[code]/ProfileReviewPanel.tsx`.

- [ ] `page.tsx` reads `?slug=…`, validates, fetches `/api/capture/[code]/context`, and renders the layout.
- [ ] Layout: header with course code + title, an opening prompt summarizing what was loaded, a chat panel below, and a "Generate ratings" button activated once the AI signals readiness (or unconditionally after N exchanges — pick at implementation time).
- [ ] `CaptureChatPanel` mirrors the existing KUD chat panel: scrolling message list, input textarea, send button, loading state. Adds the `VoiceRecorder` button alongside the text input. On transcribe success, append the transcript to the textarea (don't auto-send).
- [ ] On "Generate ratings": POST conversation history to `/scores`. Render `ProfileReviewPanel`:
  - One row per technical competency with K, U, D sliders, evidence excerpts under each slider, statement editable inline.
  - One row per foundational with the D slider only (K/U columns visually omitted, not blanked).
  - Audit notes sidebar with the four lists, plus the revised-objectives draft if present.
- [ ] "Confirm" button marks `reviewer_status = 'confirmed'` and persists edits.
- [ ] Apply slug-gated auth/banner styles for consistency without inheriting the full `/preview/[slug]` shell.
- [ ] Test end-to-end against GC 3460.
- [ ] Commit: `feat(capture): self-standing CourseCapture page at /capture/[code]`.

### Task 8 — Smoke test on GC 3460 and capture findings

**Files:** `docs/superpowers/pilot/2026-05-23-gc3460-capture-pilot.md`.

- [ ] Open `/capture/GC%203460?slug=…` in the browser.
- [ ] Run a full conversation, exercising voice input at least once.
- [ ] Click "Generate ratings". Review the profile and the audit notes. Optionally request a revised-objectives draft and capture what the AI produces.
- [ ] Write up findings against the four open questions from the spec:
  1. Does Know plausibly reach 5? Or does it cap at 4?
  2. Does Understand reach 5 in an undergrad course?
  3. Does the AI produce above-D1 scores for foundational competencies, and on what evidence? Do foundationals correctly score 0 when the course doesn't develop them?
  4. Is K1 (exposure) a useful signal or noise?
- [ ] Note any prompt adjustments that improved output quality during the run.
- [ ] Decide which (if any) spec adjustments are needed.
- [ ] Commit: `docs(pilot): GC 3460 CourseCapture v1 findings`.

---

## Acceptance criteria

- `/capture/GC%203460?slug=…` loads with zero new ingestion: catalog + Canvas + uploaded materials + current profile all pre-populated.
- The AI opens the conversation with audit findings (prereq, objective, contradiction) and specific evidence-grounded questions, not a generic greeting.
- The chat ranges as long as it needs to — no artificial question cap.
- Voice input works: clicking record captures audio, stopping transcribes via Whisper, transcript drops into the input field.
- "Generate ratings" produces a complete Course Outcome Profile: 5–15 technical competencies (each above-zero score backed by an evidence excerpt) plus all five baseline foundationals scored on D (with d_depth = 0 valid).
- Foundational competencies have K and U null, never zero.
- Audit notes (prereq gaps, objective misalignments, cross-source conflicts, suggested objective revisions) are visible alongside the scores.
- If the instructor requested a revised-objectives draft, it appears in the chat and is captured in the profile JSON.
- Confirmed profiles persist to `course_capture_profiles` with `scale_version = 'v1'`.
- The page is reachable from a single share-able URL with no dependency on the `/preview/[slug]/courses/[code]` shell.

## Out of scope (Phase 2)

- nanoclaw agent + custom tools (`search_materials`, `get_course_kuds`, `get_prerequisite_courses`).
- Conversation persistence across page reloads.
- Career-target alignment view that consumes the Course Outcome Profile.
- CourseRevise flow that consumes the `suggested_objective_revisions` audit notes and the `revised_objectives_draft`.
- Cross-course rollups (e.g., "which courses develop Resilience above D2?").

## Open issues to resolve during implementation

- **Prompt token budget at GC 3460's volume.** Not capped during testing; if a model rejects on size, log it and decide whether to summarize Canvas assignments or paginate. This isn't a Task 4 concern — handle it if it surfaces.
- **Browser audio format compatibility.** Whisper accepts mp3, mp4, mpeg, mpga, m4a, wav, and webm. The `MediaRecorder` output format depends on browser; Chrome typically produces `audio/webm;codecs=opus`. Confirm the format is acceptable to Whisper end-to-end during Task 6.
- **Whether the revised-objectives draft button is an explicit UI control or only triggered by asking in chat.** Default: chat-only for v1 (the AI proposes a draft when asked or when the audit warrants it). Add a button later if the chat-only path feels too hidden.
