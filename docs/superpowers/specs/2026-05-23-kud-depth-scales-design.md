# KUD Depth Scales — Design

**One-line:** Replace the current binary-collapsing K/U/D coverage primitive with three 0–5 depth scales (Know, Understand, Do), anchored to student-side evidence with dimension-specific definitions, plus a rule that affective dispositions are scored on Do only.

---

## Background & motivation

Alpha testing of the current K/U/D coverage scoring surfaced a binary collapse: in practice, cells score met/unmet rather than capturing depth. That defeats the central purpose — the prereq analyzer can't distinguish "students were exposed to this" from "students performed this independently," and the career-target alignment can't distinguish "this course covers it" from "this course develops it."

The original vision argued that three categories scale better than Bloom's six levels for curriculum mapping across hundreds of cells. That argument still holds for **category breadth**; it doesn't address **depth within a category**. Adding depth to each of K, U, and D restores nuance without abandoning the K/U/D categorization that the rest of the framework depends on.

This spec defines the depth scales, the rules that govern when each dimension is scored, and the consequences for the AI scoring prompt.

## Goals

- One 0–5 depth scale per dimension (K, U, D), with dimension-specific anchors that describe **what the student does or grasps**, not what the syllabus says.
- A clear rule separating Know (content), Understand (reasoning), and Do (behavioral output), so cells score independently when student attainment differs across them.
- Treatment of the five foundational competencies (Agency, Attention to Detail, Resilience, Curiosity, Communication) under the same framework, scored on Do only.
- A scoring rule that requires evidence of student attainment, not aspirational syllabus language, so coverage claims survive faculty review.

## Non-goals

- **Not** a replacement of the K/U/D categories. Three categories stay.
- **Not** a separate "Integration" or "Context" dimension. Integration is the top of the Do scale; context is captured by which career-target sub-competency a cell refers to.
- **Not** a Bloom's-style six-level cognitive taxonomy. The scales are about depth of student attainment per K/U/D dimension, not a single cognitive ladder.
- **Not** specified here: the schema migration plan, the prompt diffs, or the heat-map UI rendering. Those follow once the scales are validated against two test courses.

---

## The framework

Three dimensions, each measuring a different kind of student attainment:

| Dimension | Probe question | Cognitive operation |
| --- | --- | --- |
| **Know** | "What is X?" / "Name the X." / "Which of these is X?" | Recall, recognition, fluent use of terminology |
| **Understand** | "Why does X work?" / "What follows from X?" / "When would you use X vs. Y?" | Reasoning about principles, relationships, consequences |
| **Do** | Make X. Produce X. Demonstrate X. | Behavioral output — artifacts, performances, demonstrated skills |

