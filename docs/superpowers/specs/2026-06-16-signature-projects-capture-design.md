# Signature Projects Capture — Design

> **Status:** approved 2026-06-16.
> **Scope:** Part A only — capture + store + wiki. Part B (position capture employer-rating step) is deferred until the content layer has enough coverage to be useful.

---

## Goal

Add structured documentation of the significant projects students do in each course — what they produce, what they hand in, and why it matters for their development. Captured during the existing course-capture interview, stored in the course snapshot, and surfaced in the wiki. Neutral framing: not employer-facing, not portfolio-facing — just an accurate record of what the course produces. Downstream consumers (position capture, website, prospective-student info) select and re-frame for their audience.

---

## What is a "signature project"

A significant assignment, project, or creative experience in a course that:
- Produces something concrete students make or do
- Meaningfully shapes student development (not just a quiz or reading check)
- Is worth describing to someone who wants to understand what the course is actually like

Minor assignments, quizzes, and weekly exercises are out of scope. Major projects, capstone work, studio productions, live client briefs, simulations, and portfolio pieces are in scope. There is no minimum count per course — a course with one dominant project captures one; a course with five meaningful ones captures five.

---

## Data shape

Each course snapshot gains a `signature_projects` array. Per-project fields:

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | What the course calls it ("Brand Identity Package") |
| `description` | `string` | What students do — the brief/context, 2–4 sentences |
| `deliverables` | `string[]` | Concrete list of what they hand in |
| `what_it_develops` | `string` | Why it matters for student growth (1–2 sentences) |
| `weight_pct` | `number \| null` | Portion of course grade; null if not determinable from materials |
| `duration_weeks` | `number \| null` | Approximate span; null if not determinable |
| `source` | `'materials' \| 'interview' \| 'both'` | Provenance — where this description came from |

`source` distinguishes auto-extracted projects (fully described in Canvas rubrics / syllabus) from those that needed instructor input to describe richly. Projects from materials alone that the instructor then confirmed or enriched become `'both'`.

---

## Piece 1 — Interview agent (capture-chat-agent.md)

### New Area 9: Signature projects documentation

**Placement:** pre-wrap-up phase — after the agent's synthesis recap and before the readiness signal. Does NOT block `good_enough_to_generate`; competency evidence is the gate. Area 9 runs regardless of readiness score.

**Principle:** materials-first. The agent already knows the major assignments from Area 3 (cross-source reconciliation of catalog `majorProjects` vs Canvas). Area 9 builds on that — confirms and enriches, asks only what the materials don't already answer.

**Script:**

1. **Candidate list (no question):** Agent compiles the major projects it sees in the materials — names, weights, approximate durations. Projects whose deliverables are already fully described in Canvas rubrics or assignment text (enough to populate all fields) are marked `source: 'materials'` silently; the agent does not re-ask about those unless something is ambiguous.

2. **Deliverables probe (one question per project with gaps):** For each project where the materials name it but don't describe what students actually hand in:
   > *"For [name] — what does a completed submission look like? What files, documents, or artifacts does a student turn in?"*

3. **Coverage check (one question):** After the named projects:
   > *"Is there a significant project, assignment, or creative experience in this course that isn't on that list — something that meaningfully shapes students — that I should document?"*

4. **Significance prompt (only for new items surfaced in step 3):**
   > *"What makes [that one] particularly formative for students?"*

**Turn budget:** 3–5 turns total across all projects. The agent does not attempt to describe every project equally — it focuses on the ones where the materials leave the richest content ambiguous. A project that is fully described in a rubric needs only a quick confirmation, not a fresh probe.

**What the agent does NOT do in Area 9:**
- Frame projects as employer-facing or portfolio-facing
- Ask "what would impress a recruiter?"
- Score projects against KUD (that happens in Areas 2–4 per competency, not here)
- Probe every minor assignment

---

## Piece 2 — Snapshot schema

Add `signature_projects` to the synthesis output schema:

```ts
export const SignatureProject = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  deliverables: z.array(z.string().min(1).max(300)),
  what_it_develops: z.string().min(1).max(500),
  weight_pct: z.number().min(0).max(100).nullable(),
  duration_weeks: z.number().int().min(1).nullable(),
  source: z.enum(['materials', 'interview', 'both']),
});

// Added to the top-level snapshot schema alongside incoming_expectations:
signature_projects: z.array(SignatureProject).default([]),
```

`default([])` ensures backward compatibility — existing snapshots without the field parse cleanly.

The synthesis prompt receives the interview transcript (including Area 9 turns) and the materials, and emits `signature_projects[]` alongside the existing competency outputs. The OpenAI strict-schema discipline applies: `signature_projects` must be in `required`; nullable fields use `{ type: ['number', 'null'] }` form.

---

## Piece 3 — Wiki regen

When the wiki regenerator writes a course wiki page, it includes a `## Signature projects` section when `signature_projects` is non-empty.

**Format:**

```markdown
## Signature projects

**Brand Identity Package** (30% of grade · ~6 weeks)
Students develop a complete visual identity system for an assigned brand brief, making all production decisions from concept to press-ready files.
Deliverables: 12-page InDesign brand standards manual · business card and letterhead templates · social media asset package (3 sizes).
*What it develops:* First time students own a production decision from brief to physical output — the gap between "I know how to use InDesign" and "I can manage a production job."

**Print Production Job Ticket** (16% of grade)
…
```

Deliverables render as a `·`-separated inline list (not a bullet list) to stay compact in the wiki page. The `source` field is not rendered in the wiki — it is internal provenance metadata.

**Regen condition:** same as today — wiki page regenerates when a new snapshot is committed for that course. The `## Signature projects` section is written only if `signature_projects.length > 0`; if the array is empty (old snapshot, or a course with no major projects identified), the section is omitted entirely.

---

## What this does NOT include

- A new wiki page type `projects/` — projects live as a section within their course page. A separate page type adds navigation complexity without benefit at this stage.
- A `course_projects` DB table — the snapshot JSON and wiki page are the storage. Position capture (Part B) queries via the wiki search tool; no separate table needed.
- Any UI for operators to manually enter projects — capture through the interview is the path. Manual entry can be added later if needed.
- Part B (position capture employer-rating step) — deferred. Build this spec first, get coverage across the captured courses, then design the rating interaction.

---

## Files touched

| File | Change |
|---|---|
| `lib/ai/prompts/capture-chat-agent.md` | New Area 9 section |
| `lib/ai/prompts/capture-synthesis.md` | Instruct synthesis to emit `signature_projects[]` |
| `lib/ai/capture/schema.ts` (`captureProfileSchemaV2`) | Add `signature_projects` field |
| Wiki regen prompt / `lib/ai/wiki/update.ts` | Include `signature_projects[]` in page context; write `## Signature projects` section |
| Wiki OKF frontmatter (`lib/ai/wiki/okf-frontmatter.ts`) | No change needed — `## Signature projects` is a plain markdown section, not a frontmatter field |
| Tests | Snapshot schema test (new field round-trips); wiki regen test (section appears when non-empty, absent when empty) |
