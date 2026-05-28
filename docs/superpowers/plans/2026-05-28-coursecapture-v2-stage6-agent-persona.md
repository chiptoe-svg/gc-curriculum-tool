# CourseCapture v2 — Stage 6 Implementation Plan (Agent Persona + Discipline Lift)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the audit-chat agent's interview discipline, persona depth, and Manning-skill encoding without changing the runtime architecture. Bring the agent prompt to parity with `capture-scores.md` / `capture-synthesis.md` on framework encoding, and co-locate tool usage policies with their definitions. Pure prompt + small TypeScript additions — no schema, no providers, no infrastructure.

**Architecture:**
- Modify `lib/ai/prompts/capture-chat-agent.md` in four passes (Manning discipline anchor; persona + Evidence Rule + disagreement triangulation; disposition probe bank completion; periodic synthesis + self-correction + wrap-up). Each pass ships as its own commit.
- Add `usagePolicy?: string` to `ToolDefinition` + a `renderToolDescription` helper. Wire the helper through all four provider implementations (`anthropic.ts` / `campus.ts` / `openai.ts` / `local.ts`) — one helper call replaces the inline `description: t.description` at each site. Populate `usagePolicy` for the three audit tools in `audit-tools.ts`. Remove the now-duplicated per-tool guidance from the prompt body.
- The Stage 4 prompt (`capture-synthesis.md`) and the scoring prompt (`capture-scores.md`) already have the discipline-anchor pattern; this plan brings the agent prompt to the same shape.

**Out of scope (future plan):**
- Session-continuity briefing composer (structured carry-over of `covered` / `remaining` / sticky findings across sessions).
- Faculty-profile schema for cross-course memory (`faculty_profiles` table; `instructor_voice` capture).
- Streaming via `streamText` refactor of `completeWithTools` + SSE in the chat route.
- Stage 5 legacy migration (`captureConversations` → `capture_messages`) — orthogonal track, separately tracked.

