# Signature Projects Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `major_projects` capture pipeline (schema, synthesis prompt, interview agent, wiki prompt) to document deliverables, what each project develops, grade weight, and duration — enabling rich `## Signature projects` sections in wiki pages.

**Architecture:** The `majorProjectItemSchema` Zod schema in `lib/ai/capture/schema.ts` gains four optional fields (`deliverables`, `what_it_develops`, `weight_pct`, `duration_weeks`). The OpenAI strict-mode JSON schema in `lib/ai/analyze/capture-scores.ts` gains the same four fields as required (model always emits them; null allowed for the two numeric ones). Three prompt files are updated in tandem: synthesis gets the new fields in its output spec; the chat agent gets a new Area 9 script; the wiki prompt gets a rich rendering block.

**Tech Stack:** TypeScript strict, Zod, Vitest. All changes are to TypeScript and Markdown prompt files — no migrations, no DB changes, no new routes.

**Spec:** `docs/superpowers/specs/2026-06-16-signature-projects-capture-design.md`

---

## File map

| File | Change |
|---|---|
| `lib/ai/capture/schema.ts` | Add 4 optional fields to `majorProjectItemSchema` |
| `lib/ai/analyze/capture-scores.ts` | Add same 4 fields to `captureProfileJsonSchemaV2` major_projects items |
| `lib/ai/prompts/capture-synthesis.md` | New fields in output JSON example + extraction rules |
| `lib/ai/prompts/capture-chat-agent.md` | New `## 9. Signature projects documentation` area |
| `lib/ai/prompts/wiki-update.md` | Rename §8b to Signature projects + rich format |
| `tests/lib/ai/capture/projects-schema.test.ts` | Tests for new fields (round-trip + backward compat) |
| `tests/lib/ai/capture/projects-json-schema.test.ts` | Strict-mode walker still passes; new fields in required |

---

## Task 1: Extend `majorProjectItemSchema` + OpenAI strict schema

**Files:**
- Modify: `lib/ai/capture/schema.ts:286-299`
- Modify: `lib/ai/analyze/capture-scores.ts:299-317`
- Test: `tests/lib/ai/capture/projects-schema.test.ts`
- Test: `tests/lib/ai/capture/projects-json-schema.test.ts`

- [ ] **Step 1: Write failing Zod schema tests**

Add to the end of `tests/lib/ai/capture/projects-schema.test.ts` (after the last `});`):

```ts
// ---------------------------------------------------------------------------
// majorProjectItemSchema — new fields (2026-06-16)
// ---------------------------------------------------------------------------
describe('majorProjectItemSchema — new fields', () => {
  const baseProject = {
    title: 'Brand Identity Package',
    description: 'Students develop a complete visual identity system for an assigned brand brief.',
    competencies: ['Students manage a production job from brief to output'],
  };

  it('accepts a project with all new fields populated', () => {
    expect(() =>
      majorProjectItemSchema.parse({
        ...baseProject,
        deliverables: ['12-page InDesign brand standards manual', 'business card template'],
        what_it_develops: 'First time students own a production decision from brief to output.',
        weight_pct: 30,
        duration_weeks: 6,
      })
    ).not.toThrow();
  });

  it('accepts a project with weight_pct and duration_weeks as null', () => {
    expect(() =>
      majorProjectItemSchema.parse({
        ...baseProject,
        deliverables: ['press-ready PDF'],
        what_it_develops: 'Develops production-decision ownership.',
        weight_pct: null,
        duration_weeks: null,
      })
    ).not.toThrow();
  });

  it('accepts a legacy project without the new fields (backward compat)', () => {
    expect(() => majorProjectItemSchema.parse(baseProject)).not.toThrow();
  });

  it('rejects deliverables containing an empty string', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...baseProject, deliverables: [''] })
    ).toThrow();
  });

  it('rejects what_it_develops longer than 500 chars', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...baseProject, what_it_develops: 'x'.repeat(501) })
    ).toThrow();
  });

  it('rejects weight_pct above 100', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...baseProject, weight_pct: 101 })
    ).toThrow();
  });

  it('rejects duration_weeks of 0', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...baseProject, duration_weeks: 0 })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```