K and U usually correlate in normal cases (you can't reach K5 without picking up some U along the way). The reason to measure them independently is the **dissociation cases**: a course that produces K-high / U-low is teaching jargon without rationale; a course that produces U-high / D-low is teaching ideas without craft; a course that produces D-high / U-low is teaching craft without articulation. Each failure mode is real and worth surfacing.

---

## Scales

Each scale is 0–5. **0 means the dimension is not present in this course at all** and is rendered distinctly in the matrix (empty cell vs. faintly filled cell), because absence is a different claim than weak presence.

### KNOW — recall and identification of content

```
0  Not present
1  Exposure — student encountered it (heard about, read about), not tested
2  Recognize — student can identify the term/fact when shown options
3  Recall — student can produce the term/fact on cue
4  Use correct terminology when discussing the domain
5  Fluent across the full vocabulary, including conventions and edge cases
```

Probes at each level: K1 = "did this appear in lecture or a reading?"; K2 = "multiple-choice quiz on terms"; K3 = "fill-in-the-blank or short-answer"; K4 = "uses correct terms when writing or speaking about the work"; K5 = "sounds native — knows conventions, edge cases, common confusions."

### UNDERSTAND — reasoning about the why

```
0  Not present
1  Restates the explanation as given
2  Explains the rationale in own words
3  Predicts consequences (if X then Y, because…)
4  Reasons through novel cases not previously seen
5  Critiques the principle, identifies limits, extends to new domains
```

Probes at each level: U1 = "parrots back the lecture's reasoning"; U2 = "explains the why in a journal entry, paraphrased"; U3 = "predicts the result of a change to a familiar case"; U4 = "applies the principle to a case the course never covered"; U5 = "argues the principle's limits or extends it to a new situation."

Exposure is **not** a U event. Hearing a principle stated without engaging with it scores K1, U0. The student is aware that the principle exists (K), but has not engaged with the reasoning (U).

### DO — behavioral output

```
0  Not present
1  Performs with per-step direction or supervision
2  Performs using a reference or checklist
3  Performs independently in familiar conditions
4  Adapts performance to new conditions or constraints
5  Performs creatively with critical judgment; can guide others
```

Probes at each level: D1 = "follows instructor's hand-by-hand direction in a demo"; D2 = "works through a guided exercise with a worksheet"; D3 = "produces the standard course artifact on their own"; D4 = "produces a comparable artifact under a different brief or constraint"; D5 = "produces work that goes beyond the assignment, exercises judgment, and could serve as a model for peers."

Watching a demonstration is **not** a D event. It scores K1 (student is aware the skill exists) and possibly U1–2 (student saw the procedure explained), but D stays 0 until the student's hands or output are part of the activity.

---

## Dimension applicability

| Competency type | Scored on K | Scored on U | Scored on D |
| --- | --- | --- | --- |
| Career-target sub-competency (technical) | Yes | Yes | Yes |
| Foundational competency (affective / disposition) | No (null) | No (null) | Yes |

The five foundational competencies (Agency, Attention to Detail, Resilience, Curiosity, Communication) are dispositions demonstrated through behavior. There is no meaningful "Know Resilience" or "Understand Resilience" — students don't recall facts about resilience or reason about it in the moment; they exhibit it. The K and U columns for foundational competencies are stored as null and hidden in the UI rather than displayed as zero (zero would imply "the course tried to develop this and failed").

The D scale anchors still apply to affective competencies, with the same shape:

```
Resilience:
  1  Continues when explicitly told to push through
  2  Continues using a strategy that was modeled
  3  Persists independently through coursework friction
  4  Adapts approach after failure, on their own
  5  Finds traction in genuine difficulty, helps peers persist

Attention to Detail:
  1  Follows correction when an error is pointed out
  2  Catches errors using a checklist
  3  Catches own errors in familiar work
  4  Catches errors in unfamiliar work
  5  Builds checking processes; models for peers
```

The other three (Agency, Curiosity, Communication) follow the same pattern.

---

## Scoring rule

For any dimension to score above 1 (above 0 for U and D), there must be **evidence of student attainment**, not just coverage in course materials. Aspirational syllabus verbs ("students will understand…") do not by themselves justify scores above U1 or D0. Evidence the scoring layer should look for:

- **K2+**: assessment items (quizzes, fill-ins, exam questions)
- **U2+**: student-produced reasoning (written rationale, oral defense, journal entries, design memos)
- **U3+**: graded analysis assignments, application exercises with feedback
- **D2+**: assignment prompts that require student production, with a graded artifact
- **D4+**: assignments that explicitly vary constraints or require adaptation

The implication for the AI scoring prompt: it should be instructed to **find the evidence first, then assign a level**, and to default to a lower level when evidence is ambiguous. The current binary collapse is partly because the prompt treats syllabus language as license to score high; the new prompt should treat the absence of a graded artifact as license to stay low.

---

## Dissociation cases the framework should surface

These are the failure modes the depth scales make visible. Each is a real signal worth flagging in coverage analysis.

| Pattern | What it means | Where it usually shows up |
| --- | --- | --- |
| K-high, U-low | Vocabulary mastered without rationale | Term-heavy courses with quiz-based assessment |
| K-low, U-high | Conceptual grasp without professional language | Discussion-heavy seminars without vocabulary expectations |
| U-high, D-low | Theory without craft | Critique-heavy courses without studio production |
| D-high, U-low | Craft without articulation | Studio-heavy courses without written rationale |
| K1 only, U0, D0 | Mentioned in passing, never engaged | Topics listed in syllabus but absent from assessment |

A course-level report should flag any cell where two dimensions diverge by more than two levels; that's usually a curriculum gap worth conversation.

---

## Open questions to validate

1. **Does Know really reach 5 in practice, or does it plateau at 4?** If alpha testing on the two pilot courses shows nothing ever scores K5 plausibly, collapse the scale to 0–4 and accept the asymmetry.
2. **Is U5 reachable in undergraduate curriculum, or only in graduate work?** If most undergraduate courses cap at U3–4, the top of the Understand scale is mostly informational. Acceptable, but worth confirming.
3. **For affective competencies, does the AI have enough evidence in standard course materials to score above D1?** Resilience and Curiosity especially are inferred from *conditions* the course creates (open-ended projects, productive failure, revision cycles), not from explicit instruction. The scoring prompt for foundational competencies may need a different evidence model than for technical competencies.
4. **Does the K1 exposure level correlate with anything useful, or does it just produce noise?** If most cells in most courses have K1 (because something gets mentioned in most courses), the level may add little signal. Testing will show whether K1 is useful as a distinct value or whether it should fold into K0.

Each of these is answerable from a side-by-side comparison of the current binary scoring and the new depth scoring on the same two test courses.

---

## What this changes downstream

- **`coverage_scores` schema**: extend to three integer columns (`k_depth`, `u_depth`, `d_depth`), each 0–5, nullable for K/U on foundational competencies. Add a `scale_version` column so historical scores survive future scale changes.
- **AI scoring prompt**: rewrite to ask for evidence excerpts per dimension before scoring, with explicit rules about what counts as evidence for each level.
- **Heat map rendering**: each cell shows the max of K/U/D as a fill intensity; hover shows the dimension breakdown. 0 renders as empty (not faint).
- **Editor UI**: faculty see three sliders per cell (or two, for affective rows) with the dimension-specific anchor descriptions on hover. Evidence excerpts visible underneath. One numeric change per slider, not five.
- **Prereq analyzer**: needs a configurable rule like "the prior course must reach depth ≥3 on what this course requires at ≥4."

Implementation plan to follow once the spec is validated against two test courses.

---

## Naming alignment

This spec uses the renamed module structure agreed in the framework review:

- `CourseCapture` — snapshot of a course's current state (renamed from the existing Course Builder)
- `CourseRevise` — Phase 2 iterative-improvement tool (takes a CourseCapture profile as input)
- `CourseBuilder` — Phase 2 from-scratch course-design tool
- `CareerCapture` — employer-side capture, synthesized across many employer inputs per career path (renamed from the existing Industry Partner Input concept)

The depth scales defined here apply to coverage scoring across all four modules.