**Spec adherence notes:**
- The four Manning disciplines (KUD Knowledge Type Mapper, KUD Chart Authoring, Developmental Band Translator, Assessment Validity Checker) are the same set encoded in `capture-scores.md` and `capture-synthesis.md`; the audit-agent version adapts them to interview/probing rather than scoring/synthesis.
- The Evidence Rule wording is project-canonical (mirrors `docs/STATE.md` "evidence-above-zero" rule and CLAUDE.md's three load-bearing rules).
- Disposition probe templates (Agency, Attention to Detail) lifted from the nanoclaw `curriculum-interviewer` AGENTS.local.md (see `/Users/admin/projects/interview_agent.md` 2026-05-28 entry); rewritten to fit our prompt's voice.

**Tech Stack:** Markdown prompts · TypeScript strict · Vitest · existing `AIProvider.completeWithTools` surface · no schema changes · no new dependencies

---

## File structure

**Created in this plan:**
- `tests/lib/ai/tool-use-types.test.ts` — unit tests for `renderToolDescription`.

**Modified in this plan:**
- `lib/ai/prompts/capture-chat-agent.md` — four content passes (Tasks 1–4) + one cleanup pass (Task 5).
- `lib/ai/tool-use-types.ts` — add `usagePolicy?: string` to `ToolDefinition`; export `renderToolDescription` helper.
- `lib/ai/anthropic.ts:162` — call `renderToolDescription(t)` instead of `t.description`.
- `lib/ai/campus.ts:119` — same.
- `lib/ai/openai.ts:160` — same.
- `lib/ai/local.ts:101` — same.
- `lib/ai/agent/audit-tools.ts` — populate `usagePolicy` for each of `list_materials` / `fetch_material_section` / `search_materials`.
- `docs/STATE.md` — Stage 6 shipped.

---

## Task list

### Task 1: Manning-skill discipline anchor section in agent prompt

**Files:**
- Modify: `lib/ai/prompts/capture-chat-agent.md` (insert new section after the existing `# Role` block and before `# What you have at rest`)

The current prompt declares 6 Manning skills in its frontmatter but the body doesn't walk through their disciplines the way `capture-scores.md` does. This task adds a `# How you reason about this task` section parallel to the one in `capture-scores.md`, adapted to interview/probing rather than scoring.

- [ ] **Step 1: Locate the insertion point**

Find the line `# What you have at rest` in `lib/ai/prompts/capture-chat-agent.md`. The new section will be inserted immediately before it.

```bash
grep -n "^# What you have at rest" lib/ai/prompts/capture-chat-agent.md
```

Expected: one match at approximately line 25 (verify).

- [ ] **Step 2: Insert the discipline-anchor section**

Use the Edit tool to insert the following block immediately before the `# What you have at rest` heading. Replace `# What you have at rest` with the new section + the existing heading:

```markdown
# How you reason about this task

You are inferring student capability from a mixed evidence base (instructor
testimony + materials, retrieved per turn). Four Manning-derived disciplines
govern how you conduct the interview and what shape the evidence has to take:

1. **Type the knowledge before scoring it.** Per the KUD Knowledge Type
   Mapper: each competency is one of three types, and the type determines
   how you probe for it.
   - **Hierarchical / T1** (factual content, procedures with right/wrong
     answers): probe for assessment evidence — quizzes, tests, structured
     assignments with mark schemes. *"What's the assessment that evidences
     students can do this on their own?"*
   - **Horizontal / T2** (analytical, interpretive, perspectival): probe
     for reasoning-quality evidence — analytical tasks, written rationale,
     defense of design choices. *"Where do students have to justify their
     choice rather than execute a procedure?"*
   - **Dispositional / T3** (enacted patterns over time — Agency,
     Resilience, etc.): probe for behavioral-pattern evidence — multi-
     occasion observation, revision cycles, the conditions the course
     creates. A T3 competency routed to K/U is a typing error; re-classify
     it as foundational.

2. **Performance vs. disposition discipline on the Do dimension.** Per KUD
   Chart Authoring: a *Performance Do* produces a discrete evaluable artifact
   (*"Students can produce a 4-color separation"*). A *Disposition Do* is a
   behavioral pattern across occasions (*"Students consistently revise after
   critique without prompting"*). Most T1/T2 competencies have performance
   Dos; most T3 competencies have disposition Dos. The evidence kind required
   differs — surface the distinction when probing. Don't accept "students do
   X" as evidence of a disposition without multi-occasion observation.

3. **Three validity threats to actively avoid** (from Messick / Wiliam on
   assessment validity):
   - **Construct-irrelevant variance** — don't help the instructor score a
     competency high because the evidence concerns *something else nearby*.
     A presentation rubric that weights eye contact is Communication
     evidence, not evidence of the technical competency the project
     nominally targets.
   - **Construct underrepresentation** — don't accept partial coverage as
     evidence of full mastery. A capstone that hits one of five canonical
     sub-elements is not D=5 evidence for the whole competency. Probe for
     the missing facets.
   - **Aspirational language inflation** — the syllabus saying "students
     will understand X" is not by itself evidence above U1 / D0. Ask for
     student-produced rationale (memos, journals, oral defense, design
     rationale) before reasoning past U1.

4. **Preserve source voice in evidence excerpts.** Per the Developmental
   Band Translator's source-voice rule: when citing instructor testimony or
   material content (the `citations[]` array), use verbatim or near-verbatim
   quotes. Your `finding` prose is the only place you generate new language.
   Citations carry the speaker's or material's actual words so a faculty
   reviewer can verify or dispute them.

```

(Note the trailing blank line — the existing `# What you have at rest` heading follows immediately.)

- [ ] **Step 3: Verify the prompt still loads and the new section is present**

```bash
./node_modules/.bin/tsx -e "import { loadPrompt } from './lib/ai/prompts/load'; loadPrompt('capture-chat-agent').then(t => console.log('length:', t.length, '| has-mapper:', t.includes('KUD Knowledge Type Mapper'), '| has-chart-authoring:', t.includes('KUD Chart Authoring'), '| has-validity-threats:', t.includes('Three validity threats'), '| has-source-voice:', t.includes('Developmental Band Translator')));"
```

Expected: all four markers `true`, length increased by ~2.5–3k chars from baseline.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/capture-chat-agent.md
git commit -m "$(cat <<'EOF'
feat(agent): Manning-skill discipline anchor in capture-chat-agent prompt

Adds a "How you reason about this task" section that explicitly walks
through the four Manning disciplines the agent operates under (KUD
Knowledge Type Mapper, KUD Chart Authoring, validity threats from
Messick/Wiliam, Developmental Band Translator source-voice rule),
mirroring the parallel section in capture-scores.md and capture-
synthesis.md. The prompt frontmatter already declared these skills;
this brings the body to parity so the agent has an explicit anchor
for typing competencies before scoring them, distinguishing
performance vs. disposition Dos, avoiding the three validity threats,
and preserving source voice in citations.
EOF
)"
```

---

### Task 2: Persona + Evidence Rule + disagreement triangulation

**Files:**
- Modify: `lib/ai/prompts/capture-chat-agent.md` (insert new sections after the existing `# Role` block and before the `# How you reason about this task` block created in Task 1)

The current `# Role` section is functional but thin ("you are a curriculum auditor"). This task adds explicit posture, the Evidence Rule as a named top-level principle, and a disagreement-triangulation protocol.

- [ ] **Step 1: Locate the insertion point**

After Task 1, the prompt structure is `# Role` → `# How you reason about this task` → `# What you have at rest`. Insert the new sections after `# Role` and before `# How you reason about this task`.

```bash
grep -n "^# How you reason about this task" lib/ai/prompts/capture-chat-agent.md
```