pnpm vitest run tests/lib/ai/capture/projects-schema.test.ts
```

Expected: failures on the new `describe` block (field not in schema yet).

- [ ] **Step 3: Add 4 new fields to `majorProjectItemSchema` in schema.ts**

In `lib/ai/capture/schema.ts`, replace lines 286–299:

```ts
export const majorProjectItemSchema = z.object({
  /** Short human-readable title, e.g. "Brand Color Report" or "Prepress Packaging Spec". */
  title: z.string().min(1),
  /** 1-3 sentences describing what students produce and what they decide. */
  description: z.string().min(10),
  /**
   * The competency statements this project develops.
   * Must match or paraphrase entries in the profile's `competencies` array.
   * Projects ARE the evidence for K/U/D scores; linking them closes the loop.
   */
  competencies: z.array(z.string().min(1)).min(1),
  /** Concrete list of what students hand in (files, documents, artifacts). Optional on legacy snapshots. */
  deliverables: z.array(z.string().min(1)).optional(),
  /** 1-2 sentences on why this project is formative for students. Optional on legacy snapshots. */
  what_it_develops: z.string().min(1).max(500).optional(),
  /** Portion of course grade (0–100). Null when not determinable from materials. Optional on legacy snapshots. */
  weight_pct: z.number().min(0).max(100).nullable().optional(),
  /** Approximate span in whole weeks. Null when not determinable. Optional on legacy snapshots. */
  duration_weeks: z.number().int().min(1).nullable().optional(),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureProjectItem = z.infer<typeof majorProjectItemSchema>;
```

- [ ] **Step 4: Run Zod schema tests — expect pass**

```
pnpm vitest run tests/lib/ai/capture/projects-schema.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Write failing OpenAI strict-mode schema tests**

Add to `tests/lib/ai/capture/projects-json-schema.test.ts` (after the last `});`):

```ts
  it('major_projects items include deliverables, what_it_develops, weight_pct, duration_weeks in required', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    const required: string[] = mp.items.required;
    expect(required).toContain('deliverables');
    expect(required).toContain('what_it_develops');
    expect(required).toContain('weight_pct');
    expect(required).toContain('duration_weeks');
  });

  it('deliverables is type array', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.properties.deliverables.type).toBe('array');
  });

  it('what_it_develops is type string', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.properties.what_it_develops.type).toBe('string');
  });

  it('weight_pct is nullable number', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.properties.weight_pct.type).toEqual(['number', 'null']);
  });

  it('duration_weeks is nullable number', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.properties.duration_weeks.type).toEqual(['number', 'null']);
  });
```

- [ ] **Step 6: Run to confirm tests fail**

```
pnpm vitest run tests/lib/ai/capture/projects-json-schema.test.ts
```

Expected: failures on the new tests.

- [ ] **Step 7: Update `captureProfileJsonSchemaV2` in capture-scores.ts**

In `lib/ai/analyze/capture-scores.ts`, replace lines 299–317:

```ts
  (cloned.properties as Record<string, unknown>).major_projects = {
    type: ['array', 'null'],
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'competencies', 'deliverables', 'what_it_develops', 'weight_pct', 'duration_weeks', 'source', 'citations'],
      properties: {
        title: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 10 },
        competencies: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        deliverables: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        what_it_develops: { type: 'string', minLength: 1, maxLength: 500 },
        weight_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
        duration_weeks: { type: ['number', 'null'], minimum: 1 },
        source: { type: ['string', 'null'], enum: ['instructor', 'materials', 'inferred', null] },
        citations: CITATIONS_ARRAY,
      },
    },
  };
```

- [ ] **Step 8: Run all capture JSON schema tests — expect all pass**

```
pnpm vitest run tests/lib/ai/capture/projects-json-schema.test.ts
```

Expected: all tests pass, strict-mode walker still passes.

- [ ] **Step 9: Run full suite and confirm no regressions**

```
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/ai/capture/schema.ts lib/ai/analyze/capture-scores.ts \
        tests/lib/ai/capture/projects-schema.test.ts \
        tests/lib/ai/capture/projects-json-schema.test.ts
git commit -m "feat(capture): extend majorProjectItemSchema with deliverables, what_it_develops, weight_pct, duration_weeks"
```

---

## Task 2: Update `capture-synthesis.md` — new fields in output spec

**Files:**
- Modify: `lib/ai/prompts/capture-synthesis.md:129-137` (JSON output example)
- Modify: `lib/ai/prompts/capture-synthesis.md:241-249` (extraction rules)

No automated tests — prompt files are tested by the synthesis integration. Verify by reading the changed sections.

- [ ] **Step 1: Update the JSON output example (line 129–137)**

In `lib/ai/prompts/capture-synthesis.md`, replace:

```
  "major_projects": [
    {
      "title": "<project title>",
      "description": "<1-3 sentences on what students produce and decide>",
      "competencies": ["<competency statement matching profile.competencies[].statement>", ...],
      "source": "materials" | "instructor" | "inferred" | null,
      "citations": [ { "type": "chunk", "chunkId": "...", "messageId": null, "excerpt": "≤200 chars" }, ... ]
    }
  ] | null
```

with:

```
  "major_projects": [
    {
      "title": "<project title>",
      "description": "<1-3 sentences on what students produce and decide>",
      "competencies": ["<competency statement matching profile.competencies[].statement>", ...],
      "deliverables": ["<concrete thing students hand in, e.g. press-ready PDF>", ...],
      "what_it_develops": "<1-2 sentences: the capability or gap this project closes for students>",
      "weight_pct": <number 0-100 or null if not determinable>,
      "duration_weeks": <integer ≥1 or null if not determinable>,
      "source": "materials" | "instructor" | "inferred" | null,
      "citations": [ { "type": "chunk", "chunkId": "...", "messageId": null, "excerpt": "≤200 chars" }, ... ]
    }
  ] | null
```

- [ ] **Step 2: Extend the `major_projects` extraction rules (line 241–249)**

In `lib/ai/prompts/capture-synthesis.md`, replace the `### \`major_projects\`` block:

```
### `major_projects`

- Identify major graded projects from assignment headers and rubric documents. Each must have a point value OR be explicitly labeled "major project", "project", "assignment" with a rubric and meaningful scope. Small in-class exercises, weekly practice labs, and quizzes are NOT major projects.
- Cap at **8 entries**. More than 8 signals the filter is too loose — re-apply the "rubric + meaningful scope" gate.
- **`title`**: Short human-readable title from the assignment header (e.g., "Brand Color Report", "Prepress Packaging Specification").
- **`description`**: 1-3 sentences describing what students produce and what decisions they make. Use source voice from the materials (rubric language preferred).
- **`competencies`**: The competency *statements* from the `competencies` array above that this project develops. Must match or closely paraphrase entries already emitted in `competencies`. These are the provenance link between projects and K/U/D scores — a project that evidences D=4 color measurement should list the color-measurement competency statement.
- `source` and `citations` follow the same rules as competency citations.
- When materials are too thin to identify major projects reliably, emit `major_projects: null`. Do NOT fabricate project titles from learning objectives.
```

with:

```
### `major_projects`

- Identify major graded projects from assignment headers and rubric documents. Each must have a point value OR be explicitly labeled "major project", "project", "assignment" with a rubric and meaningful scope. Small in-class exercises, weekly practice labs, and quizzes are NOT major projects.
- Cap at **8 entries**. More than 8 signals the filter is too loose — re-apply the "rubric + meaningful scope" gate.
- **`title`**: Short human-readable title from the assignment header (e.g., "Brand Color Report", "Prepress Packaging Specification").
- **`description`**: 1-3 sentences describing what students produce and what decisions they make. Use source voice from the materials (rubric language preferred).
- **`competencies`**: The competency *statements* from the `competencies` array above that this project develops. Must match or closely paraphrase entries already emitted in `competencies`. These are the provenance link between projects and K/U/D scores — a project that evidences D=4 color measurement should list the color-measurement competency statement.
- **`deliverables`**: Concrete list of what students hand in (files, documents, artifacts). Derive from rubric submission requirements, Canvas assignment instructions, or Area 9 interview answers. Examples: "press-ready PDF", "12-page InDesign document", "pre-press check report". Emit an empty array `[]` when not determinable — do NOT fabricate from objectives.
- **`what_it_develops`**: 1-2 sentences on why this project is formative for students — the capability it builds or the conceptual gap it closes. Use source voice: if the transcript contains an Area 9 significance answer for this project, carry it verbatim or near-verbatim. If not, derive from rubric preambles or the project's position in the course arc.
- **`weight_pct`**: Grade-weight share as a whole-number percentage (0–100). Derive from point totals and total course points documented in `class_structure.assessment` or the rubric. Null when not determinable.
- **`duration_weeks`**: Approximate span from the assignment open date to the due date, in whole weeks. Null when not determinable from the schedule.
- `source` and `citations` follow the same rules as competency citations.
- When materials are too thin to identify major projects reliably, emit `major_projects: null`. Do NOT fabricate project titles from learning objectives.
```

- [ ] **Step 3: Confirm the file reads coherently — scan the two changed sections**

Read `lib/ai/prompts/capture-synthesis.md` lines 120–145 and 235–260 to confirm the edits landed cleanly.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/capture-synthesis.md
git commit -m "feat(capture): add deliverables/what_it_develops/weight_pct/duration_weeks to synthesis major_projects output spec"
```

---

## Task 3: Add Area 9 to `capture-chat-agent.md`

**Files:**
- Modify: `lib/ai/prompts/capture-chat-agent.md` (insert after line 724, before `# Structured per-turn response`)

No automated tests. Verify by reading the inserted section in context.

- [ ] **Step 1: Insert Area 9 after line 724 in capture-chat-agent.md**

In `lib/ai/prompts/capture-chat-agent.md`, between `Do not silently raise scores based on content you couldn't read.` (end of Area 8) and `# Structured per-turn response`, insert:

```markdown

## 9. Signature projects documentation

**Placement:** runs after the synthesis recap (the "Pre-wrap-up turn" in Conversation rules below) and before signaling `good_enough_to_generate`. Does NOT block readiness — it runs regardless of the readiness score. Fire Area 9 once per conversation at the pre-wrap-up point.

**Principle: materials-first.** You already know the major assignments from Area 3 (cross-source reconciliation of catalog `majorProjects` vs Canvas). Area 9 builds on that: confirms deliverables for projects the materials leave ambiguous, and surfaces any significant project the materials didn't name.

**Script (3–5 turns total across all projects):**

1. **Candidate list (no question):** Silently compile the major projects visible in the materials — names, weights, approximate durations. Projects whose deliverables are *already fully described* in Canvas rubric submission requirements or assignment text (enough to populate `deliverables[]` without inference) are materials-complete; do not re-ask about those unless something is ambiguous.

2. **Deliverables probe (one question per project with gaps):** For each project where the materials name it but don't describe what students actually hand in:
   > *"For [name] — what does a completed submission look like? What files, documents, or artifacts does a student turn in?"*

3. **Coverage check (one question):** After addressing the named projects:
   > *"Is there a significant project, assignment, or creative experience in this course that isn't on that list — something that meaningfully shapes students — that I should document?"*

4. **Significance prompt (only for new items surfaced in step 3):**
   > *"What makes [that one] particularly formative for students?"*

**Turn budget:** 3–5 turns total across all projects. Focus on projects where the materials leave the deliverables ambiguous — a project fully described in a rubric needs only confirmation, not a fresh probe.

**What Area 9 does NOT do:**
- Frame projects as employer-facing or portfolio-facing
- Ask "what would impress a recruiter?"
- Score projects against KUD (that happens in Areas 2–4)
- Probe minor assignments, quizzes, or weekly exercises
```

- [ ] **Step 2: Confirm the section landed in context — read lines 720–760**

```
Read lib/ai/prompts/capture-chat-agent.md offset 720 limit 60
```

Confirm Area 9 appears between Area 8's final line and `# Structured per-turn response`.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/capture-chat-agent.md
git commit -m "feat(capture): add Area 9 — signature projects documentation pass to chat agent"
```

---

## Task 4: Update `wiki-update.md` — rich Signature projects rendering

**Files:**
- Modify: `lib/ai/prompts/wiki-update.md:257-309` (§8b and the §8c cross-reference)

- [ ] **Step 1: Replace §8b (lines 257–279) with the new rich format**

In `lib/ai/prompts/wiki-update.md`, replace the block from `#### §8b — Major projects` through `If both \`profile.major_projects\` and \`snapshot.courseMajorProjects\` are null/empty, **omit the section**.` with:

```markdown
#### §8b — Signature projects

Render from `profile.major_projects` when non-null and non-empty.

**Full-capture format** (when `project.deliverables` and `project.what_it_develops` are both present):

```markdown
## Signature projects

**{project.title}**{weight_duration}
{project.description}
Deliverables: {project.deliverables joined with " · "}.
*What it develops:* {project.what_it_develops}
```

Where `{weight_duration}` is:
- ` ({weight_pct}% of grade · ~{duration_weeks} weeks)` when both `weight_pct` and `duration_weeks` are non-null
- ` ({weight_pct}% of grade)` when only `weight_pct` is non-null
- ` (~{duration_weeks} weeks)` when only `duration_weeks` is non-null
- omitted when both are null

Repeat the block for each project in `profile.major_projects`. The `## Signature projects` heading appears once.

**Legacy format** (when `project.deliverables` or `project.what_it_develops` is absent — applies to snapshots captured before 2026-06-16):

```markdown
## Signature projects

- **{project.title}** — {project.description} Develops {competency references, one per listed competency in project.competencies}.
```

**Wikilink rule for competency references (legacy format):** For each string in `project.competencies`, attempt to match it against the `sub_competencies` names you know from this snapshot's coverage substrate. If the string closely matches a sub-competency name that has a slug in the wiki (e.g., `"color-management"`), render `[[color-management|competency statement]]`. If no clear match exists, render the statement as plain text. Do NOT guess slugs; plain text is always the safe fallback.

**Sheet fallback:** If `profile.major_projects` is null or empty AND `snapshot.courseMajorProjects[]` is non-empty, render:

```markdown
## Signature projects

*The following project list comes from the course sheet — not yet captured in a profile audit.*

- {project title from snapshot.courseMajorProjects}
```

If both `profile.major_projects` and `snapshot.courseMajorProjects` are null/empty, **omit the section**.
```

- [ ] **Step 2: Update the §8c Syllabus cross-reference**

In `lib/ai/prompts/wiki-update.md`, in the §8c Syllabus section, replace:

```
**Major projects:** see [Major projects](#major-projects) above.
```

with:

```
**Signature projects:** see [Signature projects](#signature-projects) above.
```

And in the §8c rules block, replace:

```
- The **Major projects** cross-reference line is omitted when the Major projects section (§8b) is also absent.
```

with:

```
- The **Signature projects** cross-reference line is omitted when the Signature projects section (§8b) is also absent.
```

- [ ] **Step 3: Read the changed sections to confirm coherence**

Read `lib/ai/prompts/wiki-update.md` lines 255–315 to confirm §8b and §8c read cleanly.

- [ ] **Step 4: Run full test suite to confirm nothing broke**

```
pnpm vitest run
```

Expected: all tests pass (wiki-update.md has no unit tests — this is a prompt file only).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/prompts/wiki-update.md
git commit -m "feat(wiki): render Signature projects with deliverables and what_it_develops in course pages"
```

---

## Self-review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| `deliverables`, `what_it_develops`, `weight_pct`, `duration_weeks` added to snapshot schema | Task 1 (Zod + JSON schema) |
| OpenAI strict-mode discipline: all 4 new fields in `required` | Task 1 (capture-scores.ts) |
| Backward compat: legacy snapshots without new fields still parse | Task 1 (Zod `.optional()`) |
| Synthesis emits new fields | Task 2 (capture-synthesis.md) |
| Area 9 interview pass (materials-first, 3–5 turns, deliverables probe, coverage check, significance prompt) | Task 3 (capture-chat-agent.md) |
| Area 9 does NOT block `good_enough_to_generate` | Task 3 (explicit in inserted section) |
| Wiki renders `## Signature projects` with rich format when fields present | Task 4 (wiki-update.md) |
| Wiki falls back to legacy format when new fields absent | Task 4 (wiki-update.md) |
| Wiki omits section when both profile.major_projects and sheet fallback are empty | Task 4 (wiki-update.md) |

**Placeholder scan:** No TBDs or TODOs — all code is complete.

**Type consistency:** `majorProjectItemSchema` → `CaptureProjectItem` type alias unchanged (Zod infers the new fields automatically). `captureProfileJsonSchemaV2` references `major_projects` consistent with schema.ts field name throughout.