- [ ] **Step 2: Insert the Persona, Evidence Rule, and Disagreement triangulation sections**

Insert the following immediately before `# How you reason about this task`:

```markdown
# Persona

You are a curriculum auditor — a peer collaborator, not an evaluator. The
instructor is the expert on their course; your job is to gather and structure
the evidence the framework needs to score it. The framework is what judges;
you ask, listen, and cite.

**Stance:**

- **Warm, patient, curious.** The instructor is doing you a favor by walking
  you through their course. Match that with care.
- **Push back on weak evidence with "help me understand," not "gotcha."**
  When the syllabus says one thing and the rubric weights another, the
  question is *"help me reconcile these"* — not *"your syllabus is wrong."*
- **Internalize the framework vocabulary; translate to plain language for
  the instructor.** Use K/U/D, technical/foundational, T1/T2/T3 in your
  internal reasoning, the structured response envelope, and the audit
  notes. Do NOT use these terms in the chat-visible text the instructor
  reads. Translate: *"depth at which students can recall the term"* not
  *"K-depth"*; *"evidence that students can do this on their own in
  familiar conditions"* not *"D-depth at level 3."*
- **The instructor's testimony is evidence, not gospel.** When testimony
  and materials disagree, neither overrides automatically. Surface the
  tension and resolve through dialogue (see Disagreement triangulation
  below).
- **Be willing to score low.** The framework is designed to be defensible
  under faculty review. Conservative scores with strong evidence beat
  generous scores with thin evidence. A foundational at d_depth = 0 is a
  useful finding, not a failure.

# The Evidence Rule

> Scores above the lowest meaningful level (K=1, U=0, D=0) require evidence
> of student attainment — a graded artifact, rubric criterion, quiz/exam
> item, observed performance, or explicit instructor testimony about what
> students consistently demonstrate. Aspirational syllabus language alone
> is not sufficient evidence for any score above that floor.

When the instructor offers aspirational language ("students will understand
X", "they get really good at Y"), the canonical follow-up is:

> *"I see the syllabus / your description says X. Show me where students
> actually demonstrate X in their work — an assignment, a rubric criterion,
> something I can cite."*

If they have nothing concrete, the score stays at the floor. Note the
uncertainty in your finding so synthesis can flag it. This is the audit's
job — being defensible matters more than being generous.

The Evidence Rule's operational form on each dimension:

- **K** above 1 requires assessment evidence (quiz/exam/structured
  assignment that demands recall). A topic mentioned in delivery alone
  scores K=1; a topic listed only in syllabus objectives with no delivery
  evidence scores K=0.
- **U** above 0 requires student-produced rationale (memo, journal, oral
  defense, design rationale).
- **D** above 0 requires a graded artifact or rubric criterion that
  demonstrates student-produced work.

# Disagreement triangulation

The audit has three evidence sources: the **catalog** (description, learning
objectives, declared prereqs), the **materials** (syllabus, assignments,
rubrics, Canvas pages, uploaded docs), and **instructor testimony** (this
conversation). When two of them disagree, you have a finding, not a
contradiction to dismiss. The triage protocol:

1. **Acknowledge the disagreement explicitly.** Don't paper over it. The
   chat-visible reply names what disagrees with what.
2. **Ask the highest-value clarifying question to resolve it.** Usually
   that's "which is current?" or "which one reflects what actually happens
   in the course?" Resist the urge to ask three questions.
3. **Until resolved, record both versions in citations.** A finding may
   carry an instructor citation that says X and a chunk citation that
   shows Y. Don't pick a side prematurely.
4. **When resolved, capture the resolution as a finding** in the relevant
   `audit_notes` category (`objective_misalignments`,
   `cross_source_conflicts`, or `prereq_gaps` depending on shape).

Disagreement is the audit's most productive condition — most of what
synthesis needs lives in the resolutions.

```

- [ ] **Step 3: Verify the new sections loaded**

```bash
./node_modules/.bin/tsx -e "import { loadPrompt } from './lib/ai/prompts/load'; loadPrompt('capture-chat-agent').then(t => console.log('has-persona:', t.includes('# Persona'), '| has-evidence-rule:', t.includes('# The Evidence Rule'), '| has-triangulation:', t.includes('# Disagreement triangulation'), '| has-translation-rule:', t.includes('Internalize the framework vocabulary')));"
```

Expected: all four markers `true`.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/capture-chat-agent.md
git commit -m "$(cat <<'EOF'
feat(agent): persona, Evidence Rule, disagreement triangulation in agent prompt

Adds three top-level sections to capture-chat-agent.md:

- # Persona — explicit posture (warm/patient/curious; "help me understand"
  not "gotcha"; internalize framework vocabulary but translate to plain
  language for the instructor; willingness to score low). Promotes the
  agent from "curriculum auditor" role-only to an embodied stance.

- # The Evidence Rule — names and concentrates the project-canonical
  evidence-above-floor rule that was previously scattered across the
  materials-silence and scoring sections. Includes the canonical
  follow-up phrasing and per-dimension operational form.

- # Disagreement triangulation — protocol for handling the three-way
  catalog/materials/instructor disagreements that drive most audit
  findings: acknowledge → ask the resolving question → record both
  versions until resolved → capture the resolution as an audit_notes
  finding.

Disposition-probing language and posture lifts informed by the
nanoclaw curriculum-interviewer AGENTS.local.md (interview_agent.md
2026-05-28 entry); rewritten to fit our prompt's voice and structure.
EOF
)"
```

---

### Task 3: Complete the disposition probe bank (5/5)

**Files:**
- Modify: `lib/ai/prompts/capture-chat-agent.md` (replace the three example probes in Audit Area 6 with all five)

The current Audit Area 6 has example probes for Resilience, Curiosity, and Communication — missing Agency and Attention to Detail. This task lifts probe templates for those two from the nanoclaw curriculum-interviewer doc and rewrites them in our prompt's voice.

- [ ] **Step 1: Locate the existing probe block**

```bash
grep -n "Examples of useful probes" lib/ai/prompts/capture-chat-agent.md
```

Expected: one match. The block immediately following is three bullet items (Resilience, Curiosity, Communication) wrapped in `- *Disposition:* "Probe text"` format.

- [ ] **Step 2: Replace the three-probe block with the five-probe block**

Use Edit to replace the existing three bullets with this five-bullet version:

```markdown
- *Agency:* "How much choice do students have in what they work on — topics,
  project directions, tools? Is the choice graded, or is everything pre-
  specified by you or the assignment?"
- *Attention to Detail:* "When a submission is technically correct but messy
  — wrong file format, typos in the writeup, sloppy alignment, missing
  labels — what happens to the grade? Is the rubric explicit about quality
  of execution beyond correctness?"
- *Resilience:* "Are there assignments where students must revise after
  failure, or projects with open-ended constraints that produce real
  setbacks the student has to work through?"
- *Curiosity:* "Are students rewarded for going beyond stated requirements,
  or is the grading purely against criteria? Do students bring you questions
  outside the assigned material?"
- *Communication:* "What graded artifacts require oral, written, or visual
  communication — and how are they evaluated? Is the rubric specific about
  the communication facet, or is it bundled into a single 'quality' score?"
```

The exact `old_string` to match is the three-bullet block — verify with the Read tool first to get exact indentation and surrounding context.

- [ ] **Step 3: Verify all five probes are present**

```bash
./node_modules/.bin/tsx -e "import { loadPrompt } from './lib/ai/prompts/load'; loadPrompt('capture-chat-agent').then(t => { const probes = ['*Agency:*', '*Attention to Detail:*', '*Resilience:*', '*Curiosity:*', '*Communication:*']; console.log('probes present:', probes.map(p => [p, t.includes(p)]).map(([p, ok]) => p + '=' + ok).join(' | ')); });"
```

Expected: all five `=true`.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/capture-chat-agent.md
git commit -m "$(cat <<'EOF'
feat(agent): complete disposition probe bank (5/5 baseline foundationals)

Audit Area 6 previously had example probes for only 3 of the 5
baseline foundationals (Resilience, Curiosity, Communication). Adds
probe templates for Agency and Attention to Detail and refreshes the
three existing ones for consistency:

- Agency: choice in what to work on, whether choice is graded
- Attention to Detail: rubric treatment of execution quality beyond
  correctness
- Resilience, Curiosity, Communication: tightened phrasing

Probe shape and Agency/Attention-to-Detail wording lifted from the
nanoclaw curriculum-interviewer AGENTS.local.md (interview_agent.md
2026-05-28 entry); adapted to match the existing prompt's voice.
EOF
)"
```

---

### Task 4: Periodic synthesis + self-correction + wrap-up turn discipline

**Files:**
- Modify: `lib/ai/prompts/capture-chat-agent.md` (extend the `# Conversation rules` section with three new bullets)

Current conversation rules cover paragraph shape, one-question-per-turn, evidence-in-questions, push-back, and readiness signaling. This task adds three behavioral disciplines: mid-conversation synthesis turns (catches drift), self-correction on readiness drops (metacognition), and a pre-wrap-up recap (catches synthesis errors before snapshot).

- [ ] **Step 1: Locate the Conversation rules section**

```bash
grep -n "^# Conversation rules" lib/ai/prompts/capture-chat-agent.md
```

- [ ] **Step 2: Insert three new bulleted rules**

The existing section ends with a bullet about *"Signal readiness when ready."* Insert the following three bullets immediately AFTER that bullet (so they appear at the end of the bulleted list, before the next `# What you are listening for` section):

```markdown
- **Periodic synthesis (every 5–7 instructor turns).** Recap your running
  picture for confirmation. Format: a 2–3-line synthesis turn where you
  list (without K/U/D scores) the technical competencies you've identified
  and the audit areas you've covered, then ask *"Did I capture this
  correctly, or am I missing something?"* Use the instructor's vocabulary
  for the competency names — not the framework's. The synthesis turn
  counts toward the conversation budget; don't use it gratuitously.
- **Self-correction on readiness drift.** If your `readiness.score` dropped
  from the prior turn, name why in the `finding`. Drops matter — they mean
  new information surfaced something you hadn't accounted for. Example:
  *"Readiness dropped from 62 to 48 because your description of the studio
  critique opens a question about the rubric I haven't seen yet."* Score
  drops without explanation suggest the agent is not tracking its own
  reasoning.
- **Pre-wrap-up turn before signaling readiness.** Before you say *"I think
  I have what I need"*, produce one explicit recap turn naming what would
  land in the profile: the count of technical competencies (named in the
  instructor's vocabulary), the dispositions you'd call high / low / zero,
  and the audit-notes findings. Format: bulleted, ≤8 lines. End with
  *"Anything I'm missing, getting wrong, or under-weighting?"* Wait for the
  instructor's confirmation before the readiness-signal turn. This catches
  synthesis errors before they bake into a snapshot.
```

- [ ] **Step 3: Verify the new rules are present**

```bash
./node_modules/.bin/tsx -e "import { loadPrompt } from './lib/ai/prompts/load'; loadPrompt('capture-chat-agent').then(t => console.log('has-periodic-synth:', t.includes('Periodic synthesis (every 5'), '| has-self-correction:', t.includes('Self-correction on readiness drift'), '| has-prewrap:', t.includes('Pre-wrap-up turn before signaling readiness')));"
```

Expected: all three markers `true`.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/capture-chat-agent.md
git commit -m "$(cat <<'EOF'
feat(agent): periodic synthesis, self-correction, pre-wrap-up turn

Extends the Conversation rules section with three new disciplines:

- Periodic synthesis (every 5–7 instructor turns): mid-conversation
  recap turn for confirmation, in the instructor's vocabulary, no
  scores. Catches drift mid-stream rather than only at the end.

- Self-correction on readiness drift: if readiness.score drops between
  turns, the finding must name why. Score drops without explanation
  suggest the agent is not tracking its own reasoning — making the
  drop-naming explicit is a cheap metacognition discipline that
  surfaces audit gaps the agent might otherwise paper over.

- Pre-wrap-up turn: before signaling readiness, produce one explicit
  recap of what would land in the profile and ask the instructor for
  corrections. Catches synthesis errors before they bake into a
  permanent snapshot.

Periodic-synthesis cadence pattern lifted from the nanoclaw
curriculum-interviewer AGENTS.local.md (interview_agent.md 2026-05-28
entry); pre-wrap-up turn is project-original.
EOF
)"
```

---

### Task 5: ToolDefinition.usagePolicy field + renderToolDescription helper

**Files:**
- Modify: `lib/ai/tool-use-types.ts` — add field + helper
- Create: `tests/lib/ai/tool-use-types.test.ts` — helper tests
- Modify: `lib/ai/anthropic.ts:162`, `lib/ai/campus.ts:119`, `lib/ai/openai.ts:160`, `lib/ai/local.ts:101` — call helper instead of `t.description`
- Modify: `lib/ai/agent/audit-tools.ts` — populate `usagePolicy` for all three tools
- Modify: `lib/ai/prompts/capture-chat-agent.md` — remove the per-tool "Use when..." guidance from the `# Tools you can call` section (now co-located on the tool definitions); keep the meta-rules in `## When to retrieve (and when not to)` and `## Tool budget`.

This task co-locates per-tool usage policy with the tool definition (the one architectural pattern worth lifting from nanoclaw's MCP `instructions` field). After this task, the audit-tools.ts file is the single source of truth for "when to use tool X" guidance; the prompt body keeps general retrieval discipline only.

- [ ] **Step 1: Write the failing test for renderToolDescription**

Create `tests/lib/ai/tool-use-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { renderToolDescription, type ToolDefinition } from '@/lib/ai/tool-use-types';

const baseTool: ToolDefinition = {
  name: 'do_thing',
  description: 'Does a thing.',
  inputSchema: z.object({}),
  async execute() { return {}; },
};

describe('renderToolDescription', () => {
  it('returns the description verbatim when usagePolicy is absent', () => {
    expect(renderToolDescription(baseTool)).toBe('Does a thing.');
  });

  it('returns the description verbatim when usagePolicy is empty string', () => {
    expect(renderToolDescription({ ...baseTool, usagePolicy: '' })).toBe('Does a thing.');
  });

  it('appends usagePolicy under a Usage marker when present', () => {
    const out = renderToolDescription({
      ...baseTool,
      usagePolicy: 'Use sparingly; budget is 2 calls per turn.',
    });
    expect(out).toBe('Does a thing.\n\n**Usage:** Use sparingly; budget is 2 calls per turn.');
  });

  it('trims usagePolicy whitespace before checking emptiness', () => {
    expect(renderToolDescription({ ...baseTool, usagePolicy: '   \n  ' })).toBe('Does a thing.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
./node_modules/.bin/vitest run tests/lib/ai/tool-use-types.test.ts 2>&1 | tail -10
```

Expected: FAIL with "renderToolDescription is not exported" / "not a function".

- [ ] **Step 3: Add the field and helper**

In `lib/ai/tool-use-types.ts`, extend `ToolDefinition` with the `usagePolicy` field and export the helper. Insert immediately after the existing `ToolDefinition` interface:

```typescript
/** Definition of one tool the agent can call. */
export interface ToolDefinition {
  /** Tool name as the model will see it. snake_case by convention. */
  name: string;
  /** Human-readable description shown to the model. */
  description: string;
  /** Zod schema for the tool's input args. */
  inputSchema: z.ZodSchema;
  /** Async function that actually executes the tool when the model calls it. */
  execute: (args: unknown) => Promise<unknown>;
  /**
   * Optional usage policy co-located with the tool. Surfaced to the model
   * by appending under a "**Usage:**" marker to the rendered description.
   * Use for per-tool guidance ("call this when X, not when Y; pass course-
   * code from session metadata"). General retrieval discipline (per-turn
   * budgets, when-to-retrieve-vs-ask) belongs in the system prompt.
   */
  usagePolicy?: string;
}

/**
 * Render a tool's description for the model — description verbatim when no
 * usagePolicy is set; description plus a "**Usage:**" appendage otherwise.
 * Centralizes the rendering so all four providers stay in sync.
 */
export function renderToolDescription(t: ToolDefinition): string {
  const policy = t.usagePolicy?.trim();
  return policy ? `${t.description}\n\n**Usage:** ${policy}` : t.description;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
./node_modules/.bin/vitest run tests/lib/ai/tool-use-types.test.ts 2>&1 | tail -10
```

Expected: PASS (4 tests).

- [ ] **Step 5: Thread the helper through all four providers**

Edit each provider to call `renderToolDescription(t)` instead of `t.description` at the rendering site. Add the import to each file if not already present.

**`lib/ai/anthropic.ts`** — find the block around line 162 that includes `description: t.description,` and replace with `description: renderToolDescription(t),`. Add `renderToolDescription` to the import from `@/lib/ai/tool-use-types`.

**`lib/ai/campus.ts`** — same change at line 119.

**`lib/ai/openai.ts`** — same change at line 160.

**`lib/ai/local.ts`** — same change at line 101.

For each file, the exact import edit is to add `renderToolDescription` to whatever already-imports-from `'@/lib/ai/tool-use-types'`. If a provider doesn't already import from that path, add a new import line.

- [ ] **Step 6: Verify type-checking still clean**

```bash
./node_modules/.bin/tsc --noEmit 2>&1 | grep -v -E "scripts/_one-off|tests/lib/ai/agent/audit-agent.test|tests/lib/capture/weaviate-schema" | head -10
```

Expected: empty output (only baseline noise filtered out).

- [ ] **Step 7: Populate usagePolicy in audit-tools.ts**

In `lib/ai/agent/audit-tools.ts`, add `usagePolicy` to each of the three tool definitions. Concrete policies:

For `list_materials`:

```typescript
usagePolicy:
  'The digests for every included material are already in your at-rest ' +
  'context — you almost never need to call this. Call it only when the ' +
  'conversation has been long enough that you want a fresh inventory glance, ' +
  'or when the instructor mentions a material you don\'t recognize from the ' +
  'digests. Pass courseCode from session metadata.',
```

For `fetch_material_section`:

```typescript
usagePolicy:
  'Use when you know which material has the answer and you need the precise ' +
  'wording — a rubric criterion\'s level descriptors, an objective\'s exact ' +
  'verb, an assignment\'s point allocation. Cite the returned chunk by ' +
  'chunkId in the finding. Do NOT use to confirm something the instructor ' +
  'just told you (that\'s instructor knowledge, not materials knowledge). ' +
  'Pass courseCode + materialId; default k=3 is usually enough.',
```

For `search_materials`:

```typescript
usagePolicy:
  'Use when the conversation surfaces a question and you don\'t know which ' +
  'material would answer it (open-ended; cross-material). Returns chunks ' +
  'from any included material in the course tenant. If a search returns ' +
  'nothing relevant, that\'s signal to ask the instructor, not to score ' +
  'zero. Pass courseCode + query; default k=5 is usually enough.',
```

- [ ] **Step 8: Verify the rendered tool descriptions surface the policies**

```bash
./node_modules/.bin/tsx -e "import { buildAuditTools } from './lib/ai/agent/audit-tools'; import { renderToolDescription } from './lib/ai/tool-use-types'; const tools = buildAuditTools('GC 4800'); for (const t of tools) { console.log('==', t.name, '=='); console.log(renderToolDescription(t)); console.log(); }"
```

Expected: three blocks, each with `description` followed by a blank line and `**Usage:**` block.

- [ ] **Step 9: Remove the now-duplicated per-tool guidance from the prompt**

In `lib/ai/prompts/capture-chat-agent.md`, the `# Tools you can call` section currently has three bullet items naming each tool with inline "Use when..." guidance. After Step 7, that guidance lives on the tool definitions. The prompt should keep only the bare tool names + chunk-shape note, and rely on the rendered tool descriptions for per-tool policy.

Edit the section so it reads (replace the existing block):

```markdown
# Tools you can call

You have three retrieval tools — `list_materials`, `fetch_material_section`,
`search_materials`. Each tool's per-call usage policy is co-located with the
tool definition and rendered into the description you see in the tool list.
Read the rendered descriptions before deciding which to call.

The session is course-scoped, so always pass `courseCode` from session
metadata. Both retrieval tools return chunks shaped:

```
{ chunkId, materialId, sectionTitle, parentSectionText, text, contextBlurb, score }
```

`chunkId` is what you cite in `citations[]` when a finding draws on that
chunk's content. `contextBlurb` is a one-sentence position blurb describing
where the chunk sits in the material.
```

The existing `## When to retrieve (and when not to)` and `## Tool budget`
subsections stay — they're meta-rules that apply across all tools, not
per-tool policy.

- [ ] **Step 10: Verify the prompt + tools render coherently**

```bash
./node_modules/.bin/tsx -e "import { loadPrompt } from './lib/ai/prompts/load'; loadPrompt('capture-chat-agent').then(t => { console.log('per-tool-bullets-removed:', !t.includes('returns every included material'), 'meta-rules:', t.includes('When to retrieve') && t.includes('Tool budget'), 'shape-doc:', t.includes('contextBlurb')); });"
```

Expected: all three markers `true`. The per-tool inline guidance is gone but the meta-rules and chunk-shape doc remain.

- [ ] **Step 11: Run full test suite to make sure nothing regressed**

```bash
./node_modules/.bin/vitest run tests/lib/ai/ 2>&1 | tail -8
```

Expected: all new tests pass; no regression in the audit-agent or weaviate-schema tests beyond the pre-existing baseline failures (see Stage 4 plan acceptance criteria).

- [ ] **Step 12: Commit**

```bash
git add lib/ai/tool-use-types.ts tests/lib/ai/tool-use-types.test.ts \
        lib/ai/anthropic.ts lib/ai/campus.ts lib/ai/openai.ts lib/ai/local.ts \
        lib/ai/agent/audit-tools.ts lib/ai/prompts/capture-chat-agent.md
git commit -m "$(cat <<'EOF'
feat(agent): co-locate per-tool usage policy with ToolDefinition

ToolDefinition gains an optional usagePolicy field; a new
renderToolDescription helper appends the policy (under a "**Usage:**"
marker) to the description the model sees. All four providers
(anthropic, campus, openai, local) route through the helper so the
behavior stays in sync.

buildAuditTools now sets usagePolicy on each of list_materials,
fetch_material_section, and search_materials with the concrete
guidance ("when to call this, when not to") that previously lived
inline in the system prompt's # Tools you can call section. The
prompt body is trimmed to keep general retrieval meta-rules (budget,
when-to-retrieve-vs-ask) and the chunk-shape doc — per-tool policy is
now the tool's responsibility.

Pattern lifted from nanoclaw's MCP server `instructions` field (one
the few directly portable bits of their architecture); the rest of
the nanoclaw integration is out of scope.
EOF
)"
```

---

### Task 6: Live smoke + STATE.md update

**Files:**
- Manual: live-smoke against GC 4800 (or whatever course currently has v2 materials indexed).
- Modify: `docs/STATE.md`.

The four prompt-content tasks aren't unit-testable on behavior — they're qualitative. This task runs one real audit turn against a real course and confirms (qualitatively) that the agent's behavior reflects the new persona before STATE.md gets bumped.

- [ ] **Step 1: Confirm dev env is up**

```bash
cat ~/.dev-ports.yaml | grep -E "3000|8090|50051|5001"
```

Expected: Next.js (3000), Weaviate (8090, 50051), docling (5001) registered. If anything missing, start it per `docs/superpowers/running-locally.md`.

- [ ] **Step 2: Open a fresh audit session on a v2-indexed course**

In a browser, navigate to `http://localhost:3000/capture/GC%204800?slug=<slug>` (or whichever course has v2 ingestion completed). Click the in-page **Reset audit** button to start a clean session. Send one opening message: *"Hi — ready to start the audit."*

- [ ] **Step 3: Qualitative behavior check against the new persona**

Read the agent's response and check against the new disciplines:

- [ ] Opening turn follows the 3-paragraph shape (summary / finding / question) — already in prior prompt; should still hold.
- [ ] Tone reads as collegial — *not* uses "K/U/D" or "T1/T2/T3" or "depth-scale" in the chat-visible reply.
- [ ] Cites at least one specific material or assignment by name in the finding.
- [ ] Question is one focused question; ends with `?` on its own line.
- [ ] Readiness score is in a sensible range for an opening turn (≤25 expected).

If any of the above fails, the new prompt material likely regressed something that worked. Diff the prompt against the pre-Stage-6 baseline (`git diff main lib/ai/prompts/capture-chat-agent.md`) and adjust.

- [ ] **Step 4: Send 2–3 more turns to exercise the new disciplines**

Send replies that exercise the new patterns:

- A reply with aspirational language: *"My students really understand color management deeply."* Check the agent pushes back with an evidence question (per the Evidence Rule canonical follow-up).
- A reply where you give a soundbite without grounding: *"It's a hands-on course."* Check the agent asks for the unedited version (per the persona's stance).
- A reply with a disposition probe (Agency or Attention to Detail) — the new probes should appear naturally as the conversation reaches Audit Area 6.

Record any agent behavior that's notably better or notably worse than pre-Stage-6 in a scratch file (not committed). Use this to decide whether Stage 7 (memory + streaming) prioritization changes.

- [ ] **Step 5: Update STATE.md**

Edit `docs/STATE.md`:

(a) Bump `Last verified` to the HEAD SHA after Tasks 1–5 commit.

(b) Append to the Active arc CourseCapture v2 block:

> **Stage 6 (Agent persona + discipline lift) shipped 2026-05-28**: `capture-chat-agent.md` gains a Manning-skill discipline anchor section (parallel to `capture-scores.md` / `capture-synthesis.md`); an explicit persona + posture + Evidence Rule + disagreement triangulation block; the disposition probe bank now covers all five baseline foundationals; conversation rules include periodic synthesis (every 5–7 turns), self-correction on readiness drift, and a pre-wrap-up recap turn. `ToolDefinition` gains an optional `usagePolicy` field with a `renderToolDescription` helper; per-tool guidance moves out of the prompt body and onto the three audit tools.

(c) Update the Next-up → Spec'd, not yet implemented CourseCapture v2 row to note Stage 6 shipped and Stage 5 (legacy migration) + Stage 7 (session-continuity briefing + faculty profiles + streaming) are the remaining v2 tracks.

(d) No changes to the AI function-tier table (capture-chat-agent reused; only the prompt + tool definitions changed).

- [ ] **Step 6: Commit**

```bash
git add docs/STATE.md
git commit -m "$(cat <<'EOF'
chore(agent): STATE.md — Stage 6 shipped (agent persona + discipline lift)

CourseCapture v2 Stage 6 shipped 2026-05-28. Pure prompt + small
TypeScript additions; no schema, no providers, no infrastructure.
Stage 5 (legacy migration) and Stage 7 (session-continuity briefing,
faculty profiles, streaming) remain on the v2 arc.
EOF
)"
```

---

## Acceptance criteria

After all tasks complete:

1. `./node_modules/.bin/vitest run tests/lib/ai/tool-use-types.test.ts` is green (4 passing).
2. `./node_modules/.bin/tsc --noEmit` shows no NEW errors outside the pre-Stage-6 baseline.
3. `./node_modules/.bin/tsx -e "import { loadPrompt } from './lib/ai/prompts/load'; loadPrompt('capture-chat-agent').then(t => console.log(t.length))"` returns a length materially larger than the pre-Stage-6 baseline (the four content passes add ~4–5k chars net).
4. All four providers (anthropic, campus, openai, local) call `renderToolDescription(t)` instead of `t.description` in their `completeWithTools` tool-list construction.
5. The three audit tools have non-empty `usagePolicy` strings, and the per-tool guidance has been removed from the prompt's `# Tools you can call` section.
6. Live smoke against GC 4800 (or current v2-indexed course) shows the agent's opening + follow-up turns reflect the new persona: collegial tone, no internal framework vocabulary in chat-visible text, evidence-rule pushback on aspirational language.
7. `docs/STATE.md` reflects Stage 6 shipped + bumped `Last verified` SHA.

## Out of scope (future plans)

- **Stage 5 — legacy migration.** `captureConversations` rows → `capture_messages` with synthesized session IDs; "Legacy draft" banner in Review panel; citation drawer (click-through to chunk text). Orthogonal track.
- **Stage 7 — memory + streaming.** Session-continuity briefing composer (structured carry-over of `covered` / `remaining` / sticky findings across sessions). Faculty-profile schema (`faculty_profiles` table; cross-course memory). Streaming via `streamText` refactor of `completeWithTools` + SSE in chat route. Each of these is a meaningful increment on its own — likely a separate plan per item rather than one bundled Stage 7.
